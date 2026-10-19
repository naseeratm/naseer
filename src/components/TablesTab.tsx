import React, { useState } from 'react';
import {
  Table as TableIcon,
  Copy,
  Check,
  Download,
  FileSpreadsheet,
  FileCode,
  Search,
} from 'lucide-react';
import { ThesisTable } from '../types/thesis';

interface TablesTabProps {
  tables: ThesisTable[];
}

export const TablesTab: React.FC<TablesTabProps> = ({ tables }) => {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [latexCopiedIdx, setLatexCopiedIdx] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');

  const copyMarkdown = (table: ThesisTable, idx: number) => {
    let md = `| ${table.headers.join(' | ')} |\n`;
    md += `| ${table.headers.map(() => '---').join(' | ')} |\n`;
    for (const row of table.rows) {
      md += `| ${row.join(' | ')} |\n`;
    }
    navigator.clipboard.writeText(md);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2500);
  };

  const copyLatex = (table: ThesisTable, idx: number) => {
    const colAlign = table.headers.map(() => 'c').join(' ');
    let tex = `\\begin{table}[htbp]\n\\centering\n\\caption{${table.caption}}\n\\begin{tabular}{${colAlign}}\n\\toprule\n`;
    tex += `${table.headers.join(' & ')} \\\\\n\\midrule\n`;
    for (const row of table.rows) {
      tex += `${row.join(' & ')} \\\\\n`;
    }
    tex += `\\bottomrule\n\\end{tabular}\n\\end{table}`;
    navigator.clipboard.writeText(tex);
    setLatexCopiedIdx(idx);
    setTimeout(() => setLatexCopiedIdx(null), 2500);
  };

  return (
    <div className="space-y-6">
      
      {/* Intro Header */}
      <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-6 shadow-xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
            <TableIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">
              جداول النتائج والمصفوفات الهندسية البارامترية (Engineering Data Matrices)
            </h2>
            <p className="text-xs text-slate-400">
              بيانات رقمية منسقة بدقة وفق المعايير الهندسية والصناعية مع إمكانية التصدير إلى Excel و LaTeX
            </p>
          </div>
        </div>

        {/* Search Filter */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-500 absolute right-3 top-2.5" />
          <input
            type="text"
            placeholder="بحث في الجداول..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pr-9 pl-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>

      {/* Tables Loop */}
      <div className="space-y-8">
        {tables.map((table, tIdx) => {
          const filteredRows = searchTerm
            ? table.rows.filter((r) =>
                r.some((cell) => String(cell).toLowerCase().includes(searchTerm.toLowerCase()))
              )
            : table.rows;

          return (
            <div
              key={tIdx}
              className="bg-slate-900/80 rounded-xl border border-slate-800 p-6 shadow-xl hover:border-slate-700 transition-colors"
            >
              {/* Table Top Controls */}
              <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                <div>
                  <h3 className="font-bold text-base text-white">{table.tableName}</h3>
                  <p className="text-xs text-slate-400 font-sans tracking-wide direction-ltr text-left mt-0.5">
                    {table.tableNameEn}
                  </p>
                  <p className="text-xs text-sky-400 mt-1 italic">{table.caption}</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyMarkdown(table, tIdx)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all"
                    title="نسخ بتنسيق Markdown"
                  >
                    {copiedIdx === tIdx ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">تم النسخ!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>نسخ Markdown</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => copyLatex(table, tIdx)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-all"
                    title="نسخ ككود جدول LaTeX"
                  >
                    {latexCopiedIdx === tIdx ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">تم كود LaTeX!</span>
                      </>
                    ) : (
                      <>
                        <FileCode className="w-3.5 h-3.5 text-amber-400" />
                        <span>نسخ كود LaTeX</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* The Rendered Academic Table */}
              <div className="overflow-x-auto rounded-lg border border-slate-800">
                <table className="w-full text-xs text-right">
                  <thead>
                    <tr className="bg-sky-950/70 border-b border-sky-800/60 text-sky-200">
                      {table.headers.map((header, hIdx) => (
                        <th key={hIdx} className="py-3 px-4 font-bold text-center">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredRows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className={
                          rIdx % 2 === 0
                            ? 'bg-slate-950/40 hover:bg-slate-800/40'
                            : 'bg-slate-900/40 hover:bg-slate-800/40'
                        }
                      >
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            className={`py-2.5 px-4 text-center font-mono ${
                              cIdx === 0
                                ? 'font-bold text-slate-200 font-sans'
                                : 'text-slate-300'
                            }`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredRows.length === 0 && (
                <div className="text-center py-6 text-slate-500 text-xs">
                  لا توجد نتائج مطابقة لبحثك في هذا الجدول.
                </div>
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
};
