import { MeshStudyResult, ProfileSpec, ReferenceDataSet, SimulationRunRecord, ThesisProject, isCurrentMeshStudy } from '../types/thesis';
import { normalizeSolverResponse } from './normalizedSolverResults';
import { formatNumber } from './numberFormat';
import { meshStudyVerdict } from './meshStudyVerdict';
import { Comparison, SampledProfile, evaluateValidation } from './validationMetrics';

export const PLATFORM_NAME = 'NASEER Universal CAE Studio';
export const AI_ASSISTANT_NAME = 'OmniSolve AI';
export const AI_ASSISTANT_LABEL = 'OmniSolve AI (Copilot)';

export interface ReportRow {
  label: string;
  value: string;
  unit?: string;
  note?: string;
}

export interface ReportMatrix {
  key: string;
  label: string;
  unit?: string;
  rows: number;
  cols: number;
  min: number;
  max: number;
  mean: number;
  nonFiniteCount: number;
  data: number[][];
  widthM?: number;
  heightM?: number;
}

export interface ReportSeries {
  name: string;
  points: { iteration: number; value: number }[];
}

export interface ReportCheck {
  label: string;
  passed: boolean;
  detail: string;
}

// Everything an exported document may state. Each value is read from the stored run record
// (submitted request, backend job payload, solver result, console logs) — nothing is defaulted.
export interface RealReport {
  platform: string;
  assistant: string;
  title: string;
  titleEn?: string;
  field: string;
  preparedBy?: string;
  institution?: string;
  generatedAt: string;
  job: ReportRow[];
  parameters: ReportRow[];
  solver: ReportRow[];
  mesh: ReportRow[];
  results: ReportRow[];
  matrices: ReportMatrix[];
  checks: ReportCheck[];
  convergenceRows: ReportRow[];
  convergenceStatement: string;
  series: ReportSeries[];
  provenance: ReportRow[];
  logs: string[];
  errors: { code?: string; message: string }[];
  summary: string[];
  notes: string[];
  // Present only when the user ran a real mesh-independence study with the current method.
  meshStudy?: MeshStudyResult;
  // Present only when the user ingested reference data; carries either the comparison or the reason it failed.
  validation?: {
    reference: ReferenceDataSet;
    spec: ProfileSpec;
    fieldLabel?: string;
    unit?: string;
    profile?: SampledProfile;
    comparison?: Comparison;
    error?: string;
  };
  simulationTypeLabel: string;
  jobId?: string;
}

export class ExportUnavailableError extends Error {
  constructor(message = 'Run a simulation to completion before exporting a report: reports contain real solver output only.') {
    super(message);
    this.name = 'ExportUnavailableError';
  }
}

export const hasRealSimulationRun = (project: ThesisProject | null | undefined): boolean =>
  !!project?.simulationRun && typeof project.simulationRun.result === 'object' && project.simulationRun.result !== null;

type Dict = Record<string, unknown>;
const isDict = (value: unknown): value is Dict => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const str = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

export { formatNumber };

const UNIT_LABELS: Record<string, string> = {
  degC: '°C',
  'W/m2': 'W/m²',
  'W/(m K)': 'W/(m·K)',
  m2: 'm²',
};
export const prettyUnit = (unit: string | undefined): string | undefined => (unit ? UNIT_LABELS[unit] ?? unit : undefined);

const humanize = (key: string): string => {
  const text = key.replace(/_/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const formatIso = (iso: string | undefined): string | undefined => {
  if (!iso) return undefined;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC');
};

// Same envelope rule as normalizeSolverResponse: solver data may be nested under data / solver_results.
const solverData = (result: Dict): Dict => {
  const data = isDict(result.data) ? result.data : undefined;
  const nested = (isDict(data?.solver_results) ? data!.solver_results : undefined) ?? (isDict(result.solver_results) ? result.solver_results : undefined) ?? data ?? result;
  return nested as Dict;
};

export function toMatrix(value: unknown): number[][] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((row): row is unknown[] => Array.isArray(row))) return undefined;
  const cols = (value[0] as unknown[]).length;
  if (cols === 0 || value.some((row) => (row as unknown[]).length !== cols)) return undefined;
  const matrix = (value as unknown[][]).map((row) => row.map((cell) => (typeof cell === 'number' ? cell : NaN)));
  return matrix.some((row) => row.some(Number.isFinite)) ? matrix : undefined;
}

