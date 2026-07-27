/* ดึงข้อมูล SMI-V สดจาก HDC OpenData API (ตาราง s_smiv_followup) รายจังหวัดเขตสุขภาพที่ 8
   แล้วประกอบเป็นโครงสร้างเดียวกับ smiv-data.json เพื่อให้ smiv.js render ได้โดยไม่แก้ส่วนแสดงผล */

"use strict";

const HDC_API_URL = "https://opendata.moph.go.th/api/report_data";
const HDC_TABLE_NAME = "s_smiv_followup";

const PROVINCE_CODES = {
  "เลย": "42",
  "หนองบัวลำภู": "39",
  "อุดรธานี": "41",
  "หนองคาย": "43",
  "บึงกาฬ": "38",
  "สกลนคร": "47",
  "นครพนม": "48",
};

/* เป้าหมายตามเอกสารชี้แจงตัวชี้วัด SMI-V ปีงบ 2569 */
const SMIV_TARGETS = { round6: 35.0, round9: 37.0, round12: 40.0 };
const SMIV_ACCESS_TARGET = 40.0;

/* ประมาณการผู้ป่วย SMI-V ในพื้นที่ (คอลัมน์ I ของรายงาน HDC) — ไม่มีใน OpenData API
   HDC คำนวณจากประชากรกลางปีย้อนหลัง 2 ปี จึงคงที่ตลอดปีงบประมาณ
   ค่าปีงบ 2569 ตรวจทานจากไฟล์ export HDC ณ 10 ก.ค. 2569 */
const ESTIMATED_BY_FISCAL_YEAR = {
  2569: {
    "เลย": 2141,
    "หนองบัวลำภู": 1786,
    "อุดรธานี": 5501,
    "หนองคาย": 1784,
    "บึงกาฬ": 1486,
    "สกลนคร": 4058,
    "นครพนม": 2530,
  },
};

const THAI_MONTH_NAMES = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

const BUDDHIST_ERA_OFFSET = 543;
const FISCAL_YEAR_START_MONTH = 10; // ปีงบประมาณไทยเริ่ม ต.ค.

const HDC_HOST = "opendata.moph.go.th";

/* ฟิลด์ตัวเลขที่ต้องมีในทุกแถวของ API */
const REQUIRED_FIELDS = [
  "pop", "new", "old", "all_cid", "not_repeat_cid",
  "follow_1", "not_repeat1", "follow_2", "not_repeat2",
];

function thaiFiscalYear(date) {
  const buddhistYear = date.getFullYear() + BUDDHIST_ERA_OFFSET;
  return date.getMonth() + 1 >= FISCAL_YEAR_START_MONTH ? buddhistYear + 1 : buddhistYear;
}

/* เดือนที่ของปีงบประมาณ (ต.ค. = 1 … ก.ย. = 12) */
function fiscalMonth(date) {
  const month = date.getMonth() + 1;
  return month >= FISCAL_YEAR_START_MONTH
    ? month - FISCAL_YEAR_START_MONTH + 1
    : month + 12 - FISCAL_YEAR_START_MONTH + 1;
}

/* รอบประเมินตามจำนวนเดือนของปีงบที่ผ่านครบแล้ว เช่น ก.ค. ผ่านครบ 9 เดือน → รอบ 9 เดือน */
function currentRoundForDate(date) {
  const completedMonths = fiscalMonth(date) - 1;
  if (completedMonths >= 12) return "round12";
  if (completedMonths >= 9) return "round9";
  return "round6";
}

/* date_com ของ HDC เป็น ค.ศ. รูปแบบ yyyymmddHHMM เช่น "202607140817" */
function parseDateCom(dateCom) {
  const text = String(dateCom);
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  if (!match) throw new Error(`รูปแบบ date_com ไม่ถูกต้อง: "${text}"`);
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(date.getTime())) throw new Error(`ค่า date_com ไม่ถูกต้อง: "${text}"`);
  return date;
}

function thaiDateLabel(date) {
  const buddhistYear = date.getFullYear() + BUDDHIST_ERA_OFFSET;
  return `${date.getDate()} ${THAI_MONTH_NAMES[date.getMonth()]} ${buddhistYear}`;
}

function toNonNegativeInt(value, field, province) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${province}: ค่า ${field} จาก API ไม่ถูกต้อง ("${value}")`);
  }
  return Math.round(number);
}

/* รวมทุกแถวของจังหวัด (ปกติ API ตอบ 1 แถวสรุประดับจังหวัด) */
function aggregateRows(rows, province) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${province}: API ไม่มีข้อมูลตอบกลับ`);
  }
  const totals = Object.fromEntries(REQUIRED_FIELDS.map((field) => [field, 0]));
  let latestDate = null;
  for (const row of rows) {
    for (const field of REQUIRED_FIELDS) {
      totals[field] += toNonNegativeInt(row[field], field, province);
    }
    const rowDate = parseDateCom(row.date_com);
    if (latestDate === null || rowDate > latestDate) latestDate = rowDate;
  }
  return { ...totals, dateCom: latestDate };
}

/* ส่งแบบ form-urlencoded เพื่อเลี่ยง CORS preflight (OPTIONS โดน Cloudflare challenge 403)
   — Content-Type: application/json ทำให้เบราว์เซอร์ยิง preflight แล้วเชื่อมต่อไม่สำเร็จ */
