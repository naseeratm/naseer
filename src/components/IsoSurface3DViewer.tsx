import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Box, RotateCcw } from 'lucide-react';
import { ParsedNsr1Payload } from '../utils/nsr1Binary';
import { formatNumber } from '../utils/numberFormat';

interface IsoSurface3DViewerProps {
  meshPayload: ParsedNsr1Payload;
  surfaceColorHex: string;
  opacity: number;
  wireframe: boolean;
  domainBounds?: [number, number, number, number, number, number] | null;
}

function detectSoftwareWebGL(): boolean {
  try {
    const probeCanvas = document.createElement('canvas');
    const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export const IsoSurface3DViewer: React.FC<IsoSurface3DViewerProps> = ({
  meshPayload,
  surfaceColorHex,
  opacity,
  wireframe,
  domainBounds,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial | null>(null);
  const requestRenderRef = useRef<(() => void) | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);

  // Sync live material styling without tearing down the WebGL context or resetting camera
  useEffect(() => {
    const mat = materialRef.current;
    if (!mat) return;
    mat.color.set(surfaceColorHex);
    mat.wireframe = wireframe;
    mat.opacity = opacity;
    mat.transparent = opacity < 0.995;
    mat.depthWrite = opacity >= 0.995;
    mat.needsUpdate = true;
    requestRenderRef.current?.();
  }, [surfaceColorHex, opacity, wireframe]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const points = meshPayload.buffers.points;
    const indices = meshPayload.buffers.indices;
    const normals = meshPayload.buffers.normals;

    if (!(points instanceof Float32Array) || points.length < 9 || !(indices instanceof Uint32Array) || indices.length < 3) {
      setWebglError('Returned NSR1 iso-surface payload contained no renderable triangles.');
      return;
    }

    setWebglError(null);
    const isSoftwareGl = detectSoftwareWebGL();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError('WebGL is unavailable in this browser context.');
      return;
    }

    const width = Math.max(320, container.clientWidth || 640);
    const height = Math.max(280, container.clientHeight || 380);
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090d16');

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    // 3-point warm/cool studio rig for clean surface curvature legibility
    const hemiLight = new THREE.HemisphereLight('#dbeafe', '#1e293b', 0.65);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#fff7ed', 1.35);
    keyLight.position.set(4, 6, 5);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#93c5fd', 0.6);
    rimLight.position.set(-5, -3, -4);
    scene.add(rimLight);

    // Build real BufferGeometry directly from NSR1 typed arrays
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    if (normals instanceof Float32Array && normals.length === points.length) {
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    } else {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(surfaceColorHex),
      roughness: 0.34,
      metalness: 0.12,
      side: THREE.DoubleSide,
      wireframe,
      opacity,
      transparent: opacity < 0.995,
      depthWrite: opacity >= 0.995,
    });
    materialRef.current = material;

    const isoMesh = new THREE.Mesh(geometry, material);
    scene.add(isoMesh);

    // Reference bounding box from real solver physical domain (or iso-surface bounds)
    const activeBounds = domainBounds ?? meshPayload.metadata.bounds;
    let boxGeo: THREE.BoxGeometry | null = null;
    let edgesGeo: THREE.EdgesGeometry | null = null;
    let edgesMat: THREE.LineBasicMaterial | null = null;
    let refBox = geometry.boundingBox ? geometry.boundingBox.clone() : new THREE.Box3();

    if (Array.isArray(activeBounds) && activeBounds.length === 6) {
      const [xmin, xmax, ymin, ymax, zmin, zmax] = activeBounds.map(Number);
      const dx = Math.max(1e-6, xmax - xmin);
      const dy = Math.max(1e-6, ymax - ymin);
      const dz = Math.max(1e-6, zmax - zmin);
      boxGeo = new THREE.BoxGeometry(dx, dy, dz);
      edgesGeo = new THREE.EdgesGeometry(boxGeo);
      edgesMat = new THREE.LineBasicMaterial({
        color: '#475569',
        transparent: true,
        opacity: 0.55,
      });
      const bboxWire = new THREE.LineSegments(edgesGeo, edgesMat);
      bboxWire.position.set(0.5 * (xmin + xmax), 0.5 * (ymin + ymax), 0.5 * (zmin + zmax));
      scene.add(bboxWire);
      refBox = new THREE.Box3(new THREE.Vector3(xmin, ymin, zmin), new THREE.Vector3(xmax, ymax, zmax));
    }

    const center = refBox.getCenter(new THREE.Vector3());
    const size = refBox.getSize(new THREE.Vector3());
    const radius = Math.max(1e-4, size.length() * 0.5);

    const camera = new THREE.PerspectiveCamera(42, width / height, Math.max(1e-5, radius * 0.005), radius * 40);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = radius * 0.3;
    controls.maxDistance = radius * 12;

    const frameCamera = () => {
      controls.target.copy(center);
      camera.position.set(center.x + radius * 1.45, center.y + radius * 1.05, center.z + radius * 1.55);
      camera.lookAt(center);
      controls.update();
    };
    frameCamera();

    // Subtle spatial axes anchored at domain min corner
    const axesHelper = new THREE.AxesHelper(Math.max(radius * 0.28, 0.05));
    axesHelper.position.copy(refBox.min);
    scene.add(axesHelper);

    // Coalesced on-demand renderer with WebGL2 fence sync for software WebGL
    let frameId = 0;
    let disposed = false;
    let renderBusy = false;
    let renderDirty = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext | null;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const requestRender = () => {
      if (disposed) return;
      if (renderBusy) {
        renderDirty = true;
        return;
      }
      renderBusy = true;
      frameId = window.requestAnimationFrame(() => {
        if (disposed) return;
        renderDirty = false;
        controls.update();
        renderer.render(scene, camera);
        const done = () => {
          renderBusy = false;
          if (renderDirty && !disposed) requestRender();
        };
        if (isSoftwareGl) afterDraw(done);
        else done();
      });
    };

    requestRenderRef.current = requestRender;
    resetCameraRef.current = () => {
      frameCamera();
      requestRender();
    };

    controls.addEventListener('change', requestRender);

    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      setWebglError('WebGL context lost. Re-extract or refresh to restore 3D rendering.');
    };
    const onContextRestored = () => {
      setWebglError(null);
      requestRender();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(320, Math.floor(entry.contentRect.width));
        const h = Math.max(280, Math.floor(entry.contentRect.height));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
        requestRender();
      }
    });
    resizeObserver.observe(container);

    requestRender();

    return () => {
      disposed = true;
      requestRenderRef.current = null;
      resetCameraRef.current = null;
      materialRef.current = null;
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      resizeObserver.disconnect();
      controls.removeEventListener('change', requestRender);
      controls.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      geometry.dispose();
      material.dispose();
      boxGeo?.dispose();
      edgesGeo?.dispose();
      edgesMat?.dispose();
      axesHelper.dispose();
      envTarget.dispose();
      renderer.dispose();
      container.innerHTML = '';
    };
  }, [meshPayload, domainBounds]);

  const meta = meshPayload.metadata;
  const triCount = meta.triangle_count ?? Math.floor((meshPayload.buffers.indices?.length ?? 0) / 3);
  const ptCount = meta.point_count ?? Math.floor((meshPayload.buffers.points?.length ?? 0) / 3);
  const kbSize = (meshPayload.byteLength / 1024).toFixed(1);
  const formattedIsoValue =
    typeof meta.iso_value === 'number' && Number.isFinite(meta.iso_value) ? formatNumber(meta.iso_value) : '—';

  return (
    <div className="space-y-2.5">
      <div className="relative h-[380px] w-full overflow-hidden rounded-md border border-slate-800 bg-[#090d16]">
        <div ref={mountRef} className="h-full w-full" />

        {webglError && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/95 p-6 text-center text-[12.5px] text-rose-300">
            {webglError}
          </div>
        )}

        {/* Minimal solid top-right camera reset control (no backdrop-filter over WebGL) */}
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <button
            type="button"
            onClick={() => resetCameraRef.current?.()}
            className="flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-900/95 px-2.5 py-1.5 text-[11.5px] font-medium text-slate-200 transition-colors hover:bg-slate-800 whitespace-nowrap"
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0" />
            <span>Reset View</span>
          </button>
        </div>

        {/* Clean unboxed bottom-left metadata strip */}
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded border border-slate-800 bg-slate-950/90 px-3 py-1.5 text-[11px] font-mono tabular-nums text-slate-300">
          <span className="inline-flex items-center gap-1.5">
            <Box className="h-3.5 w-3.5 text-sky-400" />
            <span>
              {meta.field ?? 'Scalar'} = {formattedIsoValue}
            </span>
          </span>
          <span className="mx-2 text-slate-600" aria-hidden="true">·</span>
          <span>{triCount.toLocaleString()} tris</span>
          <span className="mx-2 text-slate-600" aria-hidden="true">·</span>
          <span>{ptCount.toLocaleString()} verts</span>
          <span className="mx-2 text-slate-600" aria-hidden="true">·</span>
          <span>{kbSize} KB NSR1</span>
        </div>
      </div>

      {/* Quantitative Iso-Surface Telemetry Bar */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10.5px] text-slate-500">Iso-Value Extracted</div>
          <div className="font-mono text-[13px] font-semibold tabular-nums text-sky-300">
            {meta.field ?? '—'} = {formattedIsoValue}
          </div>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10.5px] text-slate-500">Volume Field Range</div>
          <div className="font-mono text-[13px] font-semibold tabular-nums text-slate-100">
            {meta.field_min !== undefined && meta.field_max !== undefined
              ? `${formatNumber(meta.field_min)} / ${formatNumber(meta.field_max)}`
              : '—'}
          </div>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10.5px] text-slate-500">Mesh Resolution</div>
          <div className="font-mono text-[13px] font-semibold tabular-nums text-slate-100">
            {triCount.toLocaleString()} tris
          </div>
        </div>
        <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
          <div className="text-[10.5px] text-slate-500">Binary Payload (NSR1)</div>
          <div className="font-mono text-[13px] font-semibold tabular-nums text-slate-100">
            {kbSize} KB ({meta.source_file ?? 'VTK'})
          </div>
        </div>
      </div>
    </div>
  );
};