const MATRIX_LABELS: Record<string, { label: string; unitKey?: string }> = {
  temperature_matrix: { label: 'Temperature field', unitKey: 'temperature' },
  von_mises_matrix: { label: 'Von Mises stress field', unitKey: 'stress' },
  velocity_magnitude: { label: 'Velocity magnitude field', unitKey: 'velocity' },
  displacement_matrix: { label: 'Displacement field', unitKey: 'displacement' },
};

const toCelsius = (value: number, unit: string): number =>
  unit === 'K' ? value - 273.15 : unit === 'F' ? ((value - 32) * 5) / 9 : value;

const nonEmpty = (rows: (ReportRow | undefined)[]): ReportRow[] => rows.filter((row): row is ReportRow => !!row);
const row = (label: string, value: unknown, unit?: string, note?: string): ReportRow | undefined => {
  const n = num(value);
  const text = n !== undefined ? formatNumber(n) : typeof value === 'boolean' ? (value ? 'Yes' : 'No') : str(value);
  return text === undefined ? undefined : { label, value: text, unit, note };
};

const PLACEHOLDER_IDENTITIES = new Set([
  'Principal Simulation Analyst',
  'Senior Engineering Simulation Consultant',
  'ANSYS Multiphysics Engineering WorkBench',
]);
const identity = (value: string | undefined): string | undefined => {
  const text = str(value);
  return text && !PLACEHOLDER_IDENTITIES.has(text) ? text : undefined;
};

