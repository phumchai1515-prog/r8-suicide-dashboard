/* Dashboard ตัวชี้วัดการฆ่าตัวตาย เขตสุขภาพที่ 8 — อ่าน data.json (ข้อมูลสรุปรวม) แล้ว render
   ธีม Clinical Command Center (มืด) — ตรรกะการคำนวณตัวชี้วัดคงเดิมทุกสูตร */

"use strict";

const THAI_MONTHS = {
  "01": "ม.ค.", "02": "ก.พ.", "03": "มี.ค.", "04": "เม.ย.", "05": "พ.ค.",
  "06": "มิ.ย.", "07": "ก.ค.", "08": "ส.ค.", "09": "ก.ย.", "10": "ต.ค.",
  "11": "พ.ย.", "12": "ธ.ค.",
};

const QUARTER_MONTHS = {
  q1: ["2568-10", "2568-11", "2568-12"],
  q2: ["2569-01", "2569-02", "2569-03"],
  q3: ["2569-04", "2569-05", "2569-06", "2569-07"],
};

const COLORS = {
  death: "#dc2626",
  attempt: "#f59e0b",
  good: "#059669",
  accent: "#0284c7",
  teal: "#0d9488",
  indigo: "#6366f1",
  muted: "#5b6b80",
  grid: "rgba(23, 32, 51, 0.07)",
};

const DAYS_PER_YEAR = 365;
const PER_HUNDRED_THOUSAND = 100000;
const MAX_PERCENT = 100; // เพดานร้อยละการเข้าถึงบริการ ไม่ให้เกิน 100
const COUNT_UP_MS = 750;

const charts = {};
let DB = null;

/* ---------- utilities ---------- */

function monthLabel(key) {
  const [year, month] = key.split("-");
  return `${THAI_MONTHS[month]} ${year.slice(2)}`;
}

function formatNumber(value, digits = 0) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function selectedMonths(periodValue) {
  return periodValue === "all" ? DB.months : QUARTER_MONTHS[periodValue];
}

function selectedProvinces(provinceValue) {
  return provinceValue === "all" ? DB.provinces : [provinceValue];
}

function daysCovered(months) {
  return months.reduce((sum, m) => sum + (DB.monthDays[m] || 0), 0);
}

/* รวมยอดจาก data[จังหวัด][เดือน] ตามจังหวัด/เดือนที่เลือก */
function summarize(provinces, months) {
  const total = {
    die: 0, attempt: 0, access: 0,
    bySex: {}, byAge: {}, byMethod: {}, byRisk: {},
    byMonth: {}, byProvince: {},
  };
  for (const month of months) {
    total.byMonth[month] = { die: 0, attempt: 0 };
  }
  for (const province of provinces) {
    const perProvince = { die: 0, attempt: 0, access: 0 };
    const provinceData = DB.data[province] || {};
    for (const month of months) {
      const bucket = provinceData[month];
      if (!bucket) continue;
      total.die += bucket.die;
      total.attempt += bucket.attempt;
      total.access += bucket.access;
      perProvince.die += bucket.die;
      perProvince.attempt += bucket.attempt;
      perProvince.access += bucket.access;
      total.byMonth[month].die += bucket.die;
      total.byMonth[month].attempt += bucket.attempt;
      mergeCounts(total.bySex, bucket.bySex);
      mergeCounts(total.byAge, bucket.byAge);
      for (const [method, count] of Object.entries(bucket.byMethod)) {
        total.byMethod[method] = (total.byMethod[method] || 0) + count;
      }
      for (const [risk, count] of Object.entries(bucket.byRisk || {})) {
        total.byRisk[risk] = (total.byRisk[risk] || 0) + count;
      }
    }
    total.byProvince[province] = perProvince;
  }
  return total;
}

function mergeCounts(target, source) {
  for (const [key, counts] of Object.entries(source || {})) {
    if (!target[key]) target[key] = { die: 0, attempt: 0 };
    target[key].die += counts.die;
    target[key].attempt += counts.attempt;
  }
}

function suicideRate(deaths, population) {
  return population > 0 ? (deaths / population) * PER_HUNDRED_THOUSAND : 0;
}

function annualize(rate, days) {
  return days > 0 ? rate * (DAYS_PER_YEAR / days) : 0;
}

