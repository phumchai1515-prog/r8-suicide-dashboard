/* Dashboard SMI-V เขตสุขภาพที่ 8 — ดึงข้อมูลสดจาก HDC OpenData API (smiv-api.js)
   อัปเดตเองอัตโนมัติระหว่างเปิดหน้าค้างไว้ โดยไม่ต้องกดรีเฟรช
   ถ้าเชื่อมต่อไม่ได้ ใช้ smiv-data.json (snapshot จาก ETL) เป็นข้อมูลสำรอง */

"use strict";

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

const PER_HUNDRED_THOUSAND = 100000;
const COUNT_UP_MS = 750;
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const ROUND_LABELS = {
  round6: "รอบ 6 เดือน",
  round9: "รอบ 9 เดือน",
  round12: "รอบ 12 เดือน",
};

/* HDC ประมวลผลข้อมูลวันละครั้ง ดึงซ้ำทุก 15 นาทีจึงเพียงพอ
   ส่วนตอนต่อไม่ได้ให้ลองถี่ขึ้น จะได้กลับมาแสดงข้อมูลสดเร็วเมื่อเน็ตกลับมา */
const LIVE_REFRESH_MS = 15 * 60 * 1000;
const OFFLINE_RETRY_MS = 2 * 60 * 1000;
const STALE_AFTER_MS = 5 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

const STATUS = { LIVE: "live", STALE: "stale", OFFLINE: "offline" };

let DB = null;
let lastLiveFetchAt = null;
let isLastRefreshOk = false;
let isRefreshing = false;
let refreshTimer = null;
let animateNumbers = true;

/* ---------- utilities ---------- */

function minutesOf(ms) {
  return Math.round(ms / MS_PER_MINUTE);
}

function formatNumber(value, digits = 0) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function setText(id, text) {
  document.getElementById(id).textContent = text;
}

