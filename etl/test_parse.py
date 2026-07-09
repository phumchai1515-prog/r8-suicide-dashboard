"""ทดสอบ ETL: รันด้วย  python3 etl/test_parse.py  (ใช้ unittest ในตัว)"""

from __future__ import annotations

import unittest
from pathlib import Path

import parse


class TestAgeGroup(unittest.TestCase):
    def test_groups_child_into_0_14(self):
        self.assertEqual(parse.age_group("14"), "0-14")

    def test_groups_boundary_15_into_15_24(self):
        self.assertEqual(parse.age_group("15"), "15-24")

    def test_groups_elderly_into_65_plus(self):
        self.assertEqual(parse.age_group("80"), "65+")

    def test_returns_unknown_for_non_numeric(self):
        self.assertEqual(parse.age_group(""), "ไม่ระบุ")
        self.assertEqual(parse.age_group("ไม่ทราบ"), "ไม่ระบุ")

    def test_returns_unknown_for_negative(self):
        self.assertEqual(parse.age_group("-1"), "ไม่ระบุ")


class TestAggregate(unittest.TestCase):
    @staticmethod
    def make_record(province="เลย", age="30", sex="ชาย", month="10",
                    year="2568", outcome="ตาย", access="", hanging="ไม่มี"):
        rec = [""] * parse.EXPECTED_COLUMNS
        rec[parse.COL_PROVINCE] = province
        rec[parse.COL_AGE] = age
        rec[parse.COL_SEX] = sex
        rec[parse.COL_MONTH] = month
        rec[parse.COL_YEAR] = year
        rec[parse.COL_OUTCOME] = outcome
        rec[parse.COL_ACCESS_7_2] = access
        rec[27] = hanging  # แขวนคอ
        return rec

    def test_counts_death_separately_from_attempt(self):
        records = [
            self.make_record(outcome="ตาย"),
            self.make_record(outcome="บาดเจ็บ"),
            self.make_record(outcome="ไม่บาดเจ็บ"),
        ]
        result = parse.aggregate(records)
        bucket = result["เลย"]["2568-10"]
        self.assertEqual(bucket["die"], 1)
        self.assertEqual(bucket["attempt"], 2)

    def test_counts_access_only_for_attempts(self):
        records = [
            self.make_record(outcome="ตาย", access="มี"),
            self.make_record(outcome="บาดเจ็บ", access="มี"),
            self.make_record(outcome="บาดเจ็บ", access="ไม่มี"),
        ]
        bucket = parse.aggregate(records)["เลย"]["2568-10"]
        self.assertEqual(bucket["access"], 1)

    def test_counts_method_when_present(self):
        bucket = parse.aggregate([self.make_record(hanging="มี")])["เลย"]["2568-10"]
        self.assertEqual(bucket["byMethod"].get("แขวนคอ"), 1)

    def test_facility_district_strips_hospital_prefix(self):
        self.assertEqual(parse.facility_district("โรงพยาบาลวังสะพุง", "เลย"), "วังสะพุง")

    def test_facility_district_maps_provincial_hospital_to_mueang(self):
        self.assertEqual(parse.facility_district("โรงพยาบาลเลย", "เลย"), "เมืองเลย")

    def test_facility_district_handles_royal_hospital(self):
        self.assertEqual(
            parse.facility_district("โรงพยาบาลสมเด็จพระยุพราชท่าบ่อ", "หนองคาย"),
            "ท่าบ่อ")

    def test_facility_district_handles_special_names(self):
        self.assertEqual(
            parse.facility_district("โรงพยาบาลพระอาจารย์แบน  ธนากโร", "สกลนคร"),
            "ภูพาน")

    def test_district_of_prefers_event_address(self):
        rec = self.make_record()
        rec[parse.COL_DISTRICT] = "อ.เชียงคาน"
        rec[parse.COL_FACILITY] = "โรงพยาบาลเลย"
        self.assertEqual(parse.district_of(rec), "เชียงคาน")

    def test_district_of_falls_back_to_facility(self):
        rec = self.make_record()
        rec[parse.COL_DISTRICT] = ""
        rec[parse.COL_FACILITY] = "โรงพยาบาลนาด้วง"
        self.assertEqual(parse.district_of(rec), "นาด้วง")

    def test_aggregate_districts_totals_match(self):
        records = [
            self.make_record(outcome="ตาย"),
            self.make_record(outcome="บาดเจ็บ"),
        ]
        records[0][parse.COL_DISTRICT] = "อ.เชียงคาน"
        records[1][parse.COL_FACILITY] = "โรงพยาบาลวังสะพุง"
        result = parse.aggregate_districts(records)
        self.assertEqual(result["เลย"]["เชียงคาน"]["2568-10"]["die"], 1)
        self.assertEqual(result["เลย"]["วังสะพุง"]["2568-10"]["attempt"], 1)

    def test_counts_risk_factor_when_present(self):
        rec = self.make_record()
        rec[91] = "มี"  # R1 ป่วยด้วยโรคจิตเวช
        bucket = parse.aggregate([rec])["เลย"]["2568-10"]
        self.assertEqual(bucket["byRisk"].get("ป่วยด้วยโรคจิตเวช"), 1)
        self.assertNotIn("ติดสุรา", bucket["byRisk"])

    def test_rejects_unknown_province(self):
        with self.assertRaises(ValueError):
            parse.aggregate([self.make_record(province="เชียงใหม่")])

    def test_rejects_unknown_outcome(self):
        with self.assertRaises(ValueError):
            parse.aggregate([self.make_record(outcome="ไม่ทราบ")])

    def test_rejects_month_outside_period(self):
        with self.assertRaises(ValueError):
            parse.aggregate([self.make_record(month="09", year="2568")])


