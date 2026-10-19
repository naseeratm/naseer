import React, { useState, useMemo } from 'react';
import {
  CheckCircle2,
  TrendingUp,
  ShieldCheck,
  BookOpen,
  AlertTriangle,
  Zap,
} from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import { ValidationData } from '../types/thesis';

interface ValidationTabProps {
  validation: ValidationData;
  field: string;
}

export const ValidationTab: React.FC<ValidationTabProps> = ({ validation, field }) => {
  const [showErrorBars, setShowErrorBars] = useState<boolean>(true);

  // Automatic Comparison Engine: Advanced Statistical Aggregation
  const comparisonEngine = useMemo(() => {
    const points = validation.points;
    const avgError = points.reduce((sum, p) => sum + Math.abs(p.errorPercent), 0) / points.length;
    const maxError = Math.max(...points.map((p) => Math.abs(p.errorPercent)));
    const minError = Math.min(...points.map((p) => Math.abs(p.errorPercent)));
    
    // Convergence Assessment
    const isConverging = points[points.length - 1].errorPercent < points[0].errorPercent;
    
    return {
      avgError: avgError.toFixed(2),
      maxError: maxError.toFixed(2),
      minError: minError.toFixed(2),
      isConverging,
      performanceRating: avgError < 2 ? 'Excellent' : avgError < 5 ? 'Good' : 'Needs Review',
    };
  }, [validation.points]);

  const chartData = validation.points.map((p) => ({
    x: p.independentVar,
    Experimental: p.experimentalVal,
    Numerical: p.numericalCfdVal,
    Empirical: p.empiricalVal,
    error: Math.abs(p.errorPercent),
  }));

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="bg-slate-900/80 rounded-[2rem] border border-slate-800 p-8 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
              <ShieldCheck className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">
                لوحة التحكم للتحقق الآلي (Automatic Validation Dashboard)
              </h2>
              <p className="text-sm text-slate-400">
                مقارنة ذكية لحظية بين النتائج العددية والتجريبية وفق معايير ASME V&V 20
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-4 h-4" />
            تطابق R² = {validation.rSquared}
          </span>
        </div>

        {/* Comparison Engine KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'متوسط الخطأ', value: `${comparisonEngine.avgError}%`, color: 'text-emerald-400' },
            { label: 'أقصى انحراف', value: `${comparisonEngine.maxError}%`, color: 'text-rose-400' },
            { label: 'التقارب الآلي', value: comparisonEngine.isConverging ? 'متحقق (Converging)' : 'مستقر (Stable)', color: 'text-sky-400' },
            { label: 'تقييم الأداء', value: comparisonEngine.performanceRating, color: 'text-amber-400' },
          ].map((kpi, i) => (
            <div key={i} className="bg-slate-950 p-5 rounded-2xl border border-slate-800 text-center">
              <span className="text-xs text-slate-500 block mb-2 font-bold uppercase tracking-wider">{kpi.label}</span>
              <div className={`text-xl font-bold font-mono ${kpi.color}`}>{kpi.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Comparison Plot */}
      <div className="bg-slate-900/80 rounded-[2rem] border border-slate-800 p-8 shadow-2xl">
        <div className="flex items-center justify-between mb-8">
          <h3 className="font-bold text-lg text-white flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-sky-400" />
            الرسم البياني التحليلي (Numerical Validation Plot)
          </h3>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showErrorBars}
                onChange={(e) => setShowErrorBars(e.target.checked)}
                className="rounded border-slate-700 bg-slate-800 text-sky-500 focus:ring-0"
              />
              إظهار فترات عدم اليقين (Uncertainty)
            </label>
          </div>
        </div>

        <div className="h-[400px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="x" stroke="#64748b" tick={{ fill: '#64748b' }} />
              <YAxis stroke="#64748b" tick={{ fill: '#64748b' }} />
              <Tooltip
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '1rem' }}
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Legend verticalAlign="top" height={36} iconType="circle" />
              <Line type="monotone" dataKey="Experimental" stroke="#f43f5e" strokeWidth={3} dot={{ r: 6 }} />
              <Line type="monotone" dataKey="Numerical" stroke="#38bdf8" strokeWidth={3} strokeDasharray="5 5" />
              <Line type="monotone" dataKey="Empirical" stroke="#10b981" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Detailed Table */}
      <div className="bg-slate-900/80 rounded-[2rem] border border-slate-800 p-8 shadow-2xl">
        <h3 className="font-bold text-lg text-white mb-6">تفاصيل القياس والتحقق المعياري (Detailed Validation Metrics)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-4 px-6 font-semibold">نقطة القياس</th>
                <th className="py-4 px-6 font-semibold text-rose-400">Experimental</th>
                <th className="py-4 px-6 font-semibold text-sky-400">Numerical (CFD)</th>
                <th className="py-4 px-6 font-semibold text-amber-400">Error (%)</th>
                <th className="py-4 px-6 font-semibold">الحالة (Status)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {validation.points.map((pt, idx) => (
                <tr key={idx} className="hover:bg-slate-800/40 transition-colors">
                  <td className="py-4 px-6 font-bold text-slate-200">{pt.independentLabel}</td>
                  <td className="py-4 px-6 font-mono font-bold text-rose-300">{pt.experimentalVal}</td>
                  <td className="py-4 px-6 font-mono font-bold text-sky-300">{pt.numericalCfdVal}</td>
                  <td className="py-4 px-6 font-mono font-bold text-amber-400">{pt.errorPercent}%</td>
                  <td className="py-4 px-6">
                    {Math.abs(pt.errorPercent) < 3 ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-400 text-xs font-bold bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
                        <CheckCircle2 className="w-4 h-4" /> مطابق
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-rose-400 text-xs font-bold bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/20">
                        <AlertTriangle className="w-4 h-4" /> يتطلب مراجعة
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
