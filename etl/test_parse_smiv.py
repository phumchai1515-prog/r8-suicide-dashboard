"""ทดสอบ ETL SMI-V: รันด้วย  python3 etl/test_parse_smiv.py"""

from __future__ import annotations

import unittest

import parse_smiv


class TestValidateEntry(unittest.TestCase):
    @staticmethod
    def make_entry(**overrides):
        entry = {
            "old": 100, "new": 50, "total": 150,
            "accessRate": 75.0, "noRepeat": 90, "kpi": 30.0,
            "pop1560": 100_000, "estimated": 200,
            "follow1": 80, "follow1NoRepeat": 70,
            "follow2": 65, "follow2NoRepeat": 60,
        }
        entry.update(overrides)
        return entry

    def test_accepts_consistent_entry(self):
        parse_smiv.validate_entry("ทดสอบ", self.make_entry())  # ต้องไม่ raise

    def test_rejects_total_mismatch(self):
        with self.assertRaises(ValueError):
            parse_smiv.validate_entry("ทดสอบ", self.make_entry(total=151))

    def test_rejects_access_rate_mismatch(self):
        with self.assertRaises(ValueError):
            parse_smiv.validate_entry("ทดสอบ", self.make_entry(accessRate=80.0))

    def test_rejects_kpi_mismatch(self):
        with self.assertRaises(ValueError):
            parse_smiv.validate_entry("ทดสอบ", self.make_entry(kpi=35.0))


class TestRealData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = parse_smiv.RAW_DIR / parse_smiv.SMIV_FILE
        if not path.exists():
            raise unittest.SkipTest("ไม่มีไฟล์ SMI-V")
        cls.smiv = parse_smiv.parse_smiv(path)

    def test_region_totals_match_source(self):
        total = self.smiv["รวม"]
        self.assertEqual(total["total"], 16_513)
        self.assertEqual(total["estimated"], 19_286)
        self.assertEqual(total["kpi"], 20.0)
        self.assertEqual(total["accessRate"], 85.62)

    def test_all_provinces_present(self):
        for province in parse_smiv.PROVINCES:
            self.assertIn(province, self.smiv)

    def test_province_sums_equal_region_total(self):
        for field in ("old", "new", "total", "estimated", "follow2NoRepeat"):
            province_sum = sum(self.smiv[p][field] for p in parse_smiv.PROVINCES)
            self.assertEqual(province_sum, self.smiv["รวม"][field], field)

    def test_population_2567_totals(self):
        path = parse_smiv.RAW_DIR / parse_smiv.POP2567_FILE
        if not path.exists():
            self.skipTest("ไม่มีไฟล์ประชากร 2567")
        population = parse_smiv.parse_population(path)
        self.assertEqual(population["รวม"], 5_457_956)


if __name__ == "__main__":
    unittest.main(verbosity=2)
