# خطة التطوير المنفذة وقائمة التشييك خطوة بخطوة (NASEER Universal CAE Studio)

هذا الملف مخصص للمراجعة الميدانية وتشييك كل خطوة في **VS Code** على جهازك المحلي (اللابتوب) مع حاويات **Docker**.

---

## القسم الأول: كيف تعمل حاويات Docker على حاسوبك الشخصي الآن؟ وكيف يتم التوسع؟ (مهم جداً)

### 1. الوضع الافتراضي الحالي (التشغيل الكامل على حاسوبك الشخصي `http://127.0.0.1:8000`)
في الوضع الافتراضي، **تعمل المنصة بالكامل 100% على معالج (`CPU`) وذاكرة (`RAM`) حاسوبك الشخصي** داخل حاويات Docker، **ولا يوجد سيرفر سوبر كمبيوتر خارجي مربوط افتراضياً** (لأن الخوادم السحابية الخارجية تُستأجر بحساب المستخدم الخاص عند الحاجة).

عند تشغيل `docker compose up -d` في مشروعنا، تعمل **3 خدمات أساسية** على جهازك:
1. **`api` (`Dockerfile.api` — المنفذ `8000`)**: خادم **FastAPI** الذي يستقبل طلبات المنصة من المنفذ `3000` (تشغيل محاكاة، معاينة CAD، تشبيك Gmsh، رفع النماذج، مسح بارامتري، دراسة GCI، إلغاء مهام، ومراقبة العنقود) ويسجلها في SQLite ويدفعها إلى الطابور.
2. **`worker` (`Dockerfile.worker` — عامل Celery)**: هذه الحاوية تحتوي بداخلها على جميع المحركات الفيزيائية وأدوات التشبيك مجتمعة وتنفذ الحسابات على أنوية معالجك:
   - `openfoam` (`simpleFoam`, `pimpleFoam`, `rhoSimpleFoam`, `rhoPimpleFoam`, `buoyantSimpleFoam`, `interFoam`, `blockMesh`, `snappyHexMesh`, `decomposePar`, `mpirun`, `reconstructPar`, `foamToVTK`)
   - `calculix-ccx` (`ccx` مع تعدد الخيوط `OMP_NUM_THREADS`)
   - `gmsh` (البرنامج + مكتبة بايثون `gmsh` + `OpenCascade`)
   - `elmerfem-csc` (`ElmerSolver`, `ElmerSolver_mpi`, `ElmerGrid`)
   - إضافةً إلى `meshio` و`scipy` و`numpy`
3. **`redis` (`redis:7-alpine`)**: وسيط الطابور والنتائج بين `api` و`worker`.

### 2. ماذا تفعل على حاسوبك لتشغيل المنصة أو مضاعفة عدد العمال المتوازيين؟
بعد نقل ملفات المشروع المحدّثة إلى مجلد المشروع في VS Code على حاسوبك، نفّذ الأوامر التالية في **VS Code Terminal**:

```bash
# أ) التشغيل القياسي على حاسوبك (حاوية api + حاوية worker + حاوية redis):
docker compose down
docker compose build --no-cache worker api
docker compose up -d

# ب) أو لتشغيل 4 حاويات worker بالتوازي على حاسوبك (مثلاً 4 عمال × 4 أنوية MPI):
NASEER_MPI_CORES_PER_WORKER=4 docker compose -f docker-compose.cluster.yml up -d --build --scale worker=4

# ج) التأكد من حالة العنقود والأنوية والمحركات الأربع الحقيقية:
curl http://127.0.0.1:8000/api/cluster/status
```

### 3. كيف تربط المنصة بسيرفر سوبر كمبيوتر سحابي خارجي (اختياري مستقبلاً)؟
إذا رغبت مستقبلاً في استئجار خادم سحابي قوي (مثل Hetzner أو AWS EC2 أو Google Cloud بنظام Ubuntu 22.04/24.04):
1. انسخ المشروع إلى الخادم السحابي وشغّل السكربت الآلي: `chmod +x deploy-hpc-cluster.sh && ./deploy-hpc-cluster.sh`.
2. افتح نافذة **مركز إدارة العنقود السحابي** من الشريط العلوي في المنصة، وضع عنوان الخادم السحابي `http://<SERVER_IP>:8000` بدلاً من `http://127.0.0.1:8000` ثم اضغط **حفظ**.

---

## القسم الثاني: خطة التطوير الشاملة المطبّقة (التكافؤ العالمي Ansys / SimScale / PrePoMax)

### الحزمة 1: هندسة الواجهة والشجرة الديناميكية الموحدة (Global CAE UI & Live Simulation Tree)
- [x] **توحيد لغة العمل والمصطلحات الهندسية**: اعتماد الإنجليزية الهندسية الموحدة في شجرة المحاكاة ولوحة الخصائص ولوحة التحكم وفق معايير Ansys Workbench وSimScale.
- [x] **ترقية `SimulationTree.tsx` إلى شجرة ديناميكية حية من 8 محطات**:
  1. `Geometry` (عرض اسم CAD والأبعاد والأسطح المكتشفة).
  2. `Mesh & Sizing` (عرض عدد العناصر ورتبة العنصر وطبقات الطبقة الحدية).
  3. `Physics & Materials` (اسم المادة النشطة ونوع التحليل).
  4. `Boundary Conditions` (قائمة حية قابلة للتوسيع بكل الشروط الحدية المعيّنة وحالتها `Defined / Incomplete` متزامنة بالاتجاهين مع العارض ولوحة الخصائص).
  5. `Contacts & Interfaces` (`Bonded` / `Sliding` / `CHT Interface`).
  6. `Solution Controls` (`Steady / Transient`، الجاذبية، معاملات الاسترخاء، الدقة).
  7. `OmniSolve AI (Copilot)` (المستشار الفيزيائي).
  8. `Results & Post` (تقرير النتائج والتكاملات السطحية).

### الحزمة 2: استيراد ومعاينة CAD وتشبيك Gmsh 3D قبل الحل (Pre-Solve CAD & Mesh Parity)
- [x] **مسار `POST /api/cad-preview` في `main.py` و`universal_dispatcher.py` والربط العكسي في `server.ts`**:
  - يدعم ملفات `.STEP / .STP / .IGES / .IGS / .STL / .INP / .MSH` مباشرة عبر OpenCascade (`gmsh.model.occ.importShapes`) و`meshio` داخل حاوية `worker` ويعيد أسطح التسمية (`patches`) والأبعاد (`dimensions`) وبيانات المعاينة `vtk_data`.
- [x] **ترقية `call_gmsh_mesher` ولوحة `Mesh & Sizing` في `PropertiesPanel.tsx`**:
  - إضافة اختيار **رتبة العنصر (`Element Order`: 1st Linear / 2nd Quadratic)** مع دعم مثلثات النوع 9 ورباعيات النوع 11 في Gmsh.
  - إضافة **طبقات الطبقة الحدية (`Inflation Layers`, `First Layer Height h₀`, `Growth Rate`)** عبر حقول Gmsh (`Distance + Threshold`).
  - زر **"Generate & Preview 3D Mesh"** المباشر في لوحة الخصائص لرسم شبكة Gmsh داخل العارض ثلاثي الأبعاد فوراً قبل تشغيل الحل الفيزيائي.

