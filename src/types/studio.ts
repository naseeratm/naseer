export type WorkflowStep =
  | 'geometry'
  | 'mesh'
  | 'physics'
  | 'boundaries'
  | 'contacts'
  | 'solution'
  | 'post';

export type JobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type SimulationTypeOption =
  | 'CFD_Incompressible'
  | 'CFD_Compressible'
  | 'CHT_Coupled'
  | 'CHT_MultiRegion'
  | 'FSI_2Way'
  | 'Multiphase_VOF'
  | 'Structural_Static'
  | 'Structural_Dynamic'
  | 'Structural_Buckling'
  | 'Thermal_Steady'
  | 'Thermal_Transient'
  | 'Thermal_Radiation'
  | 'Thermal_Structural'
  | 'Electromagnetic'
  | 'Acoustics';

export type SimulationType = SimulationTypeOption;

export type ExecutionModeOption = 'celery' | 'direct';

export type TemperatureUnit = 'K' | 'C' | 'F';

export type ConsoleTab = 'logs' | 'convergence' | 'errors';

export const CFD_BOUNDARY_SUBTYPES = [
  'Velocity Inlet',
  'Mass Flow Inlet',
  'Pressure Inlet',
  'Pressure Outlet',
  'No-slip Wall',
  'Slip Wall',
  'Moving Wall',
  'Symmetry',
] as const;

export const FEA_BOUNDARY_SUBTYPES = [
  'Fixed Support',
  'Pinned Support',
  'Displacement',
  'Force Load',
  'Pressure Load',
  'Frictionless Support',
] as const;

export const THERMAL_BOUNDARY_SUBTYPES = [
  'Fixed Temperature',
  'Heat Flux Wall',
  'Convection Surface',
  'Radiation Surface',
  'Adiabatic Wall',
] as const;

export interface SimulationInputs {
  simulationType: SimulationTypeOption;
  executionMode: ExecutionModeOption;
  parallelCores: string;
  // Common domain & Gmsh controls
  meshSize: string;
  elementOrder: '1' | '2';
  inflationLayers: string;
  firstLayerHeight: string;
  growthRate: string;
  widthX: string;
  heightY: string;
  depthZ: string;
  // External Aerodynamics (OpenFOAM snappyHexMesh)
  externalAero: boolean;
  aeroSurfaceLevel: string;
  aeroWakeLevel: string;
  tunnelUpstreamMult: string;
  tunnelDownstreamMult: string;
  // CFD, CHT, VOF & Fluid Properties
  velocity: string;
  turbulenceModel: string;
  fluidDensity: string;
  dynamicViscosity: string;
  temperature: string;
  temperatureUnit: TemperatureUnit;
  pressure: string;
  // Rotating Zones (OpenFOAM MRFProperties + topoSet)
  mrfEnabled: boolean;
  mrfOmegaRpm: string;
  mrfRadius: string;
  mrfAxis: 'x' | 'y' | 'z';
  // Time Stepping, Gravity & Solution Controls (Ansys / SimScale parity)
  timeMode: 'steady' | 'transient';
  timeStep: string;
  endTime: string;
  adaptiveTimeStepping: boolean;
  maxCo: string;
  maxDeltaT: string;
  // Multiphysics Coupling (preCICE 2-Way FSI & Multi-Region CHT)
  couplingScheme: 'parallel-implicit' | 'serial-implicit';
  couplingMaxIterations: string;
  couplingRelTol: string;
  solidThickness: string;
  solidConductivity: string;
  gravityEnabled: boolean;
  gravityY: string;
  solverIterations: string;
  residualTarget: string;
  discretizationScheme: 'first_order' | 'second_order';
  relaxationP: string;
  relaxationU: string;
  relaxationT: string;
  // Structural, Nonlinear Material, Modal, Buckling & Multi-Body Contact (CalculiX)
  supportType: 'cantilever' | 'simply_supported' | 'fixed_both';
  displacement: string;
  pressureLoadMpa: string;
  forceN: string;
  youngModulus: string;
  poissonRatio: string;
  density: string;
  thermalExpansion: string;
  nonlinear: boolean;
  materialModel: 'linear_elastic' | 'plastic' | 'hyperelastic';
  yieldStressMpa: string;
  tangentModulusMpa: string;
  hyperC10Mpa: string;
  hyperD1: string;
  modesCount: string;
  contactType: 'Bonded' | 'Sliding' | 'Tie' | 'Frictional' | 'Contact_Frictionless';
  frictionCoeff: string;
  // Thermal, Radiation & Coupled Thermal
  thermalConductivity: string;
  specificHeat: string;
  heatFlux: string;
  convectionH: string;
  emissivity: string;
  ambientTempC: string;
  bcLeft: string;
  bcRight: string;
  bcTop: string;
  bcBottom: string;
  // Electromagnetics & Acoustics (ElmerFEM)
  emSubmode: 'Electrostatic' | 'Magnetostatic' | 'EddyCurrent' | 'Acoustics';
  electricalConductivity: string;
  relativePermeability: string;
  relativePermittivity: string;
  currentDensity: string;
}

