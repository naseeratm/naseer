import unittest
from physics_solver import solve_2d_thermal_dynamic
from backend.report_generator import generate_academic_report

class TestPhysicsEngine(unittest.TestCase):

    def test_analytical_conduction_exactness(self):
        # مدخلات قياسية ذات حل تحليلي معروف: T(x) = T1 + (T2 - T1)*(x/L)
        sample_json = {
            "domain": {"width_x": 1.0, "height_y": 1.0},
            "material_properties": {"thermal_conductivity_k": 200.0},
            "mesh_settings": {"mesh_size": 0.1},
            "boundary_conditions": {
                "left_edge_x0": {"value": 100.0},
                "right_edge_x1": {"value": 0.0}
            }
        }
        
        results = solve_2d_thermal_dynamic(sample_json)
        
        # 1. التحقق من درجة حرارة المنتصف (يجب أن تكون 50.0 °C بالضبط)
        self.assertEqual(results["center_temperature"], 50.0)
        
        # 2. التحقق من نسبة الخطأ للفيض الحراري (20000 W/m²)
        self.assertAlmostEqual(results["calculated_heat_flux"], 20000.0, places=1)
        
        print("\n[SUCCESS] جميع الفحوصات الفيزيائية مطابقة للحلول التحليلية بنسبة 100%.")

    def test_missing_solver_values_do_not_use_report_defaults(self):
        report = generate_academic_report({"data": {}})
        text = "\n".join(
            section["content"] if isinstance(section["content"], str) else "".join(section["content"])
            for section in report["sections"]
        )
        self.assertIn("not available", text)
        self.assertNotIn("0.999000", text)

    def test_missing_thermal_inputs_raise_instead_of_fabricating_values(self):
        with self.assertRaisesRegex(ValueError, "Thermal domain"):
            solve_2d_thermal_dynamic({})

if __name__ == "__main__":
    unittest.main()