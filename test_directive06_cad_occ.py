"""
Directive 06 Automated Test Suite:
OpenCASCADE CAD Preparation Engine (STEP/IGES Unit Detection, SI Scaling,
External & Internal Fluid Volume Extraction, Multi-Body Assemblies,
FastAPI /api/cad/* RBAC & Path Confinement, and Express Proxy Wiring).
"""

from __future__ import annotations

import asyncio
import base64
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.cad_occ import (
    HAS_GMSH,
    CadPreparationError,
    detect_cad_units,
    extract_fluid_volume,
    inspect_cad_assembly,
    prepare_multibody_assembly,
)
from test_async_heartbeat_sse import _FakeRequest, _import_main_module
import universal_dispatcher


STEP_MM_HEADER = b"""ISO-10303-21;
HEADER;
FILE_NAME('bracket_mm.step','2026-01-01',('NASEER'),('NASEER'),'','','');
ENDSEC;
DATA;
#10 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
#11 = MANIFOLD_SOLID_BREP('Bracket_Body',#12);
ENDSEC;
END-ISO-10303-21;
"""

STEP_CM_HEADER = b"""ISO-10303-21;
DATA;
#10 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.CENTI.,.METRE.) );
ENDSEC;
END-ISO-10303-21;
"""

STEP_M_HEADER = b"""ISO-10303-21;
DATA;
#10 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT($,.METRE.) );
ENDSEC;
END-ISO-10303-21;
"""

STEP_INCH_HEADER = b"""ISO-10303-21;
DATA;
#10 = ( CONVERSION_BASED_UNIT('INCH',#11) LENGTH_UNIT() NAMED_UNIT(#12) );
#11 = LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(25.4),#13);
#13 = ( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) );
ENDSEC;
END-ISO-10303-21;
"""

STEP_NO_UNIT_HEADER = b"""ISO-10303-21;
DATA;
#11 = MANIFOLD_SOLID_BREP('UnknownUnitPart',#12);
ENDSEC;
END-ISO-10303-21;
"""


def _make_iges_global_bytes(unit_flag: int, unit_name: str = "MM") -> bytes:
    """Build a valid 80-column IGES Global Section card with the requested unit flag."""
    # Fields 1..15 in IGES Global section:
    # 1:1H,, 2:1H;, 3:prod, 4:file, 5:sys, 6:ver, 7:32, 8:38, 9:6, 10:308, 11:15,
    # 12:recv, 13:1.0, 14:<unit_flag>, 15:<len>H<unit_name>;
    g_body = (
        f"1H,,1H;,4HPART,9Hpart.iges,6HNASEER,3H1.0,32,38,6,308,15,"
        f"4HPART,1.0,{unit_flag},{len(unit_name)}H{unit_name};"
    )
    lines = []
    seq = 1
    for i in range(0, len(g_body), 72):
        chunk = g_body[i : i + 72].ljust(72)
        lines.append(f"{chunk}G{seq:7d}")
        seq += 1
    return ("\n".join(lines) + "\n").encode("ascii")


def _build_gmsh_step_box(lx: float, ly: float, lz: float, unit_str: str = "MM") -> bytes:
    """Generate a real STEP box via Gmsh OpenCASCADE with an explicit STEP unit header."""
    import gmsh  # type: ignore

    if gmsh.isInitialized():
        gmsh.finalize()
    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.model.add("test_box")
        gmsh.model.occ.addBox(0.0, 0.0, 0.0, lx, ly, lz)
        gmsh.model.occ.synchronize()
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "box.step"
            gmsh.write(str(p))
            raw = p.read_text(encoding="utf-8", errors="ignore")
    finally:
        if gmsh.isInitialized():
            gmsh.finalize()

    if unit_str == "M":
        raw = raw.replace("SI_UNIT(.MILLI.,.METRE.)", "SI_UNIT($,.METRE.)")
    return raw.encode("utf-8")


def _build_gmsh_hollow_duct_brep(
    length: float = 0.2,
    outer_w: float = 0.1,
    inner_w: float = 0.06,
) -> bytes:
    """Build a real hollow square duct B-Rep (open ends at x=0 and x=length)."""
    import gmsh  # type: ignore

    if gmsh.isInitialized():
        gmsh.finalize()
    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.model.add("hollow_duct")
        margin = (outer_w - inner_w) * 0.5
        outer = gmsh.model.occ.addBox(0.0, 0.0, 0.0, length, outer_w, outer_w)
        inner = gmsh.model.occ.addBox(0.0, margin, margin, length, inner_w, inner_w)
        gmsh.model.occ.cut([(3, outer)], [(3, inner)], removeObject=True, removeTool=True)
        gmsh.model.occ.synchronize()
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "duct.brep"
            gmsh.write(str(p))
            return p.read_bytes()
    finally:
        if gmsh.isInitialized():
            gmsh.finalize()