export interface ConsoleIssue {
  id: number;
  time: string;
  severity: 'error' | 'warning';
  message: string;
}

// All physical numeric fields start blank; zero fabricated/mock defaults are supplied.
export const DEFAULT_SIMULATION_INPUTS: SimulationInputs = {
  simulationType: 'CFD_Incompressible',
  executionMode: 'celery',
  parallelCores: '1',
  meshSize: '',
  elementOrder: '1',
  inflationLayers: '',
  firstLayerHeight: '',
  growthRate: '',
  widthX: '',
  heightY: '',
  depthZ: '',
  externalAero: false,
  aeroSurfaceLevel: '2',
  aeroWakeLevel: '1',
  tunnelUpstreamMult: '3',
  tunnelDownstreamMult: '6',
  velocity: '',
  turbulenceModel: 'laminar',
  fluidDensity: '',
  dynamicViscosity: '',
  temperature: '',
  temperatureUnit: 'K',
  pressure: '',
  mrfEnabled: false,
  mrfOmegaRpm: '',
  mrfRadius: '',
  mrfAxis: 'z',
  timeMode: 'steady',
  timeStep: '',
  endTime: '',
  adaptiveTimeStepping: false,
  maxCo: '',
  maxDeltaT: '',
  couplingScheme: 'parallel-implicit',
  couplingMaxIterations: '',
  couplingRelTol: '',
  solidThickness: '',
  solidConductivity: '',
  gravityEnabled: false,
  gravityY: '-9.81',
  solverIterations: '',
  residualTarget: '',
  discretizationScheme: 'second_order',
  relaxationP: '',
  relaxationU: '',
  relaxationT: '',
  supportType: 'cantilever',
  displacement: '',
  pressureLoadMpa: '',
  forceN: '',
  youngModulus: '',
  poissonRatio: '',
  density: '',
  thermalExpansion: '',
  nonlinear: false,
  materialModel: 'linear_elastic',
  yieldStressMpa: '',
  tangentModulusMpa: '',
  hyperC10Mpa: '',
  hyperD1: '',
  modesCount: '',
  contactType: 'Bonded',
  frictionCoeff: '',
  thermalConductivity: '',
  specificHeat: '',
  heatFlux: '',
  convectionH: '',
  emissivity: '',
  ambientTempC: '',
  bcLeft: '',
  bcRight: '',
  bcTop: '',
  bcBottom: '',
  emSubmode: 'Electrostatic',
  electricalConductivity: '',
  relativePermeability: '',
  relativePermittivity: '',
  currentDensity: '',
};

export const SIMULATION_TYPE_OPTIONS: { value: SimulationTypeOption; label: string }[] = [
  { value: 'CFD_Incompressible', label: 'CFD · Incompressible (OpenFOAM simpleFoam / pimpleFoam)' },
  { value: 'CFD_Compressible', label: 'CFD · Compressible (OpenFOAM rhoSimpleFoam)' },
  { value: 'CHT_Coupled', label: 'CHT · Conjugate Heat Transfer (OpenFOAM buoyantSimpleFoam)' },
  { value: 'CHT_MultiRegion', label: 'CHT · Multi-Region Fluid+Solid (OpenFOAM chtMultiRegionSimpleFoam)' },
  { value: 'FSI_2Way', label: 'FSI · 2-Way Coupled Fluid-Structure (preCICE OpenFOAM + CalculiX)' },
  { value: 'Multiphase_VOF', label: 'Multiphase · Volume of Fluid (OpenFOAM interFoam)' },
  { value: 'Structural_Static', label: 'Structural · Static FEA (CalculiX ccx)' },
  { value: 'Structural_Dynamic', label: 'Structural · Modal / Frequency (CalculiX ccx)' },
  { value: 'Structural_Buckling', label: 'Structural · Linear Buckling (CalculiX ccx)' },
  { value: 'Thermal_Steady', label: 'Thermal · Steady Conduction/Convection (CalculiX)' },
  { value: 'Thermal_Transient', label: 'Thermal · Transient Heat Transfer (CalculiX)' },
  { value: 'Thermal_Radiation', label: 'Thermal · Radiation & Conduction (CalculiX)' },
  { value: 'Thermal_Structural', label: 'Coupled · Thermo-Mechanical Stress (CalculiX C3D8T)' },
  { value: 'Electromagnetic', label: 'Electromagnetic · Electrostatics / Magnetics (ElmerFEM)' },
  { value: 'Acoustics', label: 'Acoustics · Helmholtz Wave (ElmerFEM)' },
];

