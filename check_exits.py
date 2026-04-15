"""WheelBot Exit Checker — standalone script to check open positions against exit rules.

Exit rules:
  - 50% profit  → close with LIMIT order at ask price
  - 2x loss     → close with MARKET order (speed > price)
  - DTE < 5     → close regardless (gamma risk)

Usage: python check_exits.py
"""

import json
import re
from datetime import datetime

import requests
from alpaca.data.historical import OptionHistoricalDataClient
from alpaca.data.requests import OptionLatestQuoteRequest
from alpaca.trading.client import TradingClient
from alpaca.trading.enums import AssetClass, OrderSide, OrderType, TimeInForce
from alpaca.trading.requests import LimitOrderRequest, MarketOrderRequest

# ── Credentials ──────────────────────────────────────────────────────────────

API_KEY = "PK7SQLLS75HIWHTJACSBJO2IK3"
SECRET_KEY = "A2MwvqDHeeVh5VKQKDu2F7TqLV5PhDyqBCWRa56KdUAf"
DISCORD_WEBHOOK = (
    "https://discord.com/api/webhooks/1492021042594713701/"
    "QEPCp-r13dpTDl0DSZOjoaRSxlzXr3PHN83p_sYludu4c325GCGhzYHkB5BCrpFQcHh7"
)

# ── Exit thresholds ──────────────────────────────────────────────────────────

PROFIT_TARGET = 0.50   # 50% of credit captured
STOP_LOSS_MULT = 2.0   # 2x entry price
DTE_THRESHOLD = 5      # days to expiration

# ── Clients ──────────────────────────────────────────────────────────────────

trading = TradingClient(API_KEY, SECRET_KEY, paper=True)
option_data = OptionHistoricalDataClient(API_KEY, SECRET_KEY)


def send_discord(content: str) -> None:
    """Send a message to Discord via webhook."""
    try:
        resp = requests.post(
            DISCORD_WEBHOOK,
            json={"content": content},
            timeout=10,
        )
        resp.raise_for_status()
        print(f"[Discord] Sent notification")
    except Exception as e:
        print(f"[Discord] Failed to send: {e}")


def parse_occ_symbol(symbol: str) -> dict | None:
    """Parse OCC option symbol like 'AAPL  260417P00150000' into components.

    OCC format: SYMBOL(6 chars, right-padded) + YYMMDD + C/P + strike*1000 (8 digits)
    """
    # Strip whitespace and try to match the OCC pattern
    clean = symbol.strip()
    match = re.match(r'^([A-Z]+)\s*(\d{6})([CP])(\d{8})$', clean)
    if not match:
        return None

    underlying = match.group(1)
    date_str = match.group(2)
    opt_type = "call" if match.group(3) == "C" else "put"
    strike = int(match.group(4)) / 1000.0

    # Parse YYMMDD
    exp_date = datetime.strptime(date_str, "%y%m%d").strftime("%Y-%m-%d")

    return {
        "underlying": underlying,
        "expiration": exp_date,
        "option_type": opt_type,
        "strike": strike,
    }


def calc_dte(expiration_str: str) -> int:
    """Calculate days to expiration from YYYY-MM-DD string."""
    exp = datetime.strptime(expiration_str, "%Y-%m-%d").date()
    today = datetime.now().date()
    return (exp - today).days


def get_option_quote(symbol: str) -> dict | None:
    """Get latest bid/ask for an option symbol."""
    try:
        req = OptionLatestQuoteRequest(symbol_or_symbols=[symbol])
        quotes = option_data.get_option_latest_quote(req)
        q = quotes.get(symbol)
        if not q:
            return None
        return {
            "bid": float(q.bid_price) if q.bid_price else 0.0,
            "ask": float(q.ask_price) if q.ask_price else 0.0,
            "mid": (float(q.bid_price or 0) + float(q.ask_price or 0)) / 2,
        }
    except Exception as e:
        print(f"  [!] Failed to get quote for {symbol}: {e}")
        return None


def close_with_limit(symbol: str, qty: int, ask_price: float) -> str:
    """Close position with a limit order at the ask price."""
    try:
        request = LimitOrderRequest(
            symbol=symbol,
            qty=abs(qty),
            side=OrderSide.BUY,
            type=OrderType.LIMIT,
            time_in_force=TimeInForce.DAY,
            limit_price=ask_price,
        )
        order = trading.submit_order(request)
        return f"LIMIT order placed (ID: {order.id}, price: ${ask_price:.2f})"
    except Exception as e:
        return f"LIMIT order FAILED: {e}"


def close_with_market(symbol: str, qty: int) -> str:
    """Close position with a market order (for stop losses)."""
    try:
        request = MarketOrderRequest(
            symbol=symbol,
            qty=abs(qty),
            side=OrderSide.BUY,
            type=OrderType.MARKET,
            time_in_force=TimeInForce.DAY,
        )
        order = trading.submit_order(request)
        return f"MARKET order placed (ID: {order.id})"
    except Exception as e:
        return f"MARKET order FAILED: {e}"


def main():
    print("=" * 60)
    print("WheelBot Exit Checker")
    print("=" * 60)

    # ── 1. Connect & get account info ────────────────────────────────────
    try:
        account = trading.get_account()
        print(f"\nAccount: Paper Trading")
        print(f"  Portfolio Value: ${float(account.portfolio_value):,.2f}")
        print(f"  Buying Power:   ${float(account.buying_power):,.2f}")
        print(f"  Cash:           ${float(account.cash):,.2f}")
    except Exception as e:
        print(f"[FATAL] Cannot connect to Alpaca: {e}")
        send_discord(f"**WheelBot EXIT CHECKER FAILED**\nCannot connect to Alpaca: {e}")
        return

    # ── 2. Get all positions ─────────────────────────────────────────────
    try:
        positions = trading.get_all_positions()
    except Exception as e:
        print(f"[FATAL] Cannot fetch positions: {e}")
        send_discord(f"**WheelBot EXIT CHECKER FAILED**\nCannot fetch positions: {e}")
        return

    if not positions:
        msg = "No open positions found. Nothing to check."
        print(f"\n{msg}")
        send_discord(f"**WheelBot Exit Check** — {msg}")
        return

    option_positions = []
    stock_positions = []

    for pos in positions:
        if pos.asset_class == AssetClass.US_OPTION:
            option_positions.append(pos)
        else:
            stock_positions.append(pos)

    print(f"\nPositions: {len(positions)} total "
          f"({len(option_positions)} options, {len(stock_positions)} stocks)")

    # ── 3. Check each option position against exit rules ─────────────────
    actions_taken = []
    position_summaries = []

    for pos in option_positions:
        symbol = pos.symbol
        qty = int(float(pos.qty))
        avg_entry = float(pos.avg_entry_price)
        current_price = float(pos.current_price) if pos.current_price else None
        unrealized_pl = float(pos.unrealized_pl) if pos.unrealized_pl else 0.0
        side = str(pos.side)

        parsed = parse_occ_symbol(symbol)
        print(f"\n{'─' * 50}")
        print(f"  Symbol: {symbol}")
        print(f"  Qty: {qty} | Side: {side}")
        print(f"  Entry: ${avg_entry:.2f} | Current: ${current_price:.2f}" if current_price else
              f"  Entry: ${avg_entry:.2f} | Current: N/A")
        print(f"  Unrealized P&L: ${unrealized_pl:+.2f}")

        if parsed:
            print(f"  Underlying: {parsed['underlying']} | "
                  f"Strike: ${parsed['strike']:.2f} | "
                  f"Type: {parsed['option_type']} | "
                  f"Exp: {parsed['expiration']}")
            remaining_dte = calc_dte(parsed["expiration"])
            print(f"  DTE: {remaining_dte}")
        else:
            remaining_dte = None
            print(f"  [!] Could not parse OCC symbol")

        # Get fresh quote
        quote = get_option_quote(symbol)
        if quote:
            print(f"  Quote: bid=${quote['bid']:.2f} ask=${quote['ask']:.2f} mid=${quote['mid']:.2f}")
            live_price = quote["mid"]
            ask_price = quote["ask"]
        else:
            live_price = current_price
            ask_price = current_price
            print(f"  [!] Using position price (no live quote)")

        if live_price is None:
            print(f"  [SKIP] No price available")
            position_summaries.append(f"- `{symbol}`: **SKIPPED** (no price)")
            continue

        # ── Exit rule evaluation (short options: sold to open) ───────────
        # For short options, profit = price dropped (sold high, can buy back low)
        # Loss = price increased (have to buy back at more than we sold)
        is_short = qty < 0

        action = None
        reason = None

        if is_short:
            profit_target_price = avg_entry * (1 - PROFIT_TARGET)
            stop_loss_price = avg_entry * STOP_LOSS_MULT

            print(f"  Profit target (50%): price <= ${profit_target_price:.2f}")
            print(f"  Stop loss (2x):      price >= ${stop_loss_price:.2f}")

            # Rule 1: 50% profit target
            if live_price <= profit_target_price:
                reason = (f"50% PROFIT TARGET HIT — "
                          f"entry ${avg_entry:.2f} → current ${live_price:.2f} "
                          f"(target was ${profit_target_price:.2f})")
                result = close_with_limit(symbol, qty, ask_price)
                action = f"LIMIT CLOSE (profit): {result}"
                print(f"  >>> {reason}")
                print(f"  >>> {action}")

            # Rule 2: 2x stop loss
            elif live_price >= stop_loss_price:
                reason = (f"STOP LOSS TRIGGERED — "
                          f"entry ${avg_entry:.2f} → current ${live_price:.2f} "
                          f"(stop at ${stop_loss_price:.2f})")
                result = close_with_market(symbol, qty)
                action = f"MARKET CLOSE (stop loss): {result}"
                print(f"  >>> {reason}")
                print(f"  >>> {action}")

            # Rule 3: DTE < 5
            elif remaining_dte is not None and remaining_dte < DTE_THRESHOLD:
                reason = (f"DTE < {DTE_THRESHOLD} — "
                          f"{remaining_dte} days remaining, closing to avoid gamma risk")
                # Use market order for DTE exits too (urgency)
                result = close_with_market(symbol, qty)
                action = f"MARKET CLOSE (DTE): {result}"
                print(f"  >>> {reason}")
                print(f"  >>> {action}")

            else:
                print(f"  [OK] No exit conditions met")

        else:
            # Long options — same rules but inverted
            profit_target_price = avg_entry * (1 + PROFIT_TARGET)
            stop_loss_price = avg_entry * (1 - (1 / STOP_LOSS_MULT))

            print(f"  Profit target (50%): price >= ${profit_target_price:.2f}")
            print(f"  Stop loss (50% drop): price <= ${stop_loss_price:.2f}")

            # Rule 1: 50% profit
            if live_price >= profit_target_price:
                reason = (f"50% PROFIT TARGET HIT — "
                          f"entry ${avg_entry:.2f} → current ${live_price:.2f}")
                # For long options, sell to close
                try:
                    request = LimitOrderRequest(
                        symbol=symbol,
                        qty=abs(qty),
                        side=OrderSide.SELL,
                        type=OrderType.LIMIT,
                        time_in_force=TimeInForce.DAY,
                        limit_price=quote["bid"] if quote else live_price,
                    )
                    order = trading.submit_order(request)
                    action = f"LIMIT SELL (profit): order {order.id}"
                except Exception as e:
                    action = f"LIMIT SELL FAILED: {e}"
                print(f"  >>> {reason}")
                print(f"  >>> {action}")

            # Rule 2: Stop loss
            elif live_price <= stop_loss_price:
                reason = (f"STOP LOSS TRIGGERED — "
                          f"entry ${avg_entry:.2f} → current ${live_price:.2f}")
                try:
                    request = MarketOrderRequest(
                        symbol=symbol,
                        qty=abs(qty),
                        side=OrderSide.SELL,
                        type=OrderType.MARKET,
                        time_in_force=TimeInForce.DAY,
                    )
                    order = trading.submit_order(request)
                    action = f"MARKET SELL (stop loss): order {order.id}"
                except Exception as e:
                    action = f"MARKET SELL FAILED: {e}"
                print(f"  >>> {reason}")
                print(f"  >>> {action}")

            # Rule 3: DTE < 5
            elif remaining_dte is not None and remaining_dte < DTE_THRESHOLD:
                reason = (f"DTE < {DTE_THRESHOLD} — "
                          f"{remaining_dte} days remaining")
                try:
                    request = MarketOrderRequest(
                        symbol=symbol,
                        qty=abs(qty),
                        side=OrderSide.SELL,
                        type=OrderType.MARKET,
                        time_in_force=TimeInForce.DAY,
                    )
                    order = trading.submit_order(request)
                    action = f"MARKET SELL (DTE): order {order.id}"
                except Exception as e:
                    action = f"MARKET SELL FAILED: {e}"
                print(f"  >>> {reason}")
                print(f"  >>> {action}")

            else:
                print(f"  [OK] No exit conditions met")

        # Build summary
        if action:
            actions_taken.append({"symbol": symbol, "reason": reason, "action": action})
            position_summaries.append(
                f"- `{symbol}`: **EXIT** — {reason}\n  → {action}"
            )
        else:
            pnl_pct = ((live_price - avg_entry) / avg_entry * 100) if avg_entry > 0 else 0
            if is_short:
                pnl_pct = -pnl_pct  # For short, price drop = profit
            dte_str = f", DTE={remaining_dte}" if remaining_dte is not None else ""
            position_summaries.append(
                f"- `{symbol}`: HOLD (P&L: {pnl_pct:+.1f}%{dte_str})"
            )

    # ── 4. Stock positions summary ───────────────────────────────────────
    for pos in stock_positions:
        symbol = pos.symbol
        qty = int(float(pos.qty))
        avg_entry = float(pos.avg_entry_price)
        current = float(pos.current_price) if pos.current_price else avg_entry
        pl = float(pos.unrealized_pl) if pos.unrealized_pl else 0.0
        pct = float(pos.unrealized_plpc) * 100 if pos.unrealized_plpc else 0.0
        position_summaries.append(
            f"- `{symbol}` (stock): {qty} shares, entry ${avg_entry:.2f}, "
            f"now ${current:.2f}, P&L ${pl:+.2f} ({pct:+.1f}%)"
        )
        print(f"\n  Stock: {symbol} | {qty} shares | "
              f"${avg_entry:.2f} → ${current:.2f} | P&L: ${pl:+.2f}")

    # ── 5. Discord notification ──────────────────────────────────────────
    print(f"\n{'=' * 60}")
    print(f"Summary: {len(actions_taken)} exits triggered out of {len(positions)} positions")

    discord_msg = f"**WheelBot Exit Check** — {datetime.now().strftime('%Y-%m-%d %H:%M ET')}\n\n"

    if actions_taken:
        discord_msg += f"**{len(actions_taken)} EXIT(S) TRIGGERED:**\n"
    else:
        discord_msg += "No exits triggered. All positions within thresholds.\n"

    discord_msg += "\n".join(position_summaries)

    # Truncate if too long for Discord (2000 char limit)
    if len(discord_msg) > 1950:
        discord_msg = discord_msg[:1950] + "\n..."

    send_discord(discord_msg)
    print("\nDone.")


if __name__ == "__main__":
    main()