function accessPercent(access, attempts) {
  if (attempts <= 0) return 0;
  return Math.min(MAX_PERCENT, (access / attempts) * 100);
}

/* จำนวนผู้เข้าถึงบริการจาก HDC — ทั้งปีใช้ยอดคนไม่ซ้ำทั้งปี,
   บางช่วงเดือนใช้ผลรวมยอดคนรายเดือน (นับไม่ซ้ำภายในเดือน) */
function hdcCount(provinces, months) {
  const isFullPeriod = months.length === DB.months.length;
  let total = 0;
  for (const province of provinces) {
    if (isFullPeriod) {
      total += DB.hdc.yearly[province] || 0;
    } else {
      const monthly = DB.hdc.byProvMonth[province] || {};
      total += months.reduce((sum, m) => sum + (monthly[m] || 0), 0);
    }
  }
  return total;
}

/* ---------- DOM helpers ---------- */

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

/* ตัวเลขนับขึ้น (count-up) — เคารพ prefers-reduced-motion */
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function countUp(id, target, digits = 0) {
  const el = document.getElementById(id);
  if (REDUCED_MOTION) {
    el.textContent = formatNumber(target, digits);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - start) / COUNT_UP_MS);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = formatNumber(target * eased, digits);
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setBadge(id, isPass) {
  const badge = document.getElementById(id);
  badge.textContent = isPass ? "ผ่านเป้าหมาย" : "ไม่ผ่านเป้าหมาย";
  badge.className = `kpi-badge ${isPass ? "pass" : "fail"}`;
}

function setCardStatus(id, isPass) {
  document.getElementById(id).className = `kpi-card reveal ${isPass ? "pass" : "fail"}`;
}

function setRing(ringId, numId, percent, displayText, isPass) {
  const ring = document.getElementById(ringId);
  const color = isPass ? "var(--good)" : "var(--bad)";
  const pct = Math.max(0, Math.min(100, percent));
  ring.style.background =
    `radial-gradient(closest-side, var(--surface) 82%, transparent 83% 100%), ` +
    `conic-gradient(${color} ${pct}%, var(--line-soft) 0)`;
  setText(numId, displayText);
}

/* ---------- KPI hero ---------- */

function renderKpis(summary, provinces, months) {
  const population = provinces.length === DB.provinces.length
    ? DB.population["รวม"]
    : provinces.reduce((sum, p) => sum + DB.population[p], 0);

  const days = daysCovered(months);
  const rate = suicideRate(summary.die, population);
  const projected = annualize(rate, days);
  const hdcTotal = hdcCount(provinces, months);
  const access = accessPercent(summary.attempt, hdcTotal);

  const kpi1Pass = projected <= DB.meta.kpi1Target;
  const kpi2Pass = access >= DB.meta.kpi2Target;

  countUp("kpi1Value", rate, 2);
  setText("kpi1Target", formatNumber(DB.meta.kpi1Target, 0));
  setText("kpi1Annualized",
    `คาดการณ์ทั้งปี (annualized): ${formatNumber(projected, 2)} ต่อแสนประชากร ` +
    `(จากข้อมูล ${formatNumber(days)} วัน) · เสียชีวิต ${formatNumber(summary.die)} ราย`);
  setBadge("kpi1Badge", kpi1Pass);
  setCardStatus("kpi1Card", kpi1Pass);
  /* วงแหวน KPI1: สัดส่วนคาดการณ์เทียบเพดานเป้าหมาย (เต็มวง = ถึงเป้า 10) */
  setRing("kpi1Ring", "kpi1RingNum",
    (projected / DB.meta.kpi1Target) * 100, formatNumber(projected, 2), kpi1Pass);

  countUp("kpi2Value", access, 1);
  setText("kpi2Target", formatNumber(DB.meta.kpi2Target, 0));
  setText("kpi2Detail",
    `สูตร: 100 × (506S ÷ HDC) — ผู้พยายามฯ ในระบบเฝ้าระวัง 506S ${formatNumber(summary.attempt)} ราย ` +
    `÷ ผู้มารับบริการจาก HDC ${formatNumber(hdcTotal)} ราย`);
  setBadge("kpi2Badge", kpi2Pass);
  setCardStatus("kpi2Card", kpi2Pass);
  setRing("kpi2Ring", "kpi2RingNum", access, `${formatNumber(access, 1)}%`, kpi2Pass);

  countUp("totalDeaths", summary.die);
  countUp("totalAttempts", summary.attempt);
  countUp("totalCases", summary.die + summary.attempt);
  countUp("populationShown", population);
}

