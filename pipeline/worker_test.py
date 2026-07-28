#!/usr/bin/env python3
"""Unit tests for the pure logic in worker.py (no network, no generation).

Run directly so pipeline/ is on sys.path for the `import worker` / `pregen`:
    python3 pipeline/worker_test.py
"""
import unittest

import worker


class ParseSpeciesArgs(unittest.TestCase):
    def test_sci_and_common(self):
        self.assertEqual(
            worker.parse_species_args(["Turdus merula|Blackbird", "Parus major|Great Tit"]),
            [("Turdus merula", "Blackbird"), ("Parus major", "Great Tit")],
        )

    def test_missing_common_defaults_to_scientific(self):
        self.assertEqual(
            worker.parse_species_args(["Turdus merula"]),
            [("Turdus merula", "Turdus merula")],
        )

    def test_trims_and_drops_blank_scientific(self):
        self.assertEqual(
            worker.parse_species_args(["  Parus major  |  Great Tit  ", "|no sci", "   "]),
            [("Parus major", "Great Tit")],
        )

    def test_empty(self):
        self.assertEqual(worker.parse_species_args([]), [])


if __name__ == "__main__":
    unittest.main()
