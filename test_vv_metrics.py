import json
import tempfile
import unittest
from pathlib import Path

import universal_dispatcher
from backend.vv_metrics import (
    KeyResultUnavailable,
    MeshStudyError,
    bilinear,
    compute_gci,
    compute_openfoam_metrics,
    extract_key_result,
    key_result_specs,
    mesh_stats,
    parse_internal_field,
    refine_payload,
    resolve_key_result,
    run_mesh_study,
)


class ComputeGciTests(unittest.TestCase):
    def test_reproduces_the_celik_2008_worked_example(self):
        # Celik et al., J. Fluids Eng. 130(7), 2008: N = 18000/8000/4500 (2-D), phi = 6.063/5.972/5.863.
        gci = compute_gci([5.863, 5.972, 6.063], [4500, 8000, 18000], dimension=2)
        self.assertEqual(gci["convergence_type"], "monotonic")
        self.assertAlmostEqual(gci["r21"], 1.5, places=6)
        self.assertAlmostEqual(gci["r32"], 1.3333333, places=5)
        self.assertAlmostEqual(gci["observed_order"], 1.53, delta=0.02)
        self.assertAlmostEqual(gci["extrapolated_value"], 6.1685, delta=0.002)
        self.assertAlmostEqual(gci["gci_fine_percent"], 2.2, delta=0.1)
        self.assertTrue(gci["grid_independent"])

    def test_exact_second_order_data_gives_order_two(self):
        # phi(h) = 10 + h^2 on h = 0.4, 0.2, 0.1 (cells ~ 1/h^2).
        gci = compute_gci([10.16, 10.04, 10.01], [25, 100, 400], dimension=2)
        self.assertAlmostEqual(gci["observed_order"], 2.0, places=6)
        self.assertAlmostEqual(gci["extrapolated_value"], 10.0, places=6)

    def test_divergence_is_reported_and_no_gci_is_given(self):
        # Changes grow with refinement, as a stress singularity does.
        gci = compute_gci([217.34, 234.27, 266.10], [8, 64, 512], dimension=3)
        self.assertEqual(gci["convergence_type"], "divergent")
        self.assertIsNone(gci["gci_fine_percent"])
        self.assertFalse(gci["grid_independent"])

    def test_oscillatory_convergence_gives_no_verdict(self):
        gci = compute_gci([10.0, 9.0, 9.5], [25, 100, 400], dimension=2)
        self.assertEqual(gci["convergence_type"], "oscillatory")
        self.assertIsNone(gci["grid_independent"])
        self.assertIsNotNone(gci["gci_fine_percent"])

    def test_identical_levels_are_converged(self):
        gci = compute_gci([40.0, 40.0, 40.0], [25, 100, 400], dimension=2)
        self.assertEqual(gci["convergence_type"], "converged")
        self.assertEqual(gci["gci_fine_percent"], 0.0)
        self.assertTrue(gci["grid_independent"])

    def test_absolute_uncertainty_does_not_depend_on_the_temperature_scale(self):
        celsius = compute_gci([41.0, 40.2, 40.05], [25, 100, 400], 2, offset=273.15)
        kelvin_values = [v + 273.15 for v in (41.0, 40.2, 40.05)]
        kelvin = compute_gci(kelvin_values, [25, 100, 400], 2, offset=0.0)
        self.assertAlmostEqual(celsius["uncertainty_fine"], kelvin["uncertainty_fine"], places=8)
        self.assertAlmostEqual(celsius["gci_fine_percent"], kelvin["gci_fine_percent"], places=6)
        # On the raw Celsius scale the relative GCI would be ~8x larger; the offset prevents that.
        raw = compute_gci([41.0, 40.2, 40.05], [25, 100, 400], 2, offset=0.0)
        self.assertGreater(raw["gci_fine_percent"], 5 * celsius["gci_fine_percent"])

    def test_cell_counts_must_increase(self):
        with self.assertRaises(ValueError):
            compute_gci([1.0, 2.0, 3.0], [100, 100, 400], 2)