class TestRealData(unittest.TestCase):
    """ทดสอบกับไฟล์จริงใน data/raw (ข้ามถ้าไม่มีไฟล์)"""

    EXPECTED = {
        "1ตค69-31ธค69.xls": (621, 109),
        "1มค69-31มีค69.xls": (499, 120),
        "1เมย69-9กค69.xls": (471, 105),
    }

    @classmethod
    def setUpClass(cls):
        if not parse.RAW_DIR.exists():
            raise unittest.SkipTest("ไม่มีโฟลเดอร์ data/raw")

    def test_record_and_death_counts_match_source(self):
        for filename, (expected_total, expected_deaths) in self.EXPECTED.items():
            path = parse.RAW_DIR / filename
            if not path.exists():
                self.skipTest(f"ไม่มีไฟล์ {filename}")
            records = parse.parse_case_file(path)
            deaths = sum(1 for r in records if r[parse.COL_OUTCOME] == "ตาย")
            self.assertEqual(len(records), expected_total, filename)
            self.assertEqual(deaths, expected_deaths, filename)

    def test_population_totals_are_consistent(self):
        path = parse.RAW_DIR / parse.POPULATION_FILE
        if not path.exists():
            self.skipTest("ไม่มีไฟล์ประชากร")
        population = parse.parse_population(path)
        self.assertEqual(population["รวม"], 5_435_662)
        self.assertEqual(len([p for p in parse.PROVINCES if p in population]), 7)

    def test_hdc_yearly_totals_match_source(self):
        path = parse.RAW_DIR / parse.HDC_FILE
        if not path.exists():
            self.skipTest("ไม่มีไฟล์ HDC")
        hdc = parse.parse_hdc(path)
        self.assertEqual(hdc["yearly"]["รวม"], 1_706)
        self.assertEqual(hdc["yearly"]["สกลนคร"], 457)
        self.assertEqual(hdc["yearly"]["หนองคาย"], 106)

    def test_hdc_monthly_counts_are_complete(self):
        path = parse.RAW_DIR / parse.HDC_FILE
        if not path.exists():
            self.skipTest("ไม่มีไฟล์ HDC")
        hdc = parse.parse_hdc(path)
        october_total = sum(
            hdc["byProvMonth"][p]["2568-10"] for p in parse.PROVINCES)
        self.assertEqual(october_total, 249)
        for province in parse.PROVINCES:
            self.assertEqual(
                sorted(hdc["byProvMonth"][province].keys()),
                sorted(parse.FISCAL_MONTHS),
                province,
            )

    def test_aggregate_totals_match_source(self):
        records = []
        for filename in parse.CASE_FILES:
            path = parse.RAW_DIR / filename
            if not path.exists():
                self.skipTest(f"ไม่มีไฟล์ {filename}")
            records.extend(parse.parse_case_file(path))
        data = parse.aggregate(records)
        parse.validate(data, len(records))  # ต้องไม่ raise


if __name__ == "__main__":
    unittest.main(verbosity=2)