def _build_gmsh_two_body_assembly_brep() -> bytes:
    """Build a real 2-body touching assembly (Solid_A [0..0.1] and Solid_B [0.1..0.2])."""
    import gmsh  # type: ignore

    if gmsh.isInitialized():
        gmsh.finalize()
    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.model.add("two_body")
        gmsh.model.occ.addBox(0.0, 0.0, 0.0, 0.1, 0.05, 0.05)
        gmsh.model.occ.addBox(0.1, 0.0, 0.0, 0.1, 0.05, 0.05)
        gmsh.model.occ.synchronize()
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "assembly.brep"
            gmsh.write(str(p))
            return p.read_bytes()
    finally:
        if gmsh.isInitialized():
            gmsh.finalize()


class TestCadUnitDetection(unittest.TestCase):
    def test_step_unit_detection_mm_cm_m_inch_and_unknown(self):
        mm = detect_cad_units(STEP_MM_HEADER, "part.step")
        self.assertEqual(mm["detected_unit"], "mm")
        self.assertAlmostEqual(mm["scale_to_meters"], 1e-3, places=9)
        self.assertEqual(mm["source"], "step_header")

        cm = detect_cad_units(STEP_CM_HEADER, "part.stp")
        self.assertEqual(cm["detected_unit"], "cm")
        self.assertAlmostEqual(cm["scale_to_meters"], 1e-2, places=9)
        self.assertEqual(cm["source"], "step_header")

        m = detect_cad_units(STEP_M_HEADER, "part.step")
        self.assertEqual(m["detected_unit"], "m")
        self.assertAlmostEqual(m["scale_to_meters"], 1.0, places=9)
        self.assertEqual(m["source"], "step_header")

        inch = detect_cad_units(STEP_INCH_HEADER, "imperial.step")
        self.assertEqual(inch["detected_unit"], "in")
        self.assertAlmostEqual(inch["scale_to_meters"], 0.0254, places=9)
        self.assertEqual(inch["source"], "step_header")

        unk = detect_cad_units(STEP_NO_UNIT_HEADER, "mystery.step")
        self.assertEqual(unk["detected_unit"], "unknown")
        self.assertEqual(unk["scale_to_meters"], 1.0)
        self.assertIsNotNone(unk["warning"])

    def test_iges_unit_flag_detection(self):
        for flag, expected_unit, expected_scale in (
            (1, "in", 0.0254),
            (2, "mm", 1e-3),
            (6, "m", 1.0),
            (10, "cm", 1e-2),
        ):
            res = detect_cad_units(_make_iges_global_bytes(flag, expected_unit.upper()), "part.iges")
            self.assertEqual(res["detected_unit"], expected_unit)
            self.assertAlmostEqual(res["scale_to_meters"], expected_scale, places=9)
            self.assertEqual(res["source"], "iges_header")

    def test_manual_unit_override_and_invalid_override(self):
        res = detect_cad_units(STEP_MM_HEADER, "part.step", unit_override="in")
        self.assertEqual(res["detected_unit"], "mm")
        self.assertEqual(res["effective_unit"], "in")
        self.assertAlmostEqual(res["scale_to_meters"], 0.0254, places=9)
        self.assertTrue(res["override_applied"])

        with self.assertRaises(CadPreparationError):
            detect_cad_units(STEP_MM_HEADER, "part.step", unit_override="parsec")


