import React, { useMemo } from 'react';
import { Table as TableIcon } from 'lucide-react';
import { ThesisProject } from '../types/thesis';
import { buildRealReport, hasRealSimulationRun } from '../utils/exporter';
import { EmptyState } from './EmptyState';
import { RunDataTable } from './RunDataTable';

interface TablesTabProps {
  project: ThesisProject;
}

// Every table is built from the stored backend run (parameters, results, convergence, provenance).
export const TablesTab: React.FC<TablesTabProps> = ({ project }) => {
  const report = useMemo(() => (hasRealSimulationRun(project) ? buildRealReport(project) : null), [project]);

  if (!report) {
    return <EmptyState icon={TableIcon} message="No data available. Please run a simulation to view Tables." />;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <RunDataTable title="Simulation parameters" rows={report.parameters} />
      <RunDataTable title="Solver and mesh" rows={[...report.solver, ...report.mesh]} />
      <RunDataTable title="Results" rows={report.results} />
      <RunDataTable title="Convergence" rows={report.convergenceRows} />
      <RunDataTable title="Provenance" rows={[...report.job, ...report.provenance]} />
    </div>
  );
};
