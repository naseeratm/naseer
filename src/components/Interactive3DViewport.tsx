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
  Flame,
  BoxSelect,
  Trash2,
  Shield,
  Copy,
  Check,
} from 'lucide-react';

export type ShadingMode = 'shaded' | 'contour' | 'wireframe';
export type ViewPreset = 'iso' | 'front' | 'top' | 'right';
export type ActiveField = 'CFD' | 'FEA' | 'Thermal';
export type Colormap = 'turbo' | 'jet' | 'viridis' | 'coolwarm';

export type BoundaryType = 'Inlet' | 'Outlet' | 'Wall' | 'HeatSource' | 'Load' | 'Fixed';

export interface BoundaryMarker {
  id: string;
  type: BoundaryType;
  label?: string;
  value?: number;
  unit?: string;
  secondaryValue?: number;
  secondaryUnit?: string;
  point: [number, number, number];
  normal: [number, number, number];
}

export interface CadModelStats {
  name: string;
  triangles: number;
  vertices: number;
  dimensions: [number, number, number];
}

export interface RegionBoxState {
  enabled: boolean;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
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
  onRegionChange?: (bounds: { min: [number, number, number]; max: [number, number, number] } | null) => void;
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

type ActiveToolType =
  | 'orbit'
  | 'probe'
  | 'tag_inlet'
  | 'tag_outlet'
  | 'tag_heat'
  | 'tag_wall';

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
  onRegionChange,
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
  const markerObjectsMap = useRef>(new Map());
  const regionBoxGroupRef = useRef<THREE.Group | null>(null);

  const [showWireframe, setShowWireframe] = useState<boolean>(propShowMesh);
  const [preset, setPreset] = useState<ViewPreset>(propPreset);
  const [activeTool, setActiveTool] = useState<ActiveToolType>('orbit');
  const [showStreamlines, setShowStreamlines] = useState<boolean>(false);
  const [cadStats, setCadStats] = useState<CadModelStats | null>(null);
  const [boundaryMarkers, setBoundaryMarkers] = useState<BoundaryMarker[]>([]);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  const [copiedTopoSet, setCopiedTopoSet] = useState<boolean>(false);

  const [regionBox, setRegionBox] = useState<RegionBoxState>({
    enabled: false,
    xMin: -0.5,
    xMax: 0.5,
    yMin: -1.0,
    yMax: 0.2,
    zMin: -0.8,
    zMax: 0.8,
  });

  const [probeData, setProbeData] = useState<{
    x: number;
    y: number;
    z: number;
    label: string;
    screenX: number;
    screenY: number;
  } | null>(null);

  const isFEA = field === 'FEA' || field?.toLowerCase().includes('structural');
  const isThermal = field === 'Thermal' || field?.toLowerCase().includes('thermal');
  const isCFD = !isFEA && !isThermal;

  // Keep refs synced so event listeners always read latest state without rebuilding WebGL scene
  const activeToolRef = useRef<ActiveToolType>(activeTool);
  activeToolRef.current = activeTool;

  const isFEARef = useRef<boolean>(isFEA);
  isFEARef.current = isFEA;

  const hasSolvedRef = useRef<boolean>(hasSolvedResults);
  hasSolvedRef.current = hasSolvedResults;

  const fieldLabelRef = useRef<string>(fieldLabel);
  fieldLabelRef.current = fieldLabel;

  const onBoundaryAddedRef = useRef(onBoundaryAdded);
  onBoundaryAddedRef.current = onBoundaryAdded;

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