class KeyResultRegistryTests(unittest.TestCase):
    def test_each_physics_has_exactly_one_default(self):
        for physics in ("Thermal_Transient", "CFD_Incompressible", "CFD_Compressible", "Structural_Static", "Structural_Dynamic"):
            with self.subTest(physics=physics):
                self.assertEqual(sum(spec.default for spec in key_result_specs(physics)), 1)

    def test_requested_keys_exist(self):
        self.assertEqual(resolve_key_result("CFD_Incompressible", "pressure_drop").id, "pressure_drop")
        self.assertEqual(resolve_key_result("Structural_Static", None).id, "max_von_mises")
        with self.assertRaises(KeyResultUnavailable):
            resolve_key_result("Thermal_Transient", "max_velocity")


class ThermalExtractionTests(unittest.TestCase):
    @staticmethod
    def _linear_field(nodes: int):
        # T = 100 - 80 x on x in [0, 1]; every row identical.
        return [[100.0 - 80.0 * c / (nodes - 1) for c in range(nodes)] for _ in range(nodes)]

    def test_center_is_sampled_at_the_physical_centre_on_every_grid(self):
        for nodes in (6, 11, 21):  # h = 0.2, 0.1, 0.05: only the last two have a node at x = 0.5
            with self.subTest(nodes=nodes):
                value = extract_key_result("center_temperature", "Thermal_Transient",
                                           {"temperature_matrix": self._linear_field(nodes), "units": {"temperature": "degC"}})
                self.assertAlmostEqual(value.value, 60.0, places=9)
                self.assertEqual(value.unit, "°C")
                self.assertEqual(value.offset, 273.15)

    def test_bilinear_is_exact_for_a_bilinear_field(self):
        grid = [[x + 2 * y for x in range(4)] for y in range(3)]
        self.assertAlmostEqual(bilinear(grid, 1.25, 0.5), 1.25 + 1.0)

    def test_invalid_matrix_is_rejected(self):
        with self.assertRaises(KeyResultUnavailable):
            extract_key_result("center_temperature", "Thermal_Transient", {"temperature_matrix": [[1.0, "x"]]})


# internalField layouts copied from real icoFoam output (final time step).
_U_TEXT = """/*--------------------------------*- C++ -*----------------------------------*\\
| =========                 |                                                 |
\\*---------------------------------------------------------------------------*/
FoamFile
{
    version     2.0;
    format      ascii;
    class       volVectorField;
    location    "1";
    object      U;
}
// * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * //

dimensions      [0 1 -1 0 0 0 0];


internalField   nonuniform List<vector> 
6
(
(1 0 0)
(0.5 0.5 0)
(0 2 0)
(1 1 0)
(0.1 0.1 0)
(3 4 0)
)
;

boundaryField
{
    inlet
    {
        type            fixedValue;
        value           uniform (1 0 0);
    }
    outlet
    {
        type            inletOutlet;
        value           nonuniform List<vector> 
2
(
(100 100 100)
(200 200 200)
)
;
    }
}
"""

_P_TEXT = """FoamFile
{
    version     2.0;
    format      ascii;
    class       volScalarField;
    object      p;
}
dimensions      [0 2 -2 0 0 0 0];


internalField   nonuniform List<scalar> 
6
(
2.0
1.0
4.0e-01
2.2
1.1
6e-01
)
;

boundaryField
{
    outlet { type fixedValue; value uniform 101325; }
}
"""


