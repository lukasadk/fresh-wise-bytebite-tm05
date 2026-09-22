import json
import sqlite3
import threading
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from uuid import UUID, uuid4

from .config import get_settings
from .schemas import (
    AnalysisResponse,
    AnalysisStatus,
    ConfidenceBinMetrics,
    ConfidenceDiagnosticsResponse,
    ConfirmationResponse,
    ConfirmReviewRequest,
    GroceryUnit,
    InventoryEntry,
    LiteralExpirySource,
    ReviewDecision,
    ReviewDraftResponse,
    ReviewEvent,
    ReviewFoodItem,
    ReviewHistoryResponse,
    ReviewMetricsResponse,
    ReviewOrigin,
    ReviewSummary,
    SaveReviewRequest,
)


class AnalysisNotFoundError(KeyError):
    pass


class AnalysisImageNotFoundError(KeyError):
    pass


class AnalysisAlreadyConfirmedError(RuntimeError):
    pass


class ReviewRevisionConflictError(RuntimeError):
    pass


class InvalidReviewError(ValueError):
    pass


_EDITABLE_FIELDS = (
    "food_name",
    "brand",
    "product_variant",
    "net_content_text",
    "category",
    "quantity",
    "unit",
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _review_summary(items: list[ReviewFoodItem]) -> ReviewSummary:
    pending = sum(item.decision is ReviewDecision.pending for item in items)
    accepted = sum(item.decision is ReviewDecision.accepted for item in items)
    rejected = sum(item.decision is ReviewDecision.rejected for item in items)
    unresolved = sum(
        item.decision is ReviewDecision.accepted
        and (item.quantity is None or item.unit is GroceryUnit.unknown)
        for item in items
    )
    unconfirmed_expiry = sum(
        item.decision is ReviewDecision.accepted
        and item.expiry_date is not None
        and not item.expiry_confirmed
        for item in items
    )
    return ReviewSummary(
        model_candidates=sum(item.origin is ReviewOrigin.model for item in items),
        manual_items=sum(item.origin is ReviewOrigin.manual for item in items),
        pending=pending,
        accepted=accepted,
        rejected=rejected,
        corrected_model_items=sum(
            item.origin is ReviewOrigin.model and bool(item.corrected_fields) for item in items
        ),
        unresolved_accepted_items=unresolved,
        unconfirmed_expiry_items=unconfirmed_expiry,
        ready_to_confirm=pending == 0 and unresolved == 0 and unconfirmed_expiry == 0,
    )


def _initial_review(response: AnalysisResponse, status: AnalysisStatus) -> ReviewDraftResponse:
    created_at = response.created_at
    items = [
        ReviewFoodItem(
            review_item_id=item.item_id,
            source_item_id=item.item_id,
            origin=ReviewOrigin.model,
            decision=ReviewDecision.pending,
            food_name=item.food_name,
            brand=item.brand,
            product_variant=item.product_variant,
            net_content_text=item.net_content_text,
            category=item.category,
            quantity=item.quantity,
            unit=item.unit,
            model_confidence=item.confidence,
            model_review_required=item.review_required,
            model_review_reasons=item.review_reasons,
            packaging_text_evidence=item.packaging_text_evidence,
            expiry_date=item.expiry_date_candidate,
            expiry_confirmed=False,
            model_expiry_date_candidate=item.expiry_date_candidate,
            expiry_text_evidence=item.expiry_text_evidence,
        )
        for item in response.items
    ]
    return ReviewDraftResponse(
        analysis_id=response.analysis_id,
        status=status,
        revision=0,
        items=items,
        summary=_review_summary(items),
        created_at=created_at,
        updated_at=created_at,
    )


def _changed_fields(item: ReviewFoodItem, source: object) -> list[str]:
    changed = [
        field
        for field in _EDITABLE_FIELDS
        if getattr(item, field) != getattr(source, field)
    ]
    if item.expiry_date != source.expiry_date_candidate:
        changed.append("expiry_date")
    if item.decision is ReviewDecision.rejected:
        changed.append("rejected")
    return changed


class Repository:
    def __init__(self, database_path: Path):
        self.database_path = database_path
        self._write_lock = threading.Lock()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 15000")
        connection.execute("PRAGMA synchronous = NORMAL")
        return connection

    @staticmethod
    def _columns(connection: sqlite3.Connection, table: str) -> set[str]:
        return {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}

    def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA wal_autocheckpoint = 1000")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS analyses (
                    analysis_id TEXT PRIMARY KEY,
                    response_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'needs_confirmation',
                    review_json TEXT,
                    review_revision INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT,
                    review_image BLOB,
                    review_image_media_type TEXT,
                    confirmed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS inventory (
                    inventory_id TEXT PRIMARY KEY,
                    analysis_id TEXT NOT NULL,
                    review_item_id TEXT,
                    source_item_id TEXT,
                    origin TEXT NOT NULL DEFAULT 'model',
                    food_name TEXT NOT NULL,
                    brand TEXT,
                    product_variant TEXT,
                    net_content_text TEXT,
                    category TEXT NOT NULL,
                    quantity REAL NOT NULL,
                    unit TEXT NOT NULL,
                    expiry_date TEXT,
                    expiry_source TEXT,
                    notes TEXT,
                    corrected_by_user INTEGER NOT NULL DEFAULT 0,
                    corrected_fields_json TEXT NOT NULL DEFAULT '[]',
                    review_revision INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (analysis_id) REFERENCES analyses(analysis_id)
                );
                CREATE TABLE IF NOT EXISTS review_events (
                    event_id TEXT PRIMARY KEY,
                    analysis_id TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    revision INTEGER NOT NULL,
                    summary_json TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY (analysis_id) REFERENCES analyses(analysis_id)
                );
                CREATE INDEX IF NOT EXISTS idx_inventory_status_created
                    ON inventory(status, created_at);
                CREATE INDEX IF NOT EXISTS idx_review_events_analysis_created
                    ON review_events(analysis_id, created_at);
                """
            )

            analysis_columns = self._columns(connection, "analyses")
            analysis_migrations = {
                "status": "TEXT NOT NULL DEFAULT 'needs_confirmation'",
                "review_json": "TEXT",
                "review_revision": "INTEGER NOT NULL DEFAULT 0",
                "updated_at": "TEXT",
                "review_image": "BLOB",
                "review_image_media_type": "TEXT",
            }
            for column, definition in analysis_migrations.items():
                if column not in analysis_columns:
                    connection.execute(f"ALTER TABLE analyses ADD COLUMN {column} {definition}")
            connection.execute(
                "UPDATE analyses SET status = 'confirmed' "
                "WHERE confirmed_at IS NOT NULL AND status != 'confirmed'"
            )

            inventory_columns = self._columns(connection, "inventory")
            inventory_migrations = {
                "brand": "TEXT",
                "product_variant": "TEXT",
                "net_content_text": "TEXT",
                "review_item_id": "TEXT",
                "origin": "TEXT NOT NULL DEFAULT 'model'",
                "corrected_by_user": "INTEGER NOT NULL DEFAULT 0",
                "corrected_fields_json": "TEXT NOT NULL DEFAULT '[]'",
                "review_revision": "INTEGER NOT NULL DEFAULT 0",
            }
            for column, definition in inventory_migrations.items():
                if column not in inventory_columns:
                    connection.execute(f"ALTER TABLE inventory ADD COLUMN {column} {definition}")

    @staticmethod
    def _record_event(
        connection: sqlite3.Connection,
        draft: ReviewDraftResponse,
        event_type: str,
        created_at: datetime,
    ) -> None:
        connection.execute(
            """
            INSERT INTO review_events (
                event_id, analysis_id, event_type, revision,
                summary_json, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid4()),
                str(draft.analysis_id),
                event_type,
                draft.revision,
                draft.summary.model_dump_json(),
                draft.model_dump_json(),
                created_at.isoformat(),
            ),
        )

    def save_analysis(
        self,
        response: AnalysisResponse,
        review_image: bytes,
        review_image_media_type: str,
    ) -> None:
        now = _now()
        draft = _initial_review(response, AnalysisStatus.needs_confirmation)
        with self._write_lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO analyses (
                    analysis_id, response_json, status, review_json,
                    review_revision, updated_at, review_image, review_image_media_type
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(response.analysis_id),
                    response.model_dump_json(),
                    AnalysisStatus.needs_confirmation.value,
                    draft.model_dump_json(),
                    0,
                    now.isoformat(),
                    review_image,
                    review_image_media_type,
                ),
            )
            self._record_event(connection, draft, "analysis_created", now)

    def get_analysis_image(self, analysis_id: UUID) -> tuple[bytes, str]:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT review_image, review_image_media_type
                FROM analyses WHERE analysis_id = ?
                """,
                (str(analysis_id),),
            ).fetchone()
        if row is None:
            raise AnalysisNotFoundError(str(analysis_id))
        if row["review_image"] is None:
            raise AnalysisImageNotFoundError(str(analysis_id))
        return bytes(row["review_image"]), row["review_image_media_type"] or "image/jpeg"

    def get_analysis(self, analysis_id: UUID) -> AnalysisResponse:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT response_json, status FROM analyses WHERE analysis_id = ?",
                (str(analysis_id),),
            ).fetchone()
        if row is None:
            raise AnalysisNotFoundError(str(analysis_id))
        response = AnalysisResponse.model_validate_json(row["response_json"])
        return response.model_copy(update={"status": AnalysisStatus(row["status"])})

    def _draft_from_row(self, row: sqlite3.Row) -> ReviewDraftResponse:
        if row["review_json"]:
            return ReviewDraftResponse.model_validate_json(row["review_json"])
        response = AnalysisResponse.model_validate_json(row["response_json"])
        return _initial_review(response, AnalysisStatus(row["status"]))

    def get_review(self, analysis_id: UUID) -> ReviewDraftResponse:
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT response_json, status, review_json, review_revision
                FROM analyses WHERE analysis_id = ?
                """,
                (str(analysis_id),),
            ).fetchone()
        if row is None:
            raise AnalysisNotFoundError(str(analysis_id))
        return self._draft_from_row(row)

    def _canonicalize_review(
        self,
        response: AnalysisResponse,
        current: ReviewDraftResponse,
        request: SaveReviewRequest,
    ) -> list[ReviewFoodItem]:
        sources = {item.item_id: item for item in response.items}
        supplied_sources = {
            item.source_item_id for item in request.items if item.source_item_id is not None
        }
        if supplied_sources != set(sources):
            missing = len(set(sources) - supplied_sources)
            unknown = len(supplied_sources - set(sources))
            raise InvalidReviewError(
                "Every model candidate must remain in the review with an explicit decision "
                f"(missing={missing}, unknown={unknown})."
            )

        existing_by_source = {
            item.source_item_id: item for item in current.items if item.source_item_id is not None
        }
        existing_manual = {
            item.review_item_id: item
            for item in current.items
            if item.origin is ReviewOrigin.manual
        }
        canonical: list[ReviewFoodItem] = []
        for update in request.items:
            if update.source_item_id is not None:
                source = sources[update.source_item_id]
                previous = existing_by_source.get(update.source_item_id)
                review_item_id = previous.review_item_id if previous else source.item_id
                if update.review_item_id not in (None, review_item_id):
                    raise InvalidReviewError("A model review_item_id cannot be changed.")
                item = ReviewFoodItem(
                    review_item_id=review_item_id,
                    source_item_id=source.item_id,
                    origin=ReviewOrigin.model,
                    decision=update.decision,
                    food_name=update.food_name,
                    brand=update.brand,
                    product_variant=update.product_variant,
                    net_content_text=update.net_content_text,
                    category=update.category,
                    quantity=update.quantity,
                    unit=update.unit,
                    expiry_date=update.expiry_date,
                    expiry_confirmed=update.expiry_confirmed,
                    notes=update.notes,
                    model_confidence=source.confidence,
                    model_review_required=source.review_required,
                    model_review_reasons=source.review_reasons,
                    packaging_text_evidence=source.packaging_text_evidence,
                    model_expiry_date_candidate=source.expiry_date_candidate,
                    expiry_text_evidence=source.expiry_text_evidence,
                )
                item.corrected_fields = _changed_fields(item, source)
                canonical.append(item)
                continue

            if update.review_item_id is not None:
                if update.review_item_id not in existing_manual:
                    raise InvalidReviewError("Unknown manual review_item_id.")
                review_item_id = update.review_item_id
            else:
                review_item_id = uuid4()
            canonical.append(
                ReviewFoodItem(
                    review_item_id=review_item_id,
                    source_item_id=None,
                    origin=ReviewOrigin.manual,
                    decision=update.decision,
                    food_name=update.food_name,
                    brand=update.brand,
                    product_variant=update.product_variant,
                    net_content_text=update.net_content_text,
                    category=update.category,
                    quantity=update.quantity,
                    unit=update.unit,
                    expiry_date=update.expiry_date,
                    expiry_confirmed=update.expiry_confirmed,
                    notes=update.notes,
                )
            )
        return canonical

    def save_review(self, analysis_id: UUID, request: SaveReviewRequest) -> ReviewDraftResponse:
        now = _now()
        with self._write_lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT response_json, status, review_json, review_revision
                FROM analyses WHERE analysis_id = ?
                """,
                (str(analysis_id),),
            ).fetchone()
            if row is None:
                raise AnalysisNotFoundError(str(analysis_id))
            if row["status"] != AnalysisStatus.needs_confirmation.value:
                raise AnalysisAlreadyConfirmedError(str(analysis_id))
            current_revision = int(row["review_revision"])
            if request.expected_revision != current_revision:
                raise ReviewRevisionConflictError(
                    f"Stale review revision {request.expected_revision}; current revision is "
                    f"{current_revision}."
                )

            response = AnalysisResponse.model_validate_json(row["response_json"])
            current = self._draft_from_row(row)
            items = self._canonicalize_review(response, current, request)
            draft = ReviewDraftResponse(
                analysis_id=analysis_id,
                status=AnalysisStatus.needs_confirmation,
                revision=current_revision + 1,
                items=items,
                summary=_review_summary(items),
                created_at=current.created_at,
                updated_at=now,
            )
            connection.execute(
                """
                UPDATE analyses
                SET review_json = ?, review_revision = ?, updated_at = ?
                WHERE analysis_id = ?
                """,
                (draft.model_dump_json(), draft.revision, now.isoformat(), str(analysis_id)),
            )
            self._record_event(connection, draft, "review_saved", now)
        return draft

    def confirm(
        self,
        analysis_id: UUID,
        request: ConfirmReviewRequest,
    ) -> ConfirmationResponse:
        # The Literal[True] field is deliberately validated before this method is called.
        _ = request.confirm_to_active_inventory
        now = _now()
        entries: list[InventoryEntry] = []
        with self._write_lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT response_json, status, review_json, review_revision
                FROM analyses WHERE analysis_id = ?
                """,
                (str(analysis_id),),
            ).fetchone()
            if row is None:
                raise AnalysisNotFoundError(str(analysis_id))
            if row["status"] != AnalysisStatus.needs_confirmation.value:
                raise AnalysisAlreadyConfirmedError(str(analysis_id))
            current_revision = int(row["review_revision"])
            if request.expected_revision != current_revision:
                raise ReviewRevisionConflictError(
                    f"Stale review revision {request.expected_revision}; current revision is "
                    f"{current_revision}."
                )

            draft = self._draft_from_row(row)
            if not draft.summary.ready_to_confirm:
                raise InvalidReviewError(
                    "Review is incomplete: every row must be accepted or rejected, and accepted "
                    "rows require a positive quantity and a known unit. Any retained expiry "
                    "candidate must also be explicitly confirmed."
                )

            for item in draft.items:
                if item.decision is not ReviewDecision.accepted:
                    continue
                if item.quantity is None or item.unit is GroceryUnit.unknown:
                    raise InvalidReviewError("Accepted review item is unresolved.")
                entry = InventoryEntry(
                    inventory_id=uuid4(),
                    analysis_id=analysis_id,
                    review_item_id=item.review_item_id,
                    source_item_id=item.source_item_id,
                    origin=item.origin,
                    food_name=item.food_name,
                    brand=item.brand,
                    product_variant=item.product_variant,
                    net_content_text=item.net_content_text,
                    category=item.category,
                    quantity=item.quantity,
                    unit=item.unit,
                    expiry_date=item.expiry_date,
                    expiry_source=(
                        (
                            LiteralExpirySource.model_ocr_user_confirmed
                            if item.origin is ReviewOrigin.model
                            and item.expiry_date == item.model_expiry_date_candidate
                            else LiteralExpirySource.user_provided
                        )
                        if item.expiry_date is not None
                        else None
                    ),
                    notes=item.notes,
                    corrected_by_user=(
                        item.origin is ReviewOrigin.model and bool(item.corrected_fields)
                    ),
                    corrected_fields=item.corrected_fields,
                    review_revision=draft.revision,
                    status="active",
                    created_at=now,
                )
                connection.execute(
                    """
                    INSERT INTO inventory (
                        inventory_id, analysis_id, review_item_id, source_item_id, origin,
                        food_name, brand, product_variant, net_content_text, category,
                        quantity, unit, expiry_date, expiry_source, notes,
                        corrected_by_user, corrected_fields_json, review_revision,
                        status, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(entry.inventory_id),
                        str(entry.analysis_id),
                        str(entry.review_item_id),
                        str(entry.source_item_id) if entry.source_item_id else None,
                        entry.origin.value,
                        entry.food_name,
                        entry.brand,
                        entry.product_variant,
                        entry.net_content_text,
                        entry.category,
                        entry.quantity,
                        entry.unit.value,
                        entry.expiry_date.isoformat() if entry.expiry_date else None,
                        entry.expiry_source.value if entry.expiry_source else None,
                        entry.notes,
                        int(entry.corrected_by_user),
                        json.dumps(entry.corrected_fields, ensure_ascii=False),
                        entry.review_revision,
                        entry.status,
                        entry.created_at.isoformat(),
                    ),
                )
                entries.append(entry)

            confirmed_draft = draft.model_copy(
                update={"status": AnalysisStatus.confirmed, "updated_at": now}
            )
            connection.execute(
                """
                UPDATE analyses
                SET status = ?, review_json = ?, updated_at = ?, confirmed_at = ?
                WHERE analysis_id = ?
                """,
                (
                    AnalysisStatus.confirmed.value,
                    confirmed_draft.model_dump_json(),
                    now.isoformat(),
                    now.isoformat(),
                    str(analysis_id),
                ),
            )
            self._record_event(connection, confirmed_draft, "confirmed", now)

        return ConfirmationResponse(
            analysis_id=analysis_id,
            review_revision=draft.revision,
            review_summary=draft.summary,
            inventory_entries=entries,
        )

    def list_active_inventory(self) -> list[InventoryEntry]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM inventory WHERE status = 'active' ORDER BY created_at DESC"
            ).fetchall()
        return [
            InventoryEntry(
                inventory_id=row["inventory_id"],
                analysis_id=row["analysis_id"],
                review_item_id=row["review_item_id"] or row["inventory_id"],
                source_item_id=row["source_item_id"],
                origin=row["origin"],
                food_name=row["food_name"],
                brand=row["brand"],
                product_variant=row["product_variant"],
                net_content_text=row["net_content_text"],
                category=row["category"],
                quantity=row["quantity"],
                unit=row["unit"],
                expiry_date=row["expiry_date"],
                expiry_source=row["expiry_source"],
                notes=row["notes"],
                corrected_by_user=bool(row["corrected_by_user"]),
                corrected_fields=json.loads(row["corrected_fields_json"] or "[]"),
                review_revision=row["review_revision"],
                status=row["status"],
                created_at=row["created_at"],
            )
            for row in rows
        ]

    def get_review_history(self, analysis_id: UUID) -> ReviewHistoryResponse:
        with self._connect() as connection:
            exists = connection.execute(
                "SELECT 1 FROM analyses WHERE analysis_id = ?", (str(analysis_id),)
            ).fetchone()
            if exists is None:
                raise AnalysisNotFoundError(str(analysis_id))
            rows = connection.execute(
                """
                SELECT event_id, event_type, revision, summary_json, created_at
                FROM review_events WHERE analysis_id = ? ORDER BY created_at, rowid
                """,
                (str(analysis_id),),
            ).fetchall()
        return ReviewHistoryResponse(
            analysis_id=analysis_id,
            events=[
                ReviewEvent(
                    event_id=row["event_id"],
                    analysis_id=analysis_id,
                    event_type=row["event_type"],
                    revision=row["revision"],
                    summary=ReviewSummary.model_validate_json(row["summary_json"]),
                    created_at=row["created_at"],
                )
                for row in rows
            ],
        )

    def review_metrics(self) -> ReviewMetricsResponse:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT review_json FROM analyses WHERE status = 'confirmed'"
            ).fetchall()
        reviewed_model_candidates = 0
        accepted_model_items = 0
        rejected_model_items = 0
        corrected_model_items = 0
        manually_added_items = 0
        confirmed_analyses = len(rows)
        for row in rows:
            if not row["review_json"]:
                continue
            draft = ReviewDraftResponse.model_validate_json(row["review_json"])
            for item in draft.items:
                if item.origin is ReviewOrigin.model:
                    reviewed_model_candidates += 1
                    accepted_model_items += item.decision is ReviewDecision.accepted
                    rejected_model_items += item.decision is ReviewDecision.rejected
                    corrected_model_items += bool(item.corrected_fields)
                elif item.decision is ReviewDecision.accepted:
                    manually_added_items += 1
        rate = (
            corrected_model_items / reviewed_model_candidates
            if reviewed_model_candidates
            else None
        )
        return ReviewMetricsResponse(
            confirmed_analyses=confirmed_analyses,
            reviewed_model_candidates=reviewed_model_candidates,
            accepted_model_items=accepted_model_items,
            rejected_model_items=rejected_model_items,
            corrected_model_items=corrected_model_items,
            manually_added_items=manually_added_items,
            user_correction_rate=rate,
        )

    def confidence_diagnostics(self) -> ConfidenceDiagnosticsResponse:
        """Summarize observed review outcomes without pretending to calibrate scores."""

        bounds = ((0.0, 0.5), (0.5, 0.72), (0.72, 0.85), (0.85, 1.0))
        counters = [
            {"model_candidates": 0, "accepted_unchanged": 0, "corrected_or_rejected": 0}
            for _ in bounds
        ]
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT review_json FROM analyses WHERE status = 'confirmed'"
            ).fetchall()
        for row in rows:
            if not row["review_json"]:
                continue
            draft = ReviewDraftResponse.model_validate_json(row["review_json"])
            for item in draft.items:
                if item.origin is not ReviewOrigin.model or item.model_confidence is None:
                    continue
                confidence = item.model_confidence
                for index, (lower, upper) in enumerate(bounds):
                    if lower <= confidence < upper or (upper == 1.0 and confidence == 1.0):
                        counters[index]["model_candidates"] += 1
                        if (
                            item.decision is ReviewDecision.accepted
                            and not item.corrected_fields
                        ):
                            counters[index]["accepted_unchanged"] += 1
                        else:
                            counters[index]["corrected_or_rejected"] += 1
                        break

        bins = []
        for (lower, upper), counter in zip(bounds, counters):
            count = counter["model_candidates"]
            bins.append(
                ConfidenceBinMetrics(
                    lower_bound=lower,
                    upper_bound=upper,
                    model_candidates=count,
                    accepted_unchanged=counter["accepted_unchanged"],
                    corrected_or_rejected=counter["corrected_or_rejected"],
                    observed_unchanged_rate=(
                        counter["accepted_unchanged"] / count if count else None
                    ),
                )
            )
        return ConfidenceDiagnosticsResponse(
            confirmed_model_candidates=sum(item.model_candidates for item in bins),
            note=(
                "Observed user-review outcomes only. These bins do not calibrate model "
                "confidence or authorize automatic acceptance."
            ),
            bins=bins,
        )


@lru_cache(maxsize=1)
def get_repository() -> Repository:
    repository = Repository(get_settings().database_path)
    repository.initialize()
    return repository
