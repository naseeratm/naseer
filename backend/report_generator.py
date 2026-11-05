"""
Academic report generation for deterministic CAE solver results.

The generator intentionally depends only on the Python standard library so it
can be used by API workers, tests, and command-line export tools.
"""

from __future__ import annotations

from math import isfinite
from typing import Any, Mapping


def _nested_solver_data(output: Mapping[str, Any]) -> Mapping[str, Any]:
    """Return the solver payload while supporting nested dispatcher responses."""
    data = output.get("data")
    if isinstance(data, Mapping):
        nested = data.get("solver_results")
        if isinstance(nested, Mapping):
            return nested
        return data
    return output


def _optional_number(value: Any) -> float | None:
    try:
        number = float(value)
        return number if isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _format_optional_number(value: Any, decimals: int = 4) -> str:
    number = _optional_number(value)
    if number is None:
        return "not available"
    return f"{number:.{decimals}f}"


def _format_measurement(value: float | None, unit: str, decimals: int = 4) -> str:
    if value is None:
        return f"not available ({unit})"
    return f"{value:.{decimals}g} {unit}"


def _format_metric(value: Any, suffix: str = "", decimals: int = 4) -> str:
    formatted = _format_optional_number(value, decimals)
    return formatted if formatted == "not available" else formatted + suffix


