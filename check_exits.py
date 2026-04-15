"""WheelBot Exit Checker — standalone script to check open positions against exit rules.

Connects to Alpaca paper trading, fetches all positions, gets current quotes,
evaluates exit conditions, executes exits, and sends Discord notifications.

EXIT RULES:
  - 50% profit  → close with LIMIT order at ask price
  - 2x loss     → close with MARKET order (stop loss)
  - DTE < 5     → close regardless (gamma risk)
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

PROFIT_TARGET_PCT = 0.50   # 50% profit → close
STOP_LOSS_MULT = 2.0       # 2x loss → close
DTE_THRESHOLD = 5          # DTE < 5 → close


def send_discord(content: str) -> None:
    """Send a message to the Discord webhook."""
    try:
        resp = requests.post(
            DISCORD_WEBHOOK,
            json={"content": content},
            timeout=10,
        )
        if resp.status_code not in (200, 204):
            print(f"  [Discord] Warning: status {resp.status_code}")
    except Exception as e:
        print(f"  [Discord] Failed to send: {e}")


def parse_option_symbol(symbol: str) -> dict | None:
    """Parse OCC option symbol into components.

    Format: SYMBOL  YYMMDD C/P STRIKE*1000
    Example: SOFI  250516P00012000  →  SOFI, 2025-05-16, put, $12.00
    The underlying symbol is left-padded to 6 chars with spaces.
    """
    # OCC format: up to 6 char symbol, then 6 digit date, then C/P, then 8 digit strike
    match = re.match(r'^(.{1,6}?)\s*(\d{6})([CP])(\d{8})$', symbol)
    if not match:
        return None

    underlying = match.group(1).strip()
    date_str = match.group(2)
    opt_type = "call" if match.group(3) == "C" else "put"
    strike = int(match.group(4)) / 1000.0

    exp_date = datetime.strptime(date_str, "%y%m%d").strftime("%Y-%m-%d")
    return {
        "underlying": underlying,
        "expiration": exp_date,
        "option_type": opt_type,
        "strike": strike,
    }


def calc_dte(expiration: str) -> int:
    """Calculate days to expiration from a YYYY-MM-DD string."""
    exp = datetime.strptime(expiration, "%Y-%m-%d").date()
    today = datetime.now(timezone.utc).date()
    return (exp - today).days


def main() -> None:
    print("=" * 60)
    print("WheelBot Exit Checker")
    print("=" * 60)

    # ── Connect ───────────────────────────────────────────────────────────
    print("\n[1] Connecting to Alpaca (paper)...")
    trading = TradingClient(API_KEY, SECRET_KEY, paper=True)
    option_data = OptionHistoricalDataClient(API_KEY, SECRET_KEY)

    acct = trading.get_account()
    print(f"    Account connected — equity: ${float(acct.equity):,.2f}, "
          f"buying power: ${float(acct.buying_power):,.2f}")

    # ── Get all positions ─────────────────────────────────────────────────
    print("\n[2] Fetching all positions...")
    all_positions = trading.get_all_positions()

    if not all_positions:
        msg = "No open positions found. Nothing to check."
        print(f"    {msg}")
        send_discord(f"**WheelBot Exit Check** — {msg}")
        return

    stock_positions = []
    option_positions = []

    for pos in all_positions:
        if pos.asset_class == AssetClass.US_OPTION:
            option_positions.append(pos)
        else:
            stock_positions.append(pos)

    print(f"    Found {len(stock_positions)} stock position(s), "
          f"{len(option_positions)} option position(s)")

    # Report stock positions (no exit rules apply to stocks here)
    for sp in stock_positions:
        pl = float(sp.unrealized_pl)
        plpc = float(sp.unrealized_plpc) * 100
        print(f"    STOCK: {sp.symbol} | qty: {sp.qty} | "
              f"entry: ${float(sp.avg_entry_price):.2f} | "
              f"current: ${float(sp.current_price):.2f} | "
              f"P&L: ${pl:+,.2f} ({plpc:+.1f}%)")

    if not option_positions:
        msg = (f"No option positions open. "
               f"{len(stock_positions)} stock position(s) only — no exit rules apply.")
        print(f"\n    {msg}")
        send_discord(f"**WheelBot Exit Check** — {msg}")
        return

    # ── Get current quotes for all options ────────────────────────────────
    print("\n[3] Fetching current quotes for option positions...")
    option_symbols = [pos.symbol for pos in option_positions]

    quotes = {}
    try:
        req = OptionLatestQuoteRequest(symbol_or_symbols=option_symbols)
        quotes = option_data.get_option_latest_quote(req)
    except Exception as e:
        print(f"    Warning: bulk quote fetch failed: {e}")
        # Try one by one as fallback
        for sym in option_symbols:
            try:
                req = OptionLatestQuoteRequest(symbol_or_symbols=[sym])
                q = option_data.get_option_latest_quote(req)
                quotes.update(q)
            except Exception:
                pass

    # ── Evaluate exit conditions ──────────────────────────────────────────
    print("\n[4] Evaluating exit conditions...")
    actions_taken = []
    position_reports = []

    for pos in option_positions:
        symbol = pos.symbol
        qty = int(float(pos.qty))
        entry_price = float(pos.avg_entry_price)
        current_price = float(pos.current_price) if pos.current_price else None
        side = str(pos.side)  # "long" or "short"
        unrealized_pl = float(pos.unrealized_pl)

        parsed = parse_option_symbol(symbol)
        underlying = parsed["underlying"] if parsed else symbol[:6].strip()
        expiration = parsed["expiration"] if parsed else None
        opt_type = parsed["option_type"] if parsed else "?"
        strike = parsed["strike"] if parsed else 0.0

        # Get live quote
        quote = quotes.get(symbol)
        bid = float(quote.bid_price) if quote and quote.bid_price else 0.0
        ask = float(quote.ask_price) if quote and quote.ask_price else 0.0
        mid = (bid + ask) / 2 if (bid + ask) > 0 else current_price or 0.0

        # Use mid as the current market price for evaluation
        if mid > 0:
            current_price = mid

        # Calculate DTE
        days_to_exp = calc_dte(expiration) if expiration else 999

        # Determine P&L for short options:
        #   Short option: sold at entry_price, now worth current_price
        #   Profit = (entry_price - current_price) * qty * 100
        #   Loss = (current_price - entry_price) * qty * 100
        is_short = qty < 0
        abs_qty = abs(qty)

        if is_short:
            # Short option: we sold it, profit when price drops
            pnl_per_contract = (entry_price - current_price) if current_price else 0
            profit_pct = pnl_per_contract / entry_price if entry_price > 0 else 0
        else:
            # Long option: we bought it, profit when price rises
            pnl_per_contract = (current_price - entry_price) if current_price else 0
            profit_pct = pnl_per_contract / entry_price if entry_price > 0 else 0

        total_pnl = pnl_per_contract * abs_qty * 100

        status_line = (
            f"    {underlying} {strike:.0f}{opt_type[0].upper()} "
            f"{expiration or '?'} | "
            f"qty: {qty} | entry: ${entry_price:.2f} | "
            f"bid: ${bid:.2f} / ask: ${ask:.2f} | "
            f"P&L: ${total_pnl:+,.2f} ({profit_pct:+.1%}) | "
            f"DTE: {days_to_exp}"
        )
        print(status_line)

        # ── Check exit rules ──────────────────────────────────────────────
        exit_reason = None
        order_type = None

        # Rule 1: 50% profit target
        if profit_pct >= PROFIT_TARGET_PCT:
            exit_reason = f"PROFIT TARGET: {profit_pct:.1%} >= {PROFIT_TARGET_PCT:.0%}"
            order_type = "limit"

        # Rule 2: 2x loss (stop loss)
        elif profit_pct <= -1.0:
            # For short options: loss = current_price / entry_price >= STOP_LOSS_MULT
            # For long options: loss = (entry - current) / entry >= (1 - 1/STOP_LOSS_MULT)
            if is_short and current_price and current_price >= entry_price * STOP_LOSS_MULT:
                exit_reason = (f"STOP LOSS: current ${current_price:.2f} >= "
                               f"{STOP_LOSS_MULT}x entry ${entry_price * STOP_LOSS_MULT:.2f}")
                order_type = "market"
            elif not is_short and profit_pct <= -(STOP_LOSS_MULT - 1):
                exit_reason = f"STOP LOSS: loss {profit_pct:.1%} exceeds {-(STOP_LOSS_MULT-1):.0%}"
                order_type = "market"

        # Rule 3: DTE < 5 (gamma risk)
        if not exit_reason and days_to_exp < DTE_THRESHOLD:
            exit_reason = f"DTE EXPIRY: {days_to_exp} days < {DTE_THRESHOLD} threshold"
            order_type = "market"  # Urgent — use market to guarantee fill

        if exit_reason:
            print(f"      *** EXIT TRIGGERED: {exit_reason}")

            # Determine order side: close the position
            if is_short:
                close_side = OrderSide.BUY   # Buy to close short
            else:
                close_side = OrderSide.SELL   # Sell to close long

            # Place the order
            try:
                if order_type == "limit":
                    # Use ask for buy-to-close (guarantees fill), bid for sell-to-close
                    if close_side == OrderSide.BUY:
                        limit_price = ask if ask > 0 else (current_price or 0.01)
                    else:
                        limit_price = bid if bid > 0 else (current_price or 0.01)

                    # Round to 2 decimal places
                    limit_price = round(limit_price, 2)

                    request = LimitOrderRequest(
                        symbol=symbol,
                        qty=abs_qty,
                        side=close_side,
                        type=OrderType.LIMIT,
                        time_in_force=TimeInForce.DAY,
                        limit_price=limit_price,
                    )
                    order = trading.submit_order(request)
                    action_msg = (
                        f"LIMIT {close_side.value} {abs_qty}x {underlying} "
                        f"{strike:.0f}{opt_type[0].upper()} {expiration} "
                        f"@ ${limit_price:.2f} — {exit_reason}"
                    )
                else:
                    request = MarketOrderRequest(
                        symbol=symbol,
                        qty=abs_qty,
                        side=close_side,
                        type=OrderType.MARKET,
                        time_in_force=TimeInForce.DAY,
                    )
                    order = trading.submit_order(request)
                    action_msg = (
                        f"MARKET {close_side.value} {abs_qty}x {underlying} "
                        f"{strike:.0f}{opt_type[0].upper()} {expiration} "
                        f"— {exit_reason}"
                    )

                order_id = str(order.id)
                order_status = str(order.status)
                print(f"      Order placed: {action_msg} (ID: {order_id}, status: {order_status})")
                actions_taken.append(action_msg)

            except Exception as e:
                err_msg = f"FAILED to close {underlying} {strike:.0f}{opt_type[0].upper()}: {e}"
                print(f"      ERROR: {err_msg}")
                actions_taken.append(f"[FAILED] {err_msg}")
        else:
            print(f"      No exit triggered — position OK")

        position_reports.append({
            "symbol": f"{underlying} {strike:.0f}{opt_type[0].upper()} {expiration}",
            "qty": qty,
            "entry": entry_price,
            "current": current_price,
            "pnl": total_pnl,
            "pnl_pct": profit_pct,
            "dte": days_to_exp,
            "action": exit_reason or "HOLD",
        })

    # ── Discord notification ──────────────────────────────────────────────
    print("\n[5] Sending Discord notification...")

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"**WheelBot Exit Check** — {timestamp}"]
    lines.append(f"Account equity: ${float(acct.equity):,.2f}")
    lines.append("")

    if position_reports:
        lines.append(f"**{len(option_positions)} Option Position(s):**")
        for rpt in position_reports:
            emoji = ""
            if "HOLD" not in rpt["action"]:
                emoji = "🚨 "
            lines.append(
                f"{emoji}`{rpt['symbol']}` qty:{rpt['qty']} | "
                f"entry:${rpt['entry']:.2f} now:${rpt['current']:.2f} | "
                f"P&L: ${rpt['pnl']:+,.2f} ({rpt['pnl_pct']:+.1%}) | "
                f"DTE:{rpt['dte']} | **{rpt['action']}**"
            )

    if stock_positions:
        lines.append("")
        lines.append(f"**{len(stock_positions)} Stock Position(s):**")
        for sp in stock_positions:
            pl = float(sp.unrealized_pl)
            plpc = float(sp.unrealized_plpc) * 100
            lines.append(
                f"`{sp.symbol}` qty:{sp.qty} | "
                f"entry:${float(sp.avg_entry_price):.2f} now:${float(sp.current_price):.2f} | "
                f"P&L: ${pl:+,.2f} ({plpc:+.1f}%)"
            )

    if actions_taken:
        lines.append("")
        lines.append(f"**{len(actions_taken)} Exit(s) Executed:**")
        for act in actions_taken:
            lines.append(f"→ {act}")
    else:
        lines.append("")
        lines.append("No exits triggered — all positions within thresholds.")

    discord_msg = "\n".join(lines)

    # Discord has a 2000 char limit — truncate if needed
    if len(discord_msg) > 1990:
        discord_msg = discord_msg[:1987] + "..."

    send_discord(discord_msg)

    # ── Summary ───────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Positions checked: {len(option_positions)} options, {len(stock_positions)} stocks")
    print(f"  Exits executed:    {len(actions_taken)}")
    if actions_taken:
        for act in actions_taken:
            print(f"    → {act}")
    else:
        print("  All positions within thresholds — no action needed.")
    print("=" * 60)


if __name__ == "__main__":
    main()
