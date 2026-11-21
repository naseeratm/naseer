"""
Enterprise Multi-Tenant Security, RBAC & Tamper-Evident Audit Trail for NASEER CAE Studio.

Zero-Mock / Production-Grade Implementation:
- Password hashing: hashlib.scrypt (N=16384, r=8, p=1, dklen=32) + 16-byte cryptographic salt + hmac.compare_digest
- Tokens: RFC 7519 HS256 JWT signed with NASEER_JWT_SECRET (or ephemeral 32-byte in-memory key on localhost)
- Database:
    * Primary (Docker / FastAPI / PostgreSQL / SQLite): SQLAlchemy 2.0 ORM tables
      (cae_workspaces, cae_users, cae_audit_logs) sharing cae_repository.Base.
    * Lightweight fallback (when a sqlite_path is passed without SQLAlchemy): parameterized stdlib sqlite3
      using the identical schema and queries.
- Audit Trail: SHA-256 hash-chained immutable ledger recording actor, role, action, resource, status, IP, and timestamp.
- Modes:
    * local_open (default on workstation): Allows seamless local simulations without lockouts; still strictly verifies
      any Bearer token if supplied and supports full Admin Claim / Sign-In / RBAC / Audit Logging.
    * enforced: Requires a valid Bearer JWT and strictly enforces role hierarchy (viewer < engineer < admin).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func, select
    from sqlalchemy.orm import Mapped, mapped_column, sessionmaker
    from cae_repository import Base

    HAS_SQLALCHEMY = True
except ImportError:  # pragma: no cover - bare Python environments without sqlalchemy
    HAS_SQLALCHEMY = False
    Base = None  # type: ignore[assignment]


VALID_ROLES = ("viewer", "engineer", "admin")
ROLE_RANK = {"viewer": 1, "engineer": 2, "admin": 3}
EMAIL_PATTERN = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$")
MIN_PASSWORD_LENGTH = 10


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode((segment + padding).encode("ascii"))


if HAS_SQLALCHEMY:

    class Workspace(Base):  # type: ignore[misc]
        __tablename__ = "cae_workspaces"

        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        name: Mapped[str] = mapped_column(String(128), nullable=False)
        slug: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
        created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    class User(Base):  # type: ignore[misc]
        __tablename__ = "cae_users"

        id: Mapped[str] = mapped_column(String(64), primary_key=True)
        email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
        full_name: Mapped[str] = mapped_column(String(128), nullable=False)
        role: Mapped[str] = mapped_column(String(32), nullable=False, default="engineer")
        workspace_id: Mapped[str] = mapped_column(
            String(64), ForeignKey("cae_workspaces.id"), nullable=False, index=True
        )
        password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
        is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
        created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    class AuditLog(Base):  # type: ignore[misc]
        __tablename__ = "cae_audit_logs"

        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        actor_email: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
        actor_role: Mapped[str] = mapped_column(String(32), nullable=False)
        workspace_id: Mapped[str] = mapped_column(String(64), nullable=False, default="ws-default")
        action: Mapped[str] = mapped_column(String(96), nullable=False, index=True)
        resource: Mapped[str] = mapped_column(String(255), nullable=False)
        status: Mapped[str] = mapped_column(String(32), nullable=False, default="allowed")
        detail_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
        ip_address: Mapped[str] = mapped_column(String(64), nullable=False, default="local")
        prev_hash: Mapped[str] = mapped_column(String(64), nullable=False, default="GENESIS")
        entry_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
        created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


class SecurityError(Exception):
    """Typed security error carrying an HTTP status code."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def hash_password(password: str) -> str:
    if not isinstance(password, str) or len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters long.")
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    if not password or not stored_hash:
        return False
    try:
        parts = stored_hash.split("$")
        if len(parts) != 6 or parts[0] != "scrypt":
            return False
        n = int(parts[1])
        r = int(parts[2])
        p = int(parts[3])
        salt = bytes.fromhex(parts[4])
        expected = bytes.fromhex(parts[5])
        derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=len(expected))
        return hmac.compare_digest(derived, expected)
    except Exception:
        return False