class OpenFoamParsingTests(unittest.TestCase):
    def test_nonuniform_vector_field_ignores_header_and_boundary_numbers(self):
        field = parse_internal_field(_U_TEXT)
        self.assertEqual(field["kind"], "vector")
        self.assertEqual(len(field["values"]), 6)
        self.assertEqual(field["values"][5], (3.0, 4.0, 0.0))
        self.assertEqual(field["dimensions"], (0, 1, -1, 0, 0, 0, 0))

    def test_uniform_and_compressed_forms(self):
        self.assertEqual(parse_internal_field("dimensions [0 0 0 0 0 0 0];\ninternalField uniform 5;")["values"], [5.0])
        self.assertEqual(parse_internal_field("internalField uniform (1 0 0);")["values"], [(1.0, 0.0, 0.0)])
        compressed = parse_internal_field("internalField nonuniform List<scalar> 4{0};")
        self.assertEqual(compressed["values"], [0.0] * 4)
        vectors = parse_internal_field("internalField nonuniform List<vector> 3{(0 1 0)};")
        self.assertEqual(vectors["values"], [(0.0, 1.0, 0.0)] * 3)

    def test_declared_count_must_match(self):
        with self.assertRaises(ValueError):
            parse_internal_field("internalField nonuniform List<scalar> 3\n(\n1\n2\n)\n;")

    def _case(self, nx=3, ny=2, nz=1):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        case = Path(directory.name)
        (case / "mesh_metadata.json").write_text(json.dumps({"cells": {"nx": nx, "ny": ny, "nz": nz, "total": nx * ny * nz}}))
        (case / "0").mkdir()
        (case / "0" / "U").write_text("dimensions [0 1 -1 0 0 0 0];\ninternalField uniform (0 0 0);")
        (case / "0" / "p").write_text("dimensions [0 2 -2 0 0 0 0];\ninternalField uniform 0;")
        final = case / "0.5"
        final.mkdir()
        (final / "U").write_text(_U_TEXT)
        (final / "p").write_text(_P_TEXT)
        return case

    def test_metrics_use_the_final_time_step(self):
        metrics = compute_openfoam_metrics(self._case())
        self.assertEqual(metrics["time_directory"], "0.5")
        self.assertAlmostEqual(metrics["max_velocity"]["value"], 5.0)
        self.assertEqual(metrics["max_velocity"]["unit"], "m/s")
        # Inlet layer (i = 0): cells 0 and 3 -> mean(2.0, 2.2); outlet layer (i = 2): cells 2 and 5 -> mean(0.4, 0.6).
        self.assertAlmostEqual(metrics["pressure_drop"]["value"], 2.1 - 0.5)
        self.assertEqual(metrics["pressure_drop"]["unit"], "m²/s²")
        self.assertEqual(metrics["mesh"], {"nx": 3, "ny": 2, "nz": 1, "cells": 6, "cells_total": 6, "dimension": 2})

    def test_mismatched_mesh_is_rejected(self):
        with self.assertRaises(KeyResultUnavailable):
            compute_openfoam_metrics(self._case(nx=4))

    def test_cfd_extraction_reads_metrics_and_reports_their_absence(self):
        data = {"metrics": compute_openfoam_metrics(self._case())}
        self.assertAlmostEqual(extract_key_result("max_velocity", "CFD_Incompressible", data).value, 5.0)
        self.assertEqual(mesh_stats("CFD_Incompressible", data).cells, 6)
        with self.assertRaises(KeyResultUnavailable) as raised:
            extract_key_result("max_velocity", "CFD_Incompressible", {"metrics_error": "ValueError: boom"})
        self.assertIn("boom", str(raised.exception))


# Section layout copied from a real CalculiX model.dat (headings are not followed by any '*' marker).
_DAT_TEXT = """
                        S T E P       1


                                INCREMENT     1


 displacements (vx,vy,vz) for set ALL and time  0.1000000E+01

         1 -2.824915E-19  1.000000E-03  1.461359E-18
         2  0.000000E+00  2.000000E-03  0.000000E+00

 forces (fx,fy,fz) for set ALL and time  0.1000000E+01

         1  1.000000E+01  2.000000E+01  3.000000E+01
         2  4.000000E+00  5.000000E+00  6.000000E+00

 stresses (elem, integ.pnt.,sxx,syy,szz,sxy,sxz,syz) for set SOLID and time  0.1000000E+01

         1   1  1.000000E+08  2.000000E+08  3.000000E+08  1.000000E+07  2.000000E+07  3.000000E+07
         1   2  4.000000E+08  5.000000E+08  6.000000E+08  4.000000E+07  5.000000E+07  6.000000E+07
"""


class CalculixDatParsingTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.dat = Path(directory.name) / "model.dat"
        self.dat.write_text(_DAT_TEXT, encoding="utf-8")

    def test_each_block_contains_only_its_own_rows(self):
        displacements = universal_dispatcher._parse_calculix_dat_displacements(self.dat)
        reactions = universal_dispatcher._parse_calculix_dat_reactions(self.dat)
        stress = universal_dispatcher._parse_calculix_dat_stress(self.dat)
        self.assertEqual([d["node"] for d in displacements], [1, 2])
        self.assertEqual([r["node"] for r in reactions], [1, 2])
        self.assertEqual([s["element"] for s in stress], [1, 1])

    def test_structural_extraction(self):
        data = {
            "displacements": universal_dispatcher._parse_calculix_dat_displacements(self.dat),
            "stress": universal_dispatcher._parse_calculix_dat_stress(self.dat),
            "units": {"displacement": "m", "von_mises": "Pa"},
        }
        stress = extract_key_result("max_von_mises", "Structural_Static", data)
        self.assertEqual(stress.unit, "Pa")
        self.assertAlmostEqual(stress.value, max(s["von_mises"] for s in data["stress"]))
        self.assertAlmostEqual(extract_key_result("max_displacement", "Structural_Static", data).value, 2.0e-3)
        stats = mesh_stats("Structural_Static", data)
        self.assertEqual((stats.cells, stats.nodes, stats.dimension), (1, 2, 3))

    def test_rigid_body_translation_is_refused(self):
        displacements = [
            {"node": n, "components": {"x": 0.0, "y": 1e-3, "z": 0.0}, "magnitude": 1e-3} for n in (1, 2, 3)
        ]
        data = {"displacements": displacements, "stress": [{"element": 1, "von_mises": 1.7e-13}], "units": {}}
        for key in ("max_von_mises", "max_displacement"):
            with self.subTest(key=key), self.assertRaises(KeyResultUnavailable) as raised:
                extract_key_result(key, "Structural_Static", data)
            self.assertIn("rigid body", str(raised.exception))


def _thermal_payload(mesh_size=0.1):
    return {
        "simulation_type": "Thermal_Transient",
        "execution_mode": "direct",
        "domain": {"width_x": 1.0, "height_y": 1.0},
        "mesh_size": mesh_size,
        "mesh_settings": {"mesh_size": mesh_size},
        "material_properties": {"thermal_conductivity_k": 400.0},
        "boundary_conditions": {
            "left_edge_x0": {"value": 100.0},
            "right_edge_x1": {"value": 20.0},
            "top_edge_y1": {"value": 20.0},
            "bottom_edge_y0": {"value": 20.0},
        },
    }


class RefinementTests(unittest.TestCase):
    def test_thermal_and_cfd_scale_mesh_size_without_touching_the_base(self):
        base = _thermal_payload(0.1)
        coarse = refine_payload("Thermal_Transient", base, 2.0)
        self.assertAlmostEqual(coarse["mesh_size"], 0.2)
        self.assertAlmostEqual(coarse["mesh_settings"]["mesh_size"], 0.2)
        self.assertEqual(base["mesh_size"], 0.1)

    def test_structural_refinement_uses_divisions(self):
        base = {"simulation_type": "Structural_Static", "mesh_size": 0.1}
        self.assertEqual(refine_payload("Structural_Static", base, 2.0)["mesh"]["divisions"], {"x": 1, "y": 1, "z": 1})
        self.assertEqual(refine_payload("Structural_Static", base, 1.0)["mesh"]["divisions"], {"x": 2, "y": 2, "z": 2})
        self.assertEqual(refine_payload("Structural_Static", base, 0.5)["mesh"]["divisions"], {"x": 4, "y": 4, "z": 4})
        custom = {"mesh": {"divisions": {"x": 4, "y": 2, "z": 2}}}
        self.assertEqual(refine_payload("Structural_Static", custom, 2.0)["mesh"]["divisions"], {"x": 2, "y": 1, "z": 1})

    def test_invalid_mesh_size_is_rejected(self):
        with self.assertRaises(MeshStudyError):
            refine_payload("Thermal_Transient", {"mesh_size": 0}, 2.0)


