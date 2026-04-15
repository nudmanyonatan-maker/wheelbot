"""WheelBot Exit Checker — standalone script to check positions against exit rules.

Connects to Alpaca paper trading, gets all open positions, checks each
against exit rules, executes closes, and sends Discord notifications.

EXIT RULES:
  - 50% profit  -> close with LIMIT order at ask price
  - 2x loss     -> close with MARKET order (urgent)
  - DTE < 5     -> close regardless (gamma risk)
"""

import json
import re
import sys
from datetime import datetime, timezone

import requests
from alpaca.data.historical import OptionHistoricalDataClient
from alpaca.data.requests import OptionLatestQuoteRequest
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import AssetClass, OrderSide, OrderType, TimeInForce
from alpaca.trading.requests import LimitOrderRequest, MarketOrderRequest

# ── Credentials ───────────────────────────────────────────────────────────────
API_KEY = "PK7SQLLS75HIWHTJACSBJO2IK3"
SECRET_KEY = "A2MwvqDHeeVh5VKQKDu2F7TqLV5PhDyqBCWRa56KdUAf"
DISCORD_WEBHOOK = (
    "https://discord.com/api/webhooks/1492021042594713701/"
    "QEPCp-r13dpTDl0DSZOjoaRSxlzXr3PHN83p_sYludu4c325GCGhzYHkB5BCrpFQcHh7"
)

# ── Exit thresholds ───────────────────────────────────────────────────────────
PROFIT_TARGET_PCT = 0.50   # close at 50% profit
STOP_LOSS_MULT = 2.0       # close when loss = 2x credit
DTE_CLOSE_THRESHOLD = 5    # close if DTE < 5


def parse_occ_symbol(occ: str) -> dict | None:
    """Parse OCC option symbol into components.

    Format: SYMBOL (up to 6 chars) + YYMMDD + C/P + 8-digit strike*1000
    Example: SOFI  250516P00012500 -> SOFI, 2025-05-16, put, 12.50
    """
    m = re.match(
        r"^([A-Z]+)\s*(\d{6})([CP])(\d{8})$",
        occ.strip(),
    )
    if not m:
        return None
    underlying = m.group(1).strip()
    date_str = m.group(2)
    opt_type = "call" if m.group(3) == "C" else "put"
    strike = int(m.group(4)) / 1000.0
    exp = datetime.strptime(date_str, "%y%m%d").strftime("%Y-%m-%d")
    return {
        "underlying": underlying,
        "expiration": exp,
        "option_type": opt_type,
        "strike": strike,
    }


def calc_dte(expiration: str) -> int:
    """Days to expiration from today."""
    exp_date = datetime.strptime(expiration, "%Y-%m-%d").date()
    today = datetime.now(timezone.utc).date()
    return (exp_date - today).days


def send_discord(message: str) -> None:
    """Post a message to Discord via webhook."""
    try:
        resp = requests.post(
            DISCORD_WEBHOOK,
            json={"content": message},
            timeout=10,
        )
        if resp.status_code in (200, 204):
            print(f"  [Discord] Notification sent")
        else:
            print(f"  [Discord] Failed ({resp.status_code}): {resp.text[:100]}")
    except Exception as e:
        print(f"  [Discord] Error: {e}")


