import tempfile
import unittest
from pathlib import Path
import os
import shutil
import subprocess
from unittest.mock import patch

from universal_dispatcher import (
    classify_physics,
    parse_openfoam_fields,
    parse_openfoam_residuals,
    call_openfoam_solver,
    call_openfoam_compressible_solver,
    temperature_to_kelvin,
)


class TestOpenFOAMIntegration(unittest.TestCase):
    def test_temperature_is_normalized_to_kelvin(self):
        self.assertAlmostEqual(
            temperature_to_kelvin({"temperature": 20.0}),
            293.15,
        )
        self.assertAlmostEqual(
            temperature_to_kelvin({"temperature": 300.0, "temperature_unit": "K"}),
            300.0,
        )
        self.assertAlmostEqual(
            temperature_to_kelvin({"temperature": 0.0}),
            273.15,
        )

    def test_cfd_classification_is_distinct(self):
        self.assertEqual(
            classify_physics({"simulation_type": "CFD_Incompressible"}),
            "CFD_Incompressible",
        )
        self.assertEqual(
            classify_physics({"simulation_type": "CFD-compressible-OpenFOAM"}),
            "CFD_Compressible",
        )
        self.assertEqual(
            classify_physics({"simulation_type": "CFD", "mach_number": 0.1}),
            "CFD_Incompressible",
        )

    def test_residual_parser(self):
        residuals = parse_openfoam_residuals(
            "GAMG: Solving for p, Initial residual = 1e-2, Final residual = 1e-6\n"
            "SmoothSolver: Solving for Ux, Initial residual = 2e-3, Final residual = 1e-5\n"
        )
        self.assertIn("p", residuals)
        self.assertAlmostEqual(residuals["p"]["initial"], 1e-2)
        self.assertAlmostEqual(residuals["ux"]["initial"], 2e-3)
        self.assertEqual(residuals["p"]["values"], [1e-2])

    def test_normalized_field_statistics(self):
        with tempfile.TemporaryDirectory() as temporary:
            case = Path(temporary)
            (case / "0").mkdir()
            (case / "0" / "p").write_text(
                "internalField uniform 101325;\nboundaryField {}", encoding="utf-8"
            )
            (case / "1").mkdir()
            (case / "1" / "U").write_text(
                "internalField uniform (3 0 0);", encoding="utf-8"
            )
            fields = parse_openfoam_fields(case)
        self.assertEqual(fields["pressure"]["mean"], 101325.0)
        self.assertEqual(fields["velocity"]["components"], [3.0, 0.0, 0.0])

    def test_missing_openfoam_environment_has_actionable_error(self):
        with patch("universal_dispatcher.shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "OpenFOAM environment validation failed"):
                call_openfoam_solver({"simulation_type": "CFD_Incompressible"})

    def test_low_mach_compressible_request_routes_to_incompressible_openfoam(self):
        with patch("universal_dispatcher.call_openfoam_solver", return_value={"status": "ok"}) as solver:
            result = call_openfoam_compressible_solver({
                "simulation_type": "CFD_Compressible",
                "velocity": 1.0,
            })
        self.assertEqual(result["status"], "ok")
        payload = solver.call_args.args[0]
        self.assertEqual(payload["simulation_type"], "CFD_Incompressible")
        self.assertTrue(payload["pressure_incompressible_routing"])

    def test_compressible_case_uses_safe_upwind_and_diagonal_preconditioners(self):
        with tempfile.TemporaryDirectory() as temporary:
            case_root = Path(temporary) / "jobs"
            case_root.mkdir()
            block_mesh = shutil.which("blockMesh")
            solver = shutil.which("rhoSimpleFoam")
            if not block_mesh or not solver:
                self.skipTest("OpenFOAM compressible commands are unavailable")

            with patch.dict(os.environ, {"OPENFOAM_CASE_ROOT": str(case_root)}):
                with self.assertRaises(RuntimeError):
                    call_openfoam_solver({
                        "simulation_type": "CFD_Compressible",
                        "velocity": 1.0,
                        "temperature": 20.0,
                        "temperature_unit": "C",
                    })

            case_dirs = list(case_root.glob("openfoam-*"))
            self.assertEqual(len(case_dirs), 1)
            fv_schemes = (case_dirs[0] / "system" / "fvSchemes").read_text(encoding="utf-8")
            fv_solution = (case_dirs[0] / "system" / "fvSolution").read_text(encoding="utf-8")
            self.assertIn("div(phi,U) Gauss upwind;", fv_schemes)
            self.assertNotIn("bounded Gauss upwind", fv_schemes)
            self.assertEqual(fv_solution.count("solver smoothSolver;"), 2)
            self.assertNotIn("preconditioner DILU;", fv_solution)


if __name__ == "__main__":
    unittest.main()
