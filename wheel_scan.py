#!/usr/bin/env python3
"""WheelBot — Autonomous wheel strategy scanner and trader."""

import json
import time
import requests
from datetime import datetime, timedelta

from alpaca.trading.client import TradingClient
from alpaca.trading.requests import LimitOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce, OrderType
from alpaca.data.historical.option import OptionHistoricalDataClient
from alpaca.data.requests import OptionChainRequest

# ── Config ──────────────────────────────────────────────────────────────────
API_KEY = "PK7SQLLS75HIWHTJACSBJO2IK3"
API_SECRET = "A2MwvqDHeeVh5VKQKDu2F7TqLV5PhDyqBCWRa56KdUAf"
DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1492021042594713701/QEPCp-r13dpTDl0DSZOjoaRSxlzXr3PHN83p_sYludu4c325GCGhzYHkB5BCrpFQcHh7"

WISHLIST = ["SOFI", "F", "PINS", "DKNG", "CCL", "CLF", "T", "VALE", "RIVN", "NIO"]
MAX_POSITIONS = 3
DELTA_MIN = 0.20
DELTA_MAX = 0.30
DTE_MIN = 30
DTE_MAX = 45
MIN_BID = 0.20

# ── Helpers ─────────────────────────────────────────────────────────────────
def send_discord(content):
    """Send a message to Discord webhook."""
    try:
        resp = requests.post(DISCORD_WEBHOOK, json={"content": content}, timeout=10)
        print(f"  Discord: {resp.status_code}")
    except Exception as e:
        print(f"  Discord error: {e}")


def score_option(delta, dte, bid, strike):
    """Score = (1-|delta|) × (250/(DTE+5)) × (bid/strike)"""
    return (1 - abs(delta)) * (250 / (dte + 5)) * (bid / strike)


