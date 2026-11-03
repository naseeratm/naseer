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
        return solve_2d_thermal_transient(json_data)
        
    elif sim_type == "2D_structural_stress":
        # توجيه إلى محرك تحليل الإجهادات الميكانيكية (عند إضافته)
        return solve_2d_structural_stress(json_data)
        
    else:
        # المحرك الافتراضي في حال عدم التعرف على نوع المحاكاة
        return solve_2d_thermal_dynamic(json_data)