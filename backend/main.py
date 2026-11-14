"""
================================================================================
ANSYS Engineering WorkBench - High-Performance FastAPI Backend Server (main.py)
الخادم الخلفي المتكامل لمعالجة الشبيكات وحل المعادلات الفيزيائية الحتمية
================================================================================
"""

import os
import sys
import tempfile
from typing import Dict, List, Any, Optional

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ConfigDict
import uvicorn

from file_parser import parse_engineering_file
from physics_solver import run_physics_simulation

try:
    import ansys.mapdl.core as pymapdl
    HAS_PYMAPDL = True
except ImportError:
    HAS_PYMAPDL = False

app = FastAPI(
    title="ANSYS Engineering WorkBench - Python Physics Backend",
    description="خادم المعالجة الرياضية الحتمية وحل معادلات CFD/CHT/FEA وقراءة ملفات CAD والشبيكات.",
    version="3.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class BoundaryConditionsModel(BaseModel):
    model_config = ConfigDict(extra="allow")
    pressure_load_mpa: Optional[float] = Field(None)
    inlet_velocity_mps: Optional[float] = Field(None)
    temperature_celsius: Optional[float] = Field(None)
    inlet_temperature_k: Optional[float] = Field(None)
    heat_flux_w_m2: Optional[float] = Field(None)
    hydraulic_diameter_m: Optional[float] = Field(None)
    support_constraint: Optional[str] = Field("Fixed Base")


class MaterialPropertiesModel(BaseModel):
    model_config = ConfigDict(extra="allow")
    name: Optional[str] = Field("Water / Nanofluid")
    elastic_modulus_gpa: Optional[float] = Field(205.0)
    poisson_ratio: Optional[float] = Field(0.29)
    yield_strength_mpa: Optional[float] = Field(470.0)
    density_kg_m3: Optional[float] = Field(998.2)
    viscosity_pa_s: Optional[float] = Field(0.001003)
    thermal_conductivity_w_mk: Optional[float] = Field(0.598)
    specific_heat_j_kgk: Optional[float] = Field(4182.0)


class MeshResolutionModel(BaseModel):
    model_config = ConfigDict(extra="allow")
    nx: Optional[int] = Field(50)
    ny: Optional[int] = Field(25)


class SimulationRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    simulation_type: str = Field("CFD")
    boundary_conditions: Optional[BoundaryConditionsModel] = None
    material: Optional[MaterialPropertiesModel] = None
    mesh: Optional[MeshResolutionModel] = None
    velocity: Optional[float] = None
    inlet_temperature: Optional[float] = None
    heat_flux: Optional[float] = None
    density: Optional[float] = None
    viscosity: Optional[float] = None
    thermal_conductivity: Optional[float] = None
    specific_heat: Optional[float] = None
    hydraulic_diameter: Optional[float] = None
    turbulence_model: Optional[str] = None
    corrugated: Optional[bool] = True


class ApdlScriptRequest(BaseModel):
    apdl_script: str = Field(...)
    job_name: Optional[str] = Field("workbench_job")


@app.get("/")
def read_root():
    return {
        "status": "ONLINE",
        "service": "ANSYS Engineering WorkBench - High-Performance Python Backend",
        "supported_solvers": [
            "Deterministic 2D Elastic FEA (SciPy Sparse)",
            "Coupled 2D Navier-Stokes + Energy CHT Solver (Nanofluids & Corrugated Ducts)",
            "Stefan Analytical Phase-Change Benchmark",
            "Roache Grid Convergence Index (GCI)"
        ]
    }


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "python_version": sys.version.split()[0],
        "has_scipy": True,
        "has_numpy": True,
        "has_pymapdl": HAS_PYMAPDL,
        "active_solvers": ["FEA", "CFD", "CHT-Nanofluid", "GCI-Roache"],
        "message": "خادم المعالجة الهندسية جاهز لاستقبال الطلبات."
    }


@app.post("/api/upload-model")
async def upload_model_file(
    file: UploadFile = File(...),
    directives: Optional[str] = Form("")
):
    if not file:
        raise HTTPException(status_code=400, detail="لم يتم استلام أي ملف.")

    filename = file.filename or "uploaded_model.dat"
    file_bytes = await file.read()

    if len(file_bytes) == 0:
        raise HTTPException(status_code=400, detail="الملف المرفوع فارغ (0 بايت).")

    try:
        parsed_result = parse_engineering_file(file_bytes, filename)
        parsed_result["user_directives"] = directives or ""
        parsed_result["status"] = "success"
        return JSONResponse(content=parsed_result)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "filename": filename,
                "errorMessage": f"حدث خطأ أثناء معالجة الملف الهندسي: {str(e)}"
            }
        )


@app.post("/api/run-simulation")
def run_simulation_endpoint(request: SimulationRequest):
    try:
        bc_dict = request.boundary_conditions.model_dump() if request.boundary_conditions else {}
        mat_dict = request.material.model_dump() if request.material else {}
        mesh_dict = request.mesh.model_dump() if request.mesh else {}
        extra_dict = request.model_dump(exclude={"simulation_type", "boundary_conditions", "material", "mesh"})

        results = run_physics_simulation(
            simulation_type=request.simulation_type,
            boundary_conditions=bc_dict,
            material_properties=mat_dict,
            mesh_resolution=mesh_dict,
            extra_params=extra_dict
        )

        return JSONResponse(content={
            "success": True,
            "status": "success",
            "simulation_type": request.simulation_type,
            "result": results,
            "data": results
        })

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "status": "error",
                "errorMessage": f"فشل تنفيذ المحاكاة الفيزيائية: {str(e)}"
            }
        )


@app.post("/api/pymapdl-execute")
def execute_pymapdl_script(request: ApdlScriptRequest):
    if not HAS_PYMAPDL:
        return JSONResponse(
            status_code=501,
            content={
                "status": "unavailable",
                "message": "مكتبة ansys-mapdl-core غير مثبتة. تم استخدام المحلل الحتمي البديل المبني على SciPy.",
                "script_echo": request.apdl_script[:200]
            }
        )

    try:
        mapdl = pymapdl.launch_mapdl(run_location=tempfile.mkdtemp(), loglevel="WARNING")
        output = mapdl.input_strings(request.apdl_script.splitlines())
        mapdl.exit()
        return {
            "status": "executed_ansys_native",
            "job_name": request.job_name,
            "mapdl_output": str(output)[:2000]
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={
                "status": "mapdl_launch_failed",
                "detail": f"تعذر إطلاق أنسيز مباشرة ({str(e)})."
            }
        )


if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_PORT", "8001"))
    print("=" * 80)
    print(f"🚀 بدء تشغيل خادم ANSYS Engineering WorkBench Python Backend على المنفذ {port}")
    print("=" * 80)
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)