        const material = new THREE.MeshStandardMaterial({
          color: 0x94a3b8,
          roughness: 0.35,
          metalness: 0.45,
          wireframe: showWireframe,
          side: THREE.DoubleSide,
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
            parseFloat(sizeX.toFixed(4)),
            parseFloat(sizeY.toFixed(4)),
            parseFloat(sizeZ.toFixed(4)),
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

  // Initialize Three.js WebGL Scene ONCE
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

    const regionBoxGroup = new THREE.Group();
    regionBoxGroupRef.current = regionBoxGroup;
    scene.add(regionBoxGroup);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxDistance = 22;
    controls.minDistance = 1.5;
    controls.target.set(0, 0, 0);

    if (customMeshRef.current) {
      scene.add(customMeshRef.current);
    }

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onPointerClick = (e: MouseEvent) => {
      const currentTool = activeToolRef.current;
      if (!currentTool.startsWith('tag_')) return;

      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const targetObjects = customMeshRef.current ? [customMeshRef.current] : [];
      const intersects = raycaster.intersectObjects(targetObjects, true);

      if (intersects.length > 0) {
        const hit = intersects[0];
        const pt = hit.point;
        const norm = hit.face?.normal ? hit.face.normal.clone().normalize() : new THREE.Vector3(0, 1, 0);

        let markerType: BoundaryType = 'Inlet';
        let defaultVal = 1.0;
        let defaultUnit = 'm/s';
        let secVal: number | undefined = 293.15;
        let secUnit: string | undefined = 'K';
        let colorHex = 0x38bdf8;
        let label = 'Velocity Inlet';

        if (currentTool === 'tag_outlet') {
          markerType = 'Outlet';
          defaultVal = 0;
          defaultUnit = 'Pa';
          secVal = undefined;
          secUnit = undefined;
          colorHex = 0xf43f5e;
          label = 'Pressure Outlet';
        } else if (currentTool === 'tag_heat') {
          if (isFEARef.current) {
            markerType = 'Load';
            defaultVal = 1000;
            defaultUnit = 'N';
            secVal = undefined;
            secUnit = undefined;
            colorHex = 0xf59e0b;
            label = 'Force Load';
          } else {
            markerType = 'HeatSource';
            defaultVal = 5000;
            defaultUnit = 'W/m²';
            secVal = undefined;
            secUnit = undefined;
            colorHex = 0xf59e0b;
            label = 'Heated Wall / Load';
          }
        } else if (currentTool === 'tag_wall') {
          markerType = isFEARef.current ? 'Fixed' : 'Wall';
          defaultVal = 0;
          defaultUnit = isFEARef.current ? 'mm' : 'W/m²';
          secVal = undefined;
          secUnit = undefined;
          colorHex = 0xa855f7;
          label = isFEARef.current ? 'Fixed Support' : 'Adiabatic Wall';
        }

        const arrow = new THREE.ArrowHelper(norm, pt, 0.9, colorHex, 0.28, 0.14);
        markersGroup.add(arrow);

        const newId = `bm_${Date.now()}`;
        markerObjectsMap.current.set(newId, arrow);

        const newMarker: BoundaryMarker = {
          id: newId,
          type: markerType,
          label,
          value: defaultVal,
          unit: defaultUnit,
          secondaryValue: secVal,
          secondaryUnit: secUnit,
          point: [Number(pt.x.toFixed(3)), Number(pt.y.toFixed(3)), Number(pt.z.toFixed(3))],
          normal: [Number(norm.x.toFixed(2)), Number(norm.y.toFixed(2)), Number(norm.z.toFixed(2))],
        };

        setBoundaryMarkers((prev) => [...prev, newMarker]);
        setEditingMarkerId(newId);
        if (onBoundaryAddedRef.current) {
          onBoundaryAddedRef.current(newMarker);
        }
      }
    };

    const onPointerMove = (e: MouseEvent) => {
      if (activeToolRef.current !== 'probe') {
        setProbeData(null);
        return;
      }

      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const targetObjects = customMeshRef.current ? [customMeshRef.current] : [];
      const intersects = raycaster.intersectObjects(targetObjects, true);
      if (intersects.length > 0) {
        const hit = intersects[0];
        const pt = hit.point;

        setProbeData({
          x: Number(pt.x.toFixed(3)),
          y: Number(pt.y.toFixed(3)),
          z: Number(pt.z.toFixed(3)),
          label: hasSolvedRef.current && fieldLabelRef.current ? fieldLabelRef.current : 'Surface Coordinate Probe',
          screenX: e.clientX - rect.left,
          screenY: e.clientY - rect.top,
        });
      } else {
        setProbeData(null);
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
  }, []);

  // Sync wireframe toggle without resetting camera
  useEffect(() => {
    if (customMeshRef.current) {
      (customMeshRef.current.material as THREE.MeshStandardMaterial).wireframe = showWireframe;
    }
  }, [showWireframe]);

  // Render interactive 3D Sub-Domain Selection Box (Region Box)
  useEffect(() => {
    const group = regionBoxGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0];
      group.remove(child);
    }

    if (!regionBox.enabled) {
      if (onRegionChange) onRegionChange(null);
      return;
    }

    const halfSpan = 2.5;
    const minX = regionBox.xMin * halfSpan;
    const maxX = regionBox.xMax * halfSpan;
    const minY = regionBox.yMin * halfSpan;
    const maxY = regionBox.yMax * halfSpan;
    const minZ = regionBox.zMin * halfSpan;
    const maxZ = regionBox.zMax * halfSpan;

    const sizeX = Math.max(0.05, maxX - minX);
    const sizeY = Math.max(0.05, maxY - minY);
    const sizeZ = Math.max(0.05, maxZ - minZ);

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;

    const boxGeo = new THREE.BoxGeometry(sizeX, sizeY, sizeZ);
    const boxMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    });
    const boxMesh = new THREE.Mesh(boxGeo, boxMat);
    boxMesh.position.set(cx, cy, cz);