export function defaultSimulationTypeForField(field?: string): SimulationTypeOption {
  const f = (field || '').toLowerCase();
  if (f === 'cfd' || f === 'supersonic') return f === 'supersonic' ? 'CFD_Compressible' : 'CFD_Incompressible';
  if (f === 'fea') return 'Structural_Static';
  if (f === 'fsi') return 'FSI_2Way';
  if (f === 'multiphysics') return 'CHT_MultiRegion';
  if (f === 'pcm') return 'Multiphase_VOF';
  return 'Thermal_Transient';
}

export const isCfdFamily = (type: SimulationTypeOption): boolean =>
  type === 'CFD_Incompressible' ||
  type === 'CFD_Compressible' ||
  type === 'CHT_Coupled' ||
  type === 'CHT_MultiRegion' ||
  type === 'FSI_2Way' ||
  type === 'Multiphase_VOF';

export const isStructuralFamily = (type: SimulationTypeOption): boolean =>
  type === 'Structural_Static' ||
  type === 'Structural_Dynamic' ||
  type === 'Structural_Buckling' ||
  type === 'Thermal_Structural';

export const isThermalFamily = (type: SimulationTypeOption): boolean =>
  type === 'Thermal_Steady' ||
  type === 'Thermal_Transient' ||
  type === 'Thermal_Radiation' ||
  type === 'Thermal_Structural' ||
  type === 'CHT_Coupled' ||
  type === 'CHT_MultiRegion';

export const isMultiphysicsCoupling = (type: SimulationTypeOption): boolean =>
  type === 'CHT_MultiRegion' || type === 'FSI_2Way';

export const isElmerFamily = (type: SimulationTypeOption): boolean =>
  type === 'Electromagnetic' || type === 'Acoustics';

export const TEMPERATURE_FIELDS = ['temperature', 'bcLeft', 'bcRight', 'bcTop', 'bcBottom'] as const;

export function isFiniteNumberString(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value));
}

const toKelvin = (value: number, unit: TemperatureUnit): number =>
  unit === 'C' ? value + 273.15 : unit === 'F' ? ((value - 32) * 5) / 9 + 273.15 : value;

const fromKelvin = (kelvin: number, unit: TemperatureUnit): number =>
  unit === 'C' ? kelvin - 273.15 : unit === 'F' ? ((kelvin - 273.15) * 9) / 5 + 32 : kelvin;

export function convertTemperature(value: string, from: TemperatureUnit, to: TemperatureUnit): string {
  if (from === to || !isFiniteNumberString(value)) return value;
  return String(Number(fromKelvin(toKelvin(Number(value), from), to).toFixed(2)));
}

