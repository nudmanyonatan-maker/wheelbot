"""WheelBot — Check open positions against exit rules and execute exits.

Exit rules:
  - 50% profit  -> close via LIMIT order at ask price
  - 2x loss     -> close via MARKET order (urgent)
  - DTE < 5     -> close regardless via MARKET order
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

# ── Credentials ───────────────────────────────────────────────────────────────

API_KEY = "PK7SQLLS75HIWHTJACSBJO2IK3"
SECRET_KEY = "A2MwvqDHeeVh5VKQKDu2F7TqLV5PhDyqBCWRa56KdUAf"
DISCORD_WEBHOOK = (
    "https://discord.com/api/webhooks/1492021042594713701/"
    "QEPCp-r13dpTDl0DSZOjoaRSxlzXr3PHN83p_sYludu4c325GCGhzYHkB5BCrpFQcHh7"
)

# ── Exit thresholds ───────────────────────────────────────────────────────────

PROFIT_TARGET_PCT = 0.50   # 50% profit -> close
STOP_LOSS_MULTIPLIER = 2.0 # 2x loss -> close
DTE_CLOSE_THRESHOLD = 5    # DTE < 5 -> close regardless

# ── Clients ───────────────────────────────────────────────────────────────────

trading = TradingClient(API_KEY, SECRET_KEY, paper=True)
option_data = OptionHistoricalDataClient(API_KEY, SECRET_KEY)


def send_discord(message: str) -> bool:
    """Send a message to the Discord webhook."""
    try:
        resp = requests.post(
            DISCORD_WEBHOOK,
            json={"content": message},
            timeout=10,
        )
        return resp.status_code in (200, 204)
    except Exception as e:
        print(f"  [!] Discord webhook failed: {e}")
        return False


def send_discord_embed(title: str, description: str, color: int = 0x00FF00) -> bool:
    """Send a rich embed to the Discord webhook."""
    try:
        resp = requests.post(
            DISCORD_WEBHOOK,
            json={"embeds": [{"title": title, "description": description, "color": color}]},
            timeout=10,
        )
        return resp.status_code in (200, 204)
    except Exception as e:
        print(f"  [!] Discord webhook failed: {e}")
        return False


def parse_option_symbol(symbol: str) -> dict | None:
    """Parse OCC option symbol into components.

    Format: UNDERLYING(padded to 6) + YYMMDD + C/P + strike*1000(8 digits)
    Example: SOFI  250516P00012000
    """
    # Strip whitespace from the symbol for matching
    clean = symbol.strip()
    # OCC symbols: underlying (variable length) + YYMMDD + C/P + 8-digit strike
    # Alpaca may or may not pad underlying to 6 chars
    m = re.match(r'^([A-Z]+)\s*(\d{6})([CP])(\d{8})$', clean)
    if not m:
        return None

    underlying = m.group(1).strip()
    date_str = m.group(2)
    opt_type = "call" if m.group(3) == "C" else "put"
    strike = int(m.group(4)) / 1000.0

    exp_date = datetime.strptime(date_str, "%y%m%d").date()

    return {
        "underlying": underlying,
        "expiration": exp_date,
        "option_type": opt_type,
        "strike": strike,
    }


def compute_dte(expiration: date) -> int:
    """Days to expiration from today."""
    return (expiration - date.today()).days


def get_option_quote(symbol: str) -> dict | None:
    """Get latest bid/ask/mark for an option symbol."""
    try:
        req = OptionLatestQuoteRequest(symbol_or_symbols=[symbol])
        quotes = option_data.get_option_latest_quote(req)
        q = quotes.get(symbol)
        if not q:
            return None
        bid = float(q.bid_price) if q.bid_price else 0.0
        ask = float(q.ask_price) if q.ask_price else 0.0
        mark = (bid + ask) / 2 if (bid + ask) > 0 else 0.0
        return {"bid": bid, "ask": ask, "mark": mark}
    except Exception as e:
        print(f"  [!] Quote fetch failed for {symbol}: {e}")
        return None


def close_limit(symbol: str, qty: int, price: float) -> str:
    """Buy to close via limit order. Returns order ID or error string."""
    try:
        order = trading.submit_order(LimitOrderRequest(
            symbol=symbol,
            qty=abs(qty),
            side=OrderSide.BUY,
            type=OrderType.LIMIT,
            time_in_force=TimeInForce.DAY,
            limit_price=round(price, 2),
        ))
        return str(order.id)
    except Exception as e:
        return f"ERROR: {e}"


def close_market(symbol: str, qty: int) -> str:
    """Buy to close via market order (for stop losses / urgent). Returns order ID or error."""
    try:
        order = trading.submit_order(MarketOrderRequest(
            symbol=symbol,
            qty=abs(qty),
            side=OrderSide.BUY,
            type=OrderType.MARKET,
            time_in_force=TimeInForce.DAY,
        ))
        return str(order.id)
    except Exception as e:
        return f"ERROR: {e}"


def main():
    print("=" * 60)
    print("WheelBot — Position Exit Check")
    print("=" * 60)

    # ── 1. Connect & get account info ─────────────────────────────────────
    try:
        acct = trading.get_account()
        print(f"\nAccount: paper={True}")
        print(f"  Portfolio value: ${float(acct.portfolio_value):,.2f}")
        print(f"  Buying power:    ${float(acct.buying_power):,.2f}")
        print(f"  Cash:            ${float(acct.cash):,.2f}")
    except Exception as e:
        print(f"FATAL: Cannot connect to Alpaca: {e}")
        sys.exit(1)

    # ── 2. Get all positions ──────────────────────────────────────────────
    try:
        all_positions = trading.get_all_positions()
    except Exception as e:
        print(f"FATAL: Cannot fetch positions: {e}")
        sys.exit(1)

    if not all_positions:
        msg = "No open positions found."
        print(f"\n{msg}")
        send_discord(f"**WheelBot Check** — {msg}")
        return

    # Separate stock vs option positions
    stock_positions = []
    option_positions = []
    for pos in all_positions:
        if pos.asset_class == AssetClass.US_OPTION:
            option_positions.append(pos)
        else:
            stock_positions.append(pos)

    print(f"\nOpen positions: {len(all_positions)} total "
          f"({len(stock_positions)} stock, {len(option_positions)} option)")

    # ── 3. Report stock positions ─────────────────────────────────────────
    if stock_positions:
        print("\n--- Stock Positions ---")
        for pos in stock_positions:
            qty = int(float(pos.qty))
            entry = float(pos.avg_entry_price)
            current = float(pos.current_price)
            pl = float(pos.unrealized_pl)
            pct = float(pos.unrealized_plpc) * 100
            print(f"  {pos.symbol}: {qty} shares @ ${entry:.2f} "
                  f"| now ${current:.2f} | P&L: ${pl:+.2f} ({pct:+.1f}%)")

    # ── 4. Check option positions against exit rules ──────────────────────
    actions_taken = []

    if option_positions:
        print("\n--- Option Positions ---")
        for pos in option_positions:
            symbol = pos.symbol
            qty = int(float(pos.qty))
            entry_price = float(pos.avg_entry_price)
            current_price = float(pos.current_price) if pos.current_price else None
            side = str(pos.side)

            parsed = parse_option_symbol(symbol)
            underlying = parsed["underlying"] if parsed else "???"
            exp_date = parsed["expiration"] if parsed else None
            opt_type = parsed["option_type"] if parsed else "?"
            strike = parsed["strike"] if parsed else 0.0
            days_to_exp = compute_dte(exp_date) if exp_date else None

            # Get fresh quote
            quote = get_option_quote(symbol)
            if quote:
                bid = quote["bid"]
                ask = quote["ask"]
                mark = quote["mark"]
            else:
                bid = ask = mark = current_price or 0.0

            # For short options: profit = entry - current, loss = current - entry
            is_short = qty < 0

            print(f"\n  {symbol}")
            print(f"    Underlying: {underlying} | {opt_type.upper()} ${strike:.2f}"
                  f" | Exp: {exp_date} (DTE: {days_to_exp})")
            print(f"    Qty: {qty} | Entry: ${entry_price:.2f}"
                  f" | Bid: ${bid:.2f} / Ask: ${ask:.2f} / Mark: ${mark:.2f}")

            if is_short:
                # Short option P&L: sold at entry_price, cost to close = mark
                profit_pct = (entry_price - mark) / entry_price if entry_price > 0 else 0
                pnl_dollars = (entry_price - mark) * abs(qty) * 100
                print(f"    P&L: ${pnl_dollars:+.2f} ({profit_pct:+.1%})")

                # ── EXIT RULE 1: 50% profit target -> LIMIT at ask ────────
                if profit_pct >= PROFIT_TARGET_PCT:
                    close_price = ask  # buy at the ask for limit order
                    print(f"    >>> 50% PROFIT TARGET HIT ({profit_pct:.1%}) — closing with LIMIT @ ${close_price:.2f}")
                    order_id = close_limit(symbol, abs(qty), close_price)
                    action = (f"PROFIT EXIT: {underlying} {opt_type.upper()} ${strike:.2f} "
                              f"exp {exp_date} | {profit_pct:.0%} profit | "
                              f"LIMIT @ ${close_price:.2f} | Order: {order_id}")
                    actions_taken.append(action)
                    print(f"    Order ID: {order_id}")
                    continue

                # ── EXIT RULE 2: 2x loss -> MARKET order ─────────────────
                stop_price = entry_price * STOP_LOSS_MULTIPLIER
                if mark >= stop_price:
                    print(f"    >>> STOP LOSS HIT (mark ${mark:.2f} >= {STOP_LOSS_MULTIPLIER}x entry ${stop_price:.2f})"
                          f" — closing with MARKET order")
                    order_id = close_market(symbol, abs(qty))
                    action = (f"STOP LOSS: {underlying} {opt_type.upper()} ${strike:.2f} "
                              f"exp {exp_date} | mark ${mark:.2f} >= 2x entry ${stop_price:.2f} | "
                              f"MARKET order | Order: {order_id}")
                    actions_taken.append(action)
                    print(f"    Order ID: {order_id}")
                    continue

                # ── EXIT RULE 3: DTE < 5 -> close regardless ─────────────
                if days_to_exp is not None and days_to_exp < DTE_CLOSE_THRESHOLD:
                    # DTE < 5 is gamma risk — use market order for certainty
                    print(f"    >>> DTE < {DTE_CLOSE_THRESHOLD} ({days_to_exp} days left)"
                          f" — closing with MARKET order")
                    order_id = close_market(symbol, abs(qty))
                    action = (f"DTE EXIT: {underlying} {opt_type.upper()} ${strike:.2f} "
                              f"exp {exp_date} | DTE={days_to_exp} | "
                              f"MARKET order | Order: {order_id}")
                    actions_taken.append(action)
                    print(f"    Order ID: {order_id}")
                    continue

                print(f"    No exit triggered. Holding.")

            else:
                # Long option — simpler P&L
                pnl_dollars = (mark - entry_price) * abs(qty) * 100
                profit_pct = (mark - entry_price) / entry_price if entry_price > 0 else 0
                print(f"    P&L: ${pnl_dollars:+.2f} ({profit_pct:+.1%})")

                # For long options: profit target at 50% gain
                if profit_pct >= PROFIT_TARGET_PCT:
                    close_price = bid  # sell at bid for long positions
                    print(f"    >>> 50% PROFIT TARGET HIT ({profit_pct:.1%}) — closing with LIMIT @ ${close_price:.2f}")
                    # Sell to close for long options
                    try:
                        order = trading.submit_order(LimitOrderRequest(
                            symbol=symbol,
                            qty=abs(qty),
                            side=OrderSide.SELL,
                            type=OrderType.LIMIT,
                            time_in_force=TimeInForce.DAY,
                            limit_price=round(close_price, 2),
                        ))
                        order_id = str(order.id)
                    except Exception as e:
                        order_id = f"ERROR: {e}"
                    action = (f"PROFIT EXIT (long): {underlying} {opt_type.upper()} ${strike:.2f} "
                              f"exp {exp_date} | {profit_pct:.0%} profit | "
                              f"LIMIT @ ${close_price:.2f} | Order: {order_id}")
                    actions_taken.append(action)
                    print(f"    Order ID: {order_id}")
                    continue

                # Stop loss for long: lost more than entry * multiplier worth
                if profit_pct <= -(STOP_LOSS_MULTIPLIER - 1):  # -100% = lost 2x
                    print(f"    >>> STOP LOSS HIT ({profit_pct:.1%}) — closing with MARKET order")
                    try:
                        order = trading.submit_order(MarketOrderRequest(
                            symbol=symbol,
                            qty=abs(qty),
                            side=OrderSide.SELL,
                            type=OrderType.MARKET,
                            time_in_force=TimeInForce.DAY,
                        ))
                        order_id = str(order.id)
                    except Exception as e:
                        order_id = f"ERROR: {e}"
                    action = (f"STOP LOSS (long): {underlying} {opt_type.upper()} ${strike:.2f} "
                              f"exp {exp_date} | {profit_pct:.0%} loss | "
                              f"MARKET order | Order: {order_id}")
                    actions_taken.append(action)
                    print(f"    Order ID: {order_id}")
                    continue

                # DTE check for long options too
                if days_to_exp is not None and days_to_exp < DTE_CLOSE_THRESHOLD:
                    print(f"    >>> DTE < {DTE_CLOSE_THRESHOLD} ({days_to_exp} days left) — closing with MARKET order")
                    try:
                        order = trading.submit_order(MarketOrderRequest(
                            symbol=symbol,
                            qty=abs(qty),
                            side=OrderSide.SELL,
                            type=OrderType.MARKET,
                            time_in_force=TimeInForce.DAY,
                        ))
                        order_id = str(order.id)
                    except Exception as e:
                        order_id = f"ERROR: {e}"
                    action = (f"DTE EXIT (long): {underlying} {opt_type.upper()} ${strike:.2f} "
                              f"exp {exp_date} | DTE={days_to_exp} | "
                              f"MARKET order | Order: {order_id}")
                    actions_taken.append(action)
                    print(f"    Order ID: {order_id}")
                    continue

                print(f"    No exit triggered. Holding.")

    # ── 5. Discord notification ───────────────────────────────────────────
    print("\n" + "=" * 60)
    if actions_taken:
        print(f"ACTIONS TAKEN: {len(actions_taken)}")
        lines = [f"**WheelBot Exit Check** — {len(actions_taken)} action(s) executed\n"]
        for i, action in enumerate(actions_taken, 1):
            print(f"  {i}. {action}")
            lines.append(f"{i}. {action}")
        send_discord_embed(
            title="WheelBot — Exits Executed",
            description="\n".join(lines),
            color=0xFF6600,  # Orange for action
        )
    else:
        print("No exits triggered. All positions within thresholds.")
        # Build summary for discord
        summary_lines = [f"**WheelBot Position Check** — {len(all_positions)} position(s), no exits triggered\n"]
        for pos in all_positions:
            sym = pos.symbol
            qty = int(float(pos.qty))
            pl = float(pos.unrealized_pl) if pos.unrealized_pl else 0
            summary_lines.append(f"- `{sym}` qty={qty} P&L=${pl:+.2f}")
        send_discord_embed(
            title="WheelBot — All Clear",
            description="\n".join(summary_lines),
            color=0x00FF00,  # Green
        )

    print("=" * 60)
    print("Done.")


if __name__ == "__main__":
    main()