/* ---------- ข้อค้นพบสำคัญ (สร้างอัตโนมัติ) ---------- */

function renderInsights(allSummary, months) {
  const days = daysCovered(months);
  const items = [];

  /* KPI1: จังหวัดที่คาดการณ์เกินเป้า */
  const overTarget = DB.provinces
    .map((p) => ({
      name: p,
      projected: annualize(
        suicideRate((allSummary.byProvince[p] || { die: 0 }).die, DB.population[p]), days),
    }))
    .filter((p) => p.projected > DB.meta.kpi1Target)
    .sort((a, b) => b.projected - a.projected);
  if (overTarget.length > 0) {
    const names = overTarget
      .map((p) => `<strong>${p.name}</strong> (${formatNumber(p.projected, 2)})`)
      .join(" · ");
    items.push({ tone: "bad",
      text: `จังหวัดที่คาดการณ์อัตราฆ่าตัวตายทั้งปีเกินเป้า ≤ ${DB.meta.kpi1Target} ต่อแสน: ${names}` });
  } else {
    items.push({ tone: "good",
      text: `อัตราการฆ่าตัวตายสำเร็จ<strong>อยู่ในเป้าหมายทุกจังหวัด</strong> ในช่วงเวลาที่เลือก` });
  }

  /* KPI2: จังหวัดที่เข้าถึงบริการต่ำกว่าเป้า */
  const lowAccess = DB.provinces
    .map((p) => ({
      name: p,
      access: accessPercent(
        (allSummary.byProvince[p] || { attempt: 0 }).attempt, hdcCount([p], months)),
    }))
    .filter((p) => p.access < DB.meta.kpi2Target)
    .sort((a, b) => a.access - b.access);
  if (lowAccess.length > 0) {
    const names = lowAccess
      .map((p) => `<strong>${p.name}</strong> (${formatNumber(p.access, 1)}%)`)
      .join(" · ");
    items.push({ tone: "warn",
      text: `จังหวัดที่การเข้าถึงบริการต่ำกว่าเป้า ${DB.meta.kpi2Target}%: ${names}` });
  } else {
    items.push({ tone: "good",
      text: `การเข้าถึงบริการ<strong>ผ่านเป้าหมายทุกจังหวัด</strong> ในช่วงเวลาที่เลือก` });
  }

  /* เดือนที่เสียชีวิตสูงสุด */
  const peak = months.reduce((best, m) =>
    (allSummary.byMonth[m].die > (best ? allSummary.byMonth[best].die : -1) ? m : best), null);
  if (peak && allSummary.byMonth[peak].die > 0) {
    items.push({ tone: "accent",
      text: `เดือนที่มีผู้เสียชีวิตสูงสุด: <strong>${monthLabel(peak)}</strong> ` +
        `จำนวน ${formatNumber(allSummary.byMonth[peak].die)} ราย` });
  }

  /* กลุ่มอายุที่พบมากที่สุด */
  const topAge = Object.entries(allSummary.byAge)
    .filter(([g]) => g !== "ไม่ระบุ")
    .sort((a, b) => (b[1].die + b[1].attempt) - (a[1].die + a[1].attempt))[0];
  if (topAge) {
    items.push({ tone: "accent",
      text: `กลุ่มอายุที่พบมากที่สุด: <strong>${topAge[0]} ปี</strong> ` +
        `รวม ${formatNumber(topAge[1].die + topAge[1].attempt)} ราย` });
  }

  const grid = document.getElementById("insightGrid");
  grid.textContent = "";
  for (const item of items) {
    const div = document.createElement("div");
    div.className = `insight ${item.tone === "accent" ? "" : item.tone}`;
    div.innerHTML = item.text; // เนื้อหาสร้างจาก whitelist จังหวัด/เดือน/ตัวเลขเท่านั้น
    grid.appendChild(div);
  }
}

