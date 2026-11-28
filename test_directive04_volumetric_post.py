"""
Automated Unit Tests for Directive 04:
1. Directive 03 cleanup & Git hygiene (VTK POLYDATA SystemExit immunity, V&V callback resilience,
   `.gitignore` rules, worker-only PyVista layer in Dockerfile.worker).
2. Zero-copy-friendly `NSR1` binary container packing/unpacking & strict 4-byte alignment.
3. Real headless PyVista/VTK volumetric engine (metadata, outer surface, cutting-plane slice,
   3D RK4 streamlines, Marching-Cubes iso-surface, and CalculiX `.inp`+`.dat` loader — skipped
   cleanly only if `pyvista` is absent on a bare local host, executed in full inside Docker worker).
4. RBAC-protected, path-confined FastAPI `/api/jobs/{task_id}/post/*` routes & binary streaming.
"""

from __future__ import annotations

import asyncio
import base64
import math
import os
import struct
import sys
import tempfile
import types
import unittest
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import MagicMock, patch

import universal_dispatcher
import vv_regression_suite
from backend import volumetric_post
from enterprise_security import EnterpriseSecurityService
from test_async_heartbeat_sse import (
    _BoundTaskSelf,
    _FakeRequest,
    _InMemoryJobRepository,
    _import_main_module,
    _invoke_bound_task,
)


def _as_flat_list(val: Any) -> List[Any]:
    if hasattr(val, "ravel"):
        return val.ravel().tolist()
    if isinstance(val, list) and val and isinstance(val[0], list):
        return [item for row in val for item in row]
    return list(val)


