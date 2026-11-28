import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Box,
  Download,
  Flame,
  Layers,
  Loader2,
  Navigation,
  Palette,
  RefreshCw,
} from 'lucide-react';
import { ThesisProject } from '../types/thesis';
import { buildRealReport, hasRealSimulationRun, renderMatrixToImage } from '../utils/exporter';
import { formatNumber } from '../utils/numberFormat';
import {
  ParsedNsr1Payload,
  VolumetricMetadata,
  fetchIsoSurfaceBinary,
  fetchVolumetricMetadata,
} from '../utils/nsr1Binary';
import {
  ColormapName,
  PlotLayoutBox,
  PostViewMode,
  ProjectionPlane,
  computeScalarGradientField,
  exportHighResPostMapPng,
  extractVtkProjectedVectors,
  renderPostProcessingCanvas,
  sampleColormap,
} from '../utils/postProcessingMaps';
import { EmptyState } from './EmptyState';
import { IsoSurface3DViewer } from './IsoSurface3DViewer';

interface ContoursTabProps {
  project: ThesisProject;
}

interface ProbeReading {
  x: number;
  y: number;
  scalarVal?: number;
  scalarUnit?: string;
  gradMag?: number;
  gradUnit?: string;
  vx?: number;
  vy?: number;
  vecUnit?: string;
}

const formatValue = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) ? formatNumber(value) : '—';

