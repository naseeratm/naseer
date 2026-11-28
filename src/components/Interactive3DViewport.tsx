import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
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
  Scissors,
  SlidersHorizontal,
  Sigma,
  Loader2,
  Play,
  Pause,
  RotateCcw,
  LineChart,
  Camera,
  Ruler,
  X,
  AlertTriangle,
  Layers,
} from 'lucide-react';
import { MeshQualityReport, VtkFieldPayload } from '../types/thesis';
import { ColormapType, getColorFromColormap } from '../utils/physicsEngine';
import {
  computeVtkSurfaceGradientMagnitude,
  exportWebGLSnapshotPng,
} from '../utils/postProcessingMaps';
import {
  computeMeasurementMetrics,
  computeVtkPhysicalBounds,
  formatLengthSI,
  PhysicalPoint3D,
} from '../utils/geometryMeasure';
import {
  DecodedNSR1Payload,
  VolumetricPostMetadata,
  fetchBinaryPostPayload,
  fetchVolumetricPostMetadata,
} from '../utils/binaryMeshDecoder';

export type ShadingMode = 'shaded' | 'contour' | 'wireframe';
export type ViewPreset = 'iso' | 'front' | 'top' | 'right';
export type ActiveField = 'CFD' | 'FEA' | 'Thermal';
export type Colormap = 'turbo' | 'jet' | 'viridis' | 'coolwarm';

export type BoundaryType = 'Inlet' | 'Outlet' | 'Wall' | 'HeatSource' | 'Load' | 'Fixed';

export interface BoundaryMarker {
  id: string;
  type: BoundaryType;
  label?: string;
  patchName?: string;
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
  solvedTaskId?: string | null;
  meshQuality?: MeshQualityReport | null;
  vtkData?: VtkFieldPayload | null;
  meshPreviewVtk?: VtkFieldPayload | null;
  integrals?: Record<string, number | string> | null;
  cadLoading?: boolean;
  selectedMarkerId?: string | null;
  highlightedPatchName?: string | null;
  fieldMin?: number;
  fieldMax?: number;
  fieldUnit?: string;
  fieldLabel?: string;
  onPresetChange?: (preset: ViewPreset) => void;
  onCadLoaded?: (stats: CadModelStats) => void;
  onCadStlUploaded?: (file: { name: string; base64: string; stats: CadModelStats }) => void;
  onCadFileUploaded?: (file: { name: string; base64: string; ext: string; stats?: CadModelStats }) => void;
  onBoundaryAdded?: (marker: BoundaryMarker) => void;
  onBoundaryMarkersChange?: (markers: BoundaryMarker[]) => void;
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
  | 'measure'
  | 'tag_inlet'
  | 'tag_outlet'
  | 'tag_heat'
  | 'tag_wall';

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
};