function countUp(id, target, digits = 0) {
  const el = document.getElementById(id);
  if (REDUCED_MOTION || !animateNumbers) {
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

function currentTarget() {
  return DB.meta.targets[DB.meta.currentRound];
}

const DEFAULT_ACCESS_TARGET = 40;

function accessTarget() {
  return DB.meta.accessTarget ?? DEFAULT_ACCESS_TARGET;
}

function patientRate(province) {
  return DB.data[province].total / DB.population[province] * PER_HUNDRED_THOUSAND;
}

/* ---------- KPI hero ---------- */

function renderKpis() {
  const total = DB.data["รวม"];
  const target = currentTarget();
  const targetText =
    `เป้าหมาย: รอบ 6 เดือน ≥ ${DB.meta.targets.round6}% · รอบ 9 เดือน ≥ ${DB.meta.targets.round9}% · ` +
    `รอบ 12 เดือน ≥ ${DB.meta.targets.round12}% (สถานะปัจจุบันเทียบ${ROUND_LABELS[DB.meta.currentRound]})`;

  const kpi1Pass = total.kpi >= target;
  countUp("kpi1Value", total.kpi, 1);
  setText("kpi1Target", targetText);
  setText("kpi1Detail",
    `ติดตามอย่างน้อย 2 ครั้งและไม่ก่อความรุนแรงซ้ำ ${formatNumber(total.follow2NoRepeat)} คน ` +
    `จากผู้ป่วยทั้งหมด ${formatNumber(total.total)} คน`);
  setBadge("kpi1Badge", kpi1Pass);
  setCardStatus("kpi1Card", kpi1Pass);
  setRing("kpi1Ring", "kpi1RingNum", total.kpi, `${formatNumber(total.kpi, 1)}%`, kpi1Pass);

  const kpi2Pass = total.accessRate >= accessTarget();
  countUp("kpi2Value", total.accessRate, 1);
  setText("kpi2Target",
    `เกณฑ์ผ่าน: % เข้าถึงบริการ ≥ ${formatNumber(accessTarget())}% (ประมาณการผู้ป่วยในพื้นที่ = 100%)`);
  setText("kpi2Detail",
    `ผู้ป่วยสะสม ${formatNumber(total.total)} คน จากประมาณการ ${formatNumber(total.estimated)} คน ` +
    `(เกิน 100% ได้เมื่อพบผู้ป่วยจริงมากกว่าประมาณการ)`);
  setBadge("kpi2Badge", kpi2Pass);
  setCardStatus("kpi2Card", kpi2Pass);
  setRing("kpi2Ring", "kpi2RingNum", total.accessRate,
    `${formatNumber(total.accessRate, 1)}%`, kpi2Pass);

  countUp("totalPatients", total.total);
  countUp("newPatients", total.new);
  countUp("estimatedPatients", total.estimated);
  countUp("noRepeatPatients", total.noRepeat);
}

/* ---------- ข้อค้นพบสำคัญ ---------- */

function renderInsights() {
  const target = currentTarget();
  const items = [];

  const passed = DB.provinces.filter((p) => DB.data[p].kpi >= target);
  const failed = DB.provinces
    .filter((p) => DB.data[p].kpi < target)
    .sort((a, b) => DB.data[a].kpi - DB.data[b].kpi);
  if (passed.length > 0) {
    items.push({ tone: "good",
      text: `จังหวัดที่ผ่านเป้า${ROUND_LABELS[DB.meta.currentRound]} (≥ ${target}%): ` +
        passed.map((p) => `<strong>${p}</strong> (${formatNumber(DB.data[p].kpi, 1)}%)`).join(" · ") });
  }
  if (failed.length > 0) {
    items.push({ tone: "bad",
      text: `จังหวัดที่ยังไม่ผ่านเป้า เรียงจากต่ำสุด: ` +
        failed.slice(0, 3).map((p) => `<strong>${p}</strong> (${formatNumber(DB.data[p].kpi, 1)}%)`).join(" · ") +
        (failed.length > 3 ? ` และอีก ${failed.length - 3} จังหวัด` : "") });
  }

  const bestAccess = [...DB.provinces].sort(
    (a, b) => DB.data[b].accessRate - DB.data[a].accessRate)[0];
  const worstAccess = [...DB.provinces].sort(
    (a, b) => DB.data[a].accessRate - DB.data[b].accessRate)[0];
  const accessPassed = DB.provinces.filter(
    (p) => DB.data[p].accessRate >= accessTarget());
  items.push({ tone: "accent",
    text: `เข้าถึงบริการผ่านเกณฑ์ (≥ ${formatNumber(accessTarget())}%) ` +
      `<strong>${accessPassed.length}</strong> จาก ${DB.provinces.length} จังหวัด · ` +
      `สูงสุด <strong>${bestAccess}</strong> (${formatNumber(DB.data[bestAccess].accessRate, 1)}%) · ` +
      `ต่ำสุด <strong>${worstAccess}</strong> (${formatNumber(DB.data[worstAccess].accessRate, 1)}%)` });

  const topRate = [...DB.provinces].sort((a, b) => patientRate(b) - patientRate(a))[0];
  items.push({ tone: "warn",
    text: `อัตราผู้ป่วย SMI-V สูงสุด: <strong>${topRate}</strong> ` +
      `${formatNumber(patientRate(topRate), 1)} ต่อแสนประชากร ` +
      `(${formatNumber(DB.data[topRate].total)} คน)` });

  const grid = document.getElementById("insightGrid");
  grid.textContent = "";
  for (const item of items) {
    const div = document.createElement("div");
    div.className = `insight ${item.tone === "accent" ? "" : item.tone}`;
    div.innerHTML = item.text; // เนื้อหาจาก whitelist จังหวัด/ตัวเลขเท่านั้น
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

/* ทำลายกราฟเดิมบน canvas ก่อนวาดใหม่ ไม่งั้น Chart.js จะฟ้อง "Canvas is already in use"
   ตอนอัปเดตข้อมูลอัตโนมัติ */
function createChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  Chart.getChart(canvas)?.destroy();
  return new Chart(canvas, config);
}

function targetLineDataset(label, value) {
  return {
    label,
    data: DB.provinces.map(() => value),
    type: "line",
    borderColor: COLORS.death,
    borderDash: [7, 6],
    borderWidth: 1.5,
    pointRadius: 0,
  };
}

function renderKpiChart() {
  const target = currentTarget();
  const values = DB.provinces.map((p) => DB.data[p].kpi);
  createChart("kpiChart", {
    type: "bar",
    data: {
      labels: DB.provinces,
      datasets: [
        {
          label: "% ดูแลต่อเนื่องและไม่ก่อความรุนแรงซ้ำ",
          data: values,
          backgroundColor: values.map((v) =>
            v >= target ? COLORS.good + "d9" : COLORS.attempt + "d9"),
          borderRadius: 6,
        },
        targetLineDataset(`เป้า${ROUND_LABELS[DB.meta.currentRound]} ≥ ${target}%`, target),
        targetLineDataset(`เป้ารอบ 12 เดือน ≥ ${DB.meta.targets.round12}%`, DB.meta.targets.round12),
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: "%" } },
      },
    },
  });
}

function renderAccessChart() {
  const target = accessTarget();
  const values = DB.provinces.map((p) => DB.data[p].accessRate);
  createChart("accessChart", {
    type: "bar",
    data: {
      labels: DB.provinces,
      datasets: [
        {
          label: "% เข้าถึงบริการ (สะสม)",
          data: values,
          backgroundColor: values.map((v) =>
            v >= target ? COLORS.good + "d9" : COLORS.attempt + "d9"),
          borderRadius: 6,
        },
        targetLineDataset(`เกณฑ์ผ่าน ≥ ${formatNumber(target)}%`, target),
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: "%" } },
      },
    },
  });
}

