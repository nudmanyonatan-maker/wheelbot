"""PositionReconciler — detects assignments by comparing broker vs DB state."""

from __future__ import annotations

from typing import TYPE_CHECKING

from data import database as db
from data.models import Position, PositionState, Strategy
from utils.logger import get_logger
from utils.timing import now_et

if TYPE_CHECKING:
    from broker.alpaca_broker import AlpacaBroker

log = get_logger(__name__)


class PositionReconciler:
    """Compares live broker positions against the DB to detect assignments,
    expirations, and other out-of-band state changes.

    Run once per day (typically at market open) to catch overnight events
    like option assignments and expirations.
    """

    def __init__(self, broker: AlpacaBroker, db_module: object | None = None) -> None:
        self.broker = broker
        # Accept a db_module for testability; default to the real module.
        self._db = db_module or db

    # ── Public API ────────────────────────────────────────────────────────

    def reconcile(self) -> list[str]:
        """Run a full reconciliation pass.

        Returns:
            Human-readable descriptions of every change detected.
        """
        log.info("Starting position reconciliation")
        changes: list[str] = []

        broker_stocks = self._get_broker_stock_map()
        broker_options = self._get_broker_option_set()
        db_positions = self._db.get_open_positions()

        for pos in db_positions:
            if pos.strategy in (
                Strategy.WHEEL_CSP.value,
                Strategy.PMCC_SHORT_CALL.value,
            ):
                change = self._check_short_option_assignment(pos, broker_options, broker_stocks)
                if change:
                    changes.append(change)

            elif pos.strategy == Strategy.PMCC_LEAPS.value:
                change = self._check_leaps_still_exists(pos, broker_options)
                if change:
                    changes.append(change)

            elif pos.strategy in (Strategy.WHEEL_CC.value,):
                change = self._check_covered_call(pos, broker_options, broker_stocks)
                if change:
                    changes.append(change)

            elif pos.strategy == Strategy.WHEEL_SHARES.value:
                change = self._check_shares_still_held(pos, broker_stocks)
                if change:
                    changes.append(change)

        # VRP spread reconciliation
        vrp_changes = self._reconcile_vrp_spreads(broker_options)
        changes.extend(vrp_changes)

        # Reverse-direction reconciliation: find broker options that DB doesn't
        # know about (orphans created by a previous DB wipe, manual trade,
        # multi-deploy split-brain, etc.). Without this the bot will
        # double-up on positions because get_symbol_states() reads only the DB.
        orphan_changes = self._backfill_broker_orphans(broker_options, db_positions)
        changes.extend(orphan_changes)

        if changes:
            log.info("Reconciliation found %d change(s):", len(changes))
            for c in changes:
                log.info("  - %s", c)
        else:
            log.info("Reconciliation complete — no discrepancies found")

        return changes

    # ── Reverse reconciliation ────────────────────────────────────────────

    def _backfill_broker_orphans(
        self,
        broker_options: set[str],
        db_positions: list,
    ) -> list[str]:
        """Create DB rows for broker option positions that DB doesn't know about.

        Only handles short puts (→ wheel_csp) and short calls when the
        underlying shares are also held (→ wheel_cc). Naked calls and long
        options get a warning instead of a guess — the strategy taxonomy
        doesn't fit them and we'd rather alert than mislabel.
        """
        changes: list[str] = []
        known_keys = {self._option_key(p) for p in db_positions if p.option_type}

        broker_option_dicts = self.broker.get_option_positions()
        broker_stocks = self._get_broker_stock_map()

        for bp in broker_option_dicts:
            occ = bp.get("symbol", "")
            if occ in known_keys:
                continue

            parsed = self._parse_occ(occ)
            if not parsed:
                log.warning("Skipping unparseable OCC symbol: %s", occ)
                continue
            underlying, exp_iso, opt_type, strike = parsed

            qty = int(bp.get("quantity", 0))
            entry_price = float(bp.get("avg_entry_price") or 0.0)
            is_short = qty < 0

            if not is_short:
                log.warning(
                    "Skipping orphan long option (not modeled): %s qty=%s",
                    occ, qty,
                )
                continue

            if opt_type == "put":
                strategy = Strategy.WHEEL_CSP.value
            elif opt_type == "call":
                # A short call without shares is a naked call — outside the
                # wheel taxonomy. Only treat as covered call if shares present.
                if broker_stocks.get(underlying, 0) >= 100:
                    strategy = Strategy.WHEEL_CC.value
                else:
                    log.warning(
                        "Skipping orphan naked call (no shares to cover): %s",
                        occ,
                    )
                    continue
            else:
                log.warning("Skipping orphan with unknown type: %s", occ)
                continue

            new_pos = Position(
                symbol=underlying,
                strategy=strategy,
                state=PositionState.OPEN.value,
                option_type=opt_type,
                strike=strike,
                expiration_date=exp_iso,
                quantity=abs(qty),
                entry_date=now_et().strftime("%Y-%m-%d"),
                entry_price=entry_price,
                entry_credit_total=entry_price * 100 * abs(qty),
                notes=f"Backfilled from Alpaca on {now_et().strftime('%Y-%m-%d')}",
            )
            new_id = self._db.create_position(new_pos)
            msg = (
                f"BACKFILLED: {underlying} {opt_type} ${strike} exp {exp_iso} "
                f"qty {qty} (DB pos #{new_id})"
            )
            log.info(msg)
            changes.append(msg)

        return changes

    @staticmethod
    def _parse_occ(symbol: str) -> tuple[str, str, str, float] | None:
        """Parse an OCC option symbol back to (underlying, exp_iso, type, strike).

        Format: SYMBOL(1-6 chars padded) + YYMMDD + C/P + strike*1000 (8 digits).
        Example: SOFI260515P00017000 → ('SOFI', '2026-05-15', 'put', 17.0)
        """
        from datetime import datetime as _dt

        if len(symbol) < 15:
            return None
        # Last 8 chars = strike, char before = C/P, 6 before that = YYMMDD,
        # everything before = underlying (right-stripped).
        strike_str = symbol[-8:]
        type_char = symbol[-9]
        date_str = symbol[-15:-9]
        underlying = symbol[:-15].rstrip()

        if type_char not in ("C", "P"):
            return None
        try:
            strike = int(strike_str) / 1000.0
            exp = _dt.strptime(date_str, "%y%m%d")
        except ValueError:
            return None

        opt_type = "call" if type_char == "C" else "put"
        return underlying, exp.strftime("%Y-%m-%d"), opt_type, strike

    # ── Detection logic ───────────────────────────────────────────────────

    def _check_short_option_assignment(
        self,
        pos: Position,
        broker_options: set[str],
        broker_stocks: dict[str, float],
    ) -> str | None:
        """Detect CSP / short-call assignment.

        If the option has disappeared from the broker AND shares appeared,
        it was assigned.
        """
        key = self._option_key(pos)
        option_gone = key not in broker_options
        shares_appeared = pos.symbol in broker_stocks and broker_stocks[pos.symbol] >= 100

        if option_gone and shares_appeared:
            log.info("ASSIGNMENT detected: %s %s $%s", pos.symbol, pos.option_type, pos.strike)

            # Close the option position
            self._db.close_position(
                pos.id,
                exit_price=0.0,
                exit_reason="assigned",
            )

            # Create a new SHARES position
            share_price = broker_stocks[pos.symbol] / (broker_stocks[pos.symbol] // 100 * 100)
            # Cost basis = strike - premium collected per share.
            # entry_price is the premium per share collected when selling
            # the CSP.  Subtracting it gives the true effective cost basis,
            # which is the whole point of the wheel strategy.
            cost_basis = (pos.strike or 0.0) - (pos.entry_price or 0.0)
            new_pos = Position(
                symbol=pos.symbol,
                strategy=Strategy.WHEEL_SHARES.value,
                pair_id=pos.pair_id,
                state=PositionState.OPEN.value,
                quantity=int(broker_stocks[pos.symbol]),
                entry_date=now_et().strftime("%Y-%m-%d"),
                entry_price=cost_basis,
                cost_basis=cost_basis,
                total_premium_collected=pos.total_premium_collected,
                notes=f"Assigned from {pos.strategy} position #{pos.id}",
            )
            new_id = self._db.create_position(new_pos)

            msg = (
                f"ASSIGNED: {pos.symbol} {pos.option_type} ${pos.strike} "
                f"(position #{pos.id}) -> {int(broker_stocks[pos.symbol])} shares "
                f"created as position #{new_id} (cost basis ${cost_basis:.2f})"
            )
            return msg

        if option_gone and not shares_appeared:
            # Option gone but no shares — likely expired worthless
            self._db.close_position(pos.id, exit_price=0.0, exit_reason="expired")
            msg = (
                f"EXPIRED: {pos.symbol} {pos.option_type} ${pos.strike} "
                f"(position #{pos.id}) expired worthless — full premium kept"
            )
            log.info(msg)
            return msg

        return None

    def _check_leaps_still_exists(
        self,
        pos: Position,
        broker_options: set[str],
    ) -> str | None:
        """Verify a LEAPS position still exists at the broker."""
        key = self._option_key(pos)
        if key not in broker_options:
            # LEAPS gone — could be assigned, exercised, or expired
            self._db.close_position(
                pos.id,
                exit_price=0.0,
                exit_reason="expired_or_exercised",
            )
            msg = (
                f"LEAPS GONE: {pos.symbol} call ${pos.strike} "
                f"(position #{pos.id}) no longer at broker — "
                f"marked expired/exercised"
            )
            log.warning(msg)
            return msg
        return None

    def _check_covered_call(
        self,
        pos: Position,
        broker_options: set[str],
        broker_stocks: dict[str, float],
    ) -> str | None:
        """Check covered call status — if call gone AND shares gone, assigned."""
        key = self._option_key(pos)
        if key not in broker_options:
            shares_remaining = broker_stocks.get(pos.symbol, 0)
            if shares_remaining < 100:
                # Call assigned — shares were called away
                self._db.close_position(
                    pos.id, exit_price=0.0, exit_reason="assigned",
                )
                msg = (
                    f"CC ASSIGNED: {pos.symbol} call ${pos.strike} "
                    f"(position #{pos.id}) — shares called away"
                )
                log.info(msg)
                return msg
            else:
                # Call expired worthless, shares still held
                self._db.close_position(
                    pos.id, exit_price=0.0, exit_reason="expired",
                )
                msg = (
                    f"CC EXPIRED: {pos.symbol} call ${pos.strike} "
                    f"(position #{pos.id}) expired — shares retained"
                )
                log.info(msg)
                return msg
        return None

    def _check_shares_still_held(
        self,
        pos: Position,
        broker_stocks: dict[str, float],
    ) -> str | None:
        """Verify share positions are still held at the broker."""
        qty = broker_stocks.get(pos.symbol, 0)
        if qty < pos.quantity:
            self._db.close_position(
                pos.id,
                exit_price=0.0,
                exit_reason="shares_sold_externally",
            )
            msg = (
                f"SHARES GONE: {pos.symbol} x{pos.quantity} "
                f"(position #{pos.id}) — only {qty:.0f} remain at broker"
            )
            log.warning(msg)
            return msg
        return None

    # ── VRP spread reconciliation ─────────────────────────────────────────

    def _reconcile_vrp_spreads(self, broker_options: set[str]) -> list[str]:
        """Verify both legs of every open VRP spread still exist at the broker.

        For each spread pair_id, checks that both short and long legs are still
        held. If a leg is missing, closes the DB position and returns an alert.
        """
        changes: list[str] = []

        vrp_positions = self._db.get_open_positions(strategy="vrp_spread")
        if not vrp_positions:
            return changes

        # Group by pair_id
        pairs: dict[str, list[Position]] = {}
        for pos in vrp_positions:
            if pos.pair_id:
                pairs.setdefault(pos.pair_id, []).append(pos)

        for pair_id, legs in pairs.items():
            for leg in legs:
                key = self._option_key(leg)
                if key not in broker_options:
                    # Leg missing at broker — close it
                    self._db.close_position(
                        leg.id,
                        exit_price=0.0,
                        exit_reason="leg_missing_at_broker",
                    )
                    msg = (
                        f"VRP SPREAD LEG MISSING: {leg.symbol} put ${leg.strike} "
                        f"(pair {pair_id}, position #{leg.id}) "
                        f"not found at broker — closed in DB"
                    )
                    log.warning(msg)
                    changes.append(msg)

        if changes:
            log.warning("VRP reconciliation: %d missing leg(s) detected", len(changes))
        else:
            log.info("VRP reconciliation: all spread legs accounted for")

        return changes

    # ── Broker data helpers ───────────────────────────────────────────────

    def _get_broker_stock_map(self) -> dict[str, float]:
        """Build {symbol: total_quantity} map from broker stock positions.

        Note: AlpacaBroker.get_stock_positions() returns list[dict], not dataclass.
        """
        positions = self.broker.get_stock_positions()
        stock_map: dict[str, float] = {}
        for sp in positions:
            sym = sp["symbol"]
            qty = sp["quantity"]
            stock_map[sym] = stock_map.get(sym, 0) + qty
        log.debug("Broker stock positions: %d symbols", len(stock_map))
        return stock_map

    def _get_broker_option_set(self) -> set[str]:
        """Build a set of option keys currently held at the broker.

        Note: AlpacaBroker.get_option_positions() returns list[dict], not dataclass.
        The option dicts have 'symbol' but not 'option_type', 'strike', or
        'expiration_date' as separate fields — they are encoded in the OCC symbol.
        We store the full OCC symbol as the key for comparison.
        """
        positions = self.broker.get_option_positions()
        option_set: set[str] = set()
        for op in positions:
            # Alpaca option dicts contain 'symbol' (the full OCC symbol)
            # We use the symbol directly since it uniquely identifies the contract.
            option_set.add(op["symbol"])
        log.debug("Broker option positions: %d contracts", len(option_set))
        return option_set

    @staticmethod
    def _option_key(pos: Position) -> str:
        """Generate a matching OCC symbol for a DB position to compare with broker data.

        OCC format: SYMBOL(6 chars) + YYMMDD + C/P + strike*1000 (8 digits).
        Must match the format used by AlpacaBroker._build_option_symbol().
        """
        from datetime import datetime as _dt

        symbol = pos.symbol or ""
        strike = pos.strike or 0.0
        expiration = pos.expiration_date or ""
        option_type = pos.option_type or "put"

        try:
            exp_date = _dt.strptime(expiration, "%Y-%m-%d")
            date_str = exp_date.strftime("%y%m%d")
        except (ValueError, TypeError):
            # Fall back to pipe-delimited key if date parsing fails
            return f"{symbol}|{option_type}|{strike}|{expiration}"

        type_char = "C" if option_type.lower() == "call" else "P"
        # Use round() instead of int() to prevent floating-point truncation
        # Must match AlpacaBroker._build_option_symbol() — and Alpaca's
        # canonical form has NO space-padding on the underlying ticker.
        # (Padding here was the silent cause of assignment-detection always
        # missing — broker_options held "F260515P00012000" while this returned
        # "F     260515P00012000", so `key not in broker_options` was True
        # for legitimately-open positions.)
        strike_int = round(strike * 1000)
        strike_str = f"{strike_int:08d}"

        return f"{symbol}{date_str}{type_char}{strike_str}"
