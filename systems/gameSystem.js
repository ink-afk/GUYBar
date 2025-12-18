// systems/gameSystem.js
const fs = require('fs');
const path = require('path');
const { loadJSON, saveJSON, today, progressBar } = require('./utils');

const WORLD_FILE = './data/world.json';
const USERS_FILE = './data/users.json';
const COOLDOWN_FILE = './data/cooldown.json';
const ORDER_FILE = './data/order.json';
const TASK_FILE = './data/tasks.json';
const FIXED_TASK_FILE = './data/fixedTasksProgress.json';
const HIDDEN_TASK_FILE = './data/hiddenTasksProgress.json';

// ===== 初始資料 =====
let world = loadJSON(WORLD_FILE, {
  era: 1,
  currentRegion: 'central',
  lastReset: today(),
  regions: { central: { name: '中央城邦', level: 1, bless: 0, target: 100, unlocked: true, buildings: ['祈福壇'] } }
});

let users = loadJSON(USERS_FILE, { totalPray: {}, dailyPray: {} });
let cooldown = loadJSON(COOLDOWN_FILE, {});
let order = loadJSON(ORDER_FILE, {});
let taskData = loadJSON(TASK_FILE, { day: '', task: null });
let fixedTaskProgress = loadJSON(FIXED_TASK_FILE, { day: '', users: {} });
let hiddenTaskProgress = loadJSON(HIDDEN_TASK_FILE, {}); // 隱藏任務進度

// ===== 防重事件集 =====
let processedEvents = new Set();

// ===== 任務設定 =====
const TASK_POOL = [
  { type: 'message', desc: '今日發送 {goal} 則訊息', min: 3, max: 8, reward: 2 },
  { type: 'emoji', desc: '發送 {goal} 個表情符號', min: 5, max: 10, reward: 2 },
  { type: 'reply', desc: '回覆他人訊息 {goal} 次', min: 2, max: 5, reward: 3 },
  { type: 'attachment', desc: '上傳 {goal} 張圖片或貼圖', min: 1, max: 3, reward: 3 },
  { type: 'greet', desc: '打招呼 {goal} 次（早安/午安/晚安/安安）', min: 1, max: 2, reward: 2 }
];

const FIXED_TASKS = [{ type: 'pray', desc: '每日上香 1 次', required: 1, reward: 3 }];

const HIDDEN_TASKS = [
  { type: 'secretMessage', desc: '偷偷發送「寶」字訊息 3 次', goal: 3, reward: 5 },
  { type: 'nightPray', desc: '午夜上香一次', goal: 1, reward: 4 }
];

// ===== 特殊時間 Buff =====
function getCurrentBuff() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  if (hour >= 22 && hour < 23) return { multiplier: 2, desc: '午夜香火加倍' };
  if (day === 0 || day === 6) return { multiplier: 2, desc: '週末活動加倍' };
  return { multiplier: 1, desc: '' };
}

// ===== 統一獎勵 =====
function grantReward(msg, uid, amount, reason) {
  const buff = getCurrentBuff();
  const finalAmount = amount * buff.multiplier;
  users.totalPray[uid] = (users.totalPray[uid] || 0) + finalAmount;
  saveJSON(USERS_FILE, users);
  msg.reply(`🎁 ${reason} 獲得香火 +${finalAmount}${buff.desc ? ` (${buff.desc})` : ''}`);
}

// ===== 每日重置 =====
function checkDailyReset() {
  const todayStr = today();

  if (world.lastReset !== todayStr) {
    world.lastReset = todayStr;
    order = {};
    cooldown = {};
    users.dailyPray = {};
    saveJSON(ORDER_FILE, order);
    saveJSON(COOLDOWN_FILE, cooldown);
    saveJSON(USERS_FILE, users);
    saveJSON(WORLD_FILE, world);
  }

  if (taskData.day !== todayStr) {
    taskData = { day: todayStr, task: randomTask() };
    saveJSON(TASK_FILE, taskData);
  }

  if (fixedTaskProgress.day !== todayStr) {
    fixedTaskProgress = { day: todayStr, users: {} };
    saveJSON(FIXED_TASK_FILE, fixedTaskProgress);
  }

  processedEvents.clear();
}