function renderPatientsChart() {
  createChart("patientsChart", {
    type: "bar",
    data: {
      labels: DB.provinces,
      datasets: [
        {
          label: "รายเก่าก่อนปีงบ",
          data: DB.provinces.map((p) => DB.data[p].old),
          backgroundColor: COLORS.indigo + "d9",
          stack: "a",
          borderRadius: 4,
        },
        {
          label: "รายใหม่ปีงบนี้",
          data: DB.provinces.map((p) => DB.data[p].new),
          backgroundColor: COLORS.attempt + "d9",
          stack: "a",
          borderRadius: 4,
        },
        {
          label: "ประมาณการในพื้นที่",
          data: DB.provinces.map((p) => DB.data[p].estimated),
          type: "line",
          borderColor: COLORS.death,
          borderDash: [7, 6],
          borderWidth: 1.5,
          pointRadius: 3,
          pointBackgroundColor: COLORS.death,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, title: { display: true, text: "คน" } },
      },
    },
  });
}

function renderFollowChart() {
  createChart("followChart", {
    type: "bar",
    data: {
      labels: DB.provinces,
      datasets: [
        {
          label: "ติดตาม 1 ครั้ง",
          data: DB.provinces.map((p) => DB.data[p].follow1),
          backgroundColor: COLORS.accent + "d9",
          borderRadius: 4,
        },
        {
          label: "ติดตาม ≥2 ครั้ง",
          data: DB.provinces.map((p) => DB.data[p].follow2),
          backgroundColor: COLORS.teal + "d9",
          borderRadius: 4,
        },
        {
          label: "ติดตาม ≥2 + ไม่ก่อซ้ำ",
          data: DB.provinces.map((p) => DB.data[p].follow2NoRepeat),
          backgroundColor: COLORS.good + "d9",
          borderRadius: 4,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: "คน" } },
      },
    },
  });
}

function renderRateChart() {
  createChart("rateChart", {
    type: "bar",
    data: {
      labels: DB.provinces,
      datasets: [{
        label: "ผู้ป่วยต่อแสนประชากร",
        data: DB.provinces.map((p) => patientRate(p)),
        backgroundColor: COLORS.indigo + "d9",
        borderRadius: 6,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: "ต่อแสนประชากร" } },
      },
    },
  });
}