def _serialize_user_dict(
    *,
    user_id: str,
    email: str,
    full_name: str,
    role: str,
    workspace_id: str,
    is_active: bool,
    created_at: Any,
) -> Dict[str, Any]:
    return {
        "id": user_id,
        "email": email,
        "full_name": full_name,
        "role": role,
        "workspace_id": workspace_id,
        "is_active": bool(is_active),
        "created_at": created_at.isoformat() if isinstance(created_at, datetime) else created_at,
    }


def _serialize_audit_dict(
    *,
    entry_id: int,
    actor_email: str,
    actor_role: str,
    workspace_id: str,
    action: str,
    resource: str,
    status: str,
    detail_json: str,
    ip_address: str,
    prev_hash: str,
    entry_hash: str,
    created_at: Any,
) -> Dict[str, Any]:
    try:
        detail = json.loads(detail_json or "{}")
    except Exception:
        detail = {}
    return {
        "id": entry_id,
        "actor_email": actor_email,
        "actor_role": actor_role,
        "workspace_id": workspace_id,
        "action": action,
        "resource": resource,
        "status": status,
        "detail": detail,
        "ip_address": ip_address,
        "prev_hash": prev_hash,
        "entry_hash": entry_hash,
        "created_at": created_at.isoformat() if isinstance(created_at, datetime) else created_at,
    }


