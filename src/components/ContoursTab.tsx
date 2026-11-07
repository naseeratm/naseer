import React, { useMemo } from 'react';
import { Palette } from 'lucide-react';
import { ThesisProject } from '../types/thesis';
import { buildRealReport, hasRealSimulationRun, renderMatrixToImage } from '../utils/exporter';
import { EmptyState } from './EmptyState';

interface ContoursTabProps {
  project: ThesisProject;
}

const formatValue = (value: number) => (Number.isFinite(value) ? String(Number(value.toPrecision(7))) : '—');

// Contours come exclusively from 2-D fields the solver returned for the completed run.
export const ContoursTab: React.FC<ContoursTabProps> = ({ project }) => {
  const fields = useMemo(() => {
    if (!hasRealSimulationRun(project)) return null;
    return buildRealReport(project).matrices.map((matrix) => ({ matrix, image: renderMatrixToImage(matrix) }));
  }, [project]);

  if (!fields) {
    return <EmptyState icon={Palette} message="No data available. Please run a simulation to view Contours." />;
  }
  if (fields.length === 0) {
    return (
      <EmptyState
        icon={Palette}
        title="No contour fields in this run"
        message="The completed simulation did not return a 2-D scalar field to contour."
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      {fields.map(({ matrix, image }) => (
        <section key={matrix.key} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
          <h3 className="border-b border-slate-800 px-3 py-2 text-[12px] font-semibold text-slate-200">{matrix.label}</h3>
          <div className="flex flex-wrap items-start gap-5 p-4">
            {image ? (
              <img src={image.src} width={image.width} height={image.height} alt={matrix.label} className="max-w-full rounded border border-slate-700 bg-white" />
            ) : (
              <p className="text-[12px] italic text-slate-500">The field could not be rendered in this environment.</p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
              <dt className="text-slate-500">Grid (x × y)</dt>
              <dd className="font-mono text-slate-200">{matrix.cols} × {matrix.rows} nodes</dd>
              <dt className="text-slate-500">Minimum</dt>
              <dd className="font-mono text-slate-200">{formatValue(matrix.min)} {matrix.unit}</dd>
              <dt className="text-slate-500">Maximum</dt>
              <dd className="font-mono text-slate-200">{formatValue(matrix.max)} {matrix.unit}</dd>
              <dt className="text-slate-500">Mean</dt>
              <dd className="font-mono text-slate-200">{formatValue(matrix.mean)} {matrix.unit}</dd>
            </dl>
          </div>
        </section>
      ))}
    </div>
  );
};
