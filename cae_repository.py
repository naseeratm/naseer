"""Persistent CAE jobs repository.

The SQLAlchemy backend supports SQLite locally and PostgreSQL in production.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import (
    Column,
    DateTime,
    Integer,
    String,
    Text,
    create_engine,
    select,
)
from sqlalchemy.orm import DeclarativeBase, Session


class Base(DeclarativeBase):
    pass


class Job(Base):
    __tablename__ = "cae_jobs"

    id = Column(String, primary_key=True)
    project_id = Column(String, nullable=False, index=True, default="")
    case_id = Column(String, nullable=False, default="")
    solver = Column(String, nullable=False, default="")
    status = Column(String, nullable=False, default="QUEUED", index=True)
    progress = Column(Integer, nullable=False, default=0)
    payload_json = Column(Text, nullable=False, default="{}")
    result_json = Column(Text, nullable=True)
    error = Column(Text, nullable=True)
    logs_json = Column(Text, nullable=False, default="[]")
    artifacts_json = Column(Text, nullable=False, default="[]")
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class JobRepository:
    def __init__(self) -> None:
        database_url = os.getenv("CAE_DATABASE_URL", "").strip()
        if not database_url:
            database_file = Path(os.getenv("CAE_SQLITE_PATH", "data/cae.db")).resolve()
            database_file.parent.mkdir(parents=True, exist_ok=True)
            database_url = f"sqlite:///{database_file.as_posix()}"
        if database_url.startswith("postgres://"):
            database_url = database_url.replace("postgres://", "postgresql://", 1)

        kwargs: dict[str, Any] = {"future": True}
        if database_url.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        self.engine = create_engine(database_url, **kwargs)
        Base.metadata.create_all(self.engine)

    @staticmethod
    def _loads(value: str | None, default: Any) -> Any:
        if not value:
            return default
        try:
            return json.loads(value)
        except (TypeError, json.JSONDecodeError):
            return default

    def create(self, task_id: str, data: dict[str, Any]) -> dict[str, Any]:
        now = utcnow()
        with Session(self.engine) as session:
            job = Job(
                id=task_id,
                project_id=str(data.get("project_id", "")),
                case_id=str(data.get("case_id", "")),
                solver=str(data.get("solver", "")),
                status="QUEUED",
                progress=0,
                payload_json=json.dumps(data, ensure_ascii=False, default=str),
                logs_json=json.dumps([f"[{now.isoformat()}] Job queued"], ensure_ascii=False),
                created_at=now,
                updated_at=now,
            )
            session.merge(job)
            session.commit()
        return self.get(task_id) or {}

    def update(
        self,
        task_id: str,
        *,
        status: str,
        progress: int | None = None,
        logs: list[Any] | None = None,
        artifacts: list[Any] | None = None,
        result: Any = None,
        error: str | None = None,
    ) -> dict[str, Any] | None:
        with Session(self.engine) as session:
            job = session.get(Job, task_id)
            if job is None:
                return None
            now = utcnow()
            job.status = status.upper()
            job.updated_at = now
            if progress is not None:
                job.progress = max(0, min(100, progress))
            if logs is not None:
                job.logs_json = json.dumps(logs, ensure_ascii=False, default=str)
            if artifacts is not None:
                job.artifacts_json = json.dumps(artifacts, ensure_ascii=False, default=str)
            if result is not None:
                job.result_json = json.dumps(result, ensure_ascii=False, default=str)
            if error is not None:
                job.error = error
            if status.upper() == "RUNNING" and job.started_at is None:
                job.started_at = now
            if status.upper() in {"COMPLETED", "FAILED", "CANCELLED"} and job.completed_at is None:
                job.completed_at = now
            session.commit()
        return self.get(task_id)

    def get(self, task_id: str) -> dict[str, Any] | None:
        with Session(self.engine) as session:
            job = session.get(Job, task_id)
            return self._serialize(job) if job else None

    def list(self, project_id: str | None = None) -> list[dict[str, Any]]:
        with Session(self.engine) as session:
            statement = select(Job).order_by(Job.created_at.desc())
            if project_id:
                statement = statement.where(Job.project_id == project_id)
            return [self._serialize(job) for job in session.scalars(statement)]

    def _serialize(self, job: Job) -> dict[str, Any]:
        return {
            "task_id": job.id,
            "project_id": job.project_id,
            "case_id": job.case_id,
            "solver": job.solver,
            "status": job.status,
            "progress": job.progress,
            "payload": self._loads(job.payload_json, {}),
            "result": self._loads(job.result_json, None),
            "error": job.error,
            "logs": self._loads(job.logs_json, []),
            "artifacts": self._loads(job.artifacts_json, []),
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "updated_at": job.updated_at.isoformat() if job.updated_at else None,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        }