export function getMissingSimulationInputs(inputs: SimulationInputs): string[] {
  const missing: string[] = [];

  const isAutoExternalAero = isCfdFamily(inputs.simulationType) && Boolean(inputs.externalAero);
  if (!isAutoExternalAero && (!isFiniteNumberString(inputs.widthX) || Number(inputs.widthX) <= 0)) missing.push('Domain width');
  if (!isAutoExternalAero && (!isFiniteNumberString(inputs.heightY) || Number(inputs.heightY) <= 0)) missing.push('Domain height');
  if (!isFiniteNumberString(inputs.meshSize) || Number(inputs.meshSize) <= 0) missing.push('Mesh size');

  if (isCfdFamily(inputs.simulationType)) {
    if (!isFiniteNumberString(inputs.velocity)) missing.push('Velocity');
    if (!isFiniteNumberString(inputs.temperature)) missing.push('Temperature');
    if (
      !isFiniteNumberString(inputs.pressure) ||
      (inputs.simulationType === 'CFD_Compressible' && Number(inputs.pressure) <= 0)
    ) {
      missing.push('Pressure');
    }
    if (inputs.mrfEnabled && (!isFiniteNumberString(inputs.mrfOmegaRpm) || Number(inputs.mrfOmegaRpm) === 0)) {
      missing.push('MRF Rotation Speed (RPM)');
    }
  }

  if (isStructuralFamily(inputs.simulationType)) {
    const hasLoadOrDisp =
      isFiniteNumberString(inputs.displacement) ||
      isFiniteNumberString(inputs.pressureLoadMpa) ||
      isFiniteNumberString(inputs.forceN);
    if (!hasLoadOrDisp) missing.push('Displacement / Force / Pressure Load');
    if (!isFiniteNumberString(inputs.youngModulus) || Number(inputs.youngModulus) <= 0) missing.push("Young's Modulus");
    if (
      !isFiniteNumberString(inputs.poissonRatio) ||
      Number(inputs.poissonRatio) < 0 ||
      Number(inputs.poissonRatio) >= 0.5
    ) {
      missing.push("Poisson's Ratio");
    }
    if (!isFiniteNumberString(inputs.density) || Number(inputs.density) <= 0) missing.push('Density');
    if (inputs.materialModel === 'plastic' && (!isFiniteNumberString(inputs.yieldStressMpa) || Number(inputs.yieldStressMpa) <= 0)) {
      missing.push('Yield Stress (MPa)');
    }
    if (inputs.contactType === 'Frictional' && (!isFiniteNumberString(inputs.frictionCoeff) || Number(inputs.frictionCoeff) < 0)) {
      missing.push('Friction Coefficient μ');
    }
  }

  if (
    inputs.simulationType === 'Thermal_Steady' ||
    inputs.simulationType === 'Thermal_Transient' ||
    inputs.simulationType === 'Thermal_Radiation' ||
    inputs.simulationType === 'Thermal_Structural'
  ) {
    if (!isFiniteNumberString(inputs.temperature)) missing.push('Initial Temperature');
    if (!isFiniteNumberString(inputs.thermalConductivity) || Number(inputs.thermalConductivity) <= 0) {
      missing.push('Conductivity');
    }
    if (!isFiniteNumberString(inputs.bcLeft)) missing.push('Left Temp');
    if (!isFiniteNumberString(inputs.bcRight)) missing.push('Right Temp');
    if (!isFiniteNumberString(inputs.bcTop)) missing.push('Top Temp');
    if (!isFiniteNumberString(inputs.bcBottom)) missing.push('Bottom Temp');
  }

  if (inputs.simulationType === 'CHT_Coupled') {
    if (!isFiniteNumberString(inputs.thermalConductivity) || Number(inputs.thermalConductivity) <= 0) {
      missing.push('Thermal Conductivity');
    }
  }

  if (inputs.simulationType === 'CHT_MultiRegion') {
    const hasSolidK =
      (isFiniteNumberString(inputs.solidConductivity) && Number(inputs.solidConductivity) > 0) ||
      (isFiniteNumberString(inputs.thermalConductivity) && Number(inputs.thermalConductivity) > 0);
    if (!hasSolidK) {
      missing.push('Solid Thermal Conductivity');
    }
  }

  if (inputs.simulationType === 'FSI_2Way') {
    if (!isFiniteNumberString(inputs.youngModulus) || Number(inputs.youngModulus) <= 0) {
      missing.push("Solid Young's Modulus");
    }
    if (
      !isFiniteNumberString(inputs.poissonRatio) ||
      Number(inputs.poissonRatio) < 0 ||
      Number(inputs.poissonRatio) >= 0.5
    ) {
      missing.push("Solid Poisson's Ratio");
    }
    if (!isFiniteNumberString(inputs.density) || Number(inputs.density) <= 0) {
      missing.push('Solid Density');
    }
  }

  if (isElmerFamily(inputs.simulationType)) {
    if (!isFiniteNumberString(inputs.bcLeft)) {
      missing.push(inputs.simulationType === 'Acoustics' ? 'Source Sound Pressure (Pa)' : 'Source Potential (V)');
    }
  }

  return missing;
}

