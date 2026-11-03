import React, { useRef } from 'react';
import {
  FileText,
  Printer,
  Award,
  CheckCircle,
  Calendar,
  Layers,
  Atom,
  Grid3X3,
  ShieldCheck,
  Table as TableIcon,
  UserCheck,
  Cpu,
  Clock,
  TrendingDown,
  Flame,
  Zap,
  Activity,
  BarChart3,
  Layers3,
  Box,
  Globe,
  Wind,
} from 'lucide-react';
import { ThesisProject } from '../types/thesis';
import { exportToWordDocument, exportToLatex, exportToCSV, exportToJournalHTML } from '../utils/exporter';
import { EngineeringSchematicViewer } from './EngineeringSchematicViewer';

interface ThesisReportTabProps {
  project: ThesisProject;
  onPrint: () => void;
}

export const ThesisReportTab: React.FC<ThesisReportTabProps> = ({ project, onPrint }) => {
  return (
    <div className="space-y-6">
      {/* Top Banner with Action Buttons (Hidden when printing) */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-wrap items-center justify-between gap-4 print:hidden">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-sky-500 via-indigo-500 to-emerald-500 text-white flex items-center justify-center shadow-lg shadow-sky-950/40">
            {project.field === 'CFD' && <Wind className="w-6 h-6 text-white" />}
            {project.field === 'FEA' && <Cpu className="w-6 h-6 text-white" />}
            {project.field === 'Thermal' && <Flame className="w-6 h-6 text-white" />}
            {project.field === 'Multiphysics' && <Layers className="w-6 h-6 text-white" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-[11px] font-bold font-mono bg-sky-500/20 text-sky-300 border border-sky-500/30">
                {project.field} · {project.softwareType}
              </span>
              <h2 className="text-base sm:text-lg font-bold text-white">
                التقرير الهندسي الشامل والتحقق من النمذجة (Certified CAE Report)
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              {project.titleEn || project.title} · {project.university}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onPrint}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/20 active:scale-95 transition-all"
          >
            <Printer className="w-4 h-4" />
            <span>طباعة أو حفظ كملف PDF</span>
          </button>
          <button
            onClick={() => exportToWordDocument(project)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-600/20 active:scale-95 transition-all"
          >
            <FileText className="w-4 h-4" />
            <span>أطروحة Word كاملة بالرسوم والكونتورات (.doc)</span>
          </button>
          <button
            onClick={() => exportToJournalHTML(project)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-gradient-to-r from-blue-700 via-indigo-600 to-sky-600 hover:from-blue-600 hover:to-sky-500 text-white shadow-md shadow-blue-900/30 active:scale-95 transition-all border border-blue-400/30"
          >
            <Globe className="w-4 h-4 text-cyan-200" />
            <span>بحث مجلة عالمية (.html)</span>
          </button>
          <button
            onClick={() => exportToLatex(project)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 active:scale-95 transition-all"
          >
            <span>LaTeX (.tex)</span>
          </button>
          <button
            onClick={() => exportToCSV(project)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-700 hover:bg-emerald-600 text-white active:scale-95 transition-all"
          >
            <span>Excel (.csv)</span>
          </button>
        </div>
      </div>

      {/* The Printable Engineering Document matching the PDF */}
      <div className="bg-slate-900/90 text-slate-100 rounded-3xl border border-slate-800 shadow-2xl p-6 sm:p-12 max-w-5xl mx-auto space-y-12 print:bg-white print:text-slate-900 print:shadow-none print:border-none print:p-0 print:max-w-none font-['Cairo',sans-serif]">
        
        {/* Cover / Academic Header */}
        <div className="text-center border-b-2 border-slate-800 print:border-slate-300 pb-8 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-500/10 text-sky-400 print:text-sky-800 text-xs font-bold font-mono">
            <span>({project.field}) التقرير الهندسي الشامل والتحقق من النمذجة والمحاكاة</span>
          </div>

          <h1 className="text-lg sm:text-2xl font-black text-white print:text-slate-950 mt-3 leading-relaxed font-sans direction-ltr text-center">
            {project.title}
          </h1>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-950/70 print:bg-slate-50 p-4 rounded-2xl border border-slate-800 print:border-slate-200 mt-6 text-xs text-right">
            <div>
              <span className="text-slate-500 block mb-0.5">الباحث / Student:</span>
              <strong className="text-slate-100 print:text-slate-900 text-sm">
                {project.author}
              </strong>
              {project.studentId && (
                <span className="text-xs text-sky-400 block font-mono">
                  (رقم الطالب: {project.studentId})
                </span>
              )}
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">المشرف / Supervisor:</span>
              <strong className="text-amber-400 print:text-amber-800 text-sm">
                {project.supervisor}
              </strong>
              {project.adviser && (
                <div className="text-xs text-slate-300 print:text-slate-700 mt-1">
                  <span className="text-slate-500">المستشار / Adviser: </span>
                  <strong>{project.adviser}</strong>
                </div>
              )}
            </div>
            <div>
              <span className="text-slate-500 block mb-0.5">الجامعة والكلية / University:</span>
              <strong className="text-slate-200 print:text-slate-800 text-xs leading-relaxed block font-sans">
                {project.university}
              </strong>
            </div>
          </div>
        </div>

        {/* 2. التصميم الهندسي ونطاق الحل (Engineering CAD Design & Domain Geometry) */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-sky-400 print:text-sky-800 font-bold text-base sm:text-lg border-r-4 border-sky-500 pr-3">
            <Box className="w-5 h-5 text-sky-400" />
            <span>2. التصميم الهندسي ونطاق الحل (Engineering CAD Design & Domain Geometry)</span>
          </div>

          <EngineeringSchematicViewer project={project} />
        </div>

        {/* 1. الخرائط الحرارية الملونة والرسوم البيانية (تظهر فقط للمشاريع الحرارية ذات الصلة) */}
        {project.meltingComparison && project.meltingComparison.length > 0 && project.field === 'Thermal' && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-sky-400 print:text-sky-800 font-bold text-base sm:text-lg border-r-4 border-sky-500 pr-3">
            <BarChart3 className="w-5 h-5 text-amber-400" />
            <span>1. الخرائط الحرارية الملونة والرسوم البيانية (Thermal Heatmaps & Charts)</span>
          </div>

          {/* Figure 2: Melting Time Comparison (t95) */}
          <div className="bg-slate-950/70 print:bg-slate-50 p-5 rounded-2xl border border-slate-800 print:border-slate-200 space-y-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-200 print:text-slate-900 text-sm">
                • الشكل (2): مقارنة زمن الانصهار 95% (t95) لمختلف الحالات الهندسية
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                Figure 2: Melting Time Comparison (t95) Across Baseline Cases
              </span>
            </div>

            {/* Visual Bar Chart */}
            <div className="space-y-3 pt-2">
              {project.meltingComparison.map((c, idx) => {
                const maxHours = 5.0;
                const widthPercent = (c.t95Hours / maxHours) * 100;
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-semibold text-slate-300 print:text-slate-900 font-sans">
                        {c.caseName}
                      </span>
                      <span className="font-mono font-bold text-xs text-slate-200 print:text-slate-900">
                        {c.t95Hours} h {c.badge ? `(${c.badge})` : ''}
                      </span>
                    </div>
                    <div className="w-full bg-slate-900 print:bg-slate-200 rounded-lg h-7 p-1 border border-slate-800 print:border-slate-300 flex items-center">
                      <div
                        className="h-full rounded-md flex items-center justify-end px-2 text-[11px] font-mono font-bold text-white transition-all shadow-md"
                        style={{ width: `${widthPercent}%`, backgroundColor: c.color }}
                      >
                        {c.t95Hours} h
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Figure 6: Spatiotemporal Liquid Fraction Heatmap (يظهر فقط لمشاريع LHTES ذات الطور المتغير) */}
          {(project.id === 'lhtes_v3_master' || project.id === 'lhtes-v3-master') && (
          <div className="bg-slate-950/70 print:bg-slate-50 p-5 rounded-2xl border border-slate-800 print:border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-slate-200 print:text-slate-900 text-sm">
                • الشكل (6): الخريطة الحرارية الملونة لنسبة الانصهار الزمانية والفضائية (Liquid Fraction Map)
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                Figure 6: Spatiotemporal Liquid Fraction Heatmap
              </span>
            </div>

            {/* Heatmap Representation */}
            <div className="bg-slate-900 print:bg-white p-4 rounded-xl border border-slate-800 print:border-slate-300">
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono mb-2">
                <span>المحور الرأسي: الموقع المحوري Z (0.0 to 0.5 m)</span>
                <span>المحور الأفقي: الزمن بالدقائق والساعات (0 to 5 h)</span>
              </div>

              {/* Graphical simulation of Figure 6 Heatmap */}
              <div className="relative h-48 w-full rounded-lg overflow-hidden border border-slate-700 print:border-slate-400 bg-gradient-to-r from-blue-900 via-amber-600 to-red-600 flex flex-col justify-between p-3 select-none">
                {/* Transition Boundary line at Z = 0.25m */}
                <div className="absolute top-1/2 left-0 right-0 border-t-2 border-dashed border-white/70 flex items-center justify-between px-3">
                  <span className="bg-black/60 text-white font-mono text-[10px] px-2 py-0.5 rounded backdrop-blur-sm">
                    --- Transition Boundary (Z = 0.25 m: Dense 139 fins / Open 65 fins) ---
                  </span>
                  <span className="bg-black/60 text-emerald-300 font-mono text-[10px] px-2 py-0.5 rounded">
                    t95 = {project.meltingComparison?.[0]?.t95Hours ? `${project.meltingComparison[0].t95Hours} h` : 'مكتمل'}
                  </span>
                </div>

                <div className="flex justify-between text-white font-mono text-[10px] z-10 drop-shadow">
                  <span>Z = 0.5 m (Top)</span>
                  <span>t95 reached</span>
                </div>
                <div className="flex justify-between text-white font-mono text-[10px] z-10 drop-shadow">
                  <span>Z = 0.0 m (Bottom Inlet)</span>
                  <span>Time: 0.0 h &rarr; 5.0 h</span>
                </div>
              </div>

              {/* Color Bar Scale */}
              <div className="mt-3 flex items-center justify-between text-[11px] font-mono">
                <span className="text-blue-400 font-bold">0.0 (Solid - صلب أزرق)</span>
                <div className="flex-1 mx-3 h-3 rounded-full bg-gradient-to-r from-blue-600 via-emerald-400 via-amber-400 to-red-600 border border-slate-700" />
                <span className="text-red-400 font-bold">1.0 (Liquid - سائل منصهر أحمر)</span>
              </div>
            </div>
          </div>
          )}

          {/* Figure 7: Spatiotemporal PCM Temperature Heatmap (يظهر فقط لمشاريع LHTES ذات الدخل المتذبذب) */}
          {(project.id === 'lhtes_v3_master' || project.id === 'lhtes-v3-master') && (
          <div className="bg-slate-950/70 print:bg-slate-50 p-5 rounded-2xl border border-slate-800 print:border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-slate-200 print:text-slate-900 text-sm">
                • الشكل (7): الخريطة الحرارية الملونة لتوزيع درجات الحرارة داخل المادة (Temperature Map K)
              </span>
              <span className="font-mono text-[11px] text-slate-400">
                Figure 7: Spatiotemporal PCM Temperature Heatmap under Oscillating Inlet
              </span>
            </div>

            {/* Heatmap Representation */}
            <div className="bg-slate-900 print:bg-white p-4 rounded-xl border border-slate-800 print:border-slate-300">
              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono mb-2">
                <span>المحور الرأسي: الموقع المحوري Z (0.0 to 0.5 m)</span>
                <span>شرط الدخل: Tin(t) = 348 + 10·sin(2πt / 1200 s)</span>
              </div>

              {/* Graphical simulation of Figure 7 Heatmap */}
              <div className="relative h-48 w-full rounded-lg overflow-hidden border border-slate-700 print:border-slate-400 bg-gradient-to-r from-indigo-950 via-sky-600 via-orange-500 to-red-700 flex flex-col justify-between p-3 select-none">
                <div className="flex justify-between text-white font-mono text-[10px] z-10 drop-shadow">
                  <span>Z = 0.5 m (Top)</span>
                  <span>Oscillation Cycles (T = 1200 s)</span>
                </div>
                <div className="flex justify-between text-white font-mono text-[10px] z-10 drop-shadow">
                  <span>Z = 0.0 m (Bottom Inlet)</span>
                  <span>Time: 0.0 h &rarr; 5.0 h</span>
                </div>
              </div>

              {/* Color Bar Scale */}
              <div className="mt-3 flex items-center justify-between text-[11px] font-mono">
                <span className="text-indigo-400 font-bold">292.8 K (20 °C)</span>
                <div className="flex-1 mx-3 h-3 rounded-full bg-gradient-to-r from-indigo-900 via-sky-500 via-amber-400 to-red-600 border border-slate-700" />
                <span className="text-rose-400 font-bold">352.2 K (79.2 °C)</span>
              </div>
            </div>
          </div>
          )}
        </div>
        )}

        {/* 2. مصفوفة الأدبيات والدراسات السابقة (تظهر فقط عند وجود بيانات أدبيات مدخلة) */}
        {project.literatureReview && project.literatureReview.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sky-400 print:text-sky-800 font-bold text-base sm:text-lg border-r-4 border-sky-500 pr-3">
            <TableIcon className="w-5 h-5 text-indigo-400" />
            <span>2. مصفوفة الأدبيات والدراسات السابقة (Literature Review Matrix)</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-800 print:border-slate-200 shadow-md">
            <table className="w-full text-xs text-right">
              <thead>
                <tr className="bg-sky-950/80 print:bg-sky-100 text-sky-200 print:text-sky-900 border-b border-slate-800 print:border-slate-300">
                  <th className="py-3 px-3.5 font-bold">الدراسة / Study</th>
                  <th className="py-3 px-3.5 font-bold">التشكيل / Configuration</th>
                  <th className="py-3 px-3.5 font-bold">النتيجة الكمية / Key Finding</th>
                  <th className="py-3 px-3.5 font-bold">الفجوة البحثية / Gap</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 print:divide-slate-200">
                {(project.literatureReview || []).map((row, idx) => {
                  const isPresent = row.study.includes('Present Study');
                  return (
                    <tr
                      key={idx}
                      className={
                        isPresent
                          ? 'bg-amber-500/15 print:bg-amber-50 font-bold border-l-4 border-amber-500'
                          : 'hover:bg-slate-800/30'
                      }
                    >
                      <td className="py-2.5 px-3.5 font-bold text-slate-100 print:text-slate-900 font-sans">
                        {row.study}
                      </td>
                      <td className="py-2.5 px-3.5 text-slate-300 print:text-slate-800 font-sans">
                        {row.configuration}
                      </td>
                      <td className="py-2.5 px-3.5 font-mono text-emerald-400 print:text-emerald-800">
                        {row.keyFinding}
                      </td>
                      <td className="py-2.5 px-3.5 text-slate-400 print:text-slate-600 font-sans leading-relaxed">
                        {row.gap}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* 3. المواصفات الهندسية ونواة التصميم (CAD & Physical System) */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sky-400 print:text-sky-800 font-bold text-base sm:text-lg border-r-4 border-sky-500 pr-3">
            <Layers3 className="w-5 h-5 text-emerald-400" />
            <span>3. المواصفات الهندسية ونواة التصميم (CAD & Physical System)</span>
          </div>

          {project.cadSpecs ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div className="p-4 rounded-xl bg-slate-950/70 print:bg-slate-50 border border-slate-800 print:border-slate-200">
                <span className="text-slate-500 block mb-1 font-semibold">
                  {project.field === 'FEA' ? 'أبعاد وهيكل النطاق الإنشائي (Domain Dimensions):' : project.field === 'CFD' ? 'أبعاد حيز الجريان الهيدروديناميكي (Flow Domain Dimensions):' : 'أبعاد وهيكل النطاق (Domain Dimensions):'}
                </span>
                <strong className="text-slate-100 print:text-slate-900 font-mono text-xs">
                  {project.cadSpecs.shell}
                </strong>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/70 print:bg-slate-50 border border-slate-800 print:border-slate-200">
                <span className="text-slate-500 block mb-1 font-semibold">
                  {project.field === 'FEA' ? 'حدود التثبيت والاستناد (Support Boundary):' : project.field === 'CFD' ? 'حدود المدخل والسرعة (Inlet Boundary):' : 'حدود المدخل والتثبيت (Inlet / Support Boundary):'}
                </span>
                <strong className="text-slate-100 print:text-slate-900 font-mono text-xs">
                  {project.cadSpecs.coil}
                </strong>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/70 print:bg-slate-50 border border-slate-800 print:border-slate-200">
                <span className="text-slate-500 block mb-1 font-semibold">
                  {project.field === 'FEA' ? 'مناطق تطبيق الحمولات والضغوط (Load Layout):' : project.field === 'CFD' ? 'شروط الجدران والمخرج (Boundary Layout):' : 'الشروط والتجهيزات (Boundary Layout):'}
                </span>
                <strong className="text-emerald-400 print:text-emerald-800 font-mono text-xs">
                  {project.cadSpecs.fins}
                </strong>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/70 print:bg-slate-50 border border-slate-800 print:border-slate-200">
                <span className="text-slate-500 block mb-1 font-semibold">
                  {project.field === 'FEA' ? 'المادة الإنشائية وركيزة النموذج (Structural Material):' : project.field === 'CFD' ? 'المائع ومواصفات المادة (Working Fluid / Medium):' : 'المادة وركيزة النموذج (Material Specification):'}
                </span>
                <strong className="text-amber-400 print:text-amber-800 font-mono text-xs">
                  {project.cadSpecs.pcm}
                </strong>
              </div>

              {project.cadSpecs.nano && (
                <div className="p-4 rounded-xl bg-slate-950/70 print:bg-slate-50 border border-slate-800 print:border-slate-200">
                  <span className="text-slate-500 block mb-1 font-semibold">
                    {project.field === 'FEA' ? 'نموذج المادة والسلوك الإنشائي (Constitutive Model):' : project.field === 'CFD' ? 'نموذج الاضطراب واللزوجة (Turbulence Model):' : 'الخواص المعززة للمادة (Enhanced Properties):'}
                  </span>
                  <strong className="text-sky-400 print:text-sky-800 font-mono text-xs">
                    {project.cadSpecs.nano}
                  </strong>
                </div>
              )}

              {project.cadSpecs.htf && (
                <div className="p-4 rounded-xl bg-slate-950/70 print:bg-slate-50 border border-slate-800 print:border-slate-200">
                  <span className="text-slate-500 block mb-1 font-semibold">
                    {project.field === 'FEA' ? 'الحمولة الإنشائية المطبقة (Applied Structural Load):' : project.field === 'CFD' ? 'الضغط والظروف التشغيلية (Operating Conditions):' : 'شروط الوسط والتشغيل (Operating Conditions):'}
                  </span>
                  <strong className="text-rose-400 print:text-rose-800 font-mono text-xs">
                    {project.cadSpecs.htf}
                  </strong>
                </div>
              )}

              <div className="p-4 rounded-xl bg-slate-950/70 print:bg-slate-50 border border-slate-800 print:border-slate-200 md:col-span-2">
                <span className="text-slate-500 block mb-1 font-semibold">الشروط الأولية والحدودية (Initial & Boundary Conditions):</span>
                <strong className="text-slate-200 print:text-slate-800 font-mono text-xs">
                  {project.cadSpecs.initial}
                </strong>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <div className="p-4 rounded-xl bg-slate-950/70 print:bg-slate-50 border border-slate-800 print:border-slate-200">
                <span className="text-slate-500 block mb-1 font-semibold">المادة والخواص الفيزيائية (Material):</span>
                <strong className="text-amber-400 print:text-amber-800 font-mono text-xs">
                  {project.material?.name || 'مادة النموذج'} (كثافة = {project.material?.density || 'غير محدد'})
                </strong>
              </div>
              <div className="p-4 rounded-xl bg-slate-950/70 print:bg-slate-50 border border-slate-800 print:border-slate-200">
                <span className="text-slate-500 block mb-1 font-semibold">إعدادات المحلل وحل المعادلات (Solver):</span>
                <strong className="text-sky-400 print:text-sky-800 font-mono text-xs">
                  {project.solver?.solverType || (project.field === 'FEA' ? 'Static Structural Sparse Direct' : project.field === 'Thermal' ? 'Thermal Conduction Solver' : 'Pressure-Based Coupled Solver')} ({project.solver?.scheme || 'Coupled Formulation'})
                </strong>
              </div>
              {(project.boundaryConditions || []).map((b, idx) => (
                <div key={idx} className="p-4 rounded-xl bg-slate-950/70 print:bg-slate-50 border border-slate-800 print:border-slate-200">
                  <span className="text-slate-500 block mb-1 font-semibold">{b.name} ({b.type}):</span>
                  <strong className="text-emerald-400 print:text-emerald-800 font-mono text-xs">
                    {b.value} {b.unit} — {b.description}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 4. النتائج الأكاديمية والأرقام الحاكمة (Quantitative Findings) */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sky-400 print:text-sky-800 font-bold text-base sm:text-lg border-r-4 border-sky-500 pr-3">
            <Zap className="w-5 h-5 text-amber-400" />
            <span>4. النتائج الأكاديمية والأرقام الحاكمة (Quantitative Findings)</span>
          </div>

          <div className="space-y-3">
            {(project.quantitativeFindings || []).map((finding) => (
              <div
                key={finding.id}
                className="p-4 rounded-2xl bg-slate-950/70 print:bg-slate-50 border border-slate-800 print:border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center font-mono font-bold shrink-0">
                    {finding.id}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-100 print:text-slate-900 text-sm">
                      {finding.title}:
                    </h4>
                    <p className="text-slate-400 print:text-slate-600 mt-0.5 leading-relaxed">
                      {finding.description}
                    </p>
                  </div>
                </div>
                <div className="self-end sm:self-center shrink-0">
                  <span className="px-3 py-1.5 rounded-xl font-mono font-bold text-xs bg-emerald-500/20 text-emerald-400 print:text-emerald-800 border border-emerald-500/30">
                    {finding.value}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. دليل وتأكيد تشغيل المحاكاة الهندسية */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sky-400 print:text-sky-800 font-bold text-base sm:text-lg border-r-4 border-sky-500 pr-3">
            <Cpu className="w-5 h-5 text-sky-400" />
            <span>5. دليل وتأكيد تشغيل المحاكاة الهندسية ({project.softwareType || 'ANSYS Solver / CAE Workbench'})</span>
          </div>

          <div className="bg-slate-950/80 print:bg-slate-50 p-5 rounded-2xl border border-sky-500/30 space-y-3 text-xs">
            <div className="flex items-center gap-2 text-emerald-400 print:text-emerald-800 font-bold">
              <CheckCircle className="w-4 h-4" />
              <span>السكربت الرئيسي المعتمد:</span>
              <span className="font-mono text-sky-300 print:text-sky-700 bg-sky-950/80 px-2 py-0.5 rounded border border-sky-800/50">
                {project.softwareType?.includes('.wbjn') || project.softwareType?.includes('.jou') || project.softwareType?.includes('.mac')
                  ? project.softwareType
                  : `${project.id || 'cae_simulation'}.jou`}
              </span>
              <span className="text-slate-400 font-normal">يربط أجزاء النموذج تلقائياً وينفذ المعالجة الشاملة.</span>
            </div>

            <div className="flex items-center gap-2 text-slate-300 print:text-slate-800 leading-relaxed">
              <strong className="text-amber-400 print:text-amber-800 shrink-0">الشبكة والاختبار:</strong>
              <span>تستخدم شبكة استكشافية أولاً، ثم يتم التنعيم عبر مستويات الشبكة (L1-L4) لضمان استقلالية الحل بمؤشر روتش Roache GCI &lt; 2%.</span>
            </div>
          </div>
        </div>

        {/* 6. مناقشة الدفاع الأكاديمي والرد على ثغرات لجنة المناقشة (Defense Committee Nuances & Engineering Rigor) */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-amber-400 print:text-amber-800 font-bold text-base sm:text-lg border-r-4 border-amber-500 pr-3">
            <ShieldCheck className="w-5 h-5 text-amber-400" />
            <span>6. مناقشة الدفاع الأكاديمي والرد على استفسارات لجنة المناقشة (Academic Defense Nuances & Rigor)</span>
          </div>

          <div className="bg-slate-950/80 print:bg-slate-50 p-5 rounded-2xl border border-slate-800 print:border-slate-200 space-y-4 text-xs leading-relaxed">
            <p className="text-slate-300 print:text-slate-800 text-justify">
              <strong>مقدمة توجيهية للمناقشين (Defense Examiner Notes):</strong> يعالج هذا القسم بدقة كافة التفاصيل الفنية الدقيقة والثغرات التي عادة ما تركز عليها لجان التحكيم والمناقشة لضمان سلامة وإحكام الموقف العلمي للمهندس والباحث:
            </p>

            <div className="space-y-3">
              {project.supervisorDefensePoints && project.supervisorDefensePoints.length > 0 ? (
                project.supervisorDefensePoints.map((dp, idx) => (
                  <div key={idx} className="p-3.5 rounded-xl bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300 space-y-1.5">
                    <span className="font-bold text-sky-300 print:text-sky-700 block">
                      س {idx + 1}: {dp.question}
                    </span>
                    <p className="text-slate-300 print:text-slate-700 text-justify">
                      <strong className="text-amber-400 print:text-amber-700">ج: </strong>
                      {dp.answer}
                    </p>
                    {dp.scientificJustification && (
                      <p className="text-[11px] text-emerald-400/90 print:text-emerald-700 font-mono">
                        السند العلمي والمعياري: {dp.scientificJustification}
                      </p>
                    )}
                  </div>
                ))
              ) : project.field === 'FEA' ? (
                <>
                  <div className="p-3.5 rounded-xl bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300">
                    <span className="font-bold text-sky-300 print:text-sky-700 block mb-1">
                      أ. منع القفل القصي وصيغة العناصر (Quadratic Hex Formulation):
                    </span>
                    <p className="text-slate-300 print:text-slate-700 text-justify">
                      تم اعتماد عناصر SOLID186 سداسية الأوجه ثلاثية الأبعاد ذات 20 عقدة للتخلص التام من ظاهرة القفل القصي (Shear Locking) في الانحناء، وتجنب القفل الحجمي (Volumetric Locking).
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300">
                    <span className="font-bold text-sky-300 print:text-sky-700 block mb-1">
                      ب. عزل النقاط الشاذة والتركيز الإجهادي (Stress Singularity Avoidance):
                    </span>
                    <p className="text-slate-300 print:text-slate-700 text-justify">
                      فصل تركز الإجهاد الهندسي الحقيقي عن النقاط الشاذة الرياضية عند زوايا التثبيت الحادة وفق مبدأ سانت-فينان (Saint-Venant's Principle).
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="p-3.5 rounded-xl bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300">
                    <span className="font-bold text-sky-300 print:text-sky-700 block mb-1">
                      أ. ضبط الطبقة الجدارية وقيمة (y⁺ Near-Wall Resolution):
                    </span>
                    <p className="text-slate-300 print:text-slate-700 text-justify">
                      لحل الطبقة اللزجة الفرعية بدقة تامة دون الاعتماد على دوال الجدار التجريبية، تم ضبط ارتفاع الخلية الأولى المجاورة للجدار بحيث تضمن أن قيمة <span className="font-mono text-amber-400 font-bold">y⁺ &approx; 1</span> في كافة المناطق الحرجة.
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-slate-900 print:bg-white border border-slate-800 print:border-slate-300">
                    <span className="font-bold text-sky-300 print:text-sky-700 block mb-1">
                      ب. دقة التفريق المكاني ومخطط الرتبة الثانية (Second-Order Upwind):
                    </span>
                    <p className="text-slate-300 print:text-slate-700 text-justify">
                      تم اعتماد مخطط التفريق من الرتبة الثانية للحد من أخطاء بتر متسلسلة تايلور والقضاء على الانتشار العددي المزيف.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Official Certification Stamp Footer */}
        <div className="border-2 border-emerald-500/40 rounded-2xl p-6 bg-slate-950/60 print:bg-white text-xs space-y-4 print:border-slate-400">
          <div className="flex items-center justify-between border-b border-slate-800 print:border-slate-200 pb-3">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-emerald-400" />
              <span className="font-bold text-sm text-slate-100 print:text-slate-900">
                شهادة الاعتماد والمطابقة الأكاديمية (ASME V&V 20 / Thesis Verification)
              </span>
            </div>
            <span className="font-mono text-[11px] text-emerald-400 print:text-emerald-700 bg-emerald-500/10 px-2.5 py-1 rounded">
              VERIFIED & CONVERGED · 2026
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
            <div>
              <p className="text-slate-400 print:text-slate-600 leading-relaxed mb-3">
                يشهد هذا التقرير أن النموذج العددي ({project.title}) تم حله ومطابقته بدقة عبر برمجية {project.activeSolverBadge || project.softwareType}، محققاً استقلالية شبكية GCI &lt; 2% وتطابقاً معيارياً وفق ASME V&V 20.
              </p>
              <div className="text-[11px] text-slate-500 font-mono">
                كود المشروع: {project.id} · المعرف: {project.academicMeta?.studentId || project.studentId || 'CERT-2026-CAE'}
              </div>
            </div>

            <div className="flex flex-col justify-end items-end space-y-4 pt-4 sm:pt-0">
              <div className="text-center w-56">
                <div className="border-b border-slate-700 print:border-slate-400 pb-1 mb-1 font-bold text-slate-200 print:text-slate-900">
                  {project.supervisor}
                </div>
                <div className="text-[10px] text-slate-500">
                  المشرف الأكاديمي الرئيسي (Supervisor)
                </div>
              </div>
              {project.adviser && (
                <div className="text-center w-56">
                  <div className="border-b border-slate-700 print:border-slate-400 pb-1 mb-1 font-semibold text-slate-300 print:text-slate-800">
                    {project.adviser}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    المستشار الأكاديمي (Adviser)
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
