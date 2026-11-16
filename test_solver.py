import unittest
from physics_solver import solve_2d_thermal_dynamic, solve_simulation
from backend.report_generator import generate_academic_report


class TestPhysicsEngine(unittest.TestCase):

    def test_legacy_python_thermal_solver_is_disabled(self):
        with self.assertRaisesRegex(RuntimeError, "disabled"):
            solve_2d_thermal_dynamic({})

    def test_legacy_python_router_is_disabled(self):
        with self.assertRaisesRegex(RuntimeError, "disabled"):
            solve_simulation({"simulation_type": "Thermal_Steady"})

    def test_missing_solver_values_do_not_use_report_defaults(self):
        report = generate_academic_report({"data": {}})
        text = "\n".join(
            section["content"] if isinstance(section["content"], str) else "".join(section["content"])
            for section in report["sections"]
        )
        self.assertIn("not available", text)
        self.assertNotIn("0.999000", text)


if __name__ == "__main__":
    unittest.main()