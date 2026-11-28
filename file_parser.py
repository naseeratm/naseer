"""
Thin compatibility re-export wrapper for the canonical CAD/Mesh engineering file parser.

Single source of truth lives in `backend/file_parser.py` so parser enhancements
and security checks are maintained in one place without drift.
"""

from backend.file_parser import (
    EngineeringFileParser,
    HAS_MESHIO,
    HAS_TRIMESH,
    parse_engineering_file,
    parser_instance,
)

__all__ = [
    "EngineeringFileParser",
    "HAS_MESHIO",
    "HAS_TRIMESH",
    "parse_engineering_file",
    "parser_instance",
]
