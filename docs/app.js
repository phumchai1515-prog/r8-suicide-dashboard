/* Dashboard ตัวชี้วัดการฆ่าตัวตาย เขตสุขภาพที่ 8 — อ่าน data.json (ข้อมูลสรุปรวม) แล้ว render */

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
  death: "#c0392b",
  attempt: "#e67e22",
  navy: "#1e3a5f",
  teal: "#0e7c7b",
  green: "#1e8e5a",
  grayLine: "#8896a5",
};

const DAYS_PER_YEAR = 365;
const PER_HUNDRED_THOUSAND = 100000;

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
    bySex: {}, byAge: {}, byMethod: {},
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
  return attempts > 0 ? (access / attempts) * 100 : 0;
}

/* ---------- KPI cards ---------- */

function renderKpis(summary, provinces, months) {
  const population = provinces.length === DB.provinces.length
    ? DB.population["รวม"]
    : provinces.reduce((sum, p) => sum + DB.population[p], 0);

  const days = daysCovered(months);
  const rate = suicideRate(summary.die, population);
  const projected = annualize(rate, days);
  const access = accessPercent(summary.access, summary.attempt);

  setText("kpi1Value", formatNumber(rate, 2));
  setText("kpi1Target", formatNumber(DB.meta.kpi1Target, 0));
  setText("kpi1Annualized",
    `คาดการณ์ทั้งปี (annualized): ${formatNumber(projected, 2)} ต่อแสนประชากร ` +
    `(จากข้อมูล ${formatNumber(days)} วัน) · เสียชีวิต ${formatNumber(summary.die)} ราย`);
  setBadge("kpi1Badge", projected <= DB.meta.kpi1Target);

  setText("kpi2Value", formatNumber(access, 1));
  setText("kpi2Target", formatNumber(DB.meta.kpi2Target, 0));
  setText("kpi2Detail",
    `ได้รับการตรวจประเมินจิตเวช (ข้อ 7.2) ${formatNumber(summary.access)} ราย ` +
    `จากผู้พยายามฯ ${formatNumber(summary.attempt)} ราย`);
  setBadge("kpi2Badge", access >= DB.meta.kpi2Target);

  setText("totalDeaths", formatNumber(summary.die));
  setText("totalAttempts", formatNumber(summary.attempt));
  setText("totalCases", formatNumber(summary.die + summary.attempt));
  setText("populationShown", formatNumber(population));
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function setBadge(id, isPass) {
  const badge = document.getElementById(id);
  badge.textContent = isPass ? "ผ่านเป้าหมาย" : "ไม่ผ่านเป้าหมาย";
  badge.className = `kpi-badge ${isPass ? "pass" : "fail"}`;
}

/* ---------- charts ---------- */

function drawChart(id, config) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), config);
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
          backgroundColor: COLORS.death,
          tension: 0.3,
        },
        {
          label: "พยายามฆ่าตัวตาย",
          data: months.map((m) => summary.byMonth[m].attempt),
          borderColor: COLORS.attempt,
          backgroundColor: COLORS.attempt,
          tension: 0.3,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: "ราย" } } },
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
        { label: "อัตราสะสม (ช่วงที่เลือก)", data: rates, backgroundColor: COLORS.navy },
        { label: "คาดการณ์ทั้งปี", data: projected, backgroundColor: "#7fa3c8" },
        {
          label: `เป้าหมาย ≤ ${DB.meta.kpi1Target}`,
          data: DB.provinces.map(() => DB.meta.kpi1Target),
          type: "line",
          borderColor: COLORS.death,
          borderDash: [6, 6],
          pointRadius: 0,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: "ต่อแสนประชากร" } } },
    },
  });
}

