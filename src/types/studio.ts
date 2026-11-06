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

// Numeric inputs are kept as strings so the user can type freely; they are validated on submit.
export interface SimulationInputs {
  simulationType: SimulationTypeOption;
  executionMode: ExecutionModeOption;
  velocity: string;
  temperature: string;
  temperatureUnit: TemperatureUnit;
  pressure: string;
  displacement: string;
  meshSize: string;
  widthX: string;
  heightY: string;
  // Thermal_Transient only. Boundary temperatures are in `temperatureUnit`.
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

export const DEFAULT_SIMULATION_INPUTS: SimulationInputs = {
  simulationType: 'CFD_Incompressible',
  executionMode: 'celery',
  velocity: '1',
  temperature: '293.15',
  temperatureUnit: 'K',
  pressure: '101325',
  displacement: '0.001',
  meshSize: '0.1',
  widthX: '1',
  heightY: '1',
  thermalConductivity: '400',
  bcLeft: '373.15',
  bcRight: '293.15',
  bcTop: '293.15',
  bcBottom: '293.15',
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

export const NUMERIC_INPUT_LABELS: Record<'velocity' | 'temperature' | 'pressure' | 'displacement' | 'meshSize' | 'widthX' | 'heightY', string> = {
  velocity: 'Velocity',
  temperature: 'Temperature',
  pressure: 'Pressure',
  displacement: 'Displacement',
  meshSize: 'Mesh size',
  widthX: 'Domain width',
  heightY: 'Domain height',
};

export const THERMAL_INPUT_LABELS: Record<'thermalConductivity' | 'bcLeft' | 'bcRight' | 'bcTop' | 'bcBottom', string> = {
  thermalConductivity: 'Conductivity',
  bcLeft: 'Left temperature',
  bcRight: 'Right temperature',
  bcTop: 'Top temperature',
  bcBottom: 'Bottom temperature',
};

export const TEMPERATURE_FIELDS = ['temperature', 'bcLeft', 'bcRight', 'bcTop', 'bcBottom'] as const;

export function isFiniteNumberString(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value));
}

const toKelvin = (value: number, unit: TemperatureUnit): number =>
  unit === 'C' ? value + 273.15 : unit === 'F' ? ((value - 32) * 5) / 9 + 273.15 : value;

const fromKelvin = (kelvin: number, unit: TemperatureUnit): number =>
  unit === 'C' ? kelvin - 273.15 : unit === 'F' ? ((kelvin - 273.15) * 9) / 5 + 32 : kelvin;

// Re-expresses a typed temperature in another unit; unparsable text is left for the validator to report.
export function convertTemperature(value: string, from: TemperatureUnit, to: TemperatureUnit): string {
  if (from === to || !isFiniteNumberString(value)) return value;
  return String(Number(fromKelvin(toKelvin(Number(value), from), to).toFixed(2)));
}

// Converts the form state into the FastAPI request body; throws a readable error for malformed numbers.
export function buildSimulationRequest(inputs: SimulationInputs): Record<string, unknown> {
  const numeric = {} as Record<keyof typeof NUMERIC_INPUT_LABELS, number>;
  (Object.keys(NUMERIC_INPUT_LABELS) as (keyof typeof NUMERIC_INPUT_LABELS)[]).forEach((key) => {
    if (!isFiniteNumberString(inputs[key])) {
      throw new Error(`[INVALID_INPUT] ${NUMERIC_INPUT_LABELS[key]} must be a finite number.`);
    }
    numeric[key] = Number(inputs[key]);
  });
  (['widthX', 'heightY'] as const).forEach((key) => {
    if (numeric[key] <= 0) {
      throw new Error(`[INVALID_INPUT] ${NUMERIC_INPUT_LABELS[key]} must be greater than 0.`);
    }
  });
  const request: Record<string, unknown> = {
    execution_mode: inputs.executionMode,
    simulation_type: inputs.simulationType,
    velocity: numeric.velocity,
    temperature: numeric.temperature,
    temperature_unit: inputs.temperatureUnit,
    pressure: numeric.pressure,
    displacement: numeric.displacement,
    mesh_size: numeric.meshSize,
    width_x: numeric.widthX,
    height_y: numeric.heightY,
  };

  if (inputs.simulationType === 'Thermal_Transient') {
    const thermal = {} as Record<keyof typeof THERMAL_INPUT_LABELS, number>;
    (Object.keys(THERMAL_INPUT_LABELS) as (keyof typeof THERMAL_INPUT_LABELS)[]).forEach((key) => {
      if (!isFiniteNumberString(inputs[key])) {
        throw new Error(`[INVALID_INPUT] ${THERMAL_INPUT_LABELS[key]} must be a finite number.`);
      }
      thermal[key] = Number(inputs[key]);
    });
    if (thermal.thermalConductivity <= 0) {
      throw new Error('[INVALID_INPUT] Conductivity must be greater than 0.');
    }
    Object.assign(request, {
      thermal_conductivity_k: thermal.thermalConductivity,
      bc_left_temp: thermal.bcLeft,
      bc_right_temp: thermal.bcRight,
      bc_top_temp: thermal.bcTop,
      bc_bottom_temp: thermal.bcBottom,
    });
  }
  return request;
}