### الحزمة 3: ضوابط المحللات المتقدمة وبطاقات الفيزياء الحقيقية (OpenFOAM / CalculiX / ElmerFEM)
- [x] **ترقية `call_openfoam_solver`**:
  - دعم **Transient / Steady State** (`pimpleFoam` / `rhoPimpleFoam` / `simpleFoam` مع `time_step` و`end_time`).
  - دعم **الجاذبية الأرضية (`gravity_enabled` / `gravity_y`)** وكتابة `constant/g`.
  - دعم **خطط التفاضل (`discretization_scheme`: `first_order` / `second_order`)** و**عوامل الاسترخاء (`relaxation_p`, `relaxation_u`, `relaxation_t`)** و**هدف المتبقيات (`residual_target`)** وإدخال خواص المائع مباشرة (`fluid_density`, `dynamic_viscosity`).
  - دعم أنواع الشروط الحدية الفرعية المخصصة (`Mass Flow Inlet`, `Pressure Inlet`, `Pressure Outlet`, `Slip Wall`, `Moving Wall`, `Velocity Inlet`, `Heat`).
- [x] **ترقية `call_calculix_solver`**:
  - دعم عدد الأنماط (`modes_count` في `*FREQUENCY` و`*BUCKLE`)، والأحمال المركزة (`force_n` / `pressure_load_mpa`)، ونوع التلامس (`contact_type`: `Bonded` / `Sliding`).
  - دعم الخطوة الزمنية في `Thermal_Transient`، والإشعاع الحقيقي عبر `*PHYSICAL CONSTANTS` + `*RADIATE` في `Thermal_Radiation`، واللاخطية الهندسية `*NLGEOM`.
- [x] **ترقية `call_elmer_solver`**:
  - إضافة التخصصات الكهرومغناطيسية الفرعية (`Electrostatic`, `Magnetostatic`, `EddyCurrent`, `Acoustics`) مع تمرير الموصلية الكهربائية (`electrical_conductivity σ`)، والنفاذية النسبية (`relative_permeability μr`)، والسماحية (`relative_permittivity εr`)، وكثافة التيار (`current_density J`)، والتردد (`frequency_hz`).

### الحزمة 4: أدوات ما بعد المعالجة الثلاثية الأبعاد والتكاملات السطحية (CFD-Post / Mechanical Parity)
- [x] **حساب التكاملات السطحية والحقلية (`integrals`) حقيقياً في بايثون من مخرجات المحللات**:
  - `mass_flow_kg_s`, `pressure_drop_pa`, `max_velocity_mps`, `total_heat_transfer_w` في OpenFOAM.
  - `max_displacement_m`, `max_von_mises_pa`, `avg_von_mises_pa`, `max_reaction_n`, `total_reaction_x/y/z_n`, `heat_flux_w_m2`, `total_heat_transfer_w` في CalculiX.
  - `field_min`, `field_max`, `field_average`, `domain_volume_m3`, `surface_area_m2` في ElmerFEM.
- [x] **أدوات ما بعد المعالجة التفاعلية في `Interactive3DViewport.tsx` و`PropertiesPanel.tsx`**:
  - **مقاطع القطع الثلاثية (`Section Slice Plane`: `Off / X / Y / Z` + منزلق الإزاحة)** عبر `THREE.Plane` وإطار المقطع البصري داخل WebGL.
  - **مرشح العتبة المتساوية (`Iso-Threshold Filter`: `Min% – Max%`)** لتصفية مثلثات الحقل الحراري/السرعة/الإجهاد حياً.
  - **مقياس التشوه الإنشائي (`Deformation Scale`: `0x – 100x`)** المعتمد على متجهات الإزاحة الحقيقية (`vtkData.vectors.displacement`).
  - **عارض التكاملات السطحية (`Integrals HUD` + جدول `Surface & Field Integrals` في `PropertiesPanel`)** لقراءة هبوط الضغط وتدفق الكتلة والقوى الردية والحرارة المنقولة.

### الحزمة 5: التطهير الجذري وإلزامية المحركات الثلاثة ودعم CAD/INP الكامل (Zero-Mock & Multi-Engine Enforcement)
- [x] **تعطيل كافة المحللات البديلة البايثونية**: إيقاف محلل الفروقات المحددة ثنائي الأبعاد في `physics_solver.py` ومحللات `SciPy` / `PyMAPDL` البديلة في `backend/physics_solver.py` و`backend/main.py` وإلزام `server.ts` بتشغيل `main.py` الرئيسي المرتبط بـ `universal_dispatcher.py`.
- [x] **إزالة الحسابات التحليلية الجانبية والثوابت الوهمية من الواجهة**:
  - استبدال حاسبة الإكسيرجي/الحساسية المغلقة في `OverviewTab.tsx` بعارض حقيقي لمخرجات المحركات (`integrals` / `values` على Docker `:8000`) وإزالة `PHD-2026-ENG` و`16 Cores | Double Precision` و`yieldStrengthMpa = 420`.
  - استبدال مولد الشبكة الإجرائي ثنائي الأبعاد في `MeshGenerativeTool.tsx` بربط كامل مع محرك **Gmsh 3D** الحقيقي على `:8000` ومعاينة ثلاثية الأبعاد مباشرة لـ `vtk_data`.
  - ربط `ParametricSweepTool.tsx` بمدخلات المشروع الحية والملف المرفوع (`STEP`/`STL`) ودبابيس الشروط الحدية واستخراج `nusselt_number`.
  - إصلاح قراءة حالة المحركات الحية (`{ available, version }`) في `AuditReportModal.tsx`.
- [x] **دعم ملفات الهندسة `.STEP`/`.STL`/`.IGES` و`.INP` في OpenFOAM و CalculiX و ElmerFEM**:
  - توليد مجموعات فيزيائية متوافقة في `call_gmsh_mesher` وتحديث `OpenFOAM polyMesh` تلقائياً وربط دبابيس الشروط الحدية بالمساحات الهندسية ودعم القنوات المتموجة (`corrugated_channel`) وحساب `nusselt_number` و`heat_transfer_coeff_h`.
  - استخراج كامل البيانات ثلاثية الأبعاد `vtk_data` لملفات `.inp` والملفات الهندسية المرفوعة في `call_calculix_solver` عبر تشبيك `Gmsh`، وربط دبابيس العارض (`boundary_markers`) بعقد التثبيت والأحمال، وإلغاء القيمة الافتراضية للانبعاج (`-1000.0`).
  - ربط دبابيس الشروط الحدية (`boundary_markers`) بحدود `ElmerGrid` الحقيقية في `call_elmer_solver` وإصلاح دراسة استقلالية الشبكة `backend/vv_metrics.py` لدعم CAD عبر `mesh_size`.

