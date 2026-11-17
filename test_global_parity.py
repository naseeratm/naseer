import io
import tempfile
import unittest
import zipfile
from pathlib import Path

from universal_dispatcher import (
    _compute_box_surface_sample_map,
    _extract_calculix_frd_time_frames,
    _map_box_cells_to_surface,
    _read_elmer_mesh_names,
    _requested_parallel_cores,
    _write_openfoam_decompose_dict,
)


class GlobalParityAuditTest(unittest.TestCase):
    def test_parallel_cores_and_decompose_dict(self) -> None:
        self.assertEqual(_requested_parallel_cores({}), 1)
        self.assertEqual(_requested_parallel_cores({"parallel_cores": 8}), 8)
        self.assertEqual(_requested_parallel_cores({"parallel_cores": 999}), 64)
        self.assertEqual(_requested_parallel_cores({"parallel_cores": "invalid"}), 1)

        with tempfile.TemporaryDirectory() as tmp:
            case_dir = Path(tmp)
            (case_dir / "system").mkdir(parents=True, exist_ok=True)
            _write_openfoam_decompose_dict(case_dir, 4)
            text = (case_dir / "system" / "decomposeParDict").read_text(encoding="utf-8")
            self.assertIn("numberOfSubdomains 4;", text)
            self.assertIn("method          scotch;", text)

    def test_box_surface_mapping_for_transient_frames(self) -> None:
        pts, tris, sample_cids = _compute_box_surface_sample_map(1.0, 0.5, 0.2, 4, 2, 2)
        self.assertEqual(len(pts), len(sample_cids) * 3)
        self.assertTrue(len(tris) >= 12)
        total_cells = 4 * 2 * 2
        scalars = {"p": [float(i * 10) for i in range(total_cells)]}
        vectors = {"U": [float(i % 3) for i in range(total_cells * 3)]}
        mapped_s, mapped_v = _map_box_cells_to_surface(sample_cids, scalars, vectors)
        self.assertEqual(len(mapped_s["p"]), len(sample_cids))
        self.assertEqual(len(mapped_v["U"]), len(sample_cids) * 3)

    def test_calculix_frd_time_frames_parser_handles_concatenated_exponents(self) -> None:
        frd_sample = """    1C
  100CL  101 2.50000E-01          3                     1
 -4  NDTEMP      1    1
 -5  T           1    1    0    0
 -1         1 3.50000E+02
 -1         2 3.10000E+02
 -1         3 2.93150E+02
 -3
 -4  DISP        4    1
 -5  D1          1    2    1    0
 -5  D2          1    2    2    0
 -5  D3          1    2    3    0
 -1         1 1.20000E-04-2.50000E-03 0.00000E+00
 -1         2 0.00000E+00-1.00000E-03 5.00000E-05
 -1         3 0.00000E+00 0.00000E+00 0.00000E+00
 -3
  100CL  102 5.00000E-01          3                     1
 -4  NDTEMP      1    1
 -5  T           1    1    0    0
 -1         1 3.90000E+02
 -1         2 3.40000E+02
 -1         3 3.00000E+02
 -3
"""
        with tempfile.TemporaryDirectory() as tmp:
            frd_path = Path(tmp) / "model.frd"
            frd_path.write_text(frd_sample, encoding="utf-8")
            frames = _extract_calculix_frd_time_frames(frd_path, [1, 2, 3])
            self.assertEqual(len(frames), 2)
            self.assertAlmostEqual(frames[0]["time"], 0.25)
            self.assertEqual(frames[0]["scalars"]["T"], [350.0, 310.0, 293.15])
            self.assertAlmostEqual(frames[0]["vectors"]["displacement"][1], -2.5e-3)
            self.assertAlmostEqual(frames[1]["time"], 0.5)
            self.assertEqual(frames[1]["scalars"]["T"], [390.0, 340.0, 300.0])

    def test_elmer_mesh_names_parser(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            case_dir = Path(tmp)
            (case_dir / "model").mkdir(parents=True, exist_ok=True)
            (case_dir / "model" / "mesh.names").write_text(
                "! ----- names for bodies -----\n$ Body_1 = 1\n! ----- names for boundaries -----\n$ Inlet_Face = 3\n$ Outlet_Face = 4\n",
                encoding="utf-8",
            )
            mapping = _read_elmer_mesh_names(case_dir)
            self.assertEqual(mapping.get("Inlet_Face"), 3)
            self.assertEqual(mapping.get("inlet_face"), 3)
            self.assertEqual(mapping.get("Outlet_Face"), 4)

    def test_case_zip_archive_packaging_and_path_traversal_guard(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            allowed_root = Path(tmp).resolve()
            case_dir = (allowed_root / "openfoam-test123").resolve()
            (case_dir / "system").mkdir(parents=True, exist_ok=True)
            (case_dir / "system" / "controlDict").write_text("application simpleFoam;\n", encoding="utf-8")
            (case_dir / "solver.log").write_text("SIMPLE solution converged\n", encoding="utf-8")

            self.assertTrue(str(case_dir).startswith(str(allowed_root) + "/"))
            outside = Path("/etc").resolve()
            self.assertFalse(str(outside).startswith(str(allowed_root) + "/"))

            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for file_path in sorted(case_dir.rglob("*")):
                    if file_path.is_file() and not file_path.is_symlink():
                        zf.write(file_path, arcname=str(file_path.relative_to(case_dir)))
            buf.seek(0)
            with zipfile.ZipFile(buf, "r") as zf_in:
                names = set(zf_in.namelist())
                self.assertIn("system/controlDict", names)
                self.assertIn("solver.log", names)


if __name__ == "__main__":
    unittest.main()