/* ---------- charts ---------- */

function initChartTheme() {
  Chart.defaults.font.family = '"IBM Plex Sans Thai", "Sarabun", sans-serif';
  Chart.defaults.font.size = 12;
  Chart.defaults.color = COLORS.muted;
  Chart.defaults.borderColor = COLORS.grid;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.pointStyle = "rectRounded";
  Chart.defaults.plugins.legend.labels.boxWidth = 10;
  Chart.defaults.plugins.tooltip.backgroundColor = "rgba(255, 255, 255, 0.97)";
  Chart.defaults.plugins.tooltip.titleColor = "#172033";
  Chart.defaults.plugins.tooltip.bodyColor = "#5b6b80";
  Chart.defaults.plugins.tooltip.borderColor = "rgba(23, 32, 51, 0.12)";
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.padding = 10;
  Chart.defaults.plugins.tooltip.cornerRadius = 8;
}

function drawChart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), config);
}

function areaGradient(canvasId, hex) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.parentElement.clientHeight);
  gradient.addColorStop(0, hex + "2e");
  gradient.addColorStop(1, hex + "03");
  return gradient;
}

function renderTrendChart(summary, months) {
  drawChart("trendChart", {
    type: "line",
    data: {
      labels: months.map(monthLabel),
      datasets: [
        {
          label: "ฆ่าตัวตายสำเร็จ",
          data: months.map((m) => summary.byMonth[m].die),
          borderColor: COLORS.death,
          backgroundColor: areaGradient("trendChart", COLORS.death),
          pointBackgroundColor: COLORS.death,
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 3.5,
        },
        {
          label: "พยายามฆ่าตัวตาย",
          data: months.map((m) => summary.byMonth[m].attempt),
          borderColor: COLORS.attempt,
          backgroundColor: areaGradient("trendChart", COLORS.attempt),
          pointBackgroundColor: COLORS.attempt,
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 3.5,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: "ราย" } },
      },
    },
  });
}

function renderProvinceRateChart(summary, months) {
  const days = daysCovered(months);
  const rates = DB.provinces.map((p) =>
    suicideRate((summary.byProvince[p] || { die: 0 }).die, DB.population[p]));
  const projected = rates.map((r) => annualize(r, days));

  drawChart("provinceRateChart", {
    type: "bar",
    data: {
      labels: DB.provinces,
      datasets: [
        {
          label: "อัตราสะสม (ช่วงที่เลือก)",
          data: rates,
          backgroundColor: COLORS.accent + "e6",
          borderRadius: 6,
        },
        {
          label: "คาดการณ์ทั้งปี",
          data: projected,
          backgroundColor: projected.map((v) =>
            v > DB.meta.kpi1Target ? COLORS.death + "cc" : COLORS.indigo + "99"),
          borderRadius: 6,
        },
        {
          label: `เป้าหมาย ≤ ${DB.meta.kpi1Target}`,
          data: DB.provinces.map(() => DB.meta.kpi1Target),
          type: "line",
          borderColor: COLORS.death,
          borderDash: [7, 6],
          borderWidth: 1.5,
          pointRadius: 0,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: "ต่อแสนประชากร" } },
      },
    },
  });
}

function renderAccessChart(summary, months) {
  const values = DB.provinces.map((p) => {
    const row = summary.byProvince[p] || { attempt: 0 };
    return accessPercent(row.attempt, hdcCount([p], months));
  });
  drawChart("accessChart", {
    type: "bar",
    data: {
      labels: DB.provinces,
      datasets: [
        {
          label: "% เข้าถึงบริการ = 100 × (506S ÷ HDC)",
          data: values,
          backgroundColor: values.map((v) =>
            v >= DB.meta.kpi2Target ? COLORS.good + "d9" : COLORS.attempt + "d9"),
          borderRadius: 6,
        },
        {
          label: `เป้าหมาย ≥ ${DB.meta.kpi2Target}%`,
          data: DB.provinces.map(() => DB.meta.kpi2Target),
          type: "line",
          borderColor: COLORS.death,
          borderDash: [7, 6],
          borderWidth: 1.5,
          pointRadius: 0,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: "y",
      scales: {
        x: { beginAtZero: true, max: MAX_PERCENT, title: { display: true, text: "%" } },
        y: { grid: { display: false } },
      },
    },
  });
}

/* ตัวชี้วัดรอง: % ผู้พยายามฯ ที่ได้รับการตรวจประเมินจิตเวช (ข้อ 7.2 จาก 506S) */
function renderAssessmentChart(summary) {
  const values = DB.provinces.map((p) => {
    const row = summary.byProvince[p] || { access: 0, attempt: 0 };
    return accessPercent(row.access, row.attempt);
  });
  drawChart("assessmentChart", {
    type: "bar",
    data: {
      labels: DB.provinces,
      datasets: [{
        label: "% ตรวจประเมินจิตเวช (ข้อ 7.2)",
        data: values,
        backgroundColor: COLORS.indigo + "d9",
        borderRadius: 6,
      }],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, max: MAX_PERCENT, title: { display: true, text: "%" } },
        y: { grid: { display: false } },
      },
    },
  });
}

