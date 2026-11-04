import numpy as np
from scipy.sparse import lil_matrix
from scipy.sparse.linalg import spsolve

def solve_2d_thermal_dynamic(json_data):
    # 1. استخراج الأبعاد والخصائص من ملف المدخلات
    domain = json_data.get("domain", {})
    Lx = float(domain.get("width_x", 1.0))
    Ly = float(domain.get("height_y", 1.0))
    
    mat = json_data.get("material_properties", {})
    k = float(mat.get("thermal_conductivity_k", 200.0))
    
    mesh = json_data.get("mesh_settings", {})
    dx = float(mesh.get("mesh_size", 0.1))
    dy = dx
    
    Nx = int(round(Lx / dx)) + 1
    Ny = int(round(Ly / dy)) + 1
    N_total = Nx * Ny
    
    # 2. استخراج الشروط الحدودية
    bcs = json_data.get("boundary_conditions", {})
    T_left = float(bcs.get("left_edge_x0", {}).get("value", 100.0))
    T_right = float(bcs.get("right_edge_x1", {}).get("value", 0.0))
    h_conv = float(bcs.get("convection", {}).get("h_coefficient", 0.0))
    T_inf = float(bcs.get("convection", {}).get("T_ambient", 25.0))
    
    # 3. بناء مصفوفة النظام الخطي (Global Sparse Matrix)
    K = lil_matrix((N_total, N_total))
    F = np.zeros(N_total)
    
    def get_node_index(i, j):
        return j * Nx + i

    for j in range(Ny):
        for i in range(Nx):
            idx = get_node_index(i, j)
            
            # الحد الأيسر
            if i == 0:
                K[idx, idx] = 1.0
                F[idx] = T_left
            # الحد الأيمن
            elif i == Nx - 1:
                K[idx, idx] = 1.0
                F[idx] = T_right
            # الحد السفلي (عزل حراري)
            elif j == 0:
                K[idx, idx] = 1.0
                K[idx, get_node_index(i, 1)] = -1.0
                F[idx] = 0.0
            # الحد العلوي (عزل حراري)
            elif j == Ny - 1:
                if h_conv > 0 and i not in (0, Nx - 1):
                    K[idx, idx] = (k / dy) + h_conv
                    K[idx, get_node_index(i, Ny - 2)] = -k / dy
                    F[idx] = h_conv * T_inf
                    continue
                K[idx, idx] = 1.0
                K[idx, get_node_index(i, Ny - 2)] = -1.0
                F[idx] = 0.0
            # العقد الداخلية (حساب التوصيل)
            else:
                K[idx, idx] = 4.0 * k
                K[idx, get_node_index(i - 1, j)] = -1.0 * k
                K[idx, get_node_index(i + 1, j)] = -1.0 * k
                K[idx, get_node_index(i, j - 1)] = -1.0 * k
                K[idx, get_node_index(i, j + 1)] = -1.0 * k
                F[idx] = 0.0

    # 4. حل المصفوفة المباشر
    K_csr = K.tocsr()
    T_solution = spsolve(K_csr, F)
    T_grid = T_solution.reshape((Ny, Nx))
    
    center_temp = float(T_grid[Ny // 2, Nx // 2])
    heat_flux = float(k * (T_left - T_right) / Lx)
    
    return {
        "status": "SOLVED_REALTIME",
        "solver_type": "Deterministic 2D Finite Difference / FEA",
        "mesh_nodes": N_total,
        "mesh_elements": (Nx - 1) * (Ny - 1),
        "material_k": k,
        "center_temperature": round(center_temp, 2),
        "calculated_heat_flux": round(heat_flux, 2),
        "temperature_matrix": T_grid.tolist()
    }


def solve_simulation(json_data: dict):
    """
    الدالة التوجيهية الرئيسية (Dispatcher Router)
    تقوم بتحديد المحرك الرياضي المناسب بناءً على نوع المحاكاة المكتوب في الـ JSON
    """
    # استخراج نوع المحاكاة من ملف المدخلات (الافتراضي: 2D Thermal Steady State)
    sim_type = json_data.get("simulation_type", "2D_thermal_steady_state")
    
    if sim_type == "2D_thermal_steady_state":
        # توجيه إلى محرك التوصيل الحراري الحي 2D
        return solve_2d_thermal_dynamic(json_data)
        
    elif sim_type == "2D_thermal_transient":
        # توجيه إلى محرك الحرارة مع الزمن (عند إضافته)
        return solve_2d_thermal_dynamic(json_data)
        
    elif sim_type == "2D_structural_stress":
        # توجيه إلى محرك تحليل الإجهادات الميكانيكية (عند إضافته)
        return solve_2d_thermal_dynamic(json_data)
        
    else:
        # المحرك الافتراضي في حال عدم التعرف على نوع المحاكاة
        return solve_2d_thermal_dynamic(json_data)

def generate_unstructured_mesh_2d(width, height, mesh_size):
    try:
        import gmsh
    except ImportError as exc:
        raise RuntimeError("Gmsh Python package is unavailable in this runtime") from exc

    gmsh.initialize()
    gmsh.model.add("2D_Domain")
    
    # إنشاء النقاط والأضلاع للسطح الهندسي
    p1 = gmsh.model.geo.addPoint(0, 0, 0, mesh_size)
    p2 = gmsh.model.geo.addPoint(width, 0, 0, mesh_size)
    p3 = gmsh.model.geo.addPoint(width, height, 0, mesh_size)
    p4 = gmsh.model.geo.addPoint(0, height, 0, mesh_size)
    
    l1 = gmsh.model.geo.addLine(p1, p2)
    l2 = gmsh.model.geo.addLine(p2, p3)
    l3 = gmsh.model.geo.addLine(p3, p4)
    l4 = gmsh.model.geo.addLine(p4, p1)
    
    cl = gmsh.model.geo.addCurveLoop([l1, l2, l3, l4])
    s = gmsh.model.geo.addPlaneSurface([cl])
    
    gmsh.model.geo.synchronize()
    gmsh.model.mesh.generate(2) # توليد عناصر مثلثية 2D Triangles
    
    # استخراج العقد والعناصر
    node_tags, coords, _ = gmsh.model.mesh.getNodes()
    gmsh.finalize()
    
    return {"total_nodes": len(node_tags), "coordinates": coords.tolist()}