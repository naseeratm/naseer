"""
NASEER Universal CAE Studio - Legacy 2D Python Solver Gate
All thermal, structural, fluid, and multiphysics solves must execute exclusively
through OpenFOAM, CalculiX (ccx), or ElmerFEM via universal_dispatcher.py in Docker.
Only Gmsh 2D meshing helper and Roache GCI utility remain available here.
"""

from backend.physics_solver import calculate_roache_gci  # noqa: F401


def solve_2d_thermal_dynamic(_json_data=None):
    raise RuntimeError(
        "Legacy 2D Python FD thermal solver is disabled under zero-mock policy. "
        "All thermal and conjugate heat transfer simulations must execute via OpenFOAM or CalculiX in universal_dispatcher."
    )


def solve_2d_structural_beam(_json_data=None):
    raise RuntimeError(
        "Legacy 2D Python structural solver is disabled under zero-mock policy. "
        "All structural simulations must execute via CalculiX (ccx) in universal_dispatcher."
    )


def solve_simulation(_json_data=None):
    raise RuntimeError(
        "Legacy standalone Python solver is disabled. "
        "Route all simulation tasks exclusively to OpenFOAM, CalculiX, or ElmerFEM via universal_dispatcher."
    )


def generate_unstructured_mesh_2d(width, height, mesh_size):
    try:
        import gmsh
    except ImportError as exc:
        raise RuntimeError("Gmsh Python package is unavailable in this runtime") from exc

    gmsh.initialize()
    gmsh.model.add("2D_Domain")

    p1 = gmsh.model.geo.addPoint(0, 0, 0, mesh_size)
    p2 = gmsh.model.geo.addPoint(width, 0, 0, mesh_size)
    p3 = gmsh.model.geo.addPoint(width, height, 0, mesh_size)
    p4 = gmsh.model.geo.addPoint(0, height, 0, mesh_size)

    l1 = gmsh.model.geo.addLine(p1, p2)
    l2 = gmsh.model.geo.addLine(p2, p3)
    l3 = gmsh.model.geo.addLine(p3, p4)
    l4 = gmsh.model.geo.addLine(p4, p1)

    cl = gmsh.model.geo.addCurveLoop([l1, l2, l3, l4])
    gmsh.model.geo.addPlaneSurface([cl])

    gmsh.model.geo.synchronize()
    gmsh.model.mesh.generate(2)

    node_tags, coords, _ = gmsh.model.mesh.getNodes()
    gmsh.finalize()

    return {"total_nodes": len(node_tags), "coordinates": coords.tolist()}