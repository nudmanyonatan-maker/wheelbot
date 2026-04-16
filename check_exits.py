"""WheelBot Exit Checker — scan all open positions and execute exits per rules.

EXIT RULES:
  - 50% profit  → close with LIMIT order at the ask
  - 2x loss     → close with MARKET order (stop loss)
  - DTE < 5     → close regardless (MARKET order)
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

# ── Credentials ───────────────────────────────────────────────────────────────
API_KEY = "PK7SQLLS75HIWHTJACSBJO2IK3"
SECRET_KEY = "A2MwvqDHeeVh5VKQKDu2F7TqLV5PhDyqBCWRa56KdUAf"
DISCORD_WEBHOOK = "https://discord.com/api/webhooks/1492021042594713701/QEPCp-r13dpTDl0DSZOjoaRSxlzXr3PHN83p_sYludu4c325GCGhzYHkB5BCrpFQcHh7"

# ── Exit thresholds ───────────────────────────────────────────────────────────
PROFIT_TARGET_PCT = 0.50   # 50% of credit received
STOP_LOSS_MULT = 2.0       # 2x the credit received
DTE_CLOSE_THRESHOLD = 5    # Close if < 5 DTE


def parse_option_symbol(symbol: str):
    """Parse OCC option symbol into components.

    Format: UNDERLYING(padded to 6) + YYMMDD + C/P + strike*1000 (8 digits)
    Example: SOFI  260417P00013000
    """
    # Strip whitespace within symbol (Alpaca may pad underlying)
    clean = symbol.strip()

    # OCC format: up to 6-char underlying + 6 date + 1 type + 8 strike
    # Match: word chars (underlying), then 6 digits (date), C/P, 8 digits (strike)
    m = re.match(r'^([A-Z]+)\s*(\d{6})([CP])(\d{8})$', clean)
    if not m:
        return None

    underlying = m.group(1).strip()
    date_str = m.group(2)       # YYMMDD
    opt_type = "call" if m.group(3) == "C" else "put"
    strike = int(m.group(4)) / 1000.0

    exp_date = datetime.strptime(date_str, "%y%m%d").date()

    return {
        "underlying": underlying,
        "expiration": exp_date,
        "option_type": opt_type,
        "strike": strike,
    }


def send_discord(message: str):
    """Send a message to the Discord webhook."""
    try:
        resp = requests.post(DISCORD_WEBHOOK, json={"content": message}, timeout=10)
        if resp.status_code in (200, 204):
            print(f"[Discord] Sent notification")
        else:
            print(f"[Discord] Failed: {resp.status_code} {resp.text}")
    except Exception as e:
        print(f"[Discord] Error: {e}")


def main():
    print("=" * 60)
    print("WheelBot Exit Checker")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    # ── Connect ───────────────────────────────────────────────────────────
    trading = TradingClient(API_KEY, SECRET_KEY, paper=True)
    option_data = OptionHistoricalDataClient(API_KEY, SECRET_KEY)

    # ── Account info ──────────────────────────────────────────────────────
    acct = trading.get_account()
    print(f"\nAccount: Portfolio ${float(acct.portfolio_value):,.2f} | "
          f"Cash ${float(acct.cash):,.2f} | "
          f"Buying Power ${float(acct.buying_power):,.2f}")

    # ── Get all positions ─────────────────────────────────────────────────
    positions = trading.get_all_positions()

    stock_positions = []
    option_positions = []

    for pos in positions:
        if pos.asset_class == AssetClass.US_OPTION:
            option_positions.append(pos)
        elif pos.asset_class == AssetClass.US_EQUITY:
            stock_positions.append(pos)

    print(f"\nOpen positions: {len(stock_positions)} stocks, {len(option_positions)} options")

    # ── Report stock positions ────────────────────────────────────────────
    if stock_positions:
        print("\n── Stock Positions ─────────────────────────────────────────")
        for pos in stock_positions:
            print(f"  {pos.symbol}: {pos.qty} shares @ ${float(pos.avg_entry_price):.2f} "
                  f"| Current ${float(pos.current_price):.2f} "
                  f"| P/L ${float(pos.unrealized_pl):.2f} ({float(pos.unrealized_plpc)*100:.1f}%)")

    # ── Check option positions against exit rules ─────────────────────────
    if not option_positions:
        msg = "No open option positions. Nothing to check."
        print(f"\n{msg}")
        send_discord(f"🤖 **WheelBot Exit Check** — {msg}")
        return

    print("\n── Option Positions ────────────────────────────────────────")

    today = date.today()
    actions_taken = []
    positions_checked = []

    # Get quotes for all option positions
    option_symbols = [pos.symbol for pos in option_positions]
    quotes = {}
    try:
        if option_symbols:
            quote_req = OptionLatestQuoteRequest(symbol_or_symbols=option_symbols)
            quotes = option_data.get_option_latest_quote(quote_req)
    except Exception as e:
        print(f"  [WARN] Could not fetch option quotes: {e}")

    for pos in option_positions:
        symbol = pos.symbol
        qty = int(float(pos.qty))
        avg_price = float(pos.avg_entry_price)
        current_price = float(pos.current_price)
        unrealized_pl = float(pos.unrealized_pl)
        market_value = float(pos.market_value)
        side = str(pos.side)  # "long" or "short"

        parsed = parse_option_symbol(symbol)

        # Get live quote
        quote = quotes.get(symbol)
        bid = float(quote.bid_price) if quote and quote.bid_price else 0.0
        ask = float(quote.ask_price) if quote and quote.ask_price else 0.0
        mid = (bid + ask) / 2 if (bid + ask) > 0 else current_price

        # Calculate DTE
        if parsed:
            dte = (parsed["expiration"] - today).days
            underlying = parsed["underlying"]
            strike = parsed["strike"]
            opt_type = parsed["option_type"]
            exp_str = parsed["expiration"].strftime("%Y-%m-%d")
        else:
            dte = 999  # Can't parse, don't trigger DTE rule
            underlying = symbol
            strike = 0
            opt_type = "?"
            exp_str = "?"

        # For short options (sold to open):
        #   - We RECEIVED premium (avg_price is what we got)
        #   - Current price going DOWN = profit (we can buy back cheaper)
        #   - Profit = (avg_price - current_price) * |qty| * 100
        #   - 50% profit means current price <= 50% of avg_price
        #   - 2x loss means current price >= 3x avg_price (we lost 2x what we received)
        #
        # For long options (bought to open):
        #   - We PAID premium (avg_price is what we paid)
        #   - Current price going UP = profit
        #   - Standard P/L applies

        is_short = qty < 0 or side == "short"
        abs_qty = abs(qty)

        print(f"\n  {symbol}")
        print(f"    {'Short' if is_short else 'Long'} {abs_qty}x | Avg ${avg_price:.2f} | "
              f"Current ${current_price:.2f} | Bid ${bid:.2f} / Ask ${ask:.2f}")
        if parsed:
            print(f"    {underlying} {strike} {opt_type} exp {exp_str} | DTE: {dte}")
        print(f"    Unrealized P/L: ${unrealized_pl:.2f}")

        exit_reason = None
        order_type = None
        close_price = None

        if is_short:
            # Short option: we sold at avg_price, buy back at current
            credit_received = avg_price
            cost_to_close = mid  # use mid for evaluation

            profit_pct = (credit_received - cost_to_close) / credit_received if credit_received > 0 else 0
            loss_amount = cost_to_close - credit_received
            loss_multiple = loss_amount / credit_received if credit_received > 0 else 0

            print(f"    Credit received: ${credit_received:.2f} | Cost to close: ${cost_to_close:.2f}")
            print(f"    Profit %: {profit_pct*100:.1f}% | Loss multiple: {loss_multiple:.1f}x")

            # Rule 1: 50% profit → close with limit at ask
            if profit_pct >= PROFIT_TARGET_PCT:
                exit_reason = f"50% PROFIT TARGET (profit {profit_pct*100:.0f}%)"
                order_type = "limit"
                close_price = ask  # buy back at ask for guaranteed fill

            # Rule 2: 2x loss → close with MARKET (takes priority over profit)
            if loss_multiple >= STOP_LOSS_MULT:
                exit_reason = f"STOP LOSS 2x (loss {loss_multiple:.1f}x credit)"
                order_type = "market"
                close_price = 0  # market order

            # Rule 3: DTE < 5 → close regardless
            if dte < DTE_CLOSE_THRESHOLD:
                exit_reason = f"DTE < 5 (DTE={dte})"
                # Use market for urgency if also a loss, limit if profitable
                if loss_multiple >= STOP_LOSS_MULT:
                    order_type = "market"
                    close_price = 0
                else:
                    order_type = "market"  # DTE rule = urgent, use market
                    close_price = 0

        else:
            # Long option: we bought at avg_price
            profit_pct = (current_price - avg_price) / avg_price if avg_price > 0 else 0
            loss_pct = (avg_price - current_price) / avg_price if avg_price > 0 else 0

            print(f"    Paid: ${avg_price:.2f} | Current value: ${current_price:.2f}")
            print(f"    Return: {profit_pct*100:.1f}%")

            # Rule 1: 50% profit → close with limit at bid
            if profit_pct >= PROFIT_TARGET_PCT:
                exit_reason = f"50% PROFIT TARGET (return {profit_pct*100:.0f}%)"
                order_type = "limit"
                close_price = bid  # sell at bid for guaranteed fill

            # Rule 2: loss exceeds 2x original premium (lost > 100% for long = N/A,
            # but interpret as: if value dropped to < 1/(1+2) = 33% of entry)
            # Actually for long options, 2x loss means we lost 2x what we paid.
            # Max loss on a long option is 100%, so this rule mostly applies to shorts.
            # For longs, we'll check DTE only.

            # Rule 3: DTE < 5 → close regardless
            if dte < DTE_CLOSE_THRESHOLD:
                exit_reason = f"DTE < 5 (DTE={dte})"
                order_type = "market"
                close_price = 0

        # ── Execute exit if triggered ─────────────────────────────────────
        if exit_reason:
            print(f"    *** EXIT TRIGGERED: {exit_reason} ***")
            print(f"    Order type: {order_type.upper()}")

            try:
                if is_short:
                    # Buy to close
                    if order_type == "market":
                        request = MarketOrderRequest(
                            symbol=symbol,
                            qty=abs_qty,
                            side=OrderSide.BUY,
                            type=OrderType.MARKET,
                            time_in_force=TimeInForce.DAY,
                        )
                    else:
                        request = LimitOrderRequest(
                            symbol=symbol,
                            qty=abs_qty,
                            side=OrderSide.BUY,
                            type=OrderType.LIMIT,
                            time_in_force=TimeInForce.DAY,
                            limit_price=close_price,
                        )
                else:
                    # Sell to close
                    if order_type == "market":
                        request = MarketOrderRequest(
                            symbol=symbol,
                            qty=abs_qty,
                            side=OrderSide.SELL,
                            type=OrderType.MARKET,
                            time_in_force=TimeInForce.DAY,
                        )
                    else:
                        request = LimitOrderRequest(
                            symbol=symbol,
                            qty=abs_qty,
                            side=OrderSide.SELL,
                            type=OrderType.LIMIT,
                            time_in_force=TimeInForce.DAY,
                            limit_price=close_price,
                        )

                order = trading.submit_order(order_data=request)
                action_msg = (
                    f"{'BUY' if is_short else 'SELL'} to close {abs_qty}x {symbol} | "
                    f"Reason: {exit_reason} | "
                    f"Order: {order_type.upper()} "
                    f"{'@ $' + f'{close_price:.2f}' if order_type == 'limit' else ''} | "
                    f"ID: {order.id} | Status: {order.status}"
                )
                print(f"    ✓ Order placed: {action_msg}")
                actions_taken.append(action_msg)

            except Exception as e:
                err_msg = f"FAILED to close {symbol}: {e}"
                print(f"    ✗ {err_msg}")
                actions_taken.append(f"ERROR: {err_msg}")
        else:
            print(f"    → No exit triggered. Holding.")
            positions_checked.append(
                f"{symbol} ({'Short' if is_short else 'Long'} {abs_qty}x, "
                f"DTE={dte}, P/L ${unrealized_pl:.2f}) — holding"
            )

    # ── Summary ───────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Positions checked: {len(option_positions)}")
    print(f"Exits executed: {len(actions_taken)}")

    # ── Discord notification ──────────────────────────────────────────────
    discord_lines = [
        f"🤖 **WheelBot Exit Check** — {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"Portfolio: ${float(acct.portfolio_value):,.2f} | Cash: ${float(acct.cash):,.2f}",
        f"Positions checked: {len(option_positions)} options, {len(stock_positions)} stocks",
        "",
    ]

    if actions_taken:
        discord_lines.append("🚨 **EXITS EXECUTED:**")
        for action in actions_taken:
            discord_lines.append(f"  • {action}")
    else:
        discord_lines.append("✅ All positions within bounds — no exits needed.")

    if positions_checked:
        discord_lines.append("")
        discord_lines.append("📊 **Holding:**")
        for p in positions_checked:
            discord_lines.append(f"  • {p}")

    discord_msg = "\n".join(discord_lines)

    # Discord has a 2000 char limit
    if len(discord_msg) > 1990:
        discord_msg = discord_msg[:1990] + "..."

    send_discord(discord_msg)
    print(f"\nDone.")


if __name__ == "__main__":
    main()