class TestDirective04CleanupAndHygiene(unittest.TestCase):
    def test_gitignore_and_scratch_job_hygiene(self) -> None:
        if not Path(".gitignore").is_file():
            self.skipTest(".gitignore not present in container")
        gitignore = Path(".gitignore").read_text(encoding="utf-8")
        lines = [ln.strip() for ln in gitignore.splitlines()]
        self.assertIn("jobs/", lines)
        self.assertIn("audit_bundle/", lines)
        for stale in (
            "jobs/openfoam-6211a5f9dba7",
            "jobs/openfoam-a6ce57d89c69",
            "jobs/openfoam-a6e3da46e875",
            "jobs/openfoam-d1ba41f2509d",
        ):
            self.assertFalse(Path(stale).exists(), f"Scratch job folder should be removed: {stale}")

    def test_worker_only_pyvista_requirements_and_dockerfiles(self) -> None:
        if not Path("worker-requirements.txt").is_file() or not Path("Dockerfile.worker").is_file():
            self.skipTest("Dockerfile.worker / worker-requirements.txt not present in container")
        wreq = Path("worker-requirements.txt").read_text(encoding="utf-8")
        self.assertIn("pyvista", wreq.lower())

        worker_df = Path("Dockerfile.worker").read_text(encoding="utf-8")
        self.assertIn("worker-requirements.txt", worker_df)
        self.assertIn("pip install -r worker-requirements.txt", worker_df)
        self.assertIn("file_parser.py", worker_df)

        if Path("Dockerfile.api").is_file():
            api_df = Path("Dockerfile.api").read_text(encoding="utf-8")
            self.assertNotIn("worker-requirements.txt", api_df)
            self.assertNotIn("pyvista", api_df.lower())
            self.assertIn("file_parser.py", api_df)

    def test_pyvista_049_streamlines_max_length_and_dataset_surface_kwargs(self) -> None:
        # Verify PyVista 0.49 compatibility even on hosts without PyVista installed using lightweight stubs
        seen_extract_kwargs: Dict[str, Any] = {}
        seen_stream_kwargs: Dict[str, Any] = {}

        class _FakePoly:
            n_points = 3
            n_cells = 1
            bounds = (0.0, 1.0, 0.0, 1.0, 0.0, 1.0)
            points = [[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]]
            faces = [3, 0, 1, 2]
            lines = [3, 0, 1, 2]
            point_data = {"T": [300.0, 310.0, 320.0], "U": [[2.0, 0.0, 0.0], [2.0, 0.0, 0.0], [2.0, 0.0, 0.0]]}

            def triangulate(self):
                return self

            def compute_normals(self, **_kwargs):
                return self

        class _FakeDataset:
            n_points = 3
            n_cells = 1
            bounds = (0.0, 2.0, 0.0, 1.0, 0.0, 1.0)
            point_data = {"T": [300.0, 310.0, 320.0], "U": [[2.0, 0.0, 0.0], [2.0, 0.0, 0.0], [2.0, 0.0, 0.0]]}

            def extract_surface(self, **kwargs):
                seen_extract_kwargs.update(kwargs)
                return _FakePoly()

            def streamlines(self, **kwargs):
                if "max_time" in kwargs:
                    raise TypeError("PyVista 0.49 removed max_time; use max_length")
                seen_stream_kwargs.update(kwargs)
                return _FakePoly()

        fake_ds = _FakeDataset()
        if not volumetric_post.HAS_NUMPY:
            # Test _extract_surface helper directly when numpy is absent
            volumetric_post._extract_surface(fake_ds)
            self.assertEqual(seen_extract_kwargs.get("algorithm"), "dataset_surface")
            return

        with patch.object(volumetric_post, "load_case_volume", return_value=(fake_ds, Path("internal.vtu"))):
            surf_blob = volumetric_post.export_case_surface_binary(".", field_name="T")
            self.assertEqual(seen_extract_kwargs.get("algorithm"), "dataset_surface")
            self.assertEqual(surf_blob[:4], b"NSR1")

            stream_blob = volumetric_post.compute_volumetric_streamlines(".", vector_field="U", n_seeds=12, max_time=3.0)
            self.assertIn("max_length", seen_stream_kwargs)
            self.assertNotIn("max_time", seen_stream_kwargs)
            self.assertGreater(seen_stream_kwargs["max_length"], 0.0)
            self.assertEqual(stream_blob[:4], b"NSR1")

    def test_extract_bad_cell_points_survives_meshio_system_exit(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            vtk_file = Path(td) / "nonOrthoFaces.vtk"
            vtk_file.write_text(
                "# vtk DataFile Version 2.0\n"
                "nonOrthoFaces\n"
                "ASCII\n"
                "DATASET POLYDATA\n"
                "POINTS 3 float\n"
                "0.1 0.2 0.3\n"
                "1.5 -0.4 0.8\n"
                "2.0 3.0 4.0\n"
                "POLYGONS 1 4\n"
                "3 0 1 2\n",
                encoding="utf-8",
            )
            vtu_file = Path(td) / "skewFaces.vtu"
            vtu_file.write_text("<VTKFile type='UnstructuredGrid'/>", encoding="utf-8")

            crashing_meshio = types.ModuleType("meshio")

            def _boom(_path: str):
                sys.exit(1)

            crashing_meshio.read = _boom  # type: ignore[attr-defined]

            with patch.dict(sys.modules, {"meshio": crashing_meshio}):
                pts = universal_dispatcher._extract_bad_cell_points_from_vtk([vtk_file, vtu_file])

            self.assertEqual(len(pts), 3)
            self.assertAlmostEqual(pts[0][0], 0.1, places=5)
            self.assertAlmostEqual(pts[1][1], -0.4, places=5)
            self.assertAlmostEqual(pts[2][2], 4.0, places=5)

    def test_vv_suite_callbacks_resilient_to_legacy_and_3arg_signatures(self) -> None:
        empty_caps = {
            "openfoam": {"available": False, "version": None},
            "calculix": {"available": False, "version": None},
            "gmsh": {"available": False, "version": None},
            "elmer": {"available": False, "version": None},
        }
        seen_3arg: List[str] = []

        def _cb_3arg(bench_res: Dict[str, Any], idx: int, total: int) -> None:
            seen_3arg.append(f"{idx}/{total}:{bench_res['benchmark_id']}")

        first_bid = vv_regression_suite.VV_BENCHMARKS[0]["id"]
        report = vv_regression_suite.run_vv_suite(
            [first_bid],
            capabilities=empty_caps,
            on_benchmark_complete=_cb_3arg,
        )
        self.assertEqual(report["summary"]["skipped"], 1)
        self.assertEqual(seen_3arg, [f"1/1:{first_bid}"])

        # Also test worker task when patched run_vv_suite does not accept callback kwargs
        repo = _InMemoryJobRepository()
        repo.create("vv-legacy-01", {"action": "vv_suite"})
        bound_self = _BoundTaskSelf("vv-legacy-01")

        def _legacy_run_vv(selected_ids=None, *, executor=None, capabilities=None):
            return report

        with (
            patch.object(universal_dispatcher, "_job_repository", return_value=repo),
            patch.object(universal_dispatcher, "probe_worker_capabilities", return_value=empty_caps),
            patch.object(vv_regression_suite, "run_vv_suite", side_effect=_legacy_run_vv),
        ):
            res = _invoke_bound_task(universal_dispatcher.run_vv_suite_task, bound_self, [first_bid])

        self.assertTrue(res["success"])
        self.assertEqual(repo.get("vv-legacy-01")["status"], "COMPLETED")


class TestDirective04BinaryNSR1Protocol(unittest.TestCase):
    def test_pack_and_unpack_roundtrip_and_strict_4byte_alignment(self) -> None:
        points = [
            [0.0, 0.0, 0.0],
            [1.25, -0.5, 2.75],
            [0.5, 1.0, -3.5],
        ]
        indices = [0, 1, 2]
        scalars = [300.5, 350.25, 400.75]

        # Test all 4 JSON header length remainders mod 4 to verify padding alignment
        for pad_len in range(4):
            meta = {
                "operation": "slice",
                "field": "T" + ("x" * pad_len),
                "min": 300.5,
                "max": 400.75,
            }
            blob = volumetric_post.pack_mesh_binary(
                meta,
                {
                    "points": ("float32", points, [3, 3]),
                    "indices": ("uint32", indices, [3]),
                    "scalars": ("float32", scalars, [3]),
                },
            )
            self.assertEqual(blob[:4], b"NSR1")
            header_len = struct.unpack("<I", blob[4:8])[0]
            self.assertEqual((8 + header_len) % 4, 0, "Binary section must begin on 4-byte boundary")

            out_meta, out_bufs = volumetric_post.unpack_mesh_binary(blob)
            self.assertEqual(out_meta["operation"], "slice")
            self.assertEqual(out_meta["field"], meta["field"])
            self.assertEqual(_as_flat_list(out_bufs["indices"]), [0, 1, 2])
            flat_pts = _as_flat_list(out_bufs["points"])
            expected_pts = [0.0, 0.0, 0.0, 1.25, -0.5, 2.75, 0.5, 1.0, -3.5]
            for a, b in zip(flat_pts, expected_pts):
                self.assertAlmostEqual(a, b, places=5)
            flat_scalars = _as_flat_list(out_bufs["scalars"])
            for a, b in zip(flat_scalars, scalars):
                self.assertAlmostEqual(a, b, places=4)

    def test_unpack_rejects_corrupt_or_truncated_blobs(self) -> None:
        with self.assertRaises(ValueError):
            volumetric_post.unpack_mesh_binary(b"BAD!" + b"\x00" * 16)
        with self.assertRaises(ValueError):
            volumetric_post.unpack_mesh_binary(b"NSR1" + struct.pack("<I", 9999) + b"{}")


class TestDirective04PyVistaVolumetricEngine(unittest.TestCase):
    def setUp(self) -> None:
        if not volumetric_post.HAS_PYVISTA:
            self.skipTest("pyvista/vtk not installed on bare local host; executed in full inside Docker worker.")

        import numpy as np
        import pyvista as pv

        self.tmp = tempfile.TemporaryDirectory()
        self.case_dir = Path(self.tmp.name) / "case_cfd"
        vtk_dir = self.case_dir / "VTK"
        vtk_dir.mkdir(parents=True, exist_ok=True)

        # Build a genuine 3D hexahedral UnstructuredGrid on [0, 2] x [0, 1] x [0, 1]
        grid = pv.ImageData(dimensions=(11, 7, 7), spacing=(0.2, 1.0 / 6.0, 1.0 / 6.0), origin=(0.0, 0.0, 0.0))
        ugrid = grid.cast_to_unstructured_grid()
        pts = ugrid.points
        x = pts[:, 0]
        y = pts[:, 1]
        # Analytical scalar T(x, y, z) = 300 + 50*x + 20*y  (range [300, 420])
        ugrid.point_data["T"] = (300.0 + 50.0 * x + 20.0 * y).astype(np.float32)
        # Analytical 3D velocity vector U(x, y, z) = (2.0, 0.25*sin(pi*x), 0.1)
        vel = np.column_stack([
            np.full_like(x, 2.0),
            0.25 * np.sin(math.pi * x),
            np.full_like(x, 0.1),
        ]).astype(np.float32)
        ugrid.point_data["U"] = vel
        ugrid.save(str(vtk_dir / "internal_100.vtu"))

        # Add a real checkMesh failure set ASCII VTK POLYDATA file
        (vtk_dir / "nonOrthoFaces.vtk").write_text(
            "# vtk DataFile Version 2.0\n"
            "nonOrthoFaces\n"
            "ASCII\n"
            "DATASET POLYDATA\n"
            "POINTS 2 float\n"
            "0.25 0.5 0.5\n"
            "1.75 0.5 0.5\n",
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        if hasattr(self, "tmp"):
            self.tmp.cleanup()

    def test_metadata_surface_slice_streamlines_and_isosurface(self) -> None:
        # 1. Metadata
        meta = volumetric_post.get_case_volume_metadata(self.case_dir)
        self.assertTrue(meta["available"])
        self.assertEqual(meta["cell_count"], 10 * 6 * 6)
        self.assertEqual(meta["point_count"], 11 * 7 * 7)
        self.assertAlmostEqual(meta["bounds"][0], 0.0, places=5)
        self.assertAlmostEqual(meta["bounds"][1], 2.0, places=5)
        scalar_names = {s["name"] for s in meta["scalars"]}
        vector_names = {v["name"] for v in meta["vectors"]}
        self.assertIn("T", scalar_names)
        self.assertIn("U_mag", scalar_names)
        self.assertIn("U", vector_names)
        self.assertEqual(len(meta["bad_cell_points"]), 2)

        # 2. Outer surface binary export
        surf_blob = volumetric_post.export_case_surface_binary(self.case_dir, field_name="T")
        surf_meta, surf_bufs = volumetric_post.unpack_mesh_binary(surf_blob)
        self.assertEqual(surf_meta["operation"], "surface")
        self.assertEqual(surf_meta["field"], "T")
        self.assertGreater(surf_meta["triangle_count"], 0)
        self.assertAlmostEqual(surf_meta["min"], 300.0, places=2)
        self.assertAlmostEqual(surf_meta["max"], 420.0, places=2)
        self.assertEqual(surf_bufs["indices"].size, surf_meta["triangle_count"] * 3)

        # 3. Cutting-plane slice at x = 1.0 (offset_ratio = 0.0)
        slice_blob = volumetric_post.compute_volumetric_slice(self.case_dir, "x", 0.0, field_name="T")
        slice_meta, slice_bufs = volumetric_post.unpack_mesh_binary(slice_blob)
        self.assertEqual(slice_meta["operation"], "slice")
        self.assertEqual(slice_meta["axis"], "x")
        self.assertGreater(slice_meta["triangle_count"], 0)
        pts = slice_bufs["points"]
        self.assertTrue(all(abs(float(p[0]) - 1.0) < 1e-3 for p in pts))
        # On x=1.0, T = 350 + 20*y -> [350, 370]
        self.assertAlmostEqual(slice_meta["min"], 350.0, places=1)
        self.assertAlmostEqual(slice_meta["max"], 370.0, places=1)

        # 4. 3D RK4 Streamlines
        stream_blob = volumetric_post.compute_volumetric_streamlines(self.case_dir, vector_field="U", n_seeds=24)
        stream_meta, stream_bufs = volumetric_post.unpack_mesh_binary(stream_blob)
        self.assertEqual(stream_meta["operation"], "streamlines")
        self.assertGreater(stream_meta["streamline_count"], 0)
        self.assertEqual(int(stream_bufs["line_counts"].sum()), int(stream_bufs["points"].shape[0]))
        self.assertGreater(stream_meta["min"], 1.9)
        self.assertLess(stream_meta["max"], 2.2)

        # 5. Iso-surface contour at T = 360.0
        iso_blob = volumetric_post.compute_volumetric_isosurface(self.case_dir, "T", 360.0)
        iso_meta, iso_bufs = volumetric_post.unpack_mesh_binary(iso_blob)
        self.assertEqual(iso_meta["operation"], "isosurface")
        self.assertEqual(iso_meta["field"], "T")
        self.assertGreater(iso_meta["triangle_count"], 0)
        self.assertEqual(iso_bufs["normals"].shape[0], iso_bufs["points"].shape[0])

        # Out-of-range iso-value must raise explicit Zero-Mock error
        with self.assertRaises(volumetric_post.VolumetricDataUnavailableError):
            volumetric_post.compute_volumetric_isosurface(self.case_dir, "T", 9999.0)

    def test_calculix_inp_and_dat_volume_loader(self) -> None:
        ccx_dir = Path(self.tmp.name) / "case_ccx"
        ccx_dir.mkdir(parents=True, exist_ok=True)
        (ccx_dir / "model.inp").write_text(
            "*NODE\n"
            "1, 0.0, 0.0, 0.0\n"
            "2, 1.0, 0.0, 0.0\n"
            "3, 1.0, 1.0, 0.0\n"
            "4, 0.0, 1.0, 0.0\n"
            "5, 0.0, 0.0, 1.0\n"
            "6, 1.0, 0.0, 1.0\n"
            "7, 1.0, 1.0, 1.0\n"
            "8, 0.0, 1.0, 1.0\n"
            "*ELEMENT, TYPE=C3D8, ELSET=EALL\n"
            "1, 1, 2, 3, 4, 5, 6, 7, 8\n",
            encoding="utf-8",
        )
        (ccx_dir / "model.dat").write_text(
            " displacements (vx,vy,vz) for set NALL and time 0.1000000E+01\n\n"
            "        1  0.000000E+00  0.000000E+00  0.000000E+00\n"
            "        2  1.000000E-03  0.000000E+00  0.000000E+00\n"
            "        6  1.000000E-03  2.000000E-03  0.000000E+00\n"
            " stresses (elem, integ.pnt.,sxx,syy,szz,sxy,sxz,syz) for set EALL and time 0.1000000E+01\n\n"
            "        1   1  1.000000E+08  0.000000E+00  0.000000E+00  0.000000E+00  0.000000E+00  0.000000E+00\n",
            encoding="utf-8",
        )
        meta = volumetric_post.get_case_volume_metadata(ccx_dir)
        self.assertTrue(meta["available"])
        self.assertEqual(meta["cell_count"], 1)
        self.assertEqual(meta["point_count"], 8)
        scalar_names = {s["name"] for s in meta["scalars"]}
        self.assertIn("U_mag", scalar_names)
        self.assertIn("von_mises", scalar_names)


class TestDirective04ProtectedAPIRoutes(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.main_mod, cls.used_shims = _import_main_module()

    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.jobs_root = Path(self.tmp_dir.name) / "jobs"
        self.case_dir = self.jobs_root / "case-post-01"
        self.case_dir.mkdir(parents=True, exist_ok=True)
        self.outside_dir = Path(self.tmp_dir.name) / "outside_secret"
        self.outside_dir.mkdir(parents=True, exist_ok=True)

        self.repo = _InMemoryJobRepository()
        self.sec = EnterpriseSecurityService(sqlite_path=str(Path(self.tmp_dir.name) / "sec.db"))

        self.repo.create("job-valid", {"physics_type": "CFD_Incompressible"})
        self.repo.update(
            "job-valid",
            status="COMPLETED",
            progress=100,
            result={"case_directory": str(self.case_dir)},
        )

        self.repo.create("job-escape", {"physics_type": "CFD_Incompressible"})
        self.repo.update(
            "job-escape",
            status="COMPLETED",
            progress=100,
            result={"case_directory": str(self.outside_dir)},
        )

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_post_routes_enforce_rbac_and_path_confinement(self) -> None:
        admin, _ = self.sec.bootstrap_admin(
            email="admin@naseer.io",
            full_name="Admin",
            password="StrongAdminPassword!1",
        )
        self.sec.create_user(
            email="viewer@naseer.io",
            full_name="Viewer",
            password="StrongViewerPassword!1",
            role="viewer",
            actor=admin,
        )
        _, viewer_token = self.sec.authenticate("viewer@naseer.io", "StrongViewerPassword!1")

        fake_blob = volumetric_post.pack_mesh_binary(
            {"operation": "slice", "field": "p", "min": 0.0, "max": 10.0},
            {"points": ("float32", [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0], [3, 3]), "indices": ("uint32", [0, 1, 2], [3])},
        )
        fake_task = MagicMock()
        fake_task.get.return_value = {
            "success": True,
            "format": "NSR1",
            "byte_length": len(fake_blob),
            "b64": base64.b64encode(fake_blob).decode("ascii"),
        }
        mock_celery = MagicMock()
        mock_celery.send_task.return_value = fake_task

        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.object(self.main_mod, "celery_app", mock_celery),
            patch.object(self.main_mod, "HAS_PYVISTA", False),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "enforced", "NASEER_JOB_DIR": str(self.jobs_root)}),
        ):
            # 1. Missing Bearer token -> 401
            with self.assertRaises(self.main_mod.SecurityError) as ctx_401:
                asyncio.run(self.main_mod.post_volume_metadata_endpoint("job-valid", _FakeRequest()))
            self.assertEqual(ctx_401.exception.status_code, 401)

            auth_req = _FakeRequest(headers={"Authorization": f"Bearer {viewer_token}"})

            # 2. Path outside allowed_roots -> 403 INVALID_CASE_PATH
            with self.assertRaises(self.main_mod.HTTPException) as ctx_403:
                asyncio.run(self.main_mod.post_volume_surface_binary_endpoint("job-escape", auth_req))
            self.assertEqual(ctx_403.exception.status_code, 403)
            self.assertEqual(ctx_403.exception.detail["code"], "INVALID_CASE_PATH")

            # 3. Valid viewer request to binary slice endpoint -> octet-stream + X-Naseer-Format: NSR1
            slice_req = self.main_mod.VolumetricSliceRequest(axis="z", offset_ratio=0.25, field="p")
            resp = asyncio.run(self.main_mod.post_volume_slice_binary_endpoint("job-valid", slice_req, auth_req))
            self.assertEqual(resp.media_type, "application/octet-stream")
            self.assertEqual(resp.headers.get("X-Naseer-Format"), "NSR1")
            out_meta, out_bufs = volumetric_post.unpack_mesh_binary(resp.body)
            self.assertEqual(out_meta["operation"], "slice")
            self.assertEqual(_as_flat_list(out_bufs["indices"]), [0, 1, 2])

            # 4. Streamlines & isosurface routes also dispatch cleanly and return NSR1 headers
            stream_req = self.main_mod.VolumetricStreamlinesRequest(vector_field="U", n_seeds=32)
            resp_s = asyncio.run(self.main_mod.post_volume_streamlines_binary_endpoint("job-valid", stream_req, auth_req))
            self.assertEqual(resp_s.media_type, "application/octet-stream")
            self.assertEqual(resp_s.headers.get("X-Naseer-Format"), "NSR1")

            iso_req = self.main_mod.VolumetricIsoSurfaceRequest(field="T", iso_value=350.0)
            resp_i = asyncio.run(self.main_mod.post_volume_isosurface_binary_endpoint("job-valid", iso_req, auth_req))
            self.assertEqual(resp_i.media_type, "application/octet-stream")
            self.assertEqual(resp_i.headers.get("X-Naseer-Format"), "NSR1")

    def test_post_routes_surface_zero_mock_503_and_422_errors(self) -> None:
        mock_celery = MagicMock()
        auth_req = _FakeRequest()

        with (
            patch.object(self.main_mod, "job_repository", self.repo),
            patch.object(self.main_mod, "security_service", self.sec),
            patch.object(self.main_mod, "celery_app", mock_celery),
            patch.object(self.main_mod, "HAS_PYVISTA", False),
            patch.dict(os.environ, {"NASEER_AUTH_MODE": "local_open", "NASEER_JOB_DIR": str(self.jobs_root)}),
        ):
            # Worker reports PyVista missing -> HTTP 503
            t503 = MagicMock()
            t503.get.return_value = {"success": False, "error_type": "BACKEND_UNAVAILABLE", "error": "PyVista missing"}
            mock_celery.send_task.return_value = t503
            with self.assertRaises(self.main_mod.HTTPException) as ctx_503:
                asyncio.run(self.main_mod.post_volume_metadata_endpoint("job-valid", auth_req))
            self.assertEqual(ctx_503.exception.status_code, 503)

            # Worker reports missing vector field / empty contour -> HTTP 422
            t422 = MagicMock()
            t422.get.return_value = {"success": False, "error_type": "DATA_UNAVAILABLE", "error": "Empty iso-surface"}
            mock_celery.send_task.return_value = t422
            iso_req = self.main_mod.VolumetricIsoSurfaceRequest(field="T", iso_value=999.0)
            with self.assertRaises(self.main_mod.HTTPException) as ctx_422:
                asyncio.run(self.main_mod.post_volume_isosurface_binary_endpoint("job-valid", iso_req, auth_req))
            self.assertEqual(ctx_422.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
