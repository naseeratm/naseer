import numpy as np
from scipy.sparse import lil_matrix
from scipy.sparse.linalg import spsolve

def solve_2d_thermal_dynamic(json_data):
    # 1. استخراج الأبعاد والخصائص من ملف المدخلات
    domain = json_data.get("domain", {})
    try:
        Lx = float(domain["width_x"])
        Ly = float(domain["height_y"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Thermal domain requires numeric width_x and height_y") from exc
    
    mat = json_data.get("material_properties", {})
    try:
        k = float(mat["thermal_conductivity_k"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Thermal material requires thermal_conductivity_k in W/(m K)") from exc
    
    mesh = json_data.get("mesh_settings", {})
    dx = float(mesh.get("mesh_size", 0.1))
    dy = dx
    
    Nx = int(round(Lx / dx)) + 1
    Ny = int(round(Ly / dy)) + 1
    N_total = Nx * Ny
    
    # 2. استخراج الشروط الحدودية
    bcs = json_data.get("boundary_conditions", {})
    try:
        T_left = float(bcs["left_edge_x0"]["value"])
        T_right = float(bcs["right_edge_x1"]["value"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("Thermal boundary conditions require left_edge_x0 and right_edge_x1 values in degC") from exc
    h_conv = float(bcs.get("convection", {}).get("h_coefficient", 0.0))
    T_inf = float(bcs.get("convection", {}).get("T_ambient", 25.0))

    # Optional fixed-temperature top/bottom edges; without a value the edge stays insulated (or convective at the top).
    def optional_edge_temperature(name):
        edge = bcs.get(name)
        if not isinstance(edge, dict) or edge.get("value") is None:
            return None
        try:
            return float(edge["value"])
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Thermal boundary condition {name} must be a numeric temperature in degC") from exc

    T_bottom = optional_edge_temperature("bottom_edge_y0")
    T_top = optional_edge_temperature("top_edge_y1")
    
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
            # الحد السفلي (عزل حراري ما لم تُحدد درجة حرارة)
            elif j == 0:
                if T_bottom is not None:
                    K[idx, idx] = 1.0
                    F[idx] = T_bottom
                    continue
                K[idx, idx] = 1.0
                K[idx, get_node_index(i, 1)] = -1.0
                F[idx] = 0.0
            # الحد العلوي (عزل حراري ما لم تُحدد درجة حرارة)
            elif j == Ny - 1:
                if T_top is not None:
                    K[idx, idx] = 1.0
                    F[idx] = T_top
                    continue
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
    
    residual = float(np.max(np.abs(K_csr @ T_solution - F)))
    residual_scale = max(float(np.max(np.abs(F))), 1.0)
    relative_residual = residual / residual_scale
    return {
        "status": "SOLVED_REALTIME",
        "solver_type": "Deterministic 2D Finite Difference / FEA",
        "mesh_nodes": N_total,
        "mesh_elements": (Nx - 1) * (Ny - 1),
        "material_k": k,
        "center_temperature": round(center_temp, 2),
        "calculated_heat_flux": round(heat_flux, 2),
        "temperature_matrix": T_grid.tolist(),
        "units": {
            "temperature": "degC",
            "heat_flux": "W/m2",
            "thermal_conductivity": "W/(m K)",
        },
        "convergence": {
            "converged": relative_residual <= 1e-10,
            "status": "converged" if relative_residual <= 1e-10 else "not_converged",
            "relative_residual": relative_residual,
            "absolute_residual": residual,
        },
        "errors": [],
        "artifacts": {},
        "provenance": {"source": "api_input", "method": "direct sparse solve"},
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