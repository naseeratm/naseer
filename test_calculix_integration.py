import unittest
import shutil
import uuid
from pathlib import Path
from unittest.mock import patch

import universal_dispatcher


class CalculixIntegrationTests(unittest.TestCase):
    def test_configurable_model_and_normalized_results(self):
        def fake_run(command, cwd, text, capture_output, timeout, check):
            case = Path(cwd)
            inp = (case / "model.inp").read_text(encoding="utf-8")
            self.assertIn("*ELEMENT,TYPE=C3D8", inp)
            self.assertIn("*MATERIAL,NAME=MATERIAL", inp)
            self.assertIn("*CLOAD", inp)
            (case / "model.dat").write_text(
                " displacements for set ALL\n"
                "     1     0.0001E+00  0.0002E+00  0.0003E+00\n"
                " stresses for element 1\n"
                "     1  1.0000E+08  2.0000E+08  3.0000E+08  1.0000E+07  2.0000E+07  3.0000E+07\n"
                " forces for set ALL\n"
                "     1  -1.0000E+02  2.0000E+02  3.0000E+02\n",
                encoding="utf-8",
            )
            return universal_dispatcher.subprocess.CompletedProcess(command, 0, stdout="done", stderr="")

        case = {
            "simulation_type": "structural_static",
            "geometry": {
                "dimensions": {"length_x": 2.0, "length_y": 1.0, "length_z": 0.5},
                "divisions": {"x": 2, "y": 1, "z": 1},
            },
            "material": {"young_modulus": 200000.0, "poisson_ratio": 0.3, "density": 7850e-12},
            "constraints": [{"face": "xmin", "dof": [1, 2, 3], "value": 0}],
            "loads": [{"face": "xmax", "direction": "x", "value": 1000}],
        }
        job_dir = Path("test-jobs") / uuid.uuid4().hex
        job_dir.mkdir(parents=True)
        try:
            with patch.dict("os.environ", {"NASEER_JOB_DIR": str(job_dir)}), \
                patch.object(universal_dispatcher.shutil, "which", return_value="ccx"), \
                patch.object(universal_dispatcher.subprocess, "run", side_effect=fake_run):
                result = universal_dispatcher.call_calculix_solver(case)
        finally:
            shutil.rmtree(job_dir.parent, ignore_errors=True)

        self.assertEqual(result["solver"], "CalculiX")
        self.assertEqual(result["displacements"][0]["node"], 1)
        self.assertAlmostEqual(result["displacements"][0]["magnitude"], 0.0003741657386773941)
        self.assertEqual(result["stress"][0]["element"], 1)
        self.assertGreater(result["stress"][0]["von_mises"], 0)
        self.assertEqual(result["reactions"][0]["node"], 1)

    def test_parser_is_empty_when_dat_is_missing(self):
        self.assertEqual(universal_dispatcher._parse_calculix_dat_displacements(Path("missing.dat")), [])


if __name__ == "__main__":
    unittest.main()
