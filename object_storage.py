"""
Enterprise Object Storage Service (S3 / MinIO / Local Archive) for NASEER CAE Studio.

Zero-Mock / Real Execution:
- When NASEER_S3_BUCKET is configured, connects to real AWS S3 or self-hosted MinIO via boto3.
- When NASEER_S3_BUCKET is unset, stores verifiable SHA-256 ZIP archives on the local archive volume.
- Strict path confinement ensures only directories inside approved CAE job roots can be archived.
- Secret keys are read strictly from server environment variables and NEVER returned in status payloads.
"""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


SAFE_TASK_ID_PATTERN = re.compile(r"^[A-Za-z0-9._\-]{1,128}$")


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class ObjectStorageError(Exception):
    def __init__(self, status_code: int, detail: str):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class ObjectStorageService:
    def __init__(self, local_archive_dir: Optional[str] = None):
        default_archive = os.getenv("NASEER_LOCAL_ARCHIVE_DIR") or str(
            Path(os.getenv("CAE_WORK_DIR", "/tmp/naseer_cae_jobs")) / "_archives"
        )
        self.local_archive_dir = Path(local_archive_dir or default_archive).resolve()
        self.local_archive_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _s3_config() -> Dict[str, str]:
        return {
            "bucket": (os.getenv("NASEER_S3_BUCKET") or "").strip(),
            "endpoint": (os.getenv("NASEER_S3_ENDPOINT") or "").strip(),
            "region": (os.getenv("NASEER_S3_REGION") or "us-east-1").strip(),
            "access_key": (os.getenv("NASEER_S3_ACCESS_KEY") or "").strip(),
            "secret_key": (os.getenv("NASEER_S3_SECRET_KEY") or "").strip(),
        }

    def _create_boto_client(self):
        cfg = self._s3_config()
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:
            raise ObjectStorageError(
                503,
                "boto3 is not installed in this Python runtime. Install boto3>=1.34.0 to enable S3/MinIO archiving.",
            ) from exc

        kwargs: Dict[str, Any] = {
            "service_name": "s3",
            "region_name": cfg["region"] or "us-east-1",
            "config": Config(connect_timeout=4, read_timeout=15, retries={"max_attempts": 2}),
        }
        if cfg["endpoint"]:
            kwargs["endpoint_url"] = cfg["endpoint"]
        if cfg["access_key"] and cfg["secret_key"]:
            kwargs["aws_access_key_id"] = cfg["access_key"]
            kwargs["aws_secret_access_key"] = cfg["secret_key"]
        return boto3.client(**kwargs)

    def status(self) -> Dict[str, Any]:
        cfg = self._s3_config()
        bucket = cfg["bucket"]
        try:
            import boto3  # noqa: F401
            boto3_installed = True
        except ImportError:
            boto3_installed = False

        if not bucket:
            return {
                "backend": "local",
                "configured": True,
                "reachable": self.local_archive_dir.exists(),
                "bucket": None,
                "endpoint": None,
                "region": None,
                "local_archive_dir": str(self.local_archive_dir),
                "boto3_installed": boto3_installed,
                "message": "Local archive volume active. Configure NASEER_S3_BUCKET to stream case packs to S3/MinIO.",
            }

        reachable = False
        message = "S3/MinIO bucket configured."
        if not boto3_installed:
            message = "NASEER_S3_BUCKET is set, but boto3 is not installed in this environment."
        else:
            try:
                client = self._create_boto_client()
                client.head_bucket(Bucket=bucket)
                reachable = True
                message = f"Connected to real S3/MinIO bucket '{bucket}'."
            except Exception as exc:
                message = f"S3/MinIO bucket probe failed: {exc}"

        return {
            "backend": "s3",
            "configured": True,
            "reachable": reachable,
            "bucket": bucket,
            "endpoint": cfg["endpoint"] or "https://s3.amazonaws.com",
            "region": cfg["region"],
            "local_archive_dir": str(self.local_archive_dir),
            "boto3_installed": boto3_installed,
            "message": message,
        }

    @staticmethod
    def _validate_case_dir(case_dir: Path, allowed_roots: List[Path]) -> Path:
        resolved = case_dir.resolve()
        if not resolved.exists() or not resolved.is_dir():
            raise ObjectStorageError(404, "Simulation case directory does not exist on disk.")
        confined = False
        for root in allowed_roots:
            try:
                if resolved.is_relative_to(root.resolve()):
                    confined = True
                    break
            except Exception:
                continue
        if not confined:
            raise ObjectStorageError(403, "Case directory is outside the approved CAE storage root.")
        return resolved

    def _zip_directory(self, source_dir: Path, destination_zip: Path) -> int:
        file_count = 0
        with zipfile.ZipFile(destination_zip, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for item in sorted(source_dir.rglob("*")):
                if item.is_file() and not item.is_symlink():
                    rel = item.relative_to(source_dir)
                    zf.write(item, arcname=str(rel))
                    file_count += 1
        return file_count

    def archive_case_directory(
        self,
        *,
        task_id: str,
        case_dir: str,
        allowed_roots: List[Path],
    ) -> Dict[str, Any]:
        if not SAFE_TASK_ID_PATTERN.match(task_id or ""):
            raise ObjectStorageError(422, "Invalid task_id for archive packaging.")

        resolved_dir = self._validate_case_dir(Path(case_dir), allowed_roots)
        cfg = self._s3_config()
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        archive_name = f"{task_id}_{timestamp}.zip"

        if cfg["bucket"]:
            client = self._create_boto_client()
            with tempfile.TemporaryDirectory(prefix="naseer_archive_") as tmp_dir:
                tmp_zip = Path(tmp_dir) / archive_name
                file_count = self._zip_directory(resolved_dir, tmp_zip)
                sha256 = _sha256_file(tmp_zip)
                size_bytes = tmp_zip.stat().st_size
                object_key = f"cases/{archive_name}"
                try:
                    client.upload_file(
                        str(tmp_zip),
                        cfg["bucket"],
                        object_key,
                        ExtraArgs={
                            "ContentType": "application/zip",
                            "Metadata": {
                                "task-id": task_id,
                                "sha256": sha256,
                                "file-count": str(file_count),
                            },
                        },
                    )
                except Exception as exc:
                    raise ObjectStorageError(502, f"S3/MinIO upload failed: {exc}") from exc

            return {
                "backend": "s3",
                "task_id": task_id,
                "archive_name": archive_name,
                "uri": f"s3://{cfg['bucket']}/{object_key}",
                "size_bytes": size_bytes,
                "file_count": file_count,
                "sha256": sha256,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }

        dest_zip = (self.local_archive_dir / archive_name).resolve()
        if not dest_zip.is_relative_to(self.local_archive_dir):
            raise ObjectStorageError(403, "Invalid archive destination path.")
        file_count = self._zip_directory(resolved_dir, dest_zip)
        sha256 = _sha256_file(dest_zip)
        size_bytes = dest_zip.stat().st_size
        return {
            "backend": "local",
            "task_id": task_id,
            "archive_name": archive_name,
            "uri": str(dest_zip),
            "size_bytes": size_bytes,
            "file_count": file_count,
            "sha256": sha256,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }

    def list_archives(self, limit: int = 50) -> List[Dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 200))
        cfg = self._s3_config()
        if cfg["bucket"]:
            try:
                client = self._create_boto_client()
                resp = client.list_objects_v2(Bucket=cfg["bucket"], Prefix="cases/", MaxKeys=safe_limit)
                items = []
                for obj in sorted(
                    resp.get("Contents", []),
                    key=lambda x: x.get("LastModified", datetime.min.replace(tzinfo=timezone.utc)),
                    reverse=True,
                ):
                    key = obj["Key"]
                    items.append(
                        {
                            "backend": "s3",
                            "archive_name": Path(key).name,
                            "uri": f"s3://{cfg['bucket']}/{key}",
                            "size_bytes": int(obj.get("Size", 0)),
                            "created_at": obj["LastModified"].isoformat() if obj.get("LastModified") else None,
                        }
                    )
                return items[:safe_limit]
            except Exception:
                return []

        items: List[Dict[str, Any]] = []
        if self.local_archive_dir.exists():
            zips = sorted(
                self.local_archive_dir.glob("*.zip"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            for path in zips[:safe_limit]:
                stat = path.stat()
                items.append(
                    {
                        "backend": "local",
                        "archive_name": path.name,
                        "uri": str(path),
                        "size_bytes": stat.st_size,
                        "created_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    }
                )
        return items
