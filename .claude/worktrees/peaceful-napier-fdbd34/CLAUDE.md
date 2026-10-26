# WheelBot — Claude Operating Notes

Autonomous options-wheel bot trading via Alpaca, hosted on Railway, with Discord
notifications. Lives at github.com/YonatanNudman/wheelbot (remote `origin`).

## Persistent access (read this first)

Three credentials let Claude act on this project without interactive auth:

1. **`RAILWAY_TOKEN`** in `~/.zshrc` — long-lived API token from
   https://railway.com/account/tokens. Used by `scripts/deploy.sh` and the
   Railway CLI. Never expires. If a Claude session can't reach Railway, it's
   because this env var isn't loaded; check `echo $RAILWAY_TOKEN` then
   `source ~/.zshrc`.

2. **`.env` in repo root** — `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`,
   `DISCORD_WEBHOOK_URL`, `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`,
   `OPENAI_API_KEY`. Sourced via `set -a && . ./.env && set +a`.

3. **Discord webhook delivery** — the webhook URL in `.env` is the *only*
   proven path to reach Discord. `self._channel.send()` on the bot has been
   silently dropping messages (likely missing GUILDS intent in `Intents.default()`);
   status posts now route through `WebhookSender` (`discord_bot/webhook.py`).

## Deploy workflow

```bash
./scripts/deploy.sh        # push to origin + auto-approve gated deploy + tail
./scripts/deploy.sh --no-push   # just approve any pending deploy
```

Railway gates each new commit at `NEEDS_APPROVAL` (Hobby plan; user does not
want to upgrade). `deploy.sh` finds the gated deploy via GraphQL and approves
it. If the script reports "Not Authorized", `RAILWAY_TOKEN` is wrong or unset.

## Architectural traps Claude has hit

- **SQLite (`wheelbot.db`) wipes on every Railway deploy** — no persistent
  volume. Position state, executions, signals all reset. The reconciler runs
  on startup to backfill open positions from Alpaca. Don't rely on DB history
  for anything; pull from Alpaca's portfolio-history endpoint instead (used in
  `engine/account_summary.py:_launch_to_date_pnl`).

- **Alpaca `OrderStatus` enum string** — `str(OrderStatus.FILLED)` returns
  `"OrderStatus.FILLED"`, not `"filled"`. Always use `.value` for comparisons.
  Hit in `broker/alpaca_broker.py` — fixed but worth knowing.

- **OCC option symbols** — Alpaca uses *unpadded* underlying (e.g.
  `F260529P00011500`, not `F     260529P00011500`). Both
  `broker._build_option_symbol` and `reconciler._option_key` must agree on
  this. The market data API regex rejects whitespace; the trading API tolerates
  it (so this bug hid).

- **Exit engine signal dedup** — `_check_wheel_exits` keeps a
  `_last_close_signal_at` dict keyed by `(symbol, type, strike, exp)` with a
  30-minute cooldown. Without dedup, every 5-min exit cycle re-fires the same
  Discord notification for an unfilled close.

- **"AUTO-EXECUTED" without executing** — the old exit-monitor loop posted
  green ✅ AUTO-EXECUTED embeds *without ever calling the executor*. New
  `_execute_and_notify` helper in `discord_bot/bot.py` actually places the
  order and suppresses the embed if the executor rejects (e.g. duplicate
  detection).

## Read-of-truth precedence

When state disagrees, trust in this order:

1. **Alpaca** (`broker.get_all_positions()`, `get_account()`, `/account/activities`) —
   ground truth for what's actually traded.
2. **`wheelbot.db`** — bot's mental model; can drift after deploys, restarts,
   or out-of-band actions. Validate against (1) before believing it.
3. **Discord posts** — historical record but can lie ("AUTO-EXECUTED" bug);
   don't reason backward from notifications.

## Tests + review

- `python -m pytest tests/ -x -q` — 35 tests, runs in <2s, must pass before
  any commit.
- `coderabbit review --plain --base-commit <hash>` — automated review against
  a baseline. Skip "config sizing" findings: the reviewer doesn't know that
  `reserve_pct` is applied upstream of `max_per_position_pct` in the wheel
  scanner, so it flags violations that don't exist.