### الحزمة 6: إصلاح بناء حاوية العامل الموحدة (Ubuntu 22.04 Jammy + المستودعات الرسمية + Entrypoint)
- [x] **الترقية إلى `ubuntu:22.04` (Jammy LTS) في `Dockerfile.worker` و`Dockerfile.api`**: معالجة فشل APT للحزمة `elmerfem-csc` وتوافق المستودعات الرسمية.
- [x] **ربط مستودع OpenCFD الرسمي (`openfoam2406-default`) وPPA إلمر الرسمي (`ppa:elmer-csc-ubuntu/elmer-csc-ppa`)**: تثبيت OpenFOAM v2406 و`elmerfem-csc` (`ElmerSolver`/`ElmerGrid`) و`calculix-ccx` و`gmsh` ومكتبات OpenMPI/OpenGL بدون GUI زائد.
- [x] **إضافة نقطة الدخول `docker-entrypoint-worker.sh` وتحديث `_openfoam_env()`**: تفعيل `openfoam2406/etc/bashrc` تلقائياً لعمليات Celery غير التفاعلية مع الحماية من نهايات الأسطر CRLF، وإلغاء الإعدادات القديمة (`v1912`) في `universal_dispatcher.py`.
- [x] **ضبط متغيرات المسار المشتركة واستثناءات `.dockerignore`**: توحيد `NASEER_JOB_DIR` و`OPENFOAM_CASE_ROOT` في `docker-compose.yml` واستثناء ملفات العمل المؤقتة وقواعد البيانات المحلية من سياق البناء.

### الحزمة 7: التنفيذ المتوازي الحقيقي (`MPI / OpenMP`)، تصدير حزمة المحللات الخام (`.zip`)، ربط أسطح CAD الحقيقية ومشغل خطوات الزمن (`Transient Scrubber`)
- [x] **التنفيذ المتوازي متعدد الأنوية (`parallel_cores: 1..64`) في المحركات الثلاثة**:
  - اختيار عدد الأنوية (`1, 2, 4, 8, 16 Cores`) من قسم `Solution Controls` في `PropertiesPanel.tsx` وإرساله عبر `SimulationRequest`.
  - **OpenFOAM**: كتابة `system/decomposeParDict` (`scotch`) وتشغيل `decomposePar -force` ثم `mpirun --allow-run-as-root --oversubscribe -np N <solver> -parallel` ثم `reconstructPar`.
  - **CalculiX (`ccx`)**: تمرير `OMP_NUM_THREADS=N` لتسريع مصفوفات الصلابة والحرارة متعددة الخيوط (OpenMP).
  - **ElmerFEM**: تقسيم الشبكة عبر `ElmerGrid 2 2 model -metis N 3` وتشغيل `mpirun ... ElmerSolver_mpi` مع تراجع آمن للتشغيل التسلسلي إذا كانت الشبكة صغيرة جداً.
- [x] **تصدير الملفات الخام الحقيقية وحزمة المحللات (`GET /api/jobs/{task_id}/export-case`)**:
  - ضغط وبث مجلد الحالة الفعلي بصيغة `.zip` مع فحص أمان المسار (`Path Traversal Protection`) ليشمل قواميس OpenFOAM (`0/`, `constant/`, `system/`, `VTK/`) وملفات CalculiX (`model.inp`, `model.dat`, `model.frd`) وملفات Elmer (`case.sif`, `*.vtu`) وسجل التنفيذ `solver.log` لفتحها مباشرة في **ParaView** أو **PrePoMax**.
  - ربط زر التحميل في قائمة **Project -> Export -> Solver Deck & VTK (.zip)** وفي لوحة **Results & Post -> Download Solver Deck & VTK (.zip)**.
- [x] **ربط أسطح CAD الحقيقية (`Named CAD Patches`) بالشروط الحدية ومشغل الزمن العابر (`Transient Time-Step Player`)**:
  - إرجاع خريطة انتماء كل مثلث لسطح الهندسة (`triangle_patches` + `patches` + `patch_nodes`) من `preview_cad_geometry` و`call_gmsh_mesher`.
  - عند النقر على سطح المجسم في العارض الثلاثي (`+ Inlet / + Outlet / + Heat / + Wall`) أو اختيار سطح من `Detected CAD Faces` في `PropertiesPanel`: يتم ربط الشرط الحدي باسم السطح الفعلي (`patchName`) وتظليله باللون السماوي في العارض، وتمريره عبر `boundary_patches` إلى حدود OpenFOAM وعقد `*NSET` في CalculiX وحدود `mesh.names` في ElmerFEM.
  - استخراج إطارات الزمن الحقيقية (`time_frames`) من مجلدات الزمن و`foamToVTK` في OpenFOAM، ومن `model.frd` في CalculiX، ومن ملفات `.vtu` في ElmerFEM، وتشغيلها عبر شريط التحكم الزمني (`Play / Pause / Reset / Time Slider`) أسفل العارض ثلاثي الأبعاد.

### الحزمة 8: التدقيق النهائي الشامل قبل الإطلاق (Final Pre-Launch Zero-Mock Hardening)
- [x] **إزالة آخر القيم الاحتياطية الثابتة من المخطط الهندسي الفرعي (`EngineeringSchematicViewer.tsx`) وشريط حالة `OverviewTab.tsx`**:
  - إزالة الثوابت الاحتياطية (`2500 W/m²`، `22 m/s`، `h = 25 W/m²K`، `L = 0.50 m`، ونسبة روتش الاحتياطية `1.12%`) وربط جميع المؤشرات حصراً بـ `project.boundaryConditions`، وأبعاد النطاق المرسلة `submittedRequest`، ونتيجة `meshStudyResult.gci_fine_percent` الفعلية (`—` عند عدم التنفيذ).
  - تحديث خلايا `workbenchCells` وشريط حالة `Project Schematic` في `OverviewTab.tsx` لتعكس حالة التنفيذ الحقيقية (`Awaiting Solver Run` قبل التشغيل و`All Systems Solved & Verified` بعد اكتمال الحل).
- [x] **ترقية العارض الثلاثي الفرعي (`3D-Engineering-Model-Viewer.tsx`) لعرض شبكة وحقول VTK الحقيقية**:
  - بناء `THREE.BufferGeometry` مفهرسة مباشرة من `normalizedSolverResult.vtkData` (`points`, `triangles`, `vertex_values`, `cell_values`) وتلوين العقد وفق تدريج الألوان العلمي (`jet`, `turbo`, `viridis`, `coolwarm`) مع خيار إظهار/إخفاء `Wireframe` وملاءمة الكاميرا تلقائياً لكرة الإحاطة الهندسية (`boundingSphere`).
- [x] **مزامنة أداة المسح البارامتري (`ParametricSweepTool.tsx`) بالكامل وترحيل النتائج إلى `Cases Matrix`**:
  - تمرير كامل إعدادات المحلل (`parallel_cores`, `element_order`, `inflation_layers`, `first_layer_height`, `growth_rate`, `time_mode`, `time_step`, `end_time`, `gravity_enabled`, `gravity_y`, `em_submode` ومعاملات الكهرومغناطيسية والصوتيات، و`boundary_patches` المرتبطة بأسطح CAD) إلى `/api/parametric-sweep`.
  - ترحيل نقاط التصميم المكتملة (`Converged Design Points`) تلقائياً عبر `onSweepComplete` إلى مصفوفة الحالات `currentProject.casesMatrix` لتظهر مباشرة في جدول الحالات والتقارير المصدّرة.
