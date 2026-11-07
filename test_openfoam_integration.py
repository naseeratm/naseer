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
    verify_openfoam_convergence,
)


def _fake_openfoam_run(solver_output: str, write_time_directory: bool = True):
    def fake_run(command, cwd, **_kwargs):
        if write_time_directory and not str(command[0]).endswith("blockMesh"):
            (Path(cwd) / "100").mkdir(exist_ok=True)
        output = "" if str(command[0]).endswith("blockMesh") else solver_output
        return subprocess.CompletedProcess(command, 0, stdout=output, stderr="")
    return fake_run


class TestOpenFOAMVerificationGate(unittest.TestCase):
    def _case(self, log: str, time_dirs=("0",)) -> Path:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        case = Path(directory.name)
        (case / "solver.log").write_text(log, encoding="utf-8")
        for name in time_dirs:
            (case / name).mkdir()
        return case

    def test_clean_log_with_time_steps_is_valid(self):
        case = self._case("Time = 100\nSmoothSolver: Solving for Ux, Initial residual = 1e-3\nEnd\n", ("0", "100"))
        self.assertEqual(verify_openfoam_convergence(case, "rhoSimpleFoam"), {"valid": True, "error": None})

    def test_failure_markers_are_rejected(self):
        for marker in ("Floating point exception", "--> FOAM FATAL ERROR", "SIGFPE", "Initial residual = nan", "p = NaN"):
            with self.subTest(marker=marker):
                case = self._case(f"Time = 1\n{marker}\n", ("0", "1"))
                result = verify_openfoam_convergence(case, "rhoSimpleFoam")
                self.assertFalse(result["valid"])
                self.assertTrue(result["error"])

    def test_only_initial_directory_is_rejected(self):
        result = verify_openfoam_convergence(self._case("Time = 0\nEnd\n"), "rhoSimpleFoam")
        self.assertFalse(result["valid"])
        self.assertIn("time-step", result["error"])

    def test_fpe_trapping_start_up_banner_is_not_a_failure(self):
        # Printed by every OpenFOAM run when FPE trapping is enabled (taken from a real icoFoam log).
        banner = "trapFpe: Floating point exception trapping enabled (FOAM_SIGFPE).\n"
        case = self._case(banner + "Time = 1\nCourant Number mean: 0.01 max: 0.01\nEnd\n", ("0", "1"))
        self.assertEqual(verify_openfoam_convergence(case, "icoFoam"), {"valid": True, "error": None})

    def test_real_crash_after_the_banner_is_still_rejected(self):
        banner = "trapFpe: Floating point exception trapping enabled (FOAM_SIGFPE).\n"
        case = self._case(banner + "Time = 3\n#1  Foam::sigFpe::sigHandler(int)\nFloating point exception (core dumped)\n", ("0", "1"))
        result = verify_openfoam_convergence(case, "icoFoam")
        self.assertFalse(result["valid"])
        self.assertIn("Floating point exception", result["error"])

    def test_missing_log_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            (Path(temporary) / "100").mkdir()
            self.assertFalse(verify_openfoam_convergence(Path(temporary), "rhoSimpleFoam")["valid"])

    def _run_compressible(self, solver_output: str, write_time_directory: bool = True):
        with tempfile.TemporaryDirectory() as temporary:
            case_root = Path(temporary) / "jobs"
            case_root.mkdir()
            with patch.dict(os.environ, {"OPENFOAM_CASE_ROOT": str(case_root)}), \
                    patch("universal_dispatcher.shutil.which", side_effect=lambda name: f"/usr/bin/{name}"), \
                    patch("universal_dispatcher.subprocess.run", side_effect=_fake_openfoam_run(solver_output, write_time_directory)):
                try:
                    outcome = call_openfoam_solver({"simulation_type": "CFD_Compressible", "velocity": 120.0, "pressure": 101325.0})
                    error = None
                except RuntimeError as exc:
                    outcome, error = None, exc
            case = next(case_root.glob("openfoam-*")) if case_root.exists() and list(case_root.glob("openfoam-*")) else None
            files = {}
            if case:
                for relative in ("system/fvSolution", "0/p", "0/U"):
                    files[relative] = (case / relative).read_text(encoding="utf-8")
            return outcome, error, files

    def test_diverged_run_is_rejected_by_gate(self):
        _, error, _ = self._run_compressible("Time = 5\nFloating point exception\n")
        self.assertIsNotNone(error)
        self.assertIn("Floating point exception", str(error))

    def test_run_without_time_steps_is_rejected_by_gate(self):
        _, error, _ = self._run_compressible("Time = 0\nEnd\n", write_time_directory=False)
        self.assertIsNotNone(error)
        self.assertIn("time-step", str(error))

    def test_compressible_case_files_are_stable(self):
        outcome, error, files = self._run_compressible("Time = 100\nEnd\n")
        self.assertIsNone(error)
        self.assertNotEqual(outcome["status"], "error")
        fv_solution = files["system/fvSolution"]
        self.assertRegex(fv_solution, r"p \{ solver GAMG;")
        self.assertNotIn("DILU", fv_solution)
        self.assertIn("U { solver smoothSolver; smoother symGaussSeidel;", fv_solution)
        self.assertIn("h { solver smoothSolver; smoother symGaussSeidel;", fv_solution)
        self.assertIn("type waveTransmissive;", files["0/p"])
        self.assertIn("type inletOutlet;", files["0/U"])
        self.assertNotIn("pressureInletOutletVelocity", files["0/U"])

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
                try:
                    call_openfoam_solver({
                        "simulation_type": "CFD_Compressible",
                        "velocity": 1.0,
                        "temperature": 20.0,
                        "temperature_unit": "C",
                    })
                except RuntimeError:
                    pass  # This test inspects the generated case files, whether or not the solve passes the gate.

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
