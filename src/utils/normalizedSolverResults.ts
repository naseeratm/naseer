import { NormalizedSolverResult, ThesisProject } from '../types/thesis';

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

export function normalizeSolverResponse(payload: any, project: ThesisProject): NormalizedSolverResult {
  const nested = payload?.data?.solver_results ?? payload?.solver_results ?? payload?.data ?? payload ?? {};
  const type = String(payload?.simulation_type ?? nested?.simulation_type ?? project.field).toUpperCase();
  const physics = type.includes('CFD') || project.field === 'CFD'
    ? 'CFD'
    : type.includes('FEA') || type.includes('STRUCTURAL') || project.field === 'FEA'
      ? 'FEA'
      : 'Thermal';

  const fields = { ...payload, ...payload?.data, ...nested };
  const values: Record<string, number> = {};
  Object.entries(fields).forEach(([key, value]) => {
    const number = finiteNumber(value);
    if (number !== undefined) values[key] = number;
  });

  const history = nested?.convergence_history ?? nested?.residual_history ?? nested?.residuals ?? [];
  const residuals = Array.isArray(history)
    ? history.map((point: any, index: number) => ({
        iteration: finiteNumber(point?.iteration ?? point?.iter) ?? index,
        residual: finiteNumber(point?.residual ?? point?.value ?? point?.continuity) ?? 0,
      })).filter((point: { iteration: number; residual: number }) => finiteNumber(point.residual) !== undefined)
    : [];

  const contours = nested?.contours ?? nested?.fields ?? {};
  const matrix = (key: string): number[][] | undefined =>
    Array.isArray(contours[key])
      ? contours[key] as number[][] 
      : Array.isArray(fields[key]) ? fields[key] as number[][] : undefined;

  return {
    status: 'success',
    physics,
    solver: String(nested?.solver ?? payload?.solver ?? payload?.recommended_solver ?? 'Python deterministic solver'),
    simulationType: String(payload?.simulation_type ?? nested?.simulation_type ?? type),
    processTimeMs: finiteNumber(payload?.process_time_ms ?? payload?.process_time),
    converged: nested?.status ? String(nested.status).includes('CONVERGED') : true,
    values,
    fields,
    residuals,
    temperatureMatrix: matrix('temperature_matrix'),
    stressMatrix: matrix('von_mises_matrix'),
    velocityMatrix: matrix('velocity_magnitude'),
    displacementMatrix: matrix('displacement_matrix'),
    logs: Array.isArray(payload?.logs) ? payload.logs.map(String) : [],
  };
}
