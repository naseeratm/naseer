"""Unit tests for Phase 2 Automated International V&V Regression Suite."""

from __future__ import annotations

import json
import math
import tempfile
import unittest
from pathlib import Path

from universal_dispatcher import _parse_calculix_modal_or_buckling
from vv_regression_suite import (
    VV_BENCHMARK_BY_ID,
    VV_BENCHMARKS,
    evaluate_benchmark_result,
    generate_vv_certificate_json,
    generate_vv_certificate_markdown,
    list_vv_benchmarks,
    run_vv_suite,
)


class VVRegressionSuiteTests(unittest.TestCase):
    def test_six_canonical_benchmarks_and_exact_analytical_references(self) -> None:
        self.assertEqual(len(VV_BENCHMARKS), 6)
        self.assertAlmostEqual(VV_BENCHMARK_BY_ID["ASME-VV20-CFD-01"]["reference_value"], 0.015, places=6)
        self.assertAlmostEqual(VV_BENCHMARK_BY_ID["NASA-TMR-CFD-02"]["reference_value"], 1.18, places=4)
        self.assertAlmostEqual(VV_BENCHMARK_BY_ID["ASME-VV20-THM-01"]["reference_value"], 60.0, places=4)
        self.assertAlmostEqual(VV_BENCHMARK_BY_ID["NAFEMS-FEA-01"]["reference_value"], 0.00292969, places=7)
        self.assertAlmostEqual(VV_BENCHMARK_BY_ID["NAFEMS-FEA-02"]["reference_value"], 65.2304, places=3)
        self.assertAlmostEqual(VV_BENCHMARK_BY_ID["ASME-EM-01"]["reference_value"], 50.0, places=4)

    def test_evaluate_pass_and_fail_across_all_six_physics_domains(self) -> None:
        # 1. Hagen-Poiseuille PASS & FAIL
        cfd_ok = evaluate_benchmark_result(
            "ASME-VV20-CFD-01",
            {"status": "SOLVED_REALTIME", "data": {"integrals": {"max_velocity_mps": 0.01485}}},
        )
        self.assertEqual(cfd_ok["status"], "PASS")
        self.assertLessEqual(cfd_ok["relative_error_percent"], 1.1)

        cfd_bad = evaluate_benchmark_result(
            "ASME-VV20-CFD-01",
            {"status": "SOLVED_REALTIME", "data": {"integrals": {"max_velocity_mps": 0.025}}},
        )
        self.assertEqual(cfd_bad["status"], "FAIL")

        # 2. NASA TMR Turbulent Channel PASS & FAIL (missing wall shear)
        tmr_ok = evaluate_benchmark_result(
            "NASA-TMR-CFD-02",
            {
                "status": "SOLVED_REALTIME",
                "data": {"integrals": {"max_velocity_mps": 1.80, "wall_shear_stress_max_pa": 0.012, "y_plus_avg": 24.0}},
            },
        )
        self.assertEqual(tmr_ok["status"], "PASS")
        self.assertAlmostEqual(tmr_ok["simulated_value"], 1.2, places=4)

        tmr_no_wss = evaluate_benchmark_result(
            "NASA-TMR-CFD-02",
            {"status": "SOLVED_REALTIME", "data": {"integrals": {"max_velocity_mps": 1.80}}},
        )
        self.assertEqual(tmr_no_wss["status"], "FAIL")

        # 3. Fourier Steady Plate PASS
        thm_ok = evaluate_benchmark_result(
            "ASME-VV20-THM-01",
            {"status": "SOLVED_REALTIME", "data": {"center_temperature": 60.05, "calculated_heat_flux": 3995.0}},
        )
        self.assertEqual(thm_ok["status"], "PASS")

        # 4. NAFEMS Cantilever Beam Static PASS
        fea_ok = evaluate_benchmark_result(
            "NAFEMS-FEA-01",
            {"status": "SOLVED_REALTIME", "data": {"integrals": {"max_displacement_m": 0.00296, "max_von_mises_pa": 9.3e7}}},
        )
        self.assertEqual(fea_ok["status"], "PASS")

        # 5. NAFEMS Modal Frequency PASS (both direct frequency_hz and eigenvalue-derived fallback)
        omega = 2.0 * math.pi * 64.9
        modal_ok = evaluate_benchmark_result(
            "NAFEMS-FEA-02",
            {
                "status": "SOLVED_REALTIME",
                "data": {"modes": [{"mode": 1, "eigenvalue": omega ** 2, "frequency_or_factor": omega}]},
            },
        )
        self.assertEqual(modal_ok["status"], "PASS")
        self.assertAlmostEqual(modal_ok["simulated_value"], 64.9, places=3)

        # 6. ElmerFEM Parallel-Plate Electrostatic PASS & boundary violation FAIL
        em_ok = evaluate_benchmark_result(
            "ASME-EM-01",
            {"status": "SOLVED_REALTIME", "data": {"integrals": {"field_average": 50.2, "field_min": 0.0, "field_max": 100.0}}},
        )
        self.assertEqual(em_ok["status"], "PASS")

        em_bad_bc = evaluate_benchmark_result(
            "ASME-EM-01",
            {"status": "SOLVED_REALTIME", "data": {"integrals": {"field_average": 50.0, "field_min": 0.0, "field_max": 50.0}}},
        )
        self.assertEqual(em_bad_bc["status"], "FAIL")

    def test_zero_mock_guard_skips_when_solver_binaries_unavailable(self) -> None:
        empty_caps = {
            "openfoam": {"available": False, "version": None},
            "calculix": {"available": False, "version": None},
            "elmer": {"available": False, "version": None},
        }
        catalog = list_vv_benchmarks(empty_caps)
        self.assertTrue(all(not item["solver_available"] for item in catalog))

        def _never_called(_payload):
            raise AssertionError("Executor must not be invoked when required binary is unavailable")

        report = run_vv_suite(executor=_never_called, capabilities=empty_caps)
        self.assertEqual(report["overall_status"], "SKIPPED_NO_SOLVERS")
        self.assertEqual(report["summary"]["passed"], 0)
        self.assertEqual(report["summary"]["failed"], 0)
        self.assertEqual(report["summary"]["skipped"], 6)
        self.assertEqual(len(report["sha256_integrity_hash"]), 64)

        md = generate_vv_certificate_markdown(report)
        self.assertIn("ASME-VV20-CFD-01", md)
        self.assertIn("SKIPPED_NO_BINARY", md)
        self.assertIn(report["sha256_integrity_hash"], md)

        parsed_json = json.loads(generate_vv_certificate_json(report))
        self.assertEqual(parsed_json["sha256_integrity_hash"], report["sha256_integrity_hash"])

    def test_calculix_modal_dat_parser_extracts_cycles_per_time_hz(self) -> None:
        sample_dat = """
     E I G E N V A L U E   O U T P U T

 MODE NO      EIGENVALUE           FREQUENCY               FREQUENCY
                                  (RAD/TIME)            (CYCLES/TIME)
      1   0.1680010E+06       0.4098793E+03         0.6523431E+02
      2   0.1052812E+07       0.1026066E+04         0.1633035E+03
"""
        with tempfile.TemporaryDirectory() as tmpdir:
            dat_path = Path(tmpdir) / "case.dat"
            dat_path.write_text(sample_dat, encoding="utf-8")
            modes = _parse_calculix_modal_or_buckling(dat_path)
            self.assertEqual(len(modes), 2)
            self.assertEqual(modes[0]["mode"], 1)
            self.assertAlmostEqual(modes[0]["frequency_hz"], 65.23431, places=4)
            self.assertAlmostEqual(modes[1]["frequency_hz"], 163.3035, places=3)

    def test_payloads_match_universal_dispatcher_physics_keys(self) -> None:
        # OpenFOAM Hagen-Poiseuille exact Re_H = rho * U * H / mu == 100
        p_cfd1 = VV_BENCHMARK_BY_ID["ASME-VV20-CFD-01"]["payload"]
        fp1 = p_cfd1["fluid_properties"]
        re_h = fp1["density"] * p_cfd1["velocity"] * p_cfd1["height_y"] / fp1["dynamic_viscosity"]
        self.assertAlmostEqual(re_h, 100.0, places=6)

        # OpenFOAM NASA TMR turbulent channel uses air dynamic_viscosity 1.81e-5 Pa.s
        p_cfd2 = VV_BENCHMARK_BY_ID["NASA-TMR-CFD-02"]["payload"]
        self.assertAlmostEqual(p_cfd2["fluid_properties"]["dynamic_viscosity"], 1.81e-5, places=8)

        # CalculiX thermal uses material.thermal_conductivity_k == 50.0
        p_thm = VV_BENCHMARK_BY_ID["ASME-VV20-THM-01"]["payload"]
        self.assertEqual(p_thm["material"]["thermal_conductivity_k"], 50.0)

        # CalculiX FEA static & modal use material.young_modulus == 200 GPa
        for bid in ("NAFEMS-FEA-01", "NAFEMS-FEA-02"):
            mat = VV_BENCHMARK_BY_ID[bid]["payload"]["material"]
            self.assertEqual(mat["young_modulus"], 200e9)
            self.assertEqual(mat["poisson_ratio"], 0.3)

        # ElmerFEM electrostatic uses em_parameters.source_value == 100 V
        em = VV_BENCHMARK_BY_ID["ASME-EM-01"]["payload"]["em_parameters"]
        self.assertEqual(em["source_value"], 100.0)
        self.assertEqual(em["reference_value"], 0.0)


if __name__ == "__main__":
    unittest.main()
