import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import {
  Rotate3d,
  MousePointer2,
  Maximize2,
  Grid3X3,
  Wind,
  Activity,
  Upload,
  Crosshair,
  Info,
} from 'lucide-react';

export type ShadingMode = 'shaded' | 'contour' | 'wireframe';
export type ViewPreset = 'iso' | 'front' | 'top' | 'right';
export type ActiveField = 'CFD' | 'FEA' | 'Thermal';
export type Colormap = 'turbo' | 'jet' | 'viridis' | 'coolwarm';

export interface BoundaryMarker {
  id: string;
  type: 'Inlet' | 'Outlet' | 'Wall' | 'Load' | 'Fixed';
  point: [number, number, number];
  normal: [number, number, number];
}

export interface CadModelStats {
  name: string;
  triangles: number;
  vertices: number;
  dimensions: [number, number, number];
}

export interface Interactive3DViewportProps {
  field?: string;
  shadingMode?: ShadingMode;
  showMeshOverlay?: boolean;
  activePreset?: ViewPreset;
  hasSolvedResults?: boolean;
  fieldMin?: number;
  fieldMax?: number;
  fieldUnit?: string;
  fieldLabel?: string;
  onPresetChange?: (preset: ViewPreset) => void;
  onCadLoaded?: (stats: CadModelStats) => void;
  onBoundaryAdded?: (marker: BoundaryMarker) => void;
}

const CUBE_ROTATIONS: Record<ViewPreset, string> = {
  iso: 'rotateX(-28deg) rotateY(-38deg)',
  front: 'rotateX(0deg) rotateY(0deg)',
  top: 'rotateX(-90deg) rotateY(0deg)',
  right: 'rotateX(0deg) rotateY(-90deg)',
};

const CUBE_FACES: { label: string; preset: ViewPreset; transform: string }[] = [
  { label: 'FRONT', preset: 'front', transform: 'translateZ(24px)' },
  { label: 'BACK', preset: 'front', transform: 'rotateY(180deg) translateZ(24px)' },
  { label: 'RIGHT', preset: 'right', transform: 'rotateY(90deg) translateZ(24px)' },
  { label: 'LEFT', preset: 'right', transform: 'rotateY(-90deg) translateZ(24px)' },
  { label: 'TOP', preset: 'top', transform: 'rotateX(90deg) translateZ(24px)' },
  { label: 'BOTTOM', preset: 'top', transform: 'rotateX(-90deg) translateZ(24px)' },
];