async function requestProvinceRows(provinceCode, fiscalYear) {
  const response = await fetch(HDC_API_URL, {
    method: "POST",
    body: new URLSearchParams({
      tableName: HDC_TABLE_NAME,
      year: String(fiscalYear),
      province: provinceCode,
      type: "json",
    }),
    signal: timeoutSignal(),
  });
  if (!response.ok) throw new Error(`HDC API ตอบกลับ HTTP ${response.status}`);
  return response.json();
}

/* ยิงซ้ำก่อนยอมแพ้ เพราะถ้าจังหวัดใดจังหวัดหนึ่งพลาด หน้าเว็บจะตกไปใช้ข้อมูลสำรองทั้งหมด */
async function fetchProvinceRows(provinceCode, fiscalYear, province) {
  try {
    return await fetchWithRetry(
      () => requestProvinceRows(provinceCode, fiscalYear), HDC_HOST);
  } catch (error) {
    throw new Error(`${province}: ${error.message}`);
  }
}

/* แปลงยอดรวมจาก API เป็น entry รูปแบบเดียวกับ smiv-data.json
   สูตรตรงกับ etl/parse_smiv.py:
   อัตราเข้าถึงบริการ = (ทั้งหมด ÷ ประมาณการ) × 100
   % ดูแลต่อเนื่อง = (ติดตาม ≥2 ครั้ง + ไม่ก่อซ้ำ ÷ ผู้ป่วยทั้งหมด) × 100 */
function buildEntry(record, estimated, province) {
  const total = record.all_cid;
  if (estimated <= 0) throw new Error(`${province}: ค่าประมาณการต้องมากกว่า 0`);
  if (total <= 0) throw new Error(`${province}: จำนวนผู้ป่วยทั้งหมดจาก API เป็น 0`);
  return {
    old: record.old,
    new: record.new,
    total,
    accessRate: Math.round(total / estimated * 100 * 100) / 100,
    noRepeat: record.not_repeat_cid,
    kpi: Math.round(record.not_repeat2 / total * 100 * 100) / 100,
    pop1560: record.pop,
    estimated,
    follow1: record.follow_1,
    follow1NoRepeat: record.not_repeat1,
    follow2: record.follow_2,
    follow2NoRepeat: record.not_repeat2,
  };
}

function buildTotalEntry(entries) {
  const sumOf = (field) => entries.reduce((sum, entry) => sum + entry[field], 0);
  const record = {
    old: sumOf("old"),
    new: sumOf("new"),
    all_cid: sumOf("total"),
    not_repeat_cid: sumOf("noRepeat"),
    follow_1: sumOf("follow1"),
    not_repeat1: sumOf("follow1NoRepeat"),
    follow_2: sumOf("follow2"),
    not_repeat2: sumOf("follow2NoRepeat"),
    pop: sumOf("pop1560"),
  };
  return buildEntry(record, sumOf("estimated"), "รวม");
}

function buildDb(entriesByProvince, latestDate, fiscalYear, asOfDate) {
  const provinces = Object.keys(PROVINCE_CODES);
  const data = { ...entriesByProvince, "รวม": buildTotalEntry(Object.values(entriesByProvince)) };
  const population = Object.fromEntries(
    Object.entries(data).map(([name, entry]) => [name, entry.pop1560]));
  return {
    meta: {
      generatedAt: latestDate.toISOString(),
      fiscalYear,
      asOfLabel: `ข้อมูลสะสมปีงบประมาณ ${fiscalYear} (ณ ${thaiDateLabel(latestDate)})`,
      targets: SMIV_TARGETS,
      currentRound: currentRoundForDate(asOfDate),
      accessTarget: SMIV_ACCESS_TARGET,
      populationYear: fiscalYear - 2,
      source: "HDC OpenData API (s_smiv_followup) — ประชากรกลางปี 15-60 ปี ย้อนหลัง 2 ปี",
    },
    provinces,
    population,
    data,
  };
}

/* โหลดข้อมูลสดทั้ง 7 จังหวัดจาก HDC API แล้วคืนโครงสร้างเดียวกับ smiv-data.json */
async function loadSmivFromApi() {
  const now = new Date();
  const fiscalYear = thaiFiscalYear(now);
  const estimatedMap = ESTIMATED_BY_FISCAL_YEAR[fiscalYear];
  if (!estimatedMap) {
    throw new Error(
      `ยังไม่ได้กำหนดค่าประมาณการผู้ป่วยปีงบ ${fiscalYear} (อัปเดต ESTIMATED_BY_FISCAL_YEAR)`);
  }

  const provinces = Object.keys(PROVINCE_CODES);
  const results = await Promise.all(
    provinces.map((name) => fetchProvinceRows(PROVINCE_CODES[name], fiscalYear, name)));

  const entriesByProvince = {};
  let latestDate = null;
  provinces.forEach((name, index) => {
    const record = aggregateRows(results[index], name);
    entriesByProvince[name] = buildEntry(record, estimatedMap[name], name);
    if (latestDate === null || record.dateCom > latestDate) latestDate = record.dateCom;
  });

  return buildDb(entriesByProvince, latestDate, fiscalYear, now);
}
