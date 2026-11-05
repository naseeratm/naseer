import unittest

from backend.result_schema import canonicalize_result


class ResultSchemaTests(unittest.TestCase):
    def test_canonical_result_has_all_contract_sections(self):
        result = canonicalize_result(
            {"status": "SOLVED_REALTIME", "solver": "OpenFOAM"},
            physics_type="CFD_Incompressible",
            input_data={"simulation_type": "CFD"},
        )
        self.assertEqual(result["schema_version"], "1.0")
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["provenance"]["solver"], "OpenFOAM")
        self.assertEqual(result["convergence"]["status"], "not_reported")
        self.assertEqual(result["artifacts"], {})
        self.assertEqual(result["errors"], [])

    def test_error_result_is_explicit(self):
        result = canonicalize_result(
            {"status": "error", "error": "solver unavailable"},
            physics_type="Structural_Static",
            input_data={},
        )
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["errors"][0]["code"], "SOLVER_ERROR")
        self.assertIn("solver unavailable", result["errors"][0]["message"])