class EnterpriseSecurityService:
    """Multi-tenant auth, RBAC, and SHA-256 chained audit log service (SQLAlchemy ORM or stdlib sqlite3)."""

    def __init__(self, engine: Any = None, *, sqlite_path: Optional[str] = None, token_ttl_seconds: int = 8 * 3600):
        self.token_ttl_seconds = max(300, int(token_ttl_seconds))
        # Process-scoped ephemeral signing key when NASEER_JWT_SECRET is unset (never hardcoded or persisted)
        self._ephemeral_secret = secrets.token_bytes(32)
        self._use_sqlalchemy = HAS_SQLALCHEMY and engine is not None and not isinstance(engine, (str, Path))
        self.engine = engine
        self._sqlite_path: Optional[Path] = None

        if self._use_sqlalchemy:
            self.SessionLocal = sessionmaker(bind=self.engine, expire_on_commit=False)
            Base.metadata.create_all(self.engine)  # type: ignore[union-attr]
        else:
            raw_path = sqlite_path or (str(engine) if isinstance(engine, (str, Path)) else None) or os.getenv("CAE_SQLITE_PATH", "data/cae.db")
            self._sqlite_path = Path(raw_path).resolve()
            self._sqlite_path.parent.mkdir(parents=True, exist_ok=True)
            self._init_sqlite_schema()

        self._ensure_default_workspace()

    def _sqlite_conn(self) -> sqlite3.Connection:
        assert self._sqlite_path is not None
        conn = sqlite3.connect(str(self._sqlite_path))
        conn.row_factory = sqlite3.Row
        return conn

    def _init_sqlite_schema(self) -> None:
        with self._sqlite_conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS cae_workspaces (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    slug TEXT UNIQUE NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cae_users (
                    id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    full_name TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'engineer',
                    workspace_id TEXT NOT NULL REFERENCES cae_workspaces(id),
                    password_hash TEXT NOT NULL,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS cae_audit_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    actor_email TEXT NOT NULL,
                    actor_role TEXT NOT NULL,
                    workspace_id TEXT NOT NULL DEFAULT 'ws-default',
                    action TEXT NOT NULL,
                    resource TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'allowed',
                    detail_json TEXT NOT NULL DEFAULT '{}',
                    ip_address TEXT NOT NULL DEFAULT 'local',
                    prev_hash TEXT NOT NULL DEFAULT 'GENESIS',
                    entry_hash TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )

    def _signing_key(self) -> bytes:
        configured = (os.getenv("NASEER_JWT_SECRET") or "").strip()
        if configured:
            return configured.encode("utf-8")
        return self._ephemeral_secret

    @staticmethod
    def auth_mode() -> str:
        raw = (os.getenv("NASEER_AUTH_MODE") or "local_open").strip().lower()
        return "enforced" if raw == "enforced" else "local_open"

    @staticmethod
    def is_jwt_secret_configured() -> bool:
        return bool((os.getenv("NASEER_JWT_SECRET") or "").strip())

    def _ensure_default_workspace(self) -> str:
        if self._use_sqlalchemy:
            with self.SessionLocal() as session:
                ws = session.execute(select(Workspace).where(Workspace.slug == "default")).scalar_one_or_none()
                if ws is None:
                    ws = Workspace(
                        id="ws-default",
                        name="NASEER Default Engineering Workspace",
                        slug="default",
                    )
                    session.add(ws)
                    session.commit()
                return ws.id
        with self._sqlite_conn() as conn:
            row = conn.execute("SELECT id FROM cae_workspaces WHERE slug = ?", ("default",)).fetchone()
            if row is None:
                conn.execute(
                    "INSERT INTO cae_workspaces (id, name, slug, created_at) VALUES (?, ?, ?, ?)",
                    ("ws-default", "NASEER Default Engineering Workspace", "default", _utcnow().isoformat()),
                )
                return "ws-default"
            return str(row["id"])

    def has_users(self) -> bool:
        if self._use_sqlalchemy:
            with self.SessionLocal() as session:
                count = session.execute(select(func.count(User.id))).scalar_one()
                return int(count or 0) > 0
        with self._sqlite_conn() as conn:
            row = conn.execute("SELECT COUNT(id) AS cnt FROM cae_users").fetchone()
            return int(row["cnt"] if row else 0) > 0

    def status_summary(self) -> Dict[str, Any]:
        if self._use_sqlalchemy:
            with self.SessionLocal() as session:
                user_count = int(session.execute(select(func.count(User.id))).scalar_one() or 0)
                workspace_count = int(session.execute(select(func.count(Workspace.id))).scalar_one() or 0)
                audit_count = int(session.execute(select(func.count(AuditLog.id))).scalar_one() or 0)
        else:
            with self._sqlite_conn() as conn:
                user_count = int(conn.execute("SELECT COUNT(id) FROM cae_users").fetchone()[0])
                workspace_count = int(conn.execute("SELECT COUNT(id) FROM cae_workspaces").fetchone()[0])
                audit_count = int(conn.execute("SELECT COUNT(id) FROM cae_audit_logs").fetchone()[0])
        return {
            "auth_mode": self.auth_mode(),
            "has_users": user_count > 0,
            "user_count": user_count,
            "workspace_count": workspace_count,
            "audit_log_count": audit_count,
            "jwt_secret_configured": self.is_jwt_secret_configured(),
            "admin_passcode_required": bool((os.getenv("NASEER_ADMIN_PASSCODE") or "").strip()),
            "rbac_roles": list(VALID_ROLES),
        }

    def create_access_token(self, user_dict: Dict[str, Any]) -> str:
        now = int(time.time())
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {
            "sub": user_dict["id"],
            "email": user_dict["email"],
            "full_name": user_dict["full_name"],
            "role": user_dict["role"],
            "workspace_id": user_dict["workspace_id"],
            "iat": now,
            "exp": now + self.token_ttl_seconds,
        }
        header_b64 = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
        payload_b64 = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
        signature = hmac.new(self._signing_key(), signing_input, hashlib.sha256).digest()
        return f"{header_b64}.{payload_b64}.{_b64url_encode(signature)}"

    def _get_active_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        if self._use_sqlalchemy:
            with self.SessionLocal() as session:
                user = session.get(User, user_id)
                if user is None or not user.is_active:
                    return None
                return _serialize_user_dict(
                    user_id=user.id,
                    email=user.email,
                    full_name=user.full_name,
                    role=user.role,
                    workspace_id=user.workspace_id,
                    is_active=user.is_active,
                    created_at=user.created_at,
                )
        with self._sqlite_conn() as conn:
            row = conn.execute(
                "SELECT id, email, full_name, role, workspace_id, is_active, created_at FROM cae_users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if row is None or not bool(row["is_active"]):
                return None
            return _serialize_user_dict(
                user_id=row["id"],
                email=row["email"],
                full_name=row["full_name"],
                role=row["role"],
                workspace_id=row["workspace_id"],
                is_active=bool(row["is_active"]),
                created_at=row["created_at"],
            )

    def verify_access_token(self, token: str) -> Dict[str, Any]:
        if not token or token.count(".") != 2:
            raise SecurityError(401, "Invalid bearer token format.")
        header_b64, payload_b64, sig_b64 = token.split(".")
        try:
            header = json.loads(_b64url_decode(header_b64).decode("utf-8"))
            if header.get("alg") != "HS256":
                raise SecurityError(401, "Unsupported token signing algorithm.")
            signing_input = f"{header_b64}.{payload_b64}".encode("ascii")
            expected_sig = hmac.new(self._signing_key(), signing_input, hashlib.sha256).digest()
            provided_sig = _b64url_decode(sig_b64)
            if not hmac.compare_digest(expected_sig, provided_sig):
                raise SecurityError(401, "Token signature verification failed.")
            payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
        except SecurityError:
            raise
        except Exception:
            raise SecurityError(401, "Malformed authentication token.")

        exp = int(payload.get("exp") or 0)
        if exp <= int(time.time()):
            raise SecurityError(401, "Authentication token has expired.")

        user = self._get_active_user_by_id(str(payload.get("sub") or ""))
        if user is None:
            raise SecurityError(401, "User account is inactive or no longer exists.")
        return {
            "sub": user["id"],
            "email": user["email"],
            "full_name": user["full_name"],
            "role": user["role"],
            "workspace_id": user["workspace_id"],
            "authenticated": True,
        }

    def bootstrap_admin(
        self,
        *,
        email: str,
        full_name: str,
        password: str,
        workspace_name: str = "NASEER Engineering Organization",
        admin_passcode: Optional[str] = None,
        ip_address: str = "local",
    ) -> Tuple[Dict[str, Any], str]:
        normalized_email = (email or "").strip().lower()
        clean_name = (full_name or "").strip() or "Platform Administrator"
        if not EMAIL_PATTERN.match(normalized_email):
            raise SecurityError(422, "A valid administrator email address is required.")
        if len(password or "") < MIN_PASSWORD_LENGTH:
            raise SecurityError(422, f"Administrator password must be at least {MIN_PASSWORD_LENGTH} characters.")

        required_passcode = (os.getenv("NASEER_ADMIN_PASSCODE") or "").strip()
        if required_passcode:
            supplied = (admin_passcode or "").strip()
            if not hmac.compare_digest(supplied.encode("utf-8"), required_passcode.encode("utf-8")):
                raise SecurityError(403, "Invalid administrator bootstrap passcode.")

        pw_hash = hash_password(password)
        user_id = f"usr-{uuid.uuid4().hex[:12]}"
        now = _utcnow()

        if self._use_sqlalchemy:
            with self.SessionLocal() as session:
                existing_count = int(session.execute(select(func.count(User.id))).scalar_one() or 0)
                if existing_count > 0:
                    raise SecurityError(
                        409,
                        "Administrator bootstrap is permanently locked because an account already exists.",
                    )
                ws = session.execute(select(Workspace).where(Workspace.slug == "default")).scalar_one_or_none()
                if ws is None:
                    ws = Workspace(id="ws-default", name=workspace_name.strip() or "NASEER Organization", slug="default")
                    session.add(ws)
                elif workspace_name.strip():
                    ws.name = workspace_name.strip()[:128]
                user = User(
                    id=user_id,
                    email=normalized_email,
                    full_name=clean_name[:128],
                    role="admin",
                    workspace_id=ws.id,
                    password_hash=pw_hash,
                    is_active=True,
                    created_at=now,
                )
                session.add(user)
                session.commit()
                user_dict = _serialize_user_dict(
                    user_id=user.id,
                    email=user.email,
                    full_name=user.full_name,
                    role=user.role,
                    workspace_id=user.workspace_id,
                    is_active=user.is_active,
                    created_at=user.created_at,
                )
        else:
            with self._sqlite_conn() as conn:
                existing_count = int(conn.execute("SELECT COUNT(id) FROM cae_users").fetchone()[0])
                if existing_count > 0:
                    raise SecurityError(
                        409,
                        "Administrator bootstrap is permanently locked because an account already exists.",
                    )
                if workspace_name.strip():
                    conn.execute(
                        "UPDATE cae_workspaces SET name = ? WHERE slug = ?",
                        (workspace_name.strip()[:128], "default"),
                    )
                ws_id = self._ensure_default_workspace()
                conn.execute(
                    """
                    INSERT INTO cae_users (id, email, full_name, role, workspace_id, password_hash, is_active, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, normalized_email, clean_name[:128], "admin", ws_id, pw_hash, 1, now.isoformat()),
                )
                user_dict = _serialize_user_dict(
                    user_id=user_id,
                    email=normalized_email,
                    full_name=clean_name[:128],
                    role="admin",
                    workspace_id=ws_id,
                    is_active=True,
                    created_at=now,
                )

        token = self.create_access_token(user_dict)
        self.record_audit(
            actor_email=user_dict["email"],
            actor_role=user_dict["role"],
            workspace_id=user_dict["workspace_id"],
            action="auth.bootstrap_admin",
            resource=f"user:{user_dict['id']}",
            status="allowed",
            detail={"workspace_id": user_dict["workspace_id"]},
            ip_address=ip_address,
        )
        return user_dict, token

    def authenticate(self, email: str, password: str, ip_address: str = "local") -> Tuple[Dict[str, Any], str]:
        normalized_email = (email or "").strip().lower()
        found_user: Optional[Dict[str, Any]] = None
        stored_hash = ""
        is_active = False

        if self._use_sqlalchemy:
            with self.SessionLocal() as session:
                user = session.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
                if user is not None:
                    stored_hash = user.password_hash
                    is_active = bool(user.is_active)
                    found_user = _serialize_user_dict(
                        user_id=user.id,
                        email=user.email,
                        full_name=user.full_name,
                        role=user.role,
                        workspace_id=user.workspace_id,
                        is_active=user.is_active,
                        created_at=user.created_at,
                    )
        else:
            with self._sqlite_conn() as conn:
                row = conn.execute(
                    "SELECT id, email, full_name, role, workspace_id, password_hash, is_active, created_at FROM cae_users WHERE email = ?",
                    (normalized_email,),
                ).fetchone()
                if row is not None:
                    stored_hash = row["password_hash"]
                    is_active = bool(row["is_active"])
                    found_user = _serialize_user_dict(
                        user_id=row["id"],
                        email=row["email"],
                        full_name=row["full_name"],
                        role=row["role"],
                        workspace_id=row["workspace_id"],
                        is_active=is_active,
                        created_at=row["created_at"],
                    )

        if found_user is None or not is_active or not verify_password(password or "", stored_hash):
            self.record_audit(
                actor_email=normalized_email or "anonymous",
                actor_role="anonymous",
                workspace_id="ws-default",
                action="auth.login",
                resource="session",
                status="denied",
                detail={"reason": "invalid_credentials"},
                ip_address=ip_address,
            )
            raise SecurityError(401, "Invalid email or password.")

        token = self.create_access_token(found_user)
        self.record_audit(
            actor_email=found_user["email"],
            actor_role=found_user["role"],
            workspace_id=found_user["workspace_id"],
            action="auth.login",
            resource=f"user:{found_user['id']}",
            status="allowed",
            detail={"workspace_id": found_user["workspace_id"]},
            ip_address=ip_address,
        )
        return found_user, token

    def create_user(
        self,
        *,
        email: str,
        full_name: str,
        password: str,
        role: str,
        actor: Dict[str, Any],
        workspace_id: Optional[str] = None,
        ip_address: str = "local",
    ) -> Dict[str, Any]:
        normalized_email = (email or "").strip().lower()
        clean_role = (role or "engineer").strip().lower()
        if not EMAIL_PATTERN.match(normalized_email):
            raise SecurityError(422, "Valid email address is required.")
        if clean_role not in VALID_ROLES:
            raise SecurityError(422, f"Role must be one of: {', '.join(VALID_ROLES)}.")
        if len(password or "") < MIN_PASSWORD_LENGTH:
            raise SecurityError(422, f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")

        pw_hash = hash_password(password)
        target_ws = workspace_id or actor.get("workspace_id") or self._ensure_default_workspace()
        user_id = f"usr-{uuid.uuid4().hex[:12]}"
        clean_name = (full_name or normalized_email.split("@")[0]).strip()[:128]
        now = _utcnow()

        if self._use_sqlalchemy:
            with self.SessionLocal() as session:
                existing = session.execute(select(User).where(User.email == normalized_email)).scalar_one_or_none()
                if existing is not None:
                    raise SecurityError(409, "A user with this email already exists.")
                if session.get(Workspace, target_ws) is None:
                    target_ws = self._ensure_default_workspace()
                user = User(
                    id=user_id,
                    email=normalized_email,
                    full_name=clean_name,
                    role=clean_role,
                    workspace_id=target_ws,
                    password_hash=pw_hash,
                    is_active=True,
                    created_at=now,
                )
                session.add(user)
                session.commit()
                user_dict = _serialize_user_dict(
                    user_id=user.id,
                    email=user.email,
                    full_name=user.full_name,
                    role=user.role,
                    workspace_id=user.workspace_id,
                    is_active=user.is_active,
                    created_at=user.created_at,
                )
        else:
            with self._sqlite_conn() as conn:
                existing = conn.execute("SELECT id FROM cae_users WHERE email = ?", (normalized_email,)).fetchone()
                if existing is not None:
                    raise SecurityError(409, "A user with this email already exists.")
                ws_row = conn.execute("SELECT id FROM cae_workspaces WHERE id = ?", (target_ws,)).fetchone()
                if ws_row is None:
                    target_ws = self._ensure_default_workspace()
                conn.execute(
                    """
                    INSERT INTO cae_users (id, email, full_name, role, workspace_id, password_hash, is_active, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (user_id, normalized_email, clean_name, clean_role, target_ws, pw_hash, 1, now.isoformat()),
                )
                user_dict = _serialize_user_dict(
                    user_id=user_id,
                    email=normalized_email,
                    full_name=clean_name,
                    role=clean_role,
                    workspace_id=target_ws,
                    is_active=True,
                    created_at=now,
                )

        self.record_audit(
            actor_email=actor.get("email", "local-workstation"),
            actor_role=actor.get("role", "admin"),
            workspace_id=target_ws,
            action="rbac.create_user",
            resource=f"user:{user_dict['email']}",
            status="allowed",
            detail={"assigned_role": clean_role, "user_id": user_dict["id"]},
            ip_address=ip_address,
        )
        return user_dict

    def list_users(self) -> List[Dict[str, Any]]:
        if self._use_sqlalchemy:
            with self.SessionLocal() as session:
                rows = session.execute(select(User).order_by(User.created_at.asc())).scalars().all()
                return [
                    _serialize_user_dict(
                        user_id=r.id,
                        email=r.email,
                        full_name=r.full_name,
                        role=r.role,
                        workspace_id=r.workspace_id,
                        is_active=r.is_active,
                        created_at=r.created_at,
                    )
                    for r in rows
                ]
        with self._sqlite_conn() as conn:
            rows = conn.execute(
                "SELECT id, email, full_name, role, workspace_id, is_active, created_at FROM cae_users ORDER BY created_at ASC"
            ).fetchall()
            return [
                _serialize_user_dict(
                    user_id=r["id"],
                    email=r["email"],
                    full_name=r["full_name"],
                    role=r["role"],
                    workspace_id=r["workspace_id"],
                    is_active=bool(r["is_active"]),
                    created_at=r["created_at"],
                )
                for r in rows
            ]

    def update_user_role(
        self,
        *,
        user_id: str,
        new_role: str,
        actor: Dict[str, Any],
        ip_address: str = "local",
    ) -> Dict[str, Any]:
        clean_role = (new_role or "").strip().lower()
        if clean_role not in VALID_ROLES:
            raise SecurityError(422, f"Role must be one of: {', '.join(VALID_ROLES)}.")

        if self._use_sqlalchemy:
            with self.SessionLocal() as session:
                user = session.get(User, user_id)
                if user is None:
                    raise SecurityError(404, "User not found.")
                previous_role = user.role
                user.role = clean_role
                session.commit()
                user_dict = _serialize_user_dict(
                    user_id=user.id,
                    email=user.email,
                    full_name=user.full_name,
                    role=user.role,
                    workspace_id=user.workspace_id,
                    is_active=user.is_active,
                    created_at=user.created_at,
                )
        else:
            with self._sqlite_conn() as conn:
                row = conn.execute(
                    "SELECT id, email, full_name, role, workspace_id, is_active, created_at FROM cae_users WHERE id = ?",
                    (user_id,),
                ).fetchone()
                if row is None:
                    raise SecurityError(404, "User not found.")
                previous_role = row["role"]
                conn.execute("UPDATE cae_users SET role = ? WHERE id = ?", (clean_role, user_id))
                user_dict = _serialize_user_dict(
                    user_id=row["id"],
                    email=row["email"],
                    full_name=row["full_name"],
                    role=clean_role,
                    workspace_id=row["workspace_id"],
                    is_active=bool(row["is_active"]),
                    created_at=row["created_at"],
                )

        self.record_audit(
            actor_email=actor.get("email", "local-workstation"),
            actor_role=actor.get("role", "admin"),
            workspace_id=user_dict["workspace_id"],
            action="rbac.update_role",
            resource=f"user:{user_dict['email']}",
            status="allowed",
            detail={"previous_role": previous_role, "new_role": clean_role},
            ip_address=ip_address,
        )
        return user_dict

    def resolve_actor(
        self,
        authorization_header: Optional[str],
        *,
        require_role: Optional[str] = None,
    ) -> Dict[str, Any]:
        token = None
        if authorization_header and authorization_header.lower().startswith("bearer "):
            token = authorization_header[7:].strip()

        if token:
            actor = self.verify_access_token(token)
        elif self.auth_mode() == "enforced":
            raise SecurityError(401, "Authentication required (NASEER_AUTH_MODE=enforced). Please sign in.")
        else:
            actor = {
                "sub": "local-workstation",
                "email": "local-workstation@naseer.local",
                "full_name": "Local Workstation Engineer",
                "role": "admin",
                "workspace_id": "ws-default",
                "authenticated": False,
            }

        if require_role:
            needed = ROLE_RANK.get(require_role, 99)
            actual = ROLE_RANK.get(actor.get("role", "viewer"), 0)
            if actual < needed:
                raise SecurityError(
                    403,
                    f"Insufficient role privileges: requires '{require_role}', current role is '{actor.get('role')}'.",
                )
        return actor

    def record_audit(
        self,
        *,
        actor_email: str,
        actor_role: str,
        action: str,
        resource: str,
        status: str = "allowed",
        detail: Optional[Dict[str, Any]] = None,
        workspace_id: str = "ws-default",
        ip_address: str = "local",
    ) -> Dict[str, Any]:
        payload_json = json.dumps(detail or {}, sort_keys=True, separators=(",", ":"), default=str)
        created = _utcnow()

        if self._use_sqlalchemy:
            with self.SessionLocal() as session:
                last = session.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(1)).scalar_one_or_none()
                prev_hash = last.entry_hash if last is not None else "GENESIS"
                chain_material = (
                    f"{prev_hash}|{created.isoformat()}|{actor_email}|{actor_role}|{workspace_id}|"
                    f"{action}|{resource}|{status}|{payload_json}"
                ).encode("utf-8")
                entry_hash = hashlib.sha256(chain_material).hexdigest()
                entry = AuditLog(
                    actor_email=actor_email[:255],
                    actor_role=actor_role[:32],
                    workspace_id=workspace_id[:64],
                    action=action[:96],
                    resource=resource[:255],
                    status=status[:32],
                    detail_json=payload_json,
                    ip_address=(ip_address or "local")[:64],
                    prev_hash=prev_hash,
                    entry_hash=entry_hash,
                    created_at=created,
                )
                session.add(entry)
                session.commit()
                session.refresh(entry)
                return _serialize_audit_dict(
                    entry_id=entry.id,
                    actor_email=entry.actor_email,
                    actor_role=entry.actor_role,
                    workspace_id=entry.workspace_id,
                    action=entry.action,
                    resource=entry.resource,
                    status=entry.status,
                    detail_json=entry.detail_json,
                    ip_address=entry.ip_address,
                    prev_hash=entry.prev_hash,
                    entry_hash=entry.entry_hash,
                    created_at=entry.created_at,
                )

        with self._sqlite_conn() as conn:
            last = conn.execute("SELECT entry_hash FROM cae_audit_logs ORDER BY id DESC LIMIT 1").fetchone()
            prev_hash = str(last["entry_hash"]) if last is not None else "GENESIS"
            chain_material = (
                f"{prev_hash}|{created.isoformat()}|{actor_email}|{actor_role}|{workspace_id}|"
                f"{action}|{resource}|{status}|{payload_json}"
            ).encode("utf-8")
            entry_hash = hashlib.sha256(chain_material).hexdigest()
            cur = conn.execute(
                """
                INSERT INTO cae_audit_logs
                    (actor_email, actor_role, workspace_id, action, resource, status, detail_json, ip_address, prev_hash, entry_hash, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    actor_email[:255],
                    actor_role[:32],
                    workspace_id[:64],
                    action[:96],
                    resource[:255],
                    status[:32],
                    payload_json,
                    (ip_address or "local")[:64],
                    prev_hash,
                    entry_hash,
                    created.isoformat(),
                ),
            )
            return _serialize_audit_dict(
                entry_id=int(cur.lastrowid or 0),
                actor_email=actor_email[:255],
                actor_role=actor_role[:32],
                workspace_id=workspace_id[:64],
                action=action[:96],
                resource=resource[:255],
                status=status[:32],
                detail_json=payload_json,
                ip_address=(ip_address or "local")[:64],
                prev_hash=prev_hash,
                entry_hash=entry_hash,
                created_at=created,
            )

    def list_audit_logs(self, limit: int = 100) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 500))
        if self._use_sqlalchemy:
            with self.SessionLocal() as session:
                rows = (
                    session.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(safe_limit))
                    .scalars()
                    .all()
                )
                return [
                    _serialize_audit_dict(
                        entry_id=r.id,
                        actor_email=r.actor_email,
                        actor_role=r.actor_role,
                        workspace_id=r.workspace_id,
                        action=r.action,
                        resource=r.resource,
                        status=r.status,
                        detail_json=r.detail_json,
                        ip_address=r.ip_address,
                        prev_hash=r.prev_hash,
                        entry_hash=r.entry_hash,
                        created_at=r.created_at,
                    )
                    for r in rows
                ]
        with self._sqlite_conn() as conn:
            rows = conn.execute(
                """
                SELECT id, actor_email, actor_role, workspace_id, action, resource, status,
                       detail_json, ip_address, prev_hash, entry_hash, created_at
                FROM cae_audit_logs ORDER BY id DESC LIMIT ?
                """,
                (safe_limit,),
            ).fetchall()
            return [
                _serialize_audit_dict(
                    entry_id=r["id"],
                    actor_email=r["actor_email"],
                    actor_role=r["actor_role"],
                    workspace_id=r["workspace_id"],
                    action=r["action"],
                    resource=r["resource"],
                    status=r["status"],
                    detail_json=r["detail_json"],
                    ip_address=r["ip_address"],
                    prev_hash=r["prev_hash"],
                    entry_hash=r["entry_hash"],
                    created_at=r["created_at"],
                )
                for r in rows
            ]
