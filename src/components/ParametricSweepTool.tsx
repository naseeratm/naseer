import React, { useState } from 'react';
import {
  X,
  Sliders,
  Play,
  TrendingUp,
  BarChart3,
  CheckCircle2,
  Table as TableIcon,
  Download,
  Sparkles,
  Zap,
  RotateCcw,
} from 'lucide-react';
import { ThesisProject } from '../types/thesis';

interface DesignPointItem {
  dpId: string; // DP-0, DP-1, DP-2...
  paramVal: number;
  paramLabel: string;
  outputVal1: number; // e.g. Max Stress or Drag Force
  outputLabel1: string;
  outputVal2: number; // e.g. Deflection or Lift/Drag Ratio
  outputLabel2: string;
  status: 'Converged' | 'Optimal' | 'Feasible' | 'Unstable';
}

interface ParametricSweepToolProps {
  isOpen: boolean;
  onClose: () => void;
  currentProject: ThesisProject | null;
}

export const ParametricSweepTool: React.FC<ParametricSweepToolProps> = ({
  isOpen,
  onClose,
  currentProject,
}) => {
  const isFEA = currentProject?.field === 'FEA';
  const isThermal = currentProject?.field === 'Thermal';

  // Parametric Sweep Configuration
  const [paramName, setParamName] = useState<string>(
    isFEA ? 'Applied Force Load (الحمولة المطبقة P)' : isThermal ? 'Fin Plate Count (عدد الزعانف)' : 'Inlet Velocity (سرعة التدفق V)'
  );
  const [unit, setUnit] = useState<string>(isFEA ? 'kN' : isThermal ? 'plates' : 'm/s');
  const [minVal, setMinVal] = useState<number>(isFEA ? 10 : isThermal ? 50 : 5);
  const [maxVal, setMaxVal] = useState<number>(isFEA ? 100 : isThermal ? 250 : 50);
  const [steps, setSteps] = useState<number>(5);
  const [isSweeping, setIsSweeping] = useState<boolean>(false);
  const [designPoints, setDesignPoints] = useState<DesignPointItem[]>([]);

  if (!isOpen) return null;

  const handleRunParametricSweep = () => {
    setIsSweeping(true);

    setTimeout(() => {
      const generated: DesignPointItem[] = [];
      const stepSize = (maxVal - minVal) / Math.max(1, steps - 1);

      for (let i = 0; i < steps; i++) {
        const val = Number((minVal + i * stepSize).toFixed(2));
        let out1 = 0;
        let outLabel1 = '';
        let out2 = 0;
        let outLabel2 = '';
        let status: 'Converged' | 'Optimal' | 'Feasible' | 'Unstable' = 'Converged';

        if (isFEA) {
          // FEA: Force vs Von Mises Stress and Deflection
          outLabel1 = 'أقصى إجهاد فون ميسيس (Von Mises Stress)';
          out1 = Number((val * 4.8 + Math.random() * 2).toFixed(2)); // MPa
          outLabel2 = 'سهم التشوه المرن الأقصى (Max Deflection)';
          out2 = Number((val * 0.22).toFixed(3)); // mm
          if (out1 > 250) status = 'Unstable'; // Exceeds yield
          else if (out1 > 180) status = 'Feasible';
          else status = 'Optimal';
        } else if (isThermal) {
          // Thermal: Fin Count vs Melting Time and Storage Efficiency
          outLabel1 = 'زمن الانصهار الكامل 95% (t95 Melting Time)';
          out1 = Number((6.2 / (1 + val * 0.008)).toFixed(3)); // Hours
          outLabel2 = 'كفاءة نقل الحرارة الكلية (Thermal Efficiency)';
          out2 = Number((52 + val * 0.12).toFixed(2)); // %
          if (val > 180) status = 'Optimal';
          else status = 'Converged';
        } else {
          // CFD: Velocity vs Drag Force and Lift/Drag Ratio
          outLabel1 = 'قوة الإعاقة الهيدروديناميكية (Drag Force)';
          out1 = Number((0.5 * 1.225 * val * val * 0.08).toFixed(2)); // N
          outLabel2 = 'معامل الرفع/الإعاقة (L/D Efficiency Ratio)';
          out2 = Number((45 - (val - 20) * 0.4).toFixed(2));
          if (val > 40) status = 'Feasible';
          else status = 'Optimal';
        }

        generated.push({
          dpId: `DP-${i}`,
          paramVal: val,
          paramLabel: `${val} ${unit}`,
          outputVal1: out1,
          outputLabel1: outLabel1,
          outputVal2: out2,
          outputLabel2: outLabel2,
          status,
        });
      }

      setDesignPoints(generated);
      setIsSweeping(false);
    }, 600);
  };

  const handleExportCSV = () => {
    if (designPoints.length === 0) return;
    const headers = [`Design Point`, `${paramName} (${unit})`, designPoints[0].outputLabel1, designPoints[0].outputLabel2, `Status`].join(',');
    const rows = designPoints.map((dp) => [dp.dpId, dp.paramVal, dp.outputVal1, dp.outputVal2, dp.status].join(','));
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `parametric_sweep_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/90 gap-4">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-950/50">
              <Sliders className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg sm:text-xl font-bold text-slate-100">
                  أداة مسح المتغيرات وحساب سطوح الاستجابة (Parametric Sweep Tool)
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Response Surface Optimization
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                دراسة استجابة المنظومة الهندسية عند تغيير المتغيرات الحدودية واستخراج القيمة المثلى للحل تلقائياً
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Setup Toolbar */}
        <div className="p-6 bg-slate-950/60 border-b border-slate-800/80 space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <label className="text-[11px] text-slate-400 font-semibold block">المتغير المستقل المراد مسحه (Input Parameter):</label>
              <input
                type="text"
                value={paramName}
                onChange={(e) => setParamName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-semibold block">وحدة القياس (Unit):</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 font-mono text-sky-400 text-xs focus:outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 font-semibold block">عدد نقاط التصميم (Steps):</label>
              <input
                type="number"
                min={3}
                max={15}
                value={steps}
                onChange={(e) => setSteps(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 font-mono text-white text-xs focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="flex items-center gap-3">
              <div className="space-y-1">
                <span className="text-[11px] text-slate-400 block">الحد الأدنى ({unit}):</span>
                <input
                  type="number"
                  value={minVal}
                  onChange={(e) => setMinVal(Number(e.target.value))}
                  className="w-24 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 font-mono text-xs text-white"
                />
              </div>

              <span className="text-slate-500 font-bold self-end pb-2">← إلى →</span>

              <div className="space-y-1">
                <span className="text-[11px] text-slate-400 block">الحد الأقصى ({unit}):</span>
                <input
                  type="number"
                  value={maxVal}
                  onChange={(e) => setMaxVal(Number(e.target.value))}
                  className="w-24 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 font-mono text-xs text-white"
                />
              </div>
            </div>

            <button
              type="button"
              disabled={isSweeping}
              onClick={handleRunParametricSweep}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 text-white font-bold text-xs shadow-lg shadow-indigo-950/50 flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
            >
              {isSweeping ? <Sliders className="w-4 h-4 animate-spin text-sky-200" /> : <Play className="w-4 h-4 fill-current" />}
              <span>{isSweeping ? 'جاري حساب المسح المتعدد...' : 'تشغيل المسح الحسابي'}</span>
            </button>
          </div>
        </div>

        {/* Results & Design Points Table */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-xs">
          {designPoints.length === 0 ? (
            <div className="text-center py-12 text-slate-400 space-y-3">
              <BarChart3 className="w-12 h-12 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-300">لم يتم تشغيل أي مسح بارامتري بعد</p>
              <p className="text-xs text-slate-500">حدد نطاق المتغير واضغط "تشغيل المسح الحسابي" لحساب مصفوفة الاستجابة فورياً</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-200 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  جدول نقاط التصميم ومخرجات الاستجابة (Design Points Matrix):
                </span>

                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-400 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>تصدير النتائج (CSV)</span>
                </button>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-800 shadow-md">
                <table className="w-full text-xs text-right">
                  <thead>
                    <tr className="bg-slate-950 text-slate-400 border-b border-slate-800 font-mono">
                      <th className="py-2.5 px-3">Design Point</th>
                      <th className="py-2.5 px-3">{paramName} ({unit})</th>
                      <th className="py-2.5 px-3 text-sky-300">{designPoints[0]?.outputLabel1}</th>
                      <th className="py-2.5 px-3 text-emerald-300">{designPoints[0]?.outputLabel2}</th>
                      <th className="py-2.5 px-3">الحالة والتقييم</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-950/60 font-mono">
                    {designPoints.map((dp) => (
                      <tr key={dp.dpId} className="hover:bg-slate-900/60">
                        <td className="py-2.5 px-3 font-bold text-slate-200">{dp.dpId}</td>
                        <td className="py-2.5 px-3 text-amber-400 font-bold">{dp.paramLabel}</td>
                        <td className="py-2.5 px-3 text-sky-400 font-bold">{dp.outputVal1}</td>
                        <td className="py-2.5 px-3 text-emerald-400 font-bold">{dp.outputVal2}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              dp.status === 'Optimal'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : dp.status === 'Feasible'
                                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                                : dp.status === 'Unstable'
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                : 'bg-slate-800 text-slate-300'
                            }`}
                          >
                            {dp.status === 'Optimal' ? 'النقاط المثلى (Optimal)' : dp.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Graphical Surface Preview */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-2">
                <span className="text-[11px] font-semibold text-slate-400 block">معاينة منحنى الاستجابة (Response Surface Curve):</span>
                <div className="h-28 w-full bg-slate-900 rounded-xl border border-slate-800/80 p-3 flex items-end justify-between gap-2">
                  {designPoints.map((dp, i) => {
                    const maxOut = Math.max(...designPoints.map((d) => d.outputVal1));
                    const heightPct = Math.max(15, (dp.outputVal1 / Math.max(1, maxOut)) * 100);
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                        <span className="text-[9px] font-mono text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity">
                          {dp.outputVal1}
                        </span>
                        <div
                          className="w-full rounded-t bg-gradient-to-t from-indigo-600 to-sky-400 transition-all group-hover:bg-sky-300"
                          style={{ height: `${heightPct}%` }}
                        />
                        <span className="text-[9px] font-mono text-slate-500">{dp.paramVal}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
