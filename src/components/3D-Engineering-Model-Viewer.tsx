import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Box, Grid3X3, Info, Palette } from 'lucide-react';
import { ThesisProject } from '../types/thesis';
import { ColormapType, getColorFromColormap } from '../utils/physicsEngine';

interface EngineeringModelViewer3DProps {
  project: ThesisProject;
}

export const EngineeringModelViewer3D: React.FC<EngineeringModelViewer3DProps> = ({ project }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isFEA = project.field === 'FEA';
  const isThermal = project.field === 'Thermal';

  const [showWireframe, setShowWireframe] = useState<boolean>(true);
  const [colormap, setColormap] = useState<ColormapType>('jet');

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

  const vtkData = project.normalizedSolverResult?.vtkData;
  const hasVtkGeometry = Boolean(vtkData && Array.isArray(vtkData.points) && vtkData.points.length >= 9);
  const activeFieldKey =
    vtkData?.active_field ||
    (vtkData?.scalars ? Object.keys(vtkData.scalars)[0] : undefined);
  const activeFieldUnit =
    (activeFieldKey && vtkData?.units?.[activeFieldKey]) || 'SI';
  const nodeCount = vtkData?.node_count ?? (vtkData?.points ? Math.floor(vtkData.points.length / 3) : 0);
  const triCount = vtkData?.triangle_count ?? (vtkData?.triangles ? Math.floor(vtkData.triangles.length / 3) : 0);

  useEffect(() => {
    if (project.contours[0]) {
      setSelectedPin({
        title: `${project.contours[0].name} (Solved Field)`,
        type: 'output',
        value: `Min = ${project.contours[0].minVal} · Max = ${project.contours[0].maxVal} ${project.contours[0].unit}`,
        equation: project.governingEquations[0]?.latex || defaultEq,
        description: project.contours[0].physicalDescription || 'توزيع الحقل الفيزيائي المستخرج من المحلل.',
      });
    } else if (project.boundaryConditions[0]) {
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
  }, [project.id, project.boundaryConditions.length, project.contours.length, defaultEq]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || 700;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 2000);
    camera.position.set(6, 4.5, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    container.replaceChildren(renderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xf8fafc, 0x1e293b, 0.9);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xe2e8f0, 1.35);
    dirLight.position.set(8, 12, 8);
    scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0x38bdf8, 0.5);
    backLight.position.set(-8, -6, -8);
    scene.add(backLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 500;
    controls.minDistance = 0.05;

    const gridHelper = new THREE.GridHelper(10, 20, 0x1e293b, 0x0f172a);
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(1.5);
    scene.add(axesHelper);

    const disposables: { dispose: () => void }[] = [];

    if (vtkData && Array.isArray(vtkData.points) && vtkData.points.length >= 9) {
      const flatPts = vtkData.points;
      const flatTris = Array.isArray(vtkData.triangles) ? vtkData.triangles : [];
      const numVerts = Math.floor(flatPts.length / 3);

      const geometry = new THREE.BufferGeometry();
      const posArr = new Float32Array(numVerts * 3);
      for (let i = 0; i < numVerts * 3; i++) {
        posArr[i] = Number(flatPts[i]) || 0;
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));

      if (flatTris.length >= 3) {
        const indexArr = new Uint32Array(flatTris.length);
        for (let i = 0; i < flatTris.length; i++) {
          indexArr[i] = Number(flatTris[i]) || 0;
        }
        geometry.setIndex(new THREE.BufferAttribute(indexArr, 1));
      }

      const scalarSeries =
        (activeFieldKey && vtkData.scalars?.[activeFieldKey]) ||
        (vtkData.scalars ? Object.values(vtkData.scalars)[0] : undefined);

      const colorArr = new Float32Array(numVerts * 3);
      if (Array.isArray(scalarSeries) && scalarSeries.length > 0) {
        let minS = Infinity;
        let maxS = -Infinity;
        for (let i = 0; i < scalarSeries.length; i++) {
          const v = Number(scalarSeries[i]) || 0;
          if (v < minS) minS = v;
          if (v > maxS) maxS = v;
        }
        const span = maxS - minS > 1e-12 ? maxS - minS : 1;
        for (let i = 0; i < numVerts; i++) {
          const val = Number(scalarSeries[i % scalarSeries.length]) || 0;
          const norm = (val - minS) / span;
          const [r, g, b] = getColorFromColormap(norm, colormap);
          colorArr[i * 3] = r / 255;
          colorArr[i * 3 + 1] = g / 255;
          colorArr[i * 3 + 2] = b / 255;
        }
      } else {
        for (let i = 0; i < numVerts; i++) {
          colorArr[i * 3] = 0.22;
          colorArr[i * 3 + 1] = 0.74;
          colorArr[i * 3 + 2] = 0.97;
        }
      }
      geometry.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();

      const meshMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.35,
        metalness: 0.1,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const surfaceMesh = new THREE.Mesh(geometry, meshMaterial);
      scene.add(surfaceMesh);
      disposables.push(geometry, meshMaterial);

      if (showWireframe) {
        const wireMat = new THREE.MeshBasicMaterial({
          color: 0x0f172a,
          wireframe: true,
          transparent: true,
          opacity: 0.35,
        });
        const wireMesh = new THREE.Mesh(geometry, wireMat);
        scene.add(wireMesh);
        disposables.push(wireMat);
      }

      if (geometry.boundingSphere) {
        const center = geometry.boundingSphere.center;
        const radius = Math.max(geometry.boundingSphere.radius, 0.25);
        controls.target.copy(center);
        camera.position.set(center.x + radius * 1.9, center.y + radius * 1.4, center.z + radius * 2.1);
        camera.near = Math.max(0.001, radius * 0.01);
        camera.far = Math.max(1000, radius * 40);
        camera.updateProjectionMatrix();
        gridHelper.position.set(center.x, center.y - radius * 0.65, center.z);
        axesHelper.position.copy(center);
      }
    }

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
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, [project.id, vtkData, activeFieldKey, showWireframe, colormap]);

  const hasInputs = project.boundaryConditions.length > 0;
  const hasResults = project.contours.length > 0 || hasVtkGeometry;

  return (
    <div className="bg-slate-900/90 rounded-2xl border border-slate-800 p-6 shadow-xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <Box className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <span>عارض النطاق الهندسي والنتائج ثلاثية الأبعاد (3D VTK CAE Viewport)</span>
              <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-sky-300 font-mono">
                {project.field}
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {hasVtkGeometry
                ? `عرض مباشر لشبكة وحقول VTK المستخرجة من المحرك (${nodeCount.toLocaleString()} عقدة · ${triCount.toLocaleString()} عنصر سطحي)`
                : 'بانتظار توليد الشبكة عبر Gmsh أو تنفيذ المحاكاة لعرض المجسم والحقول ثلاثية الأبعاد'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setShowWireframe((prev) => !prev)}
            className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 border transition-colors ${
              showWireframe
                ? 'bg-sky-600/20 text-sky-300 border-sky-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-slate-200'
            }`}
          >
            <Grid3X3 className="w-3.5 h-3.5" />
            <span>Wireframe</span>
          </button>

          <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1">
            <Palette className="w-3.5 h-3.5 text-amber-400" />
            <select
              value={colormap}
              onChange={(e) => setColormap(e.target.value as ColormapType)}
              className="bg-transparent text-slate-200 font-mono text-xs focus:outline-none"
            >
              <option value="jet">Jet</option>
              <option value="turbo">Turbo</option>
              <option value="viridis">Viridis</option>
              <option value="coolwarm">CoolWarm</option>
            </select>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 relative bg-slate-950 rounded-2xl border border-slate-800 overflow-hidden h-[400px] flex items-center justify-center">
          <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

          {!hasResults && (
            <div className="pointer-events-none absolute top-4 left-4 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800 text-[11px] font-mono text-slate-400">
              Domain Ready · Run Solver or Generate Mesh to Render VTK 3D Field
            </div>
          )}

          {hasVtkGeometry && (
            <div className="pointer-events-none absolute top-4 left-4 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-emerald-500/30 text-[11px] font-mono text-emerald-300">
              VTK 3D Active · {activeFieldKey || project.field} ({activeFieldUnit})
            </div>
          )}

          {(hasInputs || project.contours.length > 0) && (
            <div className="absolute top-4 right-4 bg-slate-900/95 p-3 rounded-xl border border-slate-800 text-[11px] space-y-1.5 shadow-xl max-w-xs">
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

          <div className="absolute bottom-3 left-3 bg-slate-900/90 px-3 py-1 rounded-lg border border-slate-800 text-[10px] text-slate-400 font-mono">
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
            <span>تُعرض هنا شبكة وحقول VTK الحقيقية المستخرجة من جلسة المحاكاة.</span>
          </div>
        </div>
      </div>
    </div>
  );
};