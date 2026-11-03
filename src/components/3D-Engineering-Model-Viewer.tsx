import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  Sparkles,
  Info,
  Flame,
} from 'lucide-react';
import { ThesisProject } from '../types/thesis';

interface EngineeringModelViewer3DProps {
  project: ThesisProject;
}

export const EngineeringModelViewer3D: React.FC<EngineeringModelViewer3DProps> = ({ project }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isFEA = project.field === 'FEA';
  const isCFD = project.field === 'CFD';
  const isThermal = project.field === 'Thermal';
  const isLHTES = project.id === 'lhtes_v3_master' || project.id === 'lhtes-v3-master';
  const [activeLayer, setActiveLayer] = useState<'lhtes_assembly' | 'pcm_melt' | 'temperature_field'>('lhtes_assembly');

  const defaultEq = isThermal
    ? '\\mathbf{q}\'\' = -k \\nabla T'
    : isFEA
    ? '\\nabla \\cdot \\boldsymbol{\\sigma} + \\mathbf{b} = 0'
    : '\\nabla \\cdot \\vec{V} = 0';

  const initialPin = {
    title: project.boundaryConditions[0]
      ? `${project.boundaryConditions[0].name} (${project.boundaryConditions[0].type})`
      : isThermal
      ? 'مصدر الحرارة الأساسي'
      : isFEA
      ? 'التثبيت الإنشائي الأساسي'
      : 'مدخل التدفق الأساسي',
    type: 'input' as const,
    value: project.boundaryConditions[0]
      ? `${project.boundaryConditions[0].value} ${project.boundaryConditions[0].unit}`
      : isThermal
      ? '2500 W/m²'
      : isFEA
      ? '15.0 MPa'
      : '22.0 m/s',
    equation: project.governingEquations[0]?.latex || defaultEq,
    description: project.boundaryConditions[0]?.description || 'الشرط الحدودي الأساسي المطبق على النموذج الهندسي.',
  };

  const [selectedPin, setSelectedPin] = useState<{
    title: string;
    type: 'input' | 'output' | 'constant';
    value: string;
    equation: string;
    description: string;
  } | null>(initialPin);

  useEffect(() => {
    if (project.boundaryConditions[0]) {
      setSelectedPin({
        title: `${project.boundaryConditions[0].name} (${project.boundaryConditions[0].type})`,
        type: 'input',
        value: `${project.boundaryConditions[0].value} ${project.boundaryConditions[0].unit}`,
        equation: project.governingEquations[0]?.latex || defaultEq,
        description: project.boundaryConditions[0].description || 'الشرط الحدودي الأساسي المطبق على النموذج الهندسي.',
      });
    }
  }, [project.id]);

  const shellMeshRef = useRef<THREE.Mesh | null>(null);
  const pcmMeshRef = useRef<THREE.Mesh | null>(null);
  const coilMeshRef = useRef<THREE.Mesh | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const width = container.clientWidth || 700;
    const height = container.clientHeight || 450;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x020617);
    scene.fog = new THREE.FogExp2(0x020617, 0.012);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(7, 5, 8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.replaceChildren(renderer.domElement);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffedd5, 2.8);
    keyLight.position.set(10, 15, 8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    scene.add(keyLight);

    const fillLight = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 1.4);
    scene.add(fillLight);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 25;
    controls.minDistance = 2;

    const modelGroup = new THREE.Group();
    scene.add(modelGroup);

    if (project.field === 'FEA') {
      // 3D Structural Cantilever I-Beam Model
      const beamGroup = new THREE.Group();
      
      // Fixed Base Plate
      const baseGeo = new THREE.BoxGeometry(0.4, 2.8, 2.8);
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.3 });
      const baseMesh = new THREE.Mesh(baseGeo, baseMat);
      baseMesh.position.set(-3.2, 0, 0);
      beamGroup.add(baseMesh);

      // Web of I-Beam
      const webGeo = new THREE.BoxGeometry(6.0, 1.8, 0.2);
      const webMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        metalness: 0.7,
        roughness: 0.25,
      });
      shellMeshRef.current = new THREE.Mesh(webGeo, webMat);
      shellMeshRef.current.castShadow = true;
      beamGroup.add(shellMeshRef.current);

      // Top Flange
      const topFlangeGeo = new THREE.BoxGeometry(6.0, 0.2, 1.4);
      const flangeMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.7, roughness: 0.3 });
      const topFlange = new THREE.Mesh(topFlangeGeo, flangeMat);
      topFlange.position.y = 0.95;
      beamGroup.add(topFlange);

      // Bottom Flange
      const bottomFlange = new THREE.Mesh(topFlangeGeo, flangeMat);
      bottomFlange.position.y = -0.95;
      beamGroup.add(bottomFlange);

      // Von Mises High Stress Concentration Halo at root (-X)
      const stressHaloGeo = new THREE.BoxGeometry(1.2, 2.2, 1.6);
      const stressHaloMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xb91c1c,
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 0.7,
      });
      pcmMeshRef.current = new THREE.Mesh(stressHaloGeo, stressHaloMat);
      pcmMeshRef.current.position.set(-2.4, 0, 0);
      beamGroup.add(pcmMeshRef.current);

      // Tip Load Vector Arrow at +X
      const arrowDir = new THREE.Vector3(0, -1, 0);
      const arrowOrigin = new THREE.Vector3(2.8, 1.6, 0);
      const arrowHelper = new THREE.ArrowHelper(arrowDir, arrowOrigin, 1.2, 0xf59e0b, 0.35, 0.2);
      coilMeshRef.current = arrowHelper as any;
      beamGroup.add(arrowHelper);

      modelGroup.add(beamGroup);
    } else if (project.field === 'CFD') {
      // 3D Aerodynamic Airfoil Wing Section
      const cfdGroup = new THREE.Group();

      // Extruded Airfoil Shape
      const shape = new THREE.Shape();
      const chord = 4.5;
      const pointsCount = 40;
      for (let i = 0; i <= pointsCount; i++) {
        const xNorm = i / pointsCount;
        const x = (xNorm - 0.5) * chord;
        // NACA 0012 formula approximation
        const yt = 5 * 0.12 * chord * (0.2969 * Math.sqrt(Math.max(0, xNorm)) - 0.1260 * xNorm - 0.3516 * xNorm ** 2 + 0.2843 * xNorm ** 3 - 0.1015 * xNorm ** 4);
        if (i === 0) shape.moveTo(x, yt);
        else shape.lineTo(x, yt);
      }
      for (let i = pointsCount; i >= 0; i--) {
        const xNorm = i / pointsCount;
        const x = (xNorm - 0.5) * chord;
        const yt = 5 * 0.12 * chord * (0.2969 * Math.sqrt(Math.max(0, xNorm)) - 0.1260 * xNorm - 0.3516 * xNorm ** 2 + 0.2843 * xNorm ** 3 - 0.1015 * xNorm ** 4);
        shape.lineTo(x, -yt);
      }

      const extrudeSettings = { depth: 3.5, bevelEnabled: false };
      const wingGeo = new THREE.ExtrudeGeometry(shape, extrudeSettings);
      wingGeo.center();
      const wingMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        metalness: 0.8,
        roughness: 0.2,
      });
      shellMeshRef.current = new THREE.Mesh(wingGeo, wingMat);
      shellMeshRef.current.castShadow = true;
      cfdGroup.add(shellMeshRef.current);

      // Suction peak low-pressure upper halo
      const suctionGeo = new THREE.SphereGeometry(0.8, 16, 16);
      suctionGeo.scale(1.8, 0.4, 2.0);
      const suctionMat = new THREE.MeshStandardMaterial({
        color: 0xa855f7,
        emissive: 0x7e22ce,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.6,
      });
      pcmMeshRef.current = new THREE.Mesh(suctionGeo, suctionMat);
      pcmMeshRef.current.position.set(-0.8, 0.9, 0);
      cfdGroup.add(pcmMeshRef.current);

      // Streamlines particle tubes
      const streamGeo = new THREE.CylinderGeometry(0.04, 0.04, 5.5, 12);
      const streamMat = new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.3 });
      const streamTubes = new THREE.Group();
      for (let s = -1.2; s <= 1.2; s += 0.6) {
        const tube = new THREE.Mesh(streamGeo, streamMat);
        tube.rotation.z = Math.PI / 2;
        tube.position.set(0, 1.2, s);
        streamTubes.add(tube);
      }
      coilMeshRef.current = streamTubes as any;
      cfdGroup.add(streamTubes);

      modelGroup.add(cfdGroup);
    } else if (isLHTES) {
      // Flagship LHTES Helical Coiled Cylindrical Storage Unit
      const shellGeo = new THREE.CylinderGeometry(1.8, 1.8, 4.5, 32, 1, true);
      const shellMat = new THREE.MeshPhysicalMaterial({
        color: 0x38bdf8,
        metalness: 0.1,
        roughness: 0.1,
        transmission: 0.85,
        thickness: 1.2,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      });
      shellMeshRef.current = new THREE.Mesh(shellGeo, shellMat);
      modelGroup.add(shellMeshRef.current);

      const pcmGeo = new THREE.CylinderGeometry(1.6, 1.6, 4.2, 32);
      const pcmMat = new THREE.MeshPhysicalMaterial({
        color: 0xf59e0b,
        roughness: 0.3,
        transmission: 0.6,
        thickness: 0.8,
        transparent: true,
        opacity: 0.65,
      });
      pcmMeshRef.current = new THREE.Mesh(pcmGeo, pcmMat);
      modelGroup.add(pcmMeshRef.current);

      class HelicalCurve extends THREE.Curve<THREE.Vector3> {
        constructor(private turns = 4, private height = 3.6, private radius = 0.9) {
          super();
        }
        getPoint(t: number, optionalTarget = new THREE.Vector3()): THREE.Vector3 {
          const theta = 2 * Math.PI * this.turns * t;
          const x = Math.cos(theta) * this.radius;
          const y = (t - 0.5) * this.height;
          const z = Math.sin(theta) * this.radius;
          return optionalTarget.set(x, y, z);
        }
      }

      const path = new HelicalCurve(4.5, 3.8, 0.85);
      const tubeGeo = new THREE.TubeGeometry(path, 128, 0.12, 16, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        metalness: 0.9,
        roughness: 0.2,
      });
      coilMeshRef.current = new THREE.Mesh(tubeGeo, tubeMat);
      modelGroup.add(coilMeshRef.current);

      const pipeGeo = new THREE.CylinderGeometry(0.15, 0.15, 1.2, 16);
      const pipeMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8, roughness: 0.3 });
      const topPipe = new THREE.Mesh(pipeGeo, pipeMat);
      topPipe.position.y = 2.6;
      modelGroup.add(topPipe);
      const bottomPipe = new THREE.Mesh(pipeGeo, pipeMat);
      bottomPipe.position.y = -2.6;
      modelGroup.add(bottomPipe);

      // Graded Tree Fins Representation (139 lower, 65 upper)
      const finCount = 204;
      const finGeo = new THREE.BoxGeometry(0.3, 0.05, 0.3);
      const finMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.5, roughness: 0.5 });
      const finInstanced = new THREE.InstancedMesh(finGeo, finMat, finCount);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < finCount; i++) {
        let t;
        if (i < 139) {
          t = (i / 138) * 0.5;
        } else {
          t = 0.5 + ((i - 139) / 64) * 0.5;
        }
        const pos = path.getPoint(t);
        dummy.position.copy(pos);
        dummy.lookAt(new THREE.Vector3(0, pos.y, 0));
        dummy.updateMatrix();
        finInstanced.setMatrixAt(i, dummy.matrix);
      }
      modelGroup.add(finInstanced);
    } else {
      // 3D Solid Thermal Conduction & Fin Heat Sink Model
      const thermalGroup = new THREE.Group();

      // Base Solid Conduction Block
      const baseBlockGeo = new THREE.BoxGeometry(4.0, 0.8, 3.0);
      const baseBlockMat = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        metalness: 0.6,
        roughness: 0.35,
      });
      shellMeshRef.current = new THREE.Mesh(baseBlockGeo, baseBlockMat);
      shellMeshRef.current.position.set(0, -0.6, 0);
      shellMeshRef.current.castShadow = true;
      shellMeshRef.current.receiveShadow = true;
      thermalGroup.add(shellMeshRef.current);

      // Bottom Heat Influx Pad (Glowing hot red/orange)
      const heatSourceGeo = new THREE.BoxGeometry(3.6, 0.15, 2.6);
      const heatSourceMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xd97706,
        emissiveIntensity: 0.8,
      });
      pcmMeshRef.current = new THREE.Mesh(heatSourceGeo, heatSourceMat);
      pcmMeshRef.current.position.set(0, -1.05, 0);
      thermalGroup.add(pcmMeshRef.current);

      // Array of 7 vertical cooling fins conducting heat upwards
      const finsGroup = new THREE.Group();
      const finGeo = new THREE.BoxGeometry(0.18, 2.2, 2.8);
      const finMat = new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        metalness: 0.8,
        roughness: 0.25,
      });
      for (let i = -3; i <= 3; i++) {
        const finMesh = new THREE.Mesh(finGeo, finMat);
        finMesh.position.set(i * 0.55, 0.9, 0);
        finMesh.castShadow = true;
        finsGroup.add(finMesh);
      }
      coilMeshRef.current = finsGroup as any;
      thermalGroup.add(finsGroup);

      // Heat flux indicator arrows pointing upward from heat source
      const arrowDir = new THREE.Vector3(0, 1, 0);
      for (let k = -2; k <= 2; k += 2) {
        const arrow = new THREE.ArrowHelper(arrowDir, new THREE.Vector3(k * 0.8, -0.2, 0), 1.0, 0xf59e0b, 0.3, 0.15);
        thermalGroup.add(arrow);
      }

      modelGroup.add(thermalGroup);
    }

    const shadowGeo = new THREE.PlaneGeometry(8, 8);
    const shadowMat = new THREE.ShadowMaterial({ opacity: 0.3 });
    const shadowPlane = new THREE.Mesh(shadowGeo, shadowMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -3.2;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    let animationFrameId: number;
    const clock = new THREE.Clock();
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      modelGroup.rotation.y += delta * 0.18;
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 700;
      const h = container.clientHeight || 450;
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
  }, [project.field]);

  useEffect(() => {
    if (!shellMeshRef.current || !pcmMeshRef.current || !coilMeshRef.current) return;

    switch (activeLayer) {
      case 'lhtes_assembly':
        shellMeshRef.current.visible = true;
        pcmMeshRef.current.visible = true;
        coilMeshRef.current.visible = true;
        break;
      case 'pcm_melt':
        shellMeshRef.current.visible = false;
        pcmMeshRef.current.visible = true;
        coilMeshRef.current.visible = true;
        break;
      case 'temperature_field':
        shellMeshRef.current.visible = true;
        pcmMeshRef.current.visible = true;
        coilMeshRef.current.visible = false;
        break;
    }
  }, [activeLayer]);

  const viewerTitle = isFEA
    ? 'عارض المجسم ثلاثي الأبعاد (3D Structural FEA Engine)'
    : isCFD
    ? 'عارض المجسم ثلاثي الأبعاد (3D Aerodynamics CFD Engine)'
    : isLHTES
    ? 'عارض المجسم ثلاثي الأبعاد (LHTES Phase Change Engine)'
    : 'عارض المجسم ثلاثي الأبعاد (3D Thermal Conduction Engine)';

  const viewerSubtitle = isFEA
    ? 'نموذج إنشائي تفاعلي: جائز كابولي I-Beam، قاعدة التثبيت، ونواة تركيز الإجهادات فون ميسيس'
    : isCFD
    ? 'نموذج جريان وهوائي تفاعلي: مقطع الجناح، قمة الامتصاص، وتدرج السرعة'
    : isLHTES
    ? 'نموذج حراري تفاعلي: الغلاف، الكويل الحلزوني (HTF)، ووسط انصهار الـ NePCM'
    : 'نموذج حراري تفاعلي: كتلة التوصيل الحراري، شريحة التسخين، وزعانف التبديد بالحمل';

  const layer1Label = isFEA ? 'كامل الجائز (I-Beam)' : isCFD ? 'السطح الانسيابي (Airfoil)' : isLHTES ? 'تجميع المنظومة' : 'الهيكل الحراري (Solid Block)';
  const layer2Label = isFEA ? 'إجهادات فون ميسيس (Von Mises)' : isCFD ? 'قمة امتصاص الضغط (Suction)' : isLHTES ? 'منطقة انصهار PCM' : 'فيض الحرارة (Heat Flux)';
  const layer3Label = isFEA ? 'حمولة وركيزة التثبيت (BCs)' : isCFD ? 'حقل السرعة (Velocity Field)' : isLHTES ? 'حقل درجات الحرارة' : 'تدرج درجات الحرارة (Isotherms)';

  return (
    <div className="bg-slate-900/90 rounded-[2.5rem] border border-slate-800 p-8 shadow-2xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white flex items-center gap-2">
              {viewerTitle}
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                Three.js {project.field}
              </span>
            </h3>
            <p className="text-sm text-slate-400 mt-0.5">{viewerSubtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-slate-950 p-1 rounded-full border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveLayer('lhtes_assembly')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
              activeLayer === 'lhtes_assembly' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            {layer1Label}
          </button>
          <button
            type="button"
            onClick={() => setActiveLayer('pcm_melt')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
              activeLayer === 'pcm_melt' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            {layer2Label}
          </button>
          <button
            type="button"
            onClick={() => setActiveLayer('temperature_field')}
            className={`px-4 py-2 rounded-full text-xs font-bold transition-all ${
              activeLayer === 'temperature_field' ? 'bg-amber-500 text-slate-950 shadow' : 'text-slate-400 hover:text-white'
            }`}
          >
            {layer3Label}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 relative bg-slate-950 rounded-[2rem] border-4 border-slate-900 overflow-hidden h-[450px] flex items-center justify-center shadow-inner">
          <div ref={containerRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
          
          <div className="absolute inset-0 bg-gradient-to-tr from-sky-500/5 to-transparent pointer-events-none rounded-[2rem]" />

          <div className="absolute top-4 right-4 bg-slate-900/95 backdrop-blur-md p-3 rounded-2xl border border-slate-800 text-[11px] space-y-1.5 shadow-xl max-w-xs">
            <span className="font-bold text-amber-400 block flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              مكونات المجسم الهندسي ({project.field} Hotspots):
            </span>
            <div className="grid grid-cols-1 gap-1 pt-1">
              {/* Pin 1: Primary Boundary Condition / Input */}
              <button
                type="button"
                onClick={() =>
                  setSelectedPin({
                    title: project.boundaryConditions[0] ? `${project.boundaryConditions[0].name} (Input)` : isThermal ? 'مصدر الحرارة الأساسي' : isFEA ? 'التثبيت الإنشائي' : 'مدخل التدفق',
                    type: 'input',
                    value: project.boundaryConditions[0] ? `${project.boundaryConditions[0].value} ${project.boundaryConditions[0].unit}` : (isFEA ? '15.0 MPa' : isThermal ? '2500 W/m²' : '22.0 m/s'),
                    equation: project.governingEquations[0]?.latex || defaultEq,
                    description: project.boundaryConditions[0]?.description || 'الشرط الحدودي الأساسي المطبق على النموذج.',
                  })
                }
                className="text-right px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/20 flex items-center justify-between transition-colors"
              >
                <span className="truncate max-w-[160px]">1. {project.boundaryConditions[0]?.name || (isThermal ? 'مصدر الحرارة' : isFEA ? 'التثبيت' : 'مدخل التدفق')}</span>
                <span className="font-mono text-xs font-bold shrink-0">{project.boundaryConditions[0] ? `${project.boundaryConditions[0].value} ${project.boundaryConditions[0].unit}` : 'Input'}</span>
              </button>

              {/* Pin 2: Primary Physical Field Output */}
              <button
                type="button"
                onClick={() =>
                  setSelectedPin({
                    title: project.contours[0] ? `${project.contours[0].name} (Peak Output)` : 'المخرج المحسوب الأساسي',
                    type: 'output',
                    value: project.contours[0] ? `Max = ${project.contours[0].maxVal} ${project.contours[0].unit}` : (isFEA ? '214.8 MPa' : isThermal ? '85.0 °C' : '28.5 m/s'),
                    equation: project.governingEquations[1]?.latex || project.governingEquations[0]?.latex || defaultEq,
                    description: project.contours[0]?.physicalDescription || 'ذروة الحقل المحسوب الناتج عن محاكاة النموذج الهندسي.',
                  })
                }
                className="text-right px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 flex items-center justify-between transition-colors"
              >
                <span className="truncate max-w-[160px]">2. {project.contours[0]?.name || 'المخرج المحسوب'}</span>
                <span className="font-mono text-xs font-bold shrink-0">{project.contours[0] ? `${project.contours[0].maxVal} ${project.contours[0].unit}` : 'Peak'}</span>
              </button>

              {/* Pin 3: Secondary Output or Material Constant */}
              <button
                type="button"
                onClick={() =>
                  setSelectedPin({
                    title: project.contours[1]
                      ? `${project.contours[1].name} (Field Output)`
                      : (project.boundaryConditions[1] ? `${project.boundaryConditions[1].name} (Boundary)` : `المادة: ${project.material.name}`),
                    type: project.contours[1] ? 'output' : 'constant',
                    value: project.contours[1]
                      ? `Max = ${project.contours[1].maxVal} ${project.contours[1].unit}`
                      : (project.boundaryConditions[1] ? `${project.boundaryConditions[1].value} ${project.boundaryConditions[1].unit}` : project.material.density),
                    equation: project.governingEquations[2]?.latex || project.governingEquations[0]?.latex || '\\boldsymbol{\\sigma} = \\mathbf{C} : \\boldsymbol{\\varepsilon}',
                    description: project.contours[1]?.physicalDescription || project.boundaryConditions[1]?.description || `الخواص المادية للنموذج: ${project.material.name} (كثافة = ${project.material.density}).`,
                  })
                }
                className="text-right px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 flex items-center justify-between transition-colors"
              >
                <span className="truncate max-w-[160px]">3. {project.contours[1]?.name || (project.boundaryConditions[1]?.name || 'الخواص المادية')}</span>
                <span className="font-mono text-xs font-bold shrink-0">{project.contours[1] ? `${project.contours[1].maxVal} ${project.contours[1].unit}` : (project.boundaryConditions[1]?.value || project.material.density)}</span>
              </button>
            </div>
          </div>

          <div className="absolute bottom-3 left-3 bg-slate-900/80 px-3 py-1.5 rounded-full border border-slate-800 text-[10px] text-slate-400 font-mono">
            مجسم ثلاثي الأبعاد تفاعلي يمثل نطاق الحل والشروط الحدية لـ ({project.title}) | {project.field}
          </div>
        </div>

        <div className="bg-slate-950/80 rounded-[2rem] border border-slate-800 p-6 flex flex-col justify-between space-y-4">
          {selectedPin ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <span className="font-bold text-sm text-slate-100 flex items-center gap-2">
                  <span
                    className={`w-2.5 h-2.5 rounded-full ${
                      selectedPin.type === 'input'
                        ? 'bg-sky-400'
                        : selectedPin.type === 'output'
                        ? 'bg-rose-400'
                        : 'bg-amber-400'
                    }`}
                  />
                  {selectedPin.title}
                </span>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full uppercase ${
                    selectedPin.type === 'input'
                      ? 'bg-sky-500/20 text-sky-300'
                      : selectedPin.type === 'output'
                      ? 'bg-rose-500/20 text-rose-300'
                      : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {selectedPin.type}
                </span>
              </div>

              <div className="space-y-2">
                <span className="text-xs text-slate-400 block font-semibold">القيمة المرصودة والمواصفات:</span>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 font-mono font-bold text-amber-400 text-xs leading-relaxed">
                  {selectedPin.value}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-xs text-slate-400 block font-semibold">المعادلة الفيزيائية الحاكمة المرتبطة:</span>
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 font-mono text-xs text-emerald-300 direction-ltr text-center overflow-x-auto">
                  {selectedPin.equation}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-xs text-slate-400 block font-semibold">التفسير والتحليل الهندسي:</span>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {selectedPin.description}
                </p>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500 text-xs">
              انقر على أي مكون هندسي في القائمة لعرض تفاصيل المدخلات والمعادلات الحاكمة.
            </div>
          )}

          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-2 text-[11px] text-slate-400">
            <Info className="w-4 h-4 text-amber-400 shrink-0" />
            <span>المجسم يوضح بدقة هندسة الخزن الحراري الكامن (LHTES) مع الكويل الحلزوني ومادة NePCM.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
