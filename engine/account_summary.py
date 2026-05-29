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
from zoneinfo import ZoneInfo

import requests

ET = ZoneInfo("America/New_York")


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
    # Explicit None check, NOT `or equity` — last_equity could legitimately be 0.0
    # (account just funded today, or a previously zero-equity day) and we don't
    # want to silently fall back, which would make today's delta look like $0.
    last_equity = float(acct.last_equity) if acct.last_equity is not None else equity
    cash = float(acct.cash)
    bp = float(acct.buying_power)
    delta = equity - last_equity
    pct = (delta / last_equity * 100) if last_equity else 0.0

    delta_sign = "+" if delta >= 0 else ""
    pct_sign = "+" if pct >= 0 else ""

    # Always anchor the displayed time to Eastern, regardless of container TZ.
    # Railway sets TZ=America/New_York via Dockerfile so this is currently a
    # no-op, but a deploy that forgets that env var would silently start
    # mis-labeling timestamps. Anchoring here makes the label match the data.
    lines = [
        f"📊 **{label} @ {datetime.now(ET).strftime('%H:%M ET')}**",
        f"Equity: ${equity:,.2f} | Today: {delta_sign}${delta:,.2f} ({pct_sign}{pct:.2f}%) | BP: ${bp:,.2f} | Cash: ${cash:,.2f}",
    ]

    # All-time P&L since bot launch — the single most important number for
    # "is this thing working?" Pulls from Alpaca's portfolio history endpoint
    # (persistent across container restarts; the bot's local DB resets every
    # deploy so any locally-computed performance stats are unreliable).
    if api_key and secret_key:
        launch_equity, total_pl, total_pct = _launch_to_date_pnl(api_key, secret_key)
        if launch_equity is not None:
            pl_sign = "+" if total_pl >= 0 else ""
            pct_sign = "+" if total_pct >= 0 else ""
            lines.append(
                f"Since launch (04-23): {pl_sign}${total_pl:,.2f} ({pct_sign}{total_pct:.2f}%) "
                f"— launch ${launch_equity:,.2f} → now ${equity:,.2f}"
            )

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

    # Today's activity (closes, assignments, fees) — only if creds provided.
    # Assumption: WheelBot is a short-options-only strategy (sell-to-open CSPs
    # and CCs, buy-to-close at profit target or stop). Under that strategy,
    # buy-side fills are always closes and sell-side fills are always opens.
    # If this assumption ever changes (e.g. PMCC LEAPS = long calls, opened
    # via buy), this classification needs the activity record's position_effect
    # field, not just side. See alpaca-py docs for non-FILL activity types.
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


LAUNCH_DATE = "2026-04-23"  # WheelBot's live-launch date per LIVE_LAUNCH.md
# When you ever change this (significant capital change, strategy reset),
# also update LIVE_LAUNCH.md so the docs stay consistent with the metric.


def _launch_to_date_pnl(
    api_key: str, secret_key: str,
) -> tuple[float | None, float, float]:
    """Return (launch_equity, total_pnl_$, total_pnl_%) from Alpaca's
    portfolio history. (None, 0, 0) on any failure — caller should skip
    the line rather than mis-report.

    Why not compute from the DB? Because the SQLite wheelbot.db resets
    every Railway deploy. Alpaca's portfolio history is persistent and is
    the only source of truth for "how much have I made/lost since I started".
    """
    try:
        from datetime import datetime as _dt
        r = requests.get(
            "https://api.alpaca.markets/v2/account/portfolio/history",
            headers={"APCA-API-KEY-ID": api_key, "APCA-API-SECRET-KEY": secret_key},
            params={"period": "1A", "timeframe": "1D"},  # 1A = 1 year, enough since launch
            timeout=10,
        )
        if not r.ok:
            return None, 0.0, 0.0
        h = r.json() or {}
        timestamps = h.get("timestamp") or []
        equities = h.get("equity") or []
        if not timestamps or not equities:
            return None, 0.0, 0.0
        launch_dt = _dt.fromisoformat(LAUNCH_DATE).date()
        launch_eq = None
        for t, e in zip(timestamps, equities):
            if _dt.fromtimestamp(t, timezone.utc).date() >= launch_dt:
                launch_eq = float(e)
                break
        if launch_eq is None or launch_eq <= 0:
            return None, 0.0, 0.0
        current_eq = float(equities[-1])
        delta = current_eq - launch_eq
        pct = delta / launch_eq * 100
        return launch_eq, delta, pct
    except Exception:
        return None, 0.0, 0.0


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
