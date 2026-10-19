import React, { useState } from 'react';
import {
  Layers,
  Box,
  Cpu,
  ArrowRight,
  Maximize2,
  Info,
  CheckCircle2,
  Sliders,
  Settings,
  Compass,
} from 'lucide-react';
import { ThesisProject } from '../types/thesis';

interface EngineeringSchematicViewerProps {
  project: ThesisProject;
}

export const EngineeringSchematicViewer: React.FC<EngineeringSchematicViewerProps> = ({ project }) => {
  const [viewMode, setViewMode] = useState<'2d_blueprint' | '3d_isometric'>('3d_isometric');
  const [activeCallout, setActiveCallout] = useState<string | null>('inlet');

  const isFEA = project.field === 'FEA';

  return (
    <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 shadow-2xl space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Box className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              الرسم الهندسي ومخطط المدخلات والمخرجات (CAD & Domain Schematic)
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                ANSYS / AutoCAD Precision View
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              مخطط تفصيلي يوضح الأبعاد، الحدود، الشروط الحدية، الثوابت، ومواقع المدخلات والمخرجات الهندسية
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setViewMode('2d_blueprint')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              viewMode === '2d_blueprint'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            مسطح ثنائي الأبعاد (2D Blueprint)
          </button>
          <button
            type="button"
            onClick={() => setViewMode('3d_isometric')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              viewMode === '3d_isometric'
                ? 'bg-sky-600 text-white shadow-md shadow-sky-900/30'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
            }`}
          >
            منظور ثلاثي الأبعاد (3D Isometric)
          </button>
        </div>
      </div>

      {/* Interactive CAD Schematic Canvas */}
      <div className="relative bg-slate-950 rounded-2xl border border-slate-800 p-6 overflow-hidden min-h-[380px] flex items-center justify-center">
        {/* Background Grid & Coordinate Axis */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:24px_24px] opacity-40 pointer-events-none" />

        {/* CAD SVG Rendering */}
        <div className="relative z-10 w-full max-w-3xl">
          <svg viewBox="0 0 700 350" className="w-full h-auto drop-shadow-2xl">
            {/* Coordinate System Compass */}
            <g transform="translate(60, 60)">
              <circle cx="0" cy="0" r="22" fill="#0f172a" stroke="#334155" strokeWidth="1.5" />
              <line x1="0" y1="0" x2="16" y2="0" stroke="#f43f5e" strokeWidth="2" markerEnd="url(#arrow)" />
              <text x="19" y="4" fill="#f43f5e" fontSize="10" fontFamily="monospace">X</text>
              <line x1="0" y1="0" x2="0" y2="-16" stroke="#10b981" strokeWidth="2" markerEnd="url(#arrow)" />
              <text x="-3" y="-20" fill="#10b981" fontSize="10" fontFamily="monospace">Y</text>
              {viewMode === '3d_isometric' && (
                <>
                  <line x1="0" y1="0" x2="-12" y2="12" stroke="#38bdf8" strokeWidth="2" />
                  <text x="-20" y="22" fill="#38bdf8" fontSize="10" fontFamily="monospace">Z</text>
                </>
              )}
            </g>

            {/* Definitions for arrowheads */}
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
              </marker>
              <marker id="arrow-red" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#f43f5e" />
              </marker>
            </defs>

            {viewMode === '3d_isometric' ? (
              /* 3D Isometric CAD Block / Domain Representation */
              <g transform="translate(180, 50)">
                {/* Back Extrusion Faces */}
                <path d="M 120 40 L 320 40 L 320 200 L 120 200 Z" fill="#1e293b" stroke="#475569" strokeWidth="2" opacity="0.6" />
                <path d="M 320 40 L 400 80 L 400 240 L 320 200 Z" fill="#0f172a" stroke="#475569" strokeWidth="2" />
                
                {/* Main Front / Top CAD Domain Box */}
                <path d="M 40 80 L 240 80 L 320 40 L 120 40 Z" fill="#334155" stroke="#38bdf8" strokeWidth="2.5" />
                <path d="M 40 80 L 40 240 L 240 240 L 240 80 Z" fill="#1e293b" stroke="#38bdf8" strokeWidth="2.5" />
                <path d="M 240 80 L 320 40 L 320 200 L 240 240 Z" fill="#0f172a" stroke="#38bdf8" strokeWidth="2" />

                {/* Internal Mesh / Flow Lines */}
                <path d="M 80 120 Q 180 140 280 100" fill="none" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.8" />
                <path d="M 80 160 Q 180 180 280 140" fill="none" stroke="#10b981" strokeWidth="1.5" strokeDasharray="5 3" opacity="0.8" />

                {/* Inlet Callout Marker */}
                <g transform="translate(40, 160)" className="cursor-pointer" onClick={() => setActiveCallout('inlet')}>
                  <circle cx="0" cy="0" r="10" fill="#38bdf8" stroke="#fff" strokeWidth="2" />
                  <text x="-3" y="4" fill="#0f172a" fontSize="11" fontWeight="bold">1</text>
                  <line x1="-20" y1="0" x2="-60" y2="0" stroke="#38bdf8" strokeWidth="1.5" />
                  <rect x="-180" y="-18" width="115" height="36" rx="6" fill="#0f172a" stroke="#38bdf8" strokeWidth="1.5" />
                  <text x="-172" y="2" fill="#38bdf8" fontSize="10" fontWeight="bold">مدخل التدفق (Inlet)</text>
                  <text x="-172" y="14" fill="#cbd5e1" fontSize="9" fontFamily="monospace">
                    {project.boundaryConditions[0]?.value || '22 m/s'}
                  </text>
                </g>

                {/* Outlet Callout Marker */}
                <g transform="translate(240, 160)" className="cursor-pointer" onClick={() => setActiveCallout('outlet')}>
                  <circle cx="0" cy="0" r="10" fill="#f43f5e" stroke="#fff" strokeWidth="2" />
                  <text x="-3" y="4" fill="#0f172a" fontSize="11" fontWeight="bold">2</text>
                  <line x1="20" y1="0" x2="60" y2="0" stroke="#f43f5e" strokeWidth="1.5" />
                  <rect x="65" y="-18" width="115" height="36" rx="6" fill="#0f172a" stroke="#f43f5e" strokeWidth="1.5" />
                  <text x="73" y="2" fill="#f43f5e" fontSize="10" fontWeight="bold">مخرج النظام (Outlet)</text>
                  <text x="73" y="14" fill="#cbd5e1" fontSize="9" fontFamily="monospace">
                    {project.boundaryConditions[1]?.value || '0.0 Pa'}
                  </text>
                </g>

                {/* Wall Boundary Callout */}
                <g transform="translate(140, 240)" className="cursor-pointer" onClick={() => setActiveCallout('wall')}>
                  <circle cx="0" cy="0" r="10" fill="#10b981" stroke="#fff" strokeWidth="2" />
                  <text x="-3" y="4" fill="#0f172a" fontSize="11" fontWeight="bold">3</text>
                  <line x1="0" y1="20" x2="0" y2="50" stroke="#10b981" strokeWidth="1.5" />
                  <rect x="-60" y="55" width="120" height="32" rx="6" fill="#0f172a" stroke="#10b981" strokeWidth="1.5" />
                  <text x="-52" y="70" fill="#10b981" fontSize="10" fontWeight="bold">الجدار اللزج (No-Slip Wall)</text>
                </g>
              </g>
            ) : (
              /* 2D Blueprint Schematic */
              <g transform="translate(120, 60)">
                <rect x="0" y="0" width="460" height="200" rx="8" fill="#0f172a" stroke="#38bdf8" strokeWidth="2.5" />
                
                {/* Inlet boundary line */}
                <line x1="0" y1="0" x2="0" y2="200" stroke="#38bdf8" strokeWidth="5" />
                <text x="-35" y="105" fill="#38bdf8" fontSize="11" fontWeight="bold" transform="rotate(-90 -35 105)">INLET</text>

                {/* Outlet boundary line */}
                <line x1="460" y1="0" x2="460" y2="200" stroke="#f43f5e" strokeWidth="5" />
                <text x="485" y="105" fill="#f43f5e" fontSize="11" fontWeight="bold" transform="rotate(-90 485 105)">OUTLET</text>

                {/* Centerline / Axis */}
                <line x1="0" y1="100" x2="460" y2="100" stroke="#64748b" strokeWidth="1.5" strokeDasharray="8 6" />

                {/* Dimensions */}
                <line x1="0" y1="220" x2="460" y2="220" stroke="#94a3b8" strokeWidth="1" markerEnd="url(#arrow)" markerStart="url(#arrow)" />
                <text x="210" y="235" fill="#94a3b8" fontSize="11" fontFamily="monospace">L = 1.50 m (Characteristic Length)</text>

                {/* Callout markers */}
                <circle cx="100" cy="100" r="8" fill="#38bdf8" />
                <text x="97" y="103" fill="#0f172a" fontSize="10" fontWeight="bold">A</text>

                <circle cx="360" cy="100" r="8" fill="#f43f5e" />
                <text x="357" y="103" fill="#0f172a" fontSize="10" fontWeight="bold">B</text>
              </g>
            )}
          </svg>
        </div>

        {/* Legend Overlay / Quick Info */}
        <div className="absolute bottom-4 left-4 right-4 bg-slate-900/90 backdrop-blur-md p-3.5 rounded-xl border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <Info className="w-4 h-4 text-sky-400 shrink-0" />
            <div>
              <span className="font-bold text-slate-200">المدخلات والمخرجات والثوابت الهندسية:</span>
              <p className="text-[11px] text-slate-400">
                المادة: <strong className="text-amber-300">{project.material.name}</strong> | 
                المدخل: <strong className="text-sky-300">{project.boundaryConditions[0]?.value || '22 m/s'}</strong> | 
                المخرج: <strong className="text-rose-300">{project.boundaryConditions[1]?.value || '0 Pa'}</strong>
              </p>
            </div>
          </div>
          <span className="font-mono text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20">
            ✓ متوافق مع معايير الرسم الهندسي ANSYS / AutoCAD
          </span>
        </div>
      </div>

      {/* Detailed Parameters Pinned Table */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-1.5">
          <span className="text-xs text-sky-400 font-bold block flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-sky-400" />
            المدخلات الأساسية (Inputs)
          </span>
          <div className="text-xs text-slate-300 space-y-1 font-mono">
            <div>• {project.boundaryConditions[0]?.name || 'مدخل التدفق'}: <strong className="text-white">{project.boundaryConditions[0]?.value} {project.boundaryConditions[0]?.unit}</strong></div>
            <div>• درجة حرارة الدخول: <strong className="text-white">293.15 K</strong></div>
            <div>• معدل الكتلة: <strong className="text-white">0.025 kg/s</strong></div>
          </div>
        </div>

        <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-1.5">
          <span className="text-xs text-rose-400 font-bold block flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-400" />
            المخرجات المحسوبة (Outputs)
          </span>
          <div className="text-xs text-slate-300 space-y-1 font-mono">
            <div>• إجهاد / ضغط الذروة: <strong className="text-white">{project.contours[0]?.maxVal || 50} {project.contours[0]?.unit}</strong></div>
            <div>• هبوط الضغط الكلي: <strong className="text-white">12.4 kPa</strong></div>
            <div>• معامل الأمان (SF): <strong className="text-emerald-400">2.41</strong></div>
          </div>
        </div>

        <div className="bg-slate-950/70 p-4 rounded-xl border border-slate-800 space-y-1.5">
          <span className="text-xs text-amber-400 font-bold block flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-400" />
            الثوابت الفيزيائية (Constants)
          </span>
          <div className="text-xs text-slate-300 space-y-1 font-mono">
            <div>• الكثافة (&rho;): <strong className="text-white">{project.material.density}</strong></div>
            <div>• اللزوجة (&mu;): <strong className="text-white">{project.material.viscosity || '1.003e-3 Pa&middot;s'}</strong></div>
            <div>• معامل المرونة (E): <strong className="text-white">{project.material.elasticModulus || '205 GPa'}</strong></div>
          </div>
        </div>
      </div>
    </div>
  );
};