function renderNoRepeatChart() {
  createChart("noRepeatChart", {
    type: "bar",
    data: {
      labels: DB.provinces,
      datasets: [{
        label: "ไม่ก่อความรุนแรงซ้ำ",
        data: DB.provinces.map((p) => DB.data[p].noRepeat),
        backgroundColor: COLORS.good + "d9",
        borderRadius: 6,
      }],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, title: { display: true, text: "คน" } },
      },
    },
  });
}

/* ---------- table ---------- */

function renderTable() {
  const target = currentTarget();
  setText("tableSub",
    `เกณฑ์ผ่าน: % เข้าถึงบริการ ≥ ${accessTarget()}% · % ดูแลต่อเนื่องและไม่ก่อความรุนแรงซ้ำ ≥ ${target}% ` +
    `(${ROUND_LABELS[DB.meta.currentRound]}) · เลื่อนดูข้อมูลด้านขวาได้`);
  const tbody = document.querySelector("#smivTable tbody");
  tbody.textContent = "";

  const makeRow = (name, entry, population, isTotal) => {
    const rate = entry.total / population * PER_HUNDRED_THOUSAND;
    const isPass = entry.kpi >= target;
    const isAccessPass = entry.accessRate >= accessTarget();
    const row = document.createElement("tr");
    if (isTotal) row.className = "row-total";
    row.innerHTML = `
      <td>${name}</td>
      <td>${formatNumber(population)}</td>
      <td>${formatNumber(entry.old)}</td>
      <td>${formatNumber(entry.new)}</td>
      <td>${formatNumber(entry.total)}</td>
      <td>${formatNumber(rate, 1)}</td>
      <td>${formatNumber(entry.estimated)}</td>
      <td>${formatNumber(entry.accessRate, 1)}
        <span class="cell-badge ${isAccessPass ? "pass" : "fail"}">${isAccessPass ? "ผ่าน" : "ไม่ผ่าน"}</span></td>
      <td>${formatNumber(entry.follow2NoRepeat)}</td>
      <td>${formatNumber(entry.kpi, 1)}</td>
      <td><span class="cell-badge ${isPass ? "pass" : "fail"}">${isPass ? "ผ่าน" : "ไม่ผ่าน"}</span></td>`;
    return row;
  };

  for (const province of DB.provinces) {
    tbody.appendChild(makeRow(province, DB.data[province], DB.population[province], false));
  }
  tbody.appendChild(makeRow("รวมเขตสุขภาพที่ 8", DB.data["รวม"], DB.population["รวม"], true));
}

/* ---------- live status ---------- */

function formatThaiDateTime(date) {
  return date.toLocaleString("th-TH", { dateStyle: "long", timeStyle: "short" });
}

function statusMessage(status, fetchedAt, apiErrorMessage) {
  if (status === STATUS.LIVE) {
    return `เชื่อมต่อ HDC OpenData API โดยตรง — อัปเดตเองอัตโนมัติทุก ${minutesOf(LIVE_REFRESH_MS)} นาที ` +
      `(ดึงข้อมูลล่าสุดเมื่อ ${formatThaiDateTime(fetchedAt)} น.)`;
  }
  if (status === STATUS.STALE) {
    return `แสดงข้อมูลสดที่ดึงไว้เมื่อ ${formatThaiDateTime(fetchedAt)} น. — ` +
      `อัปเดตรอบล่าสุดไม่สำเร็จ (${apiErrorMessage}) กำลังลองใหม่อัตโนมัติ`;
  }
  return `เชื่อมต่อ HDC ไม่ได้ขณะนี้ — แสดงข้อมูลสำรองชุดล่าสุด (สาเหตุ: ${apiErrorMessage}) ` +
    `กำลังลองเชื่อมต่อใหม่อัตโนมัติทุก ${minutesOf(OFFLINE_RETRY_MS)} นาที`;
}

