#!/usr/bin/env python3
"""Unit tests for the pure logic in worker.py (no network, no generation).

Run directly so pipeline/ is on sys.path for the `import worker` / `pregen`:
    python3 pipeline/worker_test.py
"""
import tempfile
import unittest
from pathlib import Path

import worker


class ParseInterval(unittest.TestCase):
    def test_units(self):
        self.assertEqual(worker.parse_interval("30m"), 1800.0)
        self.assertEqual(worker.parse_interval("1h"), 3600.0)
        self.assertEqual(worker.parse_interval("600s"), 600.0)
        self.assertEqual(worker.parse_interval("600"), 600.0)

    def test_floor(self):
        # Anything under the 60s floor is clamped up.
        self.assertEqual(worker.parse_interval("10s"), 60.0)
        self.assertEqual(worker.parse_interval("0"), 60.0)

    def test_fallback(self):
        self.assertEqual(worker.parse_interval("garbage"), 1800.0)
        self.assertEqual(worker.parse_interval(""), 1800.0)


class ParseSummary(unittest.TestCase):
    def test_bare_array(self):
        payload = [
            {"scientific_name": "Turdus merula", "common_name": "Eurasian Blackbird"},
            {"scientific_name": "Erithacus rubecula", "common_name": "European Robin"},
        ]
        self.assertEqual(
            worker.parse_summary(payload),
            [("Turdus merula", "Eurasian Blackbird"),
             ("Erithacus rubecula", "European Robin")],
        )

    def test_data_envelope(self):
        payload = {"data": [{"scientific_name": "Parus major", "common_name": "Great Tit"}]}
        self.assertEqual(worker.parse_summary(payload), [("Parus major", "Great Tit")])

    def test_skips_incomplete_and_malformed(self):
        payload = [
            {"scientific_name": "Parus major", "common_name": "Great Tit"},
            {"scientific_name": "", "common_name": "No sci"},
            {"scientific_name": "No com", "common_name": ""},
            "not a dict",
        ]
        self.assertEqual(worker.parse_summary(payload), [("Parus major", "Great Tit")])

    def test_non_list(self):
        self.assertEqual(worker.parse_summary(None), [])
        self.assertEqual(worker.parse_summary(42), [])


class MissingSpecies(unittest.TestCase):
    def test_reports_only_species_without_a_perched_cutout(self):
        with tempfile.TemporaryDirectory() as tmp:
            assets = Path(tmp)
            # Turdus merula already has art; Calypte anna does not.
            (assets / "turdus-merula.png").write_bytes(b"x")
            species = [
                ("Turdus merula", "Eurasian Blackbird"),
                ("Calypte anna", "Anna's Hummingbird"),
            ]
            self.assertEqual(
                worker.missing_species(species, assets),
                [("Calypte anna", "Anna's Hummingbird", "calypte-anna")],
            )

    def test_dedupes_on_slug(self):
        with tempfile.TemporaryDirectory() as tmp:
            assets = Path(tmp)
            species = [
                ("Calypte anna", "Anna's Hummingbird"),
                ("Calypte  anna", "Anna's Hummingbird (dup)"),  # same slug
            ]
            missing = worker.missing_species(species, assets)
            self.assertEqual(len(missing), 1)
            self.assertEqual(missing[0][2], "calypte-anna")


class ManifestPath(unittest.TestCase):
    def test_derives_sibling_of_assets_root(self):
        assets = Path("/usr/share/nginx/html/assets/illustrations")
        self.assertEqual(
            worker.manifest_path(assets),
            Path("/usr/share/nginx/html/layout-manifest.json"),
        )


if __name__ == "__main__":
    unittest.main()