function renderSexChart(summary) {
  const labels = Object.keys(summary.bySex);
  drawChart("sexChart", {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "ฆ่าตัวตายสำเร็จ",
          data: labels.map((s) => summary.bySex[s].die),
          backgroundColor: COLORS.death + "d9",
          borderRadius: 6,
        },
        {
          label: "พยายามฯ",
          data: labels.map((s) => summary.bySex[s].attempt),
          backgroundColor: COLORS.attempt + "d9",
          borderRadius: 6,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: "ราย" } },
      },
    },
  });
}

function renderAgeChart(summary) {
  const groups = DB.ageGroups.filter((g) => summary.byAge[g]);
  drawChart("ageChart", {
    type: "bar",
    data: {
      labels: groups,
      datasets: [
        {
          label: "ฆ่าตัวตายสำเร็จ",
          data: groups.map((g) => summary.byAge[g].die),
          backgroundColor: COLORS.death + "d9",
          stack: "a",
          borderRadius: 4,
        },
        {
          label: "พยายามฯ",
          data: groups.map((g) => summary.byAge[g].attempt),
          backgroundColor: COLORS.attempt + "d9",
          stack: "a",
          borderRadius: 4,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, title: { display: true, text: "ราย" } },
      },
    },
  });
}

function renderMethodChart(summary) {
  const entries = Object.entries(summary.byMethod).sort((a, b) => b[1] - a[1]);
  drawChart("methodChart", {
    type: "bar",
    data: {
      labels: entries.map(([name]) => name),
      datasets: [{
        label: "จำนวนครั้งที่ใช้",
        data: entries.map(([, n]) => n),
        backgroundColor: COLORS.teal + "d9",
        borderRadius: 6,
      }],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, title: { display: true, text: "ครั้ง" } },
        y: { grid: { display: false } },
      },
    },
  });
}

/* กลุ่มเสี่ยง/ปัจจัยเสี่ยง (Cri. + R1-R10) — ภาพรวมตามตัวกรอง */
function renderRiskChart(summary) {
  const entries = Object.entries(summary.byRisk).sort((a, b) => b[1] - a[1]);
  drawChart("riskChart", {
    type: "bar",
    data: {
      labels: entries.map(([name]) => name),
      datasets: [{
        label: "จำนวนราย",
        data: entries.map(([, n]) => n),
        backgroundColor: COLORS.accent + "d9",
        borderRadius: 6,
      }],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, title: { display: true, text: "ราย" } },
        y: { grid: { display: false } },
      },
    },
  });
}

/* กราฟย่อยรายจังหวัด: ปัจจัยเสี่ยง 5 อันดับแรกของแต่ละจังหวัด */
const TOP_RISKS_PER_PROVINCE = 5;

