"""WheelBot Exit Checker — standalone script to check open positions for exit conditions.

Connects directly to Alpaca paper trading, fetches all positions,
evaluates exit rules, executes exits, and sends Discord notifications.

EXIT RULES:
  - 50% profit  -> close with LIMIT order at ask price
  - 2x loss     -> close with MARKET order (stop loss)
  - DTE < 5     -> close regardless (gamma risk)
"""

from __future__ import annotations

import re
import sys
from datetime import datetime, date

import requests
from alpaca.data.historical import OptionHistoricalDataClient
from alpaca.data.requests import OptionLatestQuoteRequest
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import AssetClass, OrderSide, OrderType, TimeInForce
from alpaca.trading.requests import LimitOrderRequest, MarketOrderRequest

# ── Configuration ──────────────────────────────────────────────────────────

API_KEY = "PK7SQLLS75HIWHTJACSBJO2IK3"
SECRET_KEY = "A2MwvqDHeeVh5VKQKDu2F7TqLV5PhDyqBCWRa56KdUAf"
DISCORD_WEBHOOK = (
    "https://discord.com/api/webhooks/1492021042594713701/"
    "QEPCp-r13dpTDl0DSZOjoaRSxlzXr3PHN83p_sYludu4c325GCGhzYHkB5BCrpFQcHh7"
)

PROFIT_TARGET_PCT = 0.50   # 50% of credit captured
STOP_LOSS_MULT = 2.0       # 2x entry price
DTE_THRESHOLD = 5          # close if fewer than 5 DTE


# ── Alpaca clients ─────────────────────────────────────────────────────────

trading = TradingClient(API_KEY, SECRET_KEY, paper=True)
option_data = OptionHistoricalDataClient(API_KEY, SECRET_KEY)


# ── Helpers ────────────────────────────────────────────────────────────────

def parse_occ_symbol(symbol: str) -> dict | None:
    """Parse an OCC option symbol like 'AAPL260417C00200000' into components.

    Handles both padded (AAPL  260417C00200000) and unpadded (AAPL260417C00200000) formats.
    """
    m = re.match(r'^([A-Z]+)\s*(\d{6})([CP])(\d{8})$', symbol)
    if not m:
        return None
    underlying = m.group(1).strip()
    date_str = m.group(2)
    option_type = "call" if m.group(3) == "C" else "put"
    strike = int(m.group(4)) / 1000.0
    exp = datetime.strptime(date_str, "%y%m%d").date()
    return {
        "underlying": underlying,
        "expiration": exp,
        "option_type": option_type,
        "strike": strike,
    }


def calc_dte(expiration: date) -> int:
    """Days to expiration from today."""
    return (expiration - date.today()).days


def send_discord(message: str) -> None:
    """Send a message to Discord via webhook."""
    try:
        resp = requests.post(
            DISCORD_WEBHOOK,
            json={"content": message},
            timeout=10,
        )
        if resp.status_code in (200, 204):
            print(f"  Discord notification sent.")
        else:
            print(f"  Discord webhook returned {resp.status_code}: {resp.text[:100]}")
    except requests.RequestException as e:
        print(f"  Discord webhook failed: {e}")


def send_discord_embed(embed: dict) -> None:
    """Send a rich embed to Discord."""
    try:
        resp = requests.post(
            DISCORD_WEBHOOK,
            json={"embeds": [embed]},
            timeout=10,
        )
        if resp.status_code not in (200, 204):
            print(f"  Discord embed returned {resp.status_code}")
    except requests.RequestException as e:
        print(f"  Discord embed failed: {e}")


# ── Main logic ─────────────────────────────────────────────────────────────

