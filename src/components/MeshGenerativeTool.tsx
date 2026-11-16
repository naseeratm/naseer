import React, { useState, useEffect, useRef } from 'react';
import {
  Grid3X3,
  Play,
  Download,
  CheckCircle2,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Layers,
  X,
  Upload,
  Gauge,
  Activity,
  Box,
  Cpu,
} from 'lucide-react';
import { ThesisProject, VtkFieldPayload } from '../types/thesis';
import { SimulationInputs } from '../types/studio';

interface GmshHistogramBin {
  bin: string;
  count: number;
}

interface GmshPatchItem {
  id: string;
  name: string;
  dim?: number;
  tag?: number;
  center?: number[];
}

interface GmshMeshResult {
  status?: string;
  mesher?: string;
  element_order?: number;
  inflation_layers?: number;
  nodes_count: number;
  elements_count: number;
  volume_elements_count?: number;
  surface_triangles_count?: number;
  min_quality?: number;
  avg_quality?: number;
  max_quality?: number;
  max_skewness?: number;
  msh_path?: string;
  inp_path?: string;
  patches?: GmshPatchItem[];
  quality_histogram?: GmshHistogramBin[];
  vtk_data?: VtkFieldPayload;
}

interface MeshGenerativeToolProps {
  isOpen?: boolean;
  onClose?: () => void;
  currentProject?: ThesisProject | null;
  simulationInputs?: SimulationInputs;
  uploadedCadStl?: { name: string; base64: string } | null;
  onApplyMeshToStudy?: (appliedMeshInfo: {
    elementCount: number;
    nodeCount: number;
    minOrthogonalQuality: number;
    maxSkewness: number;
    description: string;
    vtkData?: VtkFieldPayload;
  }) => void;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const MeshGenerativeTool: React.FC<MeshGenerativeToolProps> = ({
  isOpen = true,
  onClose,
  currentProject,
  simulationInputs,
  uploadedCadStl,
  onApplyMeshToStudy,
}) => {
  const [widthX, setWidthX] = useState<number>(Number(simulationInputs?.widthX) || 1.0);
  const [heightY, setHeightY] = useState<number>(Number(simulationInputs?.heightY) || 0.4);
  const [depthZ, setDepthZ] = useState<number>(Number(simulationInputs?.depthZ) || 0.2);
  const [meshSize, setMeshSize] = useState<number>(Number(simulationInputs?.meshSize) || 0.05);
  const [elementOrder, setElementOrder] = useState<1 | 2>(
    simulationInputs?.elementOrder === '2' ? 2 : 1,
  );
  const [inflationLayers, setInflationLayers] = useState<number>(
    Number(simulationInputs?.inflationLayers) || 0,
  );
  const [firstLayerHeight, setFirstLayerHeight] = useState<number>(
    Number(simulationInputs?.firstLayerHeight) || 0.002,
  );
  const [growthRate, setGrowthRate] = useState<number>(
    Number(simulationInputs?.growthRate) || 1.2,
  );
  const [localCad, setLocalCad] = useState<{ name: string; base64: string } | null>(null);
  const [useProjectCad, setUseProjectCad] = useState<boolean>(true);

  const [gmshStatus, setGmshStatus] = useState<'idle' | 'queued' | 'running' | 'completed' | 'failed'>('idle');
  const [gmshError, setGmshError] = useState<string | null>(null);
  const [gmshResult, setGmshResult] = useState<GmshMeshResult | null>(null);
  const [appliedFeedback, setAppliedFeedback] = useState<string | null>(null);

  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [yaw, setYaw] = useState<number>(0.6);
  const [pitch, setPitch] = useState<number>(0.45);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragMode, setDragMode] = useState<'none' | 'rotate' | 'pan'>('none');
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cadFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!simulationInputs) return;
    const wx = Number(simulationInputs.widthX);
    const hy = Number(simulationInputs.heightY);
    const dz = Number(simulationInputs.depthZ);
    const ms = Number(simulationInputs.meshSize);
    if (Number.isFinite(wx) && wx > 0) setWidthX(wx);
    if (Number.isFinite(hy) && hy > 0) setHeightY(hy);
    if (Number.isFinite(dz) && dz > 0) setDepthZ(dz);
    if (Number.isFinite(ms) && ms > 0) setMeshSize(ms);
  }, [simulationInputs?.widthX, simulationInputs?.heightY, simulationInputs?.depthZ, simulationInputs?.meshSize]);

  const activeCad = localCad ?? (useProjectCad ? uploadedCadStl ?? null : null);

  // Render ONLY real Gmsh 3D wireframe surface mesh from gmshResult.vtk_data
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Subtle engineering grid background
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.25)';
    ctx.lineWidth = 1;
    for (let x = 0; x < rect.width; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
    }
    for (let y = 0; y < rect.height; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }

    const vtk = gmshResult?.vtk_data;
    if (!vtk || !Array.isArray(vtk.points) || vtk.points.length < 9 || !Array.isArray(vtk.triangles) || vtk.triangles.length < 3) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '600 13px Inter, Cairo, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        'لم يتم توليد شبكة ثلاثية الأبعاد بعد — اضغط "Generate Real Gmsh 3D Mesh" للتشبيك عبر Docker',
        rect.width / 2,
        rect.height / 2 - 8,
      );
      ctx.fillStyle = '#64748b';
      ctx.font = '11px monospace';
      ctx.fillText(
        activeCad ? `Source CAD: ${activeCad.name}` : `Parametric Domain: ${widthX} × ${heightY} × ${depthZ} m (h=${meshSize} m)`,
        rect.width / 2,
        rect.height / 2 + 16,
      );
      return;
    }

    const pts = vtk.points;
    const tris = vtk.triangles;
    const nPts = Math.floor(pts.length / 3);
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < nPts; i++) {
      const x = pts[i * 3];
      const y = pts[i * 3 + 1];
      const z = pts[i * 3 + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const diag = Math.max(1e-6, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ));
    const scale = (Math.min(rect.width, rect.height) * 0.72 * zoomLevel) / diag;

    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);

    const projX = new Float32Array(nPts);
    const projY = new Float32Array(nPts);
    const centerX = rect.width * 0.5 + panOffset.x;
    const centerY = rect.height * 0.5 + panOffset.y;

    for (let i = 0; i < nPts; i++) {
      const x0 = pts[i * 3] - cx;
      const y0 = pts[i * 3 + 1] - cy;
      const z0 = pts[i * 3 + 2] - cz;
      const xr = x0 * cosY - z0 * sinY;
      const zr = x0 * sinY + z0 * cosY;
      const yr = y0 * cosP - zr * sinP;
      projX[i] = centerX + xr * scale;
      projY[i] = centerY - yr * scale;
    }

    const triCount = Math.floor(tris.length / 3);
    const step = Math.max(1, Math.ceil(triCount / 25000));
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.72)';
    ctx.fillStyle = 'rgba(14, 165, 233, 0.08)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (let t = 0; t < triCount; t += step) {
      const i0 = tris[t * 3];
      const i1 = tris[t * 3 + 1];
      const i2 = tris[t * 3 + 2];
      if (i0 >= nPts || i1 >= nPts || i2 >= nPts) continue;
      ctx.moveTo(projX[i0], projY[i0]);
      ctx.lineTo(projX[i1], projY[i1]);
      ctx.lineTo(projX[i2], projY[i2]);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }, [gmshResult, zoomLevel, yaw, pitch, panOffset, activeCad, widthX, heightY, depthZ, meshSize, isOpen]);

  if (!isOpen) return null;

  const handleCadFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    setLocalCad({ name: file.name, base64: arrayBufferToBase64(buf) });
    setGmshError(null);
  };

  const handleRunGmshDockerMesher = async () => {
    if (!Number.isFinite(meshSize) || meshSize <= 0) {
      setGmshError('مقاس العنصر الأساسي (h) يجب أن يكون رقماً موجباً.');
      return;
    }
    setGmshStatus('queued');
    setGmshError(null);
    setGmshResult(null);

    try {
      const bodyPayload: Record<string, unknown> = {
        width_x: widthX,
        height_y: heightY,
        depth_z: depthZ,
        mesh_size: meshSize,
        dimension: 3,
        element_order: elementOrder,
        inflation_layers: inflationLayers,
        first_layer_height: firstLayerHeight,
        growth_rate: growthRate,
        execution_mode: 'celery',
      };
      if (activeCad) {
        bodyPayload.cad_file_b64 = activeCad.base64;
        bodyPayload.cad_stl_b64 = activeCad.base64;
        bodyPayload.cad_filename = activeCad.name;
      }

      const res = await fetch('/api/mesh-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const payload = await res.json();
      if (!res.ok || payload?.success === false) {
        throw new Error(payload?.detail || payload?.error || `Gmsh request failed (${res.status})`);
      }

      if (payload?.mesh) {
        setGmshResult(payload.mesh as GmshMeshResult);
        setGmshStatus('completed');
        return;
      }

      const taskId = payload?.task_id as string | undefined;
      if (!taskId) {
        throw new Error('لم يرد task_id ولا بيانات شبكة صالحة من الخادم.');
      }

      setGmshStatus('running');
      const started = Date.now();
      while (Date.now() - started < 120_000) {
        await new Promise((r) => setTimeout(r, 1000));
        const jobRes = await fetch(`/api/jobs/${encodeURIComponent(taskId)}`);
        if (!jobRes.ok) continue;
        const job = await jobRes.json();
        const st = String(job.status || '').toUpperCase();
        if (st === 'COMPLETED') {
          const meshData = job.result?.mesh ?? job.result?.data ?? job.result;
          if (!meshData || !meshData.elements_count) {
            throw new Error('اكتمال المهمة دون إرجاع عناصر شبكة صالحة من Gmsh.');
          }
          setGmshResult(meshData as GmshMeshResult);
          setGmshStatus('completed');
          return;
        }
        if (st === 'FAILED' || st === 'CANCELLED') {
          throw new Error(String(job.error || `فشل تشبيك Gmsh داخل حاوية worker`));
        }
      }
      throw new Error('انتهت مهلة انتظار تشبيك Gmsh في Celery.');
    } catch (err: unknown) {
      setGmshStatus('failed');
      setGmshError(err instanceof Error ? err.message : 'تعذر تشغيل محرك Gmsh على المنفذ :8000.');
    }
  };

  const handleApplyToActiveStudy = () => {
    if (!gmshResult || !onApplyMeshToStudy) return;
    onApplyMeshToStudy({
      elementCount: gmshResult.elements_count,
      nodeCount: gmshResult.nodes_count,
      minOrthogonalQuality: gmshResult.min_quality ?? 0,
      maxSkewness: gmshResult.max_skewness ?? 0,
      description: `شبكة Gmsh 3D حقيقية (Order ${gmshResult.element_order ?? elementOrder}, ${gmshResult.elements_count} عنصر, جودة دنيا ${gmshResult.min_quality ?? '—'})`,
      vtkData: gmshResult.vtk_data,
    });
    setAppliedFeedback('تم اعتماد شبكة Gmsh الثلاثية الأبعاد الحقيقية في المشروع النشط!');
    setTimeout(() => setAppliedFeedback(null), 3500);
  };

  const handleExportRealSurfaceSTL = () => {
    const vtk = gmshResult?.vtk_data;
    if (!vtk || !vtk.points.length || !vtk.triangles.length) return;
    const lines: string[] = ['solid gmsh_surface'];
    const tris = vtk.triangles;
    const pts = vtk.points;
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const i0 = tris[t] * 3;
      const i1 = tris[t + 1] * 3;
      const i2 = tris[t + 2] * 3;
      if (i2 + 2 >= pts.length) break;
      const ax = pts[i1] - pts[i0], ay = pts[i1 + 1] - pts[i0 + 1], az = pts[i1 + 2] - pts[i0 + 2];
      const bx = pts[i2] - pts[i0], by = pts[i2 + 1] - pts[i0 + 1], bz = pts[i2 + 2] - pts[i0 + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      lines.push(`  facet normal ${(nx / len).toExponential(5)} ${(ny / len).toExponential(5)} ${(nz / len).toExponential(5)}`);
      lines.push('    outer loop');
      lines.push(`      vertex ${pts[i0]} ${pts[i0 + 1]} ${pts[i0 + 2]}`);
      lines.push(`      vertex ${pts[i1]} ${pts[i1 + 1]} ${pts[i1 + 2]}`);
      lines.push(`      vertex ${pts[i2]} ${pts[i2 + 1]} ${pts[i2 + 2]}`);
      lines.push('    endloop');
      lines.push('  endfacet');
    }
    lines.push('endsolid gmsh_surface');
    const blob = new Blob([lines.join('\n')], { type: 'model/stl;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gmsh_surface_${gmshResult.elements_count}elems.stl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const totalQualityCount = (gmshResult?.quality_histogram || []).reduce((acc, b) => acc + b.count, 0) || 1;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-slate-100">
      {/* Header */}
      <header className="px-5 py-3 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Grid3X3 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-sm sm:text-base text-white">
                مولد الشبيكات الحقيقي ثلاثي الأبعاد (Gmsh 3D Mesher · Docker :8000)
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Zero-Mock Engine
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              تشبيك فعلي عبر Gmsh داخل حاوية Worker مع دعم STEP / IGES / STL ورتبة العناصر وطبقات الطبقة الحدية
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!gmshResult?.vtk_data}
            onClick={handleExportRealSurfaceSTL}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span>تصدير سطح Gmsh (.STL)</span>
          </button>

          {onApplyMeshToStudy && (
            <button
              type="button"
              disabled={!gmshResult}
              onClick={handleApplyToActiveStudy}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>اعتماد شبكة Gmsh بالمشروع</span>
            </button>
          )}

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      {appliedFeedback && (
        <div className="bg-emerald-950/90 border-b border-emerald-500/40 px-5 py-2 text-xs text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{appliedFeedback}</span>
        </div>
      )}

      {/* Main 3-Column Workbench */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12">
        {/* Left Controls */}
        <aside className="lg:col-span-3 bg-slate-900/70 border-l border-slate-800 p-4 overflow-y-auto space-y-4 text-xs">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-slate-200">
              <Box className="w-4 h-4 text-sky-400" />
              <span>مصدر الهندسة (Geometry Source)</span>
            </div>

            {uploadedCadStl && !localCad && (
              <label className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useProjectCad}
                  onChange={(e) => setUseProjectCad(e.target.checked)}
                  className="accent-sky-500"
                />
                <span className="text-[11px] text-sky-300 truncate">
                  استخدام مجسم المشروع: {uploadedCadStl.name}
                </span>
              </label>
            )}

            <input
              ref={cadFileInputRef}
              type="file"
              accept=".stl,.step,.stp,.iges,.igs,.brep"
              onChange={handleCadFileSelect}
              className="hidden"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => cadFileInputRef.current?.click()}
                className="flex-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold flex items-center justify-center gap-1.5"
              >
                <Upload className="w-3.5 h-3.5 text-sky-400" />
                <span>{localCad ? localCad.name : 'رفع STEP / STL للتشبيك'}</span>
              </button>
              {localCad && (
                <button
                  type="button"
                  onClick={() => setLocalCad(null)}
                  className="px-2.5 py-2 rounded-xl bg-slate-800 hover:bg-rose-900/50 text-slate-400 hover:text-rose-300 border border-slate-700"
                  title="إلغاء الملف المرفوع والعودة للصندوق الهندسي"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {!activeCad && (
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="font-bold text-slate-200 block">أبعاد الصندوق الثلاثي (Domain Box, m)</span>
              <div className="grid grid-cols-3 gap-2 font-mono">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Width X</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.001"
                    value={widthX}
                    onChange={(e) => setWidthX(Number(e.target.value) || 0.1)}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Height Y</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.001"
                    value={heightY}
                    onChange={(e) => setHeightY(Number(e.target.value) || 0.1)}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Depth Z</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.001"
                    value={depthZ}
                    onChange={(e) => setDepthZ(Number(e.target.value) || 0.1)}
                    className="w-full px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-slate-200"
                  />
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div className="flex items-center gap-1.5 font-bold text-slate-200">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>إعدادات Gmsh القياسية</span>
            </div>

            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-slate-400">Element Size h (m):</span>
                <span className="font-mono text-sky-400 font-bold">{meshSize} m ({(meshSize * 1000).toFixed(1)} mm)</span>
              </div>
              <input
                type="number"
                step="0.005"
                min="0.001"
                value={meshSize}
                onChange={(e) => setMeshSize(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-700 font-mono text-slate-200"
              />
            </div>

            <div>
              <span className="text-[11px] text-slate-400 block mb-1">Element Order (رتبة العنصر):</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setElementOrder(1)}
                  className={`py-1.5 rounded-lg border font-mono text-[11px] font-bold ${
                    elementOrder === 1
                      ? 'bg-sky-600/20 border-sky-500 text-sky-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  1st Order (Linear)
                </button>
                <button
                  type="button"
                  onClick={() => setElementOrder(2)}
                  className={`py-1.5 rounded-lg border font-mono text-[11px] font-bold ${
                    elementOrder === 2
                      ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                      : 'bg-slate-950 border-slate-800 text-slate-400'
                  }`}
                >
                  2nd Order (Quad)
                </button>
              </div>
            </div>

            <div>
              <div className="flex justify-between text-[11px] mb-1">
                <span className="text-slate-400">Inflation Layers (الطبقة الحدية):</span>
                <span className="font-mono text-amber-400 font-bold">{inflationLayers} layers</span>
              </div>
              <input
                type="range"
                min="0"
                max="12"
                step="1"
                value={inflationLayers}
                onChange={(e) => setInflationLayers(Number(e.target.value))}
                className="w-full accent-amber-500"
              />
            </div>

            {inflationLayers > 0 && (
              <div className="grid grid-cols-2 gap-2 font-mono">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">First Layer h₀ (m)</label>
                  <input
                    type="number"
                    step="0.0005"
                    min="0.00001"
                    value={firstLayerHeight}
                    onChange={(e) => setFirstLayerHeight(Number(e.target.value) || 0.001)}
                    className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Growth Rate</label>
                  <input
                    type="number"
                    step="0.05"
                    min="1.05"
                    max="2.0"
                    value={growthRate}
                    onChange={(e) => setGrowthRate(Number(e.target.value) || 1.2)}
                    className="w-full px-2 py-1 rounded bg-slate-950 border border-slate-700 text-slate-200"
                  />
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            disabled={gmshStatus === 'queued' || gmshStatus === 'running'}
            onClick={handleRunGmshDockerMesher}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-emerald-600 hover:from-sky-500 hover:to-emerald-500 text-white font-bold flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-current" />
            <span>
              {gmshStatus === 'queued' || gmshStatus === 'running'
                ? 'جاري التشبيك عبر Gmsh (:8000)...'
                : 'Generate Real Gmsh 3D Mesh'}
            </span>
          </button>

          {gmshError && (
            <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-[11px] flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{gmshError}</span>
            </div>
          )}

          {gmshResult?.patches && gmshResult.patches.length > 0 && (
            <div className="pt-2 border-t border-slate-800 space-y-1.5">
              <span className="text-[11px] font-bold text-slate-300 block">
                الأسطح الفيزيائية المكتشفة (Gmsh Physical Groups):
              </span>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {gmshResult.patches.map((p) => (
                  <div
                    key={p.id}
                    className="px-2.5 py-1 rounded bg-slate-950/80 border border-slate-800 flex items-center justify-between font-mono text-[10px]"
                  >
                    <span className="text-sky-300">{p.name}</span>
                    <span className="text-slate-500">dim {p.dim ?? 2}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Center 3D Wireframe Preview */}
        <div className="lg:col-span-6 flex flex-col bg-slate-950 border-l border-slate-800">
          <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-300 font-mono">
              <Cpu className="w-3.5 h-3.5 text-sky-400" />
              <span>Gmsh 3D Surface Preview {currentProject ? `· ${currentProject.title}` : ''}</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(z * 1.25, 6))}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(z * 0.8, 0.25))}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoomLevel(1.0);
                  setYaw(0.6);
                  setPitch(0.45);
                  setPanOffset({ x: 0, y: 0 });
                }}
                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset View</span>
              </button>
            </div>
          </div>

          <div className="flex-1 relative overflow-hidden cursor-grab active:cursor-grabbing">
            <canvas
              ref={canvasRef}
              className="w-full h-full block"
              onContextMenu={(e) => e.preventDefault()}
              onMouseDown={(e) => {
                setDragMode(e.button === 2 || e.shiftKey ? 'pan' : 'rotate');
                setDragStart({ x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => {
                if (dragMode === 'none') return;
                const dx = e.clientX - dragStart.x;
                const dy = e.clientY - dragStart.y;
                setDragStart({ x: e.clientX, y: e.clientY });
                if (dragMode === 'rotate') {
                  setYaw((y) => y + dx * 0.01);
                  setPitch((p) => Math.max(-1.4, Math.min(1.4, p + dy * 0.01)));
                } else {
                  setPanOffset((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
                }
              }}
              onMouseUp={() => setDragMode('none')}
              onMouseLeave={() => setDragMode('none')}
            />
          </div>

          <div className="px-4 py-2 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400 font-mono">
            <div>
              Nodes: <strong className="text-slate-200">{gmshResult?.nodes_count ?? '—'}</strong> · Elements:{' '}
              <strong className="text-slate-200">{gmshResult?.elements_count ?? '—'}</strong> · 3D Tets:{' '}
              <strong className="text-emerald-300">{gmshResult?.volume_elements_count ?? '—'}</strong>
            </div>
            <div>Drag: Rotate 3D · Shift+Drag: Pan</div>
          </div>
        </div>

        {/* Right Quality Panel (Real Gmsh Metrics) */}
        <aside className="lg:col-span-3 bg-slate-900/70 p-4 overflow-y-auto space-y-4 text-xs">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-emerald-400" />
            <h2 className="font-bold text-sm text-slate-100">جودة شبكة Gmsh الحقيقية</h2>
          </div>

          {!gmshResult ? (
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 text-slate-400 leading-relaxed">
              تُعرض هنا مقاييس الجودة الفعلية المستخرجة من نواة Gmsh (<code className="text-sky-400">minSICN / gamma</code>) فور تشغيل التشبيك.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 block">Min Quality</span>
                  <div className={`text-lg font-bold font-mono ${(gmshResult.min_quality ?? 0) >= 0.2 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {gmshResult.min_quality ?? '—'}
                  </div>
                </div>
                <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 block">Avg Quality</span>
                  <div className="text-lg font-bold font-mono text-sky-400">
                    {gmshResult.avg_quality ?? '—'}
                  </div>
                </div>
                <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 block">Max Skewness</span>
                  <div className="text-lg font-bold font-mono text-amber-400">
                    {gmshResult.max_skewness ?? '—'}
                  </div>
                </div>
                <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 block">Surface Tris</span>
                  <div className="text-lg font-bold font-mono text-purple-400">
                    {gmshResult.surface_triangles_count ?? '—'}
                  </div>
                </div>
              </div>

              {gmshResult.quality_histogram && (
                <div className="space-y-2 pt-3 border-t border-slate-800">
                  <h3 className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-sky-400" />
                    <span>توزيع الجودة من Gmsh (Histogram)</span>
                  </h3>
                  {gmshResult.quality_histogram.map((bin) => {
                    const pct = Number(((bin.count / totalQualityCount) * 100).toFixed(1));
                    return (
                      <div key={bin.bin} className="p-2 rounded-xl bg-slate-950/60 border border-slate-800">
                        <div className="flex justify-between font-mono text-[11px] mb-1">
                          <span className="text-slate-300 font-bold">{bin.bin}</span>
                          <span className="text-white">{bin.count} ({pct}%)</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div className="h-full bg-sky-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
};
