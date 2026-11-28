"""
Automated Unit Tests for Directive 03:
1. OpenFOAM checkMesh output parsing (_parse_check_mesh_output) classifying PASS, WARNING,
   and FAIL verdicts strictly from real checkMesh logs, plus VTK failure set coordinate extraction.
2. Generalized 3D CAD & unstructured mesh support in backend/vv_metrics.compute_openfoam_metrics
   (without mesh_metadata.json, dimension=3 detection, patch-based pressure_drop, explicit omission
   when patches have no numeric values, and drag_coefficient_cd / nusselt_number key results).
3. 3D Celik GCI mesh-independence study on CAD-backed CFD payloads (cells = [1000, 8000, 64000],
   dimension = 3) and refine_payload scaling for external_aero snappyHexMesh payloads.
4. Automated checkMesh Quality Gate (MeshQualityGateError) halting solver launch on verdict == FAIL
   unless allow_poor_mesh=True.
5. Clean solver version probing (_probe_binary_version) extracting OpenFOAM v2406 instead of
   Usage banners and skipping '=====' separator lines for ElmerGrid.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List
from unittest.mock import patch

import universal_dispatcher
from backend.vv_metrics import (
    KeyResultUnavailable,
    compute_openfoam_metrics,
    extract_key_result,
    key_result_specs,
    refine_payload,
    run_mesh_study,
)


_CHECKMESH_PASS_LOG = """
Checking geometry...
    Overall domain bounding box (0 0 0) (1 0.4 0.1)
    Mesh has 3 geometric (non-empty/wedge) directions (1 1 1)
    Mesh has 3 solution (non-empty) directions (1 1 1)
Mesh stats
    points:           1250
    faces:            3420
    internal faces:   2980
    cells:            1000
    faces per cell:   6
    boundary patches: 4
    hexahedra:        920
    prisms:           80
Checking geometry...
    Max aspect ratio = 2.45 OK.
    Min volume = 1.25e-06. Max volume = 8.40e-06. Total volume = 0.04. Cell volumes OK.
    Mesh non-orthogonality Max: 28.4 average: 6.12
    Non-orthogonality check OK.
    Max skewness = 0.42 OK.

Mesh OK.
"""

_CHECKMESH_WARN_LOG = """
Mesh stats
    points:           9420
    faces:            26100
    cells:            8000
    tetrahedra:       7400
    prisms:           600
Checking geometry...
    Max aspect ratio = 14.8 OK.
    Min volume = 4.20e-09. Max volume = 1.15e-05. Total volume = 0.04. Cell volumes OK.
    Mesh non-orthogonality Max: 76.2 average: 21.5
    Non-orthogonality check OK.
    Max skewness = 2.15 OK.

Mesh OK.
"""

_CHECKMESH_FAIL_LOG = """
Mesh stats
    points:           4200
    faces:            11500
    cells:            3500
    tetrahedra:       3500
Checking geometry...
    Max aspect ratio = 128.5 OK.
    Min volume = -1.8e-09. Max volume = 3.2e-05. Total volume = 0.039.
 ***Zero or negative cell volume detected.
    Mesh non-orthogonality Max: 88.7 average: 34.1
 ***Number of severely non-orthogonal (> 70 degrees) faces: 42.
    Max skewness = 6.84, 12 highly skew faces detected.