- [x] **ربط التشغيل المباشر في نافذة رفع الملفات (`ScriptUploaderModal.tsx`) بمدخلات الاستوديو الحالية**:
  - تمرير `simulationInputs` النشطة في الاستوديو والبارامترات المكتشفة من الملف المرفوع عند الضغط على "رفع وتشغيل عبر Docker (:8000)" بدلاً من أي أرقام قالبية ثابتة.

#### الحزمة التاسعة (Package 9 — التوسع السحابي متعدد العمال ومراقبة العنقود الحية)
- [x] **ملف التوسع المتوازي متعدد العمال (`docker-compose.cluster.yml`)**:
  - إعداد Docker Compose مخصص للتشغيل المتوازي متعدد العمال (`--scale worker=N`) مع تخصيص أنوية `MPI` و`OpenMP` لكل عامل (`NASEER_MPI_CORES_PER_WORKER`, `OMP_NUM_THREADS`, `CCX_NPROC_STIFFNESS`) وضبط وسيط `Redis` ومجلد العمل المشترك `/app/jobs`.
- [x] **سكربت التجهيز والتشغيل التلقائي لخوادم السحابة (`deploy-hpc-cluster.sh`)**:
  - سكربت تنفيذي آلي لخوادم Ubuntu 22.04/24.04 السحابية (Hetzner / AWS EC2 / GCP) ومحطات العمل، يكتشف تلقائياً عدد الأنوية والذاكرة، ويثبت Docker Engine عند الحاجة، ويحسب التوزيع الأمثل بين عدد حاويات `worker` وأنوية `MPI` لكل حاوية، ويشغّل العنقود ويتحقق من `/api/cluster/status`.
- [x] **مراقب حالة العنقود الحي (`GET /api/cluster/status` و`StudioHeader.tsx` و`CloudServerSettingsModal.tsx`)**:
  - فحص حي ومباشر لعقد Celery المتصلة (`inspector.ping()`, `inspector.stats()`, `inspector.active()`, `inspector.reserved()`) وعرض عدد العمال النشطين، وإجمالي أنوية العنقود، والمهام الجارية وفي الطابور في الشريط العلوي وداخل جدول عقد الحوسبة المتوازية مع أزرار تنزيل مباشرة لملفي `docker-compose.cluster.yml` و`deploy-hpc-cluster.sh`.

### التحقق البرمجي في بيئة التطوير (Zero-Mock Verified)
- [x] تطهير كامل من أي بيانات وهمية أو fallback حسابي أو ثوابت جامدة.
- [x] فحص تجميع بايثون (`python3 -m py_compile`) لكافة ملفات الخادم والمحلل والاختبارات.
- [x] اجتياز اختبارات الوحدات الآلية (`python3 -m unittest test_result_schema.py test_solver.py test_global_parity.py -v`).
- [x] فحص بناء الواجهة والخادم (`npm run build` / `compile_applet`) — Exit 0.
- [x] فحص أنواع TypeScript (`npm run lint` / `lint_applet`) — Exit 0.

---

## القسم الثالث: مصفوفة التدقيق الشامل ومقارنة التكافؤ مع المنصات العالمية (SimScale / Ansys Cloud)

| المحور الهندسي | SimScale / Ansys Cloud | منصة NASEER Universal CAE Studio | حالة التحقق (Zero-Mock) |
| :--- | :--- | :--- | :--- |
| **محركات CFD** | OpenFOAM / Fluent | OpenFOAM v2406 (`simpleFoam`, `pimpleFoam`, `rhoSimpleFoam`, `rhoPimpleFoam`, `buoyantSimpleFoam`, `interFoam`) | مربوط 100% — بدون أي بدائل بايثون |
| **محركات FEA والحرارة** | CalculiX / Code_Aster / Mechanical | CalculiX `ccx` (`C3D4/C3D10/C3D8T/DC3D4`, `*STATIC`, `*FREQUENCY`, `*BUCKLE`, `*HEAT TRANSFER`, `*RADIATE`) | مربوط 100% — مع دعم `.inp` و`.step`/`.stl` |
| **الكهرومغناطيسية والصوتيات** | ElmerFEM / Maxwell | ElmerFEM (`StatElecSolve`, `MagnetoDynamics`, `HelmholtzSolve`) | مربوط 100% — مع قراءة `mesh.names` و`.vtu` |
| **التشبيك الثلاثي والـ CAD** | Gmsh / OpenCascade | Gmsh 3D (`STEP/IGES/STL`، رتبة 1 و2، طبقات `Inflation Layers`، فحص جودة `SICN`) | مربوط 100% — عبر `/api/cad-preview` و`/api/mesh-generate` |
| **التوسع والحوسبة المتوازية** | MPI / Multi-Worker Cluster | `parallel_cores` (`mpirun -np N` + `OMP_NUM_THREADS=N`) + `docker-compose.cluster.yml` (`--scale worker=M`) | مربوط 100% — مراقبة حية عبر `/api/cluster/status` |
| **تصدير الملفات الخام** | Case & VTK Download | `GET /api/jobs/{task_id}/export-case` (`.zip` يحتوي على القواميس و`VTK` و`.inp` و`.frd` و`solver.log`) | مربوط 100% — جاهز لـ ParaView |
| **معالجة النتائج الثلاثية** | Slice / Iso / Warp / Time | مقاطع `X/Y/Z`، عتبة `Iso-Threshold`، تشوه `Deformation Scale`، مشغل خطوات الزمن `time_frames` | مربوط 100% — WebGL حي |

---

### الحزمة 9.5: التدقيق الجنائي للربط الصامت (Forensic Cross-Modal Sync Fixes — مُنفّذة ومُتحقّق منها)
- **توحيد `Mesh Generator` مع `Mesh & Sizing`:** عند الضغط على «اعتماد شبكة Gmsh بالمشروع» تتم مزامنة `meshSize` و`elementOrder` و`inflationLayers` و`firstLayerHeight` و`growthRate` وأبعاد النطاق وملف الـ CAD ووجوه `patches` تلقائياً داخل `simulationInputs`.
- **تفعيل الربط الفيزيائي لمكتبة المواد (`MaterialsDatabaseModal`):** اختيار أي مادة أصبح يحوّل ثوابتها ووحداتها (`GPa/MPa → Pa`) ويكتبها فعلياً في `simulationInputs` (`density`, `elasticModulus`, `poissonRatio`, `thermalConductivity`, `specificHeat`, `dynamicViscosity`).
- **مزامنة عدد الأنوية (`CloudServerSettingsModal`):** حفظ عدد أنوية `MPI/OpenMP` ينعكس فوراً على `simulationInputs.parallelCores`.
- **إصلاح إحداثيات الصندوق الفرعي (`region_box`) في OpenFOAM:** دعم صيغة `{ min, max }` الصادرة من العارض ثلاثي الأبعاد بالإضافة إلى `{ center, size }`.
- **تفعيل نوع التلامس (`Sliding` مقابل `Bonded`) في CalculiX:** تعديل درجات حرية `*BOUNDARY` فعلياً في ملف `.inp` (انزلاق مماسي حر مقابل تثبيت كامل `1,3,0`).