export function isSimulationReady(inputs: SimulationInputs): boolean {
  return getMissingSimulationInputs(inputs).length === 0;
}

export function buildSimulationRequest(inputs: SimulationInputs): Record<string, unknown> {
  const missing = getMissingSimulationInputs(inputs);
  if (missing.length > 0) {
    throw new Error(`[INVALID_INPUT] Missing or invalid parameters: ${missing.join(', ')}.`);
  }

  const request: Record<string, unknown> = {
    execution_mode: inputs.executionMode,
    parallel_cores: Math.max(1, Math.min(64, Math.round(Number(inputs.parallelCores) || 1))),
    simulation_type: inputs.simulationType,
    mesh_size: Number(inputs.meshSize),
    element_order: Number(inputs.elementOrder || 1),
    width_x: isFiniteNumberString(inputs.widthX) && Number(inputs.widthX) > 0 ? Number(inputs.widthX) : 1.0,
    height_y: isFiniteNumberString(inputs.heightY) && Number(inputs.heightY) > 0 ? Number(inputs.heightY) : 1.0,
    time_mode: inputs.timeMode,
    gravity_enabled: Boolean(inputs.gravityEnabled),
    discretization_scheme: inputs.discretizationScheme,
    nonlinear: Boolean(inputs.nonlinear),
    contact_type: inputs.contactType,
    support_type: inputs.supportType,
  };

  if (isFiniteNumberString(inputs.depthZ) && Number(inputs.depthZ) > 0) {
    request.depth_z = Number(inputs.depthZ);
  }
  if (isFiniteNumberString(inputs.inflationLayers) && Number(inputs.inflationLayers) > 0) {
    request.inflation_layers = Math.round(Number(inputs.inflationLayers));
  }
  if (isFiniteNumberString(inputs.firstLayerHeight) && Number(inputs.firstLayerHeight) > 0) {
    request.first_layer_height = Number(inputs.firstLayerHeight);
  }
  if (isFiniteNumberString(inputs.growthRate) && Number(inputs.growthRate) >= 1) {
    request.growth_rate = Number(inputs.growthRate);
  }

  // Solution Controls
  if (inputs.timeMode === 'transient' || inputs.adaptiveTimeStepping) {
    if (isFiniteNumberString(inputs.timeStep) && Number(inputs.timeStep) > 0) {
      request.time_step = Number(inputs.timeStep);
    }
    if (isFiniteNumberString(inputs.endTime) && Number(inputs.endTime) > 0) {
      request.end_time = Number(inputs.endTime);
    }
    if (inputs.adaptiveTimeStepping) {
      request.adaptive_time_stepping = true;
      if (isFiniteNumberString(inputs.maxCo) && Number(inputs.maxCo) > 0) {
        request.max_co = Number(inputs.maxCo);
      }
      if (isFiniteNumberString(inputs.maxDeltaT) && Number(inputs.maxDeltaT) > 0) {
        request.max_delta_t = Number(inputs.maxDeltaT);
      }
    }
  }
  if (isMultiphysicsCoupling(inputs.simulationType)) {
    if (isFiniteNumberString(inputs.solidThickness) && Number(inputs.solidThickness) > 0) {
      request.solid_thickness = Number(inputs.solidThickness);
    }
    if (isFiniteNumberString(inputs.solidConductivity) && Number(inputs.solidConductivity) > 0) {
      request.solid_conductivity_k = Number(inputs.solidConductivity);
    }
    if (inputs.simulationType === 'FSI_2Way') {
      request.coupling_scheme = inputs.couplingScheme || 'parallel-implicit';
      if (isFiniteNumberString(inputs.couplingMaxIterations) && Number(inputs.couplingMaxIterations) > 0) {
        request.coupling_max_iterations = Math.round(Number(inputs.couplingMaxIterations));
      }
      if (isFiniteNumberString(inputs.couplingRelTol) && Number(inputs.couplingRelTol) > 0) {
        request.coupling_rel_tol = Number(inputs.couplingRelTol);
      }
      if (isFiniteNumberString(inputs.youngModulus) && Number(inputs.youngModulus) > 0) {
        request.young_modulus = Number(inputs.youngModulus);
      }
      if (isFiniteNumberString(inputs.poissonRatio)) {
        request.poisson_ratio = Number(inputs.poissonRatio);
      }
      if (isFiniteNumberString(inputs.density) && Number(inputs.density) > 0) {
        request.density = Number(inputs.density);
      }
    }
  }
  if (inputs.gravityEnabled && isFiniteNumberString(inputs.gravityY)) {
    request.gravity_y = Number(inputs.gravityY);
  }
  if (isFiniteNumberString(inputs.solverIterations) && Number(inputs.solverIterations) > 0) {
    request.solver_iterations = Math.round(Number(inputs.solverIterations));
  }
  if (isFiniteNumberString(inputs.residualTarget) && Number(inputs.residualTarget) > 0) {
    request.residual_target = Number(inputs.residualTarget);
  }
  if (isFiniteNumberString(inputs.relaxationP) && Number(inputs.relaxationP) > 0) {
    request.relaxation_p = Number(inputs.relaxationP);
  }
  if (isFiniteNumberString(inputs.relaxationU) && Number(inputs.relaxationU) > 0) {
    request.relaxation_u = Number(inputs.relaxationU);
  }
  if (isFiniteNumberString(inputs.relaxationT) && Number(inputs.relaxationT) > 0) {
    request.relaxation_t = Number(inputs.relaxationT);
  }

  if (isCfdFamily(inputs.simulationType)) {
    Object.assign(request, {
      velocity: Number(inputs.velocity),
      temperature: Number(inputs.temperature),
      temperature_unit: inputs.temperatureUnit,
      pressure: Number(inputs.pressure),
      turbulence_model: inputs.turbulenceModel || 'laminar',
    });
    const fluidProps: Record<string, number> = {};
    if (isFiniteNumberString(inputs.fluidDensity) && Number(inputs.fluidDensity) > 0) {
      fluidProps.density = Number(inputs.fluidDensity);
      request.fluid_density = Number(inputs.fluidDensity);
    }
    if (isFiniteNumberString(inputs.dynamicViscosity) && Number(inputs.dynamicViscosity) > 0) {
      fluidProps.viscosity = Number(inputs.dynamicViscosity);
      request.dynamic_viscosity = Number(inputs.dynamicViscosity);
    }
    if (Object.keys(fluidProps).length > 0) {
      request.fluid_properties = fluidProps;
    }
    if (inputs.externalAero) {
      request.external_aero = true;
      if (isFiniteNumberString(inputs.aeroSurfaceLevel)) {
        request.aero_surface_level = Math.max(1, Math.min(4, Math.round(Number(inputs.aeroSurfaceLevel))));
      }
      if (isFiniteNumberString(inputs.aeroWakeLevel)) {
        request.wake_refinement_level = Math.max(1, Math.min(3, Math.round(Number(inputs.aeroWakeLevel))));
        request.aero_wake_level = request.wake_refinement_level;
      }
      if (isFiniteNumberString(inputs.tunnelUpstreamMult) && Number(inputs.tunnelUpstreamMult) > 0) {
        request.tunnel_upstream_mult = Number(inputs.tunnelUpstreamMult);
      }
      if (isFiniteNumberString(inputs.tunnelDownstreamMult) && Number(inputs.tunnelDownstreamMult) > 0) {
        request.tunnel_downstream_mult = Number(inputs.tunnelDownstreamMult);
      }
    }
    if (inputs.mrfEnabled) {
      request.mrf_enabled = true;
      request.mrf_omega_rad_s = Number(inputs.mrfOmegaRpm) * ((2 * Math.PI) / 60);
      request.mrf_axis = inputs.mrfAxis || 'z';
      if (isFiniteNumberString(inputs.mrfRadius) && Number(inputs.mrfRadius) > 0) {
        request.mrf_radius = Number(inputs.mrfRadius);
      }
    }
  }

  if (isStructuralFamily(inputs.simulationType)) {
    Object.assign(request, {
      displacement: isFiniteNumberString(inputs.displacement) ? Number(inputs.displacement) : 0.0,
      young_modulus: Number(inputs.youngModulus),
      poisson_ratio: Number(inputs.poissonRatio),
      density: Number(inputs.density),
      material_model: inputs.materialModel || 'linear_elastic',
    });
    if (isFiniteNumberString(inputs.pressureLoadMpa)) {
      request.pressure_load_mpa = Number(inputs.pressureLoadMpa);
    }
    if (isFiniteNumberString(inputs.forceN)) {
      request.force_n = Number(inputs.forceN);
    }
    if (isFiniteNumberString(inputs.modesCount) && Number(inputs.modesCount) > 0) {
      request.modes_count = Math.round(Number(inputs.modesCount));
    }
    if (isFiniteNumberString(inputs.thermalExpansion)) {
      request.thermal_expansion = Number(inputs.thermalExpansion);
    }
    if (inputs.materialModel === 'plastic') {
      if (isFiniteNumberString(inputs.yieldStressMpa) && Number(inputs.yieldStressMpa) > 0) {
        request.yield_stress_pa = Number(inputs.yieldStressMpa) * 1e6;
      }
      if (isFiniteNumberString(inputs.tangentModulusMpa) && Number(inputs.tangentModulusMpa) > 0) {
        request.tangent_modulus_pa = Number(inputs.tangentModulusMpa) * 1e6;
      }
    } else if (inputs.materialModel === 'hyperelastic') {
      if (isFiniteNumberString(inputs.hyperC10Mpa) && Number(inputs.hyperC10Mpa) > 0) {
        request.hyper_c10_pa = Number(inputs.hyperC10Mpa) * 1e6;
      }
      if (isFiniteNumberString(inputs.hyperD1) && Number(inputs.hyperD1) >= 0) {
        request.hyper_d1_inv_pa = Number(inputs.hyperD1);
      }
    }
    if (inputs.contactType === 'Frictional' && isFiniteNumberString(inputs.frictionCoeff)) {
      request.friction_coeff = Number(inputs.frictionCoeff);
    }
  }

  if (isThermalFamily(inputs.simulationType)) {
    if (isFiniteNumberString(inputs.temperature)) {
      request.temperature = Number(inputs.temperature);
      request.temperature_unit = inputs.temperatureUnit;
    }
    if (isFiniteNumberString(inputs.thermalConductivity)) {
      request.thermal_conductivity_k = Number(inputs.thermalConductivity);
    }
    if (isFiniteNumberString(inputs.specificHeat)) {
      request.specific_heat = Number(inputs.specificHeat);
    }
    if (isFiniteNumberString(inputs.heatFlux)) {
      request.heat_flux = Number(inputs.heatFlux);
    }
    if (isFiniteNumberString(inputs.convectionH)) {
      request.convection_h = Number(inputs.convectionH);
    }
    if (isFiniteNumberString(inputs.emissivity)) {
      request.emissivity = Number(inputs.emissivity);
    }
    if (isFiniteNumberString(inputs.ambientTempC)) {
      request.ambient_temp_c = Number(inputs.ambientTempC);
    }
    if (isFiniteNumberString(inputs.bcLeft)) request.bc_left_temp = Number(inputs.bcLeft);
    if (isFiniteNumberString(inputs.bcRight)) request.bc_right_temp = Number(inputs.bcRight);
    if (isFiniteNumberString(inputs.bcTop)) request.bc_top_temp = Number(inputs.bcTop);
    if (isFiniteNumberString(inputs.bcBottom)) request.bc_bottom_temp = Number(inputs.bcBottom);
  }

  if (isElmerFamily(inputs.simulationType)) {
    const submode = inputs.simulationType === 'Acoustics' ? 'Acoustics' : inputs.emSubmode;
    request.em_submode = submode;
    const emParams: Record<string, unknown> = {
      submode,
      source_value: Number(inputs.bcLeft),
      reference_value: isFiniteNumberString(inputs.bcRight) ? Number(inputs.bcRight) : 0.0,
      frequency_hz: isFiniteNumberString(inputs.velocity) ? Number(inputs.velocity) : 1000.0,
    };
    if (isFiniteNumberString(inputs.electricalConductivity)) {
      const sigma = Number(inputs.electricalConductivity);
      emParams.electrical_conductivity = sigma;
      request.electrical_conductivity = sigma;
    }
    if (isFiniteNumberString(inputs.relativePermeability)) {
      const muR = Number(inputs.relativePermeability);
      emParams.relative_permeability = muR;
      request.relative_permeability = muR;
    }
    if (isFiniteNumberString(inputs.relativePermittivity)) {
      const epsR = Number(inputs.relativePermittivity);
      emParams.relative_permittivity = epsR;
      request.relative_permittivity = epsR;
    }
    if (isFiniteNumberString(inputs.currentDensity)) {
      const j = Number(inputs.currentDensity);
      emParams.current_density = j;
      request.current_density = j;
    }
    request.em_parameters = emParams;
  }

  return request;
}