    const edges = new THREE.EdgesGeometry(boxGeo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x22d3ee });
    const wire = new THREE.LineSegments(edges, lineMat);
    wire.position.set(cx, cy, cz);

    group.add(boxMesh);
    group.add(wire);

    if (onRegionChange) {
      const dims = cadStats ? cadStats.dimensions : [1, 1, 1];
      onRegionChange({
        min: [
          Number(((regionBox.xMin * dims[0]) / 2).toFixed(4)),
          Number(((regionBox.yMin * dims[1]) / 2).toFixed(4)),
          Number(((regionBox.zMin * dims[2]) / 2).toFixed(4)),
        ],
        max: [
          Number(((regionBox.xMax * dims[0]) / 2).toFixed(4)),
          Number(((regionBox.yMax * dims[1]) / 2).toFixed(4)),
          Number(((regionBox.zMax * dims[2]) / 2).toFixed(4)),
        ],
      });
    }
  }, [regionBox, cadStats, onRegionChange]);

  const removeBoundaryMarker = (id: string) => {
    const obj = markerObjectsMap.current.get(id);
    if (obj && markersGroupRef.current) {
      markersGroupRef.current.remove(obj);
      markerObjectsMap.current.delete(id);
    }
    setBoundaryMarkers((prev) => prev.filter((m) => m.id !== id));
    if (editingMarkerId === id) setEditingMarkerId(null);
  };

  const updateMarkerValue = (id: string, fieldKey: 'value' | 'secondaryValue', val: number) => {
    setBoundaryMarkers((prev) =>
      prev.map((m) => (m.id === id ? { ...m, [fieldKey]: val } : m))
    );
  };

  const getPhysicalRegionBounds = () => {
    const dims = cadStats ? cadStats.dimensions : [1.0, 1.0, 1.0];
    return {
      xMin: ((regionBox.xMin * dims[0]) / 2).toFixed(4),
      xMax: ((regionBox.xMax * dims[0]) / 2).toFixed(4),
      yMin: ((regionBox.yMin * dims[1]) / 2).toFixed(4),
      yMax: ((regionBox.yMax * dims[1]) / 2).toFixed(4),
      zMin: ((regionBox.zMin * dims[2]) / 2).toFixed(4),
      zMax: ((regionBox.zMax * dims[2]) / 2).toFixed(4),
    };
  };

  const copyTopoSetSnippet = () => {
    const b = getPhysicalRegionBounds();
    const snippet = `boxToCell { box (${b.xMin} ${b.yMin} ${b.zMin}) (${b.xMax} ${b.yMax} ${b.zMax}); }`;
    navigator.clipboard.writeText(snippet);
    setCopiedTopoSet(true);
    setTimeout(() => setCopiedTopoSet(false), 2000);
  };

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

      {/* Top Engineering CAD & Boundary Toolbar */}
      <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-slate-700/80 bg-slate-900/95 p-1 shadow-2xl backdrop-blur-md max-w-[96%] overflow-x-auto">
        <button
          title="Import CAD Geometry (.stl)"
          onClick={() => fileInputRef.current?.click()}
          className="flex h-7 shrink-0 items-center gap-1.5 px-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors shadow-sm"
        >
          <Upload className="h-3.5 w-3.5" />
          <span>Import CAD</span>
        </button>

        <span className="mx-1 h-4 w-px shrink-0 bg-slate-700/80" />

        <button
          title="Orbit Camera"
          onClick={() => setActiveTool('orbit')}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
            activeTool === 'orbit' ? 'bg-sky-500/25 text-sky-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Rotate3d className="h-3.5 w-3.5" />
        </button>

        <button
          title="Point Probe (Read exact coordinate on CAD surface)"
          onClick={() => setActiveTool(activeTool === 'probe' ? 'orbit' : 'probe')}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
            activeTool === 'probe' ? 'bg-amber-500/25 text-amber-300 ring-1 ring-amber-500/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
        </button>

        <span className="mx-1 h-4 w-px shrink-0 bg-slate-700/80" />

        {/* Surface Boundary Tagging Buttons */}
        <button
          title="Assign Inlet Boundary (Click on Inlet Surface)"
          onClick={() => setActiveTool(activeTool === 'tag_inlet' ? 'orbit' : 'tag_inlet')}
          className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTool === 'tag_inlet' ? 'bg-sky-500 text-white shadow-sm' : 'text-sky-400 hover:bg-sky-500/20'
          }`}
        >
          <Crosshair className="h-3 w-3" />
          <span>+ Inlet</span>
        </button>

        <button
          title="Assign Outlet Boundary (Click on Outlet Surface)"
          onClick={() => setActiveTool(activeTool === 'tag_outlet' ? 'orbit' : 'tag_outlet')}
          className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTool === 'tag_outlet' ? 'bg-rose-500 text-white shadow-sm' : 'text-rose-400 hover:bg-rose-500/20'
          }`}
        >
          <Crosshair className="h-3 w-3" />
          <span>+ Outlet</span>
        </button>

        <button
          title={isFEA ? 'Assign Structural Force Load (Click on Surface)' : 'Assign Heated Wall / Thermal Load (e.g. Corrugated Section)'}
          onClick={() => setActiveTool(activeTool === 'tag_heat' ? 'orbit' : 'tag_heat')}
          className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTool === 'tag_heat' ? 'bg-amber-500 text-slate-950 shadow-sm' : 'text-amber-400 hover:bg-amber-500/20'
          }`}
        >
          <Flame className="h-3 w-3" />
          <span>{isFEA ? '+ Load' : '+ Heat'}</span>
        </button>

        <button
          title={isFEA ? 'Assign Fixed Support' : 'Assign Adiabatic / Insulated Wall'}
          onClick={() => setActiveTool(activeTool === 'tag_wall' ? 'orbit' : 'tag_wall')}
          className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTool === 'tag_wall' ? 'bg-purple-500 text-white shadow-sm' : 'text-purple-400 hover:bg-purple-500/20'
          }`}
        >
          <Shield className="h-3 w-3" />
          <span>{isFEA ? '+ Fixed' : '+ Wall'}</span>
        </button>

        <span className="mx-1 h-4 w-px shrink-0 bg-slate-700/80" />

        {/* Sub-Domain Region Box Isolator */}
        <button
          title="Isolate Sub-Domain / Critical Region (e.g., Corrugated Zone)"
          onClick={() => setRegionBox((prev) => ({ ...prev, enabled: !prev.enabled }))}
          className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            regionBox.enabled ? 'bg-cyan-500/25 text-cyan-300 ring-1 ring-cyan-500/60' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <BoxSelect className="h-3.5 w-3.5 text-cyan-400" />
          <span>Region Box</span>
        </button>

        <button
          title="Toggle Mesh Wireframe"
          onClick={() => setShowWireframe(!showWireframe)}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
            showWireframe ? 'bg-sky-500/25 text-sky-300 ring-1 ring-sky-500/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Grid3X3 className="h-3.5 w-3.5" />
        </button>

        {isCFD && hasSolvedResults && (
          <button
            title="Toggle Flow Streamlines"
            onClick={() => setShowStreamlines(!showStreamlines)}
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
              showStreamlines ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            <Wind className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          title="Reset Camera (Fit to Screen)"
          onClick={() => applyPreset('iso')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Sub-Domain Region Box Controller (Left Top Overlay when enabled) */}
      {regionBox.enabled && (
        <div className="absolute left-4 top-14 z-20 w-64 rounded-xl border border-cyan-500/40 bg-slate-950/90 p-3 shadow-2xl backdrop-blur-md text-xs">
          <div className="flex items-center justify-between mb-2">
            <span className="font-bold text-cyan-300 flex items-center gap-1.5">
              <BoxSelect className="h-3.5 w-3.5" />
              Sub-Domain Region Box
            </span>
            <button
              onClick={copyTopoSetSnippet}
              title="Copy OpenFOAM boxToCell coordinates"
              className="flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-950 hover:bg-cyan-900 text-cyan-300 border border-cyan-700/60 text-[10px] font-mono"
            >
              {copiedTopoSet ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              <span>{copiedTopoSet ? 'Copied' : 'boxToCell'}</span>
            </button>
          </div>
          <p className="text-[10px] text-slate-400 mb-2">
            Isolate a specific zone (e.g. corrugated section) for local heat load or mesh refinement:
          </p>
          <div className="space-y-1.5 font-mono text-[10px]">
            {(['X', 'Y', 'Z'] as const).map((axis) => {
              const minKey = `${axis.toLowerCase()}Min` as keyof RegionBoxState;
              const maxKey = `${axis.toLowerCase()}Max` as keyof RegionBoxState;
              return (
                <div key={axis} className="grid grid-cols-[20px_1fr_1fr] items-center gap-1.5">
                  <span className="text-slate-400 font-bold">{axis}:</span>
                  <input
                    type="range"
                    min={-1}
                    max={0.9}
                    step={0.05}
                    value={regionBox[minKey] as number}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setRegionBox((prev) => ({
                        ...prev,
                        [minKey]: Math.min(v, (prev[maxKey] as number) - 0.1),
                      }));
                    }}
                    className="accent-cyan-400 h-1 bg-slate-800 rounded cursor-pointer"
                  />
                  <input
                    type="range"
                    min={-0.9}
                    max={1}
                    step={0.05}
                    value={regionBox[maxKey] as number}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      setRegionBox((prev) => ({
                        ...prev,
                        [maxKey]: Math.max(v, (prev[minKey] as number) + 0.1),
                      }));
                    }}
                    className="accent-cyan-400 h-1 bg-slate-800 rounded cursor-pointer"
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 pt-1.5 border-t border-slate-800 font-mono text-[9.5px] text-slate-300">
            <div>Min: ({getPhysicalRegionBounds().xMin}, {getPhysicalRegionBounds().yMin}, {getPhysicalRegionBounds().zMin})</div>
            <div>Max: ({getPhysicalRegionBounds().xMax}, {getPhysicalRegionBounds().yMax}, {getPhysicalRegionBounds().zMax})</div>
          </div>
        </div>
      )}

      {/* Assigned Boundary Conditions Interactive Card (Bottom Left) */}
      {(cadStats || boundaryMarkers.length > 0) && (
        <div className="absolute left-4 bottom-8 z-20 flex flex-col gap-2 rounded-xl border border-slate-800/90 bg-slate-950/90 p-3 shadow-2xl backdrop-blur-md max-w-xs">
          {cadStats && (
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-sky-300">
                <Info className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span className="truncate">{cadStats.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-slate-300 mt-1">
                <span>Triangles:</span>
                <strong className="text-white">{cadStats.triangles.toLocaleString()}</strong>
                <span>Dimensions:</span>
                <strong className="text-white">
                  {cadStats.dimensions[0]}×{cadStats.dimensions[1]}×{cadStats.dimensions[2]}
                </strong>
              </div>
            </div>
          )}

          {boundaryMarkers.length > 0 && (
            <div className="pt-1.5 border-t border-slate-800 space-y-1.5 max-h-44 overflow-y-auto">
              <div className="text-[10px] font-bold text-emerald-400 font-mono">
                Solver Patches ({boundaryMarkers.length}):
              </div>
              {boundaryMarkers.map((m) => (
                <div
                  key={m.id}
                  onClick={() => setEditingMarkerId(m.id)}
                  className={`p-1.5 rounded-lg border text-[10px] font-mono cursor-pointer transition-colors ${
                    editingMarkerId === m.id
                      ? 'bg-slate-900 border-sky-500/70'
                      : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-200">
                      {m.type}: {m.label}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeBoundaryMarker(m.id);
                      }}
                      className="text-slate-500 hover:text-rose-400"
                      title="Remove Boundary"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  {editingMarkerId === m.id ? (
                    <div className="mt-1.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="number"
                        step="any"
                        value={m.value ?? 0}
                        onChange={(e) => updateMarkerValue(m.id, 'value', parseFloat(e.target.value) || 0)}
                        className="w-16 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-white text-[10px]"
                      />
                      <span className="text-slate-400">{m.unit}</span>
                      {m.secondaryUnit && (
                        <>
                          <input
                            type="number"
                            step="any"
                            value={m.secondaryValue ?? 293.15}
                            onChange={(e) =>
                              updateMarkerValue(m.id, 'secondaryValue', parseFloat(e.target.value) || 0)
                            }
                            className="w-16 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-700 text-white text-[10px]"
                          />
                          <span className="text-slate-400">{m.secondaryUnit}</span>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="text-slate-400 mt-0.5">
                      {m.value} {m.unit}
                      {m.secondaryUnit ? ` · ${m.secondaryValue} ${m.secondaryUnit}` : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3D View Cube */}
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

      {/* Status Bar */}
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