// ===== 隨機任務生成 =====
function randomTask() {
  const base = TASK_POOL[Math.floor(Math.random() * TASK_POOL.length)];
  const goal = Math.floor(Math.random() * (base.max - base.min + 1)) + base.min;
  return { type: base.type, desc: base.desc.replace('{goal}', goal), goal, reward: base.reward, progress: {} };
}

// ===== 區域升級 =====
function unlockNextRegion() {
  const id = `region_${Object.keys(world.regions).length + 1}`;
  world.regions[id] = { name: `未知區域 ${Object.keys(world.regions).length}`, level: 1, bless: 0, target: 200 + Object.keys(world.regions).length * 100, unlocked: true, buildings: [] };
  saveJSON(WORLD_FILE, world);
}

// ===== 上香 =====
function handlePray(msg) {
  const uid = msg.author.id;
  checkDailyReset();

  if (cooldown[uid]) return msg.reply('⏳ 今天已經上香過了');
  cooldown[uid] = Date.now();
  saveJSON(COOLDOWN_FILE, cooldown);

  users.dailyPray[uid] = (users.dailyPray[uid] || 0) + 1;
  users.totalPray[uid] = (users.totalPray[uid] || 0) + 1;
  saveJSON(USERS_FILE, users);

  const region = world.regions[world.currentRegion];
  region.bless += 1;
  if (region.bless >= region.target) {
    region.level += 1;
    region.bless = 0;
    unlockNextRegion();
    msg.channel.send(`🏯 ${region.name} 升級至 Lv.${region.level}！`);
  }
  saveJSON(WORLD_FILE, world);

  const pos = Object.keys(users.dailyPray).length;
  msg.reply(`🕯 上香完成！你是今日第 ${pos} 位，累積 ${users.totalPray[uid]} 次`);

  // 特殊隱藏任務：午夜
  HIDDEN_TASKS.forEach(task => {
    if (task.type === 'nightPray' && new Date().getHours() >= 22) {
      hiddenTaskProgress[uid] = hiddenTaskProgress[uid] || {};
      hiddenTaskProgress[uid][task.type] = (hiddenTaskProgress[uid][task.type] || 0) + 1;
      if (hiddenTaskProgress[uid][task.type] >= task.goal) {
        grantReward(msg, uid, task.reward, `隱藏任務完成：「${task.desc}」`);
        hiddenTaskProgress[uid][task.type] = 0;
      }
    }
  });
  saveJSON(HIDDEN_TASK_FILE, hiddenTaskProgress);
}

// ===== 任務處理 =====
function handleTasks(msg, context = 'message') {
  const uid = msg.author.id;
  const eventId = `${msg.id}_${context}`;
  checkDailyReset();
  if (processedEvents.has(eventId)) return;
  processedEvents.add(eventId);

  // 隨機任務
  if (taskData.task.type === context) {
    taskData.task.progress[uid] = (taskData.task.progress[uid] || 0) + 1;
    if (taskData.task.progress[uid] >= taskData.task.goal) grantReward(msg, uid, taskData.task.reward, '隨機任務完成');
    saveJSON(TASK_FILE, taskData);
  }

  // 固定任務
  fixedTaskProgress.users[uid] = fixedTaskProgress.users[uid] || {};
  FIXED_TASKS.forEach(task => {
    const u = fixedTaskProgress.users[uid];
    if (task.type === context) {
      u[task.type] = (u[task.type] || 0) + 1;
      if (u[task.type] >= task.required && !u[`${task.type}_claimed`]) {
        grantReward(msg, uid, task.reward, `固定任務完成：「${task.desc}」`);
        u[`${task.type}_claimed`] = true;
      }
    }
  });
  saveJSON(FIXED_TASK_FILE, fixedTaskProgress);

  // 隱藏訊息任務
  HIDDEN_TASKS.forEach(task => {
    if (task.type === 'secretMessage' && msg.content.includes('寶')) {
      hiddenTaskProgress[uid] = hiddenTaskProgress[uid] || {};
      hiddenTaskProgress[uid][task.type] = (hiddenTaskProgress[uid][task.type] || 0) + 1;
      if (hiddenTaskProgress[uid][task.type] >= task.goal) {
        grantReward(msg, uid, task.reward, `隱藏任務完成：「${task.desc}」`);
        hiddenTaskProgress[uid][task.type] = 0;
      }
    }
  });
  saveJSON(HIDDEN_TASK_FILE, hiddenTaskProgress);
}