function renderAccessChart(summary) {
  const values = DB.provinces.map((p) => {
    const row = summary.byProvince[p] || { access: 0, attempt: 0 };
    return accessPercent(row.access, row.attempt);
  });
  drawChart("accessChart", {
    type: "bar",
    data: {
      labels: DB.provinces,
      datasets: [
        {
          label: "% เข้าถึงบริการ",
          data: values,
          backgroundColor: values.map((v) =>
            v >= DB.meta.kpi2Target ? COLORS.green : COLORS.attempt),
        },
        {
          label: `เป้าหมาย ≥ ${DB.meta.kpi2Target}%`,
          data: DB.provinces.map(() => DB.meta.kpi2Target),
          type: "line",
          borderColor: COLORS.death,
          borderDash: [6, 6],
          pointRadius: 0,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: "y",
      scales: { x: { beginAtZero: true, max: 100, title: { display: true, text: "%" } } },
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
        { label: "ฆ่าตัวตายสำเร็จ", data: labels.map((s) => summary.bySex[s].die), backgroundColor: COLORS.death },
        { label: "พยายามฯ", data: labels.map((s) => summary.bySex[s].attempt), backgroundColor: COLORS.attempt },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: "ราย" } } },
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
        { label: "ฆ่าตัวตายสำเร็จ", data: groups.map((g) => summary.byAge[g].die), backgroundColor: COLORS.death, stack: "a" },
        { label: "พยายามฯ", data: groups.map((g) => summary.byAge[g].attempt), backgroundColor: COLORS.attempt, stack: "a" },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true },
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
      datasets: [{ label: "จำนวนครั้งที่ใช้", data: entries.map(([, n]) => n), backgroundColor: COLORS.teal }],
    },
    options: {
      maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { beginAtZero: true, title: { display: true, text: "ครั้ง" } } },
    },
  });
}

/* ---------- table ---------- */

function renderTable(summary, months) {
  const days = daysCovered(months);
  const tbody = document.querySelector("#provinceTable tbody");
  tbody.textContent = "";

  const makeRow = (name, counts, population, isTotal) => {
    const rate = suicideRate(counts.die, population);
    const projected = annualize(rate, days);
    const access = accessPercent(counts.access, counts.attempt);
    const row = document.createElement("tr");
    if (isTotal) row.className = "row-total";
    row.innerHTML = `
      <td>${name}</td>
      <td>${formatNumber(population)}</td>
      <td>${formatNumber(counts.die)}</td>
      <td>${formatNumber(rate, 2)}</td>
      <td>${formatNumber(projected, 2)}</td>
      <td>${formatNumber(counts.attempt)}</td>
      <td>${formatNumber(counts.access)}</td>
      <td>${formatNumber(access, 1)}</td>
      <td><span class="cell-badge ${projected <= DB.meta.kpi1Target ? "pass" : "fail"}">${projected <= DB.meta.kpi1Target ? "ผ่าน" : "ไม่ผ่าน"}</span></td>
      <td><span class="cell-badge ${access >= DB.meta.kpi2Target ? "pass" : "fail"}">${access >= DB.meta.kpi2Target ? "ผ่าน" : "ไม่ผ่าน"}</span></td>`;
    return row;
  };

  for (const province of DB.provinces) {
    const counts = summary.byProvince[province] || { die: 0, attempt: 0, access: 0 };
    tbody.appendChild(makeRow(province, counts, DB.population[province], false));
  }
  tbody.appendChild(makeRow(
    "รวมเขตสุขภาพที่ 8",
    { die: summary.die, attempt: summary.attempt, access: summary.access },
    DB.population["รวม"],
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
  /* ตาราง + กราฟรายจังหวัดต้องเห็นครบทุกจังหวัด (ตามช่วงเวลาที่เลือก) */
  const allProvinceSummary = provinceValue === "all"
    ? summary
    : summarize(DB.provinces, months);

  renderKpis(summary, provinces, months);
  renderTrendChart(summary, months);
  renderProvinceRateChart(allProvinceSummary, months);
  renderAccessChart(allProvinceSummary);
  renderSexChart(summary);
  renderAgeChart(summary);
  renderMethodChart(summary);
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
      `<p style="padding:40px;text-align:center;color:#c0392b;">
        เกิดข้อผิดพลาดในการโหลดข้อมูล: ${error.message}</p>`;
    return;
  }

  setText("periodLabel", `ข้อมูล ณ ${DB.meta.periodLabel} (${formatNumber(DB.meta.daysCovered)} วัน)`);
  setText("generatedAt", new Date(DB.meta.generatedAt).toLocaleString("th-TH"));
  populateProvinceFilter();
  document.getElementById("provinceFilter").addEventListener("change", render);
  document.getElementById("periodFilter").addEventListener("change", render);
  render();
}

init();
