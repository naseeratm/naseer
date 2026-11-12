import React, { useState } from 'react';
import {
  Interactive3DViewport,
  ShadingMode,
  ViewPreset,
  CadModelStats,
  BoundaryMarker,
} from './Interactive3DViewport';

interface ViewportCanvasProps {
  title: string;
  subtitle?: string;
  showMeshOverlay?: boolean;
  field?: string;
  onCadLoaded?: (stats: CadModelStats) => void;
  onBoundaryAdded?: (marker: BoundaryMarker) => void;
  // When provided (e.g. a 2D scalar field result) it renders inside the viewport container
  children?: React.ReactNode;
  overlay?: React.ReactNode;
}

export const ViewportCanvas: React.FC<ViewportCanvasProps> = ({
  title,
  subtitle,
  showMeshOverlay = false,
  field,
  onCadLoaded,
  onBoundaryAdded,
  children,
  overlay,
}) => {
  const [preset, setPreset] = useState<ViewPreset>('iso');
  const detectedField =
    field ||
    (subtitle?.toLowerCase().includes('fea') || subtitle?.toLowerCase().includes('structural')
      ? 'FEA'
      : subtitle?.toLowerCase().includes('thermal')
      ? 'Thermal'
      : 'CFD');

  return (
    <div className="print-reset relative min-h-0 flex-1 overflow-hidden bg-[#0a0f1c]">
      {/* Primary Viewport Area */}
      <div className="absolute inset-0 h-full w-full">
        {children ? (
          <div className="flex h-full w-full items-center justify-center p-4">
            {children}
          </div>
        ) : (
          <Interactive3DViewport
            field={detectedField}
            showMeshOverlay={showMeshOverlay}
            activePreset={preset}
            onPresetChange={setPreset}
            onCadLoaded={onCadLoaded}
            onBoundaryAdded={onBoundaryAdded}
          />
        )}
      </div>

      {/* Top-Left Model & Field Breadcrumbs */}
      <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[32%] select-none rounded-lg border border-slate-800/80 bg-slate-950/80 px-2.5 py-1.5 backdrop-blur-md shadow-lg">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="truncate text-[12px] font-bold text-slate-100">{title}</span>
        </div>
        {subtitle && (
          <div className="truncate font-mono text-[10px] text-slate-400 mt-0.5">
            {subtitle}
          </div>
        )}
      </div>

      {/* Optional Fullscreen Document / Overlay */}
      {overlay}
    </div>
  );
};
