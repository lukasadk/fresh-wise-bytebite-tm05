"""Bounded process-local job tracking for long-running MVP inference calls."""

from __future__ import annotations

import threading
from collections.abc import Callable
from datetime import datetime, timezone
from functools import lru_cache
from uuid import UUID, uuid4

from .config import get_settings
from .schemas import (
    RecognitionEngine,
    RecognitionJobResponse,
    RecognitionJobState,
)


class RecognitionJobNotFoundError(KeyError):
    pass


class RecognitionJobQueueFullError(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


class RecognitionJobManager:
    """Keeps a small, bounded queue without claiming durable job semantics."""

    def __init__(self, capacity: int, history_limit: int) -> None:
        self.capacity = capacity
        self.history_limit = history_limit
        self._jobs: dict[UUID, RecognitionJobResponse] = {}
        self._lock = threading.Lock()

    def _active_count(self) -> int:
        return sum(
            job.state in {RecognitionJobState.queued, RecognitionJobState.running}
            for job in self._jobs.values()
        )

    def _trim_history(self) -> None:
        if len(self._jobs) < self.history_limit:
            return
        completed = sorted(
            (
                job
                for job in self._jobs.values()
                if job.state in {RecognitionJobState.succeeded, RecognitionJobState.failed}
            ),
            key=lambda job: job.updated_at,
        )
        while len(self._jobs) >= self.history_limit and completed:
            self._jobs.pop(completed.pop(0).job_id, None)

    def create(self, engine: RecognitionEngine) -> RecognitionJobResponse:
        with self._lock:
            if self._active_count() >= self.capacity:
                raise RecognitionJobQueueFullError(
                    f"Recognition queue is full (capacity={self.capacity})."
                )
            self._trim_history()
            now = _now()
            job = RecognitionJobResponse(
                job_id=uuid4(),
                engine=engine,
                state=RecognitionJobState.queued,
                phase="queued",
                progress=0.0,
                created_at=now,
                updated_at=now,
            )
            self._jobs[job.job_id] = job
            return job.model_copy(deep=True)

    def update(self, job_id: UUID, **changes: object) -> RecognitionJobResponse:
        with self._lock:
            current = self._jobs.get(job_id)
            if current is None:
                raise RecognitionJobNotFoundError(str(job_id))
            changes["updated_at"] = _now()
            updated = current.model_copy(update=changes)
            self._jobs[job_id] = updated
            return updated.model_copy(deep=True)

    def get(self, job_id: UUID) -> RecognitionJobResponse:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise RecognitionJobNotFoundError(str(job_id))
            return job.model_copy(deep=True)

    def submit(
        self,
        job_id: UUID,
        target: Callable[[Callable[[str, float], None]], UUID],
    ) -> None:
        def run() -> None:
            try:
                self.update(
                    job_id,
                    state=RecognitionJobState.running,
                    phase="preparing_inference",
                    progress=0.1,
                )

                def progress(phase: str, value: float) -> None:
                    self.update(job_id, phase=phase, progress=value)

                analysis_id = target(progress)
                self.update(
                    job_id,
                    state=RecognitionJobState.succeeded,
                    phase="completed",
                    progress=1.0,
                    analysis_id=analysis_id,
                    error=None,
                )
            except Exception as exc:
                self.update(
                    job_id,
                    state=RecognitionJobState.failed,
                    phase="failed",
                    progress=1.0,
                    error=str(exc)[:500],
                )

        threading.Thread(
            target=run,
            name=f"wastewise-recognition-{job_id}",
            daemon=True,
        ).start()


@lru_cache(maxsize=1)
def get_recognition_job_manager() -> RecognitionJobManager:
    settings = get_settings()
    return RecognitionJobManager(
        capacity=settings.recognition_job_queue_capacity,
        history_limit=settings.recognition_job_history_limit,
    )

