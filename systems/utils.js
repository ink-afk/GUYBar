// systems/utils.js - 小小優化版（更硬更安全）
const fs = require('fs');
const path = require('path');  // 加這個，之後路徑更穩

function loadJSON(filePath, fallback = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      // 確保資料夾存在（防data資料夾沒建）
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
      return fallback;
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`❌ 讀取 ${filePath} 失敗，自動重建：`, err.message);
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function saveJSON(filePath, data) {
  try {
    // 確保資料夾存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`❌ 保存 ${filePath} 失敗：`, err.message);
  }
}

function today() {
  // 改用 ISO 日期，避免不同時區出問題（只取日期部分）
  return new Date().toISOString().split('T')[0];  // '2025-12-20'
}

function progressBar(cur, max, len = 20) {
  if (max <= 0) return '░'.repeat(len);  // 防除零
  const p = Math.min(Math.max(cur / max, 0), 1);
  const filled = Math.round(p * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}

module.exports = { loadJSON, saveJSON, today, progressBar };