export const Interactive3DViewport: React.FC<Interactive3DViewportProps> = ({
  field = 'CFD',
  showMeshOverlay: propShowMesh = false,
  activePreset: propPreset = 'iso',
  hasSolvedResults = false,
  fieldMin,
  fieldMax,
  fieldUnit = '',
  fieldLabel = '',
  onPresetChange,
  onCadLoaded,
  onBoundaryAdded,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const targetCamPos = useRef<THREE.Vector3 | null>(null);
  const customMeshRef = useRef<THREE.Mesh | null>(null);
  const markersGroupRef = useRef<THREE.Group | null>(null);

  const [showWireframe, setShowWireframe] = useState<boolean>(propShowMesh);
  const [preset, setPreset] = useState<ViewPreset>(propPreset);
  const [activeTool, setActiveTool] = useState<'orbit' | 'pan' | 'probe' | 'tag_inlet' | 'tag_outlet' | 'tag_wall'>('orbit');
  const [showStreamlines, setShowStreamlines] = useState<boolean>(false);
  const [cadStats, setCadStats] = useState<CadModelStats | null>(null);
  const [boundaryMarkers, setBoundaryMarkers] = useState<BoundaryMarker[]>([]);
  const [probeData, setProbeData] = useState<{
    x: number;
    y: number;
    z: number;
    val?: number;
    unit?: string;
    label: string;
    screenX: number;
    screenY: number;
  } | null>(null);

  const isFEA = field === 'FEA' || field?.toLowerCase().includes('structural');
  const isThermal = field === 'Thermal' || field?.toLowerCase().includes('thermal');
  const isCFD = !isFEA && !isThermal;

  const applyPreset = (targetPreset: ViewPreset) => {
    setPreset(targetPreset);
    if (onPresetChange) onPresetChange(targetPreset);
    if (!cameraRef.current || !controlsRef.current) return;

    const dist = 8.5;
    if (targetPreset === 'iso') {
      targetCamPos.current = new THREE.Vector3(dist * 0.65, dist * 0.55, dist * 0.7);
    } else if (targetPreset === 'front') {
      targetCamPos.current = new THREE.Vector3(0, 0, dist);
    } else if (targetPreset === 'top') {
      targetCamPos.current = new THREE.Vector3(0, dist, 0.001);
    } else if (targetPreset === 'right') {
      targetCamPos.current = new THREE.Vector3(dist, 0, 0);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const contents = event.target?.result;
      if (!contents) return;

      try {
        const loader = new STLLoader();
        const geometry = loader.parse(contents as ArrayBuffer);
        geometry.computeVertexNormals();
        geometry.center();

        geometry.computeBoundingBox();
        const bbox = geometry.boundingBox!;
        const sizeX = bbox.max.x - bbox.min.x;
        const sizeY = bbox.max.y - bbox.min.y;
        const sizeZ = bbox.max.z - bbox.min.z;
        const maxDim = Math.max(sizeX, sizeY, sizeZ);
        const scaleFactor = 5.0 / (maxDim || 1);
        geometry.scale(scaleFactor, scaleFactor, scaleFactor);

        const pos = geometry.attributes.position;
        const count = pos.count;

        // Clean Neutral CAD Surface Material (No fake pre-solved rainbow colors)
        const material = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.35,
          metalness: 0.45,
          wireframe: showWireframe,
        });

        if (customMeshRef.current && sceneRef.current) {
          sceneRef.current.remove(customMeshRef.current);
          customMeshRef.current.geometry.dispose();
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        customMeshRef.current = mesh;

        if (sceneRef.current) {
          sceneRef.current.add(mesh);
        }

        const stats: CadModelStats = {
          name: file.name,
          triangles: Math.round(count / 3),
          vertices: count,
          dimensions: [
            parseFloat(sizeX.toFixed(2)),
            parseFloat(sizeY.toFixed(2)),
            parseFloat(sizeZ.toFixed(2)),
          ],
        };
        setCadStats(stats);
        if (onCadLoaded) onCadLoaded(stats);

        applyPreset('iso');
      } catch (err) {
        console.error('Failed to parse STL file:', err);
      }
    };

    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || 800;
    const height = container.clientHeight || 500;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x0a0f1d);
    scene.fog = new THREE.FogExp2(0x0a0f1d, 0.018);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(6, 4.5, 6.5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: true,
    });
    rendererRef.current = renderer;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;

    container.replaceChildren(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xf8fafc, 2.2);
    keyLight.position.set(12, 18, 10);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
    rimLight.position.set(-10, -6, -10);
    scene.add(rimLight);

    const grid = new THREE.GridHelper(16, 32, 0x38bdf8, 0x1e293b);
    grid.position.y = -2.1;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.45;
    scene.add(grid);

    const markersGroup = new THREE.Group();
    markersGroupRef.current = markersGroup;
    scene.add(markersGroup);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 22;
    controls.minDistance = 2.5;
    controls.target.set(0, 0, 0);

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);

    if (customMeshRef.current) {
      (customMeshRef.current.material as THREE.MeshStandardMaterial).wireframe = showWireframe;
      scene.add(customMeshRef.current);
    }

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onPointerClick = (e: MouseEvent) => {
      if (!activeTool.startsWith('tag_')) return;
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const targetObjects = customMeshRef.current ? [customMeshRef.current] : modelRoot.children;
      const intersects = raycaster.intersectObjects(targetObjects, true);

      if (intersects.length > 0) {
        const hit = intersects[0];
        const pt = hit.point;
        const norm = hit.face?.normal || new THREE.Vector3(0, 1, 0);

        const typeMap: Record<string, 'Inlet' | 'Outlet' | 'Wall'> = {
          tag_inlet: 'Inlet',
          tag_outlet: 'Outlet',
          tag_wall: 'Wall',
        };
        const markerType = typeMap[activeTool] || 'Inlet';

        const colorMap = {
          Inlet: 0x38bdf8,
          Outlet: 0xf43f5e,
          Wall: 0xa855f7,
        };

        const arrow = new THREE.ArrowHelper(norm, pt, 1.0, colorMap[markerType], 0.3, 0.15);
        markersGroup.add(arrow);

        const newMarker: BoundaryMarker = {
          id: `bm_${Date.now()}`,
          type: markerType,
          point: [pt.x, pt.y, pt.z],
          normal: [norm.x, norm.y, norm.z],
        };
        setBoundaryMarkers((prev) => [...prev, newMarker]);
        if (onBoundaryAdded) {
          onBoundaryAdded(newMarker);
        }
      }
    };

    const onPointerMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      if (activeTool === 'probe') {
        raycaster.setFromCamera(mouse, camera);
        const targetObjects = customMeshRef.current ? [customMeshRef.current] : modelRoot.children;
        const intersects = raycaster.intersectObjects(targetObjects, true);
        if (intersects.length > 0) {
          const hit = intersects[0];
          const pt = hit.point;

          setProbeData({
            x: Number(pt.x.toFixed(3)),
            y: Number(pt.y.toFixed(3)),
            z: Number(pt.z.toFixed(3)),
            label: hasSolvedResults && fieldLabel ? fieldLabel : 'Surface Coordinate Probe',
            screenX: e.clientX - rect.left,
            screenY: e.clientY - rect.top,
          });
        } else {
          setProbeData(null);
        }
      }
    };

    container.addEventListener('click', onPointerClick);
    container.addEventListener('mousemove', onPointerMove);

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);

      if (targetCamPos.current) {
        camera.position.lerp(targetCamPos.current, 0.08);
        if (camera.position.distanceTo(targetCamPos.current) < 0.05) {
          targetCamPos.current = null;
        }
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries[0]) return;
      const { width: newW, height: newH } = entries[0].contentRect;
      if (newW > 0 && newH > 0 && cameraRef.current && rendererRef.current) {
        cameraRef.current.aspect = newW / newH;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(newW, newH);
      }
    });
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener('click', onPointerClick);
      container.removeEventListener('mousemove', onPointerMove);
      resizeObserver.disconnect();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      renderer.dispose();
      controls.dispose();
    };
  }, [field, isFEA, isThermal, isCFD, showWireframe, showStreamlines, activeTool, hasSolvedResults, fieldLabel]);

  const showLegend = hasSolvedResults && fieldMin !== undefined && fieldMax !== undefined;

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-[#070b16]">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".stl"
        className="hidden"
      />

      <div ref={containerRef} className="absolute inset-0 h-full w-full cursor-crosshair" />

      <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-slate-700/80 bg-slate-900/90 p-1 shadow-2xl backdrop-blur-md">
        <button
          title="Import CAD Geometry (.stl)"
          onClick={() => fileInputRef.current?.click()}
          className="flex h-7 items-center gap-1.5 px-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors shadow-sm"
        >
          <Upload className="h-3.5 w-3.5" />
          <span>Import CAD</span>
        </button>

        <span className="mx-1 h-4 w-px bg-slate-700/80" />

        <button
          title="Orbit Camera"
          onClick={() => setActiveTool('orbit')}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
            activeTool === 'orbit' ? 'bg-sky-500/25 text-sky-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Rotate3d className="h-3.5 w-3.5" />
        </button>

        <button
          title="Point Probe (Read exact coordinate on CAD surface)"
          onClick={() => setActiveTool(activeTool === 'probe' ? 'orbit' : 'probe')}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
            activeTool === 'probe' ? 'bg-amber-500/25 text-amber-300 ring-1 ring-amber-500/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
        </button>

        <span className="mx-1 h-4 w-px bg-slate-700/80" />

        <button
          title="Assign Inlet Boundary (Click on 3D Surface)"
          onClick={() => setActiveTool(activeTool === 'tag_inlet' ? 'orbit' : 'tag_inlet')}
          className={`flex h-7 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTool === 'tag_inlet' ? 'bg-sky-500 text-white shadow-sm' : 'text-sky-400 hover:bg-sky-500/20'
          }`}
        >
          <Crosshair className="h-3 w-3" />
          <span>+ Inlet</span>
        </button>

        <button
          title="Assign Outlet Boundary (Click on 3D Surface)"
          onClick={() => setActiveTool(activeTool === 'tag_outlet' ? 'orbit' : 'tag_outlet')}
          className={`flex h-7 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTool === 'tag_outlet' ? 'bg-rose-500 text-white shadow-sm' : 'text-rose-400 hover:bg-rose-500/20'
          }`}
        >
          <Crosshair className="h-3 w-3" />
          <span>+ Outlet</span>
        </button>

        <span className="mx-1 h-4 w-px bg-slate-700/80" />

        <button
          title="Toggle Mesh Wireframe"
          onClick={() => setShowWireframe(!showWireframe)}
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
            showWireframe ? 'bg-sky-500/25 text-sky-300 ring-1 ring-sky-500/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Grid3X3 className="h-3.5 w-3.5" />
        </button>

        {isCFD && hasSolvedResults && (
          <button
            title="Toggle Flow Streamlines"
            onClick={() => setShowStreamlines(!showStreamlines)}
            className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
              showStreamlines ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Wind className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          title="Reset Camera (Fit to Screen)"
          onClick={() => applyPreset('iso')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {cadStats && (
        <div className="pointer-events-none absolute left-4 bottom-8 z-20 flex flex-col gap-1 rounded-xl border border-slate-800/80 bg-slate-950/85 p-3 shadow-2xl backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs font-bold text-sky-300">
            <Info className="h-3.5 w-3.5 text-sky-400" />
            <span className="truncate max-w-[200px]">{cadStats.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px] text-slate-300 mt-1">
            <span>Triangles:</span>
            <strong className="text-white">{cadStats.triangles.toLocaleString()}</strong>
            <span>Vertices:</span>
            <strong className="text-white">{cadStats.vertices.toLocaleString()}</strong>
            <span>Box X:</span>
            <strong className="text-white">{cadStats.dimensions[0]} mm</strong>
            <span>Box Y:</span>
            <strong className="text-white">{cadStats.dimensions[1]} mm</strong>
          </div>
          {boundaryMarkers.length > 0 && (
            <div className="mt-1 pt-1 border-t border-slate-800 text-[10px] text-emerald-400 font-mono">
              Assigned Boundaries: {boundaryMarkers.length}
            </div>
          )}
        </div>
      )}

      <div className="absolute right-4 top-4 z-20 flex h-[76px] w-[76px] items-center justify-center" style={{ perspective: '300px' }}>
        <div
          className="relative h-12 w-12 transition-transform duration-500"
          style={{ transformStyle: 'preserve-3d', transform: CUBE_ROTATIONS[preset] }}
        >
          {CUBE_FACES.map((face) => (
            <button
              key={face.label}
              onClick={() => applyPreset(face.preset)}
              className="absolute inset-0 flex items-center justify-center border border-slate-600/70 bg-slate-900/90 text-[8px] font-bold tracking-wider text-slate-300 shadow-md backdrop-blur-sm transition-all hover:bg-sky-500/40 hover:text-white"
              style={{ transform: face.transform, backfaceVisibility: 'hidden' }}
            >
              {face.label}
            </button>
          ))}
        </div>
      </div>

      {/* Render Colormap Legend ONLY when real solved results exist */}
      {showLegend && (
        <div className="pointer-events-none absolute bottom-8 right-4 z-20 flex flex-col items-end gap-1.5 rounded-xl border border-slate-800/80 bg-slate-950/85 p-3 shadow-2xl backdrop-blur-md">
          <div className="text-[11px] font-semibold text-slate-200">
            {fieldLabel || (isFEA ? 'Von Mises Stress' : isThermal ? 'Static Temperature' : 'Velocity Magnitude')}
          </div>
          <div className="flex items-center gap-2">
            <div
              className="h-28 w-3 rounded-md border border-slate-700/80"
              style={{
                background: 'linear-gradient(to bottom, #d02020, #e87010, #d8d020, #20c040, #2080e0, #1020a0)',
              }}
            />
            <div className="flex h-28 flex-col justify-between font-mono text-[9.5px] text-slate-400">
              <span>{fieldMax} {fieldUnit} (Max)</span>
              <span>{(fieldMin + (fieldMax - fieldMin) * 0.75).toFixed(2)} {fieldUnit}</span>
              <span>{(fieldMin + (fieldMax - fieldMin) * 0.5).toFixed(2)} {fieldUnit}</span>
              <span>{(fieldMin + (fieldMax - fieldMin) * 0.25).toFixed(2)} {fieldUnit}</span>
              <span>{fieldMin} {fieldUnit} (Min)</span>
            </div>
          </div>
          <div className="font-mono text-[9px] text-slate-500">Colormap: Turbo (ASME V&V 20)</div>
        </div>
      )}

      {probeData && (
        <div
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full rounded-lg border border-amber-500/50 bg-slate-900/95 px-3 py-2 text-xs shadow-2xl backdrop-blur-md"
          style={{ left: probeData.screenX, top: probeData.screenY - 12 }}
        >
          <div className="flex items-center gap-1.5 font-bold text-amber-300">
            <Activity className="h-3.5 w-3.5 text-amber-400" />
            <span>{probeData.label}</span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-slate-200">
            X: {probeData.x} m · Y: {probeData.y} m · Z: {probeData.z} m
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-6 items-center justify-between border-t border-slate-800/80 bg-slate-950/75 px-3 font-mono text-[10px] text-slate-400 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <span className="text-emerald-400">● WebGL 3D Engine: Active</span>
          <span>·</span>
          <span>Field: <strong className="text-slate-200">{field}</strong></span>
          <span>·</span>
          <span>View: {showWireframe ? 'Wireframe' : 'Solid CAD'}</span>
          {activeTool.startsWith('tag_') && (
            <span className="text-amber-300 font-bold animate-pulse">
              [Click on 3D surface to assign {activeTool.replace('tag_', '').toUpperCase()}]
            </span>
          )}
        </div>
        <div>Coordinates: Cartesian (X, Y, Z) · Units: SI (m, s, kg, K)</div>
      </div>
    </div>
  );
};