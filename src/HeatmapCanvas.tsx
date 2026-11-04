import React, { useEffect, useRef, useState } from 'react';

interface HeatmapProps {
  matrix: number[][]; // مصفوفة درجات الحرارة القادمة من خلفية بايثون
}

export const HeatmapCanvas: React.FC<HeatmapProps> = ({ matrix }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [temperatureRange, setTemperatureRange] = useState({ min: 0, max: 0 });

  const paletteMid = (temperatureRange.min + temperatureRange.max) / 2;

  useEffect(() => {
    if (!matrix || matrix.length === 0) return;
    const rows = matrix.length;
    const cols = matrix[0]?.length ?? 0;
    if (cols === 0 || matrix.some((row) => row.length !== cols)) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cellWidth = canvas.width / cols;
    const cellHeight = canvas.height / rows;

    // حساب أعلى وأقل درجة حرارة لضبط تدرج الألوان تلقائياً
    let minT = Infinity;
    let maxT = -Infinity;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = matrix[r][c];
        if (!Number.isFinite(val)) continue;
        if (val < minT) minT = val;
        if (val > maxT) maxT = val;
      }
    }
    if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return;
    setTemperatureRange({ min: minT, max: maxT });
    const range = maxT - minT || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // رسم درجات الحرارة على اللوحة الملونة
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const temp = matrix[r][c];
        if (!Number.isFinite(temp)) continue;
        // تحويل القيمة الحرارية إلى زاوية لون (240=أزرق بارد ، 0=أحمر ساخن)
        const normalized = (temp - minT) / range;
        const hue = (1 - normalized) * 240;

        ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
        // رسم من الأسفل إلى الأعلى لتطابق المحاور الهندسية 2D
        ctx.fillRect(c * cellWidth, (rows - 1 - r) * cellHeight, cellWidth, cellHeight);
      }
    }
  }, [matrix]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <h4 style={{ color: '#e0e0e0', marginBottom: '10px', fontSize: '14px' }}>
        خريطة التوزيع الحراري المباشر (Thermal Contour)
      </h4>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: '14px' }}>
        <canvas
          ref={canvasRef}
          width={380}
          height={380}
          style={{
            border: '1px solid #334155',
            borderRadius: '8px',
            backgroundColor: '#111',
            boxShadow: '0 4px 15px rgba(0,0,0,0.5)',
            maxWidth: '100%',
          }}
        />
        <div aria-label="Temperature color legend" style={{ display: 'flex', gap: '7px', height: 380 }}>
          <div
            style={{
              width: 18,
              borderRadius: 4,
              border: '1px solid #475569',
              background: 'linear-gradient(to top, hsl(240, 100%, 50%), hsl(120, 100%, 50%), hsl(0, 100%, 50%))',
            }}
          />
          <div style={{ position: 'relative', width: 74, fontFamily: 'monospace', fontSize: 11, color: '#cbd5e1' }}>
            <span style={{ position: 'absolute', top: -4 }}>{temperatureRange.max.toFixed(1)} deg C</span>
            <span style={{ position: 'absolute', top: 'calc(50% - 7px)' }}>{paletteMid.toFixed(1)} deg C</span>
            <span style={{ position: 'absolute', bottom: -4 }}>{temperatureRange.min.toFixed(1)} deg C</span>
          </div>
        </div>
      </div>
    </div>
  );
};