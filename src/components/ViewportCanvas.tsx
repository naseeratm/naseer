import React, { useState } from 'react';
import { MousePointer2, Hand, Rotate3d, ZoomIn, Maximize2, Scissors, Box, Grid3X3 } from 'lucide-react';

type ViewPreset = 'iso' | 'front' | 'top' | 'right';
type ShadingMode = 'shaded' | 'wireframe';
type ViewTool = 'select' | 'pan' | 'rotate' | 'zoom';

const CUBE_ROTATIONS: Record<ViewPreset, string> = {
  iso: 'rotateX(-28deg) rotateY(-38deg)',
  front: 'rotateX(0deg) rotateY(0deg)',
  top: 'rotateX(-90deg) rotateY(0deg)',
  right: 'rotateX(0deg) rotateY(-90deg)',
};

const CUBE_FACES: { label: string; preset: ViewPreset; transform: string }[] = [
  { label: 'FRONT', preset: 'front', transform: 'translateZ(28px)' },
  { label: 'BACK', preset: 'front', transform: 'rotateY(180deg) translateZ(28px)' },
  { label: 'RIGHT', preset: 'right', transform: 'rotateY(90deg) translateZ(28px)' },
  { label: 'LEFT', preset: 'right', transform: 'rotateY(-90deg) translateZ(28px)' },
  { label: 'TOP', preset: 'top', transform: 'rotateX(90deg) translateZ(28px)' },
  { label: 'BOTTOM', preset: 'top', transform: 'rotateX(-90deg) translateZ(28px)' },
];

const TOOLS: { id: ViewTool; label: string; icon: React.ReactNode }[] = [
  { id: 'select', label: 'Select', icon: <MousePointer2 className="h-3.5 w-3.5" /> },
  { id: 'pan', label: 'Pan', icon: <Hand className="h-3.5 w-3.5" /> },
  { id: 'rotate', label: 'Rotate', icon: <Rotate3d className="h-3.5 w-3.5" /> },
  { id: 'zoom', label: 'Zoom', icon: <ZoomIn className="h-3.5 w-3.5" /> },
];

interface ViewportCanvasProps {
  title: string;
  subtitle?: string;
  showMeshOverlay?: boolean;
  // When provided (e.g. a result field) it replaces the placeholder model.
  children?: React.ReactNode;
  overlay?: React.ReactNode;
}

const PlaceholderModel: React.FC<{ shading: ShadingMode; meshed: boolean }> = ({ shading, meshed }) => {
  const solid = shading === 'shaded';
  return (
    <svg viewBox="0 0 400 300" className="h-full max-h-[420px] w-full max-w-[560px]" role="img" aria-label="3D model placeholder">
      <defs>
        <pattern id="mesh-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(30)">
          <path d="M0 0H12M0 0V12" stroke="#38bdf8" strokeOpacity="0.55" strokeWidth="0.6" fill="none" />
        </pattern>
        <linearGradient id="face-top" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#64748b" />
          <stop offset="1" stopColor="#475569" />
        </linearGradient>
        <linearGradient id="face-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#334155" />
          <stop offset="1" stopColor="#1e293b" />
        </linearGradient>
        <linearGradient id="face-right" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e293b" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
      </defs>
      <ellipse cx="200" cy="262" rx="150" ry="18" fill="#000" opacity="0.35" />
      <g strokeLinejoin="round" stroke="#7dd3fc" strokeWidth="1.2">
        <polygon points="200,70 330,125 200,180 70,125" fill={solid ? 'url(#face-top)' : 'none'} />
        <polygon points="70,125 200,180 200,245 70,190" fill={solid ? 'url(#face-left)' : 'none'} />
        <polygon points="200,180 330,125 330,190 200,245" fill={solid ? 'url(#face-right)' : 'none'} />
        {meshed && (
          <g stroke="none" opacity="0.9">
            <polygon points="200,70 330,125 200,180 70,125" fill="url(#mesh-hatch)" />
            <polygon points="70,125 200,180 200,245 70,190" fill="url(#mesh-hatch)" />
            <polygon points="200,180 330,125 330,190 200,245" fill="url(#mesh-hatch)" />
          </g>
        )}
      </g>
      <g fill="#f8fafc" fontSize="9" fontFamily="monospace" opacity="0.55">
        <text x="206" y="60">Inlet</text>
        <text x="300" y="215">Outlet</text>
      </g>
    </svg>
  );
};

