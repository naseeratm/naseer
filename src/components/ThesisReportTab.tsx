import React, { useMemo, useState } from 'react';
import { AlertTriangle, FileCode, FileSpreadsheet, FileText, Globe, Printer, FileX } from 'lucide-react';
import { ThesisProject } from '../types/thesis';
import {
  REPORT_CSS,
  buildInlineAssets,
  buildRealReport,
  exportToCSV,
  exportToJournalHTML,
  exportToLatex,
  exportToWordDocument,
  hasRealSimulationRun,
  renderReportBody,
} from '../utils/exporter';

interface ThesisReportTabProps {
  project: ThesisProject;
  onPrint: () => void;
}

const buttonBase =
  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40';

// The report shown (and printed) here is rendered by the same code as the exported Word/HTML files,
// from the stored backend run only.
export const ThesisReportTab: React.FC<ThesisReportTabProps> = ({ project, onPrint }) => {
  const [exportError, setExportError] = useState<string | null>(null);
  const hasRun = hasRealSimulationRun(project);

  const reportHtml = useMemo(() => {
    if (!hasRealSimulationRun(project)) return null;
    const report = buildRealReport(project);
    return renderReportBody(report, buildInlineAssets(report));
  }, [project]);

  const runExport = async (action: () => void | Promise<void>) => {
    setExportError(null);
    try {
      await action();
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Export failed');
    }
  };

  return (
    <div dir="ltr" className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-900/80 px-4 py-3 print:hidden">
        <div>
          <h2 className="text-[13px] font-semibold text-slate-100">Simulation Report</h2>
          <p className="text-[11px] text-slate-400">
            Built from the completed backend job only — no templates, presets or placeholder values.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={onPrint} disabled={!hasRun} className={`${buttonBase} bg-amber-500 text-slate-950 hover:bg-amber-400`}>
            <Printer className="h-3.5 w-3.5" /> Print / PDF
          </button>
          <button onClick={() => runExport(() => exportToWordDocument(project))} disabled={!hasRun} className={`${buttonBase} bg-sky-600 text-white hover:bg-sky-500`}>
            <FileText className="h-3.5 w-3.5" /> Word (.doc)
          </button>
          <button onClick={() => runExport(() => exportToJournalHTML(project))} disabled={!hasRun} className={`${buttonBase} bg-indigo-600 text-white hover:bg-indigo-500`}>
            <Globe className="h-3.5 w-3.5" /> HTML
          </button>
          <button onClick={() => runExport(() => exportToLatex(project))} disabled={!hasRun} className={`${buttonBase} border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700`}>
            <FileCode className="h-3.5 w-3.5" /> LaTeX
          </button>
          <button onClick={() => runExport(() => exportToCSV(project))} disabled={!hasRun} className={`${buttonBase} bg-emerald-700 text-white hover:bg-emerald-600`}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
          </button>
        </div>
      </div>

      {exportError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-[12px] text-red-200 print:hidden">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="whitespace-pre-wrap break-words">{exportError}</span>
        </div>
      )}

      {reportHtml ? (
        <>
          <style>{REPORT_CSS}</style>
          <div
            className="rounded-lg bg-white px-10 py-9 shadow-2xl shadow-black/40 print:rounded-none print:p-0 print:shadow-none"
            dangerouslySetInnerHTML={{ __html: reportHtml }}
          />
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-700 bg-slate-900/50 px-6 py-14 text-center">
          <FileX className="h-7 w-7 text-slate-600" />
          <p className="text-[13px] font-medium text-slate-300">No completed simulation run for this project</p>
          <p className="max-w-md text-[11.5px] text-slate-500">
            Run a simulation from the header. When the backend job completes, this report is generated from its real parameters,
            results, convergence data and logs.
          </p>
        </div>
      )}
    </div>
  );
};