// ===== 顯示任務/世界 =====
function showTodayTask(msg) { checkDailyReset(); if (!taskData.task) taskData = { day: today(), task: randomTask() }; msg.reply(`📜 今日任務：${taskData.task.desc}\n獎勵：香火 +${taskData.task.reward}`); }
function showTaskProgress(msg) { const uid = msg.author.id; const p = taskData.task.progress[uid] || 0; msg.reply(`📊 隨機任務進度\n${taskData.task.desc}\n進度：${p}/${taskData.task.goal}`); }
function showFixedTaskProgress(msg) { const uid = msg.author.id; const u = fixedTaskProgress.users[uid] || {}; let text = '📊 固定任務進度：\n'; FIXED_TASKS.forEach(task => { const prog = u[task.type] || 0; text += `${task.desc}：${prog}/${task.required}${u[`${task.type}_claimed`] ? ' ✅' : ''}\n`; }); msg.reply(text); }
function showWorld(msg) { const r = world.regions[world.currentRegion]; msg.reply(`🌏 世界（Era ${world.era}）\n區域：${r.name}\nLv.${r.level}\n香火：${r.bless}/${r.target}\n${progressBar(r.bless, r.target)}`); }
function showMap(msg) { let text = '🗺 世界地圖\n\n'; Object.values(world.regions).forEach(r => { text += `[${r.name}] Lv.${r.level}\n`; }); msg.reply(text); }
async function showRanking(msg, client, type = 'daily') {
  const data = type === 'daily' ? users.dailyPray : users.totalPray;
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 5);
  let text = `🏆 ${type === 'daily' ? '今日' : '總計'}上香排行榜 TOP 5\n\n`;
  for (let i = 0; i < sorted.length; i++) {
    try { const user = await client.users.fetch(sorted[i][0]); text += `${i+1}. ${user.username} — ${sorted[i][1]} 次\n`; }
    catch { text += `${i+1}. 無名氏 — ${sorted[i][1]} 次\n`; }
  }
  msg.reply(text);
}

