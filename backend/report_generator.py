"""
Dynamic Multi-Physics Academic Technical Report Generator (Zero-Mock).

Generates domain-accurate academic reports for deterministic CAE solver results
across CFD / Aerodynamics / Multiphase, Conjugate Heat Transfer (CHT),
Structural FEA (Static / Modal / Buckling / Thermo-Mechanical), Thermal,
and Electromagnetic / Acoustics domains.

Zero-Mock Contract:
- Never fabricates solver values, R^2 scores, GCI percentages, or physical parameters.
- Every missing numeric metric explicitly renders as "not available".
- Depends exclusively on the Python standard library.
"""

from __future__ import annotations

from math import isfinite
from typing import Any, Iterable, Mapping


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
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
        return number if isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _first_number(*values: Any) -> float | None:
    for val in values:
        num = _optional_number(val)
        if num is not None:
            return num
    return None


def _format_optional_number(value: Any, decimals: int = 4) -> str:
    number = _optional_number(value)
    if number is None:
        return "not available"
    return f"{number:.{decimals}f}"


def _format_measurement(value: Any, unit: str, decimals: int = 4) -> str:
    number = _optional_number(value)
    if number is None:
        return f"not available ({unit})"
    return f"{number:.{decimals}g} {unit}"


def _format_metric(value: Any, suffix: str = "", decimals: int = 4) -> str:
    formatted = _format_optional_number(value, decimals)
    return formatted if formatted == "not available" else formatted + suffix


def _format_text(value: Any) -> str:
    if value is None:
        return "not available"
    text = str(value).strip()
    return text if text else "not available"


def _format_number_list(values: Any, unit: str, limit: int = 5) -> str:
    if not isinstance(values, (list, tuple)) or not values:
        return "not available"
    parsed: list[str] = []
    for item in values[:limit]:
        if isinstance(item, Mapping):
            num = _first_number(
                item.get("frequency_hz"),
                item.get("frequency"),
                item.get("load_factor"),
                item.get("factor"),
                item.get("value"),
            )
        else:
            num = _optional_number(item)
        if num is not None:
            parsed.append(f"{num:.4g} {unit}".strip())
    return ", ".join(parsed) if parsed else "not available"


def _max_from_records(records: Any, keys: Iterable[str]) -> float | None:
    if not isinstance(records, list) or not records:
        return None
    best: float | None = None
    for row in records:
        if not isinstance(row, Mapping):
            continue
        for key in keys:
            num = _optional_number(row.get(key))
            if num is not None:
                best = num if best is None else max(best, num)
                break
    return best


def _extract_field_stat(fields: Mapping[str, Any], field_names: Iterable[str], stat: str) -> float | None:
    for name in field_names:
        entry = fields.get(name)
        if isinstance(entry, Mapping):
            val = _optional_number(entry.get(stat))
            if val is not None:
                return val
    return None


def _classify_report_domain(
    physics_type: str,
    solver_engine: str,
    data: Mapping[str, Any],
    integrals: Mapping[str, Any],
    fields: Mapping[str, Any],
) -> str:
    """Classify solver output into one of 5 canonical multi-physics reporting families."""
    pt = physics_type.lower()
    se = solver_engine.lower()

    # 1. Conjugate Heat Transfer (must precede generic CFD / Thermal)
    if any(tok in pt for tok in ("cht", "conjugate")) or "chtmultiregion" in se:
        return "cht"

    # 2. Electromagnetic & Acoustics
    if (
        any(tok in pt for tok in ("electromagnetic", "acoustic", "helmholtz", "maxwell", "magneto", "electrostatic"))
        or "elmer" in se
    ):
        return "electromagnetic"

    # 3. Structural FEA (including Thermo-Mechanical, Modal, Buckling)
    if any(tok in pt for tok in ("structural", "buckling", "modal", "dynamic", "fea", "elastic")):
        return "structural"

    # 4. CFD / Aerodynamics / Multiphase
    if (
        any(tok in pt for tok in ("cfd", "multiphase", "vof", "aero", "compressible", "incompressible", "fluid"))
        or any(tok in se for tok in ("simplefoam", "rhosimplefoam", "interfoam", "pimplefoam", "openfoam"))
    ):
        if any(tok in pt for tok in ("thermal", "buoyant")) and "cfd" not in pt and "vof" not in pt:
            return "thermal"
        return "cfd"

    # 5. Thermal
    if any(tok in pt for tok in ("thermal", "heat", "conduction", "radiation", "stefan")):
        return "thermal"

    # Fallback inference from actual result keys when physics_type is unspecified
    if any(k in data for k in ("stress", "displacements", "modal_frequencies_hz", "buckling_load_factors")) or any(
        k in integrals for k in ("max_von_mises_pa", "max_von_mises_mpa", "max_displacement_m")
    ):
        return "structural"
    if any(k in integrals for k in ("nusselt_number", "heat_transfer_coefficient_w_m2k")):
        return "cht"
    if any(k in integrals for k in ("pressure_drop_pa", "max_velocity_mps", "drag_coefficient_cd", "y_plus_mean")) or (
        "velocity" in fields and "pressure" in fields
    ):
        return "cfd"
    if any(k in fields for k in ("potential", "electric_field", "magnetic_flux", "acoustic_pressure")):
        return "electromagnetic"

    return "thermal"


