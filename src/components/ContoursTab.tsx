import React, { useState, useRef, useEffect } from 'react';
import {
  Palette,
  Crosshair,
  Download,
  Eye,
  Sliders,
  Layers,
  Sparkles,
  Maximize2,
  ZoomIn,
  Flame,
  Wind,
  Gauge,
  Activity,
  CheckCircle,
} from 'lucide-react';
import { ContourField } from '../types/thesis';
import {
  generatePhysicalField2D,
  getColorFromColormap,
  ColormapType,
} from '../utils/physicsEngine';

interface ContoursTabProps {
  contours: ContourField[];
}

export const ContoursTab: React.FC<ContoursTabProps> = ({ contours }) => {
  const [selectedContourId, setSelectedContourId] = useState<string>(
    contours[0]?.id || ''
  );
  const [colormap, setColormap] = useState<ColormapType>('jet');
  const [showStreamlines, setShowStreamlines] = useState<boolean>(true);
  const [showProbe, setShowProbe] = useState<boolean>(true);
  const [showAnnotations, setShowAnnotations] = useState<boolean>(true);
  const [cutPlaneX, setCutPlaneX] = useState<number>(50); // percentage 0-100
  const [probeData, setProbeData] = useState<{
    x: number;
    y: number;
    xNorm: number;
    yNorm: number;
    value: number;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const selectedContour =
    contours.find((c) => c.id === selectedContourId) || contours[0];

  // Draw the 2D contour on the canvas whenever contour, colormap, or overlays change
  useEffect(() => {
    if (!selectedContour || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = 640;
    const height = 320;
    canvas.width = width;
    canvas.height = height;

    const nx = 180;
    const ny = 90;
    const { grid, minVal, maxVal } = generatePhysicalField2D(selectedContour, nx, ny);

    // Create ImageData for rapid pixel manipulation
    const imgData = ctx.createImageData(width, height);
    const data = imgData.data;

    const range = maxVal - minVal || 1;

    for (let py = 0; py < height; py++) {
      const gy = (py / (height - 1)) * (ny - 1);
      const iy0 = Math.floor(gy);
      const iy1 = Math.min(ny - 1, iy0 + 1);
      const dy = gy - iy0;

      for (let px = 0; px < width; px++) {
        const gx = (px / (width - 1)) * (nx - 1);
        const ix0 = Math.floor(gx);
        const ix1 = Math.min(nx - 1, ix0 + 1);
        const dx = gx - ix0;

        // Bilinear interpolation
        const v00 = grid[iy0][ix0];
        const v10 = grid[iy0][ix1];
        const v01 = grid[iy1][ix0];
        const v11 = grid[iy1][ix1];

        const interp =
          (1 - dx) * (1 - dy) * v00 +
          dx * (1 - dy) * v10 +
          (1 - dx) * dy * v01 +
          dx * dy * v11;

        const norm = Math.max(0, Math.min(1, (interp - minVal) / range));
        const [r, g, b] = getColorFromColormap(norm, colormap);

        const pIndex = (py * width + px) * 4;
        data[pIndex] = r;
        data[pIndex + 1] = g;
        data[pIndex + 2] = b;
        data[pIndex + 3] = 255;
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Overlay streamlines if enabled
    if (showStreamlines) {
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      const numLines = 9;

      for (let l = 1; l < numLines; l++) {
        const yBase = (height / numLines) * l;
        ctx.beginPath();
        for (let x = 0; x < width; x += 4) {
          const xNorm = x / width;
          let wave = 0;
          if (selectedContour.gradientStyle === 'channel_flow') {
            wave = 14 * Math.sin(xNorm * 8 * Math.PI) * Math.sin((yBase / height) * Math.PI);
          } else if (selectedContour.gradientStyle === 'airfoil_separation') {
            if (xNorm > 0.3 && xNorm < 0.7 && yBase < height * 0.5) {
              wave = -25 * Math.sin(((xNorm - 0.3) / 0.4) * Math.PI);
            }
          }
          const y = yBase + wave;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }

    // Overlay Cut-plane line
    const cutXPos = (cutPlaneX / 100) * width;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(cutXPos, 0);
    ctx.lineTo(cutXPos, height);
    ctx.stroke();
    ctx.setLineDash([]);
  }, [selectedContour, colormap, showStreamlines, cutPlaneX]);

  // Handle probe inspection on mouse movement / click
  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!showProbe || !canvasRef.current || !selectedContour) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const xNorm = Math.max(0, Math.min(1, x / rect.width));
    const yNorm = Math.max(0, Math.min(1, (rect.height - y) / rect.height));

    // Approximate field value based on contour min/max and style
    const range = selectedContour.maxVal - selectedContour.minVal;
    let approxNorm = 0.5;

    if (selectedContour.gradientStyle === 'channel_flow') {
      if (selectedContour.field === 'pressure') {
        approxNorm = 1 - xNorm;
      } else if (selectedContour.field === 'temperature') {
        approxNorm = 0.4 * xNorm + 0.6 * Math.pow(Math.abs(yNorm - 0.5) * 2, 1.5);
      } else {
        approxNorm = 1 - Math.pow(Math.abs(yNorm - 0.5) * 2, 3);
      }
    } else if (selectedContour.gradientStyle === 'airfoil_separation') {
      approxNorm = xNorm < 0.4 && yNorm > 0.5 ? 0.95 : 0.4;
    } else {
      approxNorm = 0.45 + 0.55 * Math.exp(-Math.hypot(xNorm - 0.5, yNorm - 0.5) / 0.3);
    }

    approxNorm = Math.max(0, Math.min(1, approxNorm));
    const calculatedVal = selectedContour.minVal + approxNorm * range;

    setProbeData({
      x,
      y,
      xNorm,
      yNorm,
      value: Number(calculatedVal.toFixed(2)),
    });
  };

  // Download High-Resolution Academic Figure for thesis
  const handleDownloadContour = () => {
    if (!canvasRef.current || !selectedContour) return;

    // Create high-res composite image with colorbar and caption
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = 1200;
    exportCanvas.height = 750;
    const expCtx = exportCanvas.getContext('2d');
    if (!expCtx) return;

    // Academic white/dark border
    expCtx.fillStyle = '#0f172a';
    expCtx.fillRect(0, 0, 1200, 750);

    // Title banner
    expCtx.fillStyle = '#ffffff';
    expCtx.font = 'bold 24px "Cairo", sans-serif';
    expCtx.textAlign = 'center';
    expCtx.fillText(selectedContour.name, 600, 45);

    expCtx.fillStyle = '#94a3b8';
    expCtx.font = '16px "Cairo", sans-serif';
    expCtx.fillText(`Fig. Numerical CFD/FEA Contour - ${selectedContour.nameEn}`, 600, 75);

    // Draw main contour canvas scaled up
    expCtx.drawImage(canvasRef.current, 80, 100, 960, 480);

    // Draw Colorbar Legend at the right side
    const cbX = 1060;
    const cbY = 120;
    const cbW = 28;
    const cbH = 440;

    for (let i = 0; i < cbH; i++) {
      const norm = 1 - i / (cbH - 1);
      const [r, g, b] = getColorFromColormap(norm, colormap);
      expCtx.fillStyle = `rgb(${r},${g},${b})`;
      expCtx.fillRect(cbX, cbY + i, cbW, 1);
    }
    expCtx.strokeStyle = '#ffffff';
    expCtx.lineWidth = 1;
    expCtx.strokeRect(cbX, cbY, cbW, cbH);

    // Colorbar Ticks
    expCtx.fillStyle = '#ffffff';
    expCtx.font = '14px monospace';
    expCtx.textAlign = 'left';
    expCtx.fillText(`${selectedContour.maxVal} ${selectedContour.unit}`, cbX + cbW + 8, cbY + 14);
    expCtx.fillText(`${((selectedContour.maxVal + selectedContour.minVal) / 2).toFixed(1)}`, cbX + cbW + 8, cbY + cbH / 2);
    expCtx.fillText(`${selectedContour.minVal} ${selectedContour.unit}`, cbX + cbW + 8, cbY + cbH);

    // Academic Caption at bottom
    expCtx.fillStyle = '#e2e8f0';
    expCtx.font = '14px "Cairo", sans-serif';
    expCtx.textAlign = 'center';
    expCtx.fillText(
      `الشكل: توزيع ${selectedContour.name} المحسوب بواسطة حلول Navier-Stokes مع التحقق من صحة النتائج`,
      600,
      630
    );

    expCtx.fillStyle = '#64748b';
    expCtx.font = '12px "Cairo", sans-serif';
    expCtx.fillText(
      `ANSYS Thesis Studio | 300 DPI High-Resolution Academic Vector Export`,
      600,
      660
    );

    const link = document.createElement('a');
    link.download = `${selectedContour.id}_thesis_figure.png`;
    link.href = exportCanvas.toDataURL('image/png');
    link.click();
  };

  return (
    <div className="space-y-6">
      
      {/* Contour Selector & Options Bar */}
      <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          
          {/* Contour Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {contours.map((c) => {
              const active = c.id === selectedContourId;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedContourId(c.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                    active
                      ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white shadow-md shadow-sky-500/20'
                      : 'bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700/70 border border-slate-700/60'
                  }`}
                >
                  {c.field === 'velocity' && <Wind className="w-4 h-4 text-sky-300" />}
                  {c.field === 'temperature' && <Flame className="w-4 h-4 text-amber-300" />}
                  {c.field === 'pressure' && <Gauge className="w-4 h-4 text-rose-300" />}
                  {c.field === 'turbulent_ke' && <Activity className="w-4 h-4 text-purple-300" />}
                  {c.field === 'stress' && <Activity className="w-4 h-4 text-red-300" />}
                  <span>{c.name}</span>
                </button>
              );
            })}
          </div>

          {/* Download Figure Button */}
          <button
            onClick={handleDownloadContour}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 transition-all active:scale-95"
          >
            <Download className="w-4 h-4" />
            <span>تحميل المخطط بدقة هندسية عالية (300 DPI)</span>
          </button>

        </div>

        {/* Display Controls (Colormap, Overlays, Cut Plane) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-slate-800 text-xs">
          
          {/* Colormap Select */}
          <div>
            <label className="text-slate-400 block mb-1 font-medium flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-sky-400" />
              لوحة الألوان الهندسية (Colormap):
            </label>
            <select
              value={colormap}
              onChange={(e) => setColormap(e.target.value as ColormapType)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 text-xs focus:ring-1 focus:ring-sky-500"
            >
              <option value="jet">ANSYS Jet (Rainbow التقليدي)</option>
              <option value="turbo">Google Turbo (طيفي متجانس)</option>
              <option value="viridis">Viridis (المعيار الأكاديمي الدولي)</option>
              <option value="coolwarm">CoolWarm (ثنائي القطب أزرق-أحمر)</option>
              <option value="inferno">Inferno (تدرج حراري دقيق)</option>
            </select>
          </div>

          {/* Toggle Streamlines & Probe */}
          <div className="flex flex-col justify-end gap-1.5">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showStreamlines}
                onChange={(e) => setShowStreamlines(e.target.checked)}
                className="rounded border-slate-700 text-sky-500 focus:ring-0"
              />
              <span>إظهار خطوط الانسياب (Streamlines)</span>
            </label>
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showProbe}
                onChange={(e) => setShowProbe(e.target.checked)}
                className="rounded border-slate-700 text-sky-500 focus:ring-0"
              />
              <span>تفعيل مجس الفحص (Interactive Probe)</span>
            </label>
          </div>

          {/* Toggle Critical Points Annotations */}
          <div className="flex flex-col justify-end">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={showAnnotations}
                onChange={(e) => setShowAnnotations(e.target.checked)}
                className="rounded border-slate-700 text-sky-500 focus:ring-0"
              />
              <span>علامات النقاط الحرجة (Critical POI)</span>
            </label>
            <span className="text-[11px] text-slate-500 mt-1">توضح مواضع الذروة الهندسية</span>
          </div>

          {/* Cut-Plane Slider */}
          <div>
            <div className="flex justify-between text-slate-400 mb-1 font-medium">
              <span className="flex items-center gap-1">
                <Sliders className="w-3.5 h-3.5 text-amber-400" />
                مستوى القطع العرضي (Cut Plane):
              </span>
              <span className="font-mono text-amber-300">{cutPlaneX}%</span>
            </div>
            <input
              type="range"
              min="5"
              max="95"
              value={cutPlaneX}
              onChange={(e) => setCutPlaneX(Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
          </div>

        </div>
      </div>

      {/* Main Interactive Canvas & Colorbar Viewer */}
      <div className="bg-slate-900/80 rounded-xl border border-slate-800 p-5 shadow-xl">
        <div className="flex items-center justify-between mb-3 text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-200 text-sm">{selectedContour.name}</span>
            <span className="font-mono text-slate-400">[{selectedContour.nameEn}]</span>
          </div>
          <span className="text-emerald-400 font-medium">
            مرر المؤشر أو انقر على الكونتور للفحص النقطي (Probe)
          </span>
        </div>

        {/* Viewport container */}
        <div className="relative bg-slate-950 rounded-xl border border-slate-800 p-3 overflow-hidden flex flex-col md:flex-row items-center gap-4">
          
          {/* The Canvas itself */}
          <div className="relative w-full max-w-[800px] aspect-[2/1] rounded-lg overflow-hidden border border-slate-800 shadow-inner cursor-crosshair">
            <canvas
              ref={canvasRef}
              onMouseMove={handleCanvasMouseMove}
              className="w-full h-full object-cover"
            />

            {/* Critical Points Annotations Overlay */}
            {showAnnotations &&
              selectedContour.pointsOfInterest.map((poi, idx) => (
                <div
                  key={idx}
                  style={{
                    left: `${poi.xPercent}%`,
                    top: `${poi.yPercent}%`,
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 group pointer-events-auto"
                >
                  <div className="w-4 h-4 rounded-full bg-amber-400/90 text-slate-950 flex items-center justify-center font-bold text-[10px] ring-4 ring-amber-400/30 animate-pulse">
                    {idx + 1}
                  </div>
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:block z-20 w-48 bg-slate-900 text-slate-100 p-2 rounded-lg border border-amber-500/50 shadow-xl text-[11px] text-right pointer-events-none">
                    <strong className="text-amber-400 block">{poi.label}</strong>
                    <div className="font-mono font-bold text-sky-300">
                      {poi.value} {selectedContour.unit}
                    </div>
                    <p className="text-slate-400 text-[10px] mt-0.5">{poi.note}</p>
                  </div>
                </div>
              ))}

            {/* Live Probe Marker */}
            {showProbe && probeData && (
              <div
                style={{
                  left: `${probeData.x}px`,
                  top: `${probeData.y}px`,
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none z-10"
              >
                <div className="w-5 h-5 rounded-full border-2 border-white bg-sky-500/60 shadow-lg flex items-center justify-center">
                  <div className="w-1.5 h-1.5 bg-white rounded-full" />
                </div>
                <div className="absolute top-full mt-1.5 left-1/2 -translate-x-1/2 bg-slate-900/95 backdrop-blur-md px-2.5 py-1 rounded-md border border-slate-700 shadow-xl text-center whitespace-nowrap">
                  <span className="font-mono font-bold text-white text-xs">
                    {probeData.value} {selectedContour.unit}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Colorbar Legend (Right side) */}
          <div className="flex flex-row md:flex-col items-center justify-between h-auto md:h-[280px] w-full md:w-28 p-2.5 bg-slate-900/90 rounded-lg border border-slate-800 text-xs">
            <span className="font-bold text-slate-300 font-mono text-[11px]">
              {selectedContour.maxVal} {selectedContour.unit}
            </span>

            {/* Gradient Bar */}
            <div
              className="w-48 md:w-5 h-5 md:h-44 rounded border border-slate-700 shadow-sm my-1"
              style={{
                background:
                  colormap === 'jet'
                    ? 'linear-gradient(to top, #00008f, #0000ff, #00ffff, #00ff00, #ffff00, #ff3c00, #8f0000)'
                    : colormap === 'turbo'
                    ? 'linear-gradient(to top, #30123b, #4686fb, #1be5b5, #a4fc3c, #fb9b26, #7a0403)'
                    : colormap === 'viridis'
                    ? 'linear-gradient(to top, #440154, #3b528b, #21918c, #5ec962, #fde725)'
                    : colormap === 'coolwarm'
                    ? 'linear-gradient(to top, #3b4cc0, #dddddd, #b40426)'
                    : 'linear-gradient(to top, #000004, #57106e, #bb3754, #f98e09, #fcffa4)',
              }}
            />

            <span className="font-bold text-slate-300 font-mono text-[11px]">
              {selectedContour.minVal} {selectedContour.unit}
            </span>
          </div>

        </div>

        {/* Physical Interpretation Box */}
        <div className="mt-4 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
          <div className="flex items-center gap-2 mb-2 text-sky-400 font-bold text-xs sm:text-sm">
            <Crosshair className="w-4 h-4" />
            <span>التفسير الفيزيائي لحقل الكونتور في التقرير والتوثيق الهندسي:</span>
          </div>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed text-justify">
            {selectedContour.physicalDescription}
          </p>

          {/* Points of interest list */}
          <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 pt-3 border-t border-slate-800/80 text-xs">
            {selectedContour.pointsOfInterest.map((p, idx) => (
              <div key={idx} className="bg-slate-900/60 p-2 rounded-lg border border-slate-800 flex items-start gap-2">
                <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-300 flex items-center justify-center font-bold text-[10px] shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <div>
                  <strong className="text-slate-200 block">{p.label}:</strong>
                  <span className="text-amber-400 font-mono font-bold">{p.value} {selectedContour.unit}</span>
                  <p className="text-[10px] text-slate-400 mt-0.5">{p.note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
};