export const ViewportCanvas: React.FC<ViewportCanvasProps> = ({
  title,
  subtitle,
  showMeshOverlay = false,
  children,
  overlay,
}) => {
  const [preset, setPreset] = useState<ViewPreset>('iso');
  const [shading, setShading] = useState<ShadingMode>('shaded');
  const [tool, setTool] = useState<ViewTool>('select');
  const [fitKey, setFitKey] = useState(0);

  return (
    <div
      className="print-reset relative min-h-0 flex-1 overflow-hidden bg-[#0a0f1c]"
      style={{
        backgroundImage:
          'radial-gradient(ellipse at 50% 40%, rgba(30,41,59,0.55), rgba(2,6,23,0.9) 75%),' +
          'linear-gradient(rgba(148,163,184,0.09) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(148,163,184,0.09) 1px, transparent 1px),' +
          'linear-gradient(rgba(148,163,184,0.04) 1px, transparent 1px),' +
          'linear-gradient(90deg, rgba(148,163,184,0.04) 1px, transparent 1px)',
        backgroundSize: 'auto, 80px 80px, 80px 80px, 16px 16px, 16px 16px',
      }}
    >
      <div key={fitKey} className="absolute inset-0 flex items-center justify-center p-10">
        {children ?? <PlaceholderModel shading={shading} meshed={showMeshOverlay} />}
      </div>

      <div className="pointer-events-none absolute left-3 top-3 max-w-[26%] select-none">
        <div className="truncate text-[12px] font-semibold text-slate-200">{title}</div>
        {subtitle && <div className="truncate text-[10.5px] text-slate-500">{subtitle}</div>}
      </div>

      {/* Floating toolbar */}
      <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-slate-700/80 bg-slate-900/90 p-1 shadow-xl shadow-black/40 backdrop-blur">
        {TOOLS.map((item) => (
          <button
            key={item.id}
            title={item.label}
            aria-pressed={tool === item.id}
            onClick={() => setTool(item.id)}
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              tool === item.id ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {item.icon}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-slate-700" />
        <button
          title="Fit to view"
          onClick={() => {
            setPreset('iso');
            setFitKey((key) => key + 1);
          }}
          className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <button title="Section plane (preview)" className="flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-white">
          <Scissors className="h-3.5 w-3.5" />
        </button>
        <span className="mx-1 h-4 w-px bg-slate-700" />
        <button
          title="Shaded"
          aria-pressed={shading === 'shaded'}
          onClick={() => setShading('shaded')}
          className={`flex h-7 w-7 items-center justify-center rounded ${
            shading === 'shaded' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Box className="h-3.5 w-3.5" />
        </button>
        <button
          title="Wireframe"
          aria-pressed={shading === 'wireframe'}
          onClick={() => setShading('wireframe')}
          className={`flex h-7 w-7 items-center justify-center rounded ${
            shading === 'wireframe' ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Grid3X3 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* View cube */}
      <div className="absolute right-4 top-4 z-10 flex h-[84px] w-[84px] items-center justify-center" style={{ perspective: '300px' }}>
        <div
          className="relative h-14 w-14 transition-transform duration-500"
          style={{ transformStyle: 'preserve-3d', transform: CUBE_ROTATIONS[preset] }}
        >
          {CUBE_FACES.map((face) => (
            <button
              key={face.label}
              onClick={() => setPreset(face.preset)}
              className="absolute inset-0 flex items-center justify-center border border-slate-500/70 bg-slate-800/85 text-[8px] font-bold tracking-wider text-slate-300 hover:bg-sky-500/40 hover:text-white"
              style={{ transform: face.transform, backfaceVisibility: 'hidden' }}
            >
              {face.label}
            </button>
          ))}
        </div>
      </div>

      {/* Axis triad */}
      <svg className="pointer-events-none absolute bottom-9 left-4 h-14 w-14" viewBox="0 0 56 56" aria-hidden="true">
        <line x1="12" y1="44" x2="46" y2="44" stroke="#f87171" strokeWidth="1.6" />
        <line x1="12" y1="44" x2="12" y2="10" stroke="#4ade80" strokeWidth="1.6" />
        <line x1="12" y1="44" x2="28" y2="30" stroke="#60a5fa" strokeWidth="1.6" />
        <text x="47" y="47" fill="#f87171" fontSize="8" fontFamily="monospace">X</text>
        <text x="9" y="8" fill="#4ade80" fontSize="8" fontFamily="monospace">Y</text>
        <text x="29" y="28" fill="#60a5fa" fontSize="8" fontFamily="monospace">Z</text>
      </svg>

      {overlay}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-6 items-center justify-between border-t border-slate-800/80 bg-slate-950/70 px-3 font-mono text-[10px] text-slate-500 backdrop-blur-sm">
        <span>{shading === 'shaded' ? 'Shaded' : 'Wireframe'} · {preset.toUpperCase()} · {tool}</span>
        <span>Units: SI (m, kg, s, K)</span>
      </div>
    </div>
  );
};