def _build_convergence_table(data: Mapping[str, Any], output: Mapping[str, Any]) -> str:
    convergence_rows = (
        data.get("gci_meshes")
        or data.get("mesh_convergence")
        or output.get("gci_meshes")
        or output.get("levels")
        or []
    )
    if isinstance(convergence_rows, list) and convergence_rows:
        return "\n".join(
            "| {mesh} | {cells} | {value} | {error} | {gci} |".format(
                mesh=row.get("mesh", row.get("level", f"L{index + 1}")) if isinstance(row, Mapping) else f"L{index + 1}",
                cells=row.get("cells", row.get("elements", "-")) if isinstance(row, Mapping) else "-",
                value=_format_optional_number(
                    row.get("key_result_value", row.get("key_result", row.get("value")))
                ) if isinstance(row, Mapping) else "-",
                error=_format_metric(
                    row.get("relative_error_percent", row.get("percentage_error")), "%", 3
                ) if isinstance(row, Mapping) else "-",
                gci=_format_metric(row.get("gci_percent", row.get("gci")), "%", 3) if isinstance(row, Mapping) else "-",
            )
            for index, row in enumerate(convergence_rows[:3])
        )
    return (
        "| L1 (Fine) | not available | not available | not available | not available |\n"
        "| L2 (Medium) | not available | not available | not available | not available |\n"
        "| L3 (Coarse) | not available | not available | not available | not available |"
    )


