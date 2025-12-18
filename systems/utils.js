const fs = require('fs');

function loadJSON(path, fallback) {
  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, JSON.stringify(fallback, null, 2));
    return fallback;
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function saveJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function today() {
  return new Date().toDateString();
}

function progressBar(cur, max, len = 20) {
  const p = Math.min(cur / max, 1);
  return '█'.repeat(Math.round(p * len)) + '░'.repeat(len - Math.round(p * len));
}

module.exports = { loadJSON, saveJSON, today, progressBar };