function renderLiveStatus(status, fetchedAt, apiErrorMessage) {
  const el = document.getElementById("liveStatus");
  el.hidden = false;
  el.textContent = "";
  el.className = `live-status ${status}`;

  const dot = document.createElement("span");
  dot.className = "live-dot";
  el.appendChild(dot);
  el.appendChild(document.createTextNode(statusMessage(status, fetchedAt, apiErrorMessage)));
}

/* ---------- main ---------- */

async function loadFallbackData() {
  const response = await fetch("smiv-data.json");
  if (!response.ok) throw new Error(`โหลดข้อมูลสำรองไม่สำเร็จ (HTTP ${response.status})`);
  const db = await response.json();
  return {
    ...db,
    meta: { ...db.meta, asOfLabel: `${db.meta.asOfLabel} · ข้อมูลสำรอง (เชื่อมต่อ HDC API ไม่ได้)` },
  };
}

function renderDashboard(status, fetchedAt, apiErrorMessage) {
  setText("periodLabel", DB.meta.asOfLabel);
  setText("generatedAt", new Date(DB.meta.generatedAt).toLocaleString("th-TH"));
  setText("fetchedAt", `${formatThaiDateTime(fetchedAt)} น.`);
  renderLiveStatus(status, fetchedAt, apiErrorMessage);
  renderKpis();
  renderInsights();
  renderKpiChart();
  renderAccessChart();
  renderPatientsChart();
  renderFollowChart();
  renderRateChart();
  renderNoRepeatChart();
  renderTable();
  animateNumbers = false; // นับเลขวิ่งเฉพาะครั้งแรก รอบอัปเดตอัตโนมัติไม่ต้องกวนสายตา
}

function showFatalError(message) {
  document.querySelector("main").innerHTML =
    `<p style="padding:60px 20px;text-align:center;color:#dc2626;">
      เกิดข้อผิดพลาดในการโหลดข้อมูล: ${message}</p>`;
}

/* ดึงข้อมูลสด 1 รอบแล้ววาดใหม่ — ถ้าพลาดแต่เคยได้ข้อมูลสดแล้ว ให้คงข้อมูลเดิมไว้
   จะได้ไม่ถอยกลับไปใช้ข้อมูลสำรองที่เก่ากว่าเพียงเพราะเน็ตสะดุดรอบเดียว */
async function refreshOnce() {
  try {
    DB = await loadSmivFromApi();
    lastLiveFetchAt = new Date();
    isLastRefreshOk = true;
    renderDashboard(STATUS.LIVE, lastLiveFetchAt, "");
    return;
  } catch (apiError) {
    console.error("โหลดข้อมูลจาก HDC API ไม่สำเร็จ:", apiError);
    isLastRefreshOk = false;

    if (lastLiveFetchAt !== null) {
      renderLiveStatus(STATUS.STALE, lastLiveFetchAt, apiError.message);
      return;
    }
    try {
      DB = await loadFallbackData();
      renderDashboard(STATUS.OFFLINE, new Date(), apiError.message);
    } catch (fallbackError) {
      showFatalError(fallbackError.message);
    }
  }
}

function scheduleNextRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refresh, isLastRefreshOk ? LIVE_REFRESH_MS : OFFLINE_RETRY_MS);
}

async function refresh() {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    await refreshOnce();
  } finally {
    isRefreshing = false;
    scheduleNextRefresh();
  }
}

/* กลับมาที่แท็บนี้แล้วข้อมูลเก่าเกินกำหนด → ดึงใหม่ทันที ไม่ต้องรอครบรอบ
   (เบราว์เซอร์หน่วง timer ของแท็บที่ซ่อนอยู่ ข้อมูลจึงอาจค้างนานกว่าที่ตั้งไว้) */
function refreshIfStaleOnFocus() {
  if (document.visibilityState !== "visible") return;
  const age = lastLiveFetchAt === null ? Infinity : Date.now() - lastLiveFetchAt.getTime();
  if (age >= STALE_AFTER_MS) refresh();
}

function init() {
  initChartTheme();
  document.addEventListener("visibilitychange", refreshIfStaleOnFocus);
  refresh();
}

init();
