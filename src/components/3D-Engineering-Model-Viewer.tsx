import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Box, Info } from 'lucide-react';
import { ThesisProject } from '../types/thesis';

interface EngineeringModelViewer3DProps {
  project: ThesisProject;
}

export const EngineeringModelViewer3D: React.FC<EngineeringModelViewer3DProps> = ({ project }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isFEA = project.field === 'FEA';
  const isThermal = project.field === 'Thermal';

  const defaultEq = isThermal
    ? "\\mathbf{q}'' = -k \\nabla T"
    : isFEA
    ? '\\nabla \\cdot \\boldsymbol{\\sigma} + \\mathbf{b} = 0'
    : '\\nabla \\cdot \\vec{V} = 0';

  const [selectedPin, setSelectedPin] = useState<{
    title: string;
    type: 'input' | 'output' | 'constant';
    value: string;
    equation: string;
    description: string;
  } | null>(null);

  useEffect(() => {
    if (project.boundaryConditions[0]) {
      setSelectedPin({
        title: `${project.boundaryConditions[0].name} (${project.boundaryConditions[0].type})`,
        type: 'input',
        value: `${project.boundaryConditions[0].value} ${project.boundaryConditions[0].unit}`,
        equation: project.governingEquations[0]?.latex || defaultEq,
        description: project.boundaryConditions[0].description || 'الشرط الحدودي المطبق على النموذج.',
      });
    } else {
      setSelectedPin(null);
    }
  }, [project.id, project.boundaryConditions.length]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || 700;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(6, 4.5, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    container.replaceChildren(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xe2e8f0, 1.5);
    dirLight.position.set(8, 12, 8);
    scene.add(dirLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 40;
    controls.minDistance = 1;

    // Clean Engineering Coordinate Grid & Axes (No Fake Hardcoded Geometry)
    const gridHelper = new THREE.GridHelper(10, 20, 0x1e293b, 0x0f172a);
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(1.5);
    scene.add(axesHelper);

    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 700;
      const h = container.clientHeight || 420;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
      renderer.dispose();
    };
  }, [project.id]);

  const hasInputs = project.boundaryConditions.length > 0;
  const hasResults = project.contours.length > 0;

  return (
    <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 shadow-xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Box className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>عارض النطاق الهندسي والنتائج (3D CAE Viewport)</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-sky-300 font-mono">
                {project.field}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {hasResults
                ? 'عرض توزيع الحقول الفيزيائية المستخرجة من نتائج المحاكاة'
                : 'بانتظار استيراد ملف CAD (.stl / .step) وتنفيذ المحاكاة لعرض النتائج'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 relative bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden h-[400px] flex items-center justify-center">
          <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

          {!hasResults && (
            <div className="pointer-events-none absolute top-4 left-4 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-400">
              Domain Ready · No Solved Field Data Yet
            </div>
          )}

          {hasInputs && (
            <div className="absolute top-4 right-4 bg-slate-900/95 backdrop-blur-md p-3 rounded-xl border border-slate-800 text-[11px] space-y-1.5 shadow-xl max-w-xs">
              <span className="font-bold text-sky-400 block">
                معاملات النطاق ({project.field}):
              </span>
              <div className="grid grid-cols-1 gap-1 pt-1">
                {project.boundaryConditions[0] && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPin({
                        title: `${project.boundaryConditions[0].name} (Input)`,
                        type: 'input',
                        value: `${project.boundaryConditions[0].value} ${project.boundaryConditions[0].unit}`,
                        equation: project.governingEquations[0]?.latex || defaultEq,
                        description: project.boundaryConditions[0].description || 'الشرط الحدودي المطبق على النموذج.',
                      })
                    }
                    className="text-right px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/20 flex items-center justify-between transition-colors"
                  >
                    <span className="truncate max-w-[150px]">1. {project.boundaryConditions[0].name}</span>
                    <span className="font-mono text-xs font-bold shrink-0">
                      {project.boundaryConditions[0].value} {project.boundaryConditions[0].unit}
                    </span>
                  </button>
                )}

                {project.contours[0] && (
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPin({
                        title: `${project.contours[0].name} (Output)`,
                        type: 'output',
                        value: `Max = ${project.contours[0].maxVal} ${project.contours[0].unit}`,
                        equation: project.governingEquations[1]?.latex || project.governingEquations[0]?.latex || defaultEq,
                        description: project.contours[0].physicalDescription || 'القيمة القصوى المستخرجة من نتائج المحلل.',
                      })
                    }
                    className="text-right px-2.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 flex items-center justify-between transition-colors"
                  >
                    <span className="truncate max-w-[150px]">2. {project.contours[0].name}</span>
                    <span className="font-mono text-xs font-bold shrink-0">
                      {project.contours[0].maxVal} {project.contours[0].unit}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="absolute bottom-3 left-3 bg-slate-900/80 px-3 py-1 rounded-lg border border-slate-800 text-[10px] text-slate-400 font-mono">
            {project.title} · {project.field} · SI Units
          </div>
        </div>

        <div className="bg-slate-950/80 rounded-2xl border border-slate-800 p-5 flex flex-col justify-between space-y-4">
          {selectedPin ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <span className="font-bold text-sm text-slate-100">{selectedPin.title}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 uppercase">
                  {selectedPin.type}
                </span>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-slate-400 block font-semibold">القيمة المدخلة / المرصودة:</span>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 font-mono font-bold text-sky-400 text-xs">
                  {selectedPin.value}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-xs text-slate-400 block font-semibold">المعادلة الحاكمة:</span>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs text-emerald-300 direction-ltr text-center overflow-x-auto">
                  {selectedPin.equation}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-xs text-slate-400 block font-semibold">الوصف الفيزيائي:</span>
                <p className="text-xs text-slate-300 leading-relaxed">{selectedPin.description}</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500 text-xs leading-relaxed">
              لا توجد معاملات محاكاة نشطة بعد. أدخل الشروط الحدية في اللوحة الجانبية واضغط على Run Simulation.
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-2 text-[11px] text-slate-400">
            <Info className="w-4 h-4 text-sky-400 shrink-0" />
            <span>تُعرض هنا فقط البيانات والنتائج المستخرجة فعلياً من جلسة المحاكاة.</span>
          </div>
        </div>
      </div>
    </div>
  );
};