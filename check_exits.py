#!/usr/bin/env python3
"""WheelBot Exit Checker — standalone position monitor.

Connects to Alpaca paper account, checks all open positions against exit rules,
executes exits, and sends Discord notification.

EXIT RULES:
  - 50% profit  → close with limit order at ask price
  - 2x loss     → close with MARKET order (stop-loss)
  - DTE < 5     → close regardless (MARKET order)

For stop losses: ALWAYS use market orders.
"""

import json
import re
import sys
from datetime import datetime, date

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

PROFIT_TARGET_PCT = 0.50   # 50% profit → close
STOP_LOSS_MULT = 2.0       # 2x loss → close
DTE_THRESHOLD = 5          # DTE < 5 → close regardless


def parse_option_symbol(symbol: str) -> dict | None:
    """Parse OCC option symbol into components.

    Format: AAPL  240119C00150000  (underlying padded to 6, YYMMDD, C/P, strike*1000)
    """
    match = re.match(
        r"^([A-Z]+)\s*(\d{6})([CP])(\d{8})$",
        symbol.strip(),
    )
    if not match:
        return None

    underlying = match.group(1).strip()
    date_str = match.group(2)
    opt_type = "call" if match.group(3) == "C" else "put"
    strike = int(match.group(4)) / 1000.0

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


def send_discord(content: str) -> None:
    """Send a message to the Discord webhook."""
    try:
        resp = requests.post(
            DISCORD_WEBHOOK,
            json={"content": content},
            timeout=10,
        )
        if resp.status_code in (200, 204):
            print("Discord notification sent.")
        else:
            print(f"Discord webhook returned {resp.status_code}: {resp.text}")
    except Exception as e:
        print(f"Discord send failed: {e}")


