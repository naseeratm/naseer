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
def run_simulation_endpoint(_request: SimulationRequest):
    return JSONResponse(
        status_code=410,
        content={
            "success": False,
            "status": "retired",
            "errorMessage": (
                "Legacy SciPy /backend/main.py solver endpoint is disabled under strict zero-mock policy. "
                "Start root main.py / Docker CAE containers (:8000) to execute via OpenFOAM, CalculiX, and ElmerFEM."
            ),
        },
    )


@app.post("/api/pymapdl-execute")
def execute_pymapdl_script(_request: ApdlScriptRequest):
    return JSONResponse(
        status_code=410,
        content={
            "status": "retired",
            "message": "Legacy PyMAPDL fallback endpoint is retired. Route all FEA jobs through CalculiX in root main.py (:8000).",
        },
    )


if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_PORT", "8001"))
    print("=" * 80)
    print(f"🚀 بدء تشغيل خادم ANSYS Engineering WorkBench Python Backend على المنفذ {port}")
    print("=" * 80)
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)