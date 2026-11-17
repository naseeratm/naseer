import { NormalizedSolverResult, ThesisProject, VtkFieldPayload } from '../types/thesis';

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const toVtkFieldPayload = (candidate: unknown): VtkFieldPayload | undefined => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  const obj = candidate as Record<string, unknown>;
  if (!Array.isArray(obj.points) || obj.points.length < 9 || !Array.isArray(obj.triangles) || obj.triangles.length < 3) {
    return undefined;
  }
  if (Array.isArray(obj.time_frames)) {
    const cleanFrames = obj.time_frames.filter(
      (f): f is Record<string, unknown> =>
        Boolean(f) &&
        typeof f === 'object' &&
        typeof (f as Record<string, unknown>).time === 'number' &&
        Number.isFinite((f as Record<string, unknown>).time) &&
        Boolean((f as Record<string, unknown>).scalars) &&
        typeof (f as Record<string, unknown>).scalars === 'object',
    );
    return { ...(obj as Record<string, unknown>), time_frames: cleanFrames } as unknown as VtkFieldPayload;
  }
  return obj as unknown as VtkFieldPayload;
};

export function normalizeSolverResponse(payload: any, project: ThesisProject): NormalizedSolverResult {
  const nested = payload?.data?.solver_results ?? payload?.solver_results ?? payload?.data ?? payload ?? {};
  const type = String(payload?.physics_type ?? payload?.simulation_type ?? nested?.simulation_type ?? project.field).toUpperCase();

  let physics = 'Thermal';
  if (type.includes('CHT')) physics = 'CHT';
  else if (type.includes('VOF') || type.includes('MULTIPHASE')) physics = 'Multiphase_VOF';
  else if (type.includes('THERMAL_STRUCTURAL')) physics = 'Thermal_Structural';
  else if (type.includes('CFD') || project.field === 'CFD') physics = 'CFD';
  else if (type.includes('FEA') || type.includes('STRUCTURAL') || project.field === 'FEA') physics = 'FEA';
  else if (type.includes('ELECTROMAGNETIC')) physics = 'Electromagnetic';
  else if (type.includes('ACOUSTICS')) physics = 'Acoustics';

  const fields = { ...payload, ...payload?.data, ...nested };
  const values: Record<string, number> = {};
  Object.entries(fields).forEach(([key, value]) => {
    const number = finiteNumber(value);
    if (number !== undefined) values[key] = number;
  });

  if (nested?.field_summary && typeof nested.field_summary === 'object') {
    const fmin = finiteNumber(nested.field_summary.min);
    const fmax = finiteNumber(nested.field_summary.max);
    if (fmin !== undefined) values.field_min = fmin;
    if (fmax !== undefined) values.field_max = fmax;
  }

  const history = nested?.convergence_history ?? nested?.residual_history ?? nested?.residuals ?? [];
  const residuals = Array.isArray(history)
    ? history
        .map((point: any, index: number) => ({
          iteration: finiteNumber(point?.iteration ?? point?.iter) ?? index,
          residual: finiteNumber(point?.residual ?? point?.value ?? point?.continuity) ?? 0,
        }))
        .filter((point: { iteration: number; residual: number }) => finiteNumber(point.residual) !== undefined)
    : [];

  const toSeriesPoints = (seriesValues: unknown): { iteration: number; value: number }[] =>
    Array.isArray(seriesValues)
      ? seriesValues
          .map((value, index) => ({ iteration: index + 1, value: finiteNumber(value) }))
          .filter((point): point is { iteration: number; value: number } => point.value !== undefined)
      : [];
  const residualMapping = [nested?.convergence?.residuals, nested?.residuals].find(
    (candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate),
  );
  let residualSeries: { name: string; points: { iteration: number; value: number }[] }[] = residualMapping
    ? Object.entries(residualMapping as Record<string, any>)
        .map(([name, entry]) => ({
          name,
          points: toSeriesPoints(Array.isArray(entry) ? entry : entry?.values),
        }))
        .filter((series) => series.points.length > 0)
    : [];
  if (residualSeries.length === 0 && residuals.length > 0) {
    residualSeries = [
      { name: 'residual', points: residuals.map((point) => ({ iteration: point.iteration, value: point.residual })) },
    ];
  }

  const contours = nested?.contours ?? nested?.fields ?? {};
  const matrix = (key: string): number[][] | undefined =>
    Array.isArray(contours[key])
      ? (contours[key] as number[][])
      : Array.isArray(fields[key])
        ? (fields[key] as number[][])
        : undefined;

  const vtkData =
    toVtkFieldPayload(payload?.vtk_data) ??
    toVtkFieldPayload(nested?.vtk_data) ??
    toVtkFieldPayload(fields?.vtk_data);

  const rawIntegrals =
    nested?.integrals ?? payload?.data?.integrals ?? payload?.integrals ?? fields?.integrals;
  let integrals: Record<string, number | string> | undefined;
  if (rawIntegrals && typeof rawIntegrals === 'object' && !Array.isArray(rawIntegrals)) {
    const clean: Record<string, number | string> = {};
    Object.entries(rawIntegrals as Record<string, unknown>).forEach(([k, v]) => {
      if ((typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.trim() !== '')) {
        clean[k] = v;
      }
    });
    if (Object.keys(clean).length > 0) integrals = clean;
  }

  return {
    status: 'success',
    physics,
    solver: String(nested?.solver ?? payload?.solver ?? payload?.recommended_solver ?? 'Docker CAE Solver'),
    simulationType: String(payload?.physics_type ?? payload?.simulation_type ?? nested?.simulation_type ?? type),
    processTimeMs: finiteNumber(payload?.process_time_ms ?? payload?.process_time),
    converged:
      typeof nested?.convergence?.converged === 'boolean'
        ? nested.convergence.converged
        : nested?.status
          ? !String(nested.status).toLowerCase().includes('fail') && !String(nested.status).toLowerCase().includes('error')
          : true,
    values,
    fields,
    residuals,
    residualSeries,
    temperatureMatrix: matrix('temperature_matrix'),
    stressMatrix: matrix('von_mises_matrix'),
    velocityMatrix: matrix('velocity_magnitude'),
    displacementMatrix: matrix('displacement_matrix'),
    vtkData,
    integrals,
    logs: Array.isArray(payload?.logs) ? payload.logs.map(String) : [],
  };
}