# ── Main ────────────────────────────────────────────────────────────────────
def main():
    print("=" * 60)
    print("WheelBot — Autonomous Wheel Strategy Scanner")
    print(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # Connect to Alpaca
    trading_client = TradingClient(API_KEY, API_SECRET, paper=True)
    option_client = OptionHistoricalDataClient(API_KEY, API_SECRET)

    # ── Account Info ────────────────────────────────────────────────────
    account = trading_client.get_account()
    buying_power = float(account.buying_power)
    cash = float(account.cash)
    portfolio_value = float(account.portfolio_value)
    print(f"\nAccount:")
    print(f"  Portfolio Value: ${portfolio_value:,.2f}")
    print(f"  Cash:           ${cash:,.2f}")
    print(f"  Buying Power:   ${buying_power:,.2f}")

    # ── Check Existing Positions ────────────────────────────────────────
    positions = trading_client.get_all_positions()
    option_positions = [p for p in positions if hasattr(p, 'asset_class') and str(p.asset_class) == 'us_option']

    print(f"\nExisting Positions: {len(positions)} total, {len(option_positions)} options")

    # Track which underlying symbols have existing positions
    existing_underlyings = set()
    for p in positions:
        sym = p.symbol
        print(f"  {sym}: qty={p.qty}, P&L=${float(p.unrealized_pl):,.2f}")
        # Extract underlying from option symbol (first chars before the date digits)
        # Option symbols look like: SOFI250516P00010000
        underlying = ""
        for ch in sym:
            if ch.isdigit():
                break
            underlying += ch
        if underlying:
            existing_underlyings.add(underlying)

    # Also count short put positions toward the max
    open_short_puts = len([p for p in option_positions if float(p.qty) < 0])

    # Check open orders too
    from alpaca.trading.requests import GetOrdersRequest
    from alpaca.trading.enums import QueryOrderStatus
    open_orders = trading_client.get_orders(
        filter=GetOrdersRequest(status=QueryOrderStatus.OPEN)
    )
    option_orders = [o for o in open_orders if hasattr(o, 'symbol') and len(o.symbol) > 5]
    for o in option_orders:
        underlying = ""
        for ch in o.symbol:
            if ch.isdigit():
                break
            underlying += ch
        if underlying:
            existing_underlyings.add(underlying)

    print(f"  Open short puts: {open_short_puts}")
    print(f"  Open option orders: {len(option_orders)}")
    print(f"  Underlyings with positions/orders: {existing_underlyings}")

    slots_available = MAX_POSITIONS - open_short_puts - len(option_orders)
    if slots_available <= 0:
        msg = f"WheelBot: No slots available ({open_short_puts} positions + {len(option_orders)} pending orders = max {MAX_POSITIONS}). Skipping scan."
        print(f"\n{msg}")
        send_discord(msg)
        return

    print(f"\n  Slots available: {slots_available}")

    # ── Scan Wishlist ───────────────────────────────────────────────────
    print(f"\nScanning {len(WISHLIST)} stocks...")

    today = datetime.now()
    exp_earliest = today + timedelta(days=DTE_MIN)
    exp_latest = today + timedelta(days=DTE_MAX)

    candidates = []

    for symbol in WISHLIST:
        if symbol in existing_underlyings:
            print(f"\n  {symbol}: SKIP (existing position/order)")
            continue

        print(f"\n  {symbol}: scanning options chain...")

        try:
            # Get option chain using snapshots
            chain_req = OptionChainRequest(
                underlying_symbol=symbol,
                expiration_date_gte=exp_earliest.strftime("%Y-%m-%d"),
                expiration_date_lte=exp_latest.strftime("%Y-%m-%d"),
                type="put",
            )
            chain = option_client.get_option_chain(chain_req)

            if not chain:
                print(f"    No options data returned")
                continue

            print(f"    Found {len(chain)} option contracts")

            for option_symbol, snapshots in chain.items():
                try:
                    snap = snapshots

                    # Get greeks
                    greeks = snap.greeks if hasattr(snap, 'greeks') and snap.greeks else None
                    if not greeks:
                        continue

                    delta = abs(greeks.delta) if greeks.delta else 0

                    # Filter by delta
                    if delta < DELTA_MIN or delta > DELTA_MAX:
                        continue

                    # Get quote data
                    quote = snap.latest_quote if hasattr(snap, 'latest_quote') and snap.latest_quote else None
                    if not quote:
                        continue

                    bid = float(quote.bid_price) if quote.bid_price else 0
                    ask = float(quote.ask_price) if quote.ask_price else 0

                    if bid < MIN_BID:
                        continue

                    # Parse option symbol for expiration and strike
                    # Format: SOFI250516P00010000
                    # Find where digits start in the symbol
                    idx = 0
                    for ch in option_symbol:
                        if ch.isdigit():
                            break
                        idx += 1

                    date_str = option_symbol[idx:idx+6]  # YYMMDD
                    opt_type = option_symbol[idx+6]       # P or C
                    strike_str = option_symbol[idx+7:]    # 00010000

                    exp_date = datetime.strptime(date_str, "%y%m%d")
                    strike = int(strike_str) / 1000.0
                    dte = (exp_date - today).days

                    if dte < DTE_MIN or dte > DTE_MAX:
                        continue

                    # Check collateral needed (with margin: strike × 50)
                    collateral = strike * 100  # Full collateral
                    collateral_margin = strike * 50  # With margin

                    if collateral_margin > buying_power:
                        print(f"    {option_symbol}: SKIP (need ${collateral_margin:,.0f}, have ${buying_power:,.0f})")
                        continue

                    s = score_option(delta, dte, bid, strike)

                    candidates.append({
                        "symbol": option_symbol,
                        "underlying": symbol,
                        "strike": strike,
                        "expiration": exp_date.strftime("%Y-%m-%d"),
                        "dte": dte,
                        "delta": delta,
                        "bid": bid,
                        "ask": ask,
                        "score": s,
                        "collateral": collateral_margin,
                        "premium": bid * 100,
                    })

                except Exception as e:
                    continue

        except Exception as e:
            print(f"    Error: {e}")
            continue

    # ── Rank Candidates ─────────────────────────────────────────────────
    candidates.sort(key=lambda c: c["score"], reverse=True)

    print(f"\n{'=' * 60}")
    print(f"Top Candidates ({len(candidates)} total):")
    print(f"{'=' * 60}")

    for i, c in enumerate(candidates[:10]):
        print(f"  #{i+1}: {c['underlying']} ${c['strike']:.0f}P exp {c['expiration']} "
              f"(DTE {c['dte']}) | delta={c['delta']:.3f} | bid=${c['bid']:.2f} "
              f"| premium=${c['premium']:.0f} | score={c['score']:.6f}")

    # ── Place Trades ────────────────────────────────────────────────────
    trades_placed = []
    used_underlyings = set()

    for c in candidates:
        if len(trades_placed) >= min(2, slots_available):
            break

        if c["underlying"] in used_underlyings:
            continue

        if c["collateral"] > buying_power:
            continue

        print(f"\nPlacing order: SELL {c['symbol']} @ ${c['bid']:.2f} limit")

        try:
            order_req = LimitOrderRequest(
                symbol=c["symbol"],
                qty=1,
                side=OrderSide.SELL,
                type=OrderType.LIMIT,
                time_in_force=TimeInForce.DAY,
                limit_price=c["bid"],
            )
            order = trading_client.submit_order(order_req)

            print(f"  Order submitted! ID: {order.id}, Status: {order.status}")

            trades_placed.append(c)
            used_underlyings.add(c["underlying"])
            buying_power -= c["collateral"]

            # Discord notification
            msg = (
                f"**WheelBot Trade Placed** \n"
                f"**SELL PUT** {c['underlying']} ${c['strike']:.0f}P\n"
                f"Exp: {c['expiration']} (DTE {c['dte']})\n"
                f"Delta: {c['delta']:.3f}\n"
                f"Limit: ${c['bid']:.2f} (Premium: ${c['premium']:.0f})\n"
                f"Collateral: ${c['collateral']:,.0f}\n"
                f"Score: {c['score']:.6f}\n"
                f"Order ID: {order.id}"
            )
            send_discord(msg)

            time.sleep(1)  # Brief pause between orders

        except Exception as e:
            print(f"  Order FAILED: {e}")
            msg = f"WheelBot: Order failed for {c['symbol']}: {e}"
            send_discord(msg)

    # ── Summary ─────────────────────────────────────────────────────────
    print(f"\n{'=' * 60}")
    print(f"SUMMARY")
    print(f"{'=' * 60}")
    print(f"  Stocks scanned: {len(WISHLIST)}")
    print(f"  Candidates found: {len(candidates)}")
    print(f"  Trades placed: {len(trades_placed)}")

    if trades_placed:
        summary_lines = ["**WheelBot Daily Summary**"]
        summary_lines.append(f"Portfolio: ${portfolio_value:,.2f} | Cash: ${cash:,.2f}")
        summary_lines.append(f"Scanned: {len(WISHLIST)} stocks | Candidates: {len(candidates)}")
        summary_lines.append(f"Trades placed: {len(trades_placed)}")
        for t in trades_placed:
            summary_lines.append(f"  • SELL {t['underlying']} ${t['strike']:.0f}P exp {t['expiration']} @ ${t['bid']:.2f}")
        send_discord("\n".join(summary_lines))
    else:
        msg = f"**WheelBot Daily Summary**\nPortfolio: ${portfolio_value:,.2f}\nNo trades placed today. Candidates found: {len(candidates)}"
        if not candidates:
            msg += "\nNo options met criteria (delta {DELTA_MIN}-{DELTA_MAX}, DTE {DTE_MIN}-{DTE_MAX}, bid >= ${MIN_BID})"
        send_discord(msg)

    print("\nDone!")
    return {
        "candidates": candidates[:10],
        "trades": trades_placed,
        "account": {
            "portfolio_value": portfolio_value,
            "cash": cash,
            "buying_power": float(account.buying_power),
        }
    }


if __name__ == "__main__":
    result = main()