function renderProvinceRiskCharts(months) {
  const container = document.getElementById("provinceRiskGrid");
  /* ล้างกราฟเก่าก่อนสร้าง canvas ชุดใหม่ */
  for (const id of Object.keys(charts)) {
    if (id.startsWith("provRisk-")) {
      charts[id].destroy();
      delete charts[id];
    }
  }
  container.textContent = "";

  DB.provinces.forEach((province, index) => {
    const summary = summarize([province], months);
    const entries = Object.entries(summary.byRisk)
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_RISKS_PER_PROVINCE);
    const totalCases = summary.die + summary.attempt;

    const panel = document.createElement("article");
    panel.className = "panel mini-panel";
    const canvasId = `provRisk-${index}`;
    panel.innerHTML = `
      <p class="panel-title">${province}</p>
      <p class="panel-sub">${formatNumber(totalCases)} เคสในช่วงที่เลือก · ปัจจัยเสี่ยง ${TOP_RISKS_PER_PROVINCE} อันดับแรก</p>
      <div class="chart-box mini"><canvas id="${canvasId}"></canvas></div>`;
    container.appendChild(panel);

    drawChart(canvasId, {
      type: "bar",
      data: {
        labels: entries.map(([name]) => name),
        datasets: [{
          label: "ราย",
          data: entries.map(([, n]) => n),
          backgroundColor: COLORS.teal + "d9",
          borderRadius: 5,
        }],
      },
      options: {
        maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } },
        },
      },
    });
  });
}

/* ---------- ข้อมูลรายอำเภอ (drill-down เมื่อเลือกจังหวัด) ---------- */

const STACK_PALETTE = [
  "#0284c7", "#059669", "#f59e0b", "#dc2626", "#6366f1", "#0d9488", "#a855f7",
];
const OTHER_COLOR = "#94a3b8";
const TOP_STACK_CATEGORIES = 5;
const DISTRICT_ROW_PX = 34;
const DISTRICT_MIN_HEIGHT = 260;

/* รวมยอดรายอำเภอของจังหวัดตามเดือนที่เลือก (ตัดอำเภอที่ไม่มีเคสออก) */
function summarizeDistricts(province, months) {
  const result = {};
  const districts = DB.districts[province] || {};
  for (const [district, byMonth] of Object.entries(districts)) {
    const agg = {
      die: 0, attempt: 0, access: 0,
      bySex: {}, byAge: {}, byMethod: {}, byRisk: {},
    };
    for (const month of months) {
      const bucket = byMonth[month];
      if (!bucket) continue;
      agg.die += bucket.die;
      agg.attempt += bucket.attempt;
      agg.access += bucket.access;
      mergeCounts(agg.bySex, bucket.bySex);
      mergeCounts(agg.byAge, bucket.byAge);
      for (const [k, v] of Object.entries(bucket.byMethod)) {
        agg.byMethod[k] = (agg.byMethod[k] || 0) + v;
      }
      for (const [k, v] of Object.entries(bucket.byRisk || {})) {
        agg.byRisk[k] = (agg.byRisk[k] || 0) + v;
      }
    }
    if (agg.die + agg.attempt > 0) result[district] = agg;
  }
  return result;
}

function setDistrictChartHeight(canvasId, rowCount) {
  const box = document.getElementById(canvasId).parentElement;
  box.style.height = `${Math.max(DISTRICT_MIN_HEIGHT, rowCount * DISTRICT_ROW_PX + 80)}px`;
}

const HORIZONTAL_STACKED_OPTIONS = {
  maintainAspectRatio: false,
  indexAxis: "y",
  scales: {
    x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
    y: { stacked: true, grid: { display: false } },
  },
};

/* สร้าง stacked datasets จากหมวดหมู่ top-N ของทุกอำเภอ (ที่เหลือรวมเป็น อื่นๆ)
   ถ้าระบุ fixedOrder จะใช้ลำดับหมวดหมู่นั้นทั้งชุดแทนการเลือก top-N */
function stackedByCategory(order, byDistrict, field, fixedOrder) {
  const totals = {};
  for (const district of order) {
    for (const [k, v] of Object.entries(byDistrict[district][field])) {
      const n = typeof v === "number" ? v : v.die + v.attempt;
      totals[k] = (totals[k] || 0) + n;
    }
  }
  const top = fixedOrder
    ? fixedOrder.filter((k) => totals[k])
    : Object.entries(totals)
        .sort((a, b) => b[1] - a[1])
        .slice(0, TOP_STACK_CATEGORIES)
        .map(([k]) => k);

  const valueOf = (district, key) => {
    const v = byDistrict[district][field][key];
    if (v === undefined) return 0;
    return typeof v === "number" ? v : v.die + v.attempt;
  };
  const datasets = top.map((key, i) => ({
    label: key,
    data: order.map((d) => valueOf(d, key)),
    backgroundColor: STACK_PALETTE[i % STACK_PALETTE.length] + "d9",
    borderRadius: 3,
  }));
  const hasOther = Object.keys(totals).length > top.length;
  if (hasOther) {
    datasets.push({
      label: "อื่นๆ",
      data: order.map((d) =>
        Object.keys(byDistrict[d][field])
          .filter((k) => !top.includes(k))
          .reduce((sum, k) => sum + valueOf(d, k), 0)),
      backgroundColor: OTHER_COLOR + "b3",
      borderRadius: 3,
    });
  }
  return datasets;
}