def main() -> None:
    # 1. Connect & get account info
    print("=" * 60)
    print("WheelBot Exit Checker")
    print("=" * 60)

    acct = trading.get_account()
    print(f"\nAccount: Paper Trading")
    print(f"  Portfolio value: ${float(acct.portfolio_value):,.2f}")
    print(f"  Buying power:    ${float(acct.buying_power):,.2f}")
    print(f"  Cash:            ${float(acct.cash):,.2f}")

    # 2. Get all positions
    positions = trading.get_all_positions()
    if not positions:
        print("\nNo open positions found. Nothing to check.")
        send_discord("**WheelBot Exit Check** — No open positions. All clear.")
        return

    option_positions = [p for p in positions if p.asset_class == AssetClass.US_OPTION]
    stock_positions = [p for p in positions if p.asset_class == AssetClass.US_EQUITY]

    print(f"\nPositions: {len(positions)} total "
          f"({len(option_positions)} options, {len(stock_positions)} stocks)")

    # Report stock positions
    for pos in stock_positions:
        print(f"\n  STOCK: {pos.symbol}")
        print(f"    Qty: {pos.qty} | Avg entry: ${float(pos.avg_entry_price):.2f} | "
              f"Current: ${float(pos.current_price):.2f}")
        print(f"    P&L: ${float(pos.unrealized_pl):.2f} "
              f"({float(pos.unrealized_plpc) * 100:.1f}%)")

    # 3. Check option positions against exit rules
    actions_taken = []

    if not option_positions:
        print("\nNo option positions to check for exits.")
    else:
        print(f"\n{'─' * 60}")
        print("Checking option positions against exit rules...")
        print(f"{'─' * 60}")

    for pos in option_positions:
        symbol = pos.symbol
        qty = int(float(pos.qty))
        avg_entry = float(pos.avg_entry_price)
        current_price = float(pos.current_price)
        unrealized_pl = float(pos.unrealized_pl)
        side = str(pos.side)

        parsed = parse_occ_symbol(symbol)
        underlying = parsed["underlying"] if parsed else symbol[:6].strip()
        exp_date = parsed["expiration"] if parsed else None
        opt_type = parsed["option_type"] if parsed else "?"
        strike = parsed["strike"] if parsed else 0.0
        days_left = calc_dte(exp_date) if exp_date else 999

        print(f"\n  {symbol}")
        print(f"    {underlying} {strike} {opt_type.upper()} exp {exp_date} "
              f"(DTE: {days_left})")
        print(f"    Side: {side} | Qty: {qty} | Entry: ${avg_entry:.2f} | "
              f"Current: ${current_price:.2f}")
        print(f"    P&L: ${unrealized_pl:.2f}")

        # Get live quote for ask price (used for limit orders)
        ask_price = current_price  # fallback
        try:
            req = OptionLatestQuoteRequest(symbol_or_symbols=[symbol])
            quotes = option_data.get_option_latest_quote(req)
            q = quotes.get(symbol)
            if q:
                bid = float(q.bid_price) if q.bid_price else 0.0
                ask = float(q.ask_price) if q.ask_price else 0.0
                mid = (bid + ask) / 2 if (bid + ask) > 0 else current_price
                print(f"    Quote: bid=${bid:.2f} / ask=${ask:.2f} / mid=${mid:.2f}")
                ask_price = ask if ask > 0 else current_price
        except Exception as e:
            print(f"    (Could not fetch live quote: {e})")

        # Determine if this is a short position (sold to open)
        is_short = qty < 0
        abs_qty = abs(qty)

        # For short options: profit = entry_credit - current_price
        # For long options: profit = current_price - entry_cost
        if is_short:
            pnl_per_contract = (avg_entry - current_price) * 100
            pnl_pct = (avg_entry - current_price) / avg_entry if avg_entry > 0 else 0
        else:
            pnl_per_contract = (current_price - avg_entry) * 100
            pnl_pct = (current_price - avg_entry) / avg_entry if avg_entry > 0 else 0

        exit_reason = None
        exit_order_type = None  # "limit" or "market"
        exit_price = None

        # EXIT RULE 1: 50% profit target
        if is_short and pnl_pct >= PROFIT_TARGET_PCT:
            exit_reason = (f"PROFIT TARGET: {pnl_pct:.0%} profit captured "
                           f"(entry ${avg_entry:.2f} -> current ${current_price:.2f})")
            exit_order_type = "limit"
            exit_price = ask_price
        elif not is_short and pnl_pct >= PROFIT_TARGET_PCT:
            exit_reason = (f"PROFIT TARGET: {pnl_pct:.0%} gain "
                           f"(entry ${avg_entry:.2f} -> current ${current_price:.2f})")
            exit_order_type = "limit"
            exit_price = current_price  # for long positions, sell at bid ideally

        # EXIT RULE 2: 2x loss (stop loss)
        if exit_reason is None:
            if is_short and current_price >= avg_entry * STOP_LOSS_MULT:
                exit_reason = (f"STOP LOSS: current ${current_price:.2f} >= "
                               f"{STOP_LOSS_MULT}x entry ${avg_entry * STOP_LOSS_MULT:.2f}")
                exit_order_type = "market"
            elif not is_short and current_price <= avg_entry * (1 - (1 - 1/STOP_LOSS_MULT)):
                # Long option lost half its value
                loss_pct = (avg_entry - current_price) / avg_entry if avg_entry > 0 else 0
                if loss_pct >= 0.50:  # 50% loss on a long
                    exit_reason = (f"STOP LOSS: lost {loss_pct:.0%} "
                                   f"(entry ${avg_entry:.2f} -> current ${current_price:.2f})")
                    exit_order_type = "market"

        # EXIT RULE 3: DTE < 5
        if exit_reason is None and days_left < DTE_THRESHOLD:
            exit_reason = f"DTE EXPIRY: only {days_left} days left (threshold: {DTE_THRESHOLD})"
            exit_order_type = "market"  # urgent, use market

        # Execute the exit
        if exit_reason:
            print(f"    >>> EXIT: {exit_reason}")

            # Determine order side: short positions buy to close, long positions sell to close
            order_side = OrderSide.BUY if is_short else OrderSide.SELL

            try:
                if exit_order_type == "limit" and exit_price and exit_price > 0:
                    request = LimitOrderRequest(
                        symbol=symbol,
                        qty=abs_qty,
                        side=order_side,
                        type=OrderType.LIMIT,
                        time_in_force=TimeInForce.DAY,
                        limit_price=round(exit_price, 2),
                    )
                else:
                    request = MarketOrderRequest(
                        symbol=symbol,
                        qty=abs_qty,
                        side=order_side,
                        type=OrderType.MARKET,
                        time_in_force=TimeInForce.DAY,
                    )

                order = trading.submit_order(request)
                action_desc = ("Buy-to-close" if is_short else "Sell-to-close")
                order_desc = (f"LIMIT @ ${exit_price:.2f}" if exit_order_type == "limit"
                              else "MARKET")

                print(f"    >>> Order placed: {action_desc} {abs_qty}x {symbol} "
                      f"({order_desc}) — ID: {order.id}")

                actions_taken.append({
                    "symbol": symbol,
                    "underlying": underlying,
                    "strike": strike,
                    "opt_type": opt_type,
                    "exp_date": str(exp_date),
                    "qty": abs_qty,
                    "side": "BTC" if is_short else "STC",
                    "order_type": order_desc,
                    "reason": exit_reason,
                    "order_id": str(order.id),
                    "entry": avg_entry,
                    "current": current_price,
                    "pnl": unrealized_pl,
                })

            except Exception as e:
                print(f"    >>> ORDER FAILED: {e}")
                actions_taken.append({
                    "symbol": symbol,
                    "underlying": underlying,
                    "reason": exit_reason,
                    "error": str(e),
                })
        else:
            print(f"    No exit triggered. Holding.")

    # 4. Send Discord summary
    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print(f"{'=' * 60}")

    if actions_taken:
        successful = [a for a in actions_taken if "order_id" in a]
        failed = [a for a in actions_taken if "error" in a]

        print(f"\nActions: {len(successful)} exits placed, {len(failed)} failed")

        # Build Discord embed
        fields = []
        for action in successful:
            fields.append({
                "name": f"{action['side']} {action['underlying']} "
                        f"${action['strike']} {action['opt_type'].upper()} "
                        f"({action['exp_date']})",
                "value": (f"**{action['order_type']}** x{action['qty']}\n"
                          f"Entry: ${action['entry']:.2f} | "
                          f"Current: ${action['current']:.2f}\n"
                          f"P&L: ${action['pnl']:.2f}\n"
                          f"Reason: {action['reason']}\n"
                          f"Order: `{action['order_id'][:8]}...`"),
                "inline": False,
            })

        for action in failed:
            fields.append({
                "name": f"FAILED: {action['underlying']}",
                "value": f"Reason: {action['reason']}\nError: {action['error']}",
                "inline": False,
            })

        embed = {
            "title": "WheelBot Exit Checker",
            "description": (f"{len(successful)} exit(s) executed, "
                            f"{len(failed)} failed"),
            "color": 0xFF6600 if failed else 0x00FF00,
            "fields": fields,
            "footer": {"text": f"Checked {len(positions)} positions"},
        }
        send_discord_embed(embed)
    else:
        print("\nNo exits triggered. All positions within thresholds.")

        # Build a status summary for Discord
        lines = ["**WheelBot Exit Check** — All positions OK\n"]
        for pos in option_positions:
            parsed = parse_occ_symbol(pos.symbol)
            u = parsed["underlying"] if parsed else pos.symbol[:6].strip()
            s = parsed["strike"] if parsed else 0
            t = parsed["option_type"].upper() if parsed else "?"
            d = calc_dte(parsed["expiration"]) if parsed and parsed["expiration"] else "?"
            lines.append(
                f"`{u}` ${s} {t} | "
                f"Entry ${float(pos.avg_entry_price):.2f} | "
                f"Now ${float(pos.current_price):.2f} | "
                f"P&L ${float(pos.unrealized_pl):.2f} | "
                f"DTE {d}"
            )
        for pos in stock_positions:
            lines.append(
                f"`{pos.symbol}` (stock) | "
                f"Qty {pos.qty} | "
                f"Entry ${float(pos.avg_entry_price):.2f} | "
                f"Now ${float(pos.current_price):.2f} | "
                f"P&L ${float(pos.unrealized_pl):.2f}"
            )
        if not option_positions and not stock_positions:
            lines.append("No positions found.")

        send_discord("\n".join(lines))

    print("\nDone.")


if __name__ == "__main__":
    main()