function parseThermalConductivity(project: ThesisProject): number | undefined {
  const req = project.simulationRun?.submittedRequest as Record<string, unknown> | undefined;
  const candidates = [
    req?.thermal_conductivity,
    req?.thermal_conductivity_k,
    project.normalizedSolverResult?.values?.thermal_conductivity,
    project.normalizedSolverResult?.values?.thermal_conductivity_k,
    project.material?.thermalConductivity,
  ];
  for (const raw of candidates) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
    if (typeof raw === 'string') {
      const m = raw.match(/[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/);
      if (m) {
        const n = Number(m[0]);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return undefined;
}

// Contours, Temperature Gradient Maps, and Vector Fields come exclusively from the completed solver run.
export const ContoursTab: React.FC<ContoursTabProps> = ({ project }) => {
  const hasRun = hasRealSimulationRun(project);

  const report = useMemo(() => (hasRun ? buildRealReport(project) : null), [project, hasRun]);
  const matrices = report?.matrices ?? [];
  const vtkData = project.normalizedSolverResult?.vtkData;

  const availableVtkVectorKeys = useMemo(() => {
    if (!vtkData?.vectors) return [] as string[];
    return Object.entries(vtkData.vectors)
      .filter(([, arr]) => Array.isArray(arr) && arr.length >= 3)
      .map(([key]) => key);
  }, [vtkData]);

  const thermalConductivity = useMemo(() => parseThermalConductivity(project), [project]);

  const [selectedMatrixKey, setSelectedMatrixKey] = useState<string>('');
  const [selectedVtkVectorKey, setSelectedVtkVectorKey] = useState<string>('');
  const [viewMode, setViewMode] = useState<PostViewMode>('scalar');
  const [palette, setPalette] = useState<ColormapName>('turbo');
  const [plane, setPlane] = useState<ProjectionPlane>('XY');
  const [showIsocontours, setShowIsocontours] = useState<boolean>(true);
  const [showVectorOverlay, setShowVectorOverlay] = useState<boolean>(true);
  const [vectorDensity, setVectorDensity] = useState<'sparse' | 'medium' | 'dense'>('medium');
  const [vectorScale, setVectorScale] = useState<number>(1.0);
  const [exportTheme, setExportTheme] = useState<'light' | 'dark'>('light');
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeReading | null>(null);

  // 3D Volumetric Iso-Surface state (backed strictly by /api/jobs/{taskId}/post/metadata & isosurface.bin)
  const activeTaskId = project.simulationRun?.taskId || report?.jobId || null;
  const [volMeta, setVolMeta] = useState<VolumetricMetadata | null>(null);
  const [volMetaLoading, setVolMetaLoading] = useState<boolean>(false);
  const [volMetaError, setVolMetaError] = useState<string | null>(null);
  const [isoField, setIsoField] = useState<string>('');
  const [isoValueInput, setIsoValueInput] = useState<string>('');
  const [isoOpacity, setIsoOpacity] = useState<number>(0.88);
  const [isoWireframe, setIsoWireframe] = useState<boolean>(false);
  const [isoLoading, setIsoLoading] = useState<boolean>(false);
  const [isoError, setIsoError] = useState<string | null>(null);
  const [isoMesh, setIsoMesh] = useState<ParsedNsr1Payload | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const layoutBoxRef = useRef<PlotLayoutBox | null>(null);

  const loadVolumeMetadata = useCallback(
    async (signal?: AbortSignal) => {
      if (!activeTaskId) {
        setVolMeta(null);
        setVolMetaError(null);
        return;
      }
      setVolMetaLoading(true);
      setVolMetaError(null);
      try {
        const meta = await fetchVolumetricMetadata(activeTaskId, signal);
        setVolMeta(meta);
        if (meta.scalars.length > 0) {
          setIsoField((prev) => {
            const exists = meta.scalars.some((s) => s.name === prev);
            const chosen = exists ? meta.scalars.find((s) => s.name === prev)! : meta.scalars[0];
            const midpoint = 0.5 * (chosen.min + chosen.max);
            setIsoValueInput((cur) => (cur && exists ? cur : Number(midpoint.toPrecision(6)).toString()));
            return chosen.name;
          });
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setVolMeta(null);
        setVolMetaError(err instanceof Error ? err.message : 'Unable to probe 3D volume metadata.');
      } finally {
        setVolMetaLoading(false);
      }
    },
    [activeTaskId],
  );

  useEffect(() => {
    setIsoMesh(null);
    setIsoError(null);
    if (!activeTaskId) {
      setVolMeta(null);
      setVolMetaError(null);
      return;
    }
    const ctrl = new AbortController();
    loadVolumeMetadata(ctrl.signal);
    return () => ctrl.abort();
  }, [activeTaskId, loadVolumeMetadata]);

  const selectedVolScalar = useMemo(() => {
    if (!volMeta?.scalars?.length) return null;
    return volMeta.scalars.find((s) => s.name === isoField) ?? volMeta.scalars[0];
  }, [volMeta, isoField]);

  const handleIsoFieldChange = (nextField: string) => {
    setIsoField(nextField);
    setIsoError(null);
    const match = volMeta?.scalars?.find((s) => s.name === nextField);
    if (match && Number.isFinite(match.min) && Number.isFinite(match.max)) {
      const mid = 0.5 * (match.min + match.max);
      setIsoValueInput(Number(mid.toPrecision(6)).toString());
    }
  };

  const handleExtractIsoSurface = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTaskId) {
      setIsoError('No persisted backend job task_id is linked to this run.');
      return;
    }
    const fieldName = isoField.trim();
    const numericVal = Number(isoValueInput);
    if (!fieldName) {
      setIsoError('Select or enter a real scalar field name (e.g. T, p, U_mag, von_mises).');
      return;
    }
    if (!Number.isFinite(numericVal)) {
      setIsoError('Enter a finite numeric iso-value.');
      return;
    }

    setIsoLoading(true);
    setIsoError(null);
    try {
      const payload = await fetchIsoSurfaceBinary(activeTaskId, fieldName, numericVal);
      setIsoMesh(payload);
    } catch (err) {
      setIsoError(err instanceof Error ? err.message : 'Iso-surface extraction failed.');
    } finally {
      setIsoLoading(false);
    }
  };

  const isoSurfaceColorHex = useMemo(() => {
    const fMin = isoMesh?.metadata.field_min ?? selectedVolScalar?.min;
    const fMax = isoMesh?.metadata.field_max ?? selectedVolScalar?.max;
    const val = isoMesh?.metadata.iso_value ?? Number(isoValueInput);
    const t =
      fMin !== undefined && fMax !== undefined && Number.isFinite(val) && fMax > fMin
        ? Math.max(0, Math.min(1, (val - fMin) / (fMax - fMin)))
        : 0.6;
    const [r, g, b] = sampleColormap(t, palette);
    return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }, [isoMesh, selectedVolScalar, isoValueInput, palette]);

  const activeMatrix = useMemo(() => {
    if (matrices.length === 0) return null;
    return matrices.find((m) => m.key === selectedMatrixKey) ?? matrices[0];
  }, [matrices, selectedMatrixKey]);

  const activeVtkKey = useMemo(() => {
    if (availableVtkVectorKeys.length === 0) return '';
    return availableVtkVectorKeys.includes(selectedVtkVectorKey) ? selectedVtkVectorKey : availableVtkVectorKeys[0];
  }, [availableVtkVectorKeys, selectedVtkVectorKey]);

  const gradientField = useMemo(
    () => (activeMatrix ? computeScalarGradientField(activeMatrix, thermalConductivity) : null),
    [activeMatrix, thermalConductivity],
  );

  const vtkVectorField = useMemo(
    () => (activeVtkKey ? extractVtkProjectedVectors(vtkData, activeVtkKey, plane, 22) : null),
    [vtkData, activeVtkKey, plane],
  );

  const hasGradientSource = gradientField !== null;
  const hasVectorSource = vtkVectorField !== null || gradientField !== null;

  // Keep viewMode valid if switching projects/runs
  useEffect(() => {
    if (viewMode === 'gradient' && !hasGradientSource) {
      setViewMode(hasVectorSource ? 'vectors' : 'scalar');
    } else if (viewMode === 'vectors' && !hasVectorSource) {
      setViewMode('scalar');
    } else if (viewMode === 'scalar' && !activeMatrix && vtkVectorField) {
      setViewMode('vectors');
    }
  }, [viewMode, hasGradientSource, hasVectorSource, activeMatrix, vtkVectorField]);

  const buildRenderSpec = (theme: 'dark' | 'light') => {
    const solverName = project.normalizedSolverResult?.solver ?? report?.simulationTypeLabel ?? 'CAE Solver';
    const jobTag = report?.jobId ? ` · Job ${report.jobId.slice(0, 10)}` : '';

    if (viewMode === 'gradient' && activeMatrix && gradientField) {
      const isTemp = activeMatrix.key === 'temperature_matrix' || activeMatrix.label.toLowerCase().includes('temperature');
      return {
        title: isTemp
          ? `Temperature Gradient Magnitude |∇T| (${gradientField.gradientUnit})`
          : `Spatial Gradient Magnitude |∇φ| — ${activeMatrix.label}`,
        subtitle: `${solverName}${jobTag} · Grid ${gradientField.cols}×${gradientField.rows} · Max |∇| = ${formatNumber(gradientField.maxMag)} ${gradientField.gradientUnit}`,
        palette,
        theme,
        showIsocontours,
        showVectors: showVectorOverlay,
        vectorDensity,
        vectorScale,
        scalarGrid: {
          data: gradientField.magnitude,
          min: gradientField.minMag,
          max: gradientField.maxMag,
          mean: gradientField.meanMag,
          unit: gradientField.gradientUnit,
          widthM: gradientField.widthM,
          heightM: gradientField.heightM,
          physicalDimensions: gradientField.physicalDimensions,
        },
        matrixVectors: {
          vecX: gradientField.vecX,
          vecY: gradientField.vecY,
          maxMag: gradientField.conductivityUsed
            ? gradientField.maxMag * gradientField.conductivityUsed
            : gradientField.maxMag,
          unit: gradientField.vectorUnit,
        },
      };
    }

    if (viewMode === 'vectors') {
      if (vtkVectorField) {
        return {
          title: `${vtkVectorField.label} (${plane} Projection)`,
          subtitle: `${solverName}${jobTag} · ${vtkVectorField.nodeCount.toLocaleString()} real solver nodes · Max |v| = ${formatNumber(vtkVectorField.maxMag)} ${vtkVectorField.unit}`,
          palette,
          theme,
          showIsocontours: false,
          showVectors: true,
          vectorDensity,
          vectorScale,
          vtkVectors: vtkVectorField,
        };
      }
      if (activeMatrix && gradientField) {
        return {
          title: `${gradientField.vectorLabel} (${gradientField.vectorUnit})`,
          subtitle: `${solverName}${jobTag} · Derived from real ${activeMatrix.label} (${gradientField.cols}×${gradientField.rows})`,
          palette,
          theme,
          showIsocontours,
          showVectors: true,
          vectorDensity,
          vectorScale,
          scalarGrid: {
            data: activeMatrix.data,
            min: activeMatrix.min,
            max: activeMatrix.max,
            mean: activeMatrix.mean,
            unit: activeMatrix.unit ?? '',
            widthM: gradientField.widthM,
            heightM: gradientField.heightM,
            physicalDimensions: gradientField.physicalDimensions,
          },
          matrixVectors: {
            vecX: gradientField.vecX,
            vecY: gradientField.vecY,
            maxMag: gradientField.conductivityUsed
              ? gradientField.maxMag * gradientField.conductivityUsed
              : gradientField.maxMag,
            unit: gradientField.vectorUnit,
          },
        };
      }
    }

    // Default: Scalar Contour
    if (activeMatrix) {
      const hasPhys = Boolean(activeMatrix.widthM && activeMatrix.heightM);
      return {
        title: `${activeMatrix.label}${activeMatrix.unit ? ` (${activeMatrix.unit})` : ''}`,
        subtitle: `${solverName}${jobTag} · Grid ${activeMatrix.cols}×${activeMatrix.rows} · Range [${formatNumber(activeMatrix.min)}, ${formatNumber(activeMatrix.max)}] ${activeMatrix.unit ?? ''}`,
        palette,
        theme,
        showIsocontours,
        showVectors: showVectorOverlay && Boolean(gradientField),
        vectorDensity,
        vectorScale,
        scalarGrid: {
          data: activeMatrix.data,
          min: activeMatrix.min,
          max: activeMatrix.max,
          mean: activeMatrix.mean,
          unit: activeMatrix.unit ?? '',
          widthM: hasPhys ? activeMatrix.widthM! : 1,
          heightM: hasPhys ? activeMatrix.heightM! : 1,
          physicalDimensions: hasPhys,
        },
        matrixVectors:
          showVectorOverlay && gradientField
            ? {
                vecX: gradientField.vecX,
                vecY: gradientField.vecY,
                maxMag: gradientField.conductivityUsed
                  ? gradientField.maxMag * gradientField.conductivityUsed
                  : gradientField.maxMag,
                unit: gradientField.vectorUnit,
              }
            : undefined,
      };
    }

    return null;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const spec = buildRenderSpec('dark');
    if (!spec) return;
    layoutBoxRef.current = renderPostProcessingCanvas({ ...spec, canvas });
  });

  const handleMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const box = layoutBoxRef.current;
    if (!canvas || !box) return;
    const rect = canvas.getBoundingClientRect();
    const cx = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const cy = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const nx = (cx - box.plotX) / box.plotW;
    const ny = 1 - (cy - box.plotY) / box.plotH;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) {
      setProbe(null);
      return;
    }

    if (viewMode === 'vectors' && vtkVectorField) {
      const u = vtkVectorField.uMin + nx * (vtkVectorField.uMax - vtkVectorField.uMin);
      const v = vtkVectorField.vMin + ny * (vtkVectorField.vMax - vtkVectorField.vMin);
      let best = vtkVectorField.samples[0];
      let bestDist = Infinity;
      for (const s of vtkVectorField.samples) {
        const d = Math.hypot(s.u - u, s.v - v);
        if (d < bestDist) {
          bestDist = d;
          best = s;
        }
      }
      setProbe(
        best
          ? { x: best.u, y: best.v, vx: best.vx, vy: best.vy, vecUnit: vtkVectorField.unit }
          : { x: u, y: v },
      );
      return;
    }

    if (activeMatrix) {
      const r = Math.min(activeMatrix.rows - 1, Math.max(0, Math.round(ny * (activeMatrix.rows - 1))));
      const c = Math.min(activeMatrix.cols - 1, Math.max(0, Math.round(nx * (activeMatrix.cols - 1))));
      const x = gradientField ? c * gradientField.dx : nx;
      const y = gradientField ? r * gradientField.dy : ny;
      setProbe({
        x,
        y,
        scalarVal: activeMatrix.data[r]?.[c],
        scalarUnit: activeMatrix.unit,
        gradMag: gradientField?.magnitude[r]?.[c],
        gradUnit: gradientField?.gradientUnit,
        vx: gradientField?.vecX[r]?.[c],
        vy: gradientField?.vecY[r]?.[c],
        vecUnit: gradientField?.vectorUnit,
      });
    }
  };

  const handleExportPng = async () => {
    const spec = buildRenderSpec(exportTheme);
    if (!spec) return;
    setExporting(true);
    setExportNotice(null);
    try {
      const stem = String(project.id || 'naseer').replace(/[^A-Za-z0-9_-]+/g, '_');
      const fieldTag = viewMode === 'vectors' && vtkVectorField ? vtkVectorField.key : activeMatrix?.key ?? 'field';
      const filename = `${stem}_${viewMode}_${fieldTag}_300dpi.png`;
      await exportHighResPostMapPng(spec, filename);
      setExportNotice(`تم تصدير الصورة عالية الدقة (2400×1500 px · 300 DPI): ${filename}`);
      setTimeout(() => setExportNotice(null), 4000);
    } catch (err) {
      setExportNotice(err instanceof Error ? err.message : 'فشل تصدير الصورة.');
    } finally {
      setExporting(false);
    }
  };

  const secondaryFields = useMemo(() => {
    if (!report) return [];
    return report.matrices
      .filter((m) => m.key !== activeMatrix?.key)
      .map((matrix) => ({ matrix, image: renderMatrixToImage(matrix) }));
  }, [report, activeMatrix]);

  const has2DFields = matrices.length > 0 || availableVtkVectorKeys.length > 0;

  if (!hasRun || !report) {
    return (
      <EmptyState
        icon={Palette}
        message="No data available. Please run a simulation to view Contours, Temperature Gradient Maps, Vector Fields, and 3D Iso-Surfaces."
      />
    );
  }

  const renderIsoSurfaceSection = () => {
    const parsedIsoNum = Number(isoValueInput);
    const sliderMin = selectedVolScalar?.min ?? 0;
    const sliderMax = selectedVolScalar?.max ?? 1;
    const sliderSpan = sliderMax - sliderMin;
    const canSlide = Boolean(selectedVolScalar && Number.isFinite(sliderSpan) && sliderSpan > 0);
    const sliderStep = canSlide ? sliderSpan / 200 : 0.01;
    const sliderVal = Number.isFinite(parsedIsoNum)
      ? Math.max(sliderMin, Math.min(sliderMax, parsedIsoNum))
      : 0.5 * (sliderMin + sliderMax);

    return (
      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div className="space-y-0.5">
            <h2 className="text-[13px] font-semibold text-slate-100">
              3D Volumetric Iso-Surface Extraction (PyVista / VTK)
            </h2>
            <p className="text-[11.5px] text-slate-400">
              Extracts real 3D Marching-Cubes contours from solver volume meshes via{' '}
              <code className="font-mono text-[11px] text-slate-300">/api/jobs/{'{taskId}'}/post/isosurface.bin</code>{' '}
              and streams binary NSR1 geometry directly to WebGL.
            </p>
          </div>

          <div className="flex items-center gap-2 text-[11.5px] text-slate-400">
            {activeTaskId && (
              <span className="font-mono tabular-nums text-slate-400">
                Job {activeTaskId.slice(0, 12)}
              </span>
            )}
            <button
              type="button"
              disabled={!activeTaskId || volMetaLoading}
              onClick={() => loadVolumeMetadata()}
              className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11.5px] font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-45 whitespace-nowrap"
            >
              <RefreshCw className={`h-3.5 w-3.5 shrink-0 ${volMetaLoading ? 'animate-spin' : ''}`} />
              <span>{volMetaLoading ? 'Probing Volume…' : 'Probe Volume Fields'}</span>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {!activeTaskId ? (
            <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3.5 py-3 text-[12px] text-slate-400">
              This run does not have a persisted backend <code className="font-mono text-slate-300">task_id</code> (direct in-memory execution). Run the simulation in Celery/Docker mode to enable server-side 3D volumetric iso-surface extraction.
            </div>
          ) : (
            <>
              {volMeta && (
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] font-mono tabular-nums text-slate-400">
                  <span>Source: {volMeta.source_file ?? 'Solver VTK'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{volMeta.cell_count.toLocaleString()} cells</span>
                  <span aria-hidden="true">·</span>
                  <span>{volMeta.point_count.toLocaleString()} points</span>
                  <span aria-hidden="true">·</span>
                  <span>{volMeta.scalars.length} scalar field(s)</span>
                </div>
              )}

              {volMetaError && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-950/25 px-3.5 py-2.5 text-[11.5px] text-amber-200">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{volMetaError}</span>
                </div>
              )}

              <form onSubmit={handleExtractIsoSurface} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
                  {/* Field Selector or Manual Field Input */}
                  <div className="md:col-span-4 space-y-1">
                    <label htmlFor="iso-field-input" className="block text-[11px] font-medium text-slate-400">
                      Scalar Field
                    </label>
                    {volMeta && volMeta.scalars.length > 0 ? (
                      <select
                        id="iso-field-input"
                        value={isoField}
                        onChange={(e) => handleIsoFieldChange(e.target.value)}
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-[12px] text-slate-100 focus:border-sky-500 focus:outline-none"
                      >
                        {volMeta.scalars.map((s) => (
                          <option key={s.name} value={s.name}>
                            {s.name} [{formatNumber(s.min)} … {formatNumber(s.max)}]
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id="iso-field-input"
                        type="text"
                        value={isoField}
                        onChange={(e) => setIsoField(e.target.value)}
                        placeholder="e.g. T, p, U_mag, von_mises"
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-[12px] font-mono text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                      />
                    )}
                  </div>

                  {/* Iso-Value Numeric Input */}
                  <div className="md:col-span-3 space-y-1">
                    <label htmlFor="iso-value-input" className="block text-[11px] font-medium text-slate-400">
                      Iso-Value
                    </label>
                    <input
                      id="iso-value-input"
                      type="number"
                      step="any"
                      value={isoValueInput}
                      onChange={(e) => setIsoValueInput(e.target.value)}
                      placeholder="Numeric threshold"
                      className="w-full rounded-md border border-slate-700 bg-slate-950 px-2.5 py-2 text-[12px] font-mono tabular-nums text-slate-100 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                    />
                  </div>

                  {/* Surface Styling Controls */}
                  <div className="md:col-span-3 flex items-center gap-3 py-1.5">
                    <label className="flex flex-1 items-center gap-2 text-[11px] text-slate-400">
                      <span className="whitespace-nowrap">Opacity</span>
                      <input
                        type="range"
                        min={0.3}
                        max={1}
                        step={0.05}
                        value={isoOpacity}
                        onChange={(e) => setIsoOpacity(Number(e.target.value))}
                        className="w-full accent-sky-500"
                      />
                      <span className="font-mono tabular-nums text-slate-200">{Math.round(isoOpacity * 100)}%</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-[11.5px] text-slate-300 cursor-pointer whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={isoWireframe}
                        onChange={(e) => setIsoWireframe(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 accent-sky-500"
                      />
                      <span>Wireframe</span>
                    </label>
                  </div>

                  {/* Submit Action */}
                  <div className="md:col-span-2">
                    <button
                      type="submit"
                      disabled={isoLoading || !isoField.trim() || isoValueInput.trim() === ''}
                      className="flex w-full items-center justify-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-45 whitespace-nowrap"
                    >
                      {isoLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                      ) : (
                        <Box className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span>{isoLoading ? 'Extracting…' : 'Extract Iso-Surface'}</span>
                    </button>
                  </div>
                </div>

                {/* Synchronized Real-Range Slider & Quick Presets when metadata bounds exist */}
                {canSlide && selectedVolScalar && (
                  <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-800/80 bg-slate-950/50 px-3 py-2">
                    <span className="font-mono text-[11px] tabular-nums text-slate-500">
                      {formatNumber(sliderMin)}
                    </span>
                    <input
                      aria-label="Iso-value range slider"
                      type="range"
                      min={sliderMin}
                      max={sliderMax}
                      step={sliderStep}
                      value={sliderVal}
                      onChange={(e) => setIsoValueInput(Number(Number(e.target.value).toPrecision(6)).toString())}
                      className="min-w-[140px] flex-1 accent-sky-500"
                    />
                    <span className="font-mono text-[11px] tabular-nums text-slate-500">
                      {formatNumber(sliderMax)}
                    </span>
                    <div className="flex items-center gap-1">
                      {[0.25, 0.5, 0.75].map((frac) => (
                        <button
                          key={frac}
                          type="button"
                          onClick={() => {
                            const target = sliderMin + frac * sliderSpan;
                            setIsoValueInput(Number(target.toPrecision(6)).toString());
                          }}
                          className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[10.5px] text-slate-300 transition-colors hover:border-sky-500/60 hover:text-white"
                        >
                          {Math.round(frac * 100)}%
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </form>

              {isoError && (
                <div className="flex items-start gap-2 rounded-md border border-rose-500/35 bg-rose-950/30 px-3.5 py-2.5 text-[12px] text-rose-200">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                  <span>{isoError}</span>
                </div>
              )}

              {isoMesh && (
                <IsoSurface3DViewer
                  meshPayload={isoMesh}
                  surfaceColorHex={isoSurfaceColorHex}
                  opacity={isoOpacity}
                  wireframe={isoWireframe}
                  domainBounds={volMeta?.bounds ?? null}
                />
              )}
            </>
          )}
        </div>
      </section>
    );
  };

  if (!has2DFields) {
    return (
      <div className="mx-auto max-w-5xl space-y-5">
        {renderIsoSurfaceSection()}
        <EmptyState
          icon={Palette}
          title="No 2-D scalar or vector matrices returned in this run"
          message="This 3-D simulation did not include a 2-D planar matrix; use the 3-D Volumetric Iso-Surface extractor above to inspect internal field contours directly from the solver volume."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {/* Main Interactive Post-Processing Studio */}
      <section className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div className="space-y-0.5">
            <h2 className="text-[13px] font-semibold text-slate-100">
              Results &amp; Post-Processing — Gradient Map &amp; Vector Fields
            </h2>
            <p className="text-[11.5px] text-slate-400">
              Computed directly from real solver outputs (finite-difference |∇T| / Fourier q = −k∇T and real VTK vector arrays).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Export theme"
              value={exportTheme}
              onChange={(e) => setExportTheme(e.target.value as 'light' | 'dark')}
              className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11.5px] text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="light">Report PNG (White · 300 DPI)</option>
              <option value="dark">Slide PNG (Dark · 300 DPI)</option>
            </select>

            <button
              type="button"
              disabled={exporting}
              onClick={handleExportPng}
              className="flex items-center gap-1.5 rounded-md bg-sky-600 px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 shrink-0" />
              <span>{exporting ? 'Exporting…' : 'Export High-Res PNG (2400px)'}</span>
            </button>
          </div>
        </div>

        {/* Interactive Mode & Parameter Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/60 px-4 py-2.5 text-[12px]">
          {/* Mode Switcher */}
          <div className="flex items-center gap-1 rounded-md bg-slate-900 p-1 border border-slate-800" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'scalar'}
              disabled={!activeMatrix}
              onClick={() => setViewMode('scalar')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors whitespace-nowrap disabled:opacity-40 ${
                viewMode === 'scalar' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <span>Scalar Contour</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'gradient'}
              disabled={!hasGradientSource}
              onClick={() => setViewMode('gradient')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors whitespace-nowrap disabled:opacity-40 ${
                viewMode === 'gradient' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Flame className="h-3.5 w-3.5 shrink-0" />
              <span>Gradient Map |∇T|</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'vectors'}
              disabled={!hasVectorSource}
              onClick={() => setViewMode('vectors')}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors whitespace-nowrap disabled:opacity-40 ${
                viewMode === 'vectors' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              <Navigation className="h-3.5 w-3.5 shrink-0" />
              <span>Vector Field</span>
            </button>
          </div>

          {/* Field Selector */}
          {viewMode === 'vectors' && availableVtkVectorKeys.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <label htmlFor="vtk-vec-select" className="text-[11px] text-slate-500">Vector</label>
              <select
                id="vtk-vec-select"
                value={activeVtkKey}
                onChange={(e) => setSelectedVtkVectorKey(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11.5px] text-slate-200"
              >
                {availableVtkVectorKeys.map((k) => (
                  <option key={k} value={k}>
                    {k} (Solver 3D VTK)
                  </option>
                ))}
              </select>
              <select
                aria-label="Projection plane"
                value={plane}
                onChange={(e) => setPlane(e.target.value as ProjectionPlane)}
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11.5px] font-mono text-slate-200"
              >
                <option value="XY">XY Plane</option>
                <option value="XZ">XZ Plane</option>
                <option value="YZ">YZ Plane</option>
              </select>
            </div>
          ) : (
            matrices.length > 1 && (
              <div className="flex items-center gap-1.5">
                <label htmlFor="matrix-select" className="text-[11px] text-slate-500">Field</label>
                <select
                  id="matrix-select"
                  value={activeMatrix?.key ?? ''}
                  onChange={(e) => setSelectedMatrixKey(e.target.value)}
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11.5px] text-slate-200"
                >
                  {matrices.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            )
          )}

          {/* Colormap */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="colormap-select" className="text-[11px] text-slate-500">Palette</label>
            <select
              id="colormap-select"
              value={palette}
              onChange={(e) => setPalette(e.target.value as ColormapName)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11.5px] text-slate-200"
            >
              <option value="turbo">Turbo (Scientific)</option>
              <option value="viridis">Viridis (Perceptual)</option>
              <option value="thermal">Thermal / Inferno</option>
              <option value="coolwarm">Coolwarm</option>
            </select>
          </div>

          {/* Isotherms & Vector Controls */}
          {viewMode !== 'vectors' && (
            <>
              <label className="flex items-center gap-1.5 text-[11.5px] text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showIsocontours}
                  onChange={(e) => setShowIsocontours(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-900 accent-sky-500"
                />
                <span>Isocontours</span>
              </label>

              {hasGradientSource && (
                <label className="flex items-center gap-1.5 text-[11.5px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showVectorOverlay}
                    onChange={(e) => setShowVectorOverlay(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 accent-sky-500"
                  />
                  <span>Overlay Vectors</span>
                </label>
              )}
            </>
          )}

          {(viewMode === 'vectors' || (showVectorOverlay && hasGradientSource)) && (
            <div className="flex items-center gap-2">
              <select
                aria-label="Vector density"
                value={vectorDensity}
                onChange={(e) => setVectorDensity(e.target.value as 'sparse' | 'medium' | 'dense')}
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11.5px] text-slate-200"
              >
                <option value="sparse">Arrows: Sparse</option>
                <option value="medium">Arrows: Medium</option>
                <option value="dense">Arrows: Dense</option>
              </select>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span>Scale</span>
                <input
                  type="range"
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={vectorScale}
                  onChange={(e) => setVectorScale(Number(e.target.value))}
                  className="w-16 accent-sky-500"
                />
                <span className="font-mono tabular-nums text-slate-200">{vectorScale.toFixed(1)}×</span>
              </label>
            </div>
          )}
        </div>

        {exportNotice && (
          <div className="border-b border-emerald-500/20 bg-emerald-950/30 px-4 py-2 text-[11.5px] text-emerald-200">
            {exportNotice}
          </div>
        )}

        {/* Canvas + Real Quantitative Telemetry */}
        <div className="p-4 space-y-4">
          <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-950">
            <canvas
              ref={canvasRef}
              width={960}
              height={540}
              onMouseMove={handleMouseMove}
              onMouseLeave={() => setProbe(null)}
              className="block h-auto w-full cursor-crosshair"
            />
          </div>

          {/* Live Cursor Probe Strip */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/70 px-3.5 py-2 text-[11.5px] font-mono tabular-nums">
            {probe ? (
              <div className="flex flex-wrap items-center gap-4 text-slate-200">
                <span className="text-slate-400">
                  Probe ({formatValue(probe.x)}, {formatValue(probe.y)})
                </span>
                {probe.scalarVal !== undefined && (
                  <span>
                    Value: <strong className="text-sky-300">{formatValue(probe.scalarVal)}</strong> {probe.scalarUnit ?? ''}
                  </span>
                )}
                {probe.gradMag !== undefined && (
                  <span>
                    |∇|: <strong className="text-amber-300">{formatValue(probe.gradMag)}</strong> {probe.gradUnit ?? ''}
                  </span>
                )}
                {probe.vx !== undefined && probe.vy !== undefined && (
                  <span>
                    Vector: ({formatValue(probe.vx)}, {formatValue(probe.vy)}) {probe.vecUnit ?? ''}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-slate-500">
                Move cursor over the map to inspect exact real node values, gradient magnitude |∇T|, and vector components.
              </span>
            )}
            <span className="text-slate-500">Source: Real Docker Solver Output</span>
          </div>

          {/* Quantitative Summary Grid */}
          {viewMode === 'vectors' && vtkVectorField ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-[10.5px] text-slate-500">Real Solver Nodes</div>
                <div className="font-mono text-[13px] font-semibold tabular-nums text-slate-100">
                  {vtkVectorField.nodeCount.toLocaleString()}
                </div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-[10.5px] text-slate-500">Min Magnitude</div>
                <div className="font-mono text-[13px] font-semibold tabular-nums text-slate-100">
                  {formatValue(vtkVectorField.minMag)} {vtkVectorField.unit}
                </div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-[10.5px] text-slate-500">Max Magnitude</div>
                <div className="font-mono text-[13px] font-semibold tabular-nums text-sky-300">
                  {formatValue(vtkVectorField.maxMag)} {vtkVectorField.unit}
                </div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-[10.5px] text-slate-500">Mean Magnitude</div>
                <div className="font-mono text-[13px] font-semibold tabular-nums text-slate-100">
                  {formatValue(vtkVectorField.meanMag)} {vtkVectorField.unit}
                </div>
              </div>
            </div>
          ) : activeMatrix ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-[10.5px] text-slate-500">Grid Resolution</div>
                <div className="font-mono text-[13px] font-semibold tabular-nums text-slate-100">
                  {activeMatrix.cols} × {activeMatrix.rows}
                </div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-[10.5px] text-slate-500">
                  {viewMode === 'gradient' ? 'Max Gradient |∇|' : 'Min / Max'}
                </div>
                <div className="font-mono text-[13px] font-semibold tabular-nums text-slate-100">
                  {viewMode === 'gradient' && gradientField
                    ? `${formatValue(gradientField.maxMag)} ${gradientField.gradientUnit}`
                    : `${formatValue(activeMatrix.min)} / ${formatValue(activeMatrix.max)} ${activeMatrix.unit ?? ''}`}
                </div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-[10.5px] text-slate-500">
                  {viewMode === 'gradient' ? 'Mean Gradient |∇|' : 'Field Mean'}
                </div>
                <div className="font-mono text-[13px] font-semibold tabular-nums text-slate-100">
                  {viewMode === 'gradient' && gradientField
                    ? `${formatValue(gradientField.meanMag)} ${gradientField.gradientUnit}`
                    : `${formatValue(activeMatrix.mean)} ${activeMatrix.unit ?? ''}`}
                </div>
              </div>
              <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                <div className="text-[10.5px] text-slate-500">Peak Gradient Location</div>
                <div className="font-mono text-[12px] font-semibold tabular-nums text-amber-300">
                  {gradientField
                    ? `(${formatValue(gradientField.peakCoords.x)}, ${formatValue(gradientField.peakCoords.y)})${gradientField.physicalDimensions ? ' m' : ''}`
                    : '—'}
                </div>
              </div>
            </div>
          ) : null}

          {viewMode === 'vectors' && !vtkVectorField && gradientField && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/25 bg-amber-950/20 px-3.5 py-2 text-[11.5px] text-amber-200/90">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                No 3-D velocity/displacement vector array was returned by this solver run; displaying genuine Fourier heat-flux / negative-gradient vectors derived from the real {activeMatrix?.label}.
              </span>
            </div>
          )}
        </div>
      </section>

      {/* Real Server-Side 3D Volumetric Iso-Surface Extractor & Binary WebGL Visualizer */}
      {renderIsoSurfaceSection()}

      {/* Additional Returned Solver Matrices (if multiple 2D fields were returned) */}
      {secondaryFields.length > 0 && (
        <div className="space-y-4">
          {secondaryFields.map(({ matrix, image }) => (
            <section key={matrix.key} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
              <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
                <h3 className="text-[12px] font-semibold text-slate-200">{matrix.label}</h3>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMatrixKey(matrix.key);
                    setViewMode('scalar');
                  }}
                  className="text-[11.5px] text-sky-400 hover:text-sky-300"
                >
                  Inspect in Gradient / Vector Studio
                </button>
              </div>
              <div className="flex flex-wrap items-start gap-5 p-4">
                {image ? (
                  <img
                    src={image.src}
                    width={image.width}
                    height={image.height}
                    alt={matrix.label}
                    className="max-w-full rounded border border-slate-700 bg-white"
                  />
                ) : (
                  <p className="text-[12px] italic text-slate-500">The field could not be rendered in this environment.</p>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
                  <dt className="text-slate-500">Grid (x × y)</dt>
                  <dd className="font-mono tabular-nums text-slate-200">
                    {matrix.cols} × {matrix.rows} nodes
                  </dd>
                  <dt className="text-slate-500">Minimum</dt>
                  <dd className="font-mono tabular-nums text-slate-200">
                    {formatValue(matrix.min)} {matrix.unit}
                  </dd>
                  <dt className="text-slate-500">Maximum</dt>
                  <dd className="font-mono tabular-nums text-slate-200">
                    {formatValue(matrix.max)} {matrix.unit}
                  </dd>
                  <dt className="text-slate-500">Mean</dt>
                  <dd className="font-mono tabular-nums text-slate-200">
                    {formatValue(matrix.mean)} {matrix.unit}
                  </dd>
                </dl>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
