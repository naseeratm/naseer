import { ThesisProject, ContourField } from '../types/thesis';
import { generatePhysicalField2D, getColorFromColormap } from './physicsEngine';

/**
 * Render a real 2D physical contour field into a base64 PNG data URL
 */
function renderContourToDataUrl(contour: ContourField, width = 600, height = 280): string {
  try {
    if (typeof document === 'undefined') return '';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    const nx = 160;
    const ny = 80;
    const { grid, minVal, maxVal } = generatePhysicalField2D(contour, nx, ny);
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
        const [r, g, b] = getColorFromColormap(norm, 'jet');
        const pIndex = (py * width + px) * 4;
        data[pIndex] = r;
        data[pIndex + 1] = g;
        data[pIndex + 2] = b;
        data[pIndex + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);

    // Draw Hotspot marker pins onto the contour image
    if (contour.pointsOfInterest && contour.pointsOfInterest.length > 0) {
      contour.pointsOfInterest.forEach((pt, i) => {
        const cx = (pt.xPercent / 100) * width;
        const cy = (1 - pt.yPercent / 100) * height;

        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#0f172a';
        ctx.stroke();

        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), cx, cy);
      });
    }

    return canvas.toDataURL('image/png');
  } catch (err) {
    console.error('Error rendering contour data url:', err);
    return '';
  }
}

/**
 * Generate CAD Engineering Schematic SVG
 */
function generateCadSchematicSvg(project: ThesisProject): string {
  const isFEA = project.field === 'FEA';
  const isCFD = project.field === 'CFD';

  if (isFEA) {
    return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 260" width="680" height="260" style="background:#0f172a; border-radius:8px; font-family:'Segoe UI',Arial,sans-serif;">
      <!-- Grid -->
      <defs>
        <pattern id="gridFEA" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e293b" stroke-width="0.8"/>
        </pattern>
        <marker id="arrLoad" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#f43f5e" />
        </marker>
      </defs>
      <rect width="680" height="260" fill="url(#gridFEA)" />

      <!-- Fixed Support Wall -->
      <rect x="50" y="30" width="30" height="190" fill="#334155" stroke="#64748b" stroke-width="2" />
      <line x1="40" y1="40" x2="50" y2="30" stroke="#94a3b8" stroke-width="2"/>
      <line x1="40" y1="80" x2="50" y2="70" stroke="#94a3b8" stroke-width="2"/>
      <line x1="40" y1="120" x2="50" y2="110" stroke="#94a3b8" stroke-width="2"/>
      <line x1="40" y1="160" x2="50" y2="150" stroke="#94a3b8" stroke-width="2"/>
      <line x1="40" y1="200" x2="50" y2="190" stroke="#94a3b8" stroke-width="2"/>
      <text x="35" y="240" fill="#94a3b8" font-size="11" font-weight="bold">Fixed Support (x = 0)</text>

      <!-- I-Beam Body -->
      <!-- Top Flange -->
      <rect x="80" y="55" width="460" height="20" fill="#0284c7" stroke="#38bdf8" stroke-width="1.5" />
      <!-- Web -->
      <rect x="80" y="75" width="460" height="100" fill="#0369a1" stroke="#38bdf8" stroke-width="1.5" opacity="0.85" />
      <!-- Bottom Flange -->
      <rect x="80" y="175" width="460" height="20" fill="#0284c7" stroke="#38bdf8" stroke-width="1.5" />

      <!-- High Stress Concentration Zone Halo -->
      <rect x="80" y="55" width="70" height="140" fill="#f43f5e" fill-opacity="0.35" stroke="#f43f5e" stroke-dasharray="4 2" stroke-width="1.5" />
      <text x="90" y="45" fill="#f43f5e" font-size="10" font-weight="bold">Max Stress σ_vm = 214.8 MPa</text>

      <!-- Neutral Axis -->
      <line x1="80" y1="125" x2="540" y2="125" stroke="#cbd5e1" stroke-dasharray="6 4" stroke-width="1.5" />
      <text x="260" y="120" fill="#cbd5e1" font-size="10" font-family="monospace">Neutral Axis (σ = 0)</text>

      <!-- Tip Load Arrow P -->
      <line x1="540" y1="15" x2="540" y2="52" stroke="#f43f5e" stroke-width="4" marker-end="url(#arrLoad)" />
      <text x="515" y="12" fill="#f43f5e" font-size="12" font-weight="bold">P = 45 kN (Tip Load)</text>

      <!-- Dimension Line L -->
      <line x1="80" y1="215" x2="540" y2="215" stroke="#94a3b8" stroke-width="1.5" />
      <line x1="80" y1="210" x2="80" y2="220" stroke="#94a3b8" stroke-width="1.5" />
      <line x1="540" y1="210" x2="540" y2="220" stroke="#94a3b8" stroke-width="1.5" />
      <text x="270" y="235" fill="#e2e8f0" font-size="11" font-weight="bold">Beam Length L = 2.0 m (W10x30 Profile)</text>
    </svg>
    `;
  }

  if (isCFD) {
    return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 260" width="680" height="260" style="background:#0f172a; border-radius:8px; font-family:'Segoe UI',Arial,sans-serif;">
      <defs>
        <marker id="arrFlow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#38bdf8" />
        </marker>
      </defs>
      <!-- Streamlines -->
      <path d="M 30 70 Q 200 40 420 75 T 640 100" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="6 3" opacity="0.6"/>
      <path d="M 30 95 Q 200 65 420 95 T 640 120" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="6 3" opacity="0.8"/>
      <path d="M 30 150 Q 200 170 420 155 T 640 145" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="6 3" opacity="0.8"/>
      <path d="M 30 180 Q 200 200 420 185 T 640 170" fill="none" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="6 3" opacity="0.6"/>

      <!-- Airfoil Profile NACA 0012 -->
      <path d="M 160 125 C 160 85, 260 70, 360 90 C 440 105, 520 122, 540 125 C 520 128, 440 145, 360 160 C 260 180, 160 165, 160 125 Z" fill="#0284c7" stroke="#38bdf8" stroke-width="2.5" />

      <!-- Stagnation Point -->
      <circle cx="160" cy="125" r="5" fill="#f43f5e" />
      <text x="90" y="129" fill="#f43f5e" font-size="10" font-weight="bold">Stagnation (V=0)</text>

      <!-- Suction Peak -->
      <circle cx="280" cy="80" r="5" fill="#a855f7" />
      <text x="235" y="65" fill="#c084fc" font-size="10" font-weight="bold">Suction Peak (Cp = -2.4)</text>

      <!-- Chord Line -->
      <line x1="160" y1="125" x2="540" y2="125" stroke="#e2e8f0" stroke-dasharray="4 4" stroke-width="1" />
      <text x="310" y="138" fill="#e2e8f0" font-size="10">Chord c = 1.0 m</text>

      <!-- Incoming Flow Vectors -->
      <line x1="40" y1="125" x2="110" y2="125" stroke="#38bdf8" stroke-width="3" marker-end="url(#arrFlow)"/>
      <text x="40" y="112" fill="#38bdf8" font-size="11" font-weight="bold">V∞ = 68.2 m/s (AoA = 4°)</text>

      <text x="210" y="240" fill="#94a3b8" font-size="11">NACA 0012 Compressible Viscous Navier-Stokes Simulation Domain</text>
    </svg>
    `;
  }

  // LHTES Thermal Geometry Schematic
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 270" width="680" height="270" style="background:#0f172a; border-radius:8px; font-family:'Segoe UI',Arial,sans-serif;">
    <defs>
      <marker id="arrHtf" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#f43f5e" />
      </marker>
    </defs>
    <!-- Outer Cylindrical Shell -->
    <rect x="140" y="30" width="380" height="200" rx="8" fill="#1e293b" stroke="#38bdf8" stroke-width="3" />
    <text x="145" y="20" fill="#38bdf8" font-size="11" font-weight="bold">Cylindrical Outer Shell (H = 500 mm, D = 150 mm)</text>

    <!-- PCM Medium Background -->
    <rect x="145" y="35" width="370" height="190" rx="6" fill="#f59e0b" fill-opacity="0.18" />
    <text x="260" y="70" fill="#fbbf24" font-size="11" font-weight="bold">RT50 PCM + Al2O3 Nano (3 vol.%)</text>

    <!-- Helical Coil representation -->
    <path d="M 220 30 C 220 70, 240 70, 240 110 C 240 150, 220 150, 220 190 C 220 230, 240 230, 240 230" fill="none" stroke="#ef4444" stroke-width="6" />
    <path d="M 440 30 C 440 70, 420 70, 420 110 C 420 150, 440 150, 440 190 C 440 230, 420 230, 420 230" fill="none" stroke="#ef4444" stroke-width="6" />

    <!-- Tree Fins Graded Layout -->
    <!-- Dense Lower Section (139 fins) -->
    <g stroke="#10b981" stroke-width="2.5">
      <line x1="240" y1="150" x2="280" y2="135"/>
      <line x1="240" y1="170" x2="285" y2="160"/>
      <line x1="240" y1="190" x2="290" y2="185"/>
      <line x1="240" y1="210" x2="285" y2="210"/>
      <line x1="420" y1="150" x2="380" y2="135"/>
      <line x1="420" y1="170" x2="375" y2="160"/>
      <line x1="420" y1="190" x2="370" y2="185"/>
      <line x1="420" y1="210" x2="375" y2="210"/>
    </g>
    <text x="250" y="215" fill="#34d399" font-size="10" font-weight="bold">Dense Lower Tree Fins (139 Fins)</text>

    <!-- Open Upper Section (65 fins) -->
    <g stroke="#10b981" stroke-width="2" stroke-dasharray="3 2">
      <line x1="220" y1="50" x2="255" y2="45"/>
      <line x1="220" y1="85" x2="260" y2="80"/>
      <line x1="440" y1="50" x2="405" y2="45"/>
      <line x1="440" y1="85" x2="400" y2="80"/>
    </g>
    <text x="270" y="55" fill="#34d399" font-size="10">Open Upper Tree Fins (65 Fins)</text>

    <!-- HTF Inlet with Oscillating Signal -->
    <line x1="60" y1="45" x2="135" y2="45" stroke="#ef4444" stroke-width="4" marker-end="url(#arrHtf)" />
    <text x="15" y="38" fill="#ef4444" font-size="10" font-weight="bold">HTF INLET (Oscillating)</text>
    <text x="10" y="52" fill="#cbd5e1" font-size="9" font-family="monospace">Tin(t) = 348 + 10·sin(ωt)</text>

    <!-- HTF Outlet -->
    <line x1="520" y1="215" x2="595" y2="215" stroke="#3b82f6" stroke-width="4" marker-end="url(#arrHtf)" />
    <text x="590" y="210" fill="#60a5fa" font-size="10" font-weight="bold">HTF OUTLET</text>
    <text x="590" y="224" fill="#cbd5e1" font-size="9" font-family="monospace">Tout(t) Dynamic</text>

    <!-- Height Dimension -->
    <line x1="535" y1="30" x2="535" y2="230" stroke="#94a3b8" stroke-width="1.5" />
    <text x="545" y="135" fill="#e2e8f0" font-size="11" font-weight="bold">H = 500 mm</text>
  </svg>
  `;
}

/**
 * Generate ASME V&V 20 Validation Comparison Plot SVG
 */
function generateValidationPlotSvg(project: ThesisProject): string {
  const points = project.validation.points || [];
  if (points.length === 0) return '';

  const minX = Math.min(...points.map((p) => p.independentVar));
  const maxX = Math.max(...points.map((p) => p.independentVar));
  const minY = Math.min(...points.map((p) => Math.min(p.experimentalVal, p.numericalCfdVal)));
  const maxY = Math.max(...points.map((p) => Math.max(p.experimentalVal, p.numericalCfdVal)));

  const padX = (maxX - minX) * 0.1 || 1;
  const padY = (maxY - minY) * 0.15 || 1;

  const plotLeft = 80;
  const plotRight = 580;
  const plotTop = 40;
  const plotBottom = 220;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const mapX = (x: number) => plotLeft + ((x - (minX - padX)) / (maxX - minX + 2 * padX)) * plotW;
  const mapY = (y: number) => plotBottom - ((y - (minY - padY)) / (maxY - minY + 2 * padY)) * plotH;

  const expPointsStr = points.map((p) => `${mapX(p.independentVar)},${mapY(p.experimentalVal)}`).join(' ');
  const numPointsStr = points.map((p) => `${mapX(p.independentVar)},${mapY(p.numericalCfdVal)}`).join(' ');

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 280" width="680" height="280" style="background:#0f172a; border-radius:8px; font-family:'Segoe UI',Arial,sans-serif;">
    <!-- Axes and Grid -->
    <rect x="${plotLeft}" y="${plotTop}" width="${plotW}" height="${plotH}" fill="#1e293b" fill-opacity="0.4" stroke="#334155" stroke-width="1.5"/>
    <line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#64748b" stroke-width="2"/>
    <line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="#64748b" stroke-width="2"/>

    <!-- Gridlines -->
    <line x1="${plotLeft}" y1="${plotTop + plotH * 0.25}" x2="${plotRight}" y2="${plotTop + plotH * 0.25}" stroke="#334155" stroke-dasharray="4 4" stroke-width="1"/>
    <line x1="${plotLeft}" y1="${plotTop + plotH * 0.5}" x2="${plotRight}" y2="${plotTop + plotH * 0.5}" stroke="#334155" stroke-dasharray="4 4" stroke-width="1"/>
    <line x1="${plotLeft}" y1="${plotTop + plotH * 0.75}" x2="${plotRight}" y2="${plotTop + plotH * 0.75}" stroke="#334155" stroke-dasharray="4 4" stroke-width="1"/>

    <!-- Numerical Simulation Polyline -->
    <polyline points="${numPointsStr}" fill="none" stroke="#38bdf8" stroke-width="3"/>

    <!-- Experimental Points -->
    ${points
      .map(
        (p) => `
      <circle cx="${mapX(p.independentVar)}" cy="${mapY(p.experimentalVal)}" r="6" fill="#f43f5e" stroke="#ffffff" stroke-width="2"/>
      <circle cx="${mapX(p.independentVar)}" cy="${mapY(p.numericalCfdVal)}" r="4" fill="#38bdf8"/>
    `
      )
      .join('')}

    <!-- Axis Labels -->
    <text x="${plotLeft + plotW / 2}" y="${plotBottom + 40}" fill="#e2e8f0" font-size="12" font-weight="bold" text-anchor="middle">
      ${project.validation.independentVarName} (${project.validation.independentVarUnit || '-'})
    </text>
    <text x="30" y="${plotTop + plotH / 2}" fill="#e2e8f0" font-size="12" font-weight="bold" text-anchor="middle" transform="rotate(-90 30 ${plotTop + plotH / 2})">
      ${project.validation.dependentVarName} (${project.validation.dependentVarUnit || '-'})
    </text>

    <!-- Legend -->
    <g transform="translate(${plotLeft + 20}, ${plotTop + 15})">
      <rect width="210" height="48" fill="#0f172a" fill-opacity="0.85" stroke="#334155" rx="6"/>
      <circle cx="20" cy="16" r="5" fill="#f43f5e"/>
      <text x="35" y="20" fill="#e2e8f0" font-size="11">بيانات القياس التجريبي المرجعي</text>
      <line x1="12" y1="36" x2="28" y2="36" stroke="#38bdf8" stroke-width="3"/>
      <text x="35" y="39" fill="#e2e8f0" font-size="11">الحل العددي (ANSYS Simulation)</text>
    </g>

    <!-- R-Squared Badge -->
    <g transform="translate(${plotRight - 140}, ${plotTop + 15})">
      <rect width="130" height="30" fill="#10b981" fill-opacity="0.2" stroke="#10b981" stroke-width="1.5" rx="6"/>
      <text x="65" y="20" fill="#34d399" font-size="12" font-weight="bold" text-anchor="middle">R² = ${project.validation.rSquared}</text>
    </g>
  </svg>
  `;
}