@unittest.skipUnless(HAS_GMSH, "Requires Gmsh OpenCASCADE kernel (inside Docker worker)")
class TestOpenCascadeRealGeometry(unittest.TestCase):
    def test_step_mm_to_si_meters_scaling_and_external_enclosure(self):
        raw_step = _build_gmsh_step_box(100.0, 50.0, 20.0, unit_str="MM")
        insp = inspect_cad_assembly(raw_step, "block_mm.step")
        self.assertEqual(insp["unit_info"]["detected_unit"], "mm")
        self.assertEqual(insp["body_count"], 1)
        dims = insp["dimensions"]
        self.assertAlmostEqual(dims["length"], 0.1, places=3)
        self.assertAlmostEqual(dims["width"], 0.05, places=3)
        self.assertAlmostEqual(dims["height"], 0.02, places=3)
        self.assertAlmostEqual(insp["bodies"][0]["volume_m3"], 0.0001, places=6)
        self.assertGreater(len(insp["vtk_data"]["triangles"]), 0)
        self.assertEqual(
            len(insp["vtk_data"]["triangle_bodies"]),
            len(insp["vtk_data"]["triangles"]) // 3,
        )

        with tempfile.TemporaryDirectory() as tmp_jobs:
            ext_res = extract_fluid_volume(
                raw_step,
                "block_mm.step",
                mode="external_enclosure",
                params={"upstream_mult": 2.0, "downstream_mult": 4.0, "lateral_mult": 1.5},
                jobs_dir=Path(tmp_jobs),
            )
            self.assertTrue(Path(ext_res["prepared_file_path"]).is_file())
            self.assertTrue(Path(ext_res["metadata_path"]).is_file())
            # Box: (0.1*(1+2+4)) * (0.05*(1+3)) * (0.02*(1+3)) = 0.7 * 0.2 * 0.08 = 0.0112 m^3
            # Minus solid 0.0001 m^3 => 0.0111 m^3
            self.assertAlmostEqual(ext_res["fluid_volume_m3"], 0.0111, places=4)
            patch_names = {p["name"] for p in ext_res["patches"]}
            self.assertTrue({"inlet", "outlet", "farfield", "obstacle"}.issubset(patch_names))

    def test_internal_fluid_cavity_extracts_hollow_duct_and_rejects_solid_cube(self):
        hollow_brep = _build_gmsh_hollow_duct_brep(length=0.2, outer_w=0.1, inner_w=0.06)
        with tempfile.TemporaryDirectory() as tmp_jobs:
            cav = extract_fluid_volume(
                hollow_brep,
                "duct.brep",
                mode="internal_cavity",
                params={},
                jobs_dir=Path(tmp_jobs),
            )
            self.assertTrue(Path(cav["prepared_file_path"]).is_file())
            # Exact internal bore volume: 0.2 * 0.06 * 0.06 = 0.00072 m^3
            self.assertAlmostEqual(cav["fluid_volume_m3"], 0.00072, places=5)
            patch_names = {p["name"] for p in cav["patches"]}
            self.assertIn("inlet", patch_names)
            self.assertIn("outlet", patch_names)
            self.assertIn("walls", patch_names)

            # Zero-Mock check: solid cube with no void MUST raise CadPreparationError
            solid_step = _build_gmsh_step_box(100.0, 100.0, 100.0, unit_str="MM")
            with self.assertRaises(CadPreparationError):
                extract_fluid_volume(
                    solid_step,
                    "solid_cube.step",
                    mode="internal_cavity",
                    params={},
                    jobs_dir=Path(tmp_jobs),
                )

    def test_multibody_assembly_interface_detection_conformal_and_disjoint(self):
        asm_brep = _build_gmsh_two_body_assembly_brep()
        insp = inspect_cad_assembly(asm_brep, "two_body.brep")
        self.assertEqual(insp["body_count"], 2)
        self.assertEqual(insp["interface_count"], 1)
        self.assertLessEqual(insp["interfaces"][0]["gap_m"], 1e-5)
        self.assertEqual(set(insp["vtk_data"]["triangle_bodies"]), {0, 1})

        assignments = [
            {"body_id": "body_1", "name": "Heater_Solid", "role": "solid"},
            {"body_id": "body_2", "name": "Coolant_Fluid", "role": "fluid"},
        ]
        with tempfile.TemporaryDirectory() as tmp_jobs:
            conf = prepare_multibody_assembly(
                asm_brep,
                "two_body.brep",
                body_assignments=assignments,
                conformal_cht=True,
                jobs_dir=Path(tmp_jobs),
            )
            self.assertTrue(conf["conformal_cht"])
            self.assertEqual(conf["body_count"], 2)
            self.assertEqual(conf["interface_count"], 1)
            self.assertEqual(conf["interfaces"][0]["interface_type"], "conformal_shared")
            # Shared conformal surface tag appears in BOTH bodies
            shared_tags = set(conf["bodies"][0]["surface_tags"]) & set(conf["bodies"][1]["surface_tags"])
            self.assertGreaterEqual(len(shared_tags), 1)

            disjoint = prepare_multibody_assembly(
                asm_brep,
                "two_body.brep",
                body_assignments=assignments,
                conformal_cht=False,
                jobs_dir=Path(tmp_jobs),
            )
            self.assertFalse(disjoint["conformal_cht"])
            self.assertEqual(disjoint["body_count"], 2)
            # Disjoint bodies do NOT share identical surface tags
            shared_disjoint = set(disjoint["bodies"][0]["surface_tags"]) & set(
                disjoint["bodies"][1]["surface_tags"]
            )
            self.assertEqual(len(shared_disjoint), 0)