Failed 2 mesh checks.
"""


class TestDirective03CadGciCheckMesh(unittest.TestCase):
    # ------------------------------------------------------------------
    # 1. checkMesh Quality Gate Parser & VTK Failure Set Extraction
    # ------------------------------------------------------------------
    def test_parse_check_mesh_output_classifies_pass_warning_and_fail(self) -> None:
        passed = universal_dispatcher._parse_check_mesh_output(_CHECKMESH_PASS_LOG)
        self.assertEqual(passed["verdict"], "PASS")
        self.assertTrue(passed["mesh_ok"])
        self.assertEqual(passed["failed_checks"], 0)
        self.assertEqual(passed["cells"], 1000)
        self.assertEqual(passed["points"], 1250)
        self.assertEqual(passed["faces"], 3420)
        self.assertEqual(passed["cell_types"], {"hexahedra": 920, "prisms": 80})
        self.assertAlmostEqual(passed["max_non_orthogonality"], 28.4)
        self.assertAlmostEqual(passed["avg_non_orthogonality"], 6.12)
        self.assertAlmostEqual(passed["max_skewness"], 0.42)
        self.assertAlmostEqual(passed["max_aspect_ratio"], 2.45)
        self.assertAlmostEqual(passed["min_volume"], 1.25e-6)
        self.assertAlmostEqual(passed["max_volume"], 8.40e-6)
        self.assertEqual(passed["warnings"], [])

        warned = universal_dispatcher._parse_check_mesh_output(_CHECKMESH_WARN_LOG)
        self.assertEqual(warned["verdict"], "WARNING")
        self.assertTrue(warned["mesh_ok"])
        self.assertEqual(warned["failed_checks"], 0)
        self.assertAlmostEqual(warned["max_non_orthogonality"], 76.2)
        self.assertTrue(any("76.20" in w for w in warned["warnings"]))

        failed = universal_dispatcher._parse_check_mesh_output(_CHECKMESH_FAIL_LOG)
        self.assertEqual(failed["verdict"], "FAIL")
        self.assertFalse(failed["mesh_ok"])
        self.assertEqual(failed["failed_checks"], 2)
        self.assertLess(failed["min_volume"], 0.0)
        self.assertAlmostEqual(failed["max_non_orthogonality"], 88.7)
        self.assertAlmostEqual(failed["max_skewness"], 6.84)
        self.assertGreaterEqual(len(failed["warnings"]), 3)

    def test_run_openfoam_check_mesh_persists_log_and_extracts_vtk_bad_points(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            case_dir = Path(tmp)
            vtk_dir = case_dir / "VTK"
            vtk_dir.mkdir(parents=True)
            (vtk_dir / "nonOrthoFaces.vtk").write_text(
                "# vtk DataFile Version 2.0\n"
                "nonOrthoFaces\n"
                "ASCII\n"
                "DATASET POLYDATA\n"
                "POINTS 2 float\n"
                "0.125 0.25 0.5\n"
                "0.75 0.5 0.125\n",
                encoding="utf-8",
            )

            def _fake_check_mesh(cmd: List[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
                return subprocess.CompletedProcess(cmd, 0, stdout=_CHECKMESH_FAIL_LOG, stderr="")

            with (
                patch.object(universal_dispatcher.shutil, "which", lambda name, *a, **k: f"/usr/bin/{name}"),
                patch.object(universal_dispatcher.subprocess, "run", side_effect=_fake_check_mesh),
            ):
                mq = universal_dispatcher._run_openfoam_check_mesh(case_dir, {"PATH": "/usr/bin"})

            self.assertIsNotNone(mq)
            assert mq is not None
            self.assertTrue((case_dir / "checkMesh.log").is_file())
            self.assertEqual(mq["verdict"], "FAIL")
            self.assertIn("nonOrthoFaces", mq["failed_sets"])
            self.assertEqual(mq["bad_cell_points"], [[0.125, 0.25, 0.5], [0.75, 0.5, 0.125]])

    # ------------------------------------------------------------------
    # 2. Generalized 3D CAD Unstructured Metrics & New CFD Key Results
    # ------------------------------------------------------------------
    def _build_unstructured_3d_case(
        self,
        *,
        n_cells: int = 12,
        include_patch_pressures: bool = True,
        include_empty_patch: bool = False,
        cd_value: float | None = 0.415,
    ) -> Path:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        case = Path(tmp.name)

        poly_dir = case / "constant" / "polyMesh"
        poly_dir.mkdir(parents=True)
        front_type = "empty" if include_empty_patch else "wall"
        (poly_dir / "boundary").write_text(
            "4\n(\n"
            "  inlet { type patch; nFaces 4; startFace 20; }\n"
            "  outlet { type patch; nFaces 4; startFace 24; }\n"
            "  body { type wall; nFaces 12; startFace 28; }\n"
            f"  sideWalls {{ type {front_type}; nFaces 8; startFace 40; }}\n"
            ")\n",
            encoding="utf-8",
        )

        # Notice: NO mesh_metadata.json written!
        t_dir = case / "250"
        t_dir.mkdir()
        vecs = "\n".join(
            f"({1.0 + 0.1 * i:.4f} {0.05 * i:.4f} 0)" for i in range(n_cells)
        )
        (t_dir / "U").write_text(
            "FoamFile { version 2.0; format ascii; class volVectorField; object U; }\n"
            "dimensions [0 1 -1 0 0 0 0];\n"
            f"internalField nonuniform List<vector> {n_cells} (\n{vecs}\n);\n"
            "boundaryField { inlet { type fixedValue; value uniform (1 0 0); } }\n",
            encoding="utf-8",
        )

        p_vals = "\n".join(f"{10.0 - 0.5 * i:.4f}" for i in range(n_cells))
        if include_patch_pressures:
            p_bf = (
                "boundaryField {\n"
                "  inlet { type fixedValue; value nonuniform List<scalar> 3 (12.0 12.6 11.4); }\n"
                "  outlet { type fixedValue; value uniform 2.0; }\n"
                "  body { type zeroGradient; }\n"
                "}\n"
            )
        else:
            p_bf = (
                "boundaryField {\n"
                "  inlet { type zeroGradient; }\n"
                "  outlet { type zeroGradient; }\n"
                "}\n"
            )
        (t_dir / "p").write_text(
            "FoamFile { version 2.0; format ascii; class volScalarField; object p; }\n"
            "dimensions [0 2 -2 0 0 0 0];\n"
            f"internalField nonuniform List<scalar> {n_cells} (\n{p_vals}\n);\n"
            + p_bf,
            encoding="utf-8",
        )

        if cd_value is not None:
            fc_dir = case / "postProcessing" / "forceCoeffs1" / "0"
            fc_dir.mkdir(parents=True)
            (fc_dir / "coefficient.dat").write_text(
                "# Time Cm Cd Cl Cl(f) Cl(r)\n"
                f"250 0.012 {cd_value:.6f} 0.085 0.04 0.045\n",
                encoding="utf-8",
            )
        return case

    def test_compute_openfoam_metrics_on_unstructured_3d_cad_without_mesh_metadata(self) -> None:
        case = self._build_unstructured_3d_case(n_cells=12, include_patch_pressures=True, cd_value=0.415)
        self.assertFalse((case / "mesh_metadata.json").exists())

        metrics = compute_openfoam_metrics(case)
        self.assertEqual(metrics["time_directory"], "250")
        self.assertEqual(metrics["mesh"]["cells"], 12)
        self.assertEqual(metrics["mesh"]["dimension"], 3)
        self.assertEqual(metrics["mesh"]["topology"], "unstructured")

        # Last vector is (2.1, 0.55, 0) -> sqrt(2.1^2 + 0.55^2)
        self.assertAlmostEqual(metrics["max_velocity"]["value"], (2.1 ** 2 + 0.55 ** 2) ** 0.5, places=4)
        self.assertEqual(metrics["max_velocity"]["unit"], "m/s")

        # Inlet mean = mean(12.0, 12.6, 11.4) = 12.0; outlet = 2.0 -> delta_p = 10.0
        self.assertAlmostEqual(metrics["pressure_drop"]["value"], 10.0, places=5)
        self.assertEqual(metrics["pressure_drop"]["unit"], "m²/s²")

        # Cd parsed from postProcessing/forceCoeffs1
        self.assertAlmostEqual(metrics["drag_coefficient_cd"]["value"], 0.415, places=6)

        # Verify all 4 CFD key results are registered & extractable
        cfd_ids = [spec.id for spec in key_result_specs("CFD_Incompressible")]
        for expected in ("max_velocity", "pressure_drop", "drag_coefficient_cd", "nusselt_number"):
            self.assertIn(expected, cfd_ids)

        data = {"metrics": metrics, "integrals": {"nusselt_number": 38.4}}
        self.assertAlmostEqual(extract_key_result("drag_coefficient_cd", "CFD_Incompressible", data).value, 0.415)
        self.assertAlmostEqual(extract_key_result("nusselt_number", "CHT_Coupled", data).value, 38.4)

    def test_unstructured_pressure_drop_omitted_explicitly_when_patch_values_absent(self) -> None:
        case = self._build_unstructured_3d_case(n_cells=10, include_patch_pressures=False, include_empty_patch=True)
        metrics = compute_openfoam_metrics(case)
        self.assertEqual(metrics["mesh"]["dimension"], 2)
        self.assertNotIn("pressure_drop", metrics)
        self.assertIn("pressure_drop_unavailable_reason", metrics)
        with self.assertRaises(KeyResultUnavailable):
            extract_key_result("pressure_drop", "CFD_Incompressible", {"metrics": metrics})

    # ------------------------------------------------------------------
    # 3. 3D CAD Celik GCI Mesh Study & snappyHexMesh Payload Refinement
    # ------------------------------------------------------------------
    def test_run_mesh_study_computes_valid_3d_gci_on_cad_cfd_payload(self) -> None:
        base_payload = {
            "simulation_type": "CFD_Incompressible",
            "mesh_size": 0.05,
            "cad_stl_b64": "c29saWQgY3ViZQp",  # signals CAD-backed geometry
            "external_aero": True,
            "aero_base_cell_size": 0.1,
            "aero_surface_level": 2,
        }

        # Verify refine_payload scales mesh_size, aero_base_cell_size, and aero_surface_level
        coarse_p = refine_payload("CFD_Incompressible", base_payload, 2.0)
        medium_p = refine_payload("CFD_Incompressible", base_payload, 1.0)
        fine_p = refine_payload("CFD_Incompressible", base_payload, 0.5)
        self.assertAlmostEqual(coarse_p["mesh_size"], 0.1)
        self.assertAlmostEqual(medium_p["mesh_size"], 0.05)
        self.assertAlmostEqual(fine_p["mesh_size"], 0.025)
        self.assertAlmostEqual(coarse_p["aero_base_cell_size"], 0.2)
        self.assertAlmostEqual(fine_p["aero_base_cell_size"], 0.05)
        self.assertEqual((coarse_p["aero_surface_level"], medium_p["aero_surface_level"], fine_p["aero_surface_level"]), (1, 2, 3))

        # 2nd-order convergent 3D CAD sequence: cells = [1000, 8000, 64000] => r21 = r32 = 2.0 in 3D
        # phi(h) = 0.42 + 0.04 * h_rel^2 => coarse (h=4): 0.42 + 0.64 = 1.06, medium (h=2): 0.58, fine (h=1): 0.46
        level_responses = [
            (1000, 0.42 + 0.04 * (4.0 ** 2)),
            (8000, 0.42 + 0.04 * (2.0 ** 2)),
            (64000, 0.42 + 0.04 * (1.0 ** 2)),
        ]
        idx = {"n": 0}

        def _fake_cad_openfoam(_payload: Dict[str, Any]) -> Dict[str, Any]:
            cells, cd = level_responses[idx["n"]]
            idx["n"] += 1
            return {
                "status": "SOLVED_REALTIME",
                "solver": "OpenFOAM",
                "data": {
                    "metrics": {
                        "mesh": {"cells": cells, "cells_total": cells, "dimension": 3, "topology": "unstructured"},
                        "drag_coefficient_cd": {"value": cd, "unit": ""},
                    }
                },
            }

        study = run_mesh_study(base_payload, "CFD_Incompressible", "drag_coefficient_cd", _fake_cad_openfoam)
        self.assertEqual(study["schema_version"], 2)
        self.assertEqual(study["dimension"], 3)
        self.assertEqual([lvl["cells"] for lvl in study["levels"]], [1000, 8000, 64000])
        self.assertAlmostEqual(study["r21"], 2.0, places=5)
        self.assertAlmostEqual(study["r32"], 2.0, places=5)
        self.assertEqual(study["convergence_type"], "monotonic")
        self.assertAlmostEqual(study["observed_order"], 2.0, places=3)
        self.assertAlmostEqual(study["extrapolated_value"], 0.42, places=3)
        self.assertIsNotNone(study["gci_fine_percent"])

    # ------------------------------------------------------------------
    # 4. MeshQualityGateError Enforcement & allow_poor_mesh Override
    # ------------------------------------------------------------------
    def test_mesh_quality_gate_aborts_solver_on_fail_unless_allow_poor_mesh(self) -> None:
        launched_solvers: List[List[str]] = []

        def _fake_subprocess_run(cmd: List[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
            exe_name = Path(cmd[0]).name
            if exe_name == "checkMesh":
                return subprocess.CompletedProcess(cmd, 0, stdout=_CHECKMESH_FAIL_LOG, stderr="")
            return subprocess.CompletedProcess(cmd, 0, stdout="End\n", stderr="")

        def _fake_streaming(cmd: List[str], **kwargs: Any) -> subprocess.CompletedProcess[str]:
            launched_solvers.append(list(cmd))
            case_dir = Path(kwargs["cwd"])
            t_dir = case_dir / "100"
            t_dir.mkdir(exist_ok=True)
            (t_dir / "U").write_text("dimensions [0 1 -1 0 0 0 0];\ninternalField uniform (1 0 0);\n", encoding="utf-8")
            (t_dir / "p").write_text("dimensions [0 2 -2 0 0 0 0];\ninternalField uniform 0;\n", encoding="utf-8")
            log_path = kwargs.get("log_path")
            if log_path:
                with Path(log_path).open("a", encoding="utf-8") as fh:
                    fh.write("Time = 100\nSolving for Ux, Initial residual = 1e-6, Final residual = 1e-7\nEnd\n")
            return subprocess.CompletedProcess(cmd, 0, stdout="Time = 100\nEnd\n", stderr="")

        base_cfd = {
            "simulation_type": "CFD_Incompressible",
            "width_x": 0.4,
            "height_y": 0.2,
            "depth_z": 0.1,
            "mesh_size": 0.1,
            "velocity": 1.0,
        }

        with (
            patch.object(universal_dispatcher.shutil, "which", lambda name, *a, **k: f"/usr/bin/{name}"),
            patch.object(universal_dispatcher.subprocess, "run", side_effect=_fake_subprocess_run),
            patch.object(universal_dispatcher, "_run_streaming_command", side_effect=_fake_streaming),
        ):
            # Default allow_poor_mesh=False MUST raise MeshQualityGateError BEFORE launching solver
            with self.assertRaises(universal_dispatcher.MeshQualityGateError) as ctx:
                universal_dispatcher.call_openfoam_solver(dict(base_cfd))
            self.assertEqual(ctx.exception.mesh_quality["verdict"], "FAIL")
            self.assertEqual(launched_solvers, [], "Flow solver must NOT be launched when checkMesh fails")

            # Explicit allow_poor_mesh=True permits solver execution and attaches mesh_quality
            res = universal_dispatcher.call_openfoam_solver({**base_cfd, "allow_poor_mesh": True})
            self.assertEqual(len(launched_solvers), 1)
            self.assertEqual(res["mesh_quality"]["verdict"], "FAIL")
            self.assertIn("check_mesh_log", res["artifacts"])

    # ------------------------------------------------------------------
    # 5. Clean Solver Version Probing (_probe_binary_version)
    # ------------------------------------------------------------------
    def test_probe_binary_version_extracts_clean_openfoam_and_elmergrid_versions(self) -> None:
        openfoam_help_stdout = (
            "Usage: simpleFoam [OPTIONS]\n"
            "Options:\n"
            "  -case <dir>   Case directory\n"
            "Using: OpenFOAM-v2406 (2406) - visit www.openfoam.com\n"
        )
        elmergrid_help_stdout = (
            "=========================================================\n"
            "Starting program Elmergrid\n"
            "Elmergrid version 9.0\n"
        )

        def _fake_run(cmd: List[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
            name = Path(cmd[0]).name
            if name == "simpleFoam":
                return subprocess.CompletedProcess(cmd, 0, stdout=openfoam_help_stdout, stderr="")
            if name == "blockMesh":
                # Simulate Usage-only output where WM_PROJECT_VERSION env var provides v2406
                return subprocess.CompletedProcess(cmd, 0, stdout="Usage: blockMesh [OPTIONS]\n", stderr="")
            if name == "ElmerGrid":
                return subprocess.CompletedProcess(cmd, 0, stdout=elmergrid_help_stdout, stderr="")
            return subprocess.CompletedProcess(cmd, 0, stdout="1.0\n", stderr="")

        def _fake_which(name: str, *_a: Any, **_k: Any) -> str:
            if name in {"ElmerGrid", "ElmerSolver", "ccx", "gmsh"}:
                return f"/usr/bin/{name}"
            return f"/usr/lib/openfoam/openfoam2406/bin/{name}"

        with (
            patch.object(universal_dispatcher.shutil, "which", side_effect=_fake_which),
            patch.object(universal_dispatcher.subprocess, "run", side_effect=_fake_run),
            patch.dict(os.environ, {"WM_PROJECT_VERSION": "v2406"}),
        ):
            sf = universal_dispatcher._probe_binary_version("simpleFoam", ("-help",))
            self.assertTrue(sf["available"])
            self.assertIn("v2406", sf["version"])
            self.assertNotIn("Usage:", sf["version"])

            bm = universal_dispatcher._probe_binary_version("blockMesh", ("-help",))
            self.assertTrue(bm["available"])
            self.assertIn("v2406", bm["version"])
            self.assertNotIn("Usage:", bm["version"])

            eg = universal_dispatcher._probe_binary_version("ElmerGrid", ("--help",))
            self.assertTrue(eg["available"])
            self.assertFalse(eg["version"].startswith("==="))
            self.assertIn("Elmergrid", eg["version"])

            caps = universal_dispatcher.probe_worker_capabilities()
            self.assertIn("openfoam_checkMesh", caps)


if __name__ == "__main__":
    unittest.main()
