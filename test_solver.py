import unittest
from physics_solver import solve_2d_thermal_dynamic

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

if __name__ == "__main__":
    unittest.main()