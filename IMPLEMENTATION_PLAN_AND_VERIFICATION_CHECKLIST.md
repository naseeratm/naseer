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
| **الحوسبة المتوازية والعنقود** | MPI / Multi-Worker Cluster | `parallel_cores` (`mpirun -np N` + `OMP_NUM_THREADS=N`) + `docker-compose.cluster.yml` (`--scale worker=M`) | مربوط 100% — مراقبة حية عبر `/api/cluster/status` |
| **تصدير الملفات الخام** | Case & VTK Download | `GET /api/jobs/{task_id}/export-case` (`.zip` يحتوي على القواميس و`VTK` و`.inp` و`.frd` و`solver.log`) | مربوط 100% — جاهز لـ ParaView |
| **معالجة النتائج الثلاثية** | Slice / Iso / Warp / Time | مقاطع `X/Y/Z`، عتبة `Iso-Threshold`، تشوه `Deformation Scale`، مشغل خطوات الزمن `time_frames` | مربوط 100% — WebGL حي |

---

## القسم الرابع: قائمة التشييك الميدانية على اللابتوب أو الخادم السحابي (ضع `[x]` لكل بند عند التجربة)

### أ. فحص البنية التحتية والحاويات وتوسيع العنقود (في Terminal)
- [ ] **1. عدد الحاويات وحالتها**: `docker compose ps` (أو `docker compose -f docker-compose.cluster.yml up -d --build --scale worker=4`) يُظهر خدمات `api`, `redis`, وعدد حاويات `worker` المطلوبة في وضع `Up / Running`.
- [ ] **2. فحص `/api/cluster/status`**: `curl http://127.0.0.1:8000/api/cluster/status` يُرجع `ONLINE` وعدد العمال المتصلين (`workers_online`) وإجمالي أنوية العنقود (`total_cluster_cores`) وتوفر `openfoam`, `calculix`, `gmsh`, `elmer`.
- [ ] **3. فحص البوابة الوسيطة `:3000`**: `curl http://127.0.0.1:3000/api/cloud/status` يشير إلى `http://127.0.0.1:8000`.

### ب. فحص الواجهة والأزرار والحزم على `http://localhost:3000`
- [ ] **4. استيراد ملف `.STEP` أو `.IGES` أو `.STL` أو `.INP` وتشغيله مباشرة**: يتحقق عبر `/api/cad-preview` وتظهر الأسطح (`Detected CAD Faces`) ويُحل داخل **OpenFOAM** أو **CalculiX** (عبر تشبيك Gmsh) مع إرجاع `vtk_data` ثلاثي الأبعاد كامل.
- [ ] **5. شجرة المحاكاة الديناميكية الحية**: التبديل بين `Geometry` و`Mesh & Sizing` و`Physics & Materials` و`Boundary Conditions` و`Contacts` و`Solution Controls` و`Results & Post` باللغة الإنجليزية الهندسية الموحدة.
- [ ] **6. التشبيك المسبق (`Mesh & Sizing` و`Mesh Generator`)**: ضبط `Element Order = 2` وطبقات `Inflation Layers = 4` والضغط على `Generate & Preview 3D Mesh`، والتأكد من رسم شبكة Gmsh ثلاثية الأبعاد وظهور عدد العقد والعناصر الحقيقي.
- [ ] **7. ربط أسطح CAD الحقيقية وتظليلها (`Boundary Conditions`)**: النقر على المجسم (`+ Inlet` / `+ Outlet` / `+ Heat` / `+ Wall`) أو النقر على شريحة سطح من `Detected CAD Faces` والتأكد من تظليل السطح باللون السماوي وارتباطه بأسطح OpenFOAM وعقد CalculiX وحدود ElmerFEM.
- [ ] **8. القنوات المتموجة وحساب رقم نسلت (`Corrugated Duct` & `Nusselt Nu`)**: تشغيل حالة `CHT_Coupled` مع نمط `corrugated_channel` والتأكد من توليد `polyLine` في `blockMeshDict` وظهور `nusselt_number` و`heat_transfer_coeff_h` في لوحة المقاييس والتكاملات.
- [ ] **9. تحليل كهرومغناطيسي فرعي (`ElmerFEM`)**: اختيار `Electromagnetic` ثم تغيير `EM Submode` إلى `Magnetostatic` وتحديد $\sigma$ و$\mu_r$ و$J$ وتشغيل الحل.
- [ ] **10. التنفيذ المتوازي (`Parallel Cores`) ومشغل خطوات الزمن (`Transient Playback`)**: اختيار `4 Cores (MPI / OpenMP)` مع `Time Mode = Transient` وتشغيل الحل، ثم تحريك شريط الزمن (`Play / Pause`) لمشاهدة تطور الحقل عبر خطوات الزمن.
- [ ] **11. تصدير حزمة المحللات الخام (`Solver Deck & VTK .zip`)**: بعد اكتمال الحل عبر Celery، الضغط على `Download Solver Deck & VTK (.zip)` في لوحة `Results & Post` أو قائمة `Export` والتأكد من تنزيل ملف `.zip` يحتوي على مجلد الحالة الفعلي وملفات `VTK`/`solver.log`.
- [ ] **12. زر مراقب العنقود (`Workers · Cores`) والمسح البارامتري المتوازي**: النقر على زر العنقود في الشريط العلوي لفتح نافذة `HPC Cluster & Multi-Worker Gateway`، التحقق من جدول العمال النشطين وتنزيل `docker-compose.cluster.yml` و`deploy-hpc-cluster.sh`.



