/* ตัวช่วยดึงข้อมูลที่ใช้ร่วมกันทั้ง 2 หน้า (index.html และ smiv.html)
   — ตั้งเวลาหมดรอ ยิงซ้ำเมื่อพลาด และแปลง error ของ fetch เป็นข้อความภาษาไทยที่บอกได้ว่าต้องแก้ที่ไหน */

"use strict";

const REQUEST_TIMEOUT_MS = 15000;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 800;
const MS_PER_MINUTE = 60 * 1000;

function minutesOf(ms) {
  return Math.round(ms / MS_PER_MINUTE);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* เบราว์เซอร์เก่าบางรุ่นยังไม่มี AbortSignal.timeout — ถ้าไม่มีก็ยิงแบบไม่จำกัดเวลาแทนที่จะพัง */
function timeoutSignal() {
  return typeof AbortSignal?.timeout === "function"
    ? AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    : undefined;
}

/* แปลง error ของ fetch เป็นข้อความที่ผู้ใช้อ่านแล้วรู้ว่าติดที่ไหน
   source = ชื่อแหล่งข้อมูลที่จะแสดงในข้อความ เช่น "opendata.moph.go.th" */
function describeFetchError(error, source) {
  if (error?.name === "TimeoutError" || error?.name === "AbortError") {
    return `${source} ไม่ตอบภายใน ${REQUEST_TIMEOUT_MS / 1000} วินาที`;
  }
  if (error instanceof TypeError) {
    return `เบราว์เซอร์ติดต่อ ${source} ไม่ได้ ` +
      "(อินเทอร์เน็ตหลุด หรือไฟร์วอลล์/พร็อกซีของเครือข่ายบล็อกไว้)";
  }
  return error?.message ?? "ไม่ทราบสาเหตุ";
}

/* ยิงซ้ำก่อนยอมแพ้ เพื่อไม่ให้เน็ตสะดุดครั้งเดียวทำให้ทั้งหน้าใช้ข้อมูลสดไม่ได้
   requestOnce ต้องเป็นฟังก์ชันที่ยิง fetch 1 ครั้งและ throw เมื่อไม่สำเร็จ */
async function fetchWithRetry(requestOnce, source) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestOnce();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await delay(RETRY_BASE_DELAY_MS * attempt);
    }
  }
  throw new Error(describeFetchError(lastError, source));
}