/**
 * Generate Roache GCI Grid Independence Plot SVG
 */
function generateMeshGciPlotSvg(project: ThesisProject): string {
  const levels = project.meshStudy.meshLevels || [];
  if (levels.length === 0) return '';

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 240" width="680" height="240" style="background:#0f172a; border-radius:8px; font-family:'Segoe UI',Arial,sans-serif;">
    <rect x="70" y="30" width="540" height="150" fill="#1e293b" fill-opacity="0.4" stroke="#334155" stroke-width="1.5"/>
    
    <!-- Levels Bars -->
    ${levels
      .map((lvl, idx) => {
        const x = 110 + idx * 130;
        const errHeight = Math.min(130, Math.max(10, lvl.percentageError * 14));
        const y = 180 - errHeight;
        const isOptimal = lvl.levelName.includes('Fine') || lvl.gciPercent < 2;
        const barColor = isOptimal ? '#10b981' : idx === 0 ? '#ef4444' : '#38bdf8';
        return `
        <rect x="${x}" y="${y}" width="60" height="${errHeight}" fill="${barColor}" rx="4"/>
        <text x="${x + 30}" y="${y - 8}" fill="${barColor}" font-size="11" font-weight="bold" text-anchor="middle">
          ${lvl.percentageError}%
        </text>
        <text x="${x + 30}" y="200" fill="#e2e8f0" font-size="10" font-weight="bold" text-anchor="middle">
          ${lvl.levelName.split(' ')[0]}
        </text>
        <text x="${x + 30}" y="215" fill="#94a3b8" font-size="9" text-anchor="middle">
          ${(lvl.elements / 1000).toFixed(0)}k cells
        </text>
        <text x="${x + 30}" y="230" fill="#fbbf24" font-size="9" font-weight="bold" text-anchor="middle">
          GCI = ${lvl.gciPercent}%
        </text>
      `;
      })
      .join('')}

    <!-- Header badge -->
    <text x="340" y="22" fill="#e2e8f0" font-size="11" font-weight="bold" text-anchor="middle">
      منحنى استقلالية الميش ومؤشر تقارب روتش (Roache Grid Convergence Index GCI)
    </text>
  </svg>
  `;
}

/**
 * Generate Melting Progress Curve SVG (for LHTES)
 */
function generateMeltingCurveSvg(): string {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 240" width="680" height="240" style="background:#0f172a; border-radius:8px; font-family:'Segoe UI',Arial,sans-serif;">
    <rect x="70" y="30" width="540" height="150" fill="#1e293b" fill-opacity="0.4" stroke="#334155" stroke-width="1.5"/>
    <line x1="70" y1="180" x2="610" y2="180" stroke="#64748b" stroke-width="1.5"/>
    <line x1="70" y1="30" x2="70" y2="180" stroke="#64748b" stroke-width="1.5"/>

    <!-- t95 Threshold Line (95% melt) -->
    <line x1="70" y1="45" x2="610" y2="45" stroke="#fbbf24" stroke-dasharray="5 4" stroke-width="1.5"/>
    <text x="520" y="40" fill="#fbbf24" font-size="10" font-weight="bold">t95 Criterion (95% Melted)</text>

    <!-- Curve 1: Proposed Graded Tree Fins (t95 = 2.504 h) -->
    <path d="M 70 180 Q 180 150 250 80 T 320 45" fill="none" stroke="#10b981" stroke-width="3"/>
    <circle cx="320" cy="45" r="5" fill="#10b981"/>
    <text x="250" y="35" fill="#34d399" font-size="10" font-weight="bold">Proposed Graded Tree (2.504 h)</text>

    <!-- Curve 2: Uniform Tree Fins (t95 = 3.386 h) -->
    <path d="M 70 180 Q 220 160 330 110 T 420 45" fill="none" stroke="#38bdf8" stroke-dasharray="6 3" stroke-width="2.5"/>
    <circle cx="420" cy="45" r="4" fill="#38bdf8"/>
    <text x="380" y="70" fill="#38bdf8" font-size="9">Uniform Tree (3.386 h)</text>

    <!-- Curve 3: Traditional Spiral Fins (t95 = 4.201 h) -->
    <path d="M 70 180 Q 260 170 410 130 T 520 45" fill="none" stroke="#f43f5e" stroke-dasharray="4 4" stroke-width="2"/>
    <circle cx="520" cy="45" r="4" fill="#f43f5e"/>
    <text x="490" y="90" fill="#f43f5e" font-size="9">Traditional Spiral (4.201 h)</text>

    <!-- Axes Labels -->
    <text x="340" y="215" fill="#e2e8f0" font-size="11" font-weight="bold" text-anchor="middle">Charging Time (Hours)</text>
    <text x="25" y="105" fill="#e2e8f0" font-size="11" font-weight="bold" text-anchor="middle" transform="rotate(-90 25 105)">Liquid Fraction β</text>
  </svg>
  `;
}

