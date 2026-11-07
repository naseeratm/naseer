import { MeshStudyResult } from '../types/thesis';
import { formatNumber } from './numberFormat';

export type VerdictTone = 'good' | 'warn' | 'bad';

// One wording of the mesh-study outcome, shared by the on-screen tab and the exported reports.
export function meshStudyVerdict(study: MeshStudyResult): { tone: VerdictTone; text: string } {
  const gci = study.gci_fine_percent === null ? '—' : formatNumber(study.gci_fine_percent);
  switch (study.convergence_type) {
    case 'converged':
      return { tone: 'good', text: 'The key result agrees on the compared grids to floating-point precision: mesh independent.' };
    case 'monotonic':
      return study.grid_independent
        ? { tone: 'good', text: `Grid-independent: GCI (fine) = ${gci}% is within the ${study.gci_threshold_percent}% threshold.` }
        : { tone: 'warn', text: `Not yet grid-independent: GCI (fine) = ${gci}% exceeds the ${study.gci_threshold_percent}% threshold.` };
    case 'oscillatory':
      return { tone: 'warn', text: 'Oscillatory convergence: the GCI is indicative only, so no verdict is given.' };
    case 'divergent':
      return { tone: 'bad', text: 'The key result does not converge with refinement, so no GCI is reported and the mesh cannot be called independent.' };
    default:
      return { tone: 'warn', text: 'The convergence behaviour could not be determined from these three grids.' };
  }
}