def main():
    print("=" * 60)
    print("WheelBot Exit Checker")
    print("=" * 60)

    # ── Connect ───────────────────────────────────────────────────────────
    print("\n1. Connecting to Alpaca (paper)...")
    trading = TradingClient(API_KEY, SECRET_KEY, paper=True)
    option_data = OptionHistoricalDataClient(API_KEY, SECRET_KEY)

    acct = trading.get_account()
    print(f"   Account connected")
    print(f"   Portfolio value: ${float(acct.portfolio_value):,.2f}")
    print(f"   Buying power:   ${float(acct.buying_power):,.2f}")
    print(f"   Cash:           ${float(acct.cash):,.2f}")

    # ── Get all positions ─────────────────────────────────────────────────
    print("\n2. Fetching all open positions...")
    all_positions = trading.get_all_positions()

    if not all_positions:
        msg = "No open positions found. Nothing to check."
        print(f"   {msg}")
        send_discord(f"**WheelBot Exit Check** -- {msg}")
        return

    stock_positions = []
    option_positions = []

    for pos in all_positions:
        if pos.asset_class == AssetClass.US_OPTION:
            option_positions.append(pos)
        else:
            stock_positions.append(pos)

    print(f"   Found {len(stock_positions)} stock position(s)")
    print(f"   Found {len(option_positions)} option position(s)")

    # Show stock positions for reference
    for pos in stock_positions:
        unrealized = float(pos.unrealized_pl)
        pct = float(pos.unrealized_plpc) * 100
        print(f"   [STOCK] {pos.symbol}: {int(float(pos.qty))} shares "
              f"@ ${float(pos.avg_entry_price):.2f} -> ${float(pos.current_price):.2f} "
              f"(P&L: ${unrealized:+,.2f} / {pct:+.1f}%)")

    if not option_positions:
        msg = f"No option positions. {len(stock_positions)} stock position(s) only."
        print(f"\n   {msg}")
        send_discord(f"**WheelBot Exit Check** -- {msg}")
        return

    # ── Get quotes for option positions ───────────────────────────────────
    print("\n3. Fetching latest quotes for option positions...")
    option_symbols = [pos.symbol for pos in option_positions]

    quotes = {}
    try:
        req = OptionLatestQuoteRequest(symbol_or_symbols=option_symbols)
        quotes = option_data.get_option_latest_quote(req)
        print(f"   Got quotes for {len(quotes)} option(s)")
    except Exception as e:
        print(f"   Warning: Failed to fetch option quotes: {e}")
        print(f"   Will use position data for pricing")

    # ── Check exit conditions ─────────────────────────────────────────────
    print("\n4. Checking exit conditions...")
    print("-" * 60)

    actions_taken = []
    status_lines = []

    for pos in option_positions:
        symbol = pos.symbol
        qty = int(float(pos.qty))
        entry_price = float(pos.avg_entry_price)
        current_price = float(pos.current_price) if pos.current_price else None
        side_raw = str(pos.side).lower()
        side = "short" if "short" in side_raw else "long"
        unrealized_pl = float(pos.unrealized_pl)

        # Parse OCC symbol
        parsed = parse_occ_symbol(symbol)
        if not parsed:
            print(f"   [SKIP] Cannot parse OCC symbol: {symbol}")
            continue

        underlying = parsed["underlying"]
        expiration = parsed["expiration"]
        opt_type = parsed["option_type"]
        strike = parsed["strike"]
        days_to_exp = calc_dte(expiration)

        # Get live quote bid/ask
        quote = quotes.get(symbol)
        bid = float(quote.bid_price) if quote and quote.bid_price else None
        ask = float(quote.ask_price) if quote and quote.ask_price else None
        mid = (bid + ask) / 2 if bid and ask else current_price

        print(f"\n   {underlying} {strike:.0f}{opt_type[0].upper()} {expiration} "
              f"(DTE: {days_to_exp})")
        print(f"     Side: {side} | Qty: {qty}")
        display_price = mid if mid else current_price
        print(f"     Entry: ${entry_price:.2f} | Current: ${display_price:.2f}" if display_price else
              f"     Entry: ${entry_price:.2f} | Current: N/A")
        if bid is not None and ask is not None:
            print(f"     Bid: ${bid:.2f} | Ask: ${ask:.2f}")
        print(f"     Unrealized P&L: ${unrealized_pl:+,.2f}")

        # Determine exit action
        exit_action = None
        exit_reason = ""
        order_type = ""

        if side == "short":
            # SHORT options: profit = price dropped, loss = price rose
            # For short options: we sold at entry_price, now costs mid to buy back
            if mid is not None:
                profit_pct = (entry_price - mid) / entry_price if entry_price > 0 else 0

                # Rule 1: 50% profit target -> limit order at ask
                if profit_pct >= PROFIT_TARGET_PCT:
                    exit_action = "PROFIT_TARGET"
                    exit_reason = (f"50% profit target hit "
                                   f"(profit: {profit_pct:.0%}, "
                                   f"entry: ${entry_price:.2f}, current: ${mid:.2f})")
                    order_type = "LIMIT"

                # Rule 2: 2x loss -> market order
                elif mid >= entry_price * STOP_LOSS_MULT:
                    exit_action = "STOP_LOSS"
                    exit_reason = (f"2x stop loss triggered "
                                   f"(current: ${mid:.2f} >= "
                                   f"2x entry: ${entry_price * STOP_LOSS_MULT:.2f})")
                    order_type = "MARKET"

            # Rule 3: DTE < 5 -> close regardless
            if not exit_action and days_to_exp < DTE_CLOSE_THRESHOLD:
                exit_action = "DTE_CLOSE"
                exit_reason = f"DTE={days_to_exp} < {DTE_CLOSE_THRESHOLD} (gamma risk)"
                # Use market for DTE close - urgency
                order_type = "MARKET"

        elif side == "long":
            # LONG options: profit = price rose, loss = price dropped
            if mid is not None:
                profit_pct = (mid - entry_price) / entry_price if entry_price > 0 else 0

                # Rule 1: 50% profit -> limit order at bid
                if profit_pct >= PROFIT_TARGET_PCT:
                    exit_action = "PROFIT_TARGET"
                    exit_reason = (f"50% profit target hit "
                                   f"(profit: {profit_pct:.0%}, "
                                   f"entry: ${entry_price:.2f}, current: ${mid:.2f})")
                    order_type = "LIMIT"

                # Rule 2: loss exceeds 2x entry cost -> market order
                elif mid <= entry_price / STOP_LOSS_MULT:
                    exit_action = "STOP_LOSS"
                    exit_reason = (f"2x loss triggered "
                                   f"(current: ${mid:.2f} <= "
                                   f"entry/{STOP_LOSS_MULT:.0f}: "
                                   f"${entry_price / STOP_LOSS_MULT:.2f})")
                    order_type = "MARKET"

            # Rule 3: DTE < 5 -> close regardless
            if not exit_action and days_to_exp < DTE_CLOSE_THRESHOLD:
                exit_action = "DTE_CLOSE"
                exit_reason = f"DTE={days_to_exp} < {DTE_CLOSE_THRESHOLD} (gamma risk)"
                order_type = "MARKET"

        # ── Execute exit ──────────────────────────────────────────────────
        if exit_action:
            print(f"     ** EXIT: {exit_action} -- {exit_reason}")
            print(f"     ** Order type: {order_type}")

            try:
                abs_qty = abs(qty)
                if side == "short":
                    # Buy to close
                    if order_type == "MARKET":
                        order_req = MarketOrderRequest(
                            symbol=symbol,
                            qty=abs_qty,
                            side=OrderSide.BUY,
                            type=OrderType.MARKET,
                            time_in_force=TimeInForce.DAY,
                        )
                    else:
                        # Limit at ask price
                        limit_px = ask if ask else (mid * 1.01 if mid else entry_price * 0.5)
                        order_req = LimitOrderRequest(
                            symbol=symbol,
                            qty=abs_qty,
                            side=OrderSide.BUY,
                            type=OrderType.LIMIT,
                            time_in_force=TimeInForce.DAY,
                            limit_price=round(limit_px, 2),
                        )
                else:
                    # Sell to close (long positions)
                    if order_type == "MARKET":
                        order_req = MarketOrderRequest(
                            symbol=symbol,
                            qty=abs_qty,
                            side=OrderSide.SELL,
                            type=OrderType.MARKET,
                            time_in_force=TimeInForce.DAY,
                        )
                    else:
                        # Limit at bid price
                        limit_px = bid if bid else (mid * 0.99 if mid else entry_price * 1.5)
                        order_req = LimitOrderRequest(
                            symbol=symbol,
                            qty=abs_qty,
                            side=OrderSide.SELL,
                            type=OrderType.LIMIT,
                            time_in_force=TimeInForce.DAY,
                            limit_price=round(limit_px, 2),
                        )

                order = trading.submit_order(order_req)
                order_id = str(order.id)
                order_status = str(order.status)
                limit_info = ""
                if order_type == "LIMIT":
                    limit_info = f" @ ${order_req.limit_price:.2f}"

                action_msg = (
                    f"{'BUY' if side == 'short' else 'SELL'} TO CLOSE "
                    f"{abs_qty}x {underlying} {strike:.0f}{opt_type[0].upper()} {expiration} "
                    f"({order_type}{limit_info}) -- {exit_reason} "
                    f"[Order {order_id[:8]}... {order_status}]"
                )
                print(f"     >> Order placed: {order_status} (ID: {order_id})")
                actions_taken.append(action_msg)

            except Exception as e:
                err_msg = f"FAILED to close {underlying} {strike:.0f}{opt_type[0].upper()}: {e}"
                print(f"     >> ERROR: {e}")
                actions_taken.append(err_msg)
        else:
            hold_msg = f"{underlying} {strike:.0f}{opt_type[0].upper()} {expiration} -- HOLD"
            price_for_calc = mid if mid is not None else current_price
            if price_for_calc is not None and entry_price > 0 and side == "short":
                pct = (entry_price - price_for_calc) / entry_price * 100
                hold_msg += f" (profit: {pct:+.1f}%)"
            elif price_for_calc is not None and entry_price > 0 and side == "long":
                pct = (price_for_calc - entry_price) / entry_price * 100
                hold_msg += f" (return: {pct:+.1f}%)"
            hold_msg += f" DTE={days_to_exp}"
            print(f"     -> No exit triggered. Holding.")
            status_lines.append(hold_msg)

    # ── Summary ───────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    discord_parts = ["**WheelBot Exit Check**"]
    discord_parts.append(f"Portfolio: ${float(acct.portfolio_value):,.2f} | "
                         f"Buying Power: ${float(acct.buying_power):,.2f}")
    discord_parts.append("")

    if actions_taken:
        print(f"\n  ACTIONS TAKEN ({len(actions_taken)}):")
        discord_parts.append(f"**Actions Taken ({len(actions_taken)}):**")
        for a in actions_taken:
            print(f"    - {a}")
            discord_parts.append(f"- {a}")
    else:
        print("\n  No exits triggered.")
        discord_parts.append("No exits triggered.")

    if status_lines:
        print(f"\n  HOLDING ({len(status_lines)}):")
        discord_parts.append("")
        discord_parts.append(f"**Holding ({len(status_lines)}):**")
        for s in status_lines:
            print(f"    - {s}")
            discord_parts.append(f"- {s}")

    if stock_positions:
        discord_parts.append("")
        discord_parts.append(f"**Stock Positions ({len(stock_positions)}):**")
        for pos in stock_positions:
            unrealized = float(pos.unrealized_pl)
            pct = float(pos.unrealized_plpc) * 100
            discord_parts.append(
                f"- {pos.symbol}: {int(float(pos.qty))} shares "
                f"(${unrealized:+,.2f} / {pct:+.1f}%)"
            )

    # Send to Discord
    discord_msg = "\n".join(discord_parts)
    # Discord limit is 2000 chars
    if len(discord_msg) > 1990:
        discord_msg = discord_msg[:1987] + "..."
    print("\n5. Sending Discord notification...")
    send_discord(discord_msg)

    print("\nDone.")


if __name__ == "__main__":
    main()
