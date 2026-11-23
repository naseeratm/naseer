"""
Phase 4 Enterprise Multi-Tenant SaaS Unit Tests (Zero-Mock Verified):
1. Scrypt password hashing, salt uniqueness, and verification.
2. HS256 JWT signing, verification, and tamper rejection.
3. First-run Admin Claim bootstrap lock (409 on second attempt) and RBAC enforcement
   across local_open vs enforced modes (viewer < engineer < admin).
4. SHA-256 hash-chained immutable audit log ledger verification.
5. ObjectStorageService local ZIP archiving with SHA-256 + path traversal confinement.
6. Cloud/HPC manifests (K8s, Slurm, Enterprise Compose, CI/CD) and Dockerfile COPY checks.
"""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from enterprise_security import (
    EnterpriseSecurityService,
    HAS_SQLALCHEMY,
    SecurityError,
    hash_password,
    verify_password,
)
from object_storage import ObjectStorageError, ObjectStorageService


class TestPhase4Enterprise(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmp_dir.name) / "enterprise_test.db"
        self.engine = None
        if HAS_SQLALCHEMY:
            from sqlalchemy import create_engine

            self.engine = create_engine(f"sqlite:///{self.db_path}", future=True)
            self.sec = EnterpriseSecurityService(self.engine)
        else:
            self.sec = EnterpriseSecurityService(sqlite_path=str(self.db_path))

    def tearDown(self):
        if self.engine is not None:
            self.engine.dispose()
        self.tmp_dir.cleanup()

    def test_scrypt_password_hashing_and_salting(self):
        h1 = hash_password("SuperSecureCAE!2026")
        h2 = hash_password("SuperSecureCAE!2026")
        self.assertTrue(h1.startswith("scrypt$16384$8$1$"))
        self.assertNotEqual(h1, h2)
        self.assertTrue(verify_password("SuperSecureCAE!2026", h1))
        self.assertFalse(verify_password("WrongPassword!2026", h1))
        with self.assertRaises(ValueError):
            hash_password("short")

    def test_bootstrap_locks_after_first_admin_and_jwt_tamper_rejected(self):
        self.assertFalse(self.sec.has_users())
        admin, token = self.sec.bootstrap_admin(
            email="lead@naseer-cae.org",
            full_name="Lead CAE Admin",
            password="EnterpriseAdminPassword!99",
            workspace_name="Aerospace Propulsion Lab",
        )
        self.assertEqual(admin["role"], "admin")
        self.assertTrue(self.sec.has_users())

        # Second bootstrap attempt must fail with 409 Conflict
        with self.assertRaises(SecurityError) as ctx:
            self.sec.bootstrap_admin(
                email="attacker@example.com",
                full_name="Attacker",
                password="AnotherLongPassword!99",
            )
        self.assertEqual(ctx.exception.status_code, 409)

        # Valid JWT verifies cleanly
        verified = self.sec.verify_access_token(token)
        self.assertEqual(verified["email"], "lead@naseer-cae.org")
        self.assertEqual(verified["role"], "admin")

        # Tampered JWT must fail with 401
        parts = token.split(".")
        tampered = f"{parts[0]}.{parts[1]}.{'A' * len(parts[2])}"
        with self.assertRaises(SecurityError) as tctx:
            self.sec.verify_access_token(tampered)
        self.assertEqual(tctx.exception.status_code, 401)

    def test_rbac_enforcement_in_local_open_vs_enforced_mode(self):
        admin, admin_token = self.sec.bootstrap_admin(
            email="admin@lab.io",
            full_name="Admin User",
            password="AdminStrongPassword!123",
        )
        viewer = self.sec.create_user(
            email="viewer@lab.io",
            full_name="Viewer User",
            password="ViewerStrongPassword!123",
            role="viewer",
            actor=admin,
        )
        self.assertEqual(viewer["role"], "viewer")
        _, viewer_token = self.sec.authenticate("viewer@lab.io", "ViewerStrongPassword!123")

        # In local_open mode, anonymous local caller succeeds
        with patch.dict(os.environ, {"NASEER_AUTH_MODE": "local_open"}):
            local_actor = self.sec.resolve_actor(None, require_role="engineer")
            self.assertEqual(local_actor["sub"], "local-workstation")

        # Even in local_open mode, if a viewer Bearer token IS sent, RBAC blocks engineer actions
        with patch.dict(os.environ, {"NASEER_AUTH_MODE": "local_open"}):
            with self.assertRaises(SecurityError) as vctx:
                self.sec.resolve_actor(f"Bearer {viewer_token}", require_role="engineer")
            self.assertEqual(vctx.exception.status_code, 403)

        # In enforced mode, anonymous fails with 401 while admin succeeds
        with patch.dict(os.environ, {"NASEER_AUTH_MODE": "enforced"}):
            with self.assertRaises(SecurityError) as actx:
                self.sec.resolve_actor(None, require_role="viewer")
            self.assertEqual(actx.exception.status_code, 401)

            resolved = self.sec.resolve_actor(f"Bearer {admin_token}", require_role="admin")
            self.assertEqual(resolved["email"], "admin@lab.io")

    def test_sha256_hash_chained_audit_logs(self):
        e1 = self.sec.record_audit(
            actor_email="eng@lab.io",
            actor_role="engineer",
            action="simulation.submit",
            resource="job:101",
        )
        e2 = self.sec.record_audit(
            actor_email="eng@lab.io",
            actor_role="engineer",
            action="storage.archive_case",
            resource="job:101",
        )
        self.assertEqual(e1["prev_hash"], "GENESIS")
        self.assertEqual(e2["prev_hash"], e1["entry_hash"])
        self.assertEqual(len(e2["entry_hash"]), 64)
        logs = self.sec.list_audit_logs(limit=10)
        self.assertEqual(len(logs), 2)

    def test_object_storage_local_archive_and_path_confinement(self):
        allowed_root = Path(self.tmp_dir.name) / "jobs"
        case_dir = allowed_root / "case_alpha"
        case_dir.mkdir(parents=True)
        (case_dir / "solver.log").write_text("OpenFOAM converged\n", encoding="utf-8")

        outside_dir = Path(self.tmp_dir.name) / "outside_secret"
        outside_dir.mkdir(parents=True)
        (outside_dir / "secret.txt").write_text("do not archive", encoding="utf-8")

        archive_dir = Path(self.tmp_dir.name) / "archives"
        with patch.dict(os.environ, {"NASEER_S3_BUCKET": ""}):
            storage = ObjectStorageService(local_archive_dir=str(archive_dir))
            st = storage.status()
            self.assertEqual(st["backend"], "local")
            self.assertTrue(st["reachable"])

            archived = storage.archive_case_directory(
                task_id="task-alpha-01",
                case_dir=str(case_dir),
                allowed_roots=[allowed_root],
            )
            self.assertEqual(archived["backend"], "local")
            self.assertEqual(archived["file_count"], 1)
            self.assertTrue(Path(archived["uri"]).is_file())
            self.assertEqual(len(archived["sha256"]), 64)

            listed = storage.list_archives()
            self.assertEqual(len(listed), 1)

            # Path outside allowed root must be blocked with 403
            with self.assertRaises(ObjectStorageError) as octx:
                storage.archive_case_directory(
                    task_id="task-bad-02",
                    case_dir=str(outside_dir),
                    allowed_roots=[allowed_root],
                )
            self.assertEqual(octx.exception.status_code, 403)

    def test_deployment_manifests_and_docker_packaging_present(self):
        root = Path(__file__).resolve().parent
        required_files = [
            "enterprise_security.py",
            "object_storage.py",
            "docker-compose.enterprise.yml",
            "deploy/k8s/naseer-cae-stack.yaml",
            "deploy/slurm/submit_naseer_job.sbatch",
            ".github/workflows/ci-cd.yml",
        ]
        for rel in required_files:
            self.assertTrue((root / rel).is_file(), f"Missing Phase 4 deliverable: {rel}")

        api_df = (root / "Dockerfile.api").read_text(encoding="utf-8")
        worker_df = (root / "Dockerfile.worker").read_text(encoding="utf-8")
        self.assertIn("enterprise_security.py", api_df)
        self.assertIn("object_storage.py", api_df)
        self.assertIn("COPY deploy/ ./deploy/", api_df)
        self.assertIn("enterprise_security.py", worker_df)
        self.assertIn("object_storage.py", worker_df)

    def test_security_hardening_rbac_manifests_and_in_memory_auth(self):
        root = Path(__file__).resolve().parent

        # 1. Manifests must expose unified Redis broker + shared job root vars
        for manifest_rel in ("docker-compose.enterprise.yml", "deploy/k8s/naseer-cae-stack.yaml"):
            text = (root / manifest_rel).read_text(encoding="utf-8")
            self.assertIn("CELERY_BROKER_URL", text, f"Missing CELERY_BROKER_URL in {manifest_rel}")
            self.assertIn("CELERY_RESULT_BACKEND", text, f"Missing CELERY_RESULT_BACKEND in {manifest_rel}")
            self.assertIn("NASEER_JOB_DIR", text, f"Missing NASEER_JOB_DIR in {manifest_rel}")
            self.assertIn("OPENFOAM_CASE_ROOT", text, f"Missing OPENFOAM_CASE_ROOT in {manifest_rel}")

        # 2. main.py must enforce resolve_actor across protected simulation/job/CAD routes
        main_src = (root / "main.py").read_text(encoding="utf-8")
        self.assertGreaterEqual(main_src.count("security_service.resolve_actor("), 15)
        self.assertIn('res.get("case_directory")', main_src)
        self.assertNotIn('Path("/tmp")', main_src)

        # 3. Frontend auth modules must stay strictly in-memory (zero web storage API calls)
        for rel_ts in ("src/utils/enterpriseAuth.ts", "src/components/EnterpriseAdminModal.tsx"):
            ts_src = (root / rel_ts).read_text(encoding="utf-8")
            self.assertNotIn("localStorage.", ts_src)
            self.assertNotIn("sessionStorage.", ts_src)


if __name__ == "__main__":
    unittest.main()