def generate_academic_report(solver_output: Mapping[str, Any]) -> dict[str, Any]:
    """Generate an export-ready academic report object from solver output."""
    output = dict(solver_output)
    data = _nested_solver_data(output)
    input_data = data.get("input", {}) if isinstance(data.get("input"), Mapping) else {}
    boundary_conditions = (
        data.get("boundary_conditions", {})
        if isinstance(data.get("boundary_conditions"), Mapping)
        else input_data.get("boundary_conditions", {})
        if isinstance(input_data.get("boundary_conditions"), Mapping)
        else {}
    )
    material = (
        data.get("material", {})
        if isinstance(data.get("material"), Mapping)
        else input_data.get("material", {})
        if isinstance(input_data.get("material"), Mapping)
        else {}
    )

    conductivity = _optional_number(data.get("thermal_conductivity", data.get("thermal_conductivity_k", material.get("thermal_conductivity_k"))))
    convection = _optional_number(boundary_conditions.get("convection_coefficient", boundary_conditions.get("h")))
    length_x = _optional_number(data.get("length_x", data.get("Lx")))
    length_y = _optional_number(data.get("length_y", data.get("Ly")))
    left_temperature = _optional_number(boundary_conditions.get("left_temperature"))
    right_temperature = _optional_number(boundary_conditions.get("right_temperature"))
    r_squared = _optional_number(data.get("r_squared"))

    physics_type = str(output.get("physics_type", data.get("physics_type", "Steady 2D Thermal")))
    solver_engine = str(output.get("recommended_solver", data.get("solver_engine", "Sparse deterministic thermal solver")))

    convergence_rows = data.get("gci_meshes", data.get("mesh_convergence", []))
    if isinstance(convergence_rows, list) and convergence_rows:
        convergence_table = "\n".join(
            "| {mesh} | {cells} | {value} | {error} | {gci} |".format(
                mesh=row.get("mesh", f"L{index + 1}") if isinstance(row, Mapping) else f"L{index + 1}",
                cells=row.get("cells", row.get("elements", "-")) if isinstance(row, Mapping) else "-",
                value=_format_optional_number(row.get("key_result_value", row.get("value"))) if isinstance(row, Mapping) else "-",
                error=_format_metric(row.get("relative_error_percent", row.get("percentage_error")), "%", 3) if isinstance(row, Mapping) else "-",
                gci=_format_metric(row.get("gci_percent", row.get("gci")), "%", 3) if isinstance(row, Mapping) else "-",
            )
            for index, row in enumerate(convergence_rows[:3])
        )
    else:
        convergence_table = (
            "| L1 (Fine) | - | - | - | - |\n"
            "| L2 (Medium) | - | - | - | - |\n"
            "| L3 (Coarse) | - | - | - | - |"
        )

    sections = [
        {
            "title": "1. Boundary Conditions and Physical Parameters",
            "content": (
                "The steady two-dimensional thermal model uses a constant isotropic thermal conductivity "
                f"k = {_format_measurement(conductivity, 'W/(m.K)', 4)}. Convective transfer is represented by "
                f"h = {_format_measurement(convection, 'W/(m2.K)', 4)}. The rectangular domain spans "
                f"Lx = {_format_measurement(length_x, 'm', 4)} and Ly = {_format_measurement(length_y, 'm', 4)}.\n\n"
                f"Prescribed-temperature boundaries (Dirichlet, T = T_s) include the left wall at "
                f"{_format_measurement(left_temperature, 'deg C', 2)} and the right wall at "
                f"{_format_measurement(right_temperature, 'deg C', 2)}. "
                "Insulated boundaries (Neumann, -k grad(T) . n = 0) enforce zero normal conductive flux. "
                "Convective boundaries (Robin, -k grad(T) . n = h(T - T_inf)) couple conduction in the wall "
                "to the ambient fluid temperature. A heat-flux boundary is additionally modeled where required "
                "as Neumann q'' = q''_n; supplied values must be consistent with the outward normal."
            ),
        },
        {
            "title": "2. Governing PDE and Numerical Formulation",
            "content": (
                "For steady conduction without volumetric heat generation, Fourier's energy balance reduces to "
                "the two-dimensional heat equation div(k grad T) = 0. With constant k, this becomes "
                "k(T_xx + T_yy) = 0, equivalently laplacian(T) = 0. A finite-element discretization of the "
                "weak Galerkin statement produces the linear system [K]{T}={F}. Dirichlet rows are eliminated "
                "or imposed through the selected constrained formulation, while Neumann fluxes enter {F}; "
                "Robin terms add symmetric boundary contributions to both [K] and {F}. The sparse system is "
                "solved with direct or iterative sparse solvers, with residual convergence checked against the "
                "configured solver tolerance."
            ),
        },
        {
            "title": "3. Grid Convergence Study (Roache GCI)",
            "content": (
                "Three successively refined meshes are compared using the Grid Convergence Index procedure. "
                "For a refinement ratio r and observed order p, the approximate relative error is "
                "e_a = |phi_fine - phi_coarse| / |phi_fine| and the fine-grid extrapolated index is "
                "GCI_fine = F_s e_a / (r^p - 1), using a safety factor F_s = 1.25 when the ratio is asymptotic "
                "and 1.25-3.0 otherwise. The reported hierarchy is L1 finest, L2 intermediate, and L3 coarsest.\n\n"
                "| Mesh | Cells | Key result | Relative error | GCI |\n"
                "|---|---:|---:|---:|---:|\n" + convergence_table,
            ),
        },
        {
            "title": "4. Validation and Verification",
            "content": (
                "The numerical temperature field is compared pointwise with an analytical exact solution for "
                "the benchmark geometry and boundary conditions. Agreement is quantified by absolute and "
                "normalized errors, coefficient of determination R^2, and mesh-limit trends. "
                f"The current coefficient of determination is R^2 = {_format_optional_number(r_squared, 6)}. "
                "Assessment follows the principles of ASME V&V 20-2009, separating numerical error estimates "
                "from modeling uncertainty and reporting correction-method limitations, discretization "
                "uncertainties, solution verification, and validation against the applicable exact benchmark."
            ),
        },
        {
            "title": "5. Physical Contour Interpretation",
            "content": (
                "Fourier's law, q = -k grad(T), governs heat-flow direction. Temperature contours therefore "
                "run perpendicular to the heat-flux vector locally: heat moves across contours from high to "
                "low temperature, while closely spaced contours identify a larger temperature gradient and "
                "higher local conductive flux. The observed high-temperature region and gradient orientation "
                "are interpreted relative to prescribed walls, insulation, convection sinks, and material "
                "conductivity discontinuities."
            ),
        },
    ]

    markdown_parts = [
        "# Academic Technical Report: Steady-State Thermal Analysis",
        "",
        f"- **Physics classification:** {physics_type}",
        f"- **Solver engine:** {solver_engine}",
        f"- **Peak temperature:** {data.get('max_temperature', data.get('center_temperature', 'N/A'))}",
        "",
    ]
    for section in sections:
        section_content = section["content"]
        if isinstance(section_content, tuple):
            section_content = "".join(str(part) for part in section_content)
        markdown_parts.extend([
            "## " + section["title"],
            "",
            section_content,
            "",
        ])

    return {
        "format": "markdown",
        "title": "Academic Technical Report: Steady-State Thermal Analysis",
        "physics_type": physics_type,
        "solver_engine": solver_engine,
        "sections": sections,
        "markdown": "\n".join(markdown_parts),
    }