export const Interactive3DViewport: React.FC<Interactive3DViewportProps> = ({
  field = 'CFD',
  showMeshOverlay: propShowMesh = false,
  activePreset: propPreset = 'iso',
  hasSolvedResults = false,
  solvedTaskId = null,
  meshQuality = null,
  vtkData = null,
  meshPreviewVtk = null,
  integrals = null,
  cadLoading = false,
  selectedMarkerId = null,
  highlightedPatchName = null,
  fieldMin,
  fieldMax,
  fieldUnit = '',
  fieldLabel = '',
  onPresetChange,
  onCadLoaded,
  onCadStlUploaded,
  onCadFileUploaded,
  onBoundaryAdded,
  onBoundaryMarkersChange,
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
  const vtkMeshRef = useRef<THREE.Mesh | null>(null);
  const highlightMeshRef = useRef<THREE.Mesh | null>(null);
  const vectorGroupRef = useRef<THREE.Group | null>(null);
  const markersGroupRef = useRef<THREE.Group | null>(null);
  const markerObjectsMap = useRef<Map<string, THREE.Object3D>>(new Map());
  const regionBoxGroupRef = useRef<THREE.Group | null>(null);
  const sliceGuideGroupRef = useRef<THREE.Group | null>(null);
  const measureGroupRef = useRef<THREE.Group | null>(null);
  const volumetricSliceMeshRef = useRef<THREE.Mesh | null>(null);
  const volumetricStreamlinesGroupRef = useRef<THREE.Group | null>(null);
  const volumetricIsoMeshRef = useRef<THREE.Mesh | null>(null);
  const badCellsGroupRef = useRef<THREE.Group | null>(null);

  // Base geometry arrays for non-destructive Deformation Scaling & Iso-Thresholding
  const baseVtkRef = useRef<{
    normalizedPositions: Float32Array | null;
    triangles: number[];
    scalars?: number[];
    displacement?: number[];
    scale: number;
  }>({
    normalizedPositions: null,
    triangles: [],
    scalars: undefined,
    displacement: undefined,
    scale: 1,
  });

  // Transform mapping back from normalized scene coordinates to physical coordinates (m)
  const vtkTransformRef = useRef<{ center: THREE.Vector3; scale: number; scalarKey: string; scalars?: number[]; unit: string }>({
    center: new THREE.Vector3(0, 0, 0),
    scale: 1,
    scalarKey: '',
    scalars: undefined,
    unit: '',
  });
  const cadTransformRef = useRef<{ center: THREE.Vector3; scale: number }>({
    center: new THREE.Vector3(0, 0, 0),
    scale: 1,
  });

  const [showWireframe, setShowWireframe] = useState<boolean>(propShowMesh);
  const [preset, setPreset] = useState<ViewPreset>(propPreset);
  const [activeTool, setActiveTool] = useState<ActiveToolType>('orbit');
  const [showStreamlines, setShowStreamlines] = useState<boolean>(false);
  const [colormap, setColormap] = useState<ColormapType>('turbo');
  const [selectedScalarKey, setSelectedScalarKey] = useState<string>('');
  const [cadStats, setCadStats] = useState<CadModelStats | null>(null);
  const [boundaryMarkers, setBoundaryMarkers] = useState<BoundaryMarker[]>([]);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  const [copiedTopoSet, setCopiedTopoSet] = useState<boolean>(false);

  // Post-Processing Controls (Slice, Deformation Scale, Iso-Threshold, Integrals HUD)
  const [sliceAxis, setSliceAxis] = useState<'off' | 'x' | 'y' | 'z'>('off');
  const [sliceOffset, setSliceOffset] = useState<number>(0);
  const [deformationScale, setDeformationScale] = useState<number>(10);
  const [isoMinPct, setIsoMinPct] = useState<number>(0);
  const [isoMaxPct, setIsoMaxPct] = useState<number>(100);
  const [showPostControls, setShowPostControls] = useState<boolean>(false);
  const [showIntegralsHud, setShowIntegralsHud] = useState<boolean>(false);
  const [showLinePlot, setShowLinePlot] = useState<boolean>(false);
  const [linePlotAxis, setLinePlotAxis] = useState<'x' | 'y' | 'z'>('x');
  const [linePlotSlicePct, setLinePlotSlicePct] = useState<number>(50);
  const [frameIndex, setFrameIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showSurfaceGradient, setShowSurfaceGradient] = useState<boolean>(false);
  const [isExportingPng, setIsExportingPng] = useState<boolean>(false);

  // Directive 05: Real Headless PyVista/VTK Volumetric Binary Post-Processing State
  const [postMetadata, setPostMetadata] = useState<VolumetricPostMetadata | null>(null);
  const [volumetricStatus, setVolumetricStatus] = useState<string | null>(null);
  const [useBinarySurface, setUseBinarySurface] = useState<boolean>(true);
  const [binarySurfacePayload, setBinarySurfacePayload] = useState<DecodedNSR1Payload | null>(null);
  const [isLoadingBinarySurface, setIsLoadingBinarySurface] = useState<boolean>(false);
  const [isLoadingVolSlice, setIsLoadingVolSlice] = useState<boolean>(false);
  const [volSliceError, setVolSliceError] = useState<string | null>(null);
  const [streamlineSeeds, setStreamlineSeeds] = useState<24 | 48 | 96>(48);
  const [isLoadingStreamlines, setIsLoadingStreamlines] = useState<boolean>(false);
  const [streamlinesError, setStreamlinesError] = useState<string | null>(null);
  const [streamlineCount, setStreamlineCount] = useState<number>(0);
  const [showVolumetricIso, setShowVolumetricIso] = useState<boolean>(false);
  const [volumetricIsoField, setVolumetricIsoField] = useState<string>('');
  const [volumetricIsoValue, setVolumetricIsoValue] = useState<number>(0);
  const [isLoadingVolIso, setIsLoadingVolIso] = useState<boolean>(false);
  const [volIsoError, setVolIsoError] = useState<string | null>(null);
  const [volIsoTriangles, setVolIsoTriangles] = useState<number>(0);
  const [showBadCells, setShowBadCells] = useState<boolean>(false);
  const [transformRevision, setTransformRevision] = useState<number>(0);

  // Interactive 3D Ruler / Distance Measurement Tool (Zero-Mock physical coordinates)
  const [measureP1, setMeasureP1] = useState<PhysicalPoint3D | null>(null);
  const [measureP2, setMeasureP2] = useState<PhysicalPoint3D | null>(null);
  const [measureHover, setMeasureHover] = useState<PhysicalPoint3D | null>(null);
  const [copiedMeasure, setCopiedMeasure] = useState<boolean>(false);

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
    scalarValue?: number;
    scalarUnit?: string;
    label: string;
    screenX: number;
    screenY: number;
  } | null>(null);

  useEffect(() => {
    setShowWireframe(propShowMesh);
  }, [propShowMesh]);

  useEffect(() => {
    if (selectedMarkerId) {
      setEditingMarkerId(selectedMarkerId);
    }
  }, [selectedMarkerId]);

  const effectiveVtkData = vtkData || meshPreviewVtk || null;
  const isShowingSolvedVtk = Boolean(vtkData);
  const timeFrames = useMemo(
    () => (Array.isArray(effectiveVtkData?.time_frames) ? effectiveVtkData.time_frames : []),
    [effectiveVtkData],
  );
  const effectiveVtkDataRef = useRef<VtkFieldPayload | null>(effectiveVtkData);
  effectiveVtkDataRef.current = effectiveVtkData;

  useEffect(() => {
    setIsPlaying(false);
    setFrameIndex(timeFrames.length > 0 ? timeFrames.length - 1 : 0);
  }, [effectiveVtkData, timeFrames.length]);

  useEffect(() => {
    if (!isPlaying || timeFrames.length <= 1) return;
    const timer = window.setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % timeFrames.length);
    }, 350);
    return () => window.clearInterval(timer);
  }, [isPlaying, timeFrames.length]);

  const isFEA = field === 'FEA' || field?.toLowerCase().includes('structural');
  const isThermal = field === 'Thermal' || field?.toLowerCase().includes('thermal');
  const isCFD = !isFEA && !isThermal;

  const availableScalars = useMemo(() => {
    const keys: string[] = [];
    if (effectiveVtkData?.scalars) {
      for (const [key, arr] of Object.entries(effectiveVtkData.scalars)) {
        if (Array.isArray(arr) && arr.length > 0 && !keys.includes(key)) {
          keys.push(key);
        }
      }
    }
    if (postMetadata?.available && Array.isArray(postMetadata.scalars)) {
      for (const s of postMetadata.scalars) {
        if (s?.name && !keys.includes(s.name)) {
          keys.push(s.name);
        }
      }
    }
    return keys;
  }, [effectiveVtkData, postMetadata]);

  const hasVolumetricVectors = Boolean(postMetadata?.available && postMetadata.vectors.length > 0);
  const hasVolumetricScalars = Boolean(postMetadata?.available && postMetadata.scalars.length > 0);
  const activeVolumetricScalarName = useMemo(() => {
    if (!postMetadata?.available || postMetadata.scalars.length === 0) return undefined;
    const exact = postMetadata.scalars.find((s) => s.name === selectedScalarKey);
    if (exact) return exact.name;
    const lowerSel = (selectedScalarKey || '').toLowerCase();
    const fuzzy = postMetadata.scalars.find(
      (s) => s.name.toLowerCase() === lowerSel || (lowerSel === 'velocity' && s.name === 'U_mag'),
    );
    return fuzzy ? fuzzy.name : postMetadata.scalars[0].name;
  }, [postMetadata, selectedScalarKey]);

  const activeIsoScalarMeta = useMemo(() => {
    if (!postMetadata?.available || postMetadata.scalars.length === 0) return null;
    return (
      postMetadata.scalars.find((s) => s.name === volumetricIsoField) ||
      postMetadata.scalars.find((s) => s.name === activeVolumetricScalarName) ||
      postMetadata.scalars[0]
    );
  }, [postMetadata, volumetricIsoField, activeVolumetricScalarName]);

  const badCellPoints = useMemo<number[][]>(() => {
    if (Array.isArray(meshQuality?.bad_cell_points) && meshQuality.bad_cell_points.length > 0) {
      return meshQuality.bad_cell_points;
    }
    if (Array.isArray(postMetadata?.bad_cell_points) && postMetadata.bad_cell_points.length > 0) {
      return postMetadata.bad_cell_points;
    }
    return [];
  }, [meshQuality, postMetadata]);

  // Query real volumetric post-processing capabilities ONCE per solved taskId
  useEffect(() => {
    setBinarySurfacePayload(null);
    setVolSliceError(null);
    setStreamlinesError(null);
    setVolIsoError(null);
    setStreamlineCount(0);
    setVolIsoTriangles(0);
    setShowVolumetricIso(false);

    if (!solvedTaskId || !hasSolvedResults) {
      setPostMetadata(null);
      setVolumetricStatus(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setVolumetricStatus('Checking volumetric dataset…');

    fetchVolumetricPostMetadata(solvedTaskId, controller.signal)
      .then((meta) => {
        if (cancelled) return;
        setPostMetadata(meta);
        if (meta.available) {
          setVolumetricStatus(null);
          if (meta.scalars.length > 0) {
            const defScalar = meta.scalars[0];
            setVolumetricIsoField(defScalar.name);
            setVolumetricIsoValue(0.5 * (defScalar.min + defScalar.max));
          }
        } else {
          setVolumetricStatus(
            meta.error || 'Volumetric post-processing unavailable for this job — using surface VTK fallback.',
          );
        }
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setPostMetadata({ available: false, scalars: [], vectors: [] });
        setVolumetricStatus(
          err instanceof Error
            ? `Volumetric engine unavailable (${err.message}) — using surface VTK fallback.`
            : 'Volumetric engine unavailable — using surface VTK fallback.',
        );
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [solvedTaskId, hasSolvedResults]);

  // Keep iso-value clamped inside selected volumetric field's real [min, max]
  useEffect(() => {
    if (!activeIsoScalarMeta) return;
    setVolumetricIsoValue((prev) => {
      if (!Number.isFinite(prev) || prev < activeIsoScalarMeta.min || prev > activeIsoScalarMeta.max) {
        return 0.5 * (activeIsoScalarMeta.min + activeIsoScalarMeta.max);
      }
      return prev;
    });
  }, [activeIsoScalarMeta?.name, activeIsoScalarMeta?.min, activeIsoScalarMeta?.max]);

  // Fetch full-resolution NSR1 binary outer surface mesh when volumetric metadata is available
  useEffect(() => {
    if (
      !solvedTaskId ||
      !hasSolvedResults ||
      !postMetadata?.available ||
      !useBinarySurface ||
      timeFrames.length > 1 ||
      showSurfaceGradient
    ) {
      setBinarySurfacePayload(null);
      setIsLoadingBinarySurface(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setIsLoadingBinarySurface(true);

    const fieldQuery = activeVolumetricScalarName
      ? `?field=${encodeURIComponent(activeVolumetricScalarName)}`
      : '';
    fetchBinaryPostPayload(
      `/api/jobs/${encodeURIComponent(solvedTaskId)}/post/surface.bin${fieldQuery}`,
      { method: 'GET', signal: controller.signal },
    )
      .then((payload) => {
        if (cancelled) return;
        if (payload.points && payload.points.length >= 9 && payload.indices && payload.indices.length >= 3) {
          setBinarySurfacePayload(payload);
        } else {
          setBinarySurfacePayload(null);
        }
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        // Honest fallback to existing JSON vtkData surface
        setBinarySurfacePayload(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBinarySurface(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    solvedTaskId,
    hasSolvedResults,
    postMetadata?.available,
    useBinarySurface,
    activeVolumetricScalarName,
    timeFrames.length,
    showSurfaceGradient,
  ]);

  useEffect(() => {
    if (availableScalars.length === 0) {
      setSelectedScalarKey('');
      return;
    }
    if (effectiveVtkData?.active_field && availableScalars.includes(effectiveVtkData.active_field)) {
      setSelectedScalarKey(effectiveVtkData.active_field);
    } else if (!availableScalars.includes(selectedScalarKey)) {
      setSelectedScalarKey(availableScalars[0]);
    }
  }, [availableScalars, effectiveVtkData?.active_field]);

  const scalarRange = useMemo(() => {
    const activeKey = selectedScalarKey || availableScalars[0] || '';
    const rawArr = activeKey && effectiveVtkData?.scalars ? effectiveVtkData.scalars[activeKey] : undefined;
    const rawUnit = (effectiveVtkData?.units && effectiveVtkData.units[activeKey]) || fieldUnit || '';
    if (!rawArr || rawArr.length === 0) {
      const volMetaScalar = postMetadata?.available
        ? postMetadata.scalars.find((s) => s.name === activeKey) || postMetadata.scalars[0]
        : undefined;
      if (volMetaScalar) {
        return {
          key: volMetaScalar.name,
          displayKey: volMetaScalar.name,
          values: undefined as number[] | undefined,
          min: volMetaScalar.min,
          max: volMetaScalar.max,
          unit: rawUnit,
          isGradient: false,
        };
      }
      return {
        key: activeKey,
        displayKey: activeKey,
        values: undefined as number[] | undefined,
        min: fieldMin,
        max: fieldMax,
        unit: fieldUnit,
        isGradient: false,
      };
    }

    if (
      showSurfaceGradient &&
      effectiveVtkData &&
      Array.isArray(effectiveVtkData.points) &&
      Array.isArray(effectiveVtkData.triangles)
    ) {
      const grad = computeVtkSurfaceGradientMagnitude(
        effectiveVtkData.points,
        effectiveVtkData.triangles,
        rawArr,
      );
      if (grad) {
        const gradUnit = rawUnit ? `${rawUnit === '°C' ? 'K' : rawUnit}/m` : '1/m';
        return {
          key: activeKey,
          displayKey: `|∇${activeKey}|`,
          values: grad.values,
          min: grad.min,
          max: grad.max,
          unit: gradUnit,
          isGradient: true,
        };
      }
    }

    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < rawArr.length; i++) {
      const v = rawArr[i];
      if (Number.isFinite(v)) {
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
    }
    return {
      key: activeKey,
      displayKey: activeKey,
      values: rawArr,
      min: Number.isFinite(minV) ? minV : fieldMin,
      max: Number.isFinite(maxV) ? maxV : fieldMax,
      unit: rawUnit,
      isGradient: false,
    };
  }, [effectiveVtkData, postMetadata, selectedScalarKey, availableScalars, fieldMin, fieldMax, fieldUnit, showSurfaceGradient]);

  // Real 3D Plot Over Line sampler directly on solved VTK nodal coordinates & scalars (zero fabrication)
  const lineProfileData = useMemo(() => {
    if (!showLinePlot || !effectiveVtkData?.points || !scalarRange.key) return [];
    const pts = effectiveVtkData.points;
    const scalars = scalarRange.values ?? effectiveVtkData.scalars?.[scalarRange.key];
    if (!Array.isArray(scalars) || scalars.length === 0 || pts.length < 6) return [];

    const nNodes = Math.min(Math.floor(pts.length / 3), scalars.length);
    const axisIdx = linePlotAxis === 'x' ? 0 : linePlotAxis === 'y' ? 1 : 2;
    const perpIdx = linePlotAxis === 'x' ? 1 : 0;

    let axMin = Infinity;
    let axMax = -Infinity;
    let pMin = Infinity;
    let pMax = -Infinity;
    for (let i = 0; i < nNodes; i++) {
      const a = pts[i * 3 + axisIdx];
      const p = pts[i * 3 + perpIdx];
      if (a < axMin) axMin = a;
      if (a > axMax) axMax = a;
      if (p < pMin) pMin = p;
      if (p > pMax) pMax = p;
    }
    const axSpan = axMax - axMin;
    if (!Number.isFinite(axSpan) || axSpan <= 1e-12) return [];
    const pSpan = pMax - pMin;
    const targetP = pMin + (linePlotSlicePct / 100) * pSpan;
    const pTol = Math.max(pSpan * 0.14, 1e-6);

    const bins = 36;
    const sums = new Float64Array(bins);
    const counts = new Uint32Array(bins);
    for (let i = 0; i < nNodes; i++) {
      const val = scalars[i];
      if (!Number.isFinite(val)) continue;
      const p = pts[i * 3 + perpIdx];
      if (pSpan > 1e-9 && Math.abs(p - targetP) > pTol) continue;
      const a = pts[i * 3 + axisIdx];
      const b = Math.min(bins - 1, Math.max(0, Math.floor(((a - axMin) / axSpan) * bins)));
      sums[b] += val;
      counts[b] += 1;
    }

    const sampled: { coord: number; value: number }[] = [];
    for (let b = 0; b < bins; b++) {
      if (counts[b] > 0) {
        sampled.push({
          coord: axMin + ((b + 0.5) / bins) * axSpan,
          value: sums[b] / counts[b],
        });
      }
    }
    return sampled;
  }, [showLinePlot, effectiveVtkData, scalarRange.key, linePlotAxis, linePlotSlicePct]);

  const activeToolRef = useRef<ActiveToolType>(activeTool);
  activeToolRef.current = activeTool;
  const measureP1Ref = useRef<PhysicalPoint3D | null>(measureP1);
  measureP1Ref.current = measureP1;
  const measureP2Ref = useRef<PhysicalPoint3D | null>(measureP2);
  measureP2Ref.current = measureP2;
  const isFEARef = useRef<boolean>(isFEA);
  isFEARef.current = isFEA;
  const hasSolvedRef = useRef<boolean>(hasSolvedResults || Boolean(vtkData));
  hasSolvedRef.current = hasSolvedResults || Boolean(vtkData);
  const fieldLabelRef = useRef<string>(fieldLabel);
  fieldLabelRef.current = fieldLabel;
  const onBoundaryAddedRef = useRef(onBoundaryAdded);
  onBoundaryAddedRef.current = onBoundaryAdded;

  const modelPhysicalBounds = useMemo(() => {
    const vtkBounds = computeVtkPhysicalBounds(effectiveVtkData?.points);
    if (vtkBounds) return vtkBounds;
    if (cadStats) {
      const [sx, sy, sz] = cadStats.dimensions;
      return {
        min: [-sx / 2, -sy / 2, -sz / 2] as [number, number, number],
        max: [sx / 2, sy / 2, sz / 2] as [number, number, number],
        size: [sx, sy, sz] as [number, number, number],
        diagonalM: Math.hypot(sx, sy, sz),
      };
    }
    return null;
  }, [effectiveVtkData, cadStats]);

  const activeMeasurement = useMemo(() => {
    if (!measureP1) return null;
    const second = measureP2 || measureHover;
    if (!second) return null;
    return computeMeasurementMetrics(measureP1, second);
  }, [measureP1, measureP2, measureHover]);

  useEffect(() => {
    if (onBoundaryMarkersChange) {
      onBoundaryMarkersChange(boundaryMarkers);
    }
  }, [boundaryMarkers, onBoundaryMarkersChange]);

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

    const ext = `.${file.name.split('.').pop()?.toLowerCase() || ''}`;
    const reader = new FileReader();
    reader.onload = (event) => {
      const contents = event.target?.result;
      if (!(contents instanceof ArrayBuffer)) return;

      const base64 = arrayBufferToBase64(contents);
      if (ext === '.stl') {
        try {
          const loader = new STLLoader();
          const geometry = loader.parse(contents);
          geometry.computeVertexNormals();
          geometry.computeBoundingBox();
          const origBbox = geometry.boundingBox!;
          const origCenter = new THREE.Vector3();
          origBbox.getCenter(origCenter);
          const sizeX = origBbox.max.x - origBbox.min.x;
          const sizeY = origBbox.max.y - origBbox.min.y;
          const sizeZ = origBbox.max.z - origBbox.min.z;
          const maxDim = Math.max(sizeX, sizeY, sizeZ);
          const scaleFactor = 5.0 / (maxDim || 1);
          geometry.translate(-origCenter.x, -origCenter.y, -origCenter.z);
          geometry.scale(scaleFactor, scaleFactor, scaleFactor);
          cadTransformRef.current = { center: origCenter, scale: scaleFactor };

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
            (customMeshRef.current.material as THREE.Material).dispose();
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
          if (onCadStlUploaded) onCadStlUploaded({ name: file.name, base64, stats });
          if (onCadFileUploaded) onCadFileUploaded({ name: file.name, base64, ext, stats });
          applyPreset('iso');
        } catch (err) {
          console.error('Failed to parse STL file:', err);
        }
      } else {
        // B-Rep CAD (.step, .stp, .iges, .igs) or Solver Mesh (.inp, .msh) -> tessellate on Docker :8000 /api/cad-preview
        if (customMeshRef.current && sceneRef.current) {
          sceneRef.current.remove(customMeshRef.current);
          customMeshRef.current.geometry.dispose();
          (customMeshRef.current.material as THREE.Material).dispose();
          customMeshRef.current = null;
        }
        if (onCadFileUploaded) {
          onCadFileUploaded({ name: file.name, base64, ext });
        }
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
    scene.fog = new THREE.FogExp2(0x0a0f1d, 0.014);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 150);
    camera.position.set(6, 4.5, 6.5);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    rendererRef.current = renderer;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.localClippingEnabled = true;

    // Studio Environment Lighting via PMREMGenerator
    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmrem.dispose();

    container.replaceChildren(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xf8fafc, 1.9);
    keyLight.position.set(12, 18, 10);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.0);
    rimLight.position.set(-10, -6, -10);
    scene.add(rimLight);

    const grid = new THREE.GridHelper(16, 32, 0x38bdf8, 0x1e293b);
    grid.position.y = -2.2;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.4;
    scene.add(grid);

    const markersGroup = new THREE.Group();
    markersGroupRef.current = markersGroup;
    scene.add(markersGroup);

    const regionBoxGroup = new THREE.Group();
    regionBoxGroupRef.current = regionBoxGroup;
    scene.add(regionBoxGroup);

    const sliceGuideGroup = new THREE.Group();
    sliceGuideGroupRef.current = sliceGuideGroup;
    scene.add(sliceGuideGroup);

    const vectorGroup = new THREE.Group();
    vectorGroupRef.current = vectorGroup;
    scene.add(vectorGroup);

    const measureGroup = new THREE.Group();
    measureGroupRef.current = measureGroup;
    scene.add(measureGroup);

    const volumetricStreamlinesGroup = new THREE.Group();
    volumetricStreamlinesGroupRef.current = volumetricStreamlinesGroup;
    scene.add(volumetricStreamlinesGroup);

    const badCellsGroup = new THREE.Group();
    badCellsGroupRef.current = badCellsGroup;
    scene.add(badCellsGroup);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.maxDistance = 24;
    controls.minDistance = 1.2;
    controls.target.set(0, 0, 0);

    if (customMeshRef.current) {
      scene.add(customMeshRef.current);
    }

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const getPickTargets = (): THREE.Object3D[] => {
      const list: THREE.Object3D[] = [];
      if (vtkMeshRef.current && vtkMeshRef.current.visible) list.push(vtkMeshRef.current);
      if (customMeshRef.current && customMeshRef.current.visible) list.push(customMeshRef.current);
      return list;
    };

    const extractPhysicalHit = (hit: THREE.Intersection): PhysicalPoint3D => {
      const pt = hit.point;
      const isVtkHit = hit.object === vtkMeshRef.current && Boolean(vtkMeshRef.current);
      const tf = isVtkHit ? vtkTransformRef.current : { ...cadTransformRef.current, scalarKey: '', scalars: undefined, unit: '' };
      const physX = tf.scale !== 0 ? pt.x / tf.scale + tf.center.x : pt.x;
      const physY = tf.scale !== 0 ? pt.y / tf.scale + tf.center.y : pt.y;
      const physZ = tf.scale !== 0 ? pt.z / tf.scale + tf.center.z : pt.z;

      let scalarValue: number | undefined;
      if (isVtkHit && hit.face && tf.scalars && vtkMeshRef.current) {
        const geom = vtkMeshRef.current.geometry;
        const posAttr = geom.attributes.position as THREE.BufferAttribute;
        const vA = new THREE.Vector3().fromBufferAttribute(posAttr, hit.face.a);
        const vB = new THREE.Vector3().fromBufferAttribute(posAttr, hit.face.b);
        const vC = new THREE.Vector3().fromBufferAttribute(posAttr, hit.face.c);
        const bary = new THREE.Vector3();
        THREE.Triangle.getBarycoord(pt, vA, vB, vC, bary);
        const sA = tf.scalars[hit.face.a] ?? 0;
        const sB = tf.scalars[hit.face.b] ?? 0;
        const sC = tf.scalars[hit.face.c] ?? 0;
        const interp = sA * bary.x + sB * bary.y + sC * bary.z;
        if (Number.isFinite(interp)) scalarValue = interp;
      }

      return {
        x: physX,
        y: physY,
        z: physZ,
        scenePoint: [pt.x, pt.y, pt.z],
        scalarValue,
        scalarLabel: tf.scalarKey || undefined,
        scalarUnit: tf.unit || undefined,
      };
    };

    let pointerDownX = 0;
    let pointerDownY = 0;
    let lastHoverRaycast = 0;

    const onPointerDown = (e: MouseEvent) => {
      pointerDownX = e.clientX;
      pointerDownY = e.clientY;
    };

    const onPointerClick = (e: MouseEvent) => {
      // Ignore OrbitControls camera drags so rotating never places accidental pins
      if (Math.hypot(e.clientX - pointerDownX, e.clientY - pointerDownY) > 5) return;

      const currentTool = activeToolRef.current;
      if (!currentTool.startsWith('tag_') && currentTool !== 'measure') return;

      const targets = getPickTargets();
      if (targets.length === 0) return;

      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(targets, true);

      if (intersects.length > 0) {
        const hit = intersects[0];

        if (currentTool === 'measure') {
          const picked = extractPhysicalHit(hit);
          if (!measureP1Ref.current || measureP2Ref.current) {
            setMeasureP1(picked);
            setMeasureP2(null);
            setMeasureHover(null);
          } else {
            setMeasureP2(picked);
            setMeasureHover(null);
          }
          return;
        }

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
            label = 'Heat Flux Wall';
          }
        } else if (currentTool === 'tag_wall') {
          markerType = isFEARef.current ? 'Fixed' : 'Wall';
          defaultVal = 0;
          defaultUnit = isFEARef.current ? 'm' : 'W/m²';
          secVal = undefined;
          secUnit = undefined;
          colorHex = 0xa855f7;
          label = isFEARef.current ? 'Fixed Support' : 'Adiabatic Wall';
        }

        const arrow = new THREE.ArrowHelper(norm, pt, 0.9, colorHex, 0.28, 0.14);
        markersGroup.add(arrow);

        const newId = `bm_${Date.now()}`;
        markerObjectsMap.current.set(newId, arrow);

        const pickedPhys = extractPhysicalHit(hit);

        let detectedPatchName: string | undefined;
        const curVtk = effectiveVtkDataRef.current;
        if (
          hit.object === vtkMeshRef.current &&
          typeof hit.faceIndex === 'number' &&
          curVtk?.triangle_patches &&
          curVtk.patches
        ) {
          const patchIdx = curVtk.triangle_patches[hit.faceIndex];
          const patchMeta = typeof patchIdx === 'number' ? curVtk.patches[patchIdx] : undefined;
          if (patchMeta?.name) {
            detectedPatchName = patchMeta.name;
          }
        }

        const newMarker: BoundaryMarker = {
          id: newId,
          type: markerType,
          label: detectedPatchName ? `${label} (${detectedPatchName})` : label,
          patchName: detectedPatchName,
          value: defaultVal,
          unit: defaultUnit,
          secondaryValue: secVal,
          secondaryUnit: secUnit,
          point: [Number(pickedPhys.x.toFixed(4)), Number(pickedPhys.y.toFixed(4)), Number(pickedPhys.z.toFixed(4))],
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
      const tool = activeToolRef.current;
      const isLiveMeasureHover = tool === 'measure' && Boolean(measureP1Ref.current) && !measureP2Ref.current;
      if (tool !== 'probe' && !isLiveMeasureHover) {
        setProbeData(null);
        setMeasureHover(null);
        return;
      }

      const now = performance.now();
      if (now - lastHoverRaycast < 24) return;
      lastHoverRaycast = now;

      const targets = getPickTargets();
      if (targets.length === 0) {
        setProbeData(null);
        setMeasureHover(null);
        return;
      }

      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(targets, true);
      if (intersects.length > 0) {
        const picked = extractPhysicalHit(intersects[0]);
        if (isLiveMeasureHover) {
          setMeasureHover(picked);
          setProbeData(null);
          return;
        }
        setProbeData({
          x: Number(picked.x.toFixed(4)),
          y: Number(picked.y.toFixed(4)),
          z: Number(picked.z.toFixed(4)),
          scalarValue: picked.scalarValue !== undefined ? Number(picked.scalarValue.toFixed(4)) : undefined,
          scalarUnit: picked.scalarUnit,
          label: picked.scalarLabel
            ? `${picked.scalarLabel}`
            : hasSolvedRef.current && fieldLabelRef.current
              ? fieldLabelRef.current
              : 'Surface Coordinate Probe',
          screenX: e.clientX - rect.left,
          screenY: e.clientY - rect.top,
        });
      } else {
        setProbeData(null);
        if (isLiveMeasureHover) setMeasureHover(null);
      }
    };

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('click', onPointerClick);
    container.addEventListener('mousemove', onPointerMove);

    let frameCount = 0;
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

      if (frameCount === 0) {
        frameCount = 1;
        const gl = renderer.getContext();
        if (gl) {
          const debugExt = gl.getExtension('WEBGL_debug_renderer_info');
          if (debugExt) {
            const rendererName = String(gl.getParameter(debugExt.UNMASKED_RENDERER_WEBGL) || '');
            if (/swiftshader|llvmpipe|software/i.test(rendererName)) {
              renderer.shadowMap.enabled = false;
            }
          }
        }
      }
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
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('click', onPointerClick);
      container.removeEventListener('mousemove', onPointerMove);
      resizeObserver.disconnect();
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (volumetricSliceMeshRef.current) {
        scene.remove(volumetricSliceMeshRef.current);
        volumetricSliceMeshRef.current.geometry.dispose();
        (volumetricSliceMeshRef.current.material as THREE.Material).dispose();
        volumetricSliceMeshRef.current = null;
      }
      if (volumetricIsoMeshRef.current) {
        scene.remove(volumetricIsoMeshRef.current);
        volumetricIsoMeshRef.current.geometry.dispose();
        (volumetricIsoMeshRef.current.material as THREE.Material).dispose();
        volumetricIsoMeshRef.current = null;
      }
      for (const grp of [volumetricStreamlinesGroup, badCellsGroup]) {
        while (grp.children.length > 0) {
          const ch = grp.children[0] as THREE.Mesh | THREE.Line | THREE.Points;
          grp.remove(ch);
          if (ch.geometry) ch.geometry.dispose();
          if (Array.isArray(ch.material)) ch.material.forEach((m) => m.dispose());
          else if (ch.material) ch.material.dispose();
        }
      }
      envTarget.dispose();
      renderer.dispose();
      controls.dispose();
    };
  }, []);

  // Build/Update VTK mesh (either Solved VTK or Pre-Solve CAD/Gmsh Mesh Preview)
  useEffect(() => {
    const scene = sceneRef.current;
    const vecGroup = vectorGroupRef.current;
    if (!scene || !vecGroup) return;

    if (vtkMeshRef.current) {
      scene.remove(vtkMeshRef.current);
      vtkMeshRef.current.geometry.dispose();
      (vtkMeshRef.current.material as THREE.Material).dispose();
      vtkMeshRef.current = null;
    }
    while (vecGroup.children.length > 0) {
      vecGroup.remove(vecGroup.children[0]);
    }

    const canUseBinarySurface =
      Boolean(
        useBinarySurface &&
        binarySurfacePayload?.points &&
        binarySurfacePayload.points.length >= 9 &&
        binarySurfacePayload.indices &&
        binarySurfacePayload.indices.length >= 3 &&
        timeFrames.length <= 1 &&
        !showSurfaceGradient &&
        !(effectiveVtkData?.vectors?.displacement && effectiveVtkData.vectors.displacement.length > 0),
      );

    if (canUseBinarySurface && binarySurfacePayload?.points && binarySurfacePayload?.indices) {
      if (customMeshRef.current) {
        customMeshRef.current.visible = false;
      }

      const rawPts = binarySurfacePayload.points;
      const posCopy = new Float32Array(rawPts.length);
      posCopy.set(rawPts);

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(posCopy, 3));
      geom.setIndex(new THREE.BufferAttribute(new Uint32Array(binarySurfacePayload.indices), 1));

      geom.computeBoundingBox();
      const bbox = geom.boundingBox!;
      const center = new THREE.Vector3();
      bbox.getCenter(center);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = 5.0 / maxDim;

      geom.translate(-center.x, -center.y, -center.z);
      geom.scale(scale, scale, scale);

      if (binarySurfacePayload.normals && binarySurfacePayload.normals.length === rawPts.length) {
        const normCopy = new Float32Array(binarySurfacePayload.normals.length);
        normCopy.set(binarySurfacePayload.normals);
        geom.setAttribute('normal', new THREE.BufferAttribute(normCopy, 3));
      } else {
        geom.computeVertexNormals();
      }

      const baseNormPos = new Float32Array((geom.attributes.position as THREE.BufferAttribute).array);
      const binScalars = binarySurfacePayload.scalars;
      const metaField = typeof binarySurfacePayload.metadata.field === 'string'
        ? binarySurfacePayload.metadata.field
        : activeVolumetricScalarName || scalarRange.displayKey || '';
      const metaMin = typeof binarySurfacePayload.metadata.min === 'number' ? binarySurfacePayload.metadata.min : scalarRange.min ?? 0;
      const metaMax = typeof binarySurfacePayload.metadata.max === 'number' ? binarySurfacePayload.metadata.max : scalarRange.max ?? 1;
      const span = metaMax - metaMin;
      const vertexCount = rawPts.length / 3;

      let useVertexColors = false;
      let scalarNumberArr: number[] | undefined;
      if (binScalars && binScalars.length >= vertexCount) {
        const colors = new Float32Array(vertexCount * 3);
        scalarNumberArr = new Array<number>(vertexCount);
        for (let i = 0; i < vertexCount; i++) {
          const val = binScalars[i];
          scalarNumberArr[i] = val;
          const t = span > 1e-12 && Number.isFinite(val) ? (val - metaMin) / span : 0.5;
          const [r, g, b] = getColorFromColormap(t, colormap);
          colors[i * 3] = r / 255;
          colors[i * 3 + 1] = g / 255;
          colors[i * 3 + 2] = b / 255;
        }
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        useVertexColors = true;
      }

      baseVtkRef.current = {
        normalizedPositions: baseNormPos,
        triangles: Array.from(binarySurfacePayload.indices),
        scalars: scalarNumberArr,
        displacement: undefined,
        scale,
      };
      vtkTransformRef.current = {
        center,
        scale,
        scalarKey: metaField,
        scalars: scalarNumberArr,
        unit: scalarRange.unit || '',
      };

      const shellTransparent = (showStreamlines && hasVolumetricVectors) || showVolumetricIso;
      const mat = new THREE.MeshStandardMaterial({
        vertexColors: useVertexColors,
        color: useVertexColors ? 0xffffff : 0x60a5fa,
        roughness: 0.42,
        metalness: 0.25,
        wireframe: showWireframe,
        side: THREE.DoubleSide,
        transparent: shellTransparent,
        opacity: shellTransparent ? 0.22 : 1.0,
        depthWrite: !shellTransparent,
      });

      const vtkMesh = new THREE.Mesh(geom, mat);
      vtkMesh.castShadow = !shellTransparent;
      vtkMesh.receiveShadow = true;
      vtkMeshRef.current = vtkMesh;
      scene.add(vtkMesh);
      setTransformRevision((r) => r + 1);
      return;
    }

    if (
      !effectiveVtkData ||
      !Array.isArray(effectiveVtkData.points) ||
      effectiveVtkData.points.length < 9 ||
      !Array.isArray(effectiveVtkData.triangles) ||
      effectiveVtkData.triangles.length < 3
    ) {
      baseVtkRef.current = { normalizedPositions: null, triangles: [], scalars: undefined, displacement: undefined, scale: 1 };
      return;
    }

    // If a VTK payload (solved or Gmsh/CAD preview) is active, hide any fallback raw STL mesh so they don't Z-fight
    if (customMeshRef.current) {
      customMeshRef.current.visible = false;
    }

    const posArr = new Float32Array(effectiveVtkData.points);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geom.setIndex(effectiveVtkData.triangles);

    geom.computeBoundingBox();
    const bbox = geom.boundingBox!;
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 5.0 / maxDim;

    geom.translate(-center.x, -center.y, -center.z);
    geom.scale(scale, scale, scale);
    geom.computeVertexNormals();

    const baseNormPos = new Float32Array((geom.attributes.position as THREE.BufferAttribute).array);
    const activeKey = scalarRange.displayKey || selectedScalarKey || availableScalars[0] || '';
    const scalarArr = scalarRange.values;
    const dispArr = effectiveVtkData.vectors?.displacement;
    const minV = scalarRange.min ?? 0;
    const maxV = scalarRange.max ?? 1;
    const span = maxV - minV;

    baseVtkRef.current = {
      normalizedPositions: baseNormPos,
      triangles: effectiveVtkData.triangles,
      scalars: scalarArr,
      displacement: dispArr && dispArr.length >= posArr.length ? dispArr : undefined,
      scale,
    };

    vtkTransformRef.current = {
      center,
      scale,
      scalarKey: activeKey,
      scalars: scalarArr,
      unit: scalarRange.unit || '',
    };

    const vertexCount = posArr.length / 3;
    let useVertexColors = false;

    if (scalarArr && scalarArr.length >= vertexCount) {
      const colors = new Float32Array(vertexCount * 3);
      for (let i = 0; i < vertexCount; i++) {
        const val = scalarArr[i];
        const t = span > 1e-12 && Number.isFinite(val) ? (val - minV) / span : 0.5;
        const [r, g, b] = getColorFromColormap(t, colormap);
        colors[i * 3] = r / 255;
        colors[i * 3 + 1] = g / 255;
        colors[i * 3 + 2] = b / 255;
      }
      geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      useVertexColors = true;
    }

    const shellTransparent = (showStreamlines && hasVolumetricVectors) || showVolumetricIso;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: useVertexColors,
      color: useVertexColors ? 0xffffff : meshPreviewVtk ? 0x94a3b8 : 0x60a5fa,
      roughness: 0.42,
      metalness: 0.25,
      wireframe: showWireframe,
      side: THREE.DoubleSide,
      transparent: shellTransparent,
      opacity: shellTransparent ? 0.22 : 1.0,
      depthWrite: !shellTransparent,
    });

    const vtkMesh = new THREE.Mesh(geom, mat);
    vtkMesh.castShadow = !shellTransparent;
    vtkMesh.receiveShadow = true;
    vtkMeshRef.current = vtkMesh;
    scene.add(vtkMesh);
    setTransformRevision((r) => r + 1);

    // Keep surface ArrowHelper vectors ONLY as fallback when no volumetric vector dataset is available
    if (showStreamlines && !hasVolumetricVectors && effectiveVtkData.vectors) {
      const vecKey = Object.keys(effectiveVtkData.vectors).find(
        (k) => Array.isArray(effectiveVtkData.vectors?.[k]) && effectiveVtkData.vectors[k].length >= vertexCount * 3,
      );
      if (vecKey) {
        const vArr = effectiveVtkData.vectors[vecKey];
        const step = Math.max(1, Math.floor(vertexCount / 140));
        for (let i = 0; i < vertexCount; i += step) {
          const vx = vArr[i * 3];
          const vy = vArr[i * 3 + 1];
          const vz = vArr[i * 3 + 2];
          const mag = Math.sqrt(vx * vx + vy * vy + vz * vz);
          if (mag < 1e-8) continue;
          const ox = (posArr[i * 3] - center.x) * scale;
          const oy = (posArr[i * 3 + 1] - center.y) * scale;
          const oz = (posArr[i * 3 + 2] - center.z) * scale;
          const dir = new THREE.Vector3(vx / mag, vy / mag, vz / mag);
          const arrowLen = Math.min(0.45, Math.max(0.14, mag * 0.25));
          const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(ox, oy, oz), arrowLen, 0x38bdf8, 0.08, 0.05);
          vecGroup.add(arrow);
        }
      }
    }
  }, [
    effectiveVtkData,
    meshPreviewVtk,
    selectedScalarKey,
    availableScalars,
    scalarRange,
    colormap,
    showWireframe,
    showStreamlines,
    useBinarySurface,
    binarySurfacePayload,
    hasVolumetricVectors,
    showVolumetricIso,
    timeFrames.length,
    showSurfaceGradient,
    activeVolumetricScalarName,
  ]);

  // Apply non-destructive Structural Deformation Scale & Iso-Threshold Filtering
  useEffect(() => {
    const mesh = vtkMeshRef.current;
    const base = baseVtkRef.current;
    if (!mesh || !base.normalizedPositions) return;

    const geom = mesh.geometry;
    const posAttr = geom.attributes.position as THREE.BufferAttribute;

    // 1. Structural Deformation Scaling
    if (base.displacement && base.displacement.length === base.normalizedPositions.length) {
      const out = posAttr.array as Float32Array;
      const d = base.displacement;
      const src = base.normalizedPositions;
      const factor = base.scale * deformationScale;
      for (let i = 0; i < src.length; i++) {
        out[i] = src[i] + d[i] * factor;
      }
      posAttr.needsUpdate = true;
      geom.computeVertexNormals();
    }

    // 2. Iso-Threshold Triangle Filtering
    if (base.scalars && (isoMinPct > 0 || isoMaxPct < 100)) {
      const minV = scalarRange.min ?? 0;
      const maxV = scalarRange.max ?? 1;
      const span = maxV - minV;
      const low = minV + span * (isoMinPct / 100);
      const high = minV + span * (isoMaxPct / 100);
      const tris = base.triangles;
      const sc = base.scalars;
      const filtered: number[] = [];
      for (let i = 0; i < tris.length; i += 3) {
        const a = tris[i];
        const b = tris[i + 1];
        const c = tris[i + 2];
        const avg = ((sc[a] ?? 0) + (sc[b] ?? 0) + (sc[c] ?? 0)) / 3;
        if (avg >= low && avg <= high) {
          filtered.push(a, b, c);
        }
      }
      geom.setIndex(filtered);
    } else if (base.triangles.length > 0) {
      geom.setIndex(base.triangles);
    }
  }, [deformationScale, isoMinPct, isoMaxPct, scalarRange.min, scalarRange.max, effectiveVtkData]);

  // Apply Transient Time-Step Playback Frame in-place without recreating geometry
  useEffect(() => {
    const mesh = vtkMeshRef.current;
    const base = baseVtkRef.current;
    if (!mesh || !base.normalizedPositions || timeFrames.length <= 1) return;
    const frame = timeFrames[Math.min(frameIndex, timeFrames.length - 1)];
    if (!frame || !frame.scalars) return;

    const activeKey =
      selectedScalarKey && frame.scalars[selectedScalarKey]
        ? selectedScalarKey
        : Object.keys(frame.scalars)[0] || '';
    const rawFrameScalars = activeKey ? frame.scalars[activeKey] : undefined;
    const frameGrad =
      showSurfaceGradient && rawFrameScalars && effectiveVtkData
        ? computeVtkSurfaceGradientMagnitude(
            effectiveVtkData.points,
            effectiveVtkData.triangles,
            rawFrameScalars,
          )
        : null;
    const frameScalars = frameGrad ? frameGrad.values : rawFrameScalars;
    const geom = mesh.geometry;
    const vertexCount = base.normalizedPositions.length / 3;

    if (frameScalars && frameScalars.length >= vertexCount) {
      base.scalars = frameScalars;
      vtkTransformRef.current.scalars = frameScalars;
      let minV = Infinity;
      let maxV = -Infinity;
      for (let i = 0; i < frameScalars.length; i++) {
        const v = frameScalars[i];
        if (Number.isFinite(v)) {
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
      }
      if (!Number.isFinite(minV)) minV = scalarRange.min ?? 0;
      if (!Number.isFinite(maxV)) maxV = scalarRange.max ?? 1;
      const span = maxV - minV;

      let colorAttr = geom.attributes.color as THREE.BufferAttribute | undefined;
      if (!colorAttr || colorAttr.count < vertexCount) {
        colorAttr = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3);
        geom.setAttribute('color', colorAttr);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.vertexColors = true;
        mat.color.setHex(0xffffff);
        mat.needsUpdate = true;
      }
      const colors = colorAttr.array as Float32Array;
      for (let i = 0; i < vertexCount; i++) {
        const val = frameScalars[i];
        const t = span > 1e-12 && Number.isFinite(val) ? (val - minV) / span : 0.5;
        const [r, g, b] = getColorFromColormap(t, colormap);
        colors[i * 3] = r / 255;
        colors[i * 3 + 1] = g / 255;
        colors[i * 3 + 2] = b / 255;
      }
      colorAttr.needsUpdate = true;
    }

    const frameDisp = frame.vectors?.displacement;
    if (frameDisp && frameDisp.length === base.normalizedPositions.length) {
      base.displacement = frameDisp;
      const posAttr = geom.attributes.position as THREE.BufferAttribute;
      const out = posAttr.array as Float32Array;
      const src = base.normalizedPositions;
      const factor = base.scale * deformationScale;
      for (let i = 0; i < src.length; i++) {
        out[i] = src[i] + frameDisp[i] * factor;
      }
      posAttr.needsUpdate = true;
      geom.computeVertexNormals();
    }
  }, [frameIndex, timeFrames, selectedScalarKey, colormap, deformationScale, scalarRange.min, scalarRange.max, showSurfaceGradient, effectiveVtkData]);

  // Render CAD Named Face Highlight Overlay when a patch or marker with patchName is selected
  useEffect(() => {
    const scene = sceneRef.current;
    const base = baseVtkRef.current;
    if (!scene) return;

    if (highlightMeshRef.current) {
      scene.remove(highlightMeshRef.current);
      highlightMeshRef.current.geometry.dispose();
      (highlightMeshRef.current.material as THREE.Material).dispose();
      highlightMeshRef.current = null;
    }

    const activeMarkerPatch = editingMarkerId
      ? boundaryMarkers.find((m) => m.id === editingMarkerId)?.patchName
      : undefined;
    const targetPatchName = highlightedPatchName || activeMarkerPatch || null;
    if (
      !targetPatchName ||
      !base.normalizedPositions ||
      !effectiveVtkData?.triangle_patches ||
      !effectiveVtkData.patches
    ) {
      return;
    }

    const patchIdx = effectiveVtkData.patches.findIndex(
      (p) => p.name.toLowerCase() === targetPatchName.toLowerCase() || p.id.toLowerCase() === targetPatchName.toLowerCase(),
    );
    if (patchIdx < 0) return;

    const patchTris: number[] = [];
    const triPatches = effectiveVtkData.triangle_patches;
    const allTris = effectiveVtkData.triangles;
    for (let t = 0; t < triPatches.length; t++) {
      if (triPatches[t] === patchIdx && t * 3 + 2 < allTris.length) {
        patchTris.push(allTris[t * 3], allTris[t * 3 + 1], allTris[t * 3 + 2]);
      }
    }
    if (patchTris.length === 0) return;

    const hGeo = new THREE.BufferGeometry();
    hGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(base.normalizedPositions), 3));
    hGeo.setIndex(patchTris);
    hGeo.computeVertexNormals();

    const hMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthTest: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const hMesh = new THREE.Mesh(hGeo, hMat);
    highlightMeshRef.current = hMesh;
    scene.add(hMesh);
  }, [highlightedPatchName, editingMarkerId, boundaryMarkers, effectiveVtkData]);

  // Apply X / Y / Z Interactive Section Slice Clipping Plane (aligned to physical bounds when volumetric data exists)
  useEffect(() => {
    const guideGroup = sliceGuideGroupRef.current;
    if (guideGroup) {
      while (guideGroup.children.length > 0) {
        const ch = guideGroup.children[0] as THREE.Mesh | THREE.LineSegments;
        guideGroup.remove(ch);
        if (ch.geometry) ch.geometry.dispose();
        if (Array.isArray(ch.material)) ch.material.forEach((m) => m.dispose());
        else if (ch.material) ch.material.dispose();
      }
    }

    const planes: THREE.Plane[] = [];
    if (sliceAxis !== 'off') {
      const normal =
        sliceAxis === 'x'
          ? new THREE.Vector3(-1, 0, 0)
          : sliceAxis === 'y'
          ? new THREE.Vector3(0, -1, 0)
          : new THREE.Vector3(0, 0, -1);

      const clampedRatio = Math.max(-0.98, Math.min(0.98, sliceOffset));
      let coord = sliceOffset * 2.5;
      if (postMetadata?.bounds && postMetadata.bounds.length === 6) {
        const tf = vtkTransformRef.current;
        const [xmin, xmax, ymin, ymax, zmin, zmax] = postMetadata.bounds;
        if (sliceAxis === 'x') {
          const physX = 0.5 * (xmin + xmax) + 0.5 * (xmax - xmin) * clampedRatio;
          coord = (physX - tf.center.x) * tf.scale;
        } else if (sliceAxis === 'y') {
          const physY = 0.5 * (ymin + ymax) + 0.5 * (ymax - ymin) * clampedRatio;
          coord = (physY - tf.center.y) * tf.scale;
        } else {
          const physZ = 0.5 * (zmin + zmax) + 0.5 * (zmax - zmin) * clampedRatio;
          coord = (physZ - tf.center.z) * tf.scale;
        }
      }

      const plane = new THREE.Plane(normal, coord);
      planes.push(plane);

      if (guideGroup) {
        const pGeo = new THREE.PlaneGeometry(5.6, 5.6);
        const pMat = new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.08,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const pMesh = new THREE.Mesh(pGeo, pMat);
        const edgeGeo = new THREE.EdgesGeometry(pGeo);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x38bdf8 });
        const edgeWire = new THREE.LineSegments(edgeGeo, edgeMat);

        if (sliceAxis === 'x') {
          pMesh.rotation.y = Math.PI / 2;
          edgeWire.rotation.y = Math.PI / 2;
          pMesh.position.x = coord;
          edgeWire.position.x = coord;
        } else if (sliceAxis === 'y') {
          pMesh.rotation.x = Math.PI / 2;
          edgeWire.rotation.x = Math.PI / 2;
          pMesh.position.y = coord;
          edgeWire.position.y = coord;
        } else {
          pMesh.position.z = coord;
          edgeWire.position.z = coord;
        }
        guideGroup.add(pMesh);
        guideGroup.add(edgeWire);
      }
    }

    if (vtkMeshRef.current) {
      const m = vtkMeshRef.current.material as THREE.MeshStandardMaterial;
      m.clippingPlanes = planes;
      m.needsUpdate = true;
    }
    if (customMeshRef.current) {
      const m = customMeshRef.current.material as THREE.MeshStandardMaterial;
      m.clippingPlanes = planes;
      m.needsUpdate = true;
    }
  }, [sliceAxis, sliceOffset, effectiveVtkData, postMetadata, transformRevision]);

  // Directive 05: True Filled Volumetric Section Slice (POST /api/jobs/{taskId}/post/slice.bin)
  useEffect(() => {
    const scene = sceneRef.current;
    const clearSliceMesh = () => {
      if (volumetricSliceMeshRef.current && scene) {
        scene.remove(volumetricSliceMeshRef.current);
        volumetricSliceMeshRef.current.geometry.dispose();
        (volumetricSliceMeshRef.current.material as THREE.Material).dispose();
        volumetricSliceMeshRef.current = null;
      }
    };

    if (sliceAxis === 'off' || !solvedTaskId || !hasSolvedResults || !postMetadata?.available || !scene) {
      clearSliceMesh();
      setIsLoadingVolSlice(false);
      setVolSliceError(null);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setIsLoadingVolSlice(true);
    setVolSliceError(null);

    const timer = window.setTimeout(() => {
      const clampedRatio = Math.max(-0.98, Math.min(0.98, sliceOffset));
      fetchBinaryPostPayload(`/api/jobs/${encodeURIComponent(solvedTaskId)}/post/slice.bin`, {
        method: 'POST',
        body: JSON.stringify({
          axis: sliceAxis,
          offset_ratio: clampedRatio,
          field: activeVolumetricScalarName,
        }),
        signal: controller.signal,
      })
        .then((decoded) => {
          if (cancelled || !sceneRef.current) return;
          if (!decoded.points || decoded.points.length < 9 || !decoded.indices || decoded.indices.length < 3) {
            clearSliceMesh();
            setVolSliceError('Slice intersected zero volumetric cells at this offset.');
            return;
          }

          clearSliceMesh();

          const tf = vtkTransformRef.current;
          const rawPts = decoded.points;
          const vertexCount = rawPts.length / 3;
          const normPts = new Float32Array(rawPts.length);
          for (let i = 0; i < vertexCount; i++) {
            normPts[i * 3] = (rawPts[i * 3] - tf.center.x) * tf.scale;
            normPts[i * 3 + 1] = (rawPts[i * 3 + 1] - tf.center.y) * tf.scale;
            normPts[i * 3 + 2] = (rawPts[i * 3 + 2] - tf.center.z) * tf.scale;
          }

          const geom = new THREE.BufferGeometry();
          geom.setAttribute('position', new THREE.BufferAttribute(normPts, 3));
          geom.setIndex(new THREE.BufferAttribute(new Uint32Array(decoded.indices), 1));
          geom.computeVertexNormals();

          const sliceScalars = decoded.scalars;
          const sMin =
            scalarRange.min !== undefined
              ? scalarRange.min
              : typeof decoded.metadata.min === 'number'
                ? decoded.metadata.min
                : 0;
          const sMax =
            scalarRange.max !== undefined
              ? scalarRange.max
              : typeof decoded.metadata.max === 'number'
                ? decoded.metadata.max
                : 1;
          const span = sMax - sMin;

          let useColors = false;
          if (sliceScalars && sliceScalars.length >= vertexCount) {
            const colors = new Float32Array(vertexCount * 3);
            for (let i = 0; i < vertexCount; i++) {
              const v = sliceScalars[i];
              const t = span > 1e-12 && Number.isFinite(v) ? (v - sMin) / span : 0.5;
              const [r, g, b] = getColorFromColormap(t, colormap);
              colors[i * 3] = r / 255;
              colors[i * 3 + 1] = g / 255;
              colors[i * 3 + 2] = b / 255;
            }
            geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            useColors = true;
          }

          const mat = new THREE.MeshStandardMaterial({
            vertexColors: useColors,
            color: useColors ? 0xffffff : 0x38bdf8,
            roughness: 0.45,
            metalness: 0.1,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1,
          });
          const sliceMesh = new THREE.Mesh(geom, mat);
          sliceMesh.renderOrder = 5;
          volumetricSliceMeshRef.current = sliceMesh;
          sceneRef.current.add(sliceMesh);
        })
        .catch((err) => {
          if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
          clearSliceMesh();
          setVolSliceError(err instanceof Error ? err.message : 'Failed to compute volumetric slice.');
        })
        .finally(() => {
          if (!cancelled) setIsLoadingVolSlice(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    sliceAxis,
    sliceOffset,
    solvedTaskId,
    hasSolvedResults,
    postMetadata?.available,
    activeVolumetricScalarName,
    colormap,
    scalarRange.min,
    scalarRange.max,
    transformRevision,
  ]);

  // Directive 05: True 3D Volumetric RK4 Streamlines (POST /api/jobs/{taskId}/post/streamlines.bin)
  useEffect(() => {
    const group = volumetricStreamlinesGroupRef.current;
    const clearStreamlines = () => {
      if (!group) return;
      while (group.children.length > 0) {
        const ch = group.children[0] as THREE.Line;
        group.remove(ch);
        if (ch.geometry) ch.geometry.dispose();
        if (Array.isArray(ch.material)) ch.material.forEach((m) => m.dispose());
        else if (ch.material) ch.material.dispose();
      }
    };

    if (!showStreamlines || !solvedTaskId || !hasSolvedResults || !hasVolumetricVectors || !group) {
      clearStreamlines();
      setIsLoadingStreamlines(false);
      setStreamlinesError(null);
      setStreamlineCount(0);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setIsLoadingStreamlines(true);
    setStreamlinesError(null);

    const vectorFieldName = postMetadata?.vectors[0]?.name;
    fetchBinaryPostPayload(`/api/jobs/${encodeURIComponent(solvedTaskId)}/post/streamlines.bin`, {
      method: 'POST',
      body: JSON.stringify({
        vector_field: vectorFieldName,
        n_seeds: streamlineSeeds,
      }),
      signal: controller.signal,
    })
      .then((decoded) => {
        if (cancelled || !volumetricStreamlinesGroupRef.current) return;
        clearStreamlines();

        const pts = decoded.points;
        const counts = decoded.line_counts;
        const speeds = decoded.speed_scalars;
        if (!pts || !counts || counts.length === 0) {
          setStreamlinesError('No physical streamlines generated from velocity field.');
          setStreamlineCount(0);
          return;
        }

        const tf = vtkTransformRef.current;
        const sMin = typeof decoded.metadata.min === 'number' ? decoded.metadata.min : 0;
        const sMax = typeof decoded.metadata.max === 'number' ? decoded.metadata.max : 1;
        const span = sMax - sMin;

        let cursor = 0;
        let renderedLines = 0;
        for (let l = 0; l < counts.length; l++) {
          const nPts = counts[l];
          if (nPts < 2 || (cursor + nPts) * 3 > pts.length) {
            cursor += nPts;
            continue;
          }
          const linePos = new Float32Array(nPts * 3);
          const lineCol = new Float32Array(nPts * 3);
          for (let k = 0; k < nPts; k++) {
            const pIdx = cursor + k;
            linePos[k * 3] = (pts[pIdx * 3] - tf.center.x) * tf.scale;
            linePos[k * 3 + 1] = (pts[pIdx * 3 + 1] - tf.center.y) * tf.scale;
            linePos[k * 3 + 2] = (pts[pIdx * 3 + 2] - tf.center.z) * tf.scale;
            const spd = speeds && pIdx < speeds.length ? speeds[pIdx] : 0.5 * (sMin + sMax);
            const t = span > 1e-12 && Number.isFinite(spd) ? (spd - sMin) / span : 0.5;
            const [r, g, b] = getColorFromColormap(t, colormap);
            lineCol[k * 3] = r / 255;
            lineCol[k * 3 + 1] = g / 255;
            lineCol[k * 3 + 2] = b / 255;
          }
          cursor += nPts;

          const lineGeo = new THREE.BufferGeometry();
          lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
          lineGeo.setAttribute('color', new THREE.BufferAttribute(lineCol, 3));
          const lineMat = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.94,
          });
          const lineObj = new THREE.Line(lineGeo, lineMat);
          lineObj.renderOrder = 10;
          volumetricStreamlinesGroupRef.current.add(lineObj);
          renderedLines += 1;
        }
        setStreamlineCount(renderedLines);
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        clearStreamlines();
        setStreamlineCount(0);
        setStreamlinesError(err instanceof Error ? err.message : 'Failed to compute 3D RK4 streamlines.');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingStreamlines(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    showStreamlines,
    streamlineSeeds,
    solvedTaskId,
    hasSolvedResults,
    hasVolumetricVectors,
    postMetadata,
    colormap,
    transformRevision,
  ]);

  // Directive 05: True 3D Volumetric Iso-Surface (POST /api/jobs/{taskId}/post/isosurface.bin)
  useEffect(() => {
    const scene = sceneRef.current;
    const clearIsoMesh = () => {
      if (volumetricIsoMeshRef.current && scene) {
        scene.remove(volumetricIsoMeshRef.current);
        volumetricIsoMeshRef.current.geometry.dispose();
        (volumetricIsoMeshRef.current.material as THREE.Material).dispose();
        volumetricIsoMeshRef.current = null;
      }
    };

    if (
      !showVolumetricIso ||
      !solvedTaskId ||
      !hasSolvedResults ||
      !activeIsoScalarMeta ||
      !scene
    ) {
      clearIsoMesh();
      setIsLoadingVolIso(false);
      setVolIsoError(null);
      setVolIsoTriangles(0);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setIsLoadingVolIso(true);
    setVolIsoError(null);

    const timer = window.setTimeout(() => {
      fetchBinaryPostPayload(`/api/jobs/${encodeURIComponent(solvedTaskId)}/post/isosurface.bin`, {
        method: 'POST',
        body: JSON.stringify({
          field: activeIsoScalarMeta.name,
          iso_value: volumetricIsoValue,
        }),
        signal: controller.signal,
      })
        .then((decoded) => {
          if (cancelled || !sceneRef.current) return;
          if (!decoded.points || decoded.points.length < 9 || !decoded.indices || decoded.indices.length < 3) {
            clearIsoMesh();
            setVolIsoTriangles(0);
            setVolIsoError('Iso-surface produced zero triangles at this threshold.');
            return;
          }

          clearIsoMesh();

          const tf = vtkTransformRef.current;
          const rawPts = decoded.points;
          const vertexCount = rawPts.length / 3;
          const normPts = new Float32Array(rawPts.length);
          for (let i = 0; i < vertexCount; i++) {
            normPts[i * 3] = (rawPts[i * 3] - tf.center.x) * tf.scale;
            normPts[i * 3 + 1] = (rawPts[i * 3 + 1] - tf.center.y) * tf.scale;
            normPts[i * 3 + 2] = (rawPts[i * 3 + 2] - tf.center.z) * tf.scale;
          }

          const geom = new THREE.BufferGeometry();
          geom.setAttribute('position', new THREE.BufferAttribute(normPts, 3));
          geom.setIndex(new THREE.BufferAttribute(new Uint32Array(decoded.indices), 1));
          if (decoded.normals && decoded.normals.length === rawPts.length) {
            const normCopy = new Float32Array(decoded.normals.length);
            normCopy.set(decoded.normals);
            geom.setAttribute('normal', new THREE.BufferAttribute(normCopy, 3));
          } else {
            geom.computeVertexNormals();
          }

          const span = activeIsoScalarMeta.max - activeIsoScalarMeta.min;
          const t = span > 1e-12 ? (volumetricIsoValue - activeIsoScalarMeta.min) / span : 0.5;
          const [r, g, b] = getColorFromColormap(t, colormap);
          const isoColor = new THREE.Color(r / 255, g / 255, b / 255);

          const mat = new THREE.MeshStandardMaterial({
            color: isoColor,
            roughness: 0.28,
            metalness: 0.18,
            side: THREE.DoubleSide,
          });
          const isoMesh = new THREE.Mesh(geom, mat);
          isoMesh.renderOrder = 8;
          volumetricIsoMeshRef.current = isoMesh;
          sceneRef.current.add(isoMesh);
          setVolIsoTriangles(Math.floor(decoded.indices.length / 3));
        })
        .catch((err) => {
          if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
          clearIsoMesh();
          setVolIsoTriangles(0);
          setVolIsoError(err instanceof Error ? err.message : 'Failed to extract 3D iso-surface.');
        })
        .finally(() => {
          if (!cancelled) setIsLoadingVolIso(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    showVolumetricIso,
    volumetricIsoValue,
    activeIsoScalarMeta,
    solvedTaskId,
    hasSolvedResults,
    colormap,
    transformRevision,
  ]);

  // Auto semi-transparent outer domain shell when volumetric streamlines or 3D iso-surface is active
  useEffect(() => {
    const mesh = vtkMeshRef.current;
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const makeTransparent = (showStreamlines && hasVolumetricVectors) || showVolumetricIso;
    mat.transparent = makeTransparent;
    mat.opacity = makeTransparent ? 0.22 : 1.0;
    mat.depthWrite = !makeTransparent;
    mesh.castShadow = !makeTransparent;
    mat.needsUpdate = true;
  }, [showStreamlines, hasVolumetricVectors, showVolumetricIso, transformRevision]);

  // Directive 05: Red 3D checkMesh Bad-Cell Highlighter (strictly real solver bad_cell_points)
  useEffect(() => {
    const group = badCellsGroupRef.current;
    if (!group) return;
    while (group.children.length > 0) {
      const ch = group.children[0] as THREE.Points | THREE.InstancedMesh | THREE.Mesh;
      group.remove(ch);
      if (ch.geometry) ch.geometry.dispose();
      if (Array.isArray(ch.material)) ch.material.forEach((m) => m.dispose());
      else if (ch.material) ch.material.dispose();
    }

    if (!showBadCells || badCellPoints.length === 0) return;

    const tf = vtkTransformRef.current;
    const count = badCellPoints.length;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const p = badCellPoints[i];
      pos[i * 3] = ((p[0] ?? 0) - tf.center.x) * tf.scale;
      pos[i * 3 + 1] = ((p[1] ?? 0) - tf.center.y) * tf.scale;
      pos[i * 3 + 2] = ((p[2] ?? 0) - tf.center.z) * tf.scale;
    }

    // Crisp glowing crimson point cloud
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ptMat = new THREE.PointsMaterial({
      color: 0xff2a55,
      size: 0.16,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    const ptCloud = new THREE.Points(ptGeo, ptMat);
    ptCloud.renderOrder = 30;
    group.add(ptCloud);

    // Instanced red spheres (up to 400 markers) so individual bad cells stand out cleanly in 3D space
    const sphereLimit = Math.min(count, 400);
    const sphereStep = Math.max(1, Math.floor(count / sphereLimit));
    const sampledIndices: number[] = [];
    for (let i = 0; i < count && sampledIndices.length < sphereLimit; i += sphereStep) {
      sampledIndices.push(i);
    }
    const sphereGeo = new THREE.SphereGeometry(0.055, 10, 10);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.82,
      depthTest: false,
    });
    const inst = new THREE.InstancedMesh(sphereGeo, sphereMat, sampledIndices.length);
    const dummy = new THREE.Object3D();
    for (let idx = 0; idx < sampledIndices.length; idx++) {
      const k = sampledIndices[idx];
      dummy.position.set(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
      dummy.updateMatrix();
      inst.setMatrixAt(idx, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    inst.renderOrder = 29;
    group.add(inst);
  }, [showBadCells, badCellPoints, transformRevision]);

  // Sync wireframe toggle without rebuilding CAD STL
  useEffect(() => {
    if (customMeshRef.current) {
      (customMeshRef.current.material as THREE.MeshStandardMaterial).wireframe = showWireframe;
    }
    if (vtkMeshRef.current) {
      (vtkMeshRef.current.material as THREE.MeshStandardMaterial).wireframe = showWireframe;
    }
  }, [showWireframe]);

  // Render interactive 3D Sub-Domain Selection Box (Region Box)
  useEffect(() => {
    const group = regionBoxGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      group.remove(group.children[0]);
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
      prev.map((m) => (m.id === id ? { ...m, [fieldKey]: val } : m)),
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

  // Render 3D Ruler Pins, Connecting Distance Segment & Cartesian Component Guides
  useEffect(() => {
    const group = measureGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      const child = group.children[0] as THREE.Mesh | THREE.Line;
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else if (child.material) {
        child.material.dispose();
      }
    }

    const p1Scene = measureP1?.scenePoint;
    if (!p1Scene) return;

    const v1 = new THREE.Vector3(p1Scene[0], p1Scene[1], p1Scene[2]);
    const pinGeo1 = new THREE.SphereGeometry(0.065, 16, 16);
    const pinMat1 = new THREE.MeshBasicMaterial({ color: 0x10b981, depthTest: false });
    const pin1 = new THREE.Mesh(pinGeo1, pinMat1);
    pin1.position.copy(v1);
    pin1.renderOrder = 25;
    group.add(pin1);

    const endPt = measureP2 || measureHover;
    const p2Scene = endPt?.scenePoint;
    if (!p2Scene) return;

    const v2 = new THREE.Vector3(p2Scene[0], p2Scene[1], p2Scene[2]);
    const isLocked = Boolean(measureP2);

    const pinGeo2 = new THREE.SphereGeometry(isLocked ? 0.065 : 0.05, 16, 16);
    const pinMat2 = new THREE.MeshBasicMaterial({ color: isLocked ? 0xf59e0b : 0x38bdf8, depthTest: false });
    const pin2 = new THREE.Mesh(pinGeo2, pinMat2);
    pin2.position.copy(v2);
    pin2.renderOrder = 25;
    group.add(pin2);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([v1, v2]);
    const lineMat = new THREE.LineBasicMaterial({
      color: isLocked ? 0x38bdf8 : 0x7dd3fc,
      depthTest: false,
      transparent: !isLocked,
      opacity: isLocked ? 1.0 : 0.8,
    });
    const mainLine = new THREE.Line(lineGeo, lineMat);
    mainLine.renderOrder = 24;
    group.add(mainLine);

    if (isLocked) {
      // Subtle X (red), Y (green), Z (blue) orthogonal component legs
      const vxEnd = new THREE.Vector3(v2.x, v1.y, v1.z);
      const vyEnd = new THREE.Vector3(v2.x, v2.y, v1.z);

      const addLeg = (a: THREE.Vector3, b: THREE.Vector3, hex: number) => {
        if (a.distanceTo(b) < 1e-4) return;
        const g = new THREE.BufferGeometry().setFromPoints([a, b]);
        const m = new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: 0.55, depthTest: false });
        const seg = new THREE.Line(g, m);
        seg.renderOrder = 23;
        group.add(seg);
      };
      addLeg(v1, vxEnd, 0xf87171);
      addLeg(vxEnd, vyEnd, 0x4ade80);
      addLeg(vyEnd, v2, 0x60a5fa);
    }
  }, [measureP1, measureP2, measureHover]);

  // Clear active ruler points when switching models so stale coordinates never linger
  useEffect(() => {
    setMeasureP1(null);
    setMeasureP2(null);
    setMeasureHover(null);
  }, [effectiveVtkData]);

  const clearMeasurement = () => {
    setMeasureP1(null);
    setMeasureP2(null);
    setMeasureHover(null);
  };

  const copyMeasurementSummary = () => {
    if (!activeMeasurement) return;
    const lines = [
      `Distance ΔL = ${activeMeasurement.distanceM.toFixed(6)} m (${activeMeasurement.distanceMm.toFixed(3)} mm)`,
      `ΔX = ${activeMeasurement.dx.toFixed(6)} m, ΔY = ${activeMeasurement.dy.toFixed(6)} m, ΔZ = ${activeMeasurement.dz.toFixed(6)} m`,
      `P1 = (${activeMeasurement.p1.x.toFixed(5)}, ${activeMeasurement.p1.y.toFixed(5)}, ${activeMeasurement.p1.z.toFixed(5)}) m`,
      `P2 = (${activeMeasurement.p2.x.toFixed(5)}, ${activeMeasurement.p2.y.toFixed(5)}, ${activeMeasurement.p2.z.toFixed(5)}) m`,
      `Suggested Mesh Cell Size (L/15..L/10): ${activeMeasurement.meshHintFineM.toFixed(5)} m – ${activeMeasurement.meshHintCoarseM.toFixed(5)} m`,
    ];
    if (activeMeasurement.scalarDelta !== undefined) {
      lines.push(
        `Δ${activeMeasurement.scalarLabel || 'φ'} = ${activeMeasurement.scalarDelta.toPrecision(5)} ${activeMeasurement.scalarUnit || ''}` +
          (activeMeasurement.scalarSlope !== undefined
            ? ` | Slope = ${activeMeasurement.scalarSlope.toPrecision(5)} ${activeMeasurement.slopeUnit || ''}`
            : ''),
      );
    }
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedMeasure(true);
    setTimeout(() => setCopiedMeasure(false), 1800);
  };

  const showLegend =
    isShowingSolvedVtk &&
    (hasSolvedResults || availableScalars.length > 0) &&
    scalarRange.min !== undefined &&
    scalarRange.max !== undefined;

  const hasVectors = Boolean(effectiveVtkData?.vectors && Object.keys(effectiveVtkData.vectors).length > 0);
  const hasDisplacementVector = Boolean(effectiveVtkData?.vectors?.displacement && effectiveVtkData.vectors.displacement.length > 0);
  const integralEntries = integrals ? Object.entries(integrals) : [];

  const handleExport3DPng = async () => {
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!renderer || !scene || !camera || isExportingPng) return;

    setIsExportingPng(true);
    try {
      // Render synchronously right before reading the WebGL drawing buffer (never blank)
      renderer.render(scene, camera);
      const displayFieldName =
        scalarRange.displayKey ||
        fieldLabel ||
        (isFEA ? 'Von Mises Stress' : isThermal ? 'Temperature' : 'Velocity Magnitude');
      const modeTag = scalarRange.isGradient
        ? '3D Surface Gradient Magnitude'
        : isShowingSolvedVtk
          ? '3D Solved VTK Contour'
          : meshPreviewVtk
            ? '3D Mesh Surface Preview'
            : '3D CAD Viewport';
      const safeName = displayFieldName.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'viewport';
      const filename = `naseer_${safeName}_${scalarRange.isGradient ? '3d_gradient' : '3d_view'}.png`;

      await exportWebGLSnapshotPng({
        webglCanvas: renderer.domElement,
        title: `${displayFieldName} — ${modeTag}`,
        subtitle: `Field: ${field} · Colormap: ${colormap.toUpperCase()}${
          effectiveVtkData ? ` · Nodes: ${Math.floor(effectiveVtkData.points.length / 3).toLocaleString()} · Triangles: ${Math.floor(effectiveVtkData.triangles.length / 3).toLocaleString()}` : ''
        }`,
        filename,
        legend: showLegend
          ? {
              label: displayFieldName,
              min: scalarRange.min!,
              max: scalarRange.max!,
              unit: scalarRange.unit,
              sampleColor: (t: number) => getColorFromColormap(t, colormap),
            }
          : undefined,
      });
    } catch (err) {
      console.error('Failed to export 3D PNG snapshot:', err);
    } finally {
      setIsExportingPng(false);
    }
  };

  return (
    <div className="relative h-full w-full select-none overflow-hidden bg-[#070b16]">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".stl,.step,.stp,.iges,.igs,.inp,.msh"
        className="hidden"
      />

      <div ref={containerRef} className="absolute inset-0 h-full w-full cursor-crosshair" />

      {/* Top Engineering CAD & Boundary Toolbar */}
      <div className="absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-slate-700/90 bg-slate-900/95 p-1 shadow-2xl max-w-[96%] overflow-x-auto">
        <button
          title="Import CAD or Mesh (.stl, .step, .iges, .inp, .msh)"
          disabled={cadLoading}
          onClick={() => fileInputRef.current?.click()}
          className="flex h-7 shrink-0 items-center gap-1.5 px-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors shadow-sm disabled:opacity-60"
        >
          {cadLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          <span>{cadLoading ? 'Tessellating…' : 'Import CAD'}</span>
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
          title="Point Probe (Read exact coordinate & field scalar on 3D mesh)"
          onClick={() => setActiveTool(activeTool === 'probe' ? 'orbit' : 'probe')}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
            activeTool === 'probe' ? 'bg-amber-500/25 text-amber-300 ring-1 ring-amber-500/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <MousePointer2 className="h-3.5 w-3.5" />
        </button>

        <button
          type="button"
          title="3D Ruler / Measurement Tool (Click 2 points on geometry to measure exact distance ΔL, ΔX/ΔY/ΔZ & Δφ)"
          onClick={() => {
            if (activeTool === 'measure') {
              setActiveTool('orbit');
              setMeasureHover(null);
            } else {
              setActiveTool('measure');
              setProbeData(null);
            }
          }}
          className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTool === 'measure' || measureP1 !== null
              ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/60'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Ruler className="h-3.5 w-3.5" />
          <span>Ruler</span>
        </button>

        <span className="mx-1 h-4 w-px shrink-0 bg-slate-700/80" />

        <button
          title="Assign Inlet Boundary (Click on Surface)"
          onClick={() => setActiveTool(activeTool === 'tag_inlet' ? 'orbit' : 'tag_inlet')}
          className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTool === 'tag_inlet' ? 'bg-sky-500 text-white shadow-sm' : 'text-sky-400 hover:bg-sky-500/20'
          }`}
        >
          <Crosshair className="h-3 w-3" />
          <span>+ Inlet</span>
        </button>

        <button
          title="Assign Outlet Boundary (Click on Surface)"
          onClick={() => setActiveTool(activeTool === 'tag_outlet' ? 'orbit' : 'tag_outlet')}
          className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            activeTool === 'tag_outlet' ? 'bg-rose-500 text-white shadow-sm' : 'text-rose-400 hover:bg-rose-500/20'
          }`}
        >
          <Crosshair className="h-3 w-3" />
          <span>+ Outlet</span>
        </button>

        <button
          title={isFEA ? 'Assign Structural Force Load (Click on Surface)' : 'Assign Heated Wall / Thermal Load'}
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

        <button
          title="Isolate Sub-Domain / Critical Region"
          onClick={() => setRegionBox((prev) => ({ ...prev, enabled: !prev.enabled }))}
          className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            regionBox.enabled ? 'bg-cyan-500/25 text-cyan-300 ring-1 ring-cyan-500/60' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <BoxSelect className="h-3.5 w-3.5 text-cyan-400" />
          <span>Region Box</span>
        </button>

        <button
          title="Section Slice Plane (X / Y / Z)"
          onClick={() => setShowPostControls((v) => !v)}
          className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
            showPostControls || sliceAxis !== 'off' ? 'bg-indigo-500/25 text-indigo-300 ring-1 ring-indigo-500/60' : 'text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Scissors className="h-3.5 w-3.5" />
          <span>Slice / Post</span>
        </button>

        {integralEntries.length > 0 && (
          <button
            title="Toggle Surface & Field Integrals HUD"
            onClick={() => setShowIntegralsHud((v) => !v)}
            className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
              showIntegralsHud ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/60' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <Sigma className="h-3.5 w-3.5" />
            <span>Integrals</span>
          </button>
        )}

        {availableScalars.length > 0 && (
          <button
            title="Plot Over Line (Sample real solved VTK nodal profile along X / Y / Z)"
            onClick={() => setShowLinePlot((v) => !v)}
            className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
              showLinePlot ? 'bg-sky-500/25 text-sky-300 ring-1 ring-sky-500/60' : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            <LineChart className="h-3.5 w-3.5" />
            <span>Line Profile</span>
          </button>
        )}

        <button
          title="Toggle Mesh Wireframe"
          onClick={() => setShowWireframe(!showWireframe)}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
            showWireframe ? 'bg-sky-500/25 text-sky-300 ring-1 ring-sky-500/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Grid3X3 className="h-3.5 w-3.5" />
        </button>

        {(isCFD || hasVectors || hasVolumetricVectors) && (
          <button
            title={
              hasVolumetricVectors
                ? 'Toggle 3D Volumetric RK4 Streamlines (Real PyVista/VTK integration)'
                : 'Toggle 3D Velocity Vector Arrows'
            }
            onClick={() => setShowStreamlines(!showStreamlines)}
            className={`flex h-7 shrink-0 items-center justify-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
              showStreamlines ? 'bg-emerald-500/25 text-emerald-300 ring-1 ring-emerald-500/50' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
            }`}
          >
            {isLoadingStreamlines ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wind className="h-3.5 w-3.5" />}
            {hasVolumetricVectors && <span className="text-[10.5px]">Streamlines</span>}
          </button>
        )}

        {badCellPoints.length > 0 && (
          <button
            type="button"
            title="Highlight Real OpenFOAM checkMesh Non-Orthogonal / Skewed Bad Cells in 3D"
            onClick={() => setShowBadCells((v) => !v)}
            className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg text-xs font-semibold transition-colors ${
              showBadCells
                ? 'bg-rose-600 text-white ring-1 ring-rose-400 shadow-sm'
                : 'bg-rose-950/70 border border-rose-500/50 text-rose-300 hover:bg-rose-900/70'
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>Bad Cells ({badCellPoints.length})</span>
          </button>
        )}

        {availableScalars.length > 0 && (
          <>
            <select
              aria-label="VTK Scalar Field"
              value={scalarRange.key}
              onChange={(e) => setSelectedScalarKey(e.target.value)}
              className="h-7 shrink-0 rounded-lg border border-slate-700 bg-slate-950 px-2 font-mono text-[11px] text-sky-300 outline-none focus:border-sky-500"
            >
              {availableScalars.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>

            <button
              type="button"
              title="Toggle 3D Surface Gradient Magnitude |∇φ| computed directly on solved VTK triangles (Zero-Mock)"
              onClick={() => setShowSurfaceGradient((v) => !v)}
              className={`flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg font-mono text-[11px] font-semibold transition-colors ${
                showSurfaceGradient
                  ? 'bg-amber-500/25 text-amber-300 ring-1 ring-amber-500/60'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span>|∇{scalarRange.key || 'φ'}|</span>
            </button>
          </>
        )}

        <button
          type="button"
          disabled={isExportingPng}
          title="Export High-Resolution 3D PNG Snapshot (2400×1500) with Calibrated Colorbar Legend"
          onClick={handleExport3DPng}
          className="flex h-7 shrink-0 items-center gap-1 px-2 rounded-lg bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 text-[11px] font-semibold transition-colors disabled:opacity-60"
        >
          {isExportingPng ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
          <span>PNG</span>
        </button>

        <button
          title="Reset Camera (Fit to Screen)"
          onClick={() => applyPreset('iso')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Volumetric Operation Live Status Badges (Zero-Mock) */}
      {(isLoadingVolSlice || isLoadingStreamlines || isLoadingVolIso || isLoadingBinarySurface) && (
        <div className="pointer-events-none absolute left-1/2 top-14 z-20 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-sky-500/40 bg-slate-950/95 px-3 py-1.5 font-mono text-[11px] text-sky-200 shadow-xl">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
          <span>
            {isLoadingVolSlice
              ? 'Computing volumetric slice…'
              : isLoadingStreamlines
                ? `Integrating 3D RK4 streamlines (${streamlineSeeds} seeds)…`
                : isLoadingVolIso
                  ? 'Extracting 3D iso-surface…'
                  : 'Streaming full-resolution binary surface…'}
          </span>
        </div>
      )}

      {/* checkMesh Bad-Cell Quality HUD Badge */}
      {showBadCells && badCellPoints.length > 0 && (
        <div className="absolute left-1/2 top-14 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-rose-500/60 bg-rose-950/95 px-3 py-1.5 font-mono text-[10.5px] text-rose-100 shadow-2xl">
          <span className="flex items-center gap-1.5 font-bold text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
            checkMesh Bad Cells: {badCellPoints.length.toLocaleString()}
          </span>
          <span className="text-rose-500/70">|</span>
          <span>
            Max Non-Ortho:{' '}
            <strong className="text-white">
              {typeof meshQuality?.max_non_orthogonality === 'number'
                ? `${meshQuality.max_non_orthogonality.toFixed(2)}°`
                : 'N/A'}
            </strong>
          </span>
          <span className="text-rose-500/70">|</span>
          <span>
            Max Skewness:{' '}
            <strong className="text-white">
              {typeof meshQuality?.max_skewness === 'number'
                ? meshQuality.max_skewness.toFixed(3)
                : 'N/A'}
            </strong>
          </span>
          {meshQuality?.verdict && (
            <>
              <span className="text-rose-500/70">|</span>
              <span className="uppercase font-bold text-rose-200">{meshQuality.verdict}</span>
            </>
          )}
        </div>
      )}

      {/* Post-Processing Dock: Section Slice Planes, 3D Volumetric Iso-Surface, RK4 Streamlines, Iso-Threshold, Deformation Scale */}
      {showPostControls && (
        <div className="absolute right-4 top-24 z-20 w-72 max-h-[70vh] overflow-y-auto rounded-xl border border-indigo-500/40 bg-slate-950/95 p-3 shadow-2xl text-xs space-y-2.5">
          <div className="flex items-center justify-between font-semibold text-indigo-300">
            <span className="flex items-center gap-1.5">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              3D Post-Processing Tools
            </span>
            <button
              onClick={() => {
                setSliceAxis('off');
                setSliceOffset(0);
                setIsoMinPct(0);
                setIsoMaxPct(100);
                setDeformationScale(10);
                setShowVolumetricIso(false);
                setShowStreamlines(false);
              }}
              className="text-[10px] font-mono text-slate-400 hover:text-white"
            >
              Reset
            </button>
          </div>

          {postMetadata?.available ? (
            <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-950/25 px-2 py-1 font-mono text-[9.5px] text-emerald-300">
              <span>Volumetric NSR1 Ready ({(postMetadata.cell_count ?? 0).toLocaleString()} cells)</span>
              <button
                type="button"
                onClick={() => setUseBinarySurface((v) => !v)}
                className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                  useBinarySurface
                    ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/50'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
                title="Toggle Full-Resolution Binary NSR1 Surface vs JSON Surface"
              >
                {useBinarySurface ? 'HD BIN' : 'JSON'}
              </button>
            </div>
          ) : volumetricStatus ? (
            <div className="rounded-lg border border-slate-700/80 bg-slate-900/90 px-2 py-1.5 text-[10px] leading-snug text-slate-400">
              {volumetricStatus}
            </div>
          ) : null}

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10.5px] text-slate-400">
              <span>{postMetadata?.available ? 'Filled Volumetric Slice Plane' : 'Section Slice Plane'}</span>
              <span className="font-mono text-indigo-300">{sliceAxis.toUpperCase()}</span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {(['off', 'x', 'y', 'z'] as const).map((ax) => (
                <button
                  key={ax}
                  onClick={() => setSliceAxis(ax)}
                  className={`rounded py-1 font-mono text-[10px] font-semibold uppercase border transition-colors ${
                    sliceAxis === ax
                      ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                      : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  {ax}
                </button>
              ))}
            </div>
            {sliceAxis !== 'off' && (
              <>
                <input
                  type="range"
                  min={-0.98}
                  max={0.98}
                  step={0.04}
                  value={sliceOffset}
                  onChange={(e) => setSliceOffset(parseFloat(e.target.value))}
                  className="w-full accent-indigo-400 cursor-pointer"
                />
                {volSliceError && (
                  <div className="font-mono text-[9.5px] text-amber-300">{volSliceError}</div>
                )}
              </>
            )}
          </div>

          {hasVolumetricVectors && (
            <div className="space-y-1.5 pt-1.5 border-t border-slate-800">
              <div className="flex items-center justify-between text-[10.5px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Wind className="h-3 w-3 text-emerald-400" />
                  3D RK4 Streamlines
                </span>
                <button
                  type="button"
                  onClick={() => setShowStreamlines((v) => !v)}
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold border ${
                    showStreamlines
                      ? 'border-emerald-400 bg-emerald-500/25 text-emerald-200'
                      : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  {showStreamlines ? 'ON' : 'OFF'}
                </button>
              </div>
              <div className="flex items-center justify-between gap-1 text-[10px] text-slate-400">
                <span>Seed Count</span>
                <div className="flex items-center gap-1">
                  {([24, 48, 96] as const).map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setStreamlineSeeds(n)}
                      className={`rounded px-2 py-0.5 font-mono text-[10px] border ${
                        streamlineSeeds === n
                          ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200 font-bold'
                          : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              {showStreamlines && streamlineCount > 0 && (
                <div className="font-mono text-[9.5px] text-emerald-300">
                  Active trajectories: {streamlineCount} ({postMetadata?.vectors[0]?.name})
                </div>
              )}
              {streamlinesError && (
                <div className="font-mono text-[9.5px] text-amber-300">{streamlinesError}</div>
              )}
            </div>
          )}

          {hasVolumetricScalars && activeIsoScalarMeta && (
            <div className="space-y-1.5 pt-1.5 border-t border-slate-800">
              <div className="flex items-center justify-between text-[10.5px] text-slate-400">
                <span className="flex items-center gap-1">
                  <Layers className="h-3 w-3 text-cyan-400" />
                  3D Iso-Surface
                </span>
                <button
                  type="button"
                  onClick={() => setShowVolumetricIso((v) => !v)}
                  className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold border ${
                    showVolumetricIso
                      ? 'border-cyan-400 bg-cyan-500/25 text-cyan-200'
                      : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-white'
                  }`}
                >
                  {showVolumetricIso ? 'ON' : 'OFF'}
                </button>
              </div>
              {showVolumetricIso && (
                <div className="space-y-1.5">
                  <select
                    aria-label="Iso-Surface Scalar Field"
                    value={activeIsoScalarMeta.name}
                    onChange={(e) => {
                      const next = postMetadata?.scalars.find((s) => s.name === e.target.value);
                      if (next) {
                        setVolumetricIsoField(next.name);
                        setVolumetricIsoValue(0.5 * (next.min + next.max));
                      }
                    }}
                    className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[10px] text-cyan-200 outline-none"
                  >
                    {postMetadata?.scalars.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name} [{s.min.toPrecision(4)} .. {s.max.toPrecision(4)}]
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center justify-between font-mono text-[10px] text-cyan-300 tabular-nums">
                    <span>Iso Value</span>
                    <strong>{volumetricIsoValue.toPrecision(5)}</strong>
                  </div>
                  <input
                    aria-label="3D Iso-Surface Physical Threshold"
                    type="range"
                    min={activeIsoScalarMeta.min}
                    max={
                      activeIsoScalarMeta.max > activeIsoScalarMeta.min
                        ? activeIsoScalarMeta.max
                        : activeIsoScalarMeta.min + 1e-6
                    }
                    step={
                      activeIsoScalarMeta.max > activeIsoScalarMeta.min
                        ? (activeIsoScalarMeta.max - activeIsoScalarMeta.min) / 100
                        : 1e-6
                    }
                    value={volumetricIsoValue}
                    onChange={(e) => setVolumetricIsoValue(parseFloat(e.target.value))}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                  {volIsoTriangles > 0 && (
                    <div className="font-mono text-[9.5px] text-cyan-300/90">
                      Contour triangles: {volIsoTriangles.toLocaleString()}
                    </div>
                  )}
                  {volIsoError && (
                    <div className="font-mono text-[9.5px] text-amber-300">{volIsoError}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {availableScalars.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-slate-800">
              <div className="flex items-center justify-between text-[10.5px] text-slate-400">
                <span>Iso-Threshold Filter</span>
                <span className="font-mono text-sky-300 tabular-nums">{isoMinPct}% – {isoMaxPct}%</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input
                  aria-label="Iso minimum percentage"
                  type="range"
                  min={0}
                  max={95}
                  step={5}
                  value={isoMinPct}
                  onChange={(e) => setIsoMinPct(Math.min(Number(e.target.value), isoMaxPct - 5))}
                  className="accent-sky-400 cursor-pointer"
                />
                <input
                  aria-label="Iso maximum percentage"
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={isoMaxPct}
                  onChange={(e) => setIsoMaxPct(Math.max(Number(e.target.value), isoMinPct + 5))}
                  className="accent-sky-400 cursor-pointer"
                />
              </div>
            </div>
          )}

          {hasDisplacementVector && (
            <div className="space-y-1 pt-1 border-t border-slate-800">
              <div className="flex items-center justify-between text-[10.5px] text-slate-400">
                <span>Deformation Scale</span>
                <span className="font-mono text-amber-300 tabular-nums">{deformationScale}x</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={deformationScale}
                onChange={(e) => setDeformationScale(Number(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer"
              />
            </div>
          )}
        </div>
      )}

      {/* Surface & Field Integrals Floating HUD */}
      {showIntegralsHud && integralEntries.length > 0 && (
        <div className="absolute right-4 bottom-48 z-20 w-72 rounded-xl border border-emerald-500/40 bg-slate-950/95 p-3 shadow-2xl text-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-2">
            <span className="font-bold text-emerald-300 flex items-center gap-1.5">
              <Sigma className="h-3.5 w-3.5" />
              Solver Field & Surface Integrals
            </span>
          </div>
          <div className="max-h-44 overflow-y-auto space-y-1 font-mono text-[10.5px] tabular-nums">
            {integralEntries.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-2 text-slate-300">
                <span className="truncate text-slate-400">{k.replace(/_/g, ' ')}</span>
                <span className="text-emerald-200 font-semibold">
                  {typeof v === 'number'
                    ? (Math.abs(v) > 1e4 || (Math.abs(v) > 0 && Math.abs(v) < 1e-3) ? v.toExponential(3) : v.toLocaleString(undefined, { maximumFractionDigits: 4 }))
                    : String(v)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-Domain Region Box Controller */}
      {regionBox.enabled && (
        <div className="absolute left-4 top-14 z-20 w-64 rounded-xl border border-cyan-500/40 bg-slate-950/95 p-3 shadow-2xl text-xs">
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
            Isolate a sub-domain zone for OpenFOAM topoSet local heat flux or refinement:
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

      {/* Assigned Boundary Conditions Interactive Card */}
      {(cadStats || boundaryMarkers.length > 0) && (
        <div className="absolute left-4 bottom-8 z-20 flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/95 p-3 shadow-2xl max-w-xs">
          {cadStats && (
            <div>
              <div className="flex items-center gap-2 text-xs font-bold text-sky-300">
                <Info className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                <span className="truncate">{cadStats.name}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-slate-300 mt-1 tabular-nums">
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
                    <div className="text-slate-400 mt-0.5 flex items-center justify-between gap-1.5">
                      <span>
                        {m.value} {m.unit}
                        {m.secondaryUnit ? ` · ${m.secondaryValue} ${m.secondaryUnit}` : ''}
                      </span>
                      {m.patchName && (
                        <span className="rounded bg-cyan-950/90 border border-cyan-500/40 px-1 py-0.2 text-[9px] text-cyan-300">
                          {m.patchName}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3D Plot Over Line (Real VTK Nodal XY Profile) */}
      {showLinePlot && availableScalars.length > 0 && (
        <div className="absolute bottom-8 left-4 z-20 w-[340px] rounded-xl border border-sky-500/40 bg-slate-950/95 p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-300">
              <LineChart className="h-3.5 w-3.5" />
              <span>Plot Over Line · {scalarRange.displayKey || scalarRange.key}</span>
            </div>
            <div className="flex items-center gap-1">
              {(['x', 'y', 'z'] as const).map((ax) => (
                <button
                  key={ax}
                  type="button"
                  onClick={() => setLinePlotAxis(ax)}
                  className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${
                    linePlotAxis === ax ? 'bg-sky-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400 hover:text-white'
                  }`}
                >
                  {ax}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-2 flex items-center gap-2 text-[10px] font-mono text-slate-400">
            <span>Cross-Section:</span>
            <input
              type="range"
              min={5}
              max={95}
              value={linePlotSlicePct}
              onChange={(e) => setLinePlotSlicePct(Number(e.target.value))}
              className="flex-1 accent-sky-400"
            />
            <span className="w-8 text-right text-sky-300">{linePlotSlicePct}%</span>
          </div>

          {lineProfileData.length >= 2 ? (() => {
            const xs = lineProfileData.map((d) => d.coord);
            const ys = lineProfileData.map((d) => d.value);
            const minX = Math.min(...xs);
            const maxX = Math.max(...xs);
            const minY = Math.min(...ys);
            const maxY = Math.max(...ys);
            const spanX = maxX - minX || 1;
            const spanY = maxY - minY || 1;
            const poly = lineProfileData
              .map((d) => `${((d.coord - minX) / spanX) * 100},${(1 - (d.value - minY) / spanY) * 100}`)
              .join(' ');
            return (
              <div className="space-y-1">
                <div className="relative h-28 w-full pl-12 pb-4">
                  <span className="absolute left-0 top-0 font-mono text-[9px] text-slate-400">{maxY.toPrecision(4)}</span>
                  <span className="absolute bottom-4 left-0 font-mono text-[9px] text-slate-400">{minY.toPrecision(4)}</span>
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full border-b border-l border-slate-700 bg-slate-900/60">
                    <line x1="0" x2="100" y1="50" y2="50" stroke="#334155" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
                    <polyline points={poly} fill="none" stroke="#38bdf8" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
                  </svg>
                  <div className="mt-0.5 flex justify-between font-mono text-[9px] text-slate-500">
                    <span>{linePlotAxis.toUpperCase()} = {minX.toPrecision(3)} m</span>
                    <span>{scalarRange.unit || 'SI'} ({lineProfileData.length} pts)</span>
                    <span>{maxX.toPrecision(3)} m</span>
                  </div>
                </div>
              </div>
            );
          })() : (
            <div className="py-6 text-center font-mono text-[10px] text-slate-500">
              No nodal samples along {linePlotAxis.toUpperCase()} at {linePlotSlicePct}% — adjust axis or cross-section slider.
            </div>
          )}
        </div>
      )}

      {/* Transient Time-Step Playback Scrubber HUD */}
      {timeFrames.length > 1 && (
        <div className="absolute bottom-8 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2.5 rounded-xl border border-sky-500/40 bg-slate-950/95 px-3 py-1.5 shadow-2xl text-xs">
          <button
            type="button"
            title={isPlaying ? 'Pause Transient Playback' : 'Play Transient Time Steps'}
            onClick={() => setIsPlaying((p) => !p)}
            className="flex h-6 w-6 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30"
          >
            {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
          </button>
          <button
            type="button"
            title="Reset to Initial Time Step"
            onClick={() => {
              setIsPlaying(false);
              setFrameIndex(0);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <input
            aria-label="Transient Time Step Scrubber"
            type="range"
            min={0}
            max={timeFrames.length - 1}
            step={1}
            value={Math.min(frameIndex, timeFrames.length - 1)}
            onChange={(e) => {
              setIsPlaying(false);
              setFrameIndex(Number(e.target.value));
            }}
            className="w-36 accent-sky-400 cursor-pointer"
          />
          <div className="font-mono text-[10.5px] text-slate-200 tabular-nums whitespace-nowrap">
            t = <strong className="text-sky-300">{Number(timeFrames[Math.min(frameIndex, timeFrames.length - 1)]?.time ?? 0).toPrecision(4)}</strong> s
            <span className="ml-1.5 text-slate-500">
              ({Math.min(frameIndex + 1, timeFrames.length)}/{timeFrames.length})
            </span>
          </div>
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
              className="absolute inset-0 flex items-center justify-center border border-slate-600/70 bg-slate-900/95 text-[8px] font-bold tracking-wider text-slate-300 shadow-md transition-all hover:bg-sky-500/40 hover:text-white"
              style={{ transform: face.transform, backfaceVisibility: 'hidden' }}
            >
              {face.label}
            </button>
          ))}
        </div>
      </div>

      {/* Render Colormap Legend ONLY when real solved VTK / field results exist */}
      {showLegend && (
        <div className="absolute bottom-8 right-4 z-20 flex flex-col items-end gap-1.5 rounded-xl border border-slate-800 bg-slate-950/95 p-3 shadow-2xl">
          <div className="text-[11px] font-semibold text-slate-200">
            {scalarRange.displayKey || fieldLabel || (isFEA ? 'Von Mises Stress' : isThermal ? 'Static Temperature' : 'Velocity Magnitude')}
          </div>
          {scalarRange.isGradient && (
            <div className="font-mono text-[9.5px] text-amber-300">
              Surface Gradient (P1 FEM)
            </div>
          )}
          <div className="flex items-center gap-2">
            <div
              className="h-28 w-3 rounded-md border border-slate-700/80"
              style={{
                background:
                  colormap === 'viridis'
                    ? 'linear-gradient(to bottom, #fde725, #5ec962, #21918c, #3b528b, #440154)'
                    : colormap === 'coolwarm'
                      ? 'linear-gradient(to bottom, #b40426, #dddddd, #3b4cc0)'
                      : 'linear-gradient(to bottom, #7a0403, #fb9b26, #a4fc3c, #1be5b5, #4686fb, #30123b)',
              }}
            />
            <div className="flex h-28 flex-col justify-between font-mono text-[9.5px] text-slate-300 tabular-nums">
              <span>{Number(scalarRange.max!).toPrecision(5)} {scalarRange.unit}</span>
              <span>{Number(scalarRange.min! + (scalarRange.max! - scalarRange.min!) * 0.75).toPrecision(4)} {scalarRange.unit}</span>
              <span>{Number(scalarRange.min! + (scalarRange.max! - scalarRange.min!) * 0.5).toPrecision(4)} {scalarRange.unit}</span>
              <span>{Number(scalarRange.min! + (scalarRange.max! - scalarRange.min!) * 0.25).toPrecision(4)} {scalarRange.unit}</span>
              <span>{Number(scalarRange.min!).toPrecision(5)} {scalarRange.unit}</span>
            </div>
          </div>
          <select
            aria-label="Colormap"
            value={colormap}
            onChange={(e) => setColormap(e.target.value as ColormapType)}
            className="mt-0.5 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[9.5px] text-slate-300 outline-none"
          >
            <option value="turbo">Turbo</option>
            <option value="jet">Jet</option>
            <option value="viridis">Viridis</option>
            <option value="coolwarm">Coolwarm</option>
          </select>
        </div>
      )}

      {probeData && (
        <div
          className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full rounded-lg border border-amber-500/60 bg-slate-900/95 px-3 py-2 text-xs shadow-2xl"
          style={{ left: probeData.screenX, top: probeData.screenY - 12 }}
        >
          <div className="flex items-center gap-1.5 font-bold text-amber-300">
            <Activity className="h-3.5 w-3.5 text-amber-400" />
            <span>
              {probeData.label}
              {probeData.scalarValue !== undefined ? `: ${probeData.scalarValue} ${probeData.scalarUnit || ''}` : ''}
            </span>
          </div>
          <div className="mt-0.5 font-mono text-[10px] text-slate-200 tabular-nums">
            X: {probeData.x} m · Y: {probeData.y} m · Z: {probeData.z} m
          </div>
        </div>
      )}

      {/* Interactive 3D Ruler & Model Dimensions HUD Card */}
      {(activeTool === 'measure' || measureP1 !== null) && (
        <div
          className={`absolute left-4 z-20 w-76 rounded-xl border border-emerald-500/40 bg-slate-950/95 p-3 shadow-2xl text-xs ${
            regionBox.enabled ? 'top-[290px]' : 'top-14'
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 mb-2">
            <span className="font-bold text-emerald-300 flex items-center gap-1.5">
              <Ruler className="h-3.5 w-3.5" />
              3D Ruler & Dimensions
            </span>
            <div className="flex items-center gap-1">
              {activeMeasurement && (
                <button
                  type="button"
                  onClick={copyMeasurementSummary}
                  title="Copy measurement to clipboard"
                  className="flex items-center gap-1 rounded bg-emerald-950 hover:bg-emerald-900 border border-emerald-700/60 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300"
                >
                  {copiedMeasure ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  <span>{copiedMeasure ? 'Copied' : 'Copy'}</span>
                </button>
              )}
              {measureP1 && (
                <button
                  type="button"
                  onClick={clearMeasurement}
                  title="Clear Ruler Points"
                  className="rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  clearMeasurement();
                  setActiveTool('orbit');
                }}
                title="Close Ruler Tool"
                className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {!measureP1 ? (
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Click <strong className="text-emerald-300">Point 1</strong> then <strong className="text-amber-300">Point 2</strong> directly on the 3D CAD or VTK surface to measure true physical distance.
            </p>
          ) : !activeMeasurement ? (
            <div className="space-y-1.5 font-mono text-[10.5px]">
              <div className="text-emerald-300">
                P1 locked: ({measureP1.x.toFixed(4)}, {measureP1.y.toFixed(4)}, {measureP1.z.toFixed(4)}) m
              </div>
              <div className="text-slate-400 font-sans text-[11px]">
                Move cursor over the model and click <strong className="text-amber-300">Point 2</strong>…
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="rounded-lg border border-sky-500/30 bg-slate-900/90 px-2.5 py-2">
                <div className="flex items-center justify-between text-[10px] text-slate-400">
                  <span>{measureP2 ? 'Measured Distance ΔL' : 'Live Preview ΔL'}</span>
                  <span className="font-mono text-sky-300">SI (m / mm)</span>
                </div>
                <div className="mt-0.5 font-mono text-sm font-bold text-white tabular-nums">
                  {formatLengthSI(activeMeasurement.distanceM)}
                </div>
                <div className="mt-1 grid grid-cols-3 gap-1.5 border-t border-slate-800 pt-1 font-mono text-[10px] tabular-nums">
                  <span className="text-rose-300">ΔX: {activeMeasurement.dx.toFixed(4)}</span>
                  <span className="text-emerald-300">ΔY: {activeMeasurement.dy.toFixed(4)}</span>
                  <span className="text-sky-300">ΔZ: {activeMeasurement.dz.toFixed(4)}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-0.5 font-mono text-[9.5px] text-slate-300 tabular-nums">
                <div>
                  <span className="text-emerald-400 font-bold">P1:</span> ({activeMeasurement.p1.x.toFixed(4)}, {activeMeasurement.p1.y.toFixed(4)}, {activeMeasurement.p1.z.toFixed(4)}) m
                </div>
                <div>
                  <span className="text-amber-400 font-bold">P2:</span> ({activeMeasurement.p2.x.toFixed(4)}, {activeMeasurement.p2.y.toFixed(4)}, {activeMeasurement.p2.z.toFixed(4)}) m
                </div>
              </div>

              {activeMeasurement.distanceM > 1e-9 && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 px-2 py-1.5 font-mono text-[10px] text-slate-300 tabular-nums">
                  <div className="text-[9.5px] font-sans text-slate-400 mb-0.5">
                    Gmsh Cell Size Guide (Feature L/15 – L/10):
                  </div>
                  <div className="text-cyan-300 font-semibold">
                    h ≈ {(activeMeasurement.meshHintFineM * 1000).toFixed(2)} – {(activeMeasurement.meshHintCoarseM * 1000).toFixed(2)} mm
                    <span className="text-slate-400 font-normal"> ({activeMeasurement.meshHintFineM.toFixed(4)} m)</span>
                  </div>
                </div>
              )}

              {activeMeasurement.scalarDelta !== undefined && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-950/20 px-2 py-1.5 font-mono text-[10px] tabular-nums">
                  <div className="flex items-center justify-between text-amber-300 font-semibold">
                    <span>Δ{activeMeasurement.scalarLabel || 'φ'}:</span>
                    <span>
                      {activeMeasurement.scalarDelta >= 0 ? '+' : ''}
                      {activeMeasurement.scalarDelta.toPrecision(4)} {activeMeasurement.scalarUnit}
                    </span>
                  </div>
                  {activeMeasurement.scalarSlope !== undefined && (
                    <div className="mt-0.5 flex items-center justify-between text-slate-300">
                      <span>Avg Slope (Δφ/ΔL):</span>
                      <span>
                        {activeMeasurement.scalarSlope.toPrecision(4)} {activeMeasurement.slopeUnit}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {modelPhysicalBounds && (
            <div className="mt-2 pt-2 border-t border-slate-800 font-mono text-[9.5px] text-slate-400 tabular-nums">
              <div className="flex items-center justify-between text-slate-300 mb-0.5">
                <span className="font-sans text-[10px] font-semibold">Overall Model Envelope</span>
                <span>Diag: {modelPhysicalBounds.diagonalM.toFixed(4)} m</span>
              </div>
              <div>
                Lx: <strong className="text-slate-200">{modelPhysicalBounds.size[0].toFixed(4)} m</strong> · Ly:{' '}
                <strong className="text-slate-200">{modelPhysicalBounds.size[1].toFixed(4)} m</strong> · Lz:{' '}
                <strong className="text-slate-200">{modelPhysicalBounds.size[2].toFixed(4)} m</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status Bar */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-6 items-center justify-between border-t border-slate-800/80 bg-slate-950/95 px-3 font-mono text-[10px] text-slate-400">
        <div className="flex items-center gap-3">
          <span className="text-emerald-400">WebGL 3D Viewport</span>
          <span>·</span>
          <span>Field: <strong className="text-slate-200">{field}</strong></span>
          <span>·</span>
          <span>
            View: {showWireframe ? 'Mesh Wireframe' : isShowingSolvedVtk ? (scalarRange.isGradient ? 'VTK Surface Gradient |∇|' : 'VTK Contours') : meshPreviewVtk ? 'Pre-Solve CAD/Mesh' : 'Solid CAD'}
          </span>
          {activeTool === 'measure' && (
            <span className="text-emerald-300 font-bold">
              [{!measureP1 ? 'Ruler: Click Point 1 on 3D surface' : !measureP2 ? 'Ruler: Click Point 2 to lock distance' : 'Ruler: Click any surface point for new measurement'}]
            </span>
          )}
          {activeTool.startsWith('tag_') && (
            <span className="text-amber-300 font-bold">
              [Click on 3D surface to assign {activeTool.replace('tag_', '').toUpperCase()}]
            </span>
          )}
        </div>
        <div>Cartesian (X, Y, Z) · SI (m, s, kg, K)</div>
      </div>
    </div>
  );
};