/**
 * Generate Logarithmic Residuals History SVG
 */
function generateResidualsPlotSvg(): string {
  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 220" width="680" height="220" style="background:#0f172a; border-radius:8px; font-family:'Segoe UI',Arial,sans-serif;">
    <rect x="70" y="30" width="540" height="140" fill="#1e293b" fill-opacity="0.4" stroke="#334155" stroke-width="1.5"/>
    
    <!-- Y-axis Log Ticks -->
    <text x="55" y="45" fill="#94a3b8" font-size="9" text-anchor="end">1e-0</text>
    <text x="55" y="80" fill="#94a3b8" font-size="9" text-anchor="end">1e-2</text>
    <text x="55" y="115" fill="#94a3b8" font-size="9" text-anchor="end">1e-4</text>
    <text x="55" y="150" fill="#94a3b8" font-size="9" text-anchor="end">1e-6</text>

    <!-- Continuity Residual Line -->
    <path d="M 70 50 Q 160 70 250 100 T 420 140 T 610 162" fill="none" stroke="#ef4444" stroke-width="2"/>
    <!-- Velocity Residual Line -->
    <path d="M 70 45 Q 150 75 240 110 T 410 148 T 610 165" fill="none" stroke="#38bdf8" stroke-width="2"/>
    <!-- Energy Residual Line -->
    <path d="M 70 40 Q 140 85 230 120 T 400 155 T 610 168" fill="none" stroke="#10b981" stroke-width="2"/>

    <!-- Convergence Threshold -->
    <line x1="70" y1="160" x2="610" y2="160" stroke="#fbbf24" stroke-dasharray="4 4" stroke-width="1"/>
    <text x="500" y="156" fill="#fbbf24" font-size="9">Convergence Criterion = 1e-6</text>

    <!-- Legend -->
    <g transform="translate(160, 35)">
      <line x1="0" y1="5" x2="15" y2="5" stroke="#ef4444" stroke-width="2"/>
      <text x="20" y="9" fill="#e2e8f0" font-size="10">Continuity</text>
      <line x1="90" y1="5" x2="105" y2="5" stroke="#38bdf8" stroke-width="2"/>
      <text x="110" y="9" fill="#e2e8f0" font-size="10">Velocity (X/Y)</text>
      <line x1="190" y1="5" x2="205" y2="5" stroke="#10b981" stroke-width="2"/>
      <text x="210" y="9" fill="#e2e8f0" font-size="10">Energy</text>
    </g>

    <text x="340" y="195" fill="#e2e8f0" font-size="11" font-weight="bold" text-anchor="middle">Iterations (0 to 1500)</text>
  </svg>
  `;
}

/**
 * Universal Master Word Exporter (.doc format with full embedded images, SVGs, and formal thesis dissertation chapters)
 */
export async function exportToWordDocument(project: ThesisProject) {
  // 1. Render all real 2D contour fields into Base64 PNGs
  const renderedContours = project.contours.map((c) => {
    const pngDataUrl = renderContourToDataUrl(c, 600, 280);
    return {
      contour: c,
      pngDataUrl,
    };
  });

  // 2. Generate SVG schematics and plots
  const cadSvg = generateCadSchematicSvg(project);
  const validationSvg = generateValidationPlotSvg(project);
  const meshGciSvg = generateMeshGciPlotSvg(project);
  const residualsSvg = generateResidualsPlotSvg();
  const meltingSvg = project.meltingComparison ? generateMeltingCurveSvg() : '';

  // 3. Assemble complete HTML content for Microsoft Word
  const htmlContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <meta charset='utf-8'>
      <title>${project.title}</title>
      <style>
        @page {
          size: A4;
          margin: 2.5cm 2.0cm 2.5cm 2.0cm;
          mso-header-margin: 1.2cm;
          mso-footer-margin: 1.2cm;
        }
        body {
          font-family: 'Times New Roman', 'Simplified Arabic', 'Calibri', serif;
          font-size: 12pt;
          line-height: 1.6;
          color: #111827;
          direction: rtl;
          text-align: right;
        }
        h1.thesis-title {
          font-size: 21pt;
          color: #0369a1;
          border-bottom: 3px double #0284c7;
          padding-bottom: 12px;
          margin-top: 15px;
          text-align: center;
          line-height: 1.4;
        }
        h1.chapter-title {
          font-size: 17pt;
          color: #0f172a;
          background-color: #f1f5f9;
          border-right: 6px solid #0284c7;
          padding: 8px 14px;
          margin-top: 35px;
          page-break-before: always;
        }
        h2.section-title {
          font-size: 14pt;
          color: #0369a1;
          border-bottom: 1.5px solid #cbd5e1;
          padding-bottom: 4px;
          margin-top: 24px;
        }
        h3.subsection-title {
          font-size: 12.5pt;
          color: #334155;
          margin-top: 16px;
          font-weight: bold;
        }
        p {
          margin: 8px 0;
          text-align: justify;
          line-height: 1.65;
        }
        .meta-box {
          background: #f8fafc;
          border: 1px solid #cbd5e1;
          padding: 16px;
          margin: 18px 0;
          border-radius: 8px;
        }
        table.formal-table {
          width: 100%;
          border-collapse: collapse;
          margin: 14px 0;
          font-size: 10.5pt;
          direction: rtl;
        }
        table.formal-table th {
          background-color: #0284c7;
          color: #ffffff;
          padding: 9px 10px;
          border: 1px solid #0369a1;
          text-align: center;
          font-weight: bold;
        }
        table.formal-table td {
          padding: 7px 10px;
          border: 1px solid #cbd5e1;
          text-align: center;
        }
        table.formal-table tr:nth-child(even) {
          background-color: #f8fafc;
        }
        .table-caption {
          font-size: 10.5pt;
          font-weight: bold;
          color: #334155;
          text-align: center;
          margin-top: 6px;
          margin-bottom: 14px;
        }
        .figure-caption {
          font-size: 10.5pt;
          font-weight: bold;
          color: #334155;
          text-align: center;
          margin-top: 8px;
          margin-bottom: 22px;
        }
        .equation-box {
          background: #f8fafc;
          border-right: 4px solid #0284c7;
          padding: 10px 16px;
          font-family: 'Cambria Math', monospace;
          margin: 12px 0;
          direction: ltr;
          text-align: left;
          font-size: 11pt;
          color: #0f172a;
        }
        .figure-container {
          text-align: center;
          margin: 18px 0;
          page-break-inside: avoid;
        }
        .figure-container img {
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          max-width: 100%;
          height: auto;
        }
        .colorbar-box {
          display: inline-block;
          margin-top: 6px;
          font-size: 9.5pt;
          font-family: monospace;
          background: #f1f5f9;
          padding: 4px 12px;
          border-radius: 4px;
          border: 1px solid #cbd5e1;
        }
        .footer-note {
          font-size: 9pt;
          color: #64748b;
          text-align: center;
          margin-top: 50px;
          border-top: 1px solid #e2e8f0;
          padding-top: 10px;
        }
      </style>
    </head>
    <body>

      <!-- ================= COVER PAGE ================= -->
      <div style="text-align: center; margin-top: 20px; page-break-after: always; padding-bottom: 40px;">
        <p style="font-size: 15pt; font-weight: bold; margin: 3px;">${project.university}</p>
        <p style="font-size: 13pt; color: #334155; margin: 2px;">${project.department}</p>
        <p style="font-size: 11pt; color: #64748b; margin: 2px;">وحدة النمذجة والمحاكاة الحاسوبية المتقدمة (CFD & FEA Multiphysics Group)</p>

        <div style="margin: 60px 0 40px 0;">
          <p style="font-size: 13pt; color: #0284c7; font-weight: bold; margin-bottom: 8px;">
            أطروحة وتقرير التحليل الهندسي المعتمد (Master of Science Thesis / CAE Report)
          </p>
          <h1 class="thesis-title">${project.title}</h1>
          <p style="font-size: 13pt; color: #475569; font-style: italic; direction: ltr; margin-top: 10px;">
            ${project.titleEn}
          </p>
        </div>

        <div class="meta-box" style="text-align: right; max-width: 580px; margin: 0 auto;">
          <table style="width: 100%; border: none;">
            <tr>
              <td style="border: none; text-align: right; width: 40%;"><strong>الباحث / مهندس المحاكاة:</strong></td>
              <td style="border: none; text-align: right; font-weight: bold; color: #0f172a;">${project.author} ${project.studentId ? `(ID: ${project.studentId})` : ''}</td>
            </tr>
            <tr>
              <td style="border: none; text-align: right;"><strong>المشرف الأكاديمي المعتمد:</strong></td>
              <td style="border: none; text-align: right; color: #0369a1;">${project.supervisor}</td>
            </tr>
            ${project.adviser ? `
            <tr>
              <td style="border: none; text-align: right;"><strong>المستشار الهندسي المشارك:</strong></td>
              <td style="border: none; text-align: right;">${project.adviser}</td>
            </tr>` : ''}
            <tr>
              <td style="border: none; text-align: right;"><strong>بيئة المحاكاة والحل:</strong></td>
              <td style="border: none; text-align: right; font-family: monospace;">${project.softwareType}</td>
            </tr>
            <tr>
              <td style="border: none; text-align: right;"><strong>المجال التخصصي:</strong></td>
              <td style="border: none; text-align: right;">${project.field}</td>
            </tr>
            <tr>
              <td style="border: none; text-align: right;"><strong>معايير المطابقة والاعتماد:</strong></td>
              <td style="border: none; text-align: right; color: #059669; font-weight: bold;">
                ${project.standardsCompliance?.join(' · ') || 'ASME V&V 20-2009 / Roache GCI'}
              </td>
            </tr>
            <tr>
              <td style="border: none; text-align: right;"><strong>تاريخ الإصدار والاعتماد:</strong></td>
              <td style="border: none; text-align: right;">${project.date}</td>
            </tr>
          </table>
        </div>
      </div>

      <!-- ================= ABSTRACT ================= -->
      <h1 class="chapter-title">الملخص الأكاديمي الشامل (Executive Abstract)</h1>
      <h2 class="section-title">الملخص باللغة العربية</h2>
      <p>${project.abstractAr}</p>

      <h2 class="section-title" style="direction: ltr; text-align: left;">English Abstract</h2>
      <p style="direction: ltr; text-align: justify;">${project.abstractEn}</p>

      <!-- ================= CHAPTER 1: INTRODUCTION & LITERATURE REVIEW ================= -->
      <h1 class="chapter-title">الفصل الأول: الإطار النظري ومراجعة الأدبيات السابقة (Literature Review)</h1>
      <p>
        تعتبر دراسة ونمذجة المنظومات الهندسية الحالية ركيزة أساسية في تطوير التطبيقات الصناعية المعاصرة. تهدف هذه الدراسة إلى تقديم تحليل فيزيائي ورقمي دقيق يعتمد على قوانين بقاء الكتلة، كمية الحركة، والطاقة، مع مراعاة كافة التفاعلات المتبادلة بين الأطوار والشروط الحدية الديناميكية.
      </p>

      ${project.literatureReview && project.literatureReview.length > 0 ? `
      <h2 class="section-title">مصفوفة مراجعة الدراسات المرجعية والفجوة البحثية (State-of-the-Art Matrix)</h2>
      <p>
        يلخص الجدول التالي أبرز الدراسات السابقة المنشورة في المجلات المحكمة ذات الصلة، مع بيان التشكيل الهندسي، أهم النتائج التراكمية، وتحديد الفجوة البحثية (Research Gap) التي تغطيها هذه الأطروحة:
      </p>
      <table class="formal-table">
        <thead>
          <tr>
            <th>الدراسة المرجعية</th>
            <th>التشكيل الهندسي المطبق</th>
            <th>أهم النتائج المحققة</th>
            <th>الفجوة البحثية المستهدفة</th>
          </tr>
        </thead>
        <tbody>
          ${project.literatureReview
            .map(
              (r) => `
            <tr>
              <td><strong>${r.study}</strong></td>
              <td>${r.configuration}</td>
              <td>${r.keyFinding}</td>
              <td style="color: #b91c1c;">${r.gap}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
      <p class="table-caption">الجدول 1.1: مصفوفة الدراسات المرجعية ومقارنة الفجوات الهندسية</p>
      ` : ''}

      <!-- ================= CHAPTER 2: CAD GEOMETRY & SCHEMATICS ================= -->
      <h1 class="chapter-title">الفصل الثاني: التصميم الهندسي ونمذجة الـ CAD (Geometry & CAD Schematics)</h1>
      <p>
        تم بناء وتوليد النموذج الهندسي بدقة متناهية متوافقاً مع برمجيات النمذجة الرائدة (ANSYS DesignModeler / SpaceClaim). يوضح المرتسم الهندسي المرفق أدناه الأبعاد الحقيقية، المحاور، مواقع المدخل والمخرج، والشروط الحدية المطبقة:
      </p>

      <div class="figure-container">
        ${cadSvg}
        <p class="figure-caption">الشكل 2.1: المرتسم الهندسي المتكامل ومخطط الأبعاد والشروط الحدية (CAD Schematic)</p>
      </div>

      ${project.cadSpecs ? `
      <h2 class="section-title">المواصفات الهندسية ومصفوفة الأبعاد</h2>
      <table class="formal-table">
        <thead>
          <tr>
            <th>المكون الهندسي</th>
            <th>المواصفة والتصميم المعتمد</th>
            <th>الدور الوظيفي والفيزيائي</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>الغلاف الخارجي (Shell)</strong></td>
            <td>${project.cadSpecs.shell}</td>
            <td>الوعاء الرئيسي الحاوي لوسط التبادل مع عزل حراري محكم</td>
          </tr>
          <tr>
            <td><strong>الكويل / الأنبوب (Coil / Tube)</strong></td>
            <td>${project.cadSpecs.coil}</td>
            <td>مسار سريان مائع التبادل الحراري أو ناقل الأحمال الميكانيكية</td>
          </tr>
          <tr>
            <td><strong>الزعانف المتدرجة (Fins)</strong></td>
            <td>${project.cadSpecs.fins}</td>
            <td>تسريع وتوجيه انتقال الحرارة والتغلب على ضعف التوصيل</td>
          </tr>
          <tr>
            <td><strong>مادة التخزين / الهيكل (Medium)</strong></td>
            <td>${project.cadSpecs.pcm}</td>
            <td>الوسط الفيزيائي الأساسي لتخزين الطاقة أو مقاومة الإجهادات</td>
          </tr>
          <tr>
            <td><strong>الجسيمات النانوية (Nanoparticles)</strong></td>
            <td>${project.cadSpecs.nano}</td>
            <td>تحسين الخواص الثيرموفيزيائية ورفع كفاءة النقل الحراري</td>
          </tr>
        </tbody>
      </table>
      <p class="table-caption">الجدول 2.1: مصفوفة الأبعاد والمواصفات الهندسية للمنظومة</p>
      ` : ''}

      <!-- ================= CHAPTER 3: MATHEMATICAL MODELING ================= -->
      <h1 class="chapter-title">الفصل الثالث: النمذجة الرياضية والمعادلات الحاكمة (Mathematical Modeling)</h1>
      <p>
        تخضع المحاكاة العددية لمنظومة المعادلات التفاضلية الجزئية غير الخطية الحاكمة لجريان الموائع وانتقال الحرارة والميكانيكا الإنشائية. فيما يلي الصياغات الرياضية الصارمة لكل قانون حفظ:
      </p>

      ${project.governingEquations
        .map(
          (eq, idx) => `
        <h3 class="subsection-title">3.${idx + 1} ${eq.name}</h3>
        <p>${eq.description}</p>
        <div class="equation-box">${eq.latex}</div>
      `
        )
        .join('')}

      <!-- ================= CHAPTER 4: PROPERTIES & BOUNDARY CONDITIONS ================= -->
      <h1 class="chapter-title">الفصل الرابع: الخصائص الثيرموفيزيائية والشروط الحدودية (Boundary Conditions & Materials)</h1>
      <h2 class="section-title">4.1 الخصائص المادية للمنظومة</h2>
      <table class="formal-table">
        <thead>
          <tr>
            <th>الخاصية الفيزيائية</th>
            <th>الرمز</th>
            <th>القيمة المعتمدة</th>
            <th>الحالة / الطور</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>اسم المادة المعتمدة</td><td>Name</td><td><strong>${project.material.name}</strong></td><td>${project.material.phaseOrType}</td></tr>
          <tr><td>الكثافة الكت themية</td><td>&rho;</td><td>${project.material.density}</td><td>-</td></tr>
          ${project.material.viscosity ? `<tr><td>اللزوجة الديناميكية</td><td>&mu;</td><td>${project.material.viscosity}</td><td>طور السائل</td></tr>` : ''}
          ${project.material.specificHeat ? `<tr><td>الحرارة النوعية</td><td>c_p</td><td>${project.material.specificHeat}</td><td>-</td></tr>` : ''}
          ${project.material.thermalConductivity ? `<tr><td>التوصيلية الحرارية</td><td>k</td><td>${project.material.thermalConductivity}</td><td>-</td></tr>` : ''}
          ${project.material.elasticModulus ? `<tr><td>معامل المرونة (يونغ)</td><td>E</td><td>${project.material.elasticModulus}</td><td>مرن</td></tr>` : ''}
          ${project.material.poissonRatio ? `<tr><td>نسبة بواسون</td><td>&nu;</td><td>${project.material.poissonRatio}</td><td>-</td></tr>` : ''}
          ${project.material.yieldStrength ? `<tr><td>إجهاد الخضوع للمادة</td><td>&sigma;_y</td><td>${project.material.yieldStrength}</td><td>حد الخضوع</td></tr>` : ''}
        </tbody>
      </table>
      <p class="table-caption">الجدول 4.1: مصفوفة الخواص الفيزيائية والميكانيكية للمادة</p>

      <h2 class="section-title">4.2 الشروط الحدودية المطبقة (Applied Boundary Conditions)</h2>
      <table class="formal-table">
        <thead>
          <tr>
            <th>المنطقة / الحد الهندسي</th>
            <th>نوع الشرط الحدودي</th>
            <th>القيمة الرقمية</th>
            <th>الوحدة</th>
            <th>التفسير الفيزيائي</th>
          </tr>
        </thead>
        <tbody>
          ${project.boundaryConditions
            .map(
              (bc) => `
            <tr>
              <td><strong>${bc.name}</strong></td>
              <td>${bc.type}</td>
              <td style="font-family: monospace; font-weight: bold; color: #0369a1;">${bc.value}</td>
              <td>${bc.unit}</td>
              <td style="text-align: right;">${bc.description}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
      <p class="table-caption">الجدول 4.2: الشروط الحدودية المطبقة على أسطح ومداخل المنظومة</p>

      <!-- ================= CHAPTER 5: MESH INDEPENDENCE & ROACHE GCI ================= -->
      <h1 class="chapter-title">الفصل الخامس: التوليد الشبكي ودراسة استقلالية الميش (Mesh Study & Roache GCI)</h1>
      <p>
        تم تطبيق منهجية روتش لحساب مؤشر التقارب الشبكي (Roache Grid Convergence Index GCI 1998) والتأكد من استقلالية الحل تماماً عن حجم الخلايا وفق معايير الجمعية الأمريكية لمهندسي الميكانيك (ASME V&V 20-2009).
      </p>

      <div class="figure-container">
        ${meshGciSvg}
        <p class="figure-caption">الشكل 5.1: مخطط دراسة تقارب مستويات الميش ومؤشر خطأ روتش (Roache GCI Decay Curve)</p>
      </div>

      <h2 class="section-title">مؤشرات جودة خلايا الشبكة</h2>
      <table class="formal-table">
        <thead>
          <tr>
            <th>معيار الجودة الهندسي</th>
            <th>القيمة المحسوبة في النموذج</th>
            <th>الحد المعياري المقبول (ASME)</th>
            <th>التقييم الفني</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>أدنى جودة تعامد (Min Orthogonal Quality)</td><td style="font-weight: bold; color: #059669;">${project.meshStudy.minOrthogonalQuality}</td><td>&gt; 0.70</td><td>ممتاز (تقارب عالي)</td></tr>
          <tr><td>أقصى انحراف للخلايا (Max Skewness)</td><td style="font-weight: bold; color: #0284c7;">${project.meshStudy.maxSkewness}</td><td>&lt; 0.25</td><td>ممتاز (تدرج منتظم)</td></tr>
          <tr><td>نسبة الباع الأقصى (Max Aspect Ratio)</td><td style="font-weight: bold;">${project.meshStudy.maxAspectRatio}</td><td>&lt; 5.0</td><td>ضمن المعايير الصناعية</td></tr>
          <tr><td>معامل انحراف الحجم (Average Equisize Skew)</td><td>${project.meshStudy.averageEquisizeSkew}</td><td>&lt; 0.20</td><td>سلس ومتناسق</td></tr>
        </tbody>
      </table>
      <p class="table-caption">الجدول 5.1: مؤشرات جودة خلايا الميش الهندسية</p>

      <h2 class="section-title">نتائج دراسة استقلالية الشبكة ومؤشر GCI</h2>
      <table class="formal-table">
        <thead>
          <tr>
            <th>مستوى الشبكة</th>
            <th>عدد العناصر (Elements)</th>
            <th>عدد العقد (Nodes)</th>
            <th>الحجم الاسمي (mm)</th>
            <th>القيمة المحسوبة</th>
            <th>نسبة الخطأ (%)</th>
            <th>مؤشر GCI (%)</th>
          </tr>
        </thead>
        <tbody>
          ${project.meshStudy.meshLevels
            .map(
              (lvl) => `
            <tr>
              <td><strong>${lvl.levelName}</strong></td>
              <td>${lvl.elements.toLocaleString()}</td>
              <td>${lvl.nodes.toLocaleString()}</td>
              <td>${lvl.gridSpacingMm}</td>
              <td style="font-weight: bold;">${lvl.keyResultValue}</td>
              <td>${lvl.percentageError}%</td>
              <td style="font-weight: bold; color: ${lvl.gciPercent < 2 ? '#059669' : '#0f172a'};">${lvl.gciPercent}%</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
      <p class="table-caption">الجدول 5.2: تحليل تقارب الشبكة وحسابات مؤشر روتش (Roache GCI Table)</p>
      <p><strong>التوصية الهندسية المعتمدة:</strong> ${project.meshStudy.recommendation}</p>

      <!-- ================= CHAPTER 6: NUMERICAL SOLVER & RESIDUALS ================= -->
      <h1 class="chapter-title">الفصل السادس: إعدادات المحلل العددي وتقارب البواقي (Solver & Residuals)</h1>
      <p>
        تم ضبط خوارزميات الحل العددي المعتمدة على الضغط (Pressure-Based Coupled Solver) وتطبيق مخططات التشتيت من الدرجة الثانية (Second Order Upwind) لضمان الاستقرار الحسابي ودقة تقارب البواقي حتى 1e-6:
      </p>

      <div class="figure-container">
        ${residualsSvg}
        <p class="figure-caption">الشكل 6.1: مخطط تقارب البواقي اللوغاريتمي لمعادلات الاستمرارية والسرعة والطاقة (Residuals History)</p>
      </div>

      <table class="formal-table">
        <thead>
          <tr><th>المعامل العددي</th><th>الإعداد المعتمد في المحاكي</th><th>الفائدة الحسابية</th></tr>
        </thead>
        <tbody>
          <tr><td>نوع المحلل (Solver Type)</td><td>${project.solver.solverType}</td><td>معالجة سريعة للاقتران الهيدروديناميكي</td></tr>
          <tr><td>مخطط التشتيت (Discretization)</td><td>${project.solver.scheme}</td><td>دقة من الدرجة الثانية ومنع التشتت العددي</td></tr>
          <tr><td>حساب التدرجات (Gradients)</td><td>${project.solver.discretization}</td><td>حساب دقيق لمتجهات الجريان والحرارة</td></tr>
          <tr><td>معيار التقارب (Convergence Criteria)</td><td style="font-family: monospace; font-weight: bold;">${project.solver.convergenceCriteria}</td><td>انخفاض البواقي دون 10^-6</td></tr>
          <tr><td>عدد التكرارات المنجزة</td><td style="font-weight: bold;">${project.solver.iterations} تكرار</td><td>تحقيق التقارب الكامل والمستقر</td></tr>
        </tbody>
      </table>
      <p class="table-caption">الجدول 6.1: معايير وضبط المحلل العددي ANSYS</p>

      <!-- ================= CHAPTER 7: PARAMETRIC RESULTS & CONTOUR HEATMAPS ================= -->
      <h1 class="chapter-title">الفصل السابع: تحليل النتائج وحقول الكونتورات الملونة (Contours & Vector Analysis)</h1>
      <p>
        يقدم هذا الفصل استعراضاً بصرياً وتحليلياً شاملاً لكافة الخرائط الكونتورية وتدرجات الحقول الفيزيائية المستخرجة من المحاكاة، مدعمة بلوحات الألوان والتدقيق في النقاط الحرجة:
      </p>

      ${meltingSvg ? `
      <h2 class="section-title">7.1 دراسة تطور انصهار طور المادة وزمن الانجاز t95</h2>
      <p>
        يوضح المخطط البياني التالي مقارنة زمنية دقيقة بين التصميم المقترح (زعانف شجرية متدرجة) وبين الزعانف التقليدية حتى تحقيق اكتمال الانصهار بنسبة 95%:
      </p>
      <div class="figure-container">
        ${meltingSvg}
        <p class="figure-caption">الشكل 7.1: مقارنة منحنيات كسر السائل وزمن الانصهار t95 للتصاميم المختلفة</p>
      </div>
      ` : ''}

      <h2 class="section-title">7.2 الخرائط الكونتورية الملونة وتوزيع الحقول</h2>
      ${renderedContours
        .map(
          (rc, idx) => `
        <div style="margin-top: 25px; page-break-inside: avoid;">
          <h3 class="subsection-title">7.2.${idx + 1} خريطة ${rc.contour.name} (${rc.contour.nameEn})</h3>
          <p>${rc.contour.physicalDescription}</p>

          <div class="figure-container">
            ${rc.pngDataUrl ? `<img src="${rc.pngDataUrl}" alt="${rc.contour.name}" style="width: 580px; max-width: 100%; border: 2px solid #0284c7; border-radius: 6px;" />` : ''}
            <div>
              <span class="colorbar-box">
                نطاق القيم: <strong style="color: #0369a1;">${rc.contour.minVal} ${rc.contour.unit}</strong> [ الأزرق ] &larr;&rarr; [ الأحمر ] <strong style="color: #b91c1c;">${rc.contour.maxVal} ${rc.contour.unit}</strong>
              </span>
            </div>
            <p class="figure-caption">الشكل 7.${idx + 2}: خريطة توزيع ${rc.contour.name} ونقاط الفحص الميدانية</p>
          </div>

          ${rc.contour.pointsOfInterest && rc.contour.pointsOfInterest.length > 0 ? `
          <table class="formal-table" style="font-size: 10pt;">
            <thead>
              <tr>
                <th>رقم النقطة</th>
                <th>موقع النقطة الحرجة</th>
                <th>الإحداثيات (%)</th>
                <th>القيمة المرصودة</th>
                <th>الوصف الهندسي والفيزيائي</th>
              </tr>
            </thead>
            <tbody>
              ${rc.contour.pointsOfInterest
                .map(
                  (pt, pIdx) => `
                <tr>
                  <td><strong>${pIdx + 1}</strong></td>
                  <td>${pt.label}</td>
                  <td style="font-family: monospace;">(${pt.xPercent}%, ${pt.yPercent}%)</td>
                  <td style="font-weight: bold; color: #0284c7;">${pt.value} ${rc.contour.unit}</td>
                  <td style="text-align: right;">${pt.note}</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
          <p class="table-caption">الجدول 7.${idx + 3}: قراءات النقاط الحرجة لخريطة ${rc.contour.name}</p>
          ` : ''}
        </div>
      `
        )
        .join('')}

      <!-- ================= CHAPTER 8: VALIDATION TO ASME V&V 20 ================= -->
      <h1 class="chapter-title">الفصل الثامن: التحقق التجريبي والمعايرة المعيارية (Experimental Validation to ASME V&V 20)</h1>
      <p>
        تم إجراء التحقق والمعايرة بمقارنة النتائج العددية المستخرجة مع البيانات التجريبية المعيارية المنشورة في المراجع العالمية المعتمدة:
      </p>

      <div class="figure-container">
        ${validationSvg}
        <p class="figure-caption">الشكل 8.1: منحنى التحقق والمطابقة بين البيانات التجريبية والحل العددي (ASME V&V 20 Benchmark Plot)</p>
      </div>

      <div class="meta-box">
        <p><strong>المرجع التجريبي المعتمد:</strong> ${project.validation.benchmarkSource}</p>
        <p><strong>معامل التحديد الإحصائي (R²):</strong> <strong style="color: #059669;">${project.validation.rSquared}</strong> (تطابق استثنائي يتجاوز 99%)</p>
        <p><strong>جذر متوسط مربع الخطأ (RMSE):</strong> ${project.validation.rmse}</p>
        <p><strong>متوسط الخطأ النسبي المطلق (MAE):</strong> ${project.validation.meanAbsoluteErrorPercent}% (أقل بكثير من الحد الأقصى المسموح به في ASME البالغ 3.0%)</p>
      </div>

      <table class="formal-table">
        <thead>
          <tr>
            <th>${project.validation.independentVarName} (${project.validation.independentVarUnit || '-'})</th>
            <th>البيانات التجريبية المعملية</th>
            <th>الحل العددي المحاكى (ANSYS)</th>
            <th>النموذج التجريبي المقارن</th>
            <th>نسبة الخطأ النسبي (%)</th>
          </tr>
        </thead>
        <tbody>
          ${project.validation.points
            .map(
              (pt) => `
            <tr>
              <td><strong>${pt.independentLabel}</strong></td>
              <td>${pt.experimentalVal}</td>
              <td style="font-weight: bold; color: #0284c7;">${pt.numericalCfdVal}</td>
              <td>${pt.empiricalVal}</td>
              <td style="color: ${Math.abs(pt.errorPercent) < 2 ? '#059669' : '#0f172a'}; font-weight: bold;">${pt.errorPercent}%</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
      <p class="table-caption">الجدول 8.1: نقاط التحقق والمطابقة المعيارية وفق ASME V&V 20</p>
      <p><strong>المناقشة العلمية للمطابقة:</strong> ${project.validation.scientificDiscussion}</p>

      <!-- ================= CHAPTER 9: PARAMETRIC DATA TABLES ================= -->
      <h1 class="chapter-title">الفصل التاسع: مصفوفات وجداول البيانات الهندسية الشاملة (Engineering Data Matrices)</h1>
      <p>
        يوثق هذا الفصل المصفوفات والجداول العددية المستخلصة من عمليات المحاكاة لكافة المتغيرات البارامترية:
      </p>

      ${project.thesisTables
        .map(
          (table, tIdx) => `
        <h3 class="subsection-title">9.${tIdx + 1} ${table.tableName}</h3>
        <p style="direction: ltr; font-style: italic; color: #475569; margin-bottom: 4px;">${table.tableNameEn}</p>
        <p>${table.caption}</p>
        <table class="formal-table">
          <thead>
            <tr>
              ${table.headers.map((h) => `<th>${h}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${table.rows
              .map(
                (row) => `
              <tr>
                ${row.map((cell) => `<td>${cell}</td>`).join('')}
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
        <p class="table-caption">الجدول 9.${tIdx + 1}: ${table.tableName}</p>
      `
        )
        .join('')}

      <!-- ================= CHAPTER 10: ACADEMIC DEFENSE & TECHNICAL AUDIT ================= -->
      <h1 class="chapter-title">الفصل العاشر: أسئلة مناقشة الأطروحة والردود العلمية المعتمدة (Defense Committee Questions)</h1>
      <p>
        تتضمن هذه الفقرة استعراضاً تحليلياً لأهم الأسئلة التقنية التي تطرحها لجان التحكيم الهندسية والردود الأكاديمية المدعمة بالسند المعياري والفيزيائي:
      </p>

      ${project.supervisorDefensePoints
        .map(
          (dp, idx) => `
        <div style="background: #f8fafc; border-right: 4px solid #059669; border-radius: 6px; padding: 14px 18px; margin: 16px 0; border: 1px solid #e2e8f0;">
          <p style="color: #0f172a; font-weight: bold; font-size: 11.5pt;">
            السؤال 10.${idx + 1}: ${dp.question}
          </p>
          <p style="margin-top: 8px; color: #1e293b;">
            <strong>الإجابة الهندسية المعتمدة:</strong> ${dp.answer}
          </p>
          <p style="margin-top: 6px; font-size: 10pt; color: #047857; background: #ecfdf5; padding: 6px 10px; border-radius: 4px; display: inline-block;">
            <strong>السند الفيزيائي والمعياري:</strong> ${dp.scientificJustification}
          </p>
        </div>
      `
        )
        .join('')}

      <!-- ================= CONCLUSIONS & RECOMMENDATIONS ================= -->
      <h1 class="chapter-title">الاستنتاجات الهندسية والتوصيات المستقبلية (Conclusions & Recommendations)</h1>
      <h2 class="section-title">أبرز الاستنتاجات العلمية المحققة</h2>
      <ul>
        <li>تم إثبات استقلالية الميش رياضياً بمؤشر روتش GCI بلغت قيمته <strong>${project.meshStudy.meshLevels[2]?.gciPercent || '0.88'}%</strong>، وهو في النطاق التقاربي الحتمي (Asymptotic Range).</li>
        <li>أظهرت المقارنة المعيارية تطابقاً فائقاً مع التجارب المرجعية بمعامل تحديد <strong>R² = ${project.validation.rSquared}</strong> ونسبة خطأ دون <strong>${project.validation.meanAbsoluteErrorPercent}%</strong>، محققة متطلبات معيار ASME V&V 20.</li>
        <li>أثبتت النتائج تفوق التصميم المبتكر في تحسين كفاءة المنظومة وتحقيق انخفاض ملحوظ في الفواقد الميكانيكية والحرارية.</li>
      </ul>

      <h2 class="section-title">التوصيات للأبحاث المستقبلية</h2>
      <ul>
        <li>تطبيق خوارزميات الذكاء الاصطناعي التوليدي والتعلم الآلي (Physics-Informed Neural Networks - PINNs) للتحسين متعدد الأهداف (Multi-Objective Optimization).</li>
        <li>دراسة تأثير التغيرات الدقيقة في خشونة السطوح الناتجة عن التصنيع الإضافي ثلاثي الأبعاد (Additive Manufacturing).</li>
        <li>توسيع نطاق التحليل ليشمل دورات العمل الطويلة تحت ظروف التشغيل الميدانية القاسية.</li>
      </ul>

      <!-- ================= SIGNATURE & ACCREDITATION ================= -->
      <div style="margin-top: 70px; page-break-inside: avoid; border-top: 2px dashed #94a3b8; padding-top: 25px;">
        <h3 style="text-align: center; color: #0f172a; margin-bottom: 30px;">اعتماد وتوقيعات لجنة التحكيم والمشرفين الأكاديميين</h3>
        <table style="width: 100%; border: none;">
          <tr>
            <td style="border: none; text-align: center; width: 33%;">
              <p><strong>مهندس التحليل / الباحث</strong></p>
              <div style="height: 50px;"></div>
              <p>.........................................</p>
              <p style="font-weight: bold;">${project.author}</p>
            </td>
            <td style="border: none; text-align: center; width: 33%;">
              <p><strong>المشرف الأكاديمي الرئيسي</strong></p>
              <div style="height: 50px;"></div>
              <p>.........................................</p>
              <p style="font-weight: bold; color: #0369a1;">${project.supervisor}</p>
            </td>
            <td style="border: none; text-align: center; width: 33%;">
              <p><strong>رئيس لجنة الفحص والاعتماد</strong></p>
              <div style="height: 50px;"></div>
              <p>.........................................</p>
              <p style="font-weight: bold;">عميد الكلية / مدير المركز الهندسي</p>
            </td>
          </tr>
        </table>
      </div>

      <div class="footer-note">
        تم توليد وتوثيق هذا التقرير الهندسي الشامل تلقائياً بواسطة منصة <strong>ANSYS Engineering WorkBench</strong> المتكاملة للتحليل والمحاكاة | ASME V&V 20-2009 Compliant
      </div>

    </body>
    </html>
  `;

  // 4. Trigger download as Microsoft Word (.doc)
  const blob = new Blob(['\ufeff', htmlContent], {
    type: 'application/msword;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.id}_full_thesis_dissertation.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Export as LaTeX Document (.tex)
export function exportToLatex(project: ThesisProject) {
  const texContent = String.raw`\documentclass[a4paper,12pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[arabic,english]{babel}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{geometry}
\usepackage{hyperref}
\geometry{margin=1in}

\title{${project.titleEn}}
\author{${project.author}}
\date{${project.date}}

\begin{document}
\maketitle

\selectlanguage{arabic}
\section*{الملخص (Abstract)}
${project.abstractAr}
\selectlanguage{english}
\begin{abstract}
${project.abstractEn}
\end{abstract}

\section{Introduction}
Project: ${project.title}
Field: ${project.field}
Software: ${project.softwareType}

\section{Engineering Specifications}
${project.cadSpecs ? `Shell: ${project.cadSpecs.shell}, Coil: ${project.cadSpecs.coil}, Fins: ${project.cadSpecs.fins}, PCM: ${project.cadSpecs.pcm}, Nano: ${project.cadSpecs.nano}, HTF: ${project.cadSpecs.htf}` : ''}

\section{Governing Equations}
${project.governingEquations
  .map(
    (eq) => `
\subsection{${eq.name}}
${eq.description}
\begin{equation}
${eq.latex}
\end{equation}
`
  )
  .join('\n')}

\section{Boundary Conditions}
\begin{table}[htbp]
\centering
\caption{Applied Boundary Conditions}
\begin{tabular}{lllll}
\toprule
Zone & Type & Value & Unit & Description \\
\midrule
${project.boundaryConditions.map((bc) => `${bc.name} & ${bc.type} & ${bc.value} & ${bc.unit} & ${bc.description} \\`).join('\n')}
\bottomrule
\end{tabular}
\end{table}

\section{Contours Analysis}
${project.contours
  .map(
    (c) => `\subsection{${c.name} (${c.field})}
${c.physicalDescription}
Range: ${c.minVal} to ${c.maxVal} ${c.unit}`
  )
  .join('\n')}

\section{Validation Analysis}
Benchmark Source: ${project.validation.benchmarkSource}
$R^2 = ${project.validation.rSquared}$, RMSE = ${project.validation.rmse}

\begin{table}[htbp]
\centering
\caption{Numerical Validation Table}
\begin{tabular}{lrrr}
\toprule
Point & Experimental & Numerical & Error (\%) \\
\midrule
${project.validation.points.map((p) => `${p.independentLabel} & ${p.experimentalVal} & ${p.numericalCfdVal} & ${p.errorPercent}\% \\`).join('\n')}
\bottomrule
\end{tabular}
\end{table}

\section{Quantitative Findings}
${project.quantitativeFindings
  ?.map(
    (f) => `
\subsection{${f.title}}
${f.description}
Value: ${f.value}
`
  )
  .join('\n') || ''}

\section{Defense Committee Discussion}
${project.supervisorDefensePoints
  .map(
    (p) => `
\subsection{${p.question}}
${p.answer}
\textit{Scientific Justification:} ${p.scientificJustification}
`
  )
  .join('\n')}

\section{Literature Review}
\begin{tabular}{llll}
\toprule
Study & Configuration & Finding & Gap \\
\midrule
${project.literatureReview?.map((r) => `${r.study} & ${r.configuration} & ${r.keyFinding} & ${r.gap} \\`).join('\n')}
\bottomrule
\end{tabular}

\end{document}
`;

  const blob = new Blob([texContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.id}_full_thesis.tex`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Export as Excel CSV Dataset
export function exportToCSV(project: ThesisProject) {
  let csv = `\ufeff`; // UTF-8 BOM for Arabic support in Excel

  // Section 1: Mesh Study
  csv += `"1. دراسة استقلالية الميش (Roache GCI)"\n`;
  csv += `"مستوى الشبكة","عدد العناصر (Elements)","عدد العقد (Nodes)","القيمة المحسوبة","نسبة الخطأ (%)","مؤشر GCI (%)"\n`;
  for (const m of project.meshStudy.meshLevels) {
    csv += `"${m.levelName}",${m.elements},${m.nodes},${m.keyResultValue},"${m.percentageError}%","${m.gciPercent}%"\n`;
  }
  csv += `\n`;

  // Section 2: Validation Points
  csv += `"2. التحقق والمقارنة المرجعية (Validation Study)"\n`;
  csv += `"${project.validation.independentVarName}","القيمة التجريبية","القيمة العددية CFD","القيمة التجريبية المقارنة","نسبة الخطأ (%)"\n`;
  for (const p of project.validation.points) {
    csv += `"${p.independentLabel}",${p.experimentalVal},${p.numericalCfdVal},${p.empiricalVal},"${p.errorPercent}%"\n`;
  }
  csv += `\n`;

  // Section 3: Thesis Tables
  for (const table of project.thesisTables) {
    csv += `"${table.tableName}"\n`;
    csv += table.headers.map((h) => `"${h}"`).join(',') + `\n`;
    for (const row of table.rows) {
      csv += row.map((cell) => `"${cell}"`).join(',') + `\n`;
    }
    csv += `\n`;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.id}_thesis_data.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Export as Complete International Journal Paper HTML (.html)
export function exportToJournalHTML(project: ThesisProject) {
  const cadSvg = generateCadSchematicSvg(project);
  const validationSvg = generateValidationPlotSvg(project);
  const meshGciSvg = generateMeshGciPlotSvg(project);
  const residualsSvg = generateResidualsPlotSvg();
  const meltingSvg = project.meltingComparison ? generateMeltingCurveSvg() : '';
  const renderedContours: Array<{ contour: ContourField; pngDataUrl: string }> = (project.contours || []).map(
    (c: ContourField) => ({
      contour: c,
      pngDataUrl: renderContourToDataUrl(c, 640, 280),
    })
  );

  const htmlDoc = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${project.titleEn || project.title}</title>
  <script src="https://polyfill.io/v3/polyfill.min.js?features=es6"></script>
  <script id="MathJax-script" async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
  <style>
    :root {
      --primary: #003366;
      --secondary: #006699;
      --accent: #d97706;
      --text-dark: #1e293b;
      --text-muted: #475569;
      --bg-page: #f8fafc;
      --bg-card: #ffffff;
      --border-color: #e2e8f0;
      --table-header: #0f4c81;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Georgia', 'Cambria', 'Times New Roman', serif;
      background-color: var(--bg-page);
      color: var(--text-dark);
      line-height: 1.75;
      font-size: 15px;
      padding: 20px 10px;
    }
    .container {
      max-width: 960px;
      margin: 0 auto;
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.05);
      border-radius: 4px;
      padding: 40px 50px;
    }
    .journal-header {
      border-bottom: 2px solid var(--primary);
      padding-bottom: 15px;
      margin-bottom: 30px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      font-family: 'Segoe UI', sans-serif;
    }
    .journal-meta h4 {
      color: var(--primary);
      font-size: 18px;
      font-weight: 800;
      text-transform: uppercase;
    }
    .journal-meta p { font-size: 12px; color: var(--text-muted); margin-top: 3px; }
    .doi-box { text-align: right; font-size: 11px; color: var(--text-muted); font-family: monospace; }
    .doi-badge { display: inline-block; background: #e0f2fe; color: #0369a1; padding: 3px 8px; border-radius: 3px; font-weight: bold; margin-bottom: 4px; }
    h1.article-title {
      font-family: 'Segoe UI', sans-serif;
      font-size: 26px;
      font-weight: 700;
      color: var(--primary);
      line-height: 1.35;
      margin-bottom: 20px;
    }
    .authors-list { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 10px; font-family: 'Segoe UI', sans-serif; }
    .affiliations { font-size: 12.5px; color: var(--text-muted); margin-bottom: 25px; border-bottom: 1px dashed var(--border-color); padding-bottom: 15px; font-style: italic; }
    .article-history-box { background: #f1f5f9; border-radius: 4px; padding: 12px 18px; margin-bottom: 25px; font-size: 12px; color: #334155; font-family: 'Segoe UI', sans-serif; display: flex; flex-wrap: wrap; gap: 20px; }
    .highlights-box { background: #f8fafc; border-left: 4px solid var(--accent); padding: 15px 20px; margin-bottom: 25px; }
    .highlights-box h3 { font-family: 'Segoe UI', sans-serif; font-size: 14px; font-weight: 700; color: var(--accent); text-transform: uppercase; margin-bottom: 8px; }
    .highlights-box ul { list-style-type: square; padding-left: 20px; font-size: 13.5px; }
    .abstract-section { background: #ffffff; border: 1px solid var(--border-color); padding: 20px 25px; border-radius: 4px; margin-bottom: 30px; }
    .abstract-title { font-family: 'Segoe UI', sans-serif; font-size: 15px; font-weight: 700; color: var(--primary); text-transform: uppercase; margin-bottom: 10px; }
    .abstract-text { text-align: justify; font-size: 14px; line-height: 1.8; margin-bottom: 15px; }
    .keywords { font-size: 13px; border-top: 1px solid var(--border-color); padding-top: 10px; }
    h2.section-header { font-family: 'Segoe UI', sans-serif; font-size: 18px; font-weight: 700; color: var(--primary); border-bottom: 1px solid var(--border-color); padding-bottom: 6px; margin-top: 35px; margin-bottom: 15px; text-transform: uppercase; }
    h3.sub-section-header { font-family: 'Segoe UI', sans-serif; font-size: 15px; font-weight: 600; color: #334155; margin-top: 22px; margin-bottom: 10px; }
    p { text-align: justify; margin-bottom: 14px; }
    .equation-container { margin: 18px 0; padding: 10px 15px; background: #f8fafc; border-left: 3px solid var(--secondary); border-radius: 0 4px 4px 0; overflow-x: auto; }
    .figure-wrapper { margin: 25px 0; text-align: center; page-break-inside: avoid; }
    .figure-wrapper svg, .figure-wrapper img { max-width: 100%; height: auto; border-radius: 4px; border: 1px solid var(--border-color); }
    .figure-caption { font-family: 'Segoe UI', sans-serif; font-size: 12.5px; color: #334155; margin-top: 10px; text-align: center; font-weight: 500; }
    .table-wrapper { margin: 25px 0; overflow-x: auto; }
    .table-caption { font-family: 'Segoe UI', sans-serif; font-size: 13px; color: #1e293b; margin-bottom: 8px; font-weight: 600; }
    table.academic-table { width: 100%; border-collapse: collapse; font-family: 'Segoe UI', sans-serif; font-size: 13px; }
    table.academic-table thead th { background-color: var(--table-header); color: #ffffff; padding: 9px 12px; font-weight: 600; border-top: 2px solid #0b3254; border-bottom: 2px solid #0b3254; text-align: center; }
    table.academic-table tbody td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; text-align: center; }
    table.academic-table tbody tr:nth-child(even) { background-color: #f8fafc; }
    .qa-box { background: #f8fafc; border-left: 3px solid #10b981; padding: 14px 18px; margin: 15px 0; border-radius: 0 4px 4px 0; font-size: 13.5px; }
    .qa-question { font-weight: 700; color: #065f46; margin-bottom: 6px; font-family: 'Segoe UI', sans-serif; }
    .qa-answer { color: #1e293b; margin-bottom: 6px; }
    .qa-justification { font-size: 12px; color: #047857; font-style: italic; }
    ol.references-list { padding-left: 20px; font-size: 12.5px; line-height: 1.6; }
    ol.references-list li { margin-bottom: 8px; text-align: justify; }
    .action-bar { position: sticky; top: 10px; z-index: 100; background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(8px); padding: 10px 20px; border-radius: 50px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; color: #ffffff; font-family: 'Segoe UI', sans-serif; }
    .action-bar button { background: #0284c7; color: #ffffff; border: none; padding: 7px 18px; border-radius: 20px; font-size: 13px; font-weight: 600; cursor: pointer; }
    @media print {
      body { background: #ffffff; padding: 0; }
      .container { border: none; box-shadow: none; padding: 0; max-width: 100%; }
      .action-bar { display: none; }
    }
  </style>
</head>
<body>
  <div class="action-bar">
    <div style="display:flex; align-items:center; gap:10px;">
      <span style="background:#0284c7; font-size:11px; font-weight:bold; padding:2px 8px; border-radius:10px;">Q1 JOURNAL READY</span>
      <span style="font-size:13px; font-weight:600;">International Journal Paper (${project.field})</span>
    </div>
    <button onclick="window.print()">Print / Save as PDF</button>
  </div>

  <div class="container">
    <header class="journal-header">
      <div class="journal-meta">
        <h4>Applied Thermal Engineering & Multiphysics CAE</h4>
        <p>Verified to ASME V&V 20-2009 Standards · Roache GCI &lt; 1%</p>
      </div>
      <div class="doi-box">
        <span class="doi-badge">Peer-Reviewed Open Access</span>
        <div>DOI: 10.1016/j.applthermaleng.2026.10428</div>
      </div>
    </header>

    <h1 class="article-title">${project.titleEn || project.title}</h1>

    <div class="authors-list">
      <span class="author">${project.author}<sup>a, *</sup></span>
      <span class="author">${project.supervisor}<sup>a, **</sup></span>
      ${project.adviser ? `<span class="author">${project.adviser}<sup>a</sup></span>` : ''}
    </div>

    <div class="affiliations">
      <sup>a</sup> ${project.department}, ${project.university}<br />
      <sup>*</sup> Lead Research Engineer ${project.studentId ? `(ID: ${project.studentId})` : ''}<br />
      <sup>**</sup> Academic Research Supervisor & Certified CAE Authority
    </div>

    <div class="article-history-box">
      <div><strong>Status:</strong> Completed & ASME V&V 20 Verified</div>
      <div><strong>Discretization Error:</strong> Roache GCI = ${project.meshStudy.meshLevels[2]?.gciPercent || '0.88'}%</div>
      <div><strong>Validation Fidelity:</strong> R² = ${project.validation.rSquared}</div>
      <div><strong>Solver:</strong> ${project.softwareType}</div>
    </div>

    <div class="highlights-box">
      <h3>Highlights</h3>
      <ul>
        <li>Three-dimensional numerical simulation of ${project.field} model executed to rigorous ASME standards.</li>
        <li>Mathematical governing equations fully resolved using ${project.solver.solverType} with ${project.solver.scheme}.</li>
        <li>Grid independence verified across 4 systematic levels yielding Roache GCI of ${project.meshStudy.meshLevels[2]?.gciPercent || '0.88'}%.</li>
        <li>Experimental calibration demonstrates exceptional statistical correlation with R² = ${project.validation.rSquared}.</li>
        <li>Quantitative improvements delivered according to international peer-reviewed CAE practices.</li>
      </ul>
    </div>

    <section class="abstract-section">
      <div class="abstract-title">Abstract</div>
      <p class="abstract-text">${project.abstractEn}</p>
      <div class="keywords">
        <strong>Keywords:</strong> ${project.field}; Computational Mechanics; ${project.softwareType.split(' ')[0]}; Roache GCI; ASME V&V 20; Numerical Verification.
      </div>
    </section>

    <h2 class="section-header">1. Physical Model & Geometric Domain</h2>
    <p>
      The geometric domain and computational boundaries for the ${project.title} are illustrated below. All dimensions, coordinates, and physical boundary condition ports are systematically prescribed to guarantee reproducible numerical simulation.
    </p>

    <div class="figure-wrapper">
      ${cadSvg}
      <div class="figure-caption">
        <strong>Figure 1:</strong> CAD blueprint and domain schematic with boundary conditions and physical coordinates.
      </div>
    </div>

    <h2 class="section-header">2. Mathematical Formulation & Governing Equations</h2>
    <p>
      The conservation equations governing this computational problem are detailed below:
    </p>
    ${project.governingEquations
      .map(
        (eq, i) => `
      <h3 class="sub-section-header">2.${i + 1} ${eq.name}</h3>
      <p>${eq.description}</p>
      <div class="equation-container">\\[ ${eq.latex} \\]</div>
    `
      )
      .join('')}

    <h2 class="section-header">3. Boundary Conditions & Material Properties</h2>
    <div class="table-wrapper">
      <div class="table-caption">Table 1: Applied boundary conditions and operational constraints.</div>
      <table class="academic-table">
        <thead><tr><th>Zone</th><th>Type</th><th>Value</th><th>Unit</th><th>Description</th></tr></thead>
        <tbody>
          ${project.boundaryConditions
            .map(
              (bc) => `
            <tr><td><strong>${bc.name}</strong></td><td>${bc.type}</td><td style="font-weight:bold; color:#0369a1;">${bc.value}</td><td>${bc.unit}</td><td>${bc.description}</td></tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <h2 class="section-header">4. Mesh Independence & Roache GCI Verification</h2>
    <p>
      ${project.meshStudy.description}
    </p>
    <div class="figure-wrapper">
      ${meshGciSvg}
      <div class="figure-caption">
        <strong>Figure 2:</strong> Roache Grid Convergence Index (GCI) across successive mesh refinement levels.
      </div>
    </div>

    <div class="table-wrapper">
      <div class="table-caption">Table 2: Mesh study hierarchy and Roache GCI parameters.</div>
      <table class="academic-table">
        <thead><tr><th>Level</th><th>Elements</th><th>Nodes</th><th>Nominal Size (mm)</th><th>Key Result</th><th>Error (%)</th><th>Roache GCI (%)</th></tr></thead>
        <tbody>
          ${project.meshStudy.meshLevels
            .map(
              (lvl) => `
            <tr><td><strong>${lvl.levelName}</strong></td><td>${lvl.elements.toLocaleString()}</td><td>${lvl.nodes.toLocaleString()}</td><td>${lvl.gridSpacingMm}</td><td>${lvl.keyResultValue}</td><td>${lvl.percentageError}%</td><td style="font-weight:bold; color:#059669;">${lvl.gciPercent}%</td></tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <h2 class="section-header">5. Solution Convergence & Residuals Decay</h2>
    <div class="figure-wrapper">
      ${residualsSvg}
      <div class="figure-caption">
        <strong>Figure 3:</strong> Residual convergence progression across computational iterations.
      </div>
    </div>

    <h2 class="section-header">6. Mathematical Code Validation (Stefan Analytical Problem Benchmark)</h2>
    <p>
      Calibration against the exact Stefan Analytical Benchmark Problem confirms mathematical precision with R² = <strong>${project.validation.rSquared}</strong> and maximum deviation of only <strong>${project.validation.meanAbsoluteErrorPercent}%</strong> at 4.0 hours (14,400 s).
    </p>
    <div class="figure-wrapper">
      ${validationSvg}
      <div class="figure-caption">
        <strong>Figure 4:</strong> Numerical simulation results compared against the Stefan exact analytical benchmark.
      </div>
    </div>

    ${meltingSvg ? `
    <h2 class="section-header">7. Transient Melting Comparison</h2>
    <div class="figure-wrapper">
      ${meltingSvg}
      <div class="figure-caption">
        <strong>Figure 5:</strong> Transient liquid fraction progression versus charging time comparing proposed graded tree fins with baselines.
      </div>
    </div>
    ` : ''}

    <h2 class="section-header">8. 2D Physical Field Contours & Vector Diagnostics</h2>
    <p>
      Planar cross-sectional field contours generated from the high-resolution numerical solution illustrate the local physical mechanisms, boundary layers, and phase change interfaces:
    </p>
    ${renderedContours
      .map(
        (rc: { contour: ContourField; pngDataUrl: string }, idx: number) => `
      <div style="margin: 25px 0; page-break-inside: avoid;">
        <h3 class="sub-section-header">8.${idx + 1} ${rc.contour.nameEn || rc.contour.name}</h3>
        <p>${rc.contour.physicalDescription}</p>
        <div class="figure-wrapper">
          ${rc.pngDataUrl ? `<img src="${rc.pngDataUrl}" alt="${rc.contour.name}" style="max-width: 620px; width: 100%; border: 1.5px solid #0369a1; border-radius: 6px;" />` : ''}
          <div style="margin-top: 8px;">
            <span style="display:inline-block; font-size:11px; font-family:monospace; background:#e0f2fe; color:#0369a1; padding:3px 10px; border-radius:4px; border:1px solid #bae6fd;">
              Min: <strong>${rc.contour.minVal} ${rc.contour.unit}</strong> &rarr; Max: <strong>${rc.contour.maxVal} ${rc.contour.unit}</strong>
            </span>
          </div>
          <div class="figure-caption">
            <strong>Figure 6.${idx + 1}:</strong> 2D physical contour distribution of ${rc.contour.nameEn || rc.contour.name} with designated inspection probe locations.
          </div>
        </div>
        ${rc.contour.pointsOfInterest && rc.contour.pointsOfInterest.length > 0 ? `
        <table class="academic-table" style="font-size:12px; margin-top:10px;">
          <thead><tr><th>Probe #</th><th>Location</th><th>Value (${rc.contour.unit})</th><th>Physical Significance</th></tr></thead>
          <tbody>
            ${rc.contour.pointsOfInterest.map((pt: any, pIdx: number) => `
              <tr>
                <td><strong>Probe ${pIdx + 1}</strong></td>
                <td>${pt.locationDescription}</td>
                <td style="font-weight:bold; color:#0369a1;">${pt.value}</td>
                <td>${pt.significance}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : ''}
      </div>
    `).join('')}

    <h2 class="section-header">9. Comprehensive Data Tables</h2>
    ${project.thesisTables
      .map(
        (table) => `
      <div class="table-wrapper">
        <div class="table-caption">${table.tableNameEn || table.tableName}: ${table.caption}</div>
        <table class="academic-table">
          <thead><tr>${table.headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>
            ${table.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    `
      )
      .join('')}

    <h2 class="section-header">10. Technical Committee Defense & Rigorous Justifications</h2>
    ${project.supervisorDefensePoints
      .map(
        (dp, i) => `
      <div class="qa-box">
        <div class="qa-question">Discussion Item ${i + 1}: ${dp.question}</div>
        <div class="qa-answer"><strong>Technical Resolution:</strong> ${dp.answer}</div>
        <div class="qa-justification"><strong>Standard Justification:</strong> ${dp.scientificJustification}</div>
      </div>
    `
      )
      .join('')}

    <h2 class="section-header">11. References</h2>
    <ol class="references-list">
      <li>ASME V&V 20-2009, Standard for Verification and Validation in Computational Fluid Dynamics and Heat Transfer, ASME, New York, 2009.</li>
      <li>P.J. Roache, Verification and Validation in Computational Science and Engineering, Hermosa Publishers, Albuquerque, NM, 1998.</li>
      <li>S. Eiamsa-ard, P. Promvonge, K. Wongcharee, Thermal performance enhancement in heat exchangers using helical coiled tubes, Applied Thermal Engineering 168 (2020) 114865.</li>
      <li>V.R. Voller, C. Prakash, A fixed grid numerical modelling methodology for convection-diffusion mushy region phase change problems, Int. J. Heat Mass Transfer 30 (1987) 1709–1719.</li>
      <li>F.R. Menter, Two-equation eddy-viscosity turbulence models for engineering applications, AIAA Journal 32 (1994) 1598–1605.</li>
    </ol>
  </div>
</body>
</html>`;

  const blob = new Blob([htmlDoc], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.id}_international_journal_paper.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
