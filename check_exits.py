"""WheelBot Exit Checker — check open Alpaca positions against exit rules.

EXIT RULES:
  - 50% profit → close with limit order at ask price
  - 2x loss   → close with MARKET order (stop loss)
  - DTE < 5   → close regardless (gamma risk)
"""

import json
import re
import requests
from datetime import datetime, date

from alpaca.trading.client import TradingClient
from alpaca.trading.enums import AssetClass, OrderSide, OrderType, TimeInForce
from alpaca.trading.requests import LimitOrderRequest, MarketOrderRequest
from alpaca.data.historical import OptionHistoricalDataClient
from alpaca.data.requests import OptionLatestQuoteRequest

# ── Credentials ──────────────────────────────────────────────────────────
API_KEY = "PK7SQLLS75HIWHTJACSBJO2IK3"
API_SECRET = "A2MwvqDHeeVh5VKQKDu2F7TqLV5PhDyqBCWRa56KdUAf"
DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1492021042594713701/QEPCp-r13dpTDl0DSZOjoaRSxlzXr3PHN83p_sYludu4c325GCGhzYHkB5BCrpFQcHh7"

# ── Clients ──────────────────────────────────────────────────────────────
trading = TradingClient(API_KEY, API_SECRET, paper=True)
option_data = OptionHistoricalDataClient(API_KEY, API_SECRET)


def parse_option_symbol(symbol: str) -> dict | None:
    """Parse OCC option symbol like 'SOFI  260417P00012000' into components."""
    # OCC format: SYMBOL(6 padded) + YYMMDD + C/P + strike*1000 (8 digits)
    m = re.match(r'^(\w+?)\s*(\d{6})([CP])(\d{8})$', symbol.strip())
    if not m:
        return None
    underlying = m.group(1)
    date_str = m.group(2)  # YYMMDD
    opt_type = "call" if m.group(3) == "C" else "put"
    strike = int(m.group(4)) / 1000.0
    exp_date = datetime.strptime(date_str, "%y%m%d").date()
    return {
        "underlying": underlying,
        "expiration": exp_date,
        "option_type": opt_type,
        "strike": strike,
    }


def calc_dte(expiration: date) -> int:
    """Days to expiration from today."""
    return (expiration - date.today()).days


def send_discord(content: str):
    """Send message to Discord webhook."""
    try:
        resp = requests.post(DISCORD_WEBHOOK, json={"content": content}, timeout=10)
        print(f"  Discord notification sent (status {resp.status_code})")
    except Exception as e:
        print(f"  Discord send failed: {e}")


