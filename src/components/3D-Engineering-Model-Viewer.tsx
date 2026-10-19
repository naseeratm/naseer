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
  const [activeLayer, setActiveLayer] = useState<'lhtes_assembly' | 'pcm_melt' | 'temperature_field'>('lhtes_assembly');
  const [selectedPin, setSelectedPin] = useState<{
    title: string;
    type: 'input' | 'output' | 'constant';
    value: string;
    equation: string;
    description: string;
  } | null>({
    title: 'دخل مائع التبادل الحراري (HTF Inlet - Oscillating Temp)',
    type: 'input',
    value: 'Tin(t) = 348 + 10·sin(2πt / 1200 s), ṁ = 0.025 kg/s',
    equation: project.governingEquations[2]?.latex || '\\rho c_p (\\vec{V} \\cdot \\nabla) T = k \\nabla^2 T + \\Phi',
    description: 'دخل مائع التبادل الحراري (HTF) داخل الكويل الحلزوني مع دوران حراري ترددي ومعدل جريان 0.025 كغ/ثانية.',
  });

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
    } else {
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

  const isFEA = project.field === 'FEA';
  const isCFD = project.field === 'CFD';

  const viewerTitle = isFEA
    ? 'عارض المجسم ثلاثي الأبعاد (3D Structural FEA Engine)'
    : isCFD
    ? 'عارض المجسم ثلاثي الأبعاد (3D Aerodynamics CFD Engine)'
    : 'عارض المجسم ثلاثي الأبعاد (LHTES Thermal Engine)';

  const viewerSubtitle = isFEA
    ? 'نموذج إنشائي تفاعلي: جائز كابولي I-Beam، قاعدة التثبيت، ونواة تركيز الإجهادات فون ميسيس'
    : isCFD
    ? 'نموذج هوائي تفاعلي: مقطع الجناح NACA 0012، قمة الامتصاص، وخطوط الانسياب'
    : 'نموذج حراري تفاعلي: الغلاف، الكويل الحلزوني (HTF)، ووسط انصهار الـ NePCM';

  const layer1Label = isFEA ? 'كامل الجائز (I-Beam)' : isCFD ? 'مقطع الجناح (Airfoil)' : 'تجميع المنظومة';
  const layer2Label = isFEA ? 'إجهادات فون ميسيس (Von Mises)' : isCFD ? 'قمة امتصاص الضغط (Suction)' : 'منطقة انصهار PCM';
  const layer3Label = isFEA ? 'حمولة وركيزة التثبيت (BCs)' : isCFD ? 'خطوط الانسياب (Streamlines)' : 'حقل درجات الحرارة';

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
              {isFEA ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPin({
                        title: 'حمولة الانحناء الطرفية المركزة (Tip Load P)',
                        type: 'input',
                        value: 'Fy = -45.0 kN (Nodal Surface Force)',
                        equation: '[K] {u} = {F}',
                        description: 'حمولة رأسية مطبقة على الحافة الحرة للكابول مسببة لعزم انحناء أقصى عند نقطة التثبيت.',
                      })
                    }
                    className="text-right px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/20 flex items-center justify-between transition-colors"
                  >
                    <span>1. الحمولة الطرفية المطبقة (Load)</span>
                    <span className="font-mono text-xs font-bold">45.0 kN</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPin({
                        title: 'تمركز إجهاد فون ميسيس الأقصى (Max Von Mises Stress)',
                        type: 'output',
                        value: 'σ_vm = 214.8 MPa (Root Flange Notch)',
                        equation: '\\sigma_{vm} = \\sqrt{3 J_2} < \\sigma_y (345\\text{ MPa})',
                        description: 'أقصى إجهاد مسجل عند السطح الخارجي لمنطقة التثبيت مع معامل أمان 1.61 في النطاق المرن الآمن.',
                      })
                    }
                    className="text-right px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 flex items-center justify-between transition-colors"
                  >
                    <span>2. إجهاد فون ميسيس (Max Stress)</span>
                    <span className="font-mono text-xs font-bold">214.8 MPa</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPin({
                        title: 'سهم الانحناء الأقصى عند الطرف (Tip Deflection)',
                        type: 'output',
                        value: 'Uy = 11.24 mm (Timoshenko Bending + Shear)',
                        equation: 'w_{max} = \\frac{P L^3}{3 E I} + \\frac{P L}{\\kappa A G}',
                        description: 'مقدار الهبوط الرأسي للطرف الحر مطابق للحل التحليلي بنسبة 99.4% وضمن حدود الخدمة L/250.',
                      })
                    }
                    className="text-right px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 flex items-center justify-between transition-colors"
                  >
                    <span>3. سهم التشوه الأقصى (Deflection)</span>
                    <span className="font-mono text-xs font-bold">11.24 mm</span>
                  </button>
                </>
              ) : isCFD ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPin({
                        title: 'سرعة التدفق الحر المتدفق نحو الجناح (Inlet Velocity)',
                        type: 'input',
                        value: 'V = 68.2 m/s (Re = 3.0e6, Ma = 0.20)',
                        equation: '\\rho (\\vec{V} \\cdot \\nabla) \\vec{V} = -\\nabla p + \\mu \\nabla^2 \\vec{V}',
                        description: 'تدفق الهواء المتجه نحو مقطع NACA 0012 مسبباً قوى رفع وسحب ديناميكية.',
                      })
                    }
                    className="text-right px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/20 flex items-center justify-between transition-colors"
                  >
                    <span>1. سرعة الجريان الحر (Inlet)</span>
                    <span className="font-mono text-xs font-bold">68.2 m/s</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPin({
                        title: 'ذروة الامتصاص والرفع الديناميكي (Suction Peak)',
                        type: 'output',
                        value: 'Cp = -2.4, V_max = 92.4 m/s',
                        equation: 'C_l = \\frac{L}{\\frac{1}{2} \\rho V^2 c} = 0.443 \\text{ at } 4^\\circ',
                        description: 'تسارع الهواء فوق السطح العلوي ينتج منطقة ضغط منخفض تسحب الجناح للأعلى وتولد قوة الرفع.',
                      })
                    }
                    className="text-right px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 flex items-center justify-between transition-colors"
                  >
                    <span>2. معامل الرفع والامتصاص (Cl)</span>
                    <span className="font-mono text-xs font-bold">Cl = 0.443</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPin({
                        title: 'موقع انفصال التدفق والدوامات الخلفية (Flow Separation)',
                        type: 'constant',
                        value: 'x/c = 0.38 at 4°, 0.04 at 15° (Stall)',
                        equation: '\\frac{\\partial u}{\\partial y}\\Big|_{wall} = 0 \\implies C_f = 0',
                        description: 'نقطة انعدام إجهاد القص الجداري وتحول التدفق إلى دوامات انفصال مضطربة في الأثر الخلفي.',
                      })
                    }
                    className="text-right px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 flex items-center justify-between transition-colors"
                  >
                    <span>3. خطوط الانفصال (Wake Region)</span>
                    <span className="font-mono text-xs font-bold">y+ &lt; 1</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPin({
                        title: 'دخل مائع التبادل الحراري (HTF Inlet - Oscillating Temp)',
                        type: 'input',
                        value: 'Tin(t) = 348 + 10·sin(2πt / 1200 s), ṁ = 0.025 kg/s',
                        equation: project.governingEquations[2]?.latex || '\\rho c_p (\\vec{V} \\cdot \\nabla) T = k \\nabla^2 T + \\Phi',
                        description: 'مائع التسخين/التبريد (HTF) يتدفق داخل الكويل الحلزوني الأحمر مع موجة حرارية ترددية.',
                      })
                    }
                    className="text-right px-2.5 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/20 flex items-center justify-between transition-colors"
                  >
                    <span>1. الكويل الحلزوني للـ HTF (Input)</span>
                    <span className="font-mono text-xs font-bold">348 K</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPin({
                        title: 'مادة تغيير الطور النانوية (NePCM Annulus)',
                        type: 'constant',
                        value: 'RT50 Organic PCM + Al2O3 Nanoparticles (3 vol.%)',
                        equation: project.governingEquations[0]?.latex || '\\nabla \\cdot (\\rho \\vec{V}) = 0',
                        description: 'الأسطوانة الداخلية تحتوي على شمع عضوي مدمج بجسيمات نانوية لرفع التوصيل الحراري بنسبة 35%.',
                      })
                    }
                    className="text-right px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/20 flex items-center justify-between transition-colors"
                  >
                    <span>2. قلب مادة NePCM (Constant)</span>
                    <span className="font-mono text-xs font-bold">T_melt = 321 K</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPin({
                        title: 'الغلاف الأسطواني الخارجي (Cinthane/Glass Shell)',
                        type: 'output',
                        value: 't95 = 2.504 h (Optimal Melting Time)',
                        equation: project.governingEquations[1]?.latex || '\\rho (\\vec{V} \\cdot \\nabla) \\vec{V} = -\\nabla p + \\mu \\nabla^2 \\vec{V}',
                        description: 'الغلاف الخارجي العازل الذي يحوي وسط التخزين الحراري محققاً زمناً قياسياً قدره 2.504 ساعة.',
                      })
                    }
                    className="text-right px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/20 flex items-center justify-between transition-colors"
                  >
                    <span>3. الغلاف الأسطواني (Output)</span>
                    <span className="font-mono text-xs font-bold">2.504 h</span>
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="absolute bottom-3 left-3 bg-slate-900/80 px-3 py-1.5 rounded-full border border-slate-800 text-[10px] text-slate-400 font-mono">
            {isFEA
              ? 'التوجيه: الجائز الأزرق يمثل I-Beam، والقاعدة الرمادية تمثل التثبيت، وهالة الأحمر تمثل تمركز الإجهاد.'
              : isCFD
              ? 'التوجيه: المقطع الأزرق يمثل جناح NACA 0012، والمنطقة العلوية تمثل قمة الامتصاص وخطوط الانسياب الخضراء.'
              : 'التوجيه: الغلاف الشفاف يمثل الأسطوانة، والكويل الأحمر هو أنبوب مائع التبادل الحراري (HTF).'}
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