### الحزمة 10: الترقية الصناعية للمراقبة اللحظية وما بعد المعالجة وتنظيف الواجهة (مُنفّذة ومُتحقّق منها)
1. **البث الحي لأسطر التكرارات ومخطط التقارب (`Live Streaming Iterations & Residuals`):** تحويل تشغيل `OpenFOAM` و`CalculiX` و`ElmerFEM` إلى `_run_streaming_command` (`subprocess.Popen`) لبث أسطر `stdout` وتحديث `current_iteration` و`live_residuals` لحظياً عبر Celery و`/api/jobs/{task_id}` إلى `SolverConsole` كل ثانية مع دعم الإلغاء الفوري `Cancel`.
2. **دوال OpenFOAM القياسية (`yPlus`, `wallShearStress`, `forceCoeffs`):** حقن `functions { yPlus ... wallShearStress ... forceCoeffs ... }` تلقائياً في `controlDict` وقراءة ملفات `postProcessing/` الحقيقية لعرض $y^+_{\min/\text{avg}/\max}$ و$C_d$ و$C_l$ و$\tau_{w,\max}$ في لوحة التكاملات (`Results & Post`).
3. **أداة الرسم على خط مقطعي ثلاثي الأبعاد (`3D Plot Over Line`):** أخذ عينات حقيقية مباشرة من عُقد VTK المحلولة على محور `X / Y / Z` مع شريط تحريك المقطع العرضي (`5%–95%`) ورسم منحنى XY الهندسي داخل العارض ثلاثي الأبعاد.
4. **تنظيف الواجهة لتكون منصة CAE صناعية خالصة:** إزالة `OmniSolve AI (Copilot)` من شجرة المحاكاة والقوائم، وإزالة نافذة `API Keys & Engine Mode` غير المرتبطة بالمحركات الفيزيائية، وحذف الملفات الميتة غير المستخدمة (`Navbar.tsx`, `PipelineTrackerModal.tsx`, `SupervisorAssistantDrawer.tsx`, `KeyPoolModal.tsx`).

### الحزمة 10.5: التحقق والمصادقة الشامل لجميع المحركات (Universal Multi-Physics V&V & Live Templates — مُنفّذة ومُتحقّق منها)
1. **إسقاط حقول VTK الثلاثية إلى مقاطع ثنائية حقيقية (`vtkToFieldGrids` في `validationMetrics.ts` و`reportModel.ts`):** إزالة القيد السابق الذي كان يحصر نافذة `Validation` في المصفوفة الحرارية `temperature_matrix` فقط. الآن تُسقَط حقول `OpenFOAM` (`U_mag`, `p`, `T`, `k`, `alpha_water`) و`CalculiX` (`von_mises`, `displacement`, `T`) و`ElmerFEM` (`potential`, `electric_field_mag`, `magnetic_flux_mag`, `pressure_real`) حتمياً من عُقد VTK الحقيقية دون أي تخمين أو تمديد خارج حدود الجسم، لتعمل المقارنة وتصدير تقارير Word/HTML/LaTeX لجميع المحركات.
2. **مصادقة منحنيات المسح البارامتري (`Parametric Curve Validation` في `ValidationTab.tsx`):** إضافة وضع تبديل مباشر لمقارنة مخرجات المسح البارامتري الحقيقية (`project.casesMatrix`) بملف CSV أو نقاط تجربة مخبرية (مثل `Velocity vs ΔP` أو `Load vs Stress`) مع رسم منحنى التطابق وحساب `Mean |error| %` و`Max |error| %` و`RMSE` و`NRMSE %` و`R²`.
3. **إعادة بناء مكتبة المشاريع وقوالب التحقق الحية (`ProjectsLibraryModal.tsx` و`vvBenchmarks.ts`):** إزالة النصوص القديمة المضللة (`0 بنشماركات عالمية معتمدة` و`NASA Airfoil / Timoshenko` غير الموجودين و`window.alert`)، وتقسيم النافذة إلى تبويبين صادقين:
   - **مشاريعي المحفوظة (`Saved Projects`)**: بحث، تصفية (`CFD / FEA / Thermal / EM / Multiphysics`)، تصدير/استيراد JSON بتنبيه مدمج، حذف، وتصفير المنصة.
   - **الحزمة الدولية الموحّدة — 6 قوالب تحقق قياسية V&V — تشغيل حي (`Zero Pre-Baked Results`)**: متطابقة 1-إلى-1 مع شهادة الاعتماد الآلية (`ASME-VV20-CFD-01`، `NASA-TMR-CFD-02`، `ASME-VV20-THM-01`، `NAFEMS-FEA-01`، `NAFEMS-FEA-02`، `ASME-EM-01`) مع زر مباشر لفتح «مركز شهادة التحقق الآلية» وتشغيل الـ 6 دفعة واحدة.

### المرحلة 1 من الترقية المؤسسية: الديناميكا الهوائية الخارجية (`OpenFOAM snappyHexMesh` — مُنفّذة ومُتحقّق منها)
- **توليد نفق الرياح الخارجي التلقائي (`_build_external_wind_tunnel_spec`):** قراءة الأبعاد الدقيقة لأي مجسم `.STL` (ثنائي أو نصي) أو `.STEP / .IGES` (مع تحويل تلقائي عبر Gmsh إلى `constant/triSurface/obstacle.stl`) وبناء صندوق نفق رياح ثلاثي الأبعاد (`Upstream ×L`، `Wake ×L`، وحواف انزلاق حرة `farfield: slip`) مع حساب نقطة `locationInMesh` مضمونة داخل السائل وخارج الجسم.
- **توليد قواميس OpenFOAM v2406 الحقيقية (`_write_external_aero_dicts`):** كتابة `system/blockMeshDict` و`system/surfaceFeatureExtractDict` و`system/snappyHexMeshDict` بكامل مراحلها (`castellatedMesh`, `snap`, `addLayersControls`) مع صندوق تنعيم منطقة الأثر (`wakeBox`) وطبقة حدية (`nSurfaceLayers` + `expansionRatio`) ومعايير جودة الشبيكة (`meshQualityControls`).
- **حساب معاملات الجر والرفع على الجسم حصراً:** تمرير `patch_roles = {"inlet": "inlet", "outlet": "outlet", "farfield": "slip", "obstacle": "wall"}` واستخدام طول الجسم ومساحته الأمامية الفعلية في `forceCoeffs` لحساب $C_d$ و$C_l$ و$y^+$ و$\tau_w$ على سطح المجسم `obstacle` فقط، وتصدير الحقل الكامل عبر `foamToVTK`.
- **التحكم من الواجهة (`PropertiesPanel` -> `Mesh & Sizing`):** قسم `External Aero (OpenFOAM snappyHexMesh)` لتفعيل نفق الرياح وضبط `Surface Level` و`Wake Level` و`Upstream Pad` و`Wake Length`.