def main():
    print("=" * 60)
    print("WheelBot Exit Checker")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # ── 1. Get account info ──────────────────────────────────────────────
    acct = trading.get_account()
    print(f"\nAccount: portfolio=${float(acct.portfolio_value):,.2f}  "
          f"cash=${float(acct.cash):,.2f}  "
          f"buying_power=${float(acct.buying_power):,.2f}")

    # ── 2. Get all positions ─────────────────────────────────────────────
    positions = trading.get_all_positions()
    if not positions:
        msg = "No open positions found."
        print(f"\n{msg}")
        send_discord(f"**WheelBot Exit Check** — {msg}")
        return

    stock_positions = []
    option_positions = []
    for pos in positions:
        if pos.asset_class == AssetClass.US_OPTION:
            option_positions.append(pos)
        else:
            stock_positions.append(pos)

    print(f"\nPositions: {len(stock_positions)} stock, {len(option_positions)} option")

    # ── 3. Show stock positions ──────────────────────────────────────────
    if stock_positions:
        print("\n── Stock Positions ──")
        for pos in stock_positions:
            qty = int(float(pos.qty))
            avg = float(pos.avg_entry_price)
            cur = float(pos.current_price)
            pl = float(pos.unrealized_pl)
            plpc = float(pos.unrealized_plpc) * 100
            print(f"  {pos.symbol}: {qty} shares @ ${avg:.2f} → ${cur:.2f}  "
                  f"P&L: ${pl:+,.2f} ({plpc:+.1f}%)")

    # ── 4. Check option positions against exit rules ─────────────────────
    actions_taken = []

    if not option_positions:
        print("\nNo option positions to check.")
    else:
        print("\n── Option Positions ──")

        # Get latest quotes for all option symbols
        opt_symbols = [pos.symbol for pos in option_positions]
        quotes = {}
        try:
            req = OptionLatestQuoteRequest(symbol_or_symbols=opt_symbols)
            quotes = option_data.get_option_latest_quote(req)
        except Exception as e:
            print(f"  Warning: Could not fetch option quotes: {e}")

        for pos in option_positions:
            qty = int(float(pos.qty))
            avg_entry = float(pos.avg_entry_price)
            cur_price = float(pos.current_price)
            pl = float(pos.unrealized_pl)
            side = str(pos.side)

            parsed = parse_option_symbol(pos.symbol)
            dte_val = calc_dte(parsed["expiration"]) if parsed else None

            # Get bid/ask from quote
            quote = quotes.get(pos.symbol)
            bid = float(quote.bid_price) if quote and quote.bid_price else cur_price
            ask = float(quote.ask_price) if quote and quote.ask_price else cur_price

            underlying = parsed["underlying"] if parsed else pos.symbol
            strike = parsed["strike"] if parsed else 0
            opt_type = parsed["option_type"] if parsed else "?"
            exp_str = parsed["expiration"].strftime("%Y-%m-%d") if parsed else "?"

            print(f"\n  {pos.symbol}")
            print(f"    {underlying} ${strike} {opt_type} exp {exp_str}  "
                  f"DTE={dte_val}")
            print(f"    Qty: {qty} ({side})  Entry: ${avg_entry:.2f}  "
                  f"Current: ${cur_price:.2f}  Bid/Ask: ${bid:.2f}/${ask:.2f}")
            print(f"    P&L: ${pl:+,.2f}")

            # Only check exit rules for short option positions (qty < 0)
            is_short = qty < 0
            abs_qty = abs(qty)

            if not is_short:
                # For long positions, exit rules apply differently
                # 50% profit on long = current > 1.5x entry
                # 2x loss on long = current < 0.5x entry (lost half the premium)
                # DTE < 5 still applies
                exit_reason = None
                order_type = None

                if dte_val is not None and dte_val < 5:
                    exit_reason = f"DTE={dte_val} < 5 — closing to avoid gamma risk"
                    order_type = "market"
                elif cur_price >= avg_entry * 1.5:
                    exit_reason = f"50% profit on long: ${cur_price:.2f} >= ${avg_entry * 1.5:.2f}"
                    order_type = "limit"
                elif cur_price <= avg_entry * 0.5:
                    exit_reason = f"2x loss on long: ${cur_price:.2f} <= ${avg_entry * 0.5:.2f}"
                    order_type = "market"

                if exit_reason:
                    print(f"    ** EXIT: {exit_reason}")
                    action = close_position(pos.symbol, abs_qty, "sell", bid, order_type)
                    actions_taken.append(
                        f"CLOSE LONG {underlying} ${strike}{opt_type[0].upper()} "
                        f"exp {exp_str} x{abs_qty}: {exit_reason} → {action}"
                    )
                else:
                    print(f"    ✓ No exit trigger")
                continue

            # ── Short option exit checks ─────────────────────────────────
            # For short options: we sold at avg_entry, current price is cost to buy back
            # Profit = entry - current (option decayed)
            # Loss = current - entry (option increased)

            exit_reason = None
            order_type = None

            # Rule 1: DTE < 5 → close regardless (check first — highest urgency)
            if dte_val is not None and dte_val < 5:
                exit_reason = f"DTE={dte_val} < 5 — closing to avoid gamma/assignment risk"
                order_type = "market"

            # Rule 2: 2x loss → close with MARKET order
            elif cur_price >= avg_entry * 2.0:
                exit_reason = (f"STOP LOSS: current ${cur_price:.2f} >= "
                               f"2x entry ${avg_entry * 2.0:.2f}")
                order_type = "market"

            # Rule 3: 50% profit → close with limit at ask
            elif cur_price <= avg_entry * 0.50:
                exit_reason = (f"50% profit target: current ${cur_price:.2f} <= "
                               f"50% of entry ${avg_entry * 0.50:.2f}")
                order_type = "limit"

            if exit_reason:
                print(f"    ** EXIT: {exit_reason}")
                action = close_position(pos.symbol, abs_qty, "buy", ask, order_type)
                actions_taken.append(
                    f"CLOSE SHORT {underlying} ${strike}{opt_type[0].upper()} "
                    f"exp {exp_str} x{abs_qty}: {exit_reason} → {action}"
                )
            else:
                pnl_pct = ((avg_entry - cur_price) / avg_entry) * 100 if avg_entry > 0 else 0
                print(f"    ✓ No exit trigger (P&L: {pnl_pct:+.1f}% of max, "
                      f"need -50% or +100%)")

    # ── 5. Summary & Discord notification ────────────────────────────────
    print("\n" + "=" * 60)
    if actions_taken:
        print(f"ACTIONS TAKEN: {len(actions_taken)}")
        for a in actions_taken:
            print(f"  • {a}")

        discord_msg = (
            f"**WheelBot Exit Checker** — {len(actions_taken)} action(s) taken\n"
        )
        for a in actions_taken:
            discord_msg += f"• {a}\n"
        send_discord(discord_msg)
    else:
        summary_parts = []
        if stock_positions:
            summary_parts.append(f"{len(stock_positions)} stock")
        if option_positions:
            summary_parts.append(f"{len(option_positions)} option")
        pos_str = ", ".join(summary_parts) if summary_parts else "0"
        msg = f"All positions healthy ({pos_str} positions checked). No exits needed."
        print(msg)
        send_discord(f"**WheelBot Exit Check** — {msg}")

    print("=" * 60)


def close_position(symbol: str, qty: int, side: str, price: float, order_type: str) -> str:
    """Submit a close order and return status string."""
    order_side = OrderSide.BUY if side == "buy" else OrderSide.SELL

    try:
        if order_type == "market":
            request = MarketOrderRequest(
                symbol=symbol,
                qty=qty,
                side=order_side,
                type=OrderType.MARKET,
                time_in_force=TimeInForce.DAY,
            )
            order = trading.submit_order(request)
            return f"MARKET order submitted (ID: {order.id}, status: {order.status})"
        else:
            request = LimitOrderRequest(
                symbol=symbol,
                qty=qty,
                side=order_side,
                type=OrderType.LIMIT,
                time_in_force=TimeInForce.DAY,
                limit_price=price,
            )
            order = trading.submit_order(request)
            return f"LIMIT order @ ${price:.2f} submitted (ID: {order.id}, status: {order.status})"
    except Exception as e:
        return f"ORDER FAILED: {e}"


if __name__ == "__main__":
    main()