class TestCadApiSecurityAndWiring(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.main_mod, cls.used_shims = _import_main_module()

    def test_express_server_proxies_api_cad(self):
        server_ts = Path("server.ts")
        if not server_ts.exists():
            self.skipTest("Frontend server.ts not present in backend-only container")
        content = server_ts.read_text(encoding="utf-8")
        self.assertIn("'/api/cad'", content)

    def test_celery_cad_tasks_registered(self):
        self.assertTrue(hasattr(universal_dispatcher, "cad_inspect_assembly_task"))
        self.assertTrue(hasattr(universal_dispatcher, "cad_extract_fluid_task"))
        self.assertTrue(hasattr(universal_dispatcher, "cad_prepare_multibody_task"))

    def test_extract_upload_path_content_confines_prepared_cad_path(self):
        with self.assertRaises(ValueError):
            universal_dispatcher._extract_upload_path_content(
                {"prepared_cad_path": "/etc/passwd"}
            )

        with tempfile.TemporaryDirectory() as tmp_jobs:
            uploads = Path(tmp_jobs) / "uploads"
            uploads.mkdir(parents=True, exist_ok=True)
            brep = uploads / "prepared_test.brep"
            brep.write_bytes(b"DBRep_DrawableShape_TEST")
            with patch.dict(os.environ, {"NASEER_JOB_DIR": tmp_jobs}):
                raw, fname = universal_dispatcher._extract_upload_path_content(
                    {"prepared_cad_path": str(brep)}
                )
            self.assertEqual(raw, b"DBRep_DrawableShape_TEST")
            self.assertEqual(fname, "prepared_test.brep")

    def test_cad_endpoints_enforce_engineer_rbac(self):
        from enterprise_security import EnterpriseSecurityService

        b64_step = base64.b64encode(STEP_MM_HEADER).decode("ascii")
        with tempfile.TemporaryDirectory() as tmp_dir:
            sec = EnterpriseSecurityService(sqlite_path=str(Path(tmp_dir) / "sec.db"))
            admin, _ = sec.bootstrap_admin(
                email="admin@naseer.io",
                full_name="Admin",
                password="StrongAdminPassword!1",
            )
            sec.create_user(
                email="viewer@naseer.io",
                full_name="Viewer",
                password="StrongViewerPassword!1",
                role="viewer",
                actor=admin,
            )
            _, viewer_token = sec.authenticate("viewer@naseer.io", "StrongViewerPassword!1")
            req_http = _FakeRequest(headers={"Authorization": f"Bearer {viewer_token}"})

            with patch.object(self.main_mod, "security_service", sec), \
                 patch.dict(os.environ, {"NASEER_AUTH_MODE": "enforced"}):
                with self.assertRaises(self.main_mod.SecurityError) as c1:
                    asyncio.run(
                        self.main_mod.cad_inspect_endpoint(
                            self.main_mod.CadInspectRequest(cad_file_b64=b64_step, cad_filename="p.step"),
                            req_http,
                        )
                    )
                self.assertEqual(c1.exception.status_code, 403)

                with self.assertRaises(self.main_mod.SecurityError) as c2:
                    asyncio.run(
                        self.main_mod.cad_extract_fluid_endpoint(
                            self.main_mod.CadExtractFluidRequest(
                                cad_file_b64=b64_step,
                                cad_filename="p.step",
                                mode="external_enclosure",
                            ),
                            req_http,
                        )
                    )
                self.assertEqual(c2.exception.status_code, 403)

                with self.assertRaises(self.main_mod.SecurityError) as c3:
                    asyncio.run(
                        self.main_mod.cad_prepare_assembly_endpoint(
                            self.main_mod.CadPrepareAssemblyRequest(
                                cad_file_b64=b64_step,
                                cad_filename="p.step",
                                conformal_cht=True,
                            ),
                            req_http,
                        )
                    )
                self.assertEqual(c3.exception.status_code, 403)

    def test_cad_endpoints_reject_unconfined_prepared_cad_path(self):
        fake_actor = {"email": "eng@naseer.local", "role": "engineer", "workspace_id": "ws-test"}
        req_http = _FakeRequest()
        with patch.object(self.main_mod.security_service, "resolve_actor", return_value=fake_actor):
            calls = [
                lambda: self.main_mod.cad_inspect_endpoint(
                    self.main_mod.CadInspectRequest(prepared_cad_path="/etc/passwd"),
                    req_http,
                ),
                lambda: self.main_mod.cad_extract_fluid_endpoint(
                    self.main_mod.CadExtractFluidRequest(
                        prepared_cad_path="../../etc/passwd",
                        mode="external_enclosure",
                    ),
                    req_http,
                ),
                lambda: self.main_mod.cad_prepare_assembly_endpoint(
                    self.main_mod.CadPrepareAssemblyRequest(
                        prepared_cad_path="/etc/hosts",
                        conformal_cht=True,
                    ),
                    req_http,
                ),
                lambda: self.main_mod.generate_mesh_endpoint(
                    self.main_mod.MeshGenerateRequest(prepared_cad_path="/etc/passwd"),
                    req_http,
                ),
            ]
            for fn in calls:
                with self.assertRaises(self.main_mod.HTTPException) as ctx:
                    asyncio.run(fn())
                self.assertEqual(ctx.exception.status_code, 403)
                self.assertEqual(ctx.exception.detail["code"], "INVALID_CAD_PATH")

    def test_cad_inspect_dispatches_to_worker_and_handles_unavailable_honestly(self):
        fake_actor = {"email": "eng@naseer.local", "role": "engineer", "workspace_id": "ws-test"}
        req_model = self.main_mod.CadInspectRequest(
            cad_file_b64=base64.b64encode(STEP_MM_HEADER).decode("ascii"),
            cad_filename="bracket.step",
        )
        req_http = _FakeRequest()
        mock_task = MagicMock()
        mock_task.get.return_value = {
            "success": True,
            "filename": "bracket.step",
            "unit_info": {"detected_unit": "mm", "scale_to_meters": 0.001, "source": "step_header", "warning": None},
            "dimensions": {"length": 0.1, "width": 0.05, "height": 0.02, "diagonal": 0.1135, "bbox": [0, 0, 0, 0.1, 0.05, 0.02], "total_volume_m3": 0.0001},
            "body_count": 1,
            "bodies": [{"body_id": "body_1", "occ_tag": 1, "name": "Bracket_Body", "volume_m3": 0.0001, "center_of_mass": [0.05, 0.025, 0.01], "bbox": [0, 0, 0, 0.1, 0.05, 0.02], "surface_tags": [1, 2, 3, 4, 5, 6], "role": "solid"}],
            "interface_count": 0,
            "interfaces": [],
            "patches": [],
            "vtk_data": {"points": [], "triangles": [], "triangle_patches": [], "triangle_bodies": [], "patches": [], "scalars": {}, "active_field": "", "bounds": {"min": [0, 0, 0], "max": [0.1, 0.05, 0.02]}, "node_count": 0, "triangle_count": 0},
        }
        mock_celery = MagicMock()
        mock_celery.send_task.return_value = mock_task
        with patch.object(self.main_mod, "HAS_GMSH", False), \
             patch.object(self.main_mod.security_service, "resolve_actor", return_value=fake_actor), \
             patch.object(self.main_mod.security_service, "record_audit"), \
             patch.object(self.main_mod, "celery_app", mock_celery):
            data = asyncio.run(self.main_mod.cad_inspect_endpoint(req_model, req_http))
            self.assertTrue(data["success"])
            self.assertEqual(data["body_count"], 1)
            self.assertEqual(data["unit_info"]["detected_unit"], "mm")
            mock_celery.send_task.assert_called_once()
            self.assertEqual(mock_celery.send_task.call_args[0][0], "universal_dispatcher.cad_inspect_assembly")

        # Zero-Mock: worker unavailable returns 503 CAD_BACKEND_UNAVAILABLE
        offline_celery = MagicMock()
        offline_celery.send_task.side_effect = RuntimeError("broker offline")
        with patch.object(self.main_mod, "HAS_GMSH", False), \
             patch.object(self.main_mod.security_service, "resolve_actor", return_value=fake_actor), \
             patch.object(self.main_mod.security_service, "record_audit"), \
             patch.object(self.main_mod, "celery_app", offline_celery):
            with self.assertRaises(self.main_mod.HTTPException) as ctx_503:
                asyncio.run(self.main_mod.cad_inspect_endpoint(req_model, req_http))
            self.assertEqual(ctx_503.exception.status_code, 503)
            self.assertEqual(ctx_503.exception.detail["code"], "CAD_BACKEND_UNAVAILABLE")


if __name__ == "__main__":
    unittest.main()