module.exports = {
  checkDailyReset, handlePray, showRanking, showWorld, showMap,
  handleTasks, showTodayTask, showTaskProgress, showFixedTaskProgress, grantReward
};
/*
const fs = require('fs');
const path = require('path');
const { loadJSON, saveJSON, today, progressBar } = require('./utils');

const WORLD_FILE = './data/world.json';
const USERS_FILE = './data/users.json';
const COOLDOWN_FILE = './data/cooldown.json';
const ORDER_FILE = './data/order.json';
const TASK_FILE = './data/tasks.json';
const FIXED_TASK_FILE = './data/fixedTasksProgress.json';
const HIDDEN_TASK_FILE = './data/hiddenTasksProgress.json';

// ===== 初始資料 =====
let world = loadJSON(WORLD_FILE, {
  era: 1,
  currentRegion: 'central',
  lastReset: today(),
  regions: { central: { name: '中央城邦', level: 1, bless: 0, target: 100, unlocked: true, buildings: ['祈福壇'] } }
});

let users = loadJSON(USERS_FILE, { totalPray: {}, dailyPray: {} });
let cooldown = loadJSON(COOLDOWN_FILE, {});
let order = loadJSON(ORDER_FILE, {});
let taskData = loadJSON(TASK_FILE, { day: '', task: null });
let fixedTaskProgress = loadJSON(FIXED_TASK_FILE, { day: '', users: {} });
let hiddenTaskProgress = loadJSON(HIDDEN_TASK_FILE, {}); // 隱藏任務進度

// ===== 防重事件集 =====
let processedEvents = new Set();

// ===== 任務設定 =====
const TASK_POOL = [
  { type: 'message', desc: '今日發送 {goal} 則訊息', min: 3, max: 8, reward: 2 },
  { type: 'emoji', desc: '發送 {goal} 個表情符號', min: 5, max: 10, reward: 2 },
  { type: 'reply', desc: '回覆他人訊息 {goal} 次', min: 2, max: 5, reward: 3 },
  { type: 'attachment', desc: '上傳 {goal} 張圖片或貼圖', min: 1, max: 3, reward: 3 },
  { type: 'greet', desc: '打招呼 {goal} 次（早安/午安/晚安/安安）', min: 1, max: 2, reward: 2 }
];

const FIXED_TASKS = [{ type: 'pray', desc: '每日上香 1 次', required: 1, reward: 3 }];

const HIDDEN_TASKS = [
  { type: 'secretMessage', desc: '偷偷發送「寶」字訊息 3 次', goal: 3, reward: 5 },
  { type: 'nightPray', desc: '午夜上香一次', goal: 1, reward: 4 }
];

// ===== 特殊時間 Buff =====
function getCurrentBuff() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  if (hour >= 22 && hour < 23) return { multiplier: 2, desc: '午夜香火加倍' };
  if (day === 0 || day === 6) return { multiplier: 2, desc: '週末活動加倍' };
  return { multiplier: 1, desc: '' };
}

// ===== 統一獎勵 =====
function grantReward(msg, uid, amount, reason) {
  const buff = getCurrentBuff();
  const finalAmount = amount * buff.multiplier;
  users.totalPray[uid] = (users.totalPray[uid] || 0) + finalAmount;
  saveJSON(USERS_FILE, users);
  msg.reply(`🎁 ${reason} 獲得香火 +${finalAmount}${buff.desc ? ` (${buff.desc})` : ''}`);
}

// ===== 每日重置 =====
function checkDailyReset() {
  const todayStr = today();

  if (world.lastReset !== todayStr) {
    world.lastReset = todayStr;
    order = {};
    cooldown = {};
    users.dailyPray = {};
    saveJSON(ORDER_FILE, order);
    saveJSON(COOLDOWN_FILE, cooldown);
    saveJSON(USERS_FILE, users);
    saveJSON(WORLD_FILE, world);
  }

  if (taskData.day !== todayStr) {
    taskData = { day: todayStr, task: randomTask() };
    saveJSON(TASK_FILE, taskData);
  }

  if (fixedTaskProgress.day !== todayStr) {
    fixedTaskProgress = { day: todayStr, users: {} };
    saveJSON(FIXED_TASK_FILE, fixedTaskProgress);
  }

  processedEvents.clear();
}

// ===== 隨機任務生成 =====
function randomTask() {
  const base = TASK_POOL[Math.floor(Math.random() * TASK_POOL.length)];
  const goal = Math.floor(Math.random() * (base.max - base.min + 1)) + base.min;
  return { type: base.type, desc: base.desc.replace('{goal}', goal), goal, reward: base.reward, progress: {} };
}

// ===== 區域升級 =====
function unlockNextRegion() {
  const id = `region_${Object.keys(world.regions).length + 1}`;
  world.regions[id] = { name: `未知區域 ${Object.keys(world.regions).length}`, level: 1, bless: 0, target: 200 + Object.keys(world.regions).length * 100, unlocked: true, buildings: [] };
  saveJSON(WORLD_FILE, world);
}

// ===== 上香 =====
function handlePray(msg) {
  const uid = msg.author.id;
  checkDailyReset();

  if (cooldown[uid]) return msg.reply('⏳ 今天已經上香過了');
  cooldown[uid] = Date.now();
  saveJSON(COOLDOWN_FILE, cooldown);

  users.dailyPray[uid] = (users.dailyPray[uid] || 0) + 1;
  users.totalPray[uid] = (users.totalPray[uid] || 0) + 1;
  saveJSON(USERS_FILE, users);

  const region = world.regions[world.currentRegion];
  region.bless += 1;
  if (region.bless >= region.target) {
    region.level += 1;
    region.bless = 0;
    unlockNextRegion();
    msg.channel.send(`🏯 ${region.name} 升級至 Lv.${region.level}！`);
  }
  saveJSON(WORLD_FILE, world);

  const pos = Object.keys(users.dailyPray).length;
  msg.reply(`🕯 上香完成！你是今日第 ${pos} 位，累積 ${users.totalPray[uid]} 次`);

  // 特殊隱藏任務：午夜
  HIDDEN_TASKS.forEach(task => {
    if (task.type === 'nightPray' && new Date().getHours() >= 22) {
      hiddenTaskProgress[uid] = hiddenTaskProgress[uid] || {};
      hiddenTaskProgress[uid][task.type] = (hiddenTaskProgress[uid][task.type] || 0) + 1;
      if (hiddenTaskProgress[uid][task.type] >= task.goal) {
        grantReward(msg, uid, task.reward, `隱藏任務完成：「${task.desc}」`);
        hiddenTaskProgress[uid][task.type] = 0;
      }
    }
  });
  saveJSON(HIDDEN_TASK_FILE, hiddenTaskProgress);
}

// ===== 任務處理 =====
function handleTasks(msg, context = 'message') {
  const uid = msg.author.id;
  const eventId = `${msg.id}_${context}`;
  checkDailyReset();
  if (processedEvents.has(eventId)) return;
  processedEvents.add(eventId);

  // 隨機任務
  if (taskData.task.type === context) {
    taskData.task.progress[uid] = (taskData.task.progress[uid] || 0) + 1;
    if (taskData.task.progress[uid] >= taskData.task.goal) grantReward(msg, uid, taskData.task.reward, '隨機任務完成');
    saveJSON(TASK_FILE, taskData);
  }

  // 固定任務
  fixedTaskProgress.users[uid] = fixedTaskProgress.users[uid] || {};
  FIXED_TASKS.forEach(task => {
    const u = fixedTaskProgress.users[uid];
    if (task.type === context) {
      u[task.type] = (u[task.type] || 0) + 1;
      if (u[task.type] >= task.required && !u[`${task.type}_claimed`]) {
        grantReward(msg, uid, task.reward, `固定任務完成：「${task.desc}」`);
        u[`${task.type}_claimed`] = true;
      }
    }
  });
  saveJSON(FIXED_TASK_FILE, fixedTaskProgress);

  // 隱藏訊息任務
  HIDDEN_TASKS.forEach(task => {
    if (task.type === 'secretMessage' && msg.content.includes('寶')) {
      hiddenTaskProgress[uid] = hiddenTaskProgress[uid] || {};
      hiddenTaskProgress[uid][task.type] = (hiddenTaskProgress[uid][task.type] || 0) + 1;
      if (hiddenTaskProgress[uid][task.type] >= task.goal) {
        grantReward(msg, uid, task.reward, `隱藏任務完成：「${task.desc}」`);
        hiddenTaskProgress[uid][task.type] = 0;
      }
    }
  });
  saveJSON(HIDDEN_TASK_FILE, hiddenTaskProgress);
}

// ===== 顯示任務/世界 =====
function showTodayTask(msg) { checkDailyReset(); if (!taskData.task) taskData = { day: today(), task: randomTask() }; msg.reply(`📜 今日任務：${taskData.task.desc}\n獎勵：香火 +${taskData.task.reward}`); }
function showTaskProgress(msg) { const uid = msg.author.id; const p = taskData.task.progress[uid] || 0; msg.reply(`📊 隨機任務進度\n${taskData.task.desc}\n進度：${p}/${taskData.task.goal}`); }
function showFixedTaskProgress(msg) { const uid = msg.author.id; const u = fixedTaskProgress.users[uid] || {}; let text = '📊 固定任務進度：\n'; FIXED_TASKS.forEach(task => { const prog = u[task.type] || 0; text += `${task.desc}：${prog}/${task.required}${u[`${task.type}_claimed`] ? ' ✅' : ''}\n`; }); msg.reply(text); }
function showWorld(msg) { const r = world.regions[world.currentRegion]; msg.reply(`🌏 世界（Era ${world.era}）\n區域：${r.name}\nLv.${r.level}\n香火：${r.bless}/${r.target}\n${progressBar(r.bless, r.target)}`); }
function showMap(msg) { let text = '🗺 世界地圖\n\n'; Object.values(world.regions).forEach(r => { text += `[${r.name}] Lv.${r.level}\n`; }); msg.reply(text); }
async function showRanking(msg, client, type = 'daily') {
  const data = type === 'daily' ? users.dailyPray : users.totalPray;
  const sorted = Object.entries(data).sort((a, b) => b[1] - a[1]).slice(0, 5);
  let text = `🏆 ${type === 'daily' ? '今日' : '總計'}上香排行榜 TOP 5\n\n`;
  for (let i = 0; i < sorted.length; i++) {
    try { const user = await client.users.fetch(sorted[i][0]); text += `${i+1}. ${user.username} — ${sorted[i][1]} 次\n`; }
    catch { text += `${i+1}. 無名氏 — ${sorted[i][1]} 次\n`; }
  }
  msg.reply(text);
}

module.exports = {
  checkDailyReset, handlePray, showRanking, showWorld, showMap,
  handleTasks, showTodayTask, showTaskProgress, showFixedTaskProgress, grantReward
};
*/