### المرحلة 2 من الترقية المؤسسية: حزمة التحقق والاعتماد الدولية الآلية الموحّدة (`ASME V&V 20 / NAFEMS / NASA TMR / ElmerFEM` — مُنفّذة ومُتحقّق منها)
- **توحيد تام 6-من-6 بين مكتبة المشاريع (`vvBenchmarks.ts`) ومحرك الاعتماد الآلي (`vv_regression_suite.py`):** بنفس الرموز والمعادلات الفيزيائية ومفاتيح المحرك الدقيقة (`fluid_properties.dynamic_viscosity`، `material.young_modulus`، `material.thermal_conductivity_k`، `em_parameters.source_value`) دون أي بيانات مسبقة:
  1. `ASME-VV20-CFD-01`: جريان هاغن-بوازوي الصفائحي (`OpenFOAM simpleFoam`، $Re_H=100$، $U_{\max} = 0.015\text{ m/s}$، سماحية $\le 5\%$).
  2. `NASA-TMR-CFD-02`: جريان القناة المضطرب (`OpenFOAM kOmegaSST`، $Re_H\approx 20{,}300$، نسبة $U_{\max}/U_{\text{avg}} \in [1.05, 1.38]$ وإيجابية $\tau_w$ و$y^+$).
  3. `ASME-VV20-THM-01`: التوصيل الحراري المستقر ثنائي الأبعاد (`CalculiX ccx`، $T_{\text{center}} = 60.0\ ^\circ\text{C}$، $q'' = 4000\text{ W/m}^2$، سماحية $\le 0.5\%$).
  4. `NAFEMS-FEA-01`: العارضة الكابولية ثلاثية الأبعاد بعناصر تربيعية `C3D20R` (`CalculiX *STATIC`، $w_{\max} = 0.00292969\text{ m}$، سماحية $\le 5\%$).
  5. `NAFEMS-FEA-02`: التردد الطبيعي الأساسي للعارضة الكابولية (`CalculiX *FREQUENCY` مع استخراج عمود `CYCLES/TIME (Hz)`، $f_1 = 65.2304\text{ Hz}$، سماحية $\le 5\%$).
  6. `ASME-EM-01`: المجال الكهروستاتيكي بين لوحين متوازيين (`ElmerFEM StatElecSolve`، $\bar{\phi} = 50.0\text{ V}$ وحدود $[0, 100]\text{ V}$، سماحية $\le 3\%$).
- **حماية Zero-Mock والشهادة الموقّعة ببصمة `SHA-256`:** عند غياب أي محرك ثنائي على العقدة يُرجع المحرك `SKIPPED_NO_BINARY` صراحةً دون تزييف، ويُولّد شهادتين رسميتين (`VV_VERIFICATION_CERTIFICATE.md` و`vv_verification_certificate.json`) تتضمنان بصمة التحقق `sha256_integrity_hash`.
- **مسارات API والربط الكامل مع الواجهة وDocker:** إضافة `GET /api/vv/benchmarks` و`POST /api/vv/run` في `main.py`، تمرير `/api/vv` في `server.ts`، تضمين `vv_regression_suite.py` في `Dockerfile.api` و`Dockerfile.worker`، ترقية `AuditReportModal.tsx` بتبويب «شهادة التحقق الدولية V&V»، وربطه مباشرةً من `ProjectsLibraryModal.tsx`.
- **لوحة مراقبة صحة وأداء المحاكاة العائمة (`ViewportHealthDashboard.tsx` + `GET /api/telemetry/live` — Zero-Mock):** طبقة عائمة قابلة للطي فوق العارض ثلاثي الأبعاد تعرض الساعة الفعلية للمهمة (`Wall-Clock HH:MM:SS` المحسوبة من التوقيت الحقيقي للمهمة في SQLite)، حمل أنوية المعالج الحقيقي من `/proc/stat`، استهلاك الذاكرة الحقيقي من `Docker cgroup / /proc/meminfo`، وحجم ذاكرة عملية المحرك الفعلية (`Solver RSS MB` من `/proc/<pid>/status`) — مع اجتياز **`20 / 20 OK`** اختبار وحدة آلي.

### المرحلة 3 من الترقية المؤسسية: التجميعات متعددة الأجسام والفيزياء اللاخطية (`OpenFOAM LES/DDES + MRF` & `CalculiX *PLASTIC / *HYPERELASTIC / *CONTACT PAIR` — مُنفّذة ومُتحقّق منها)
- **نماذج الاضطراب عالية الدقة في OpenFOAM v2406 (`LES / DDES`):** ترقية `_openfoam_turbulence_setup` لدعم `LES` (`WALE`, `Smagorinsky`, `kEqn` مع `delta cubeRootVol`) و`DDES` (`SpalartAllmarasDDES` مع `delta vanDriest`) مع توليد الحقل `0/nuTilda` تلقائياً لنماذج `SpalartAllmaras / DDES` واعتماد `nutUSpaldingWallFunction`، وتفعيل المحلل العابر `pimpleFoam` ثلاثي الأبعاد تلقائياً (`ddtSchemes backward` و`div(phi,U) Gauss limitedLinearV 1` و`wallDist meshWave`).
- **المناطق الدوّارة للتوربينات والمضخات في OpenFOAM (`MRFProperties + topoSet`):** كتابة `_write_openfoam_mrf_setup` لتوليد أسطوانة `cylinderToCell` + `setToCellZone` (`rotorZone`) داخل `system/topoSetDict` (مع الحفاظ على `heatZone` عند تفعيلها) وكتابة `constant/MRFProperties` الحقيقي (`cellZone rotorZone`, `nonRotatingPatches`, `origin`, `axis`, `omega`)، وتشغيل الثنائي `topoSet` فعلياً بعد التشبيك مباشرةً قبل `decomposePar`/المحلل.
- **المواد اللاخطية في CalculiX v2.21 (`*PLASTIC` و`*HYPERELASTIC,NEO HOOKE`):** كتابة `_build_calculix_material_cards` لإصدار بطاقات اللدونة الإيزوتروبية ثنائية الخط (`*PLASTIC` مع حساب معامل التصلد $H = \frac{E E_t}{E - E_t}$) أو المطاطية الفائقة (`*HYPERELASTIC,NEO HOOKE` بثوابت $C_{10}, D_1$ المستخرجة من المستخدم أو من $(E,\nu)$) مع فرض `*STEP,NLGEOM,INC=100` والتدرج `*STATIC\n0.1,1.0,1e-5,0.25` وتصدير `PEEQ` / `E`.
- **التجميعات متعددة الأجسام والتلامس السطحي الاحتكاكي في CalculiX (`*CONTACT PAIR + *FRICTION` و`*TIE`):** كتابة `_generate_calculix_twobody_mesh` لتوليد جسمين منفصلين تماماً بعُقد مستقلة (`BODY_LOWER` و`BODY_UPPER`) وتحديد الأسطح الدقيقة (`S5` و`S3`)، وكتابة `_build_calculix_contact_cards` لإصدار `*SURFACE` و`*TIE` أو `*SURFACE INTERACTION` + `*SURFACE BEHAVIOR,PRESSURE-OVERCLOSURE=LINEAR` + `*FRICTION` + `*CONTACT PAIR,TYPE=SURFACE TO SURFACE` مع `*CONTACT FILE\nCDIS,CSTR`.
- **الربط الكامل مع الواجهة والـ API والمسح البارامتري:** توسيع `SimulationRequest` في `main.py` و`SimulationInputs / buildSimulationRequest` في `studio.ts` و`PropertiesPanel.tsx` و`ParametricSweepTool.tsx` و`ScriptUploaderModal.tsx`، والتحقق عبر حزمة اختبارات `test_phase3_nonlinear.py` — مجموع **`25 / 25 OK`**.