function renderDistrictSection(provinceValue, months) {
  const section = document.getElementById("districtSection");
  const districtChartIds = [
    "dCasesChart", "dAssessChart", "dSexChart", "dAgeChart", "dMethodChart", "dRiskChart",
  ];
  if (provinceValue === "all") {
    section.hidden = true;
    for (const id of districtChartIds) {
      if (charts[id]) { charts[id].destroy(); delete charts[id]; }
    }
    return;
  }
  section.hidden = false;
  setText("districtTitle", `ข้อมูลรายอำเภอ · จังหวัด${provinceValue}`);

  const byDistrict = summarizeDistricts(provinceValue, months);
  const order = Object.keys(byDistrict).sort((a, b) =>
    (byDistrict[b].die + byDistrict[b].attempt) - (byDistrict[a].die + byDistrict[a].attempt));
  for (const id of districtChartIds) setDistrictChartHeight(id, order.length);

  /* 1. จำนวนเคสรายอำเภอ */
  drawChart("dCasesChart", {
    type: "bar",
    data: {
      labels: order,
      datasets: [
        {
          label: "ฆ่าตัวตายสำเร็จ",
          data: order.map((d) => byDistrict[d].die),
          backgroundColor: COLORS.death + "d9",
          borderRadius: 4,
        },
        {
          label: "พยายามฯ",
          data: order.map((d) => byDistrict[d].attempt),
          backgroundColor: COLORS.attempt + "d9",
          borderRadius: 4,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: "y",
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: "ราย" } },
        y: { grid: { display: false } },
      },
    },
  });

  /* 2. จำนวนผู้พยายามฯ ที่ได้รับการตรวจประเมินจิตเวช (ข้อ 7.2) รายอำเภอ */
  drawChart("dAssessChart", {
    type: "bar",
    data: {
      labels: order,
      datasets: [
        {
          label: "ได้รับการตรวจประเมิน",
          data: order.map((d) => byDistrict[d].access),
          backgroundColor: COLORS.good + "d9",
          borderRadius: 3,
        },
        {
          label: "ยังไม่ได้รับ",
          data: order.map((d) => byDistrict[d].attempt - byDistrict[d].access),
          backgroundColor: OTHER_COLOR + "8c",
          borderRadius: 3,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: "y",
      scales: {
        x: {
          stacked: true, beginAtZero: true,
          ticks: { precision: 0 },
          title: { display: true, text: "ราย" },
        },
        y: { stacked: true, grid: { display: false } },
      },
    },
  });

  /* 3-6. stacked: เพศ / กลุ่มอายุ / วิธี / กลุ่มเสี่ยง */
  drawChart("dSexChart", {
    type: "bar",
    data: { labels: order, datasets: stackedByCategory(order, byDistrict, "bySex") },
    options: HORIZONTAL_STACKED_OPTIONS,
  });
  drawChart("dAgeChart", {
    type: "bar",
    data: {
      labels: order,
      datasets: stackedByCategory(order, byDistrict, "byAge", DB.ageGroups),
    },
    options: HORIZONTAL_STACKED_OPTIONS,
  });
  drawChart("dMethodChart", {
    type: "bar",
    data: { labels: order, datasets: stackedByCategory(order, byDistrict, "byMethod") },
    options: HORIZONTAL_STACKED_OPTIONS,
  });
  drawChart("dRiskChart", {
    type: "bar",
    data: { labels: order, datasets: stackedByCategory(order, byDistrict, "byRisk") },
    options: HORIZONTAL_STACKED_OPTIONS,
  });
}

/* ---------- table ---------- */

function renderTable(summary, months) {
  const days = daysCovered(months);
  const tbody = document.querySelector("#provinceTable tbody");
  tbody.textContent = "";

  const makeRow = (name, counts, population, hdcTotal, isTotal) => {
    const rate = suicideRate(counts.die, population);
    const projected = annualize(rate, days);
    const access = accessPercent(counts.attempt, hdcTotal);
    const assessed = accessPercent(counts.access, counts.attempt);
    const row = document.createElement("tr");
    if (isTotal) row.className = "row-total";
    row.innerHTML = `
      <td>${name}</td>
      <td>${formatNumber(population)}</td>
      <td>${formatNumber(counts.die)}</td>
      <td>${formatNumber(rate, 2)}</td>
      <td>${formatNumber(projected, 2)}</td>
      <td>${formatNumber(counts.attempt)}</td>
      <td>${formatNumber(hdcTotal)}</td>
      <td>${formatNumber(access, 1)}</td>
      <td>${formatNumber(assessed, 1)}</td>
      <td><span class="cell-badge ${projected <= DB.meta.kpi1Target ? "pass" : "fail"}">${projected <= DB.meta.kpi1Target ? "ผ่าน" : "ไม่ผ่าน"}</span></td>
      <td><span class="cell-badge ${access >= DB.meta.kpi2Target ? "pass" : "fail"}">${access >= DB.meta.kpi2Target ? "ผ่าน" : "ไม่ผ่าน"}</span></td>`;
    return row;
  };

  for (const province of DB.provinces) {
    const counts = summary.byProvince[province] || { die: 0, attempt: 0, access: 0 };
    tbody.appendChild(makeRow(
      province, counts, DB.population[province], hdcCount([province], months), false));
  }
  tbody.appendChild(makeRow(
    "รวมเขตสุขภาพที่ 8",
    { die: summary.die, attempt: summary.attempt, access: summary.access },
    DB.population["รวม"],
    hdcCount(DB.provinces, months),
    true,
  ));
}

/* ---------- main ---------- */

function render() {
  const provinceValue = document.getElementById("provinceFilter").value;
  const periodValue = document.getElementById("periodFilter").value;
  const provinces = selectedProvinces(provinceValue);
  const months = selectedMonths(periodValue);

  const summary = summarize(provinces, months);
  /* ตาราง + กราฟรายจังหวัด + ข้อค้นพบ ต้องเห็นครบทุกจังหวัด (ตามช่วงเวลาที่เลือก) */
  const allProvinceSummary = provinceValue === "all"
    ? summary
    : summarize(DB.provinces, months);

  renderKpis(summary, provinces, months);
  renderInsights(allProvinceSummary, months);
  renderDistrictSection(provinceValue, months);
  renderTrendChart(summary, months);
  renderProvinceRateChart(allProvinceSummary, months);
  renderAccessChart(allProvinceSummary, months);
  renderAssessmentChart(allProvinceSummary);
  renderSexChart(summary);
  renderAgeChart(summary);
  renderMethodChart(summary);
  renderRiskChart(summary);
  renderProvinceRiskCharts(months);
  renderTable(allProvinceSummary, months);
}

function populateProvinceFilter() {
  const select = document.getElementById("provinceFilter");
  for (const province of DB.provinces) {
    const option = document.createElement("option");
    option.value = province;
    option.textContent = province;
    select.appendChild(option);
  }
}

async function init() {
  try {
    const response = await fetch("data.json");
    if (!response.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ (HTTP ${response.status})`);
    DB = await response.json();
  } catch (error) {
    document.querySelector("main").innerHTML =
      `<p style="padding:60px 20px;text-align:center;color:#dc2626;">
        เกิดข้อผิดพลาดในการโหลดข้อมูล: ${error.message}</p>`;
    return;
  }

  initChartTheme();
  setText("periodLabel", `ข้อมูล ณ ${DB.meta.periodLabel} (${formatNumber(DB.meta.daysCovered)} วัน)`);
  setText("generatedAt", new Date(DB.meta.generatedAt).toLocaleString("th-TH"));
  populateProvinceFilter();
  document.getElementById("provinceFilter").addEventListener("change", render);
  document.getElementById("periodFilter").addEventListener("change", render);
  render();
}

init();
