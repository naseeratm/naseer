import math
import tempfile
import unittest
from pathlib import Path

from universal_dispatcher import (
    _build_calculix_contact_cards,
    _build_calculix_material_cards,
    _classify_openfoam_turbulence,
    _generate_calculix_twobody_mesh,
    _openfoam_turbulence_setup,
    _write_openfoam_mrf_setup,
)


class TestPhase3NonlinearAndMultiBody(unittest.TestCase):
    def test_openfoam_les_wale_and_smagorinsky_setup(self) -> None:
        for model in ("WALE", "Smagorinsky"):
            with tempfile.TemporaryDirectory() as tmp:
                case_dir = Path(tmp)
                (case_dir / "constant").mkdir()
                (case_dir / "0").mkdir()
                meta = _openfoam_turbulence_setup(
                    case_dir,
                    model,
                    velocity=10.0,
                    char_len=0.2,
                    nu=1.5e-5,
                    patch_roles={"inlet": "inlet", "outlet": "outlet", "walls": "wall", "frontAndBack": "patch"},
                )
                self.assertEqual(meta["simulation_type"], "LES")
                self.assertTrue(meta["is_les"])
                self.assertEqual(meta["model"], model)

                tp = (case_dir / "constant" / "turbulenceProperties").read_text(encoding="utf-8")
                self.assertIn("simulationType LES;", tp)
                self.assertIn(f"LESModel {model};", tp)
                self.assertIn("delta cubeRootVol;", tp)

                nut = (case_dir / "0" / "nut").read_text(encoding="utf-8")
                self.assertIn("nutUSpaldingWallFunction", nut)
                self.assertFalse((case_dir / "0" / "nuTilda").exists())

    def test_openfoam_ddes_and_sa_writes_nutilda_and_vandriest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            case_dir = Path(tmp)
            (case_dir / "constant").mkdir()
            (case_dir / "0").mkdir()
            meta = _openfoam_turbulence_setup(
                case_dir,
                "SpalartAllmarasDDES",
                velocity=25.0,
                char_len=0.5,
                nu=1.5e-5,
            )
            self.assertEqual(meta["simulation_type"], "LES")
            self.assertTrue(meta["is_les"])
            self.assertTrue(meta["needs_nutilda"])

            tp = (case_dir / "constant" / "turbulenceProperties").read_text(encoding="utf-8")
            self.assertIn("LESModel SpalartAllmarasDDES;", tp)
            self.assertIn("delta vanDriest;", tp)
            self.assertIn("vanDriestCoeffs", tp)

            nutilda_path = case_dir / "0" / "nuTilda"
            self.assertTrue(nutilda_path.is_file())
            nt_text = nutilda_path.read_text(encoding="utf-8")
            self.assertIn("object nuTilda;", nt_text)
            self.assertIn("walls { type fixedValue; value uniform 0; }", nt_text)

        # Verify RAS SpalartAllmaras also writes 0/nuTilda
        sa_meta = _classify_openfoam_turbulence("SpalartAllmaras")
        self.assertEqual(sa_meta["simulation_type"], "RAS")
        self.assertTrue(sa_meta["needs_nutilda"])
        self.assertFalse(sa_meta["is_les"])

    def test_openfoam_mrf_writes_toposet_and_mrf_properties(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            case_dir = Path(tmp)
            (case_dir / "constant").mkdir()
            (case_dir / "system").mkdir()
            existing_heat = [
                "{ name heatZone; type cellSet; action new; source boxToCell; sourceInfo { box (0.1 0.1 0) (0.3 0.3 0.1); } }"
            ]
            omega = 1500.0 * (2.0 * math.pi / 60.0)
            info = _write_openfoam_mrf_setup(
                case_dir,
                {"mrf_enabled": True, "mrf_omega_rad_s": omega, "mrf_radius": 0.12, "mrf_axis": "z"},
                patch_roles={"inlet": "inlet", "outlet": "outlet", "walls": "wall", "frontAndBack": "empty"},
                width=1.0,
                height=0.5,
                depth=0.1,
                existing_topo_actions=existing_heat,
            )
            self.assertEqual(info["cell_zone"], "rotorZone")
            self.assertAlmostEqual(info["omega_rad_s"], omega, places=5)
            self.assertEqual(info["non_rotating_patches"], ["inlet", "outlet", "walls"])

            topo_text = (case_dir / "system" / "topoSetDict").read_text(encoding="utf-8")
            self.assertIn("heatZone", topo_text)
            self.assertIn("cylinderToCell", topo_text)
            self.assertIn("setToCellZone", topo_text)
            self.assertIn("rotorZone", topo_text)

            mrf_text = (case_dir / "constant" / "MRFProperties").read_text(encoding="utf-8")
            self.assertIn("cellZone        rotorZone;", mrf_text)
            self.assertIn("nonRotatingPatches ( inlet outlet walls );", mrf_text)
            self.assertIn("axis            (0 0 1);", mrf_text)

            # Zero-Mock guard: MRF with omega == 0 must raise ValueError
            with self.assertRaises(ValueError):
                _write_openfoam_mrf_setup(
                    case_dir,
                    {"mrf_enabled": True, "mrf_omega_rad_s": 0.0},
                    patch_roles={"inlet": "inlet"},
                    width=1.0,
                    height=0.5,
                    depth=0.1,
                )

    def test_calculix_plastic_and_hyperelastic_material_cards(self) -> None:
        # 1. Bilinear Isotropic Hardening (*PLASTIC)
        cards, meta = _build_calculix_material_cards(
            {"material_model": "plastic", "yield_stress_pa": 250e6, "tangent_modulus_pa": 10e9},
            mat_name="STEEL",
            E=200e9,
            nu=0.3,
            density=7850.0,
            k_cond=50.0,
            cp_solid=460.0,
            alpha_exp=1.2e-5,
            is_thermal_only=False,
            is_coupled_ts=False,
        )
        joined = "\n".join(cards)
        self.assertIn("*ELASTIC", joined)
        self.assertIn("*PLASTIC", joined)
        self.assertIn("2.5e+08,0.0", joined)
        self.assertTrue(meta["requires_nlgeom"])

        # Missing yield_stress_pa must fail explicitly (Zero-Mock)
        with self.assertRaises(ValueError):
            _build_calculix_material_cards(
                {"material_model": "plastic"},
                mat_name="STEEL",
                E=200e9,
                nu=0.3,
                density=7850.0,
                k_cond=50.0,
                cp_solid=460.0,
                alpha_exp=1.2e-5,
                is_thermal_only=False,
                is_coupled_ts=False,
            )

        # Tangent modulus >= E must fail explicitly
        with self.assertRaises(ValueError):
            _build_calculix_material_cards(
                {"material_model": "plastic", "yield_stress_pa": 250e6, "tangent_modulus_pa": 250e9},
                mat_name="STEEL",
                E=200e9,
                nu=0.3,
                density=7850.0,
                k_cond=50.0,
                cp_solid=460.0,
                alpha_exp=1.2e-5,
                is_thermal_only=False,
                is_coupled_ts=False,
            )

        # 2. Hyperelastic Neo-Hooke (*HYPERELASTIC,NEO HOOKE replaces *ELASTIC)
        h_cards, h_meta = _build_calculix_material_cards(
            {"material_model": "hyperelastic"},
            mat_name="ELASTOMER",
            E=6e6,
            nu=0.45,
            density=1100.0,
            k_cond=0.2,
            cp_solid=1500.0,
            alpha_exp=1e-4,
            is_thermal_only=False,
            is_coupled_ts=False,
        )
        h_joined = "\n".join(h_cards)
        self.assertIn("*HYPERELASTIC,NEO HOOKE", h_joined)
        self.assertNotIn("*ELASTIC\n", h_joined)
        self.assertTrue(h_meta["requires_nlgeom"])
        expected_c10 = (6e6 / (2.0 * 1.45)) / 2.0
        self.assertAlmostEqual(h_meta["hyper_c10_pa"], expected_c10, places=3)

    def test_calculix_twobody_contact_mesh_and_cards(self) -> None:
        (
            node_coords,
            elements,
            elem_conn,
            lower_ids,
            upper_ids,
            master_faces,
            slave_faces,
        ) = _generate_calculix_twobody_mesh(1.0, 0.4, 0.2, nx=4, ny=4, nz=2, elem_type="C3D8")

        self.assertEqual(len(elements), 4 * 4 * 2)
        self.assertEqual(len(lower_ids), 4 * 2 * 2)
        self.assertEqual(len(upper_ids), 4 * 2 * 2)
        self.assertEqual(len(master_faces), 4 * 2)
        self.assertEqual(len(slave_faces), 4 * 2)
        self.assertTrue(all(face == "S5" for _, face in master_faces))
        self.assertTrue(all(face == "S3" for _, face in slave_faces))

        # Verify strictly disjoint node IDs between lower and upper bodies!
        lower_nodes = {nid for eid in lower_ids for nid in elem_conn[eid][1]}
        upper_nodes = {nid for eid in upper_ids for nid in elem_conn[eid][1]}
        self.assertTrue(lower_nodes.isdisjoint(upper_nodes))
        self.assertEqual(len(lower_nodes) + len(upper_nodes), len(node_coords))

        # Frictional surface-to-surface contact cards
        fric_text, fric_meta = _build_calculix_contact_cards(
            contact_type="Frictional",
            friction_coeff=0.25,
            E=210e9,
            height=0.4,
            master_faces=master_faces,
            slave_faces=slave_faces,
        )
        self.assertIn("*SURFACE,NAME=SURF_MASTER,TYPE=ELEMENT", fric_text)
        self.assertIn("*SURFACE,NAME=SURF_SLAVE,TYPE=ELEMENT", fric_text)
        self.assertIn("*SURFACE INTERACTION,NAME=INT_CONTACT", fric_text)
        self.assertIn("*SURFACE BEHAVIOR,PRESSURE-OVERCLOSURE=LINEAR", fric_text)
        self.assertIn("*FRICTION", fric_text)
        self.assertIn("0.25,", fric_text)
        self.assertIn("*CONTACT PAIR,INTERACTION=INT_CONTACT,TYPE=SURFACE TO SURFACE", fric_text)
        self.assertTrue(fric_meta["contact_pair_active"])
        self.assertTrue(fric_meta["requires_nlgeom"])

        # Tied 2-body assembly (*TIE)
        tie_text, tie_meta = _build_calculix_contact_cards(
            contact_type="Tie",
            friction_coeff=0.0,
            E=210e9,
            height=0.4,
            master_faces=master_faces,
            slave_faces=slave_faces,
        )
        self.assertIn("*TIE,NAME=TIE_ASSY,POSITION TOLERANCE=1e-3", tie_text)
        self.assertIn("SURF_SLAVE,SURF_MASTER", tie_text)
        self.assertFalse(tie_meta["contact_pair_active"])


if __name__ == "__main__":
    unittest.main()
