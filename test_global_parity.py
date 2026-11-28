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

            self.assertTrue(case_dir.is_relative_to(allowed_root))
            outside = Path("/etc").resolve()
            self.assertFalse(outside.is_relative_to(allowed_root))

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

    def test_openfoam_function_objects_and_postprocessing_parser(self) -> None:
        from universal_dispatcher import _build_openfoam_function_objects, _parse_openfoam_postprocessing

        fn_block = _build_openfoam_function_objects(
            "simpleFoam",
            {"inlet": "inlet", "outlet": "outlet", "walls": "wall"},
            rho=1.225,
            velocity=12.0,
            width=1.0,
            height=0.2,
            depth=0.2,
            compressible=False,
        )
        self.assertIn("type yPlus;", fn_block)
        self.assertIn("type wallShearStress;", fn_block)
        self.assertIn("type forceCoeffs;", fn_block)
        self.assertIn("patches (walls);", fn_block)

        with tempfile.TemporaryDirectory() as tmp:
            case_dir = Path(tmp)
            (case_dir / "postProcessing" / "yPlus" / "0").mkdir(parents=True, exist_ok=True)
            (case_dir / "postProcessing" / "yPlus" / "0" / "yPlus.dat").write_text(
                "# Time patch min max average\n100 walls 0.82 28.4 12.15\n",
                encoding="utf-8",
            )
            (case_dir / "postProcessing" / "wallShearStress" / "0").mkdir(parents=True, exist_ok=True)
            (case_dir / "postProcessing" / "wallShearStress" / "0" / "wallShearStress.dat").write_text(
                "# Time patch min max\n100 walls (-0.5 0 0) (-3.0 4.0 0)\n",
                encoding="utf-8",
            )
            (case_dir / "postProcessing" / "forceCoeffs" / "0").mkdir(parents=True, exist_ok=True)
            (case_dir / "postProcessing" / "forceCoeffs" / "0" / "coefficient.dat").write_text(
                "# Time Cd Cs Cl CmRoll\n100 0.342 0.001 0.118 0.0\n",
                encoding="utf-8",
            )
            parsed = _parse_openfoam_postprocessing(case_dir)
            self.assertAlmostEqual(parsed["y_plus_min"], 0.82)
            self.assertAlmostEqual(parsed["y_plus_max"], 28.4)
            self.assertAlmostEqual(parsed["y_plus_avg"], 12.15)
            self.assertAlmostEqual(parsed["wall_shear_stress_max_pa"], 5.0)
            self.assertAlmostEqual(parsed["drag_coefficient_cd"], 0.342)
            self.assertAlmostEqual(parsed["lift_coefficient_cl"], 0.118)

    def test_streaming_command_emits_live_openfoam_residuals(self) -> None:
        import sys
        from universal_dispatcher import _STREAM_STATE, _run_streaming_command

        emitted: list[dict] = []
        _STREAM_STATE.callback = lambda payload: emitted.append(payload)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                case_dir = Path(tmp)
                script = (
                    "import time, sys\n"
                    "for i in range(1, 4):\n"
                    "    print(f'Time = {i}', flush=True)\n"
                    "    print(f'smoothSolver:  Solving for Ux, Initial residual = {0.5 / i:.6f}, Final residual = 1e-6, No Iterations 2', flush=True)\n"
                    "    print(f'GAMG:  Solving for p, Initial residual = {0.8 / i:.6f}, Final residual = 1e-6, No Iterations 3', flush=True)\n"
                    "    time.sleep(0.35)\n"
                )
                proc = _run_streaming_command(
                    [sys.executable, "-c", script],
                    cwd=case_dir,
                    timeout=15,
                    log_path=case_dir / "solver.log",
                    append_log=False,
                    solver_kind="openfoam",
                    max_iters=3,
                )
                self.assertEqual(proc.returncode, 0)
                self.assertTrue((case_dir / "solver.log").exists())
                self.assertGreaterEqual(len(emitted), 1)
                self.assertIn("Ux", emitted[-1]["residuals"])
                self.assertIn("p", emitted[-1]["residuals"])
        finally:
            _STREAM_STATE.callback = None

    def test_stl_bounds_parser_binary_and_ascii(self) -> None:
        import struct
        from universal_dispatcher import _compute_stl_bounds

        with tempfile.TemporaryDirectory() as tmp:
            # ASCII STL test
            ascii_path = Path(tmp) / "wing_ascii.stl"
            ascii_path.write_text(
                "solid wing\n"
                "  facet normal 0 0 1\n"
                "    outer loop\n"
                "      vertex 0.0 -0.1 0.0\n"
                "      vertex 1.2 0.2 0.0\n"
                "      vertex 0.5 0.15 0.4\n"
                "    endloop\n"
                "  endfacet\n"
                "endsolid wing\n",
                encoding="utf-8",
            )
            bmin, bmax = _compute_stl_bounds(ascii_path)
            self.assertAlmostEqual(bmin[0], 0.0)
            self.assertAlmostEqual(bmin[1], -0.1)
            self.assertAlmostEqual(bmax[0], 1.2)
            self.assertAlmostEqual(bmax[2], 0.4)

            # Binary STL test (1 triangle)
            bin_path = Path(tmp) / "body_bin.stl"
            header = b"NASEER_BIN_STL".ljust(80, b"\x00")
            tri_hdr = struct.pack("<I", 1)
            tri_body = struct.pack("<12fH", 0.0, 0.0, 1.0, -0.5, 0.0, -0.2, 0.5, 0.3, 0.2, 0.0, 0.1, 0.0, 0)
            bin_path.write_bytes(header + tri_hdr + tri_body)
            bb_min, bb_max = _compute_stl_bounds(bin_path)
            self.assertAlmostEqual(bb_min[0], -0.5, places=5)
            self.assertAlmostEqual(bb_max[0], 0.5, places=5)
            self.assertAlmostEqual(bb_max[1], 0.3, places=5)

    def test_external_aero_snappy_wind_tunnel_and_obstacle_force_coeffs(self) -> None:
        from universal_dispatcher import (
            _build_external_wind_tunnel_spec,
            _build_openfoam_function_objects,
            _write_external_aero_dicts,
        )

        spec = _build_external_wind_tunnel_spec(
            [0.0, -0.1, -0.2],
            [1.0, 0.1, 0.2],
            upstream_mult=3.0,
            downstream_mult=6.0,
            pad_mult=2.5,
            base_cell_size=0.25,
        )
        lx, ly, lz = spec["location_in_mesh"]
        tx0, ty0, tz0 = spec["tunnel_min"]
        tx1, ty1, tz1 = spec["tunnel_max"]
        # locationInMesh must be strictly inside tunnel and outside obstacle
        self.assertTrue(tx0 < lx < tx1 and ty0 < ly < ty1 and tz0 < lz < tz1)
        self.assertLess(lx, 0.0)

        with tempfile.TemporaryDirectory() as tmp:
            case_dir = Path(tmp)
            (case_dir / "system").mkdir(parents=True, exist_ok=True)
            _write_external_aero_dicts(
                case_dir,
                spec,
                surface_level=2,
                wake_level=1,
                inflation_layers=4,
                growth_rate=1.2,
                use_feature_extract=True,
            )
            bm = (case_dir / "system" / "blockMeshDict").read_text(encoding="utf-8")
            sfe = (case_dir / "system" / "surfaceFeatureExtractDict").read_text(encoding="utf-8")
            shm = (case_dir / "system" / "snappyHexMeshDict").read_text(encoding="utf-8")
            self.assertIn("farfield { type patch;", bm)
            self.assertIn("obstacle.stl", sfe)
            self.assertIn("addLayers       true;", shm)
            self.assertIn("wakeBox", shm)
            self.assertIn("nSurfaceLayers 4;", shm)
            self.assertIn("level (2 3);", shm)

        fn_block = _build_openfoam_function_objects(
            "simpleFoam",
            {"inlet": "inlet", "outlet": "outlet", "farfield": "slip", "obstacle": "wall"},
            rho=1.225,
            velocity=25.0,
            width=1.0,
            height=0.2,
            depth=0.4,
            compressible=False,
        )
        self.assertIn("patches (obstacle);", fn_block)
        self.assertNotIn("farfield", fn_block)

    def test_sample_node_telemetry_and_wall_clock_computation(self) -> None:
        import os
        from universal_dispatcher import compute_wall_clock_sec, sample_node_telemetry

        tel = sample_node_telemetry(pid=os.getpid())
        self.assertGreaterEqual(tel["cpu_cores"], 1)
        if tel["cpu_percent"] is not None:
            self.assertGreaterEqual(tel["cpu_percent"], 0.0)
            self.assertLessEqual(tel["cpu_percent"], 100.0)
        if tel["memory_total_mb"] is not None:
            self.assertGreater(tel["memory_total_mb"], 0.0)
            self.assertGreaterEqual(tel["memory_percent"], 0.0)
            self.assertLessEqual(tel["memory_percent"], 100.0)
        if Path(f"/proc/{os.getpid()}/status").exists():
            self.assertIsNotNone(tel["solver_rss_mb"])
            self.assertGreater(tel["solver_rss_mb"], 0.0)

        elapsed = compute_wall_clock_sec("2026-11-20T10:00:00Z", "2026-11-20T10:02:15Z")
        self.assertAlmostEqual(elapsed, 135.0, places=2)


if __name__ == "__main__":
    unittest.main()