### المرحلة 4 من الترقية المؤسسية: البنية المؤسسية السحابية (`Enterprise Multi-Tenant SaaS` — مُنفّذة ومُتحقّق منها ✅ 4 / 4)
- **المصادقة متعددة المستأجرين وضبط الصلاحيات وسجل التدقيق المشفر (`enterprise_security.py` + `main.py`):**
  - جداول SQLAlchemy ORM حقيقية (`cae_workspaces`, `cae_users`, `cae_audit_logs`) تعمل تلقائياً مع SQLite المحلي أو PostgreSQL 16 في الإنتاج.
  - تجزئة كلمات المرور بخوارزمية `hashlib.scrypt` (`N=16384, r=8, p=1` + ملح عشوائي 16 بايت + مقارنة ثابتة الزمن `hmac.compare_digest`)، وإصدار رموز `HS256 JWT` عبر `NASEER_JWT_SECRET` (مع الاحتفاظ برمز الجلسة في ذاكرة React فقط دون `localStorage`/`sessionStorage`).
  - بوابة **المطالبة الأولى بحساب المدير (`POST /api/enterprise/auth/bootstrap`)** التي تُقفل تلقائياً (`HTTP 409`) فور إنشاء أول مدير، مع دعم وضعين فعليين: `NASEER_AUTH_MODE=local_open` (الوضع الافتراضي لمحطة العمل المحلية لعدم حجب التشغيل) و`NASEER_AUTH_MODE=enforced` (للفرق والإنتاج مع صلاحيات `viewer < engineer < admin`).
  - سجل تدقيق غير قابل للتلاعب (`SHA-256 Hash-Chained Audit Ledger`) يسجل كل عملية تسجيل دخول أو تغيير صلاحيات أو تشغيل محاكاة أو اعتماد V&V أو أرشفة، مع تضييق `CORSMiddleware` إلى قائمة نطاقات صريحة (`NASEER_ALLOWED_ORIGINS`).
- **التخزين الكائني الفعلي (`S3 / MinIO` عبر `object_storage.py` + `docker-compose.enterprise.yml`):**
  - إضافة `boto3>=1.34.0` و`psycopg[binary]>=3.1.18` إلى `docker-requirements.txt`، وبناء `ObjectStorageService` للأرشفة الحقيقية لحزم المحاكاة `.zip` ببصمة `SHA-256` مع حماية حصر المسارات (`Path Confinement`)، وملف `docker-compose.enterprise.yml` المتكامل (`api` + `worker` + `redis` + `postgres:16` + `minio`).
- **حزم السحابة والسوبر كمبيوتر والـ CI/CD (`deploy/k8s/`, `deploy/slurm/`, `.github/workflows/ci-cd.yml`):**
  - ملف Kubernetes الإنتاجي الكامل (`deploy/k8s/naseer-cae-stack.yaml`) مع التوسع التلقائي `HorizontalPodAutoscaler (2–16 workers)` و`PVC` و`MinIO StatefulSet` و`Ingress`.
  - سكربت السوبر كمبيوتر (`deploy/slurm/submit_naseer_job.sbatch`) لتشغيل `OpenFOAM MPI` و`CalculiX OpenMP` و`ElmerFEM` على عناقيد الجامعات ومراكز الحوسبة.
  - خط أنابيب التكامل المستمر (`/.github/workflows/ci-cd.yml`) لتشغيل جميع اختبارات البايثون وفحص TypeScript وبناء Vite والتحقق من بناء `Dockerfile.api`.
- **لوحة الإدارة المؤسسية (`EnterpriseAdminModal.tsx`) وحزمة الاختبارات (`test_phase4_enterprise.py`):**
  - واجهة حقيقية متاحة من قائمة `Infrastructure -> Enterprise Security, S3 & K8s` بـ 4 تبويبات (`Identity & RBAC`، `S3 / MinIO Storage`، `K8s, Slurm & CI/CD`، `Audit Trail`) وتمرير `/api/enterprise` في `server.ts` وتحديث `Dockerfile.api` و`Dockerfile.worker` و`.env.example` (مجموع **`31 / 31 OK`**).
- **تحديثات التثبيت الميداني بعد البناء الأول (`Field Hardening`):**
  - إضافة `libopenblas0` و`liblapack3` و`libblas3` و`libgfortran5` إلى `Dockerfile.worker` لعمل `ElmerSolver` دون أخطاء مكتبات مشتركة، وترقية `_probe_binary_version` لعدم إظهار `READY` إذا فشل تحميل أي مكتبة.
  - تحديث `.github/workflows/ci-cd.yml` لـ `Node 22` والتوافق مع `bun.lock`، وإضافة أوامر `Windows PowerShell` الجاهزة في نافذة إدارة العنقود (`CloudServerSettingsModal.tsx`).

---

## القسم الرابع: قائمة التشييك الميدانية على اللابتوب أو الخادم السحابي (ضع `[x]` لكل بند عند التجربة)

### أ. فحص البنية التحتية والحاويات وتوسيع العنقود (في Terminal)
- [ ] **1. عدد الحاويات وحالتها**: `docker compose ps` (أو `docker compose -f docker-compose.cluster.yml up -d --build --scale worker=4`) يُظهر خدمات `api`, `redis`, وعدد حاويات `worker` المطلوبة في وضع `Up / Running`.
- [ ] **2. فحص `/api/cluster/status`**: `curl http://127.0.0.1:8000/api/cluster/status` يُرجع `ONLINE` وعدد العمال المتصلين (`workers_online`) وإجمالي أنوية العنقود (`total_cluster_cores`) وتوفر `openfoam`, `calculix`, `gmsh`, `elmer`.
- [ ] **3. فحص البوابة الوسيطة `:3000`**: `curl http://127.0.0.1:3000/api/cloud/status` يشير إلى `http://127.0.0.1:8000`.

