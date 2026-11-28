import React, { useState } from 'react';
import {
  Interactive3DViewport,
  ViewPreset,
  CadModelStats,
  BoundaryMarker,
} from './Interactive3DViewport';
import { MeshQualityReport, VtkFieldPayload } from '../types/thesis';
import { JobStatus } from '../types/studio';
import { ViewportHealthDashboard, LiveJobTelemetry } from './ViewportHealthDashboard';

interface ViewportCanvasProps {
  title: string;
  subtitle?: string;
  showMeshOverlay?: boolean;
  field?: string;
  vtkData?: VtkFieldPayload | null;
  meshPreviewVtk?: VtkFieldPayload | null;
  integrals?: Record<string, number | string> | null;
  cadLoading?: boolean;
  selectedMarkerId?: string | null;
  highlightedPatchName?: string | null;
  highlightedBodyIndex?: number | null;
  hasSolvedResults?: boolean;
  solvedTaskId?: string | null;
  meshQuality?: MeshQualityReport | null;
  onCadLoaded?: (stats: CadModelStats) => void;
  onCadStlUploaded?: (file: { name: string; base64: string; stats: CadModelStats }) => void;
  onCadFileUploaded?: (file: { name: string; base64: string; ext: string; stats?: CadModelStats }) => void;
  onBoundaryAdded?: (marker: BoundaryMarker) => void;
  onBoundaryMarkersChange?: (markers: BoundaryMarker[]) => void;
  onRegionChange?: (bounds: { min: [number, number, number]; max: [number, number, number] } | null) => void;
  children?: React.ReactNode;
  overlay?: React.ReactNode;
  jobStatus?: JobStatus;
  activeTaskId?: string | null;
  solverProgress?: number | null;
  currentIteration?: number | null;
  liveJobTelemetry?: LiveJobTelemetry | null;
  jobWallClockSec?: number | null;
  lastCompletedDurationSec?: number | null;
  solverLabel?: string;
}

export const ViewportCanvas: React.FC<ViewportCanvasProps> = ({
  title,
  subtitle,
  showMeshOverlay = false,
  field,
  vtkData = null,
  meshPreviewVtk = null,
  integrals = null,
  cadLoading = false,
  selectedMarkerId = null,
  highlightedPatchName = null,
  highlightedBodyIndex = null,
  hasSolvedResults = false,
  solvedTaskId = null,
  meshQuality = null,
  onCadLoaded,
  onCadStlUploaded,
  onCadFileUploaded,
  onBoundaryAdded,
  onBoundaryMarkersChange,
  onRegionChange,
  children,
  overlay,
  jobStatus = 'idle',
  activeTaskId = null,
  solverProgress = null,
  currentIteration = null,
  liveJobTelemetry = null,
  jobWallClockSec = null,
  lastCompletedDurationSec = null,
  solverLabel,
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
            vtkData={vtkData}
            meshPreviewVtk={meshPreviewVtk}
            integrals={integrals}
            cadLoading={cadLoading}
            selectedMarkerId={selectedMarkerId}
            highlightedPatchName={highlightedPatchName}
            highlightedBodyIndex={highlightedBodyIndex}
            hasSolvedResults={hasSolvedResults}
            solvedTaskId={solvedTaskId}
            meshQuality={meshQuality}
            onPresetChange={setPreset}
            onCadLoaded={onCadLoaded}
            onCadStlUploaded={onCadStlUploaded}
            onCadFileUploaded={onCadFileUploaded}
            onBoundaryAdded={onBoundaryAdded}
            onBoundaryMarkersChange={onBoundaryMarkersChange}
            onRegionChange={onRegionChange}
          />
        )}
      </div>

      {/* Top-Left Model & Field Breadcrumbs */}
      <div className="pointer-events-none absolute left-3 top-3 z-20 max-w-[32%] select-none rounded-lg border border-slate-800 bg-slate-950/90 px-2.5 py-1.5 shadow-lg">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          <span className="truncate text-[12px] font-bold text-slate-100">{title}</span>
        </div>
        {subtitle && (
          <div className="truncate font-mono text-[10px] text-slate-400 mt-0.5">
            {subtitle}
          </div>
        )}
      </div>

      {/* Floating Real-Time HPC Simulation Health & Performance Dashboard (Zero-Mock) */}
      <ViewportHealthDashboard
        jobStatus={jobStatus}
        activeTaskId={activeTaskId}
        solverProgress={solverProgress}
        currentIteration={currentIteration}
        liveJobTelemetry={liveJobTelemetry}
        jobWallClockSec={jobWallClockSec}
        lastCompletedDurationSec={lastCompletedDurationSec}
        solverLabel={solverLabel}
      />

      {/* Optional Fullscreen Document / Overlay */}
      {overlay}
    </div>
  );
};
