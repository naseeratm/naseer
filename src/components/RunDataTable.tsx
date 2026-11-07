import React from 'react';
import type { ReportRow } from '../utils/reportModel';

interface RunDataTableProps {
  title: string;
  rows: ReportRow[];
}

// Renders rows read from the stored backend run; nothing is padded or defaulted.
export const RunDataTable: React.FC<RunDataTableProps> = ({ title, rows }) => {
  if (rows.length === 0) return null;
  const hasNote = rows.some((row) => row.note);
  return (
    <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
      <h3 className="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-slate-800 text-left text-[10.5px] uppercase tracking-wide text-slate-500">
            <th className="px-3 py-1.5 font-medium">Quantity</th>
            <th className="px-3 py-1.5 font-medium">Value</th>
            <th className="px-3 py-1.5 font-medium">Unit</th>
            {hasNote && <th className="px-3 py-1.5 font-medium">Basis</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800/70">
          {rows.map((row, index) => (
            <tr key={`${row.label}-${index}`}>
              <td className="px-3 py-1.5 text-slate-300">{row.label}</td>
              <td className="break-all px-3 py-1.5 font-mono text-slate-100">{row.value}</td>
              <td className="px-3 py-1.5 text-slate-400">{row.unit ?? ''}</td>
              {hasNote && <td className="px-3 py-1.5 text-[11px] text-slate-500">{row.note ?? ''}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
