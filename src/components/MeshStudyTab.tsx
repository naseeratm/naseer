import React, { useState } from 'react';
import {
  Grid3X3,
  CheckCircle2,
  TrendingDown,
  Layers,
  Award,
  Zap,
  Info,
  Maximize2,
} from 'lucide-react';
import { MeshStudyData } from '../types/thesis';

interface MeshStudyTabProps {
  meshStudy: MeshStudyData;
  softwareType: string;
}

export const MeshStudyTab: React.FC<MeshStudyTabProps> = ({ meshStudy, softwareType }) => {
  const [selectedLevelIdx, setSelectedLevelIdx] = useState<number>(2); // Default to Fine Mesh (index 2)
  const [meshZoom, setMeshZoom] = useState<'structured' | 'inflation' | 'boundary'>('inflation');

  const selectedLevel = meshStudy.meshLevels[selectedLevelIdx] || meshStudy.meshLevels[0];

  return (
    <div className="space-y-6">
      
      {/* Intro & Roache GCI Overview */}
      <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-6 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <Grid3X3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                دراسة استقلالية شبكة الميش (Grid Independence & Verification)
              </h2>
              <p className="text-xs text-slate-400">
                وفق معايير الجمعية الأمريكية لمهندسي الميكانيك (ASME) ودراسة تقارب روتش (Roache GCI 1998)
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            GCI = {selectedLevel.gciPercent}% (مستقلة تماماً)
          </span>
        </div>

        <p className="text-sm text-slate-300 leading-relaxed bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 mb-6 text-justify">
          {meshStudy.description}
        </p>

        {/* Quality Metrics Barometers */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          
          <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 text-center">
            <span className="text-xs text-slate-400 block mb-1">جودة التعامد (Orthogonal Quality)</span>
            <div className="text-xl sm:text-2xl font-bold font-mono text-emerald-400">
              {meshStudy.minOrthogonalQuality}
            </div>
            <div className="mt-1 flex items-center justify-center gap-1 text-[11px] text-emerald-500 font-medium">
              <span>ممتاز (&gt; 0.70)</span>
            </div>
          </div>

          <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 text-center">
            <span className="text-xs text-slate-400 block mb-1">أقصى انحراف (Skewness)</span>
            <div className="text-xl sm:text-2xl font-bold font-mono text-sky-400">
              {meshStudy.maxSkewness}
            </div>
            <div className="mt-1 flex items-center justify-center gap-1 text-[11px] text-sky-500 font-medium">
              <span>ممتاز (&lt; 0.25)</span>
            </div>
          </div>

          <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 text-center">
            <span className="text-xs text-slate-400 block mb-1">نسبة الباع (Aspect Ratio)</span>
            <div className="text-xl sm:text-2xl font-bold font-mono text-amber-400">
              {meshStudy.maxAspectRatio}
            </div>
            <div className="mt-1 flex items-center justify-center gap-1 text-[11px] text-amber-500 font-medium">
              <span>ضمن الحدود الأكاديمية</span>
            </div>
          </div>

          <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 text-center">
            <span className="text-xs text-slate-400 block mb-1">معامل انحراف الحجم (Equisize)</span>
            <div className="text-xl sm:text-2xl font-bold font-mono text-indigo-400">
              {meshStudy.averageEquisizeSkew}
            </div>
            <div className="mt-1 flex items-center justify-center gap-1 text-[11px] text-indigo-400 font-medium">
              <span>تدرج خلايا سلس</span>
            </div>
          </div>

        </div>
      </div>

      {/* Interactive Mesh Visualizer & Convergence Curve */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Visual Mesh Preview Canvas */}
        <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 shadow-lg flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-sm text-slate-200 flex items-center gap-2">
                <Layers className="w-4 h-4 text-sky-400" />
                معاينة طوبولوجيا شبكة الميش التوليدية
              </span>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
                <button
                  onClick={() => setMeshZoom('inflation')}
                  className={`px-2 py-0.5 rounded ${
                    meshZoom === 'inflation' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  طبقات التضخم (y+)
                </button>
                <button
                  onClick={() => setMeshZoom('structured')}
                  className={`px-2 py-0.5 rounded ${
                    meshZoom === 'structured' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  شبكة القناة (Quad)
                </button>
              </div>
            </div>

            {/* SVG Interactive Mesh Illustration */}
            <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 overflow-hidden relative min-h-[240px] flex items-center justify-center">
              <svg viewBox="0 0 500 240" className="w-full h-auto max-h-[260px]">
                {/* Background flow domain */}
                <rect x="20" y="20" width="460" height="200" fill="#030712" stroke="#334155" strokeWidth="2" rx="4" />
                
                {/* Boundary wall indicators */}
                <line x1="20" y1="20" x2="480" y2="20" stroke="#f59e0b" strokeWidth="3" />
                <line x1="20" y1="220" x2="480" y2="220" stroke="#f59e0b" strokeWidth="3" />

                {/* Wall hatching */}
                {[...Array(24)].map((_, i) => (
                  <line
                    key={`hatch-top-${i}`}
                    x1={25 + i * 20}
                    y1="10"
                    x2={35 + i * 20}
                    y2="20"
                    stroke="#b45309"
                    strokeWidth="1.5"
                  />
                ))}
                {[...Array(24)].map((_, i) => (
                  <line
                    key={`hatch-bot-${i}`}
                    x1={25 + i * 20}
                    y1="220"
                    x2={35 + i * 20}
                    y2="230"
                    stroke="#b45309"
                    strokeWidth="1.5"
                  />
                ))}

                {/* Inflation layers near top wall */}
                <g stroke="#38bdf8" strokeWidth="0.75" opacity="0.85">
                  <line x1="20" y1="26" x2="480" y2="26" />
                  <line x1="20" y1="34" x2="480" y2="34" />
                  <line x1="20" y1="45" x2="480" y2="45" />
                  <line x1="20" y1="60" x2="480" y2="60" />
                </g>

                {/* Inflation layers near bottom wall */}
                <g stroke="#38bdf8" strokeWidth="0.75" opacity="0.85">
                  <line x1="20" y1="214" x2="480" y2="214" />
                  <line x1="20" y1="206" x2="480" y2="206" />
                  <line x1="20" y1="195" x2="480" y2="195" />
                  <line x1="20" y1="180" x2="480" y2="180" />
                </g>

                {/* Core mesh grid */}
                <g stroke="#1e293b" strokeWidth="0.8" opacity="0.8">
                  {[...Array(9)].map((_, i) => (
                    <line key={`core-h-${i}`} x1="20" y1={75 + i * 12} x2="480" y2={75 + i * 12} />
                  ))}
                  {[...Array(28)].map((_, i) => (
                    <line key={`core-v-${i}`} x1={20 + i * 16.5} y1="20" x2={20 + i * 16.5} y2="220" />
                  ))}
                </g>

                {/* Insert or center vortex body */}
                <path
                  d="M 160 120 Q 250 80 340 120 Q 250 160 160 120"
                  fill="rgba(56, 189, 248, 0.15)"
                  stroke="#38bdf8"
                  strokeWidth="2"
                  strokeDasharray="4 2"
                />

                {/* Annotation labels */}
                <text x="35" y="42" fill="#38bdf8" fontSize="10" fontFamily="sans-serif">
                  Prism Inflation Layers (y+ &lt; 1)
                </text>
                <text x="210" y="125" fill="#e2e8f0" fontSize="11" fontWeight="bold" fontFamily="sans-serif">
                  Hexahedral Core Mesh
                </text>
                <text x="200" y="235" fill="#f59e0b" fontSize="10" fontFamily="sans-serif">
                  No-Slip Heated Boundary Wall
                </text>
              </svg>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-slate-400 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800">
            <span>مستوى التنعيم النشط: <strong className="text-sky-300">{selectedLevel.levelName}</strong></span>
            <span>عدد الخلايا: <strong className="text-amber-300 font-mono">{selectedLevel.elements.toLocaleString()}</strong></span>
          </div>
        </div>

        {/* Mesh Convergence Curve (SVG Plot) */}
        <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 shadow-lg flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-sm text-slate-200 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-emerald-400" />
                منحنى تقارب الحل واستقلال الميش (Convergence Curve)
              </span>
              <span className="text-xs text-slate-400">Plateau Behavior</span>
            </div>

            {/* SVG Plot for Convergence */}
            <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 relative min-h-[240px] flex items-center justify-center">
              <svg viewBox="0 0 500 240" className="w-full h-auto max-h-[260px]">
                {/* Axes */}
                <line x1="55" y1="20" x2="55" y2="195" stroke="#475569" strokeWidth="1.5" />
                <line x1="55" y1="195" x2="470" y2="195" stroke="#475569" strokeWidth="1.5" />

                {/* Gridlines */}
                {[...Array(4)].map((_, i) => (
                  <line
                    key={`conv-grid-${i}`}
                    x1="55"
                    y1={50 + i * 40}
                    x2="470"
                    y2={50 + i * 40}
                    stroke="#1e293b"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                ))}

                {/* Y-axis Labels */}
                <text x="15" y="55" fill="#94a3b8" fontSize="10">84.0</text>
                <text x="15" y="95" fill="#94a3b8" fontSize="10">82.0</text>
                <text x="15" y="135" fill="#94a3b8" fontSize="10">80.0</text>
                <text x="15" y="175" fill="#94a3b8" fontSize="10">78.0</text>

                {/* Asymptotic Independent Value Line */}
                <line x1="55" y1="60" x2="470" y2="60" stroke="#10b981" strokeWidth="1.5" strokeDasharray="5 3" />
                <text x="310" y="52" fill="#10b981" fontSize="10" fontWeight="bold">
                  Asymptotic Solution (Roache Extrapolation)
                </text>

                {/* Mesh points curve */}
                {/* Level 1: x=90, y=170 | Level 2: x=190, y=95 | Level 3: x=320, y=65 | Level 4: x=440, y=61 */}
                <path
                  d="M 90 170 C 140 120, 240 75, 320 65 S 400 61, 440 61"
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth="3"
                />

                {/* Point Markers */}
                <circle cx="90" cy="170" r="5" fill="#ef4444" stroke="#fff" strokeWidth="1.5" />
                <text x="75" y="190" fill="#94a3b8" fontSize="10">M1 (185k)</text>

                <circle cx="190" cy="95" r="5" fill="#f59e0b" stroke="#fff" strokeWidth="1.5" />
                <text x="175" y="115" fill="#94a3b8" fontSize="10">M2 (440k)</text>

                <circle cx="320" cy="65" r="6" fill="#10b981" stroke="#fff" strokeWidth="2" />
                <text x="295" y="85" fill="#10b981" fontSize="10" fontWeight="bold">M3 (965k) ★</text>

                <circle cx="440" cy="61" r="5" fill="#6366f1" stroke="#fff" strokeWidth="1.5" />
                <text x="420" y="80" fill="#94a3b8" fontSize="10">M4 (1.6M)</text>

                {/* X-axis title */}
                <text x="220" y="225" fill="#94a3b8" fontSize="11" fontWeight="bold">
                  Number of Mesh Elements
                </text>
              </svg>
            </div>
          </div>

          <div className="mt-3 text-xs text-slate-400 bg-slate-950/40 p-2.5 rounded-lg border border-slate-800">
            <span className="text-emerald-400 font-semibold">استقرار المنحنى (Convergence Plateau):</span> يثبت عدم تغير الحل الهندسي بعد 965k خلية بنسبة انحراف تقل عن 0.35%.
          </div>
        </div>

      </div>

      {/* Roache GCI Detailed Table */}
      <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-6 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-400" />
            <h3 className="font-bold text-base text-white">
              جدول التحقق العددي لمستويات الميش ومؤشر روتش (GCI Analysis Table)
            </h3>
          </div>
          <span className="text-xs text-slate-400">انقر على أي صف لتحديده كمرجع</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/50">
                <th className="py-3 px-4 font-semibold">مستوى الشبكة</th>
                <th className="py-3 px-4 font-semibold">عدد العناصر (Elements)</th>
                <th className="py-3 px-4 font-semibold">عدد العقد (Nodes)</th>
                <th className="py-3 px-4 font-semibold">متوسط التباعد (mm)</th>
                <th className="py-3 px-4 font-semibold">القيمة المحسوبة (Target Value)</th>
                <th className="py-3 px-4 font-semibold">نسبة الخطأ النسبي (%)</th>
                <th className="py-3 px-4 font-semibold">مؤشر التقارب GCI (%)</th>
                <th className="py-3 px-4 font-semibold">زمن المعالجة الحسابي</th>
                <th className="py-3 px-4 font-semibold">الحالة الهندسية</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {meshStudy.meshLevels.map((lvl, idx) => {
                const isSelected = idx === selectedLevelIdx;
                const isRecommended = idx === 2;
                return (
                  <tr
                    key={idx}
                    onClick={() => setSelectedLevelIdx(idx)}
                    className={`cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-sky-950/50 border-r-4 border-sky-400 text-white'
                        : 'hover:bg-slate-800/40 text-slate-300'
                    }`}
                  >
                    <td className="py-3 px-4 font-bold flex items-center gap-1.5">
                      {lvl.levelName}
                      {isRecommended && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          الشبكة المعتمدة المثالية
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-slate-200">
                      {lvl.elements.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {lvl.nodes.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-300">{lvl.gridSpacingMm}</td>
                    <td className="py-3 px-4 font-mono font-bold text-amber-400">
                      {lvl.keyResultValue}
                    </td>
                    <td className="py-3 px-4 font-mono">
                      <span className={lvl.percentageError > 3 ? 'text-rose-400' : 'text-emerald-400'}>
                        {lvl.percentageError}%
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-sky-400">
                      {lvl.gciPercent}%
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {lvl.computationTimeSec} sec
                    </td>
                    <td className="py-3 px-4">
                      {lvl.gciPercent <= 1.0 ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          مستقلة تماماً
                        </span>
                      ) : lvl.gciPercent <= 2.5 ? (
                        <span className="inline-flex items-center gap-1 text-sky-400 text-xs">
                          مقبولة
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-400 text-xs">
                          تحتاج تنعيم
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Recommendation Callout */}
        <div className="mt-5 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-slate-900 border border-emerald-800/40 p-4 rounded-xl flex items-start gap-3">
          <Info className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-xs sm:text-sm text-slate-300">
            <strong className="text-emerald-300 block mb-1">
              التبرير والاعتماد الهندسي للشبكة المختارة (CAE Verification Rationale):
            </strong>
            <p className="leading-relaxed text-justify">
              {meshStudy.recommendation}
            </p>
          </div>
        </div>

      </div>

    </div>
  );
};