export function buildRealReport(project: ThesisProject): RealReport {
  const run: SimulationRunRecord | undefined = project.simulationRun;
  if (!run || !isDict(run.result)) throw new ExportUnavailableError();

  const result = run.result as Dict;
  const nested = solverData(result);
  const submitted = run.submittedRequest ?? {};
  const backend = run.backendPayload;
  const source: Dict = backend ?? submitted;
  const units = (isDict(nested.units) ? nested.units : isDict(result.units) ? result.units : {}) as Record<string, string>;
  const physicsType = str(result.physics_type) ?? str(nested.physics_type) ?? str(source.simulation_type) ?? project.field;
  const isThermal = physicsType.startsWith('Thermal');
  const isCfd = physicsType.startsWith('CFD');
  const isStructural = physicsType.startsWith('Structural');
  const tempUnitLabel = prettyUnit(units.temperature) ?? '°C';

  const domain = isDict(source.domain) ? source.domain : undefined;
  const meshSettings = isDict(source.mesh_settings) ? source.mesh_settings : undefined;
  const material = isDict(source.material_properties) ? source.material_properties : undefined;
  const widthM = num(domain?.width_x) ?? num(source.width_x);
  const heightM = num(domain?.height_y) ?? num(source.height_y);
  const meshSize = num(meshSettings?.mesh_size) ?? num(source.mesh_size);
  const conductivity = num(material?.thermal_conductivity_k) ?? num(source.thermal_conductivity_k);

  // --- Parameters: the values the backend actually consumed -------------------------------------
  const requestTempUnit = backend ? 'K' : str(source.temperature_unit) ?? 'K';
  const bcDict = isDict(source.boundary_conditions) ? source.boundary_conditions : undefined;
  const edge = (name: string): number | undefined => (isDict(bcDict?.[name]) ? num((bcDict![name] as Dict).value) : undefined);
  const bcEntries: { label: string; edge: string; requestKey: string }[] = [
    { label: 'Left edge (x = 0) temperature', edge: 'left_edge_x0', requestKey: 'bc_left_temp' },
    { label: 'Right edge (x = Lx) temperature', edge: 'right_edge_x1', requestKey: 'bc_right_temp' },
    { label: 'Top edge (y = Ly) temperature', edge: 'top_edge_y1', requestKey: 'bc_top_temp' },
    { label: 'Bottom edge (y = 0) temperature', edge: 'bottom_edge_y0', requestKey: 'bc_bottom_temp' },
  ];
  // Boundary temperatures in °C (what the thermal solver consumes), for checks.
  const bcCelsius = bcEntries.map((entry) => {
    const consumed = edge(entry.edge);
    if (consumed !== undefined) return consumed;
    const requested = num(source[entry.requestKey]);
    return requested === undefined ? undefined : toCelsius(requested, requestTempUnit);
  });

  const parameters = nonEmpty([
    row('Simulation type', str(source.simulation_type) ?? physicsType),
    row('Execution mode', run.executionMode),
    row('Domain width Lx', widthM, 'm'),
    row('Domain height Ly', heightM, 'm'),
    row('Mesh size', meshSize, 'm'),
    ...(isThermal
      ? [
          row('Thermal conductivity k', conductivity, 'W/(m·K)'),
          ...bcEntries.map((entry, index) => {
            const consumed = edge(entry.edge);
            if (consumed !== undefined) return row(entry.label, consumed, '°C', 'as applied by the solver');
            const requested = num(source[entry.requestKey]);
            return row(entry.label, requested, requestTempUnit === 'K' ? 'K' : requestTempUnit === 'F' ? '°F' : '°C', bcCelsius[index] === undefined ? undefined : 'as submitted');
          }),
        ]
      : []),
    ...(isCfd ? [row('Velocity', source.velocity, 'm/s'), row('Temperature', source.temperature, requestTempUnit === 'K' ? 'K' : requestTempUnit === 'F' ? '°F' : '°C'), row('Pressure', source.pressure, 'Pa')] : []),
    ...(isStructural ? [row('Displacement', source.displacement, 'm'), row('Pressure', source.pressure, 'Pa')] : []),
  ]);

  // --- Matrices --------------------------------------------------------------------------------
  const matrixSources: Dict[] = [nested, ...(isDict(nested.contours) ? [nested.contours as Dict] : []), ...(isDict(nested.fields) ? [nested.fields as Dict] : [])];
  const seen = new Set<string>();
  const matrices: ReportMatrix[] = [];
  matrixSources.forEach((holder) => {
    Object.entries(holder).forEach(([key, value]) => {
      if (seen.has(key)) return;
      const known = MATRIX_LABELS[key];
      if (!known && !key.endsWith('_matrix')) return;
      const data = toMatrix(value);
      if (!data) return;
      seen.add(key);
      const finiteValues = data.flat().filter(Number.isFinite);
      const total = data.length * data[0].length;
      matrices.push({
        key,
        label: known?.label ?? humanize(key.replace(/_matrix$/, '')) + ' field',
        unit: prettyUnit(known?.unitKey ? units[known.unitKey] : undefined),
        rows: data.length,
        cols: data[0].length,
        min: Math.min(...finiteValues),
        max: Math.max(...finiteValues),
        mean: finiteValues.reduce((sum, v) => sum + v, 0) / finiteValues.length,
        nonFiniteCount: total - finiteValues.length,
        data,
        widthM,
        heightM,
      });
    });
  });
  const temperature = matrices.find((matrix) => matrix.key === 'temperature_matrix');

  // --- Scalar results -------------------------------------------------------------------------
  const nodes = num(nested.mesh_nodes);
  const elements = num(nested.mesh_elements);
  const reportedFlux = num(nested.calculated_heat_flux);
  const SKIP_SCALARS = new Set(['mesh_nodes', 'mesh_elements', 'material_k', 'process_time', 'process_time_ms', 'task_progress', 'center_temperature', 'calculated_heat_flux']);
  const extraScalars = Object.entries(nested)
    .filter(([key, value]) => !SKIP_SCALARS.has(key) && num(value) !== undefined)
    .map(([key, value]) => row(humanize(key), value, prettyUnit(units[key])));

  const checks: ReportCheck[] = [];
  if (isThermal && conductivity !== undefined && widthM !== undefined && widthM > 0 && bcCelsius[0] !== undefined && bcCelsius[1] !== undefined && reportedFlux !== undefined) {
    const expected = (conductivity * (bcCelsius[0]! - bcCelsius[1]!)) / widthM;
    const consistent = Math.abs(reportedFlux - expected) <= 0.0051 + 1e-9 * Math.abs(expected);
    checks.push({
      label: 'Reported heat flux vs. 1-D relation q = k(T_left − T_right)/Lx',
      passed: consistent,
      detail: consistent
        ? `Recomputed ${formatNumber(expected)} W/m² from the submitted parameters equals the reported ${formatNumber(reportedFlux)} W/m². This is a one-dimensional estimate, not an integral of the computed 2-D field.`
        : `Recomputed ${formatNumber(expected)} W/m² differs from the reported ${formatNumber(reportedFlux)} W/m².`,
    });
  }
  if (isThermal && temperature && units.temperature === 'degC' && bcCelsius.every((value) => value !== undefined)) {
    const low = Math.min(...(bcCelsius as number[]));
    const high = Math.max(...(bcCelsius as number[]));
    const tolerance = 1e-6 * Math.max(1, high - low);
    const bounded = temperature.min >= low - tolerance && temperature.max <= high + tolerance;
    checks.push({
      label: 'Temperature field bounded by boundary temperatures (maximum principle)',
      passed: bounded,
      detail: `Field range ${formatNumber(temperature.min)} … ${formatNumber(temperature.max)} °C; boundary range ${formatNumber(low)} … ${formatNumber(high)} °C.`,
    });
  }
  if (temperature && nodes !== undefined) {
    const consistent = temperature.rows * temperature.cols === nodes;
    checks.push({
      label: 'Returned matrix size vs. reported mesh node count',
      passed: consistent,
      detail: `${temperature.cols} × ${temperature.rows} = ${temperature.cols * temperature.rows} matrix entries; backend reports ${formatNumber(nodes)} nodes.`,
    });
  }

  // --- Physics-specific key metrics (CFD / structural): plain reductions over the returned data -----
  const physicsRows: (ReportRow | undefined)[] = [];
  const physicsMeshRows: (ReportRow | undefined)[] = [];
  const physicsNotes: string[] = [];
  const cfdMetrics = isDict(nested.metrics) ? nested.metrics : undefined;
  if (isCfd && cfdMetrics) {
    const velocity = isDict(cfdMetrics.max_velocity) ? cfdMetrics.max_velocity : undefined;
    const drop = isDict(cfdMetrics.pressure_drop) ? cfdMetrics.pressure_drop : undefined;
    const meshInfo = isDict(cfdMetrics.mesh) ? cfdMetrics.mesh : undefined;
    physicsRows.push(
      row('Maximum velocity magnitude V_max', velocity?.value, str(velocity?.unit), 'largest |U| over all cells, final time step'),
      row('Pressure drop ΔP (inlet → outlet)', drop?.value, str(drop?.unit), str(drop?.definition)),
    );
    if (meshInfo) {
      physicsMeshRows.push(row('In-plane cells (nx × ny)', `${meshInfo.nx} × ${meshInfo.ny}`), row('Cells (total)', meshInfo.cells_total));
    }
    if (str(drop?.unit) === 'm²/s²') physicsNotes.push('Pressure is kinematic (p/ρ) because the incompressible OpenFOAM solver was used.');
  } else if (isCfd && str(nested.metrics_error)) {
    physicsNotes.push(`CFD key metrics are unavailable for this run: ${str(nested.metrics_error)}.`);
  }
  if (isStructural) {
    const stressRows = (Array.isArray(nested.stress) ? nested.stress : []).filter(isDict);
    const displacementRows = (Array.isArray(nested.displacements) ? nested.displacements : []).filter(isDict);
    const finite = (values: (number | undefined)[]) => values.filter((v): v is number => v !== undefined);
    const vonMises = finite(stressRows.map((s) => num(s.von_mises)));
    const magnitudes = finite(displacementRows.map((d) => num(d.magnitude)));
    const spread = (axis: 'x' | 'y' | 'z') => {
      const values = finite(displacementRows.map((d) => (isDict(d.components) ? num(d.components[axis]) : undefined)));
      return values.length ? Math.max(...values) - Math.min(...values) : 0;
    };
    const scale = magnitudes.length ? Math.max(...magnitudes) : 0;
    const rigid = scale > 0 && Math.max(spread('x'), spread('y'), spread('z')) <= 1e-9 * scale;
    if (rigid) {
      physicsNotes.push('The structural model moved as a rigid body (uniform displacement field), so the stresses reported are numerical noise and are not tabulated.');
    } else {
      if (vonMises.length) physicsRows.push(row('Peak von Mises stress', Math.max(...vonMises), prettyUnit(str(units.von_mises) ?? 'Pa'), 'largest value over all element integration points'));
      if (magnitudes.length) physicsRows.push(row('Peak displacement magnitude', scale, prettyUnit(str(units.displacement) ?? 'm'), 'largest nodal displacement'));
    }
    const nodeIds = new Set(displacementRows.map((d) => d.node));
    const elementIds = new Set(stressRows.map((s) => s.element));
    physicsMeshRows.push(row('Mesh nodes', nodeIds.size || undefined), row('Mesh elements', elementIds.size || undefined));
  }

  const results = nonEmpty([
    ...physicsRows,
    row('Center-node temperature', nested.center_temperature, tempUnitLabel),
    row('Calculated heat flux', reportedFlux, prettyUnit(units.heat_flux) ?? 'W/m²', isThermal ? 'reported by the backend' : undefined),
    row('Material conductivity used by solver', nested.material_k, prettyUnit(units.thermal_conductivity) ?? 'W/(m·K)'),
    ...extraScalars,
    ...matrices.flatMap((matrix) => [
      row(`${matrix.label} — grid`, `${matrix.cols} × ${matrix.rows} nodes (x × y)`),
      row(`${matrix.label} — minimum`, matrix.min, matrix.unit),
      row(`${matrix.label} — maximum`, matrix.max, matrix.unit),
      row(`${matrix.label} — mean`, matrix.mean, matrix.unit, 'arithmetic mean of node values'),
    ]),
  ]);

  // --- Convergence -----------------------------------------------------------------------------
  const conv = isDict(nested.convergence) ? nested.convergence : isDict(result.convergence) ? result.convergence : undefined;
  const normalized = normalizeSolverResponse(result, project);
  const series: ReportSeries[] = (normalized.residualSeries ?? [])
    .map((item) => ({ name: item.name, points: item.points.filter((p) => Number.isFinite(p.iteration) && Number.isFinite(p.value) && p.value > 0) }))
    .filter((item) => item.points.length >= 2);
  const convergenceRows = nonEmpty([
    row('Converged', conv?.converged),
    row('Convergence status', conv?.status),
    row('Final relative residual', conv?.relative_residual),
    row('Final absolute residual', conv?.absolute_residual),
    ...series.map((item) => row(`Final residual — ${item.name}`, item.points[item.points.length - 1].value, undefined, `${item.points.length} samples`)),
  ]);
  const method = str((isDict(result.provenance) ? result.provenance : undefined)?.method) ?? str((isDict(nested.provenance) ? nested.provenance : undefined)?.method);
  const convergenceStatement = series.length
    ? 'Residual histories below are the series reported by the solver log; the x-axis is the order of residual samples in that log.'
    : `The backend did not report an iterative residual history for this run${method ? ` (method reported by the backend: ${method})` : ''}, so no residual plot is shown${convergenceRows.length ? '; the final residual norms it did report are tabulated' : ''}.`;

  // --- Job, provenance, solver ---------------------------------------------------------------
  const processMs = num(result.process_time_ms) ?? (num(result.process_time) !== undefined ? num(result.process_time)! * 1000 : undefined);
  const jobId = run.taskId;
  const prov = isDict(result.provenance) ? result.provenance : {};
  const job = nonEmpty([
    row('Job ID', jobId ?? 'not applicable (synchronous direct execution)'),
    row('Execution mode', run.executionMode),
    row('Final job status', 'COMPLETED'),
    row('Job created', formatIso(run.createdAt)),
    row('Solver started', formatIso(run.startedAt)),
    row('Job completed', formatIso(run.completedAt)),
    row('Result received by client', formatIso(run.recordedAt)),
    row('Solver process time', processMs !== undefined ? processMs / 1000 : undefined, 's'),
  ]);
  const solver = nonEmpty([
    row('Physics type', physicsType),
    row('Solver reported by backend', result.solver ?? nested.solver_type ?? nested.solver),
    row('Recommended engine', result.recommended_solver),
    row('Solver status', nested.status ?? result.status),
    row('Method', method),
  ]);
  const mesh = nonEmpty([
    row('Mesh nodes', nodes),
    row('Mesh elements', elements),
    ...physicsMeshRows,
    temperature ? row('Returned grid (x × y)', `${temperature.cols} × ${temperature.rows}`) : undefined,
  ]);
  const provenance = nonEmpty([
    row('Input SHA-256', prov.input_sha256),
    row('Result schema version', prov.schema_version ?? result.schema_version),
    row('Input source', prov.source),
  ]);

  const errors = (Array.isArray(result.errors) ? result.errors : [])
    .map((entry) => (isDict(entry) ? { code: str(entry.code), message: str(entry.message) ?? JSON.stringify(entry) } : { message: String(entry) }));

  const typeLabel = str(source.simulation_type) ?? physicsType;
  const notes: string[] = [...physicsNotes];
  const TIME_KEYS = ['time_history', 'times', 'time_steps', 'timesteps', 'history', 'time_series'];
  if (/transient|dynamic/i.test(typeLabel) && temperature && !TIME_KEYS.some((key) => key in nested)) {
    notes.push(
      `The simulation type is labelled "${typeLabel}", but the backend returned a single solved state (one ${temperature.cols} × ${temperature.rows} field and no time history${method ? `; method: ${method}` : ''}). Read the results as one state, not as a time evolution.`,
    );
  }
  const summary: string[] = [
    jobId
      ? `${PLATFORM_NAME} submitted a ${typeLabel} simulation as job ${jobId}; the backend job finished with status COMPLETED${processMs !== undefined ? ` after ${formatNumber(processMs / 1000)} s of solver time` : ''}.`
      : `${PLATFORM_NAME} ran a ${typeLabel} simulation in synchronous direct mode and received a successful result${processMs !== undefined ? ` after ${formatNumber(processMs / 1000)} s of solver time` : ''}.`,
  ];
  if (isThermal && conductivity !== undefined && widthM !== undefined && heightM !== undefined) {
    summary.push(`The domain is ${formatNumber(widthM)} m × ${formatNumber(heightM)} m with thermal conductivity k = ${formatNumber(conductivity)} W/(m·K)${meshSize !== undefined ? ` and mesh size ${formatNumber(meshSize)} m` : ''}.`);
  }
  if (temperature) {
    summary.push(`The solver returned a ${temperature.cols} × ${temperature.rows} temperature matrix ranging from ${formatNumber(temperature.min)} to ${formatNumber(temperature.max)} ${temperature.unit ?? ''}`.trim() + '.');
  }
  if (num(nested.center_temperature) !== undefined) summary.push(`Center-node temperature: ${formatNumber(num(nested.center_temperature)!)} ${tempUnitLabel}.`);
  if (reportedFlux !== undefined) summary.push(`Reported heat flux: ${formatNumber(reportedFlux)} ${prettyUnit(units.heat_flux) ?? 'W/m²'}.`);
  if (typeof conv?.converged === 'boolean') summary.push(`The backend reports the solution as ${conv.converged ? 'converged' : 'not converged'}${num(conv?.relative_residual) !== undefined ? ` (final relative residual ${formatNumber(num(conv!.relative_residual)!)})` : ''}.`);
  if (checks.length) summary.push(`${checks.filter((c) => c.passed).length} of ${checks.length} independent consistency checks passed (see Verification Checks).`);

  // --- Verification: real mesh-independence (GCI) study -----------------------------------------
  const meshStudy = isCurrentMeshStudy(project.meshStudyResult) && project.meshStudyResult.levels.length >= 3 ? project.meshStudyResult : undefined;
  if (meshStudy) {
    const unitText = meshStudy.key_result.unit ? ` (${meshStudy.key_result.unit})` : '';
    summary.push(
      `Mesh-independence study of ${meshStudy.key_result.label}${unitText} on ${meshStudy.levels.length} grids: ${meshStudyVerdict(meshStudy).text}`,
    );
  }

  // --- Validation: the real solver profile against user reference data ---------------------------
  let validation: RealReport['validation'];
  const reference = project.referenceData;
  if (reference && Array.isArray(reference.points) && reference.points.length > 0) {
    const evaluation = evaluateValidation(matrices, project.validationProfile, reference);
    const context = { reference, spec: evaluation.spec, fieldLabel: evaluation.field?.label, unit: evaluation.field?.unit };
    if (!evaluation.sampled) {
      validation = { ...context, error: 'The run returned no 2-D field to cut a profile from.' };
    } else if (!evaluation.sampled.ok) {
      validation = { ...context, error: evaluation.sampled.error };
    } else {
      validation = { ...context, profile: evaluation.sampled.profile, comparison: evaluation.comparison };
    }
    const comparison = validation.comparison;
    if (comparison && comparison.compared > 0) {
      summary.push(
        `Validation against ${comparison.compared} reference points ("${reference.label}") along ${validation.profile?.description.toLowerCase()}: ` +
          `RMSE ${formatNumber(comparison.rmse as number)}${validation.unit ? ` ${validation.unit}` : ''}` +
          (comparison.meanAbsPercent !== undefined ? `, mean absolute error ${formatNumber(comparison.meanAbsPercent)}% (max ${formatNumber(comparison.maxAbsPercent as number)}%)` : '') +
          (comparison.outOfRange ? `; ${comparison.outOfRange} reference point${comparison.outOfRange === 1 ? '' : 's'} fell outside the simulated cut and were not compared` : '') +
          '.',
      );
    } else {
      summary.push(
        `Reference data ("${reference.label}") was supplied but no point could be compared${validation.error ? `: ${validation.error}` : ' (none of its X values lie inside the simulated cut)'}.`,
      );
    }
  }

  return {
    platform: PLATFORM_NAME,
    assistant: AI_ASSISTANT_LABEL,
    title: project.title,
    titleEn: str(project.titleEn),
    field: project.field,
    preparedBy: identity(project.author),
    institution: identity(project.university),
    generatedAt: new Date().toISOString(),
    job,
    parameters,
    solver,
    mesh,
    results,
    matrices,
    checks,
    convergenceRows,
    convergenceStatement,
    series,
    provenance,
    logs: run.logs ?? [],
    errors,
    summary,
    notes,
    meshStudy,
    validation,
    simulationTypeLabel: typeLabel,
    jobId,
  };
}
