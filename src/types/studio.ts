export type WorkflowStep = 'geometry' | 'mesh' | 'physics' | 'copilot' | 'post';

export type JobStatus = 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type SimulationTypeOption =
  | 'CFD_Incompressible'
  | 'CFD_Compressible'
  | 'Structural_Static'
  | 'Structural_Dynamic'
  | 'Thermal_Transient';

export type ExecutionModeOption = 'celery' | 'direct';

export type TemperatureUnit = 'K' | 'C' | 'F';

export type ConsoleTab = 'logs' | 'convergence' | 'errors';

export interface SimulationInputs {
  simulationType: SimulationTypeOption;
  executionMode: ExecutionModeOption;
  // Common domain & mesh
  meshSize: string;
  widthX: string;
  heightY: string;
  // CFD & Thermal
  velocity: string;
  temperature: string;
  temperatureUnit: TemperatureUnit;
  pressure: string;
  // Structural (FEA)
  displacement: string;
  youngModulus: string;
  poissonRatio: string;
  density: string;
  // Thermal_Transient
  thermalConductivity: string;
  bcLeft: string;
  bcRight: string;
  bcTop: string;
  bcBottom: string;
}

export interface ConsoleIssue {
  id: number;
  time: string;
  severity: 'error' | 'warning';
  message: string;
}

// جميع الحقول الفيزيائية تبدأ فارغة تماماً؛ لا يُسمح بأي أرقام افتراضية وهمية
export const DEFAULT_SIMULATION_INPUTS: SimulationInputs = {
  simulationType: 'CFD_Incompressible',
  executionMode: 'celery',
  meshSize: '',
  widthX: '',
  heightY: '',
  velocity: '',
  temperature: '',
  temperatureUnit: 'K',
  pressure: '',
  displacement: '',
  youngModulus: '',
  poissonRatio: '',
  density: '',
  thermalConductivity: '',
  bcLeft: '',
  bcRight: '',
  bcTop: '',
  bcBottom: '',
};

export const SIMULATION_TYPE_OPTIONS: { value: SimulationTypeOption; label: string }[] = [
  { value: 'CFD_Incompressible', label: 'CFD · Incompressible' },
  { value: 'CFD_Compressible', label: 'CFD · Compressible' },
  { value: 'Structural_Static', label: 'Structural · Static' },
  { value: 'Structural_Dynamic', label: 'Structural · Dynamic' },
  { value: 'Thermal_Transient', label: 'Thermal · Transient' },
];

export function defaultSimulationTypeForField(field?: string): SimulationTypeOption {
  if (field === 'CFD') return 'CFD_Incompressible';
  if (field === 'FEA') return 'Structural_Static';
  return 'Thermal_Transient';
}

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

// فحص الحقول الناقصة أو غير الصالحة حسب نوع الفيزياء المختارة لقفل زر التشغيل حتى اكتمالها
export function getMissingSimulationInputs(inputs: SimulationInputs): string[] {
  const missing: string[] = [];

  if (!isFiniteNumberString(inputs.widthX) || Number(inputs.widthX) <= 0) missing.push('Domain width');
  if (!isFiniteNumberString(inputs.heightY) || Number(inputs.heightY) <= 0) missing.push('Domain height');
  if (!isFiniteNumberString(inputs.meshSize) || Number(inputs.meshSize) <= 0) missing.push('Mesh size');

  if (inputs.simulationType === 'CFD_Incompressible' || inputs.simulationType === 'CFD_Compressible') {
    if (!isFiniteNumberString(inputs.velocity)) missing.push('Velocity');
    if (!isFiniteNumberString(inputs.temperature)) missing.push('Temperature');
    if (
      !isFiniteNumberString(inputs.pressure) ||
      (inputs.simulationType === 'CFD_Compressible' && Number(inputs.pressure) <= 0)
    ) {
      missing.push('Pressure');
    }
  } else if (inputs.simulationType === 'Structural_Static' || inputs.simulationType === 'Structural_Dynamic') {
    if (!isFiniteNumberString(inputs.displacement)) missing.push('Displacement');
    if (!isFiniteNumberString(inputs.youngModulus) || Number(inputs.youngModulus) <= 0) missing.push("Young's Modulus");
    if (
      !isFiniteNumberString(inputs.poissonRatio) ||
      Number(inputs.poissonRatio) < 0 ||
      Number(inputs.poissonRatio) >= 0.5
    ) {
      missing.push("Poisson's Ratio");
    }
    if (!isFiniteNumberString(inputs.density) || Number(inputs.density) <= 0) missing.push('Density');
  } else if (inputs.simulationType === 'Thermal_Transient') {
    if (!isFiniteNumberString(inputs.temperature)) missing.push('Initial Temperature');
    if (!isFiniteNumberString(inputs.thermalConductivity) || Number(inputs.thermalConductivity) <= 0) {
      missing.push('Conductivity');
    }
    if (!isFiniteNumberString(inputs.bcLeft)) missing.push('Left Temp');
    if (!isFiniteNumberString(inputs.bcRight)) missing.push('Right Temp');
    if (!isFiniteNumberString(inputs.bcTop)) missing.push('Top Temp');
    if (!isFiniteNumberString(inputs.bcBottom)) missing.push('Bottom Temp');
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
    simulation_type: inputs.simulationType,
    mesh_size: Number(inputs.meshSize),
    width_x: Number(inputs.widthX),
    height_y: Number(inputs.heightY),
  };

  if (inputs.simulationType === 'CFD_Incompressible' || inputs.simulationType === 'CFD_Compressible') {
    Object.assign(request, {
      velocity: Number(inputs.velocity),
      temperature: Number(inputs.temperature),
      temperature_unit: inputs.temperatureUnit,
      pressure: Number(inputs.pressure),
    });
  } else if (inputs.simulationType === 'Structural_Static' || inputs.simulationType === 'Structural_Dynamic') {
    Object.assign(request, {
      displacement: Number(inputs.displacement),
      young_modulus: Number(inputs.youngModulus),
      poisson_ratio: Number(inputs.poissonRatio),
      density: Number(inputs.density),
    });
  } else if (inputs.simulationType === 'Thermal_Transient') {
    Object.assign(request, {
      temperature: Number(inputs.temperature),
      temperature_unit: inputs.temperatureUnit,
      thermal_conductivity_k: Number(inputs.thermalConductivity),
      bc_left_temp: Number(inputs.bcLeft),
      bc_right_temp: Number(inputs.bcRight),
      bc_top_temp: Number(inputs.bcTop),
      bc_bottom_temp: Number(inputs.bcBottom),
    });
  }

  return request;
}