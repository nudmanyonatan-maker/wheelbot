"""Format a live account snapshot from Alpaca for Discord display.

Single source of truth for "is the bot doing anything and how is it doing".
Used by both the /portfolio slash command and the 17:00 daily snapshot job —
DO NOT introduce a parallel formatter elsewhere; the whole point is that the
on-demand and scheduled views agree byte-for-byte.

Pulls from Alpaca directly (not the bot's local DB) because the DB has a
history of drifting out of sync — this gives you ground truth even when the
bot's internal state is stale or wrong.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import requests


def build_summary(
    broker: Any,
    *,
    api_key: str | None = None,
    secret_key: str | None = None,
    label: str = "Account",
    include_today_activity: bool = True,
) -> str:
    """Return a Discord-ready text snapshot of the live Alpaca account.

    Args:
        broker: AlpacaBroker instance (we use its .trading client).
        api_key, secret_key: optional, used to query the activities endpoint
            for today's closes/assignments. If omitted, that section is
            skipped.
        label: header label (e.g. "Account", "Daily snapshot").
        include_today_activity: if False, skip the activities lookup (faster).
    """
    acct = broker.trading.get_account()
    equity = float(acct.equity)
    last_equity = float(acct.last_equity) or equity
    cash = float(acct.cash)
    bp = float(acct.buying_power)
    delta = equity - last_equity
    pct = (delta / last_equity * 100) if last_equity else 0.0

    delta_sign = "+" if delta >= 0 else ""
    pct_sign = "+" if pct >= 0 else ""

    lines = [
        f"📊 **{label} @ {datetime.now().strftime('%H:%M ET')}**",
        f"Equity: ${equity:,.2f} | Today: {delta_sign}${delta:,.2f} ({pct_sign}{pct:.2f}%) | BP: ${bp:,.2f} | Cash: ${cash:,.2f}",
    ]

    # Open positions
    positions = broker.trading.get_all_positions()
    if not positions:
        lines.append("Open: (none)")
    else:
        lines.append(f"Open ({len(positions)}):")
        total_upl = 0.0
        for p in positions:
            upl = float(p.unrealized_pl)
            total_upl += upl
            cost = float(p.avg_entry_price)
            now = float(p.current_price)
            qty = int(float(p.qty))
            # Percent return relative to absolute cost basis (handles short
            # options where avg_entry_price is positive but qty is negative).
            cost_basis = abs(cost * qty * 100) if _is_option(p.symbol) else abs(cost * qty)
            pct_str = f"{upl / cost_basis * 100:+.1f}%" if cost_basis else "?"
            lines.append(
                f"  `{p.symbol:<22}` qty={qty:>3} cost=${cost:.2f} now=${now:.2f} "
                f"P/L=${upl:+.2f} ({pct_str})"
            )
        sign = "+" if total_upl >= 0 else ""
        lines.append(f"  Total unrealized: {sign}${total_upl:,.2f}")

    # Today's activity (closes, assignments, fees) — only if creds provided
    if include_today_activity and api_key and secret_key:
        today_acts = _fetch_today_activities(api_key, secret_key)
        closes = [a for a in today_acts if a.get("activity_type") == "FILL" and a.get("side") == "buy"]
        opens = [a for a in today_acts if a.get("activity_type") == "FILL" and a.get("side") == "sell"]
        if closes or opens:
            lines.append("Today:")
            for a in opens:
                lines.append(f"  ↗ opened `{a.get('symbol','?'):<22}` @ ${float(a.get('price',0)):.2f}")
            for a in closes:
                lines.append(f"  ↘ closed `{a.get('symbol','?'):<22}` @ ${float(a.get('price',0)):.2f}")

    return "\n".join(lines)


def _is_option(symbol: str) -> bool:
    """Heuristic: OCC option symbols are at least 15 chars and end with 8 digits."""
    return len(symbol) >= 15 and symbol[-8:].isdigit()


def _fetch_today_activities(api_key: str, secret_key: str) -> list[dict]:
    """Pull today's account activities from Alpaca. Best-effort — never raises."""
    try:
        since = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
        r = requests.get(
            "https://api.alpaca.markets/v2/account/activities",
            headers={"APCA-API-KEY-ID": api_key, "APCA-API-SECRET-KEY": secret_key},
            params={"after": since, "page_size": 50},
            timeout=10,
        )
        if not r.ok:
            return []
        return r.json() or []
    except Exception:
        return []