def generate_academic_report(solver_output: Mapping[str, Any]) -> dict[str, Any]:
    """Generate a dynamic, zero-mock, domain-accurate academic report object from solver output."""
    output = dict(solver_output)
    data = _nested_solver_data(output)
    input_data = data.get("input", {}) if isinstance(data.get("input"), Mapping) else {}
    boundary_conditions = (
        data.get("boundary_conditions", {})
        if isinstance(data.get("boundary_conditions"), Mapping)
        else input_data.get("boundary_conditions", {})
        if isinstance(input_data.get("boundary_conditions"), Mapping)
        else output.get("boundary_conditions", {})
        if isinstance(output.get("boundary_conditions"), Mapping)
        else {}
    )
    material = (
        data.get("material", {})
        if isinstance(data.get("material"), Mapping)
        else input_data.get("material", {})
        if isinstance(input_data.get("material"), Mapping)
        else output.get("material", {})
        if isinstance(output.get("material"), Mapping)
        else {}
    )
    integrals = data.get("integrals", {}) if isinstance(data.get("integrals"), Mapping) else {}
    fields = data.get("fields", {}) if isinstance(data.get("fields"), Mapping) else {}

    raw_physics = output.get("physics_type", data.get("physics_type"))
    physics_type = str(raw_physics).strip() if raw_physics else "Thermal_Steady"

    raw_solver = (
        output.get("recommended_solver")
        or output.get("solver")
        or data.get("solver_engine")
        or data.get("solver")
    )
    solver_engine = str(raw_solver).strip() if raw_solver else "not available"

    domain = _classify_report_domain(physics_type, solver_engine, data, integrals, fields)
    pt_lower = physics_type.lower()

    r_squared = _first_number(data.get("r_squared"), output.get("r_squared"))
    gci_fine = _first_number(
        data.get("gci_fine_percent"),
        output.get("gci_fine_percent"),
        integrals.get("gci_fine_percent"),
    )
    convergence_table = _build_convergence_table(data, output)

    # Shared geometry parameters
    length_x = _first_number(data.get("length_x"), data.get("Lx"), input_data.get("width_x"), output.get("width_x"))
    length_y = _first_number(data.get("length_y"), data.get("Ly"), input_data.get("height_y"), output.get("height_y"))

    if domain == "cfd":
        is_multiphase = "multiphase" in pt_lower or "vof" in pt_lower
        is_compressible = "compressible" in pt_lower and "incompressible" not in pt_lower
        report_title = (
            "Academic Technical Report: Multiphase VOF Fluid Dynamics Analysis"
            if is_multiphase
            else "Academic Technical Report: Compressible Aerodynamics (CFD) Analysis"
            if is_compressible
            else "Academic Technical Report: Computational Fluid Dynamics (CFD) Analysis"
        )

        turbulence_model = _format_text(
            data.get("turbulence_model")
            or input_data.get("turbulence_model")
            or output.get("turbulence_model")
            or boundary_conditions.get("turbulence_model")
        )
        inlet_velocity = _first_number(
            boundary_conditions.get("inlet_velocity_mps"),
            boundary_conditions.get("inlet_velocity"),
            input_data.get("velocity"),
            data.get("inlet_velocity"),
            output.get("velocity"),
        )
        density = _first_number(material.get("density"), material.get("density_kg_m3"), data.get("density"))
        viscosity = _first_number(
            material.get("kinematic_viscosity"),
            material.get("viscosity"),
            data.get("kinematic_viscosity"),
        )
        pressure_drop = _first_number(
            integrals.get("pressure_drop_pa"),
            data.get("pressure_drop_pa"),
            data.get("pressure_drop"),
        )
        max_velocity = _first_number(
            integrals.get("max_velocity_mps"),
            data.get("max_velocity_mps"),
            data.get("max_velocity"),
            _extract_field_stat(fields, ("velocity", "U"), "max"),
        )
        y_plus = _first_number(
            integrals.get("y_plus_mean"),
            integrals.get("y_plus_max"),
            data.get("y_plus_mean"),
            data.get("y_plus"),
        )
        wall_shear = _first_number(
            integrals.get("wall_shear_stress_pa"),
            integrals.get("max_wall_shear_stress_pa"),
            data.get("wall_shear_stress_pa"),
        )
        drag_cd = _first_number(integrals.get("drag_coefficient_cd"), data.get("drag_coefficient"), data.get("cd"))
        lift_cl = _first_number(integrals.get("lift_coefficient_cl"), data.get("lift_coefficient"), data.get("cl"))

        key_summary_line = (
            f"- **Peak velocity:** {_format_measurement(max_velocity, 'm/s', 4)}\n"
            f"- **Pressure drop:** {_format_measurement(pressure_drop, 'Pa', 4)}\n"
            f"- **Wall y+:** {_format_optional_number(y_plus, 3)}"
        )

        sec1 = (
            f"The fluid-flow model is configured for **{physics_type}** using turbulence closure "
            f"`{turbulence_model}` with fluid density rho = {_format_measurement(density, 'kg/m^3', 4)} "
            f"and viscosity nu/mu = {_format_measurement(viscosity, 'SI', 4)}. "
            f"Domain extents are Lx = {_format_measurement(length_x, 'm', 4)} and Ly = {_format_measurement(length_y, 'm', 4)}.\n\n"
            f"Boundary conditions specify inlet velocity U_in = {_format_measurement(inlet_velocity, 'm/s', 4)} "
            "with no-slip impermeable walls (u = 0) and zero-gradient / fixed-static-pressure outlet. "
            f"Extracted integral responses report pressure drop Delta_p = {_format_measurement(pressure_drop, 'Pa', 4)}, "
            f"peak velocity |U|_max = {_format_measurement(max_velocity, 'm/s', 4)}, "
            f"wall y+ = {_format_optional_number(y_plus, 3)}, "
            f"wall shear stress tau_w = {_format_measurement(wall_shear, 'Pa', 4)}, "
            f"drag coefficient C_d = {_format_optional_number(drag_cd, 4)}, and "
            f"lift coefficient C_l = {_format_optional_number(lift_cl, 4)}."
        )

        extra_eq = (
            " Free-surface phase transport is additionally governed by the Volume-of-Fluid (VOF) advection equation "
            "d(alpha)/dt + div(alpha * u) = 0 with MULES bounded compression."
            if is_multiphase
            else " Compressible thermodynamic closure couples energy conservation and the ideal-gas equation of state p = rho R T."
            if is_compressible
            else " For constant-density incompressible flow, continuity reduces to div(u) = 0."
        )
        sec2 = (
            "Fluid motion is governed by the Reynolds-Averaged Navier-Stokes (RANS) conservation equations for mass "
            "div(rho u) = 0 and linear momentum div(rho u (x) u) = -grad(p) + div(tau + tau_t) + rho g, where "
            "tau is the viscous stress tensor and tau_t represents the turbulent Reynolds stress closure."
            + extra_eq
            + " Spatial discretization uses the Finite Volume Method (FVM) on the generated polyhedral/hexahedral mesh "
            "with pressure-velocity coupling (SIMPLE / PIMPLE) and linear-system convergence monitored across pressure, "
            "momentum, and turbulence residuals."
        )

        sec4_subject = "velocity, pressure, and force-coefficient fields"
        sec5 = (
            "Velocity magnitude and static-pressure contours reveal momentum acceleration, boundary-layer growth, "
            "and adverse pressure-gradient separation zones. Regions of steep pressure drop correspond to high "
            "viscous dissipation or geometric constriction, while wall shear stress and y+ distributions verify "
            "near-wall boundary-layer resolution and aerodynamic loading consistency."
        )

    elif domain == "cht":
        report_title = "Academic Technical Report: Conjugate Heat Transfer (CHT) Analysis"

        inlet_velocity = _first_number(
            boundary_conditions.get("inlet_velocity_mps"),
            input_data.get("velocity"),
            output.get("velocity"),
        )
        pressure_drop = _first_number(
            integrals.get("pressure_drop_pa"),
            data.get("pressure_drop_pa"),
            data.get("pressure_drop"),
        )
        nusselt = _first_number(integrals.get("nusselt_number"), data.get("nusselt_number"), data.get("Nu"))
        htc = _first_number(
            integrals.get("heat_transfer_coefficient_w_m2k"),
            boundary_conditions.get("convection_coefficient"),
            data.get("heat_transfer_coefficient"),
        )
        conductivity = _first_number(
            data.get("thermal_conductivity"),
            data.get("thermal_conductivity_k"),
            material.get("thermal_conductivity_k"),
        )
        max_temp = _first_number(
            integrals.get("max_temperature_k"),
            data.get("max_temperature"),
            _extract_field_stat(fields, ("temperature", "T"), "max"),
        )
        min_temp = _first_number(
            integrals.get("min_temperature_k"),
            data.get("min_temperature"),
            _extract_field_stat(fields, ("temperature", "T"), "min"),
        )

        key_summary_line = (
            f"- **Nusselt number (Nu):** {_format_optional_number(nusselt, 3)}\n"
            f"- **Heat transfer coefficient (h):** {_format_measurement(htc, 'W/(m^2.K)', 4)}\n"
            f"- **Pressure drop:** {_format_measurement(pressure_drop, 'Pa', 4)}\n"
            f"- **Temperature bounds:** {_format_measurement(min_temp, 'K', 4)} to {_format_measurement(max_temp, 'K', 4)}"
        )

        sec1 = (
            f"The coupled conjugate heat transfer model specifies fluid inlet velocity U_in = "
            f"{_format_measurement(inlet_velocity, 'm/s', 4)}, thermal conductivity k = "
            f"{_format_measurement(conductivity, 'W/(m.K)', 4)}, and domain dimensions "
            f"Lx = {_format_measurement(length_x, 'm', 4)}, Ly = {_format_measurement(length_y, 'm', 4)}.\n\n"
            f"Solved thermal-hydraulic outputs yield Nusselt number Nu = {_format_optional_number(nusselt, 3)}, "
            f"convective heat transfer coefficient h = {_format_measurement(htc, 'W/(m^2.K)', 4)}, "
            f"hydraulic pressure drop Delta_p = {_format_measurement(pressure_drop, 'Pa', 4)}, "
            f"and temperature span T_min = {_format_measurement(min_temp, 'K', 4)} to "
            f"T_max = {_format_measurement(max_temp, 'K', 4)}."
        )

        sec2 = (
            "Conjugate heat transfer simultaneously solves the fluid Navier-Stokes mass and momentum conservation "
            "equations div(rho u) = 0 and div(rho u (x) u) = -grad(p) + div(tau) coupled with fluid energy transport "
            "rho c_p (u . grad(T)) = div(k_f grad(T)) and solid conduction div(k_s grad(T)) = 0. "
            "Across the fluid-solid interface, temperature continuity (T_f = T_s) and normal heat-flux conservation "
            "(-k_f grad(T_f) . n = -k_s grad(T_s) . n) are enforced iteratively inside the coupled FVM solver."
        )

        sec4_subject = "coupled temperature, Nusselt number, and pressure-drop fields"
        sec5 = (
            "Coupled temperature and velocity contours illustrate thermal boundary-layer development along heated "
            "walls and convective mixing across the channel. Closely spaced wall isotherms indicate elevated local "
            "heat transfer (higher Nu and h), which must be balanced against friction-induced pressure drop."
        )

    elif domain == "structural":
        is_modal = "dynamic" in pt_lower or "modal" in pt_lower
        is_buckling = "buckling" in pt_lower
        is_thermo = "thermal" in pt_lower
        report_title = (
            "Academic Technical Report: Structural Modal & Dynamic FEA"
            if is_modal
            else "Academic Technical Report: Linear Elastic Buckling FEA"
            if is_buckling
            else "Academic Technical Report: Coupled Thermo-Structural FEA"
            if is_thermo
            else "Academic Technical Report: Structural Static Finite Element Analysis (FEA)"
        )

        youngs_modulus = _first_number(
            material.get("youngs_modulus"),
            material.get("elastic_modulus_pa"),
            material.get("elastic_modulus_gpa"),
            data.get("youngs_modulus"),
            input_data.get("youngs_modulus"),
        )
        poisson = _first_number(
            material.get("poisson_ratio"),
            material.get("nu"),
            data.get("poisson_ratio"),
            input_data.get("poisson_ratio"),
        )
        density = _first_number(material.get("density"), material.get("density_kg_m3"), data.get("density"))
        peak_von_mises = _first_number(
            integrals.get("max_von_mises_pa"),
            integrals.get("max_von_mises_mpa"),
            data.get("max_von_mises"),
            data.get("max_stress"),
            _max_from_records(data.get("stress"), ("von_mises", "von_mises_pa", "stress")),
            _extract_field_stat(fields, ("von_mises", "stress"), "max"),
        )
        peak_disp = _first_number(
            integrals.get("max_displacement_m"),
            integrals.get("max_displacement_mm"),
            data.get("max_displacement"),
            _max_from_records(data.get("displacements"), ("magnitude", "disp_mag")),
            _extract_field_stat(fields, ("displacement", "displacements"), "max"),
        )
        modal_freqs = _format_number_list(
            data.get("modal_frequencies_hz") or integrals.get("modal_frequencies_hz"),
            "Hz",
        )
        buckling_factors = _format_number_list(
            data.get("buckling_load_factors") or integrals.get("buckling_load_factors"),
            "",
        )

        key_summary_line = (
            f"- **Peak von Mises stress:** {_format_measurement(peak_von_mises, 'Pa', 4)}\n"
            f"- **Peak displacement:** {_format_measurement(peak_disp, 'm', 4)}\n"
            + (f"- **Modal frequencies:** {modal_freqs}\n" if modal_freqs != "not available" else "")
            + (f"- **Buckling load factors:** {buckling_factors}\n" if buckling_factors != "not available" else "")
        ).rstrip("\n")

        extra_struct_metrics = ""
        if modal_freqs != "not available":
            extra_struct_metrics += f" Extracted natural frequencies: {modal_freqs}."
        if buckling_factors != "not available":
            extra_struct_metrics += f" Extracted critical buckling load factors: {buckling_factors}."

        sec1 = (
            f"The structural finite-element model ({physics_type}) uses isotropic elastic properties "
            f"E = {_format_optional_number(youngs_modulus, 4)}, Poisson's ratio nu = {_format_optional_number(poisson, 4)}, "
            f"and mass density rho = {_format_measurement(density, 'kg/m^3', 4)}. "
            f"Domain extents are Lx = {_format_measurement(length_x, 'm', 4)} and Ly = {_format_measurement(length_y, 'm', 4)}.\n\n"
            f"Essential displacement restraints constrain rigid-body motion while external tractions/forces act on the "
            f"loaded boundaries. Computed structural peak responses report maximum von Mises equivalent stress "
            f"sigma_vM,max = {_format_measurement(peak_von_mises, 'Pa', 4)} and maximum displacement magnitude "
            f"|u|_max = {_format_measurement(peak_disp, 'm', 4)}."
            + extra_struct_metrics
        )

        extra_pde = (
            " Undamped free-vibration modes are extracted from the generalized eigenvalue problem ([K] - omega^2 [M]){phi} = {0}."
            if is_modal
            else " Critical elastic instability modes are obtained from the linear buckling eigenproblem ([K] + lambda [K_g]){phi} = {0}."
            if is_buckling
            else " Thermal expansion enters through additive eigenstrain eps_th = alpha (T - T_ref) I."
            if is_thermo
            else ""
        )
        sec2 = (
            "Static continuum equilibrium is governed by Cauchy's equation div(sigma) + b = 0, paired with "
            "small-strain kinematics eps = 1/2 (grad(u) + grad(u)^T) and linear isotropic Hooke's law "
            "sigma = C : eps. Applying the Principle of Virtual Work over the finite-element discretization "
            "assembles the global stiffness system [K]{u} = {F}, solved via sparse direct factorization "
            "(SPOOLES / Pardiso) or iterative Krylov solvers."
            + extra_pde
        )

        sec4_subject = "displacement, von Mises stress, and eigenvalue responses"
        sec5 = (
            "Equivalent von Mises stress contours identify load-transfer paths and localized stress concentrations "
            "near fixed supports, fillets, and load application surfaces. Comparing peak von Mises stress against "
            "material yield strength and inspecting deformed displacement profiles assesses structural safety margins "
            "and stiffness compliance."
        )

    elif domain == "electromagnetic":
        is_acoustics = "acoustic" in pt_lower or "helmholtz" in pt_lower
        report_title = (
            "Academic Technical Report: Computational Acoustics (Helmholtz FEM) Analysis"
            if is_acoustics
            else "Academic Technical Report: Electromagnetic Field (ElmerFEM) Analysis"
        )

        peak_field = _first_number(
            integrals.get("max_field_magnitude"),
            integrals.get("max_potential_v"),
            integrals.get("max_electric_field"),
            integrals.get("max_acoustic_pressure_pa"),
            data.get("max_field"),
            data.get("peak_field"),
            _extract_field_stat(fields, ("potential", "electric_field", "magnetic_flux", "acoustic_pressure", "field"), "max"),
        )
        mean_field = _first_number(
            integrals.get("mean_field_magnitude"),
            integrals.get("mean_potential_v"),
            data.get("mean_field"),
            _extract_field_stat(fields, ("potential", "electric_field", "magnetic_flux", "acoustic_pressure", "field"), "mean"),
        )
        frequency_hz = _first_number(
            boundary_conditions.get("frequency_hz"),
            input_data.get("frequency_hz"),
            data.get("frequency_hz"),
            output.get("frequency_hz"),
        )

        key_summary_line = (
            f"- **Peak field value:** {_format_optional_number(peak_field, 4)}\n"
            f"- **Mean field value:** {_format_optional_number(mean_field, 4)}\n"
            f"- **Excitation frequency:** {_format_measurement(frequency_hz, 'Hz', 4)}"
        )

        sec1 = (
            f"The {physics_type} finite-element model executed via `{solver_engine}` spans "
            f"Lx = {_format_measurement(length_x, 'm', 4)} and Ly = {_format_measurement(length_y, 'm', 4)} "
            f"with excitation frequency f = {_format_measurement(frequency_hz, 'Hz', 4)}.\n\n"
            f"Field post-processing from the solver reports peak field magnitude = {_format_optional_number(peak_field, 4)} "
            f"and domain-average field magnitude = {_format_optional_number(mean_field, 4)}. "
            "Dirichlet potential/pressure and Neumann flux/impedance boundary conditions are imposed directly on the "
            "exported Gmsh boundary group IDs."
        )

        sec2 = (
            "Time-harmonic acoustic pressure propagation is governed by the Helmholtz wave equation "
            "laplacian(p) + k^2 p = 0 (with wavenumber k = 2 pi f / c), discretized via Galerkin finite elements "
            "in ElmerFEM with absorbing/impedance boundary conditions."
            if is_acoustics
            else "Low-frequency electromagnetic fields are governed by Maxwell's equations, reducing in electrostatic "
            "form to Gauss's Poisson equation div(eps grad(phi)) = -rho_e (with E = -grad(phi)) and in magnetostatic "
            "form to the curl-curl vector potential equation curl(mu^-1 curl(A)) = J. Galerkin finite-element "
            "discretization in ElmerFEM produces the sparse linear algebraic system solved to the configured tolerance."
        )

        sec4_subject = "computed potential, field-intensity, and acoustic pressure distributions"
        sec5 = (
            "Equipotential and field-intensity contours identify regions of strong field gradients, dielectric "
            "stress, magnetic flux concentration, or acoustic standing-wave nodes and antinodes relative to the "
            "prescribed electrodes, coils, or impedance boundaries."
        )

    else:
        # Thermal (Steady, Transient, Radiation)
        is_transient = "transient" in pt_lower
        is_radiation = "radiation" in pt_lower
        report_title = (
            "Academic Technical Report: Transient Thermal Heat Transfer Analysis"
            if is_transient
            else "Academic Technical Report: Radiative & Conductive Thermal Analysis"
            if is_radiation
            else "Academic Technical Report: Steady-State Thermal Analysis"
        )

        conductivity = _first_number(
            data.get("thermal_conductivity"),
            data.get("thermal_conductivity_k"),
            material.get("thermal_conductivity_k"),
            material.get("thermal_conductivity"),
        )
        convection = _first_number(
            boundary_conditions.get("convection_coefficient"),
            boundary_conditions.get("h"),
            data.get("convection_coefficient"),
        )
        left_temperature = _first_number(boundary_conditions.get("left_temperature"))
        right_temperature = _first_number(boundary_conditions.get("right_temperature"))
        peak_temp = _first_number(
            data.get("max_temperature"),
            data.get("center_temperature"),
            integrals.get("max_temperature_k"),
            _extract_field_stat(fields, ("temperature", "T"), "max"),
        )

        key_summary_line = f"- **Peak / center temperature:** {_format_optional_number(peak_temp, 4)}"

        sec1 = (
            f"The thermal model ({physics_type}) uses isotropic thermal conductivity "
            f"k = {_format_measurement(conductivity, 'W/(m.K)', 4)} and convective heat transfer coefficient "
            f"h = {_format_measurement(convection, 'W/(m2.K)', 4)}. The domain spans "
            f"Lx = {_format_measurement(length_x, 'm', 4)} and Ly = {_format_measurement(length_y, 'm', 4)}.\n\n"
            f"Prescribed-temperature boundaries (Dirichlet, T = T_s) include the left wall at "
            f"{_format_measurement(left_temperature, 'deg C', 2)} and the right wall at "
            f"{_format_measurement(right_temperature, 'deg C', 2)}. "
            f"Solved peak/center temperature is {_format_optional_number(peak_temp, 4)}. "
            "Insulated boundaries (Neumann, -k grad(T) . n = 0) enforce zero normal conductive flux, while "
            "convective (Robin, -k grad(T) . n = h(T - T_inf)) and radiative boundaries couple surface heat exchange."
        )

        if is_transient:
            sec2 = (
                "Transient heat conduction is governed by the parabolic energy equation "
                "rho c_p (dT/dt) = div(k grad(T)) + q''', discretized spatially via finite elements ([C]{dT/dt} + [K]{T} = {F}) "
                "and marched in time with implicit integration to maintain unconditional stability."
            )
        elif is_radiation:
            sec2 = (
                "Conductive-radiative heat transfer solves div(k grad(T)) = 0 coupled with nonlinear Stefan-Boltzmann "
                "surface radiation q''_rad = eps sigma_SB (T^4 - T_inf^4) via Newton-Raphson iterations on the "
                "assembled finite-element system [K(T)]{T} = {F(T)}."
            )
        else:
            sec2 = (
                "For steady conduction without volumetric heat generation, Fourier's energy balance reduces to "
                "the elliptic heat equation div(k grad T) = 0. With constant k, this becomes "
                "laplacian(T) = 0. A finite-element discretization of the weak Galerkin statement produces the "
                "linear system [K]{T} = {F}. Dirichlet rows are imposed via constrained elimination, Neumann fluxes "
                "enter {F}, and Robin terms add symmetric contributions to both [K] and {F}."
            )

        sec4_subject = "numerical temperature field"
        sec5 = (
            "Fourier's law, q = -k grad(T), governs heat-flow direction. Temperature contours run perpendicular "
            "to the local heat-flux vector: heat moves across contours from high to low temperature, while closely "
            "spaced isotherms identify steep temperature gradients and elevated local conductive flux."
        )

    sec3 = (
        "Three successively refined meshes are compared using the Grid Convergence Index (Roache / Celik) procedure. "
        "For refinement ratio r and observed order p, the approximate relative error is "
        "e_a = |phi_fine - phi_coarse| / |phi_fine| and the fine-grid index is "
        "GCI_fine = F_s e_a / (r^p - 1) (F_s = 1.25 for three-grid asymptotic studies). "
        f"Reported fine-grid GCI = {_format_metric(gci_fine, '%', 3)}.\n\n"
        "| Mesh | Cells | Key result | Relative error | GCI |\n"
        "|---|---:|---:|---:|---:|\n"
        + convergence_table
    )

    sec4 = (
        f"The {sec4_subject} is verified against analytical or international benchmark solutions (ASME V&V 20, "
        "NAFEMS, NASA TMR) where available. Agreement is quantified by absolute and normalized errors, "
        f"coefficient of determination R^2 = {_format_optional_number(r_squared, 6)}, and mesh-refinement trends. "
        "Under strict Zero-Mock policy, any uncomputed verification metric is reported explicitly as `not available` "
        "rather than estimated or synthesized."
    )

    sections = [
        {"title": "1. Boundary Conditions and Physical Parameters", "content": sec1},
        {"title": "2. Governing PDE and Numerical Formulation", "content": sec2},
        {"title": "3. Grid Convergence Study (Roache GCI)", "content": sec3},
        {"title": "4. Validation and Verification (ASME V&V 20)", "content": sec4},
        {"title": "5. Physical Contour Interpretation", "content": sec5},
    ]

    markdown_parts = [
        f"# {report_title}",
        "",
        f"- **Physics classification:** {physics_type}",
        f"- **Reporting domain:** {domain.upper()}",
        f"- **Solver engine:** {solver_engine}",
        key_summary_line,
        "",
    ]
    for section in sections:
        markdown_parts.extend([
            "## " + section["title"],
            "",
            str(section["content"]),
            "",
        ])

    return {
        "format": "markdown",
        "title": report_title,
        "physics_type": physics_type,
        "domain": domain,
        "solver_engine": solver_engine,
        "sections": sections,
        "markdown": "\n".join(markdown_parts),
    }