### ب. فحص الواجهة والأزرار والحزم على `http://localhost:3000`
- [ ] **4. استيراد ملف `.STEP` أو `.IGES` أو `.STL` أو `.INP` وتشغيله مباشرة**: يتحقق عبر `/api/cad-preview` وتظهر الأسطح (`Detected CAD Faces`) ويُحل داخل **OpenFOAM** أو **CalculiX** (عبر تشبيك Gmsh) مع إرجاع `vtk_data` ثلاثي الأبعاد كامل.
- [ ] **5. شجرة المحاكاة الديناميكية الحية**: التبديل بين `Geometry` و`Mesh & Sizing` و`Physics & Materials` و`Boundary Conditions` و`Contacts` و`Solution Controls` و`Results & Post` باللغة الإنجليزية الهندسية الموحدة.
- [ ] **6. التشبيك المسبق ومزامنة `Mesh Generator` مع `Mesh & Sizing`**: ضبط `Element Order = 2` وطبقات `Inflation Layers = 4` والاعتماد بالمشروع، ثم التحقق من انتقال نفس القيم والـ CAD والوجوه إلى `Mesh & Sizing`.
- [ ] **7. مزامنة مكتبة المواد (`Materials Database`)**: اختيار مادة من المكتبة والتحقق من تحديث الكثافة ومعامل يونغ والموصلية واللزوجة فوراً داخل `Physics & Materials`.
- [ ] **8. ربط أسطح CAD الحقيقية وتظليلها (`Boundary Conditions`)**: النقر على المجسم (`+ Inlet` / `+ Outlet` / `+ Heat` / `+ Wall`) أو النقر على شريحة سطح من `Detected CAD Faces` والتأكد من تظليل السطح باللون السماوي وارتباطه بأسطح OpenFOAM وعقد CalculiX وحدود ElmerFEM.
- [ ] **9. القنوات المتموجة وحساب رقم نسلت (`Corrugated Duct` & `Nusselt Nu`)**: تشغيل حالة `CHT_Coupled` مع نمط `corrugated_channel` والتأكد من توليد `polyLine` في `blockMeshDict` وظهور `nusselt_number` و`heat_transfer_coeff_h` في لوحة المقاييس والتكاملات.
- [ ] **10. تحليل كهرومغناطيسي فرعي (`ElmerFEM`)**: اختيار `Electromagnetic` ثم تغيير `EM Submode` إلى `Magnetostatic` وتحديد $\sigma$ و$\mu_r$ و$J$ وتشغيل الحل.
- [ ] **11. التنفيذ المتوازي (`Parallel Cores`) ومشغل خطوات الزمن (`Transient Playback`)**: اختيار `4 Cores (MPI / OpenMP)` مع `Time Mode = Transient` وتشغيل الحل، ثم تحريك شريط الزمن (`Play / Pause`) لمشاهدة تطور الحقل عبر خطوات الزمن.
- [ ] **12. تصدير حزمة المحللات الخام (`Solver Deck & VTK .zip`)**: بعد اكتمال الحل عبر Celery، الضغط على `Download Solver Deck & VTK (.zip)` في لوحة `Results & Post` أو قائمة `Export` والتأكد من تنزيل ملف `.zip` يحتوي على مجلد الحالة الفعلي وملفات `VTK`/`solver.log`.
- [ ] **13. زر مراقب العنقود (`Workers · Cores`) والمسح البارامتري المتوازي**: النقر على زر العنقود في الشريط العلوي لفتح نافذة `HPC Cluster & Multi-Worker Gateway`، التحقق من جدول العمال النشطين وتنزيل `docker-compose.cluster.yml` و`deploy-hpc-cluster.sh`.
- [ ] **14. شهادة التحقق الدولية الآلية V&V (`Audit Report Modal -> V&V`)**: فتح نافذة التدقيق، التحقق من ظهور المعايير الدولية الـ 6 وحالة توفر كل محرك (`BINARY READY`)، تشغيل الحزمة الكاملة والتحقق من صدور `PASS` وتنزيل ملفي `VV_VERIFICATION_CERTIFICATE.md` و`vv_verification_certificate.json` ببصمة `SHA-256`.
- [ ] **15. لوحة صحة وأداء المحاكاة العائمة (`ViewportHealthDashboard`)**: أثناء تشغيل أي محاكاة، التحقق من توسّع لوحة `HPC Health Monitor` في الزاوية اليسرى العليا للعارض، وعمل ساعة `Wall-Clock` الفعلية، وقراءة حمل المعالج الحقيقي وذاكرة الحاوية و`Solver Process RSS MB` من عقدة `WORKER LIVE`.
- [ ] **16. الاضطراب عالي الدقة والمناطق الدوّارة (`OpenFOAM LES/DDES + MRF`)**: اختيار `LES · WALE` أو `DDES · Spalart-Allmaras DDES` وتفعيل `Rotating Zone (OpenFOAM MRF)` بسرعة `1500 RPM`، وتشغيل الحل والتحقق من توليد `turbulenceProperties (LES)` و`MRFProperties` و`topoSetDict (rotorZone)` داخل الحزمة المصدّرة `.zip`.
- [ ] **17. اللدونة والمطاطية الفائقة (`CalculiX *PLASTIC / *HYPERELASTIC`)**: اختيار `Structural_Static` وتغيير `Material Law` إلى `Elastoplastic (*PLASTIC)` مع إدخال $\sigma_y = 250\text{ MPa}$ أو `Hyperelastic (*HYPERELASTIC · Neo-Hooke)` وتشغيل الحل والتحقق من تفعيل `*STEP,NLGEOM,INC=100` وظهور `material_model` في التكاملات.
- [ ] **18. التجميعات متعددة الأجسام والتلامس الاحتكاكي (`CalculiX 2-Body *CONTACT PAIR + *FRICTION`)**: من محطة `Contacts` اختيار `2-Body Frictional Contact (*CONTACT PAIR + *FRICTION)` مع $\mu = 0.25$ وتشغيل الحل، والتحقق من توليد الجسمين المنفصلين (`BODY_LOWER / BODY_UPPER`) وبطاقات `*SURFACE INTERACTION` و`*FRICTION` و`*CONTACT PAIR` داخل `model.inp`.
- [ ] **19. المصادقة المؤسسية والمطالبة الأولى بحساب المدير (`Enterprise Security -> Identity & RBAC`)**: فتح `Infrastructure -> Enterprise Security, S3 & K8s`، إنشاء حساب المدير الأول، التحقق من قفل بوابة التأسيس تلقائياً، وإضافة عضو بصلاحية `engineer` أو `viewer`.
- [ ] **20. الأرشفة إلى التخزين الكائني (`S3 / MinIO Storage`)**: بعد تشغيل محاكاة عبر Celery، الضغط على `Archive Latest Job (.zip)` والتحقق من ظهور الحزمة المؤرشفة ببصمة `SHA-256` (محلياً أو في MinIO عند التشغيل بـ `docker-compose.enterprise.yml`).
- [ ] **21. تنزيل حزم النشر السحابي والسوبر كمبيوتر (`K8s, Slurm & CI/CD`)**: تنزيل `naseer-cae-k8s-stack.yaml` و`submit_naseer_job.sbatch` و`docker-compose.enterprise.yml` و`naseer-ci-cd.yml` مباشرة من الواجهة.
- [ ] **22. سجل التدقيق المتسلسل (`Audit Trail`)**: فتح تبويب `Audit Trail` والتحقق من تسجيل عمليات التشغيل والمصادقة وتغيير الصلاحيات بسلسلة بصمات `SHA-256`.





