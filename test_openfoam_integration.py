import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from universal_dispatcher import (
    classify_physics,
    parse_openfoam_fields,
    parse_openfoam_residuals,
    call_openfoam_solver,
)


class TestOpenFOAMIntegration(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