def main():
    print("=" * 60)
    print("WheelBot Exit Checker")
    print("=" * 60)

    # ── Connect ───────────────────────────────────────────────────────────
    trading = TradingClient(API_KEY, SECRET_KEY, paper=True)
    option_data = OptionHistoricalDataClient(API_KEY, SECRET_KEY)

    acct = trading.get_account()
    print(f"\nAccount: paper | Buying power: ${float(acct.buying_power):,.2f} | "
          f"Portfolio: ${float(acct.portfolio_value):,.2f}")

    # ── Get all positions ─────────────────────────────────────────────────
    positions = trading.get_all_positions()

    if not positions:
        msg = "No open positions found. Nothing to check."
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

    # ── Check stock positions (report only) ───────────────────────────────
    report_lines = []

    if stock_positions:
        print("\n--- Stock Positions ---")
        for pos in stock_positions:
            sym = pos.symbol
            qty = int(float(pos.qty))
            avg = float(pos.avg_entry_price)
            cur = float(pos.current_price)
            pnl = float(pos.unrealized_pl)
            pnl_pct = float(pos.unrealized_plpc) * 100
            side = str(pos.side)
            print(f"  {sym}: {qty} shares @ ${avg:.2f} | "
                  f"now ${cur:.2f} | P&L: ${pnl:+,.2f} ({pnl_pct:+.1f}%) [{side}]")
            report_lines.append(
                f"  **{sym}**: {qty} shares @ ${avg:.2f} → ${cur:.2f} "
                f"| P&L: ${pnl:+,.2f} ({pnl_pct:+.1f}%)"
            )

    # ── Check option positions against exit rules ─────────────────────────
    actions_taken = []

    if option_positions:
        # Gather option symbols for batch quote
        opt_symbols = [pos.symbol for pos in option_positions]

        # Fetch latest quotes for all option positions
        quotes = {}
        try:
            req = OptionLatestQuoteRequest(symbol_or_symbols=opt_symbols)
            quotes = option_data.get_option_latest_quote(req)
        except Exception as e:
            print(f"\nWarning: Could not fetch option quotes: {e}")

        print("\n--- Option Positions ---")
        for pos in option_positions:
            sym = pos.symbol
            qty = int(float(pos.qty))
            avg_entry = float(pos.avg_entry_price)
            cur_price = float(pos.current_price)
            pnl = float(pos.unrealized_pl)
            side = str(pos.side)

            parsed = parse_option_symbol(sym)
            underlying = parsed["underlying"] if parsed else sym
            exp_date = parsed["expiration"] if parsed else None
            opt_type = parsed["option_type"] if parsed else "?"
            strike = parsed["strike"] if parsed else 0.0
            dte_val = calc_dte(exp_date) if exp_date else None

            # Get live ask price from quote
            quote = quotes.get(sym)
            ask_price = float(quote.ask_price) if quote and quote.ask_price else cur_price
            bid_price = float(quote.bid_price) if quote and quote.bid_price else cur_price

            dte_str = f"DTE={dte_val}" if dte_val is not None else "DTE=?"
            print(f"  {sym} ({underlying} {strike} {opt_type} {exp_date})")
            print(f"    {side} {abs(qty)} @ ${avg_entry:.2f} | "
                  f"now ${cur_price:.2f} (bid=${bid_price:.2f}/ask=${ask_price:.2f}) | "
                  f"P&L: ${pnl:+,.2f} | {dte_str}")

            # Determine if we're short or long
            is_short = qty < 0
            abs_qty = abs(qty)

            # ── Exit rule evaluation ──────────────────────────────────
            action = None
            reason = ""

            if is_short:
                # Short option: sold for a credit (avg_entry is what we received)
                # Profit = entry - current (option decayed)
                # Loss = current - entry (option grew)
                profit_pct = (avg_entry - cur_price) / avg_entry if avg_entry > 0 else 0

                # Rule 1: 50% profit → close with limit at ask
                if profit_pct >= PROFIT_TARGET_PCT:
                    reason = (f"PROFIT TARGET: {profit_pct:.0%} profit "
                              f"(entry ${avg_entry:.2f} → ${cur_price:.2f})")
                    action = "profit_target"

                # Rule 2: 2x loss → close with MARKET
                elif cur_price >= avg_entry * STOP_LOSS_MULT:
                    reason = (f"STOP LOSS: current ${cur_price:.2f} >= "
                              f"{STOP_LOSS_MULT}x entry ${avg_entry * STOP_LOSS_MULT:.2f}")
                    action = "stop_loss"

                # Rule 3: DTE < 5 → close regardless
                elif dte_val is not None and dte_val < DTE_THRESHOLD:
                    reason = f"DTE EXPIRY: {dte_val} days left (< {DTE_THRESHOLD})"
                    action = "dte_close"

            else:
                # Long option: paid a debit (avg_entry is what we paid)
                # Profit = current - entry (option grew)
                # Loss = entry - current (option decayed)
                profit_pct = (cur_price - avg_entry) / avg_entry if avg_entry > 0 else 0

                # Rule 1: 50% profit → close with limit at bid
                if profit_pct >= PROFIT_TARGET_PCT:
                    reason = (f"PROFIT TARGET: {profit_pct:.0%} profit "
                              f"(entry ${avg_entry:.2f} → ${cur_price:.2f})")
                    action = "profit_target"

                # Rule 2: 2x loss → close with MARKET
                elif avg_entry > 0 and cur_price <= avg_entry * (1 - 1.0 / STOP_LOSS_MULT):
                    # For long options, a 2x loss means we lost the equivalent
                    # Actually for long: the max loss is the premium paid.
                    # 2x loss doesn't quite apply the same way. Let's check if
                    # the option lost more than 50% of value (analogous to 2x for shorts).
                    pass

                # For long options, check if value dropped below threshold
                if action is None and avg_entry > 0 and cur_price <= avg_entry / STOP_LOSS_MULT:
                    reason = (f"STOP LOSS: current ${cur_price:.2f} <= "
                              f"entry/${STOP_LOSS_MULT} = ${avg_entry / STOP_LOSS_MULT:.2f}")
                    action = "stop_loss"

                # Rule 3: DTE < 5 → close regardless
                if action is None and dte_val is not None and dte_val < DTE_THRESHOLD:
                    reason = f"DTE EXPIRY: {dte_val} days left (< {DTE_THRESHOLD})"
                    action = "dte_close"

            # ── Execute exit ──────────────────────────────────────────
            if action:
                print(f"    >>> EXIT TRIGGERED: {reason}")

                # Determine order side: buy to close shorts, sell to close longs
                close_side = OrderSide.BUY if is_short else OrderSide.SELL

                order = None
                order_type_str = ""

                if action == "profit_target":
                    # Limit order at ask (for shorts buying back) or bid (for longs selling)
                    limit_px = ask_price if is_short else bid_price
                    try:
                        order_req = LimitOrderRequest(
                            symbol=sym,
                            qty=abs_qty,
                            side=close_side,
                            type=OrderType.LIMIT,
                            time_in_force=TimeInForce.DAY,
                            limit_price=limit_px,
                        )
                        order = trading.submit_order(order_req)
                        order_type_str = f"LIMIT @ ${limit_px:.2f}"
                    except Exception as e:
                        print(f"    !!! Order failed: {e}")
                        actions_taken.append(f"FAILED {sym}: {reason} — {e}")
                        continue

                elif action in ("stop_loss", "dte_close"):
                    # MARKET order for stop losses and DTE exits
                    try:
                        order_req = MarketOrderRequest(
                            symbol=sym,
                            qty=abs_qty,
                            side=close_side,
                            type=OrderType.MARKET,
                            time_in_force=TimeInForce.DAY,
                        )
                        order = trading.submit_order(order_req)
                        order_type_str = "MARKET"
                    except Exception as e:
                        print(f"    !!! Order failed: {e}")
                        actions_taken.append(f"FAILED {sym}: {reason} — {e}")
                        continue

                if order:
                    oid = str(order.id)
                    status = str(order.status)
                    close_verb = "Buy-to-close" if is_short else "Sell-to-close"
                    print(f"    Order placed: {close_verb} {abs_qty}x {sym} "
                          f"({order_type_str}) — ID: {oid} — Status: {status}")
                    actions_taken.append(
                        f"{close_verb} {abs_qty}x **{underlying}** {strike} {opt_type} "
                        f"exp {exp_date} ({order_type_str}) — {reason} [Order: {oid[:8]}… {status}]"
                    )
            else:
                print("    → No exit conditions met. Holding.")
                report_lines.append(
                    f"  **{underlying}** {strike} {opt_type} exp {exp_date} | "
                    f"{side} {abs_qty} @ ${avg_entry:.2f} → ${cur_price:.2f} | "
                    f"P&L: ${pnl:+,.2f} | {dte_str} — Holding"
                )

    # ── Summary ───────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    total_positions = len(stock_positions) + len(option_positions)
    print(f"Total positions checked: {total_positions}")
    print(f"Exit orders placed: {len(actions_taken)}")

    if actions_taken:
        print("\nActions taken:")
        for a in actions_taken:
            print(f"  • {a}")

    # ── Discord notification ──────────────────────────────────────────────
    discord_msg = f"**WheelBot Exit Check** — {datetime.now().strftime('%Y-%m-%d %H:%M ET')}\n"
    discord_msg += f"Portfolio: ${float(acct.portfolio_value):,.2f} | "
    discord_msg += f"Buying Power: ${float(acct.buying_power):,.2f}\n"
    discord_msg += f"Positions: {total_positions} ({len(stock_positions)} stock, {len(option_positions)} option)\n"

    if report_lines:
        discord_msg += "\n**Holding:**\n" + "\n".join(report_lines) + "\n"

    if actions_taken:
        discord_msg += "\n**Exits Executed:**\n"
        for a in actions_taken:
            discord_msg += f"  • {a}\n"
    else:
        discord_msg += "\nNo exit conditions triggered. All positions holding."

    send_discord(discord_msg)

    print("\nDone.")


if __name__ == "__main__":
    main()