class MeshStudyTests(unittest.TestCase):
    def test_real_thermal_solver_study(self):
        study = run_mesh_study(_thermal_payload(0.1), "Thermal_Transient", None, universal_dispatcher.execute_simulation)
        self.assertEqual([level["cells"] for level in study["levels"]], [25, 100, 400])
        self.assertEqual([level["level"] for level in study["levels"]], ["coarse", "medium", "fine"])
        self.assertEqual(study["key_result"]["id"], "center_temperature")
        self.assertEqual(study["key_result"]["unit"], "°C")
        self.assertAlmostEqual(study["r21"], 2.0, places=6)
        self.assertEqual(study["schema_version"], 2)
        self.assertIn("K", study["basis_note"])
        # Every level samples the same physical point, so the values must be close to each other
        # (the previous index-based sampling read x = 0.6 m on the coarse grid and was ~6 degC off).
        values = [level["key_result"] for level in study["levels"]]
        self.assertLess(max(values) - min(values), 1.0)

    def test_study_refuses_when_the_solver_ignores_the_mesh(self):
        def fixed_mesh(payload):
            return universal_dispatcher.execute_simulation(_thermal_payload(0.1))

        with self.assertRaises(MeshStudyError) as raised:
            run_mesh_study(_thermal_payload(0.1), "Thermal_Transient", None, fixed_mesh)
        self.assertEqual(raised.exception.code, "MESH_NOT_REFINED")

    def test_solver_error_names_the_failing_level(self):
        calls = []

        def failing(payload):
            calls.append(payload)
            return {"status": "error", "error": "solver exploded"} if len(calls) == 2 else universal_dispatcher.execute_simulation(payload)

        with self.assertRaises(MeshStudyError) as raised:
            run_mesh_study(_thermal_payload(0.1), "Thermal_Transient", None, failing)
        self.assertEqual(raised.exception.code, "SOLVER_ERROR")
        self.assertIn("medium", str(raised.exception))
        self.assertIn("solver exploded", str(raised.exception))

    def test_unknown_key_result_is_rejected_before_any_solve(self):
        def never(_payload):
            raise AssertionError("the solver must not run")

        with self.assertRaises(KeyResultUnavailable):
            run_mesh_study(_thermal_payload(0.1), "Thermal_Transient", "max_velocity", never)

    @staticmethod
    def _structural_stub(payload):
        # Shaped like parsed CalculiX output; the peak stress grows mildly with n so the three levels differ.
        n = payload["mesh"]["divisions"]["x"]
        displacements = [
            {"node": i, "components": {"x": 0.0, "y": 1e-3 * (i % 3) / 2, "z": 0.0}, "magnitude": 1e-3 * (i % 3) / 2}
            for i in range(1, (n + 1) ** 3 + 1)
        ]
        stress = [{"element": e, "von_mises": 200.0 - 40.0 / n} for e in range(1, n ** 3 + 1)]
        return {"status": "success", "solver": "CalculiX",
                "data": {"displacements": displacements, "stress": stress, "units": {"von_mises": "Pa", "displacement": "m"}}}

    def test_structural_study_warns_when_the_coarse_level_is_a_single_element(self):
        base = {"simulation_type": "Structural_Static", "mesh_size": 0.1}
        study = run_mesh_study(base, "Structural_Static", None, self._structural_stub)
        self.assertEqual([level["cells"] for level in study["levels"]], [1, 8, 64])
        self.assertEqual(study["dimension"], 3)
        self.assertTrue(any("single element" in w for w in study["warnings"]))

        finer = {**base, "mesh": {"divisions": {"x": 4, "y": 4, "z": 4}}}
        study = run_mesh_study(finer, "Structural_Static", None, self._structural_stub)
        self.assertEqual([level["cells"] for level in study["levels"]], [8, 64, 512])
        self.assertFalse(any("single element" in w for w in study["warnings"]))


if __name__ == "__main__":
    unittest.main()
