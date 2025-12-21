// systems/gameSystem.js - 最終完整優化版（已加入探索系統 + 恢復所有原有函數）
const fs = require('fs');
const path = require('path');
const { loadJSON, saveJSON, today, progressBar } = require('./utils');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WORLD_FILE = path.join(DATA_DIR, 'world.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const COOLDOWN_FILE = path.join(DATA_DIR, 'cooldown.json');
const ORDER_FILE = path.join(DATA_DIR, 'order.json');
const TASK_FILE = path.join(DATA_DIR, 'tasks.json');
const FIXED_TASK_FILE = path.join(DATA_DIR, 'fixedTasksProgress.json');
const HIDDEN_TASK_FILE = path.join(DATA_DIR, 'hiddenTasksProgress.json');
const STAMINA_FILE = path.join(DATA_DIR, 'stamina.json');  // 體力檔案

let world = loadJSON(WORLD_FILE, null);
let users = loadJSON(USERS_FILE, { totalContrib: {}, dailyContrib: {} });
let cooldown = loadJSON(COOLDOWN_FILE, {});
let order = loadJSON(ORDER_FILE, {});
let taskData = loadJSON(TASK_FILE, { day: '', task: null });
let fixedTaskProgress = loadJSON(FIXED_TASK_FILE, { day: '', users: {} });
let hiddenTaskProgress = loadJSON(HIDDEN_TASK_FILE, {});
let stamina = loadJSON(STAMINA_FILE, {});

let processedEvents = new Set();

// ===== 地區專屬標誌建築（永恆存在）=====
const LANDMARK_BUILDINGS = {
  central: '祈福壇',
  region_2: '古樹守護壇',
  region_3: '沙暴堡壘',
  region_4: '永凍神殿',
  region_5: '海神燈塔'
};

// ===== 主城專屬buff建築（蓋幫總基地獨享）=====
const MAIN_CITY_BUFF_BUILDINGS = [
  { name: '香火塔', unlockLevel: 2, desc: '全幫幫貢收益永久 +20%' },
  { name: '靈氣泉', unlockLevel: 3, desc: '隨機任務獎勵永久 +25%' },
  { name: '福緣殿', unlockLevel: 4, desc: '隱藏任務觸發率 +30%' },
  { name: '神恩亭', unlockLevel: 5, desc: '全幫幫貢收益再 +30%' }
];

// ===== 分基地通用探索建築（主城絕不解鎖）=====
const EXPLORATION_BUILDINGS = [
  { name: '前哨據點', unlockLevel: 2, desc: '野外事件 +20%' },
  { name: '守望塔', unlockLevel: 3, desc: '怪物掉落 +30%' },
  { name: '遺跡挖掘站', unlockLevel: 4, desc: '隱藏遺跡更容易遇到稀有文物' },
  { name: '情報中心', unlockLevel: 5, desc: '稀有掉落 +50%' }
];

// ===== 任務設定 =====
const TASK_POOL = [
  { type: 'message', desc: '今日發送 {goal} 則訊息', min: 3, max: 8, reward: 2 },
  { type: 'emoji', desc: '發送 {goal} 個表情符號', min: 5, max: 10, reward: 2 },
  { type: 'reply', desc: '回覆他人訊息 {goal} 次', min: 2, max: 5, reward: 3 },
  { type: 'attachment', desc: '上傳 {goal} 張圖片或貼圖', min: 1, max: 3, reward: 3 },
  { type: 'greet', desc: '打招呼 {goal} 次（早安/午安/晚安/安安）', min: 1, max: 2, reward: 2 }
];

const FIXED_TASKS = [{ type: 'pray', desc: '每日簽到', required: 1, reward: 4 }];

// ===== 特殊時間 Buff =====
function getCurrentBuff() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  let multiplier = 1;
  let desc = '';

  if (hour === 22) {
    multiplier = 2;
    desc = '午夜幫貢加倍';
  }
  if (day === 0 || day === 6) {
    multiplier *= 2;
    desc = desc ? `${desc} + 週末加倍` : '週末幫貢加倍';
  }
  return { multiplier, desc: desc || '' };
}

// ===== 每日重置（含體力恢復）=====
function checkDailyReset() {
  const todayStr = today();
  let changed = false;

  if (world.lastReset !== todayStr) {
    world.lastReset = todayStr;
    users.dailyContrib = {};
    cooldown = {};
    order = {};
    processedEvents.clear();
    // 體力每日恢復
    Object.keys(stamina).forEach(uid => {
      stamina[uid].current = stamina[uid].max;
      stamina[uid].lastReset = todayStr;
    });
    saveJSON(STAMINA_FILE, stamina);
    changed = true;
  }

  if (taskData.day !== todayStr) {
    taskData = { day: todayStr, task: randomTask() };
    saveJSON(TASK_FILE, taskData);
  }

  if (fixedTaskProgress.day !== todayStr) {
    fixedTaskProgress = { day: todayStr, users: {} };
    saveJSON(FIXED_TASK_FILE, fixedTaskProgress);
  }

  if (changed) {
    saveJSON(WORLD_FILE, world);
    saveJSON(USERS_FILE, users);
    saveJSON(COOLDOWN_FILE, cooldown);
    saveJSON(ORDER_FILE, order);
  }
}

// ===== 隨機任務 =====
function randomTask() {
  const base = TASK_POOL[Math.floor(Math.random() * TASK_POOL.length)];
  const goal = Math.floor(Math.random() * (base.max - base.min + 1)) + base.min;
  return {
    type: base.type,
    desc: base.desc.replace('{goal}', goal),
    goal,
    reward: base.reward,
    progress: {}
  };
}

// ===== 解鎖新區域 =====
function unlockNextRegion() {
  const nextId = `region_${Object.keys(world.regions).length + 1}`;
  const names = ['東境荒原', '西方大漠', '北方冰原', '南方群島', '天空之城', '幽冥深淵'];
  const name = names[Object.keys(world.regions).length - 1] || `神秘區域 ${Object.keys(world.regions).length}`;
  const landmark = LANDMARK_BUILDINGS[nextId] || '未知地標';

  world.regions[nextId] = {
    name,
    level: 1,
    bless: 0,
    target: 100,
    unlocked: true,
    buildings: [landmark]
  };
  saveJSON(WORLD_FILE, world);
}

// ===== 獎勵發放 =====
function grantReward(msg, uid, amount, reason) {
  const buff = getCurrentBuff();
  const finalAmount = amount * buff.multiplier;

  users.totalContrib[uid] = (users.totalContrib[uid] || 0) + finalAmount;

  const region = world.regions[world.currentRegion];
  const previousBless = region.bless;
  region.bless += finalAmount;

  let upgradeMsg = '';
  if (region.bless >= region.target) {
    const overflow = region.bless - region.target;
    region.level += 1;
    region.bless = overflow;
    region.target += 200;

    upgradeMsg = `\n${region.name} 升級至 Lv.${region.level}！`;

    const isMain = world.currentRegion === 'central';

    if (isMain) {
      const newBuildingObj = MAIN_CITY_BUFF_BUILDINGS.find(b => b.unlockLevel === region.level);
      if (newBuildingObj && !region.buildings.includes(newBuildingObj.name)) {
        region.buildings.push(newBuildingObj.name);
        upgradeMsg += `\n新建築解鎖：${newBuildingObj.name}（${newBuildingObj.desc}）`;
      }

      if (region.level === 5 && Object.keys(world.regions).length === 1) {
        for (let i = 0; i < 4; i++) unlockNextRegion();
        upgradeMsg += `\n東境荒原等四個分基地正式開放！`;
      }
    } else {
      const newBuildingObj = EXPLORATION_BUILDINGS.find(b => b.unlockLevel === region.level);
      if (newBuildingObj && !region.buildings.includes(newBuildingObj.name)) {
        region.buildings.push(newBuildingObj.name);
        upgradeMsg += `\n新建築解鎖：${newBuildingObj.name}（${newBuildingObj.desc}）`;
      }
    }

    // Era升級檢查
    const outpostsPerEra = 4;
    const currentEraOutposts = Object.keys(world.regions)
      .filter(k => k !== 'central')
      .slice(0, outpostsPerEra * world.era);

    const allConquered = currentEraOutposts.length === outpostsPerEra * world.era &&
      currentEraOutposts.every(k => world.regions[k].level >= 5);

    if (allConquered) {
      world.era += 1;
      saveJSON(WORLD_FILE, world);
      upgradeMsg += `\n蓋幫進入 Era ${world.era}！新一批分基地開放。`;
      for (let i = 0; i < outpostsPerEra; i++) unlockNextRegion();
    }

    msg.channel.send(upgradeMsg);
  }

  saveJSON(USERS_FILE, users);
  saveJSON(WORLD_FILE, world);

  if (msg && finalAmount > 0) {
    msg.reply(
      `${reason} 獲得幫貢 +${finalAmount} ${buff.desc}\n` +
      `進度 +${finalAmount}（${previousBless} → ${region.bless}/${region.target}）${upgradeMsg}`
    );
  }
}

// ===== 個人體力系統 =====
function getStamina(uid) {
  stamina[uid] = stamina[uid] || { current: 10, max: 10, lastReset: today() };
  const s = stamina[uid];
  if (s.lastReset !== today()) {
    s.current = s.max;
    s.lastReset = today();
    saveJSON(STAMINA_FILE, stamina);
  }
  return s;
}

// ===== NPC對話事件池 =====
const NPC_EVENTS = [
  {
    desc: '你遇到一位神秘旅人，他微笑著說：\n「看你一身風塵，我有些東西，或許能幫到你。」',
    options: [
      { text: '接受他的幫助', result: 'good', reward: 20, message: '旅人給了你珍貴補給' },
      { text: '禮貌拒絕', result: 'neutral', reward: 0, message: '旅人點頭離開' },
      { text: '試著談條件', result: 'good', reward: 30, message: '談判成功，獲得更多情報' },
      { text: '保持警惕離開', result: 'bad', penalty: 10, message: '錯過了潛在盟友' }
    ]
  },
  {
    desc: '一位老翁坐在路邊：\n「年輕人，可願聽老夫說一段往事？」',
    options: [
      { text: '耐心傾聽', result: 'good', reward: 25, message: '老翁贈你古幣與秘密' },
      { text: '說有急事離開', result: 'neutral', reward: 0, message: '老翁嘆氣，你繼續前行' },
      { text: '問有沒有獎勵', result: 'bad', penalty: 15, message: '老翁失望搖頭' }
    ]
  }
];

// ===== 探索指令 =====
async function handleExplore(msg) {
  const uid = msg.author.id;
  if (world.currentRegion === 'central') {
    return msg.reply('主城純潔聖地，沒有探索事件');
  }

  const userStamina = getStamina(uid);
  if (userStamina.current <= 0) {
    return msg.reply('體力不足，請明天再來探索');
  }

  userStamina.current -= 1;
  saveJSON(STAMINA_FILE, stamina);

  const region = world.regions[world.currentRegion];
  const buildingCount = region.buildings.length - 1;

  // NPC事件觸發率（建築加成）
  const npcChance = 0.3 + buildingCount * 0.1;
  if (Math.random() < npcChance) {
    const event = NPC_EVENTS[Math.floor(Math.random() * NPC_EVENTS.length)];

    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    const rows = [];
    let row = new ActionRowBuilder();

    event.options.forEach((opt, i) => {
      if (row.components.length === 5) {
        rows.push(row);
        row = new ActionRowBuilder();
      }
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`explore_${uid}_${i}`)
          .setLabel(opt.text)
          .setStyle(ButtonStyle.Primary)
      );
    });
    if (row.components.length > 0) rows.push(row);

    // 儲存臨時事件
    if (!world.tempExplore) world.tempExplore = {};
    world.tempExplore[uid] = { event, timestamp: Date.now() };
    saveJSON(WORLD_FILE, world);

    return msg.reply({
      content: `${event.desc}\n請選擇你的行動：`,
      components: rows
    });
  }

  // 一般事件
  const reward = 5 + buildingCount * 3;
  users.totalContrib[uid] += reward;
  saveJSON(USERS_FILE, users);
  msg.reply(`探索成功！發現資源，獲得 ${reward} 幫貢\n體力剩餘：${userStamina.current}/${userStamina.max}`);
}

// 每日簽到
async function handlePray(msg) {
  const uid = msg.author.id;
  checkDailyReset();

  if (cooldown[uid]) return msg.reply('你今天已經簽到過了');

  cooldown[uid] = true;
  saveJSON(COOLDOWN_FILE, cooldown);

  users.dailyContrib[uid] = (users.dailyContrib[uid] || 0) + 1;
  users.totalContrib[uid] = (users.totalContrib[uid] || 0) + 1;
  saveJSON(USERS_FILE, users);

  const rank = Object.keys(users.dailyContrib).length;
  const buff = getCurrentBuff();

  msg.reply(
    `每日簽到完成！你是今日第 ${rank} 位\n` +
    `累積幫貢：${users.totalContrib[uid]} 次${buff.desc ? `\n${buff.desc} 加成` : ''}`
  );

  handleTasks(msg, 'pray');
}

// 任務處理
function handleTasks(msg, context = 'message') {
  const uid = msg.author.id;
  const eventId = `${today()}_${uid}_${context}_${msg.id}`;
  if (processedEvents.has(eventId)) return;
  processedEvents.add(eventId);

  if (taskData.task && taskData.task.type === context) {
    taskData.task.progress[uid] = (taskData.task.progress[uid] || 0) + 1;
    if (taskData.task.progress[uid] === taskData.task.goal) {
      grantReward(msg, uid, taskData.task.reward, `隨機任務「${taskData.task.desc}」完成`);
    }
    saveJSON(TASK_FILE, taskData);
  }

  fixedTaskProgress.users[uid] = fixedTaskProgress.users[uid] || {};
  const uFixed = fixedTaskProgress.users[uid];
  FIXED_TASKS.forEach(task => {
    if (context === task.type && !uFixed[`${task.type}_claimed`]) {
      uFixed[task.type] = (uFixed[task.type] || 0) + 1;
      if (uFixed[task.type] >= task.required) {
        grantReward(msg, uid, task.reward, `固定任務「${task.desc}」完成`);
        uFixed[`${task.type}_claimed`] = true;
      }
    }
  });
  saveJSON(FIXED_TASK_FILE, fixedTaskProgress);

  hiddenTaskProgress.users[uid] = hiddenTaskProgress.users[uid] || {};
  const uHidden = hiddenTaskProgress.users[uid];
  if (context === 'message' && msg.content.includes('我是蓋')) {
    uHidden.secretMessage = (uHidden.secretMessage || 0) + 1;
    if (uHidden.secretMessage >= 3) {
      grantReward(msg, uid, 5, '隱藏任務「偷偷說我是蓋」完成');
      uHidden.secretMessage = 0;
    }
  }
  if (context === 'pray' && new Date().getHours() === 22) {
    uHidden.nightPray = (uHidden.nightPray || 0) + 1;
    if (uHidden.nightPray >= 1) {
      grantReward(msg, uid, 4, '隱藏任務「午夜簽到」完成');
      uHidden.nightPray = 0;
    }
  }
  saveJSON(HIDDEN_TASK_FILE, hiddenTaskProgress);
}

// 顯示函數
function showTodayTask(msg) {
  checkDailyReset();
  msg.reply(`今日隨機任務\n${taskData.task.desc}\n獎勵：幫貢 +${taskData.task.reward}`);
}

function showTaskProgress(msg) {
  const uid = msg.author.id;
  const p = taskData.task?.progress[uid] || 0;
  const goal = taskData.task?.goal || 0;
  msg.reply(`隨機任務進度\n${taskData.task.desc}\n${progressBar(p, goal)} ${p}/${goal}`);
}

function showFixedTaskProgress(msg) {
  const uid = msg.author.id;
  const u = fixedTaskProgress.users[uid] || {};
  let text = '固定任務進度\n';
  FIXED_TASKS.forEach(task => {
    const prog = u[task.type] || 0;
    const claimed = u[`${task.type}_claimed`] ? ' 已領取' : '';
    text += `${task.desc}：${prog}/${task.required}${claimed}\n`;
  });
  msg.reply(text);
}

function showWorld(msg) {
  const r = world.regions[world.currentRegion];
  const isMain = world.currentRegion === 'central';
  let buildingsText = `\n靈魂建築：${r.buildings[0]}`;
  if (!isMain) {
    buildingsText += `\n已解鎖探索建築：${r.buildings.slice(1).join('、') || '無'} (${r.buildings.length - 1}/4)`;
  } else {
    buildingsText += `\n（主城純潔聖地，不設探索建築）`;
  }

  msg.reply(
    `當前據點：${r.name} Lv.${r.level}\n` +
    `幫貢進度：${r.bless}/${r.target}\n` +
    `${progressBar(r.bless, r.target)}${buildingsText}`
  );
}

function showMap(msg) {
  let text = '蓋幫勢力地圖\n\n';
  Object.values(world.regions).forEach(r => {
    text += `${r.name} Lv.${r.level}\n`;
  });
  msg.reply(text);
}

async function showRanking(msg, client, type = 'daily') {
  const data = type === 'daily' ? users.dailyContrib : users.totalContrib;
  const sorted = Object.entries(data).sort(([,a], [,b]) => b - a).slice(0, 10);
  let text = `${type === 'daily' ? '今日' : '歷史總'}幫貢排行榜\n\n`;
  for (let i = 0; i < sorted.length; i++) {
    try {
      const user = await client.users.fetch(sorted[i][0]);
      text += `${i+1}. ${user.username} — ${sorted[i][1]} 次\n`;
    } catch {
      text += `${i+1}. 離開的幫眾 — ${sorted[i][1]} 次\n`;
    }
  }
  msg.reply(text);
}

function getWorld() {
  return world;
}

// 初始化與遷移（含一次性修復與體力初始化）
function init() {
  if (!world || !world.regions || Object.keys(world.regions).length === 0) {
    world = {
      era: 1,
      lastReset: today(),
      currentRegion: 'central',
      regions: {
        central: { name: '蓋幫總基地', level: 1, bless: 0, target: 100, unlocked: true, buildings: ['祈福壇'] }
      }
    };
    saveJSON(WORLD_FILE, world);
  }

  // 舊資料遷移與修復
  Object.keys(world.regions).forEach(key => {
    const r = world.regions[key];
    if (!r.buildings || r.buildings.length === 0) {
      r.buildings = [LANDMARK_BUILDINGS[key] || '祈福壇'];
    }
    if (key === 'central') {
      r.name = '蓋幫總基地';
      r.buildings = ['祈福壇'];
    }
  });

  // 一次性修復：補上該有的建築
  Object.values(world.regions).forEach(r => {
    const isMain = r.name === '蓋幫總基地';
    const list = isMain ? MAIN_CITY_BUFF_BUILDINGS : EXPLORATION_BUILDINGS;
    list.forEach(b => {
      if (b.unlockLevel <= r.level && !r.buildings.includes(b.name)) {
        r.buildings.push(b.name);
      }
    });
  });

  // 幫貢欄位遷移
  if (users.totalPray) {
    users.totalContrib = users.totalPray;
    delete users.totalPray;
  }
  if (users.dailyPray) {
    users.dailyContrib = users.dailyPray;
    delete users.dailyPray;
  }

  // 舊玩家體力初始化
  Object.keys(users.totalContrib).forEach(uid => {
    getStamina(uid);
  });
  saveJSON(STAMINA_FILE, stamina);

  saveJSON(WORLD_FILE, world);
  saveJSON(USERS_FILE, users);
}
init();

module.exports = {
  handlePray,
  handleTasks,
  showTodayTask,
  showTaskProgress,
  showFixedTaskProgress,
  showWorld,
  showMap,
  showRanking,
  grantReward,
  checkDailyReset,
  getWorld,
  progressBar,
  handleExplore,
  getStamina
};
/*// systems/gameSystem.js
const fs = require('fs');
const path = require('path');
const { loadJSON, saveJSON, today, progressBar } = require('./utils');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WORLD_FILE = path.join(DATA_DIR, 'world.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const COOLDOWN_FILE = path.join(DATA_DIR, 'cooldown.json');
const ORDER_FILE = path.join(DATA_DIR, 'order.json');
const TASK_FILE = path.join(DATA_DIR, 'tasks.json');
const FIXED_TASK_FILE = path.join(DATA_DIR, 'fixedTasksProgress.json');
const HIDDEN_TASK_FILE = path.join(DATA_DIR, 'hiddenTasksProgress.json');

let world = loadJSON(WORLD_FILE, null);
let users = loadJSON(USERS_FILE, { totalContrib: {}, dailyContrib: {} });
let cooldown = loadJSON(COOLDOWN_FILE, {});
let order = loadJSON(ORDER_FILE, {});
let taskData = loadJSON(TASK_FILE, { day: '', task: null });
let fixedTaskProgress = loadJSON(FIXED_TASK_FILE, { day: '', users: {} });
let hiddenTaskProgress = loadJSON(HIDDEN_TASK_FILE, {});

let processedEvents = new Set();

// ===== 地區專屬標誌建築（永恆存在）=====
const LANDMARK_BUILDINGS = {
  central: '祈福壇',
  region_2: '古樹守護壇',
  region_3: '沙暴堡壘',
  region_4: '永凍神殿',
  region_5: '海神燈塔'
};

// ===== 主城專屬buff建築（蓋幫總基地獨享，神聖純潔版）=====
const MAIN_CITY_BUFF_BUILDINGS = [
  { name: '香火塔', unlockLevel: 2, desc: '全幫幫貢收益永久 +20%' },
  { name: '靈氣泉', unlockLevel: 3, desc: '隨機任務獎勵永久 +25%' },
  { name: '福緣殿', unlockLevel: 4, desc: '收益 +30%' },
  { name: '神恩亭', unlockLevel: 5, desc: '全幫幫貢收益再 +30%' }
];

// ===== 分基地通用探索建築（主城絕不解鎖）=====
const EXPLORATION_BUILDINGS = [
  { name: '前哨據點', unlockLevel: 2, desc: '野外事件 +20%' },
  { name: '守望塔', unlockLevel: 3, desc: '怪物掉落 +30%' },
  { name: '遺跡挖掘站', unlockLevel: 4, desc: '隱藏遺跡更容易遇到稀有文物' },
  { name: '情報中心', unlockLevel: 5, desc: '稀有掉落 +50%' }
];

// ===== 任務設定 =====
const TASK_POOL = [
  { type: 'message', desc: '今日發送 {goal} 則訊息', min: 3, max: 8, reward: 2 },
  { type: 'emoji', desc: '發送 {goal} 個表情符號', min: 5, max: 10, reward: 2 },
  { type: 'reply', desc: '回覆他人訊息 {goal} 次', min: 2, max: 5, reward: 3 },
  { type: 'attachment', desc: '上傳 {goal} 張圖片或貼圖', min: 1, max: 3, reward: 3 },
  { type: 'greet', desc: '打招呼 {goal} 次（早安/午安/晚安/安安）', min: 1, max: 2, reward: 2 }
];

const FIXED_TASKS = [{ type: 'pray', desc: '每日簽到', required: 1, reward: 4 }];

// ===== 特殊時間 Buff =====
function getCurrentBuff() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  let multiplier = 1;
  let desc = '';

  if (hour === 22) {
    multiplier = 2;
    desc = '🌙 午夜幫貢加倍';
  }
  if (day === 0 || day === 6) {
    multiplier *= 2;
    desc = desc ? `${desc} + 🎉 週末加倍` : '🎉 週末幫貢加倍';
  }
  return { multiplier, desc: desc || '' };
}

// ===== 每日重置 =====
function checkDailyReset() {
  const todayStr = today();
  let changed = false;

  if (world.lastReset !== todayStr) {
    world.lastReset = todayStr;
    users.dailyContrib = {};
    cooldown = {};
    order = {};
    processedEvents.clear();
    changed = true;
  }

  if (taskData.day !== todayStr) {
    taskData = { day: todayStr, task: randomTask() };
    saveJSON(TASK_FILE, taskData);
  }

  if (fixedTaskProgress.day !== todayStr) {
    fixedTaskProgress = { day: todayStr, users: {} };
    saveJSON(FIXED_TASK_FILE, fixedTaskProgress);
  }

  if (changed) {
    saveJSON(WORLD_FILE, world);
    saveJSON(USERS_FILE, users);
    saveJSON(COOLDOWN_FILE, cooldown);
    saveJSON(ORDER_FILE, order);
  }
}

// ===== 隨機任務 =====
function randomTask() {
  const base = TASK_POOL[Math.floor(Math.random() * TASK_POOL.length)];
  const goal = Math.floor(Math.random() * (base.max - base.min + 1)) + base.min;
  return {
    type: base.type,
    desc: base.desc.replace('{goal}', goal),
    goal,
    reward: base.reward,
    progress: {}
  };
}

// ===== 解鎖新區域 =====
function unlockNextRegion() {
  const nextId = `region_${Object.keys(world.regions).length + 1}`;
  const names = ['東境荒原', '西方大漠', '北方冰原', '南方群島', '天空之城', '幽冥深淵'];
  const name = names[Object.keys(world.regions).length - 1] || `神秘區域 ${Object.keys(world.regions).length}`;
  const landmark = LANDMARK_BUILDINGS[nextId] || '未知地標';

  world.regions[nextId] = {
    name,
    level: 1,
    bless: 0,
    target: 100,
    unlocked: true,
    buildings: [landmark]
  };
  saveJSON(WORLD_FILE, world);
}

// ===== 獎勵發放 =====
function grantReward(msg, uid, amount, reason) {
  const buff = getCurrentBuff();
  const finalAmount = amount * buff.multiplier;

  users.totalContrib[uid] = (users.totalContrib[uid] || 0) + finalAmount;

  const region = world.regions[world.currentRegion];
  const previousBless = region.bless;
  region.bless += finalAmount;

  let upgradeMsg = '';
  if (region.bless >= region.target) {
    const overflow = region.bless - region.target;
    region.level += 1;
    region.bless = overflow;
    region.target += 200;

    upgradeMsg = `\n${region.name} 升級至 Lv.${region.level}！`;

    const isMain = world.currentRegion === 'central';

    if (isMain) {
      const newBuildingObj = MAIN_CITY_BUFF_BUILDINGS.find(b => b.unlockLevel === region.level);
      if (newBuildingObj && !region.buildings.includes(newBuildingObj.name)) {
        region.buildings.push(newBuildingObj.name);
        upgradeMsg += `\n新建築解鎖：${newBuildingObj.name}（${newBuildingObj.desc}）`;
      }
      // 主城滿Lv.5解鎖第一批分基地
      if (region.level === 5 && Object.keys(world.regions).length === 1) {
        for (let i = 0; i < 4; i++) unlockNextRegion();
        upgradeMsg += `\n東境荒原等四個分基地正式開放！`;
      }
    } else {
      const newBuildingObj = EXPLORATION_BUILDINGS.find(b => b.unlockLevel === region.level);
      if (newBuildingObj && !region.buildings.includes(newBuildingObj.name)) {
        region.buildings.push(newBuildingObj.name);
        upgradeMsg += `\n新建築解鎖：${newBuildingObj.name}（${newBuildingObj.desc}）`;
      }
    }

    msg.channel.send(upgradeMsg);

    // Era升級檢查（獨立於主城）
    const outpostsPerEra = 4;
    const currentEraOutposts = Object.keys(world.regions).filter(k => k !== 'central').slice(0, outpostsPerEra * world.era);
    const allConquered = currentEraOutposts.every(k => world.regions[k].level >= 5);
    if (allConquered) {
      world.era += 1;
      upgradeMsg += `\n蓋幫進入 Era ${world.era}！新一批分基地開放。`;
      for (let i = 0; i < outpostsPerEra; i++) unlockNextRegion();
      msg.channel.send(upgradeMsg);
    }
  }

  saveJSON(USERS_FILE, users);
  saveJSON(WORLD_FILE, world);

  if (msg && finalAmount > 0) {
    msg.reply(
      `${reason} 獲得幫貢 +${finalAmount} ${buff.desc}\n` +
      `進度 +${finalAmount}（${previousBless} → ${region.bless}/${region.target}）${upgradeMsg}`
    );
  }
}

// 每日簽到
async function handlePray(msg) {
  const uid = msg.author.id;
  checkDailyReset();

  if (cooldown[uid]) return msg.reply('⏳ 你今天已經簽到過了');

  cooldown[uid] = true;
  saveJSON(COOLDOWN_FILE, cooldown);

  users.dailyContrib[uid] = (users.dailyContrib[uid] || 0) + 1;
  users.totalContrib[uid] = (users.totalContrib[uid] || 0) + 1;
  saveJSON(USERS_FILE, users);

  const rank = Object.keys(users.dailyContrib).length;
  const buff = getCurrentBuff();

  msg.reply(
    `每日簽到完成！你是今日第 ${rank} 位\n` +
    `累積幫貢：${users.totalContrib[uid]} 次${buff.desc ? `\n ${buff.desc} 加成` : ''}`
  );

  handleTasks(msg, 'pray');
}

// 任務處理
function handleTasks(msg, context = 'message') {
  const uid = msg.author.id;
  const eventId = `${today()}_${uid}_${context}_${msg.id}`;
  if (processedEvents.has(eventId)) return;
  processedEvents.add(eventId);

  if (taskData.task && taskData.task.type === context) {
    taskData.task.progress[uid] = (taskData.task.progress[uid] || 0) + 1;
    if (taskData.task.progress[uid] === taskData.task.goal) {
      grantReward(msg, uid, taskData.task.reward, `隨機任務「${taskData.task.desc}」完成`);
    }
    saveJSON(TASK_FILE, taskData);
  }

  fixedTaskProgress.users[uid] = fixedTaskProgress.users[uid] || {};
  const uFixed = fixedTaskProgress.users[uid];
  FIXED_TASKS.forEach(task => {
    if (context === task.type && !uFixed[`${task.type}_claimed`]) {
      uFixed[task.type] = (uFixed[task.type] || 0) + 1;
      if (uFixed[task.type] >= task.required) {
        grantReward(msg, uid, task.reward, `固定任務「${task.desc}」完成`);
        uFixed[`${task.type}_claimed`] = true;
      }
    }
  });
  saveJSON(FIXED_TASK_FILE, fixedTaskProgress);

  hiddenTaskProgress.users[uid] = hiddenTaskProgress.users[uid] || {};
  const uHidden = hiddenTaskProgress.users[uid];
  if (context === 'message' && msg.content.includes('我是蓋')) {
    uHidden.secretMessage = (uHidden.secretMessage || 0) + 1;
    if (uHidden.secretMessage >= 3) {
      grantReward(msg, uid, 5, '隱藏任務「偷偷說我是蓋」完成');
      uHidden.secretMessage = 0;
    }
  }
  if (context === 'pray' && new Date().getHours() === 22) {
    uHidden.nightPray = (uHidden.nightPray || 0) + 1;
    if (uHidden.nightPray >= 1) {
      grantReward(msg, uid, 4, '隱藏任務「午夜簽到」完成');
      uHidden.nightPray = 0;
    }
  }
  saveJSON(HIDDEN_TASK_FILE, hiddenTaskProgress);
}

// 顯示函數
function showTodayTask(msg) {
  checkDailyReset();
  msg.reply(`今日隨機任務\n${taskData.task.desc}\n獎勵：幫貢 +${taskData.task.reward}`);
}

function showTaskProgress(msg) {
  const uid = msg.author.id;
  const p = taskData.task?.progress[uid] || 0;
  const goal = taskData.task?.goal || 0;
  msg.reply(`隨機任務進度\n${taskData.task.desc}\n${progressBar(p, goal)} ${p}/${goal}`);
}

function showFixedTaskProgress(msg) {
  const uid = msg.author.id;
  const u = fixedTaskProgress.users[uid] || {};
  let text = '固定任務進度\n';
  FIXED_TASKS.forEach(task => {
    const prog = u[task.type] || 0;
    const claimed = u[`${task.type}_claimed`] ? ' 已領取' : '';
    text += `${task.desc}：${prog}/${task.required}${claimed}\n`;
  });
  msg.reply(text);
}

function showWorld(msg) {
  const r = world.regions[world.currentRegion];
  const isMain = world.currentRegion === 'central';
  let buildingsText = `\n靈魂建築：${r.buildings[0]}`;
  if (!isMain) {
    buildingsText += `\n已解鎖探索建築：${r.buildings.slice(1).join('、') || '無'} (${r.buildings.length - 1}/4)`;
  } else {
    buildingsText += `\n（主城純潔聖地，不設探索建築）`;
  }

  msg.reply(
    `當前據點：${r.name} Lv.${r.level}\n` +
    `幫貢進度：${r.bless}/${r.target}\n` +
    `${progressBar(r.bless, r.target)}${buildingsText}`
  );
}

function showMap(msg) {
  let text = '蓋幫勢力地圖\n\n';
  Object.values(world.regions).forEach(r => {
    text += `${r.name} Lv.${r.level}\n`;
  });
  msg.reply(text);
}

async function showRanking(msg, client, type = 'daily') {
  const data = type === 'daily' ? users.dailyContrib : users.totalContrib;
  const sorted = Object.entries(data).sort(([,a], [,b]) => b - a).slice(0, 10);
  let text = `${type === 'daily' ? '今日' : '歷史總'}幫貢排行榜\n\n`;
  for (let i = 0; i < sorted.length; i++) {
    try {
      const user = await client.users.fetch(sorted[i][0]);
      text += `${i+1}. ${user.username} — ${sorted[i][1]} 次\n`;
    } catch {
      text += `${i+1}. 離開的幫眾 — ${sorted[i][1]} 次\n`;
    }
  }
  msg.reply(text);
}

// 初始化與遷移
function init() {
  if (!world || !world.regions || Object.keys(world.regions).length === 0) {
    world = {
      era: 1,
      lastReset: today(),
      currentRegion: 'central',
      regions: {
        central: { name: '蓋幫總基地', level: 1, bless: 0, target: 100, unlocked: true, buildings: ['祈福壇'] }
      }
    };
    saveJSON(WORLD_FILE, world);
  }

  // 舊資料遷移
  Object.keys(world.regions).forEach(key => {
    const r = world.regions[key];
    if (!r.buildings) r.buildings = [LANDMARK_BUILDINGS[key] || '祈福壇'];
    if (key === 'central') {
      r.name = '蓋幫總基地';
      r.buildings = ['祈福壇'];
    }
  });
  // 一次性修復：已升級卻沒建築的據點自動補上該有的建築
  Object.values(world.regions).forEach(r => {
    const isMain = r.name === '蓋幫總基地';
    const buildingList = isMain ? MAIN_CITY_BUFF_BUILDINGS : EXPLORATION_BUILDINGS;

    buildingList.forEach(b => {
      if (b.unlockLevel <= r.level && !r.buildings.includes(b.name)) {
        r.buildings.push(b.name);
      }
    });
  });
  saveJSON(WORLD_FILE, world);

  if (users.totalPray) {
    users.totalContrib = users.totalPray;
    delete users.totalPray;
  }
  if (users.dailyPray) {
    users.dailyContrib = users.dailyPray;
    delete users.dailyPray;
  }

  saveJSON(WORLD_FILE, world);
  saveJSON(USERS_FILE, users);
}
init();

module.exports = {
  handlePray,
  handleTasks,
  showTodayTask,
  showTaskProgress,
  showFixedTaskProgress,
  showWorld,
  showMap,
  showRanking,
  grantReward,
  checkDailyReset
};
const fs = require('fs');
const path = require('path');
const { loadJSON, saveJSON, today, progressBar } = require('./utils');

// ===== 檔案路徑 =====
const DATA_DIR = path.join(__dirname, '..', 'data');
const WORLD_FILE = path.join(DATA_DIR, 'world.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const COOLDOWN_FILE = path.join(DATA_DIR, 'cooldown.json');
const ORDER_FILE = path.join(DATA_DIR, 'order.json');
const TASK_FILE = path.join(DATA_DIR, 'tasks.json');
const FIXED_TASK_FILE = path.join(DATA_DIR, 'fixedTasksProgress.json');
const HIDDEN_TASKS = [
  { trigger: 'secretMessage', desc: '偷偷說我是蓋 3 次', goal: 3, reward: 5 },
  { trigger: 'nightPray', desc: '午夜簽到', goal: 1, reward: 4 }
];
const HIDDEN_TASK_FILE = path.join(DATA_DIR, 'hiddenTasksProgress.json');

// ===== 資料載入 =====
let world = loadJSON(WORLD_FILE, null);
let users = loadJSON(USERS_FILE, { totalContrib: {}, dailyContrib: {} });
let cooldown = loadJSON(COOLDOWN_FILE, {});
let order = loadJSON(ORDER_FILE, {});
let taskData = loadJSON(TASK_FILE, { day: '', task: null });
let fixedTaskProgress = loadJSON(FIXED_TASK_FILE, { day: '', users: {} });
let hiddenTaskProgress = loadJSON(HIDDEN_TASK_FILE, {});

// ===== 防重事件 =====
let processedEvents = new Set();

// ===== 任務池 =====
const TASK_POOL = [
  { type: 'message', desc: '今日發送 {goal} 則訊息', min: 3, max: 8, reward: 2 },
  { type: 'emoji', desc: '發送 {goal} 個表情符號', min: 5, max: 10, reward: 2 },
  { type: 'reply', desc: '回覆他人訊息 {goal} 次', min: 2, max: 5, reward: 3 },
  { type: 'attachment', desc: '上傳 {goal} 張圖片或貼圖', min: 1, max: 3, reward: 3 },
  { type: 'greet', desc: '打招呼 {goal} 次（早安/午安/晚安/安安）', min: 1, max: 2, reward: 2 }
];

const FIXED_TASKS = [{ type: 'pray', desc: '每日上香已完成', required: 1, reward: 3 }];

// ===== 建築定義 =====
const LANDMARK_BUILDINGS = {
  central: '祈福壇',
  region_2: '古樹守護壇',
  region_3: '沙暴堡壘',
  region_4: '永凍神殿',
  region_5: '海神燈塔'
};

const MAIN_CITY_BUFF_BUILDINGS = [
  { name: '香火塔', desc: '全幫幫貢收益永久 +10%' },
  { name: '靈氣泉', desc: '隨機任務獎勵永久 +15%' },
  { name: '福緣殿', desc: '隱藏任務觸發率 +20%' },
  { name: '神恩亭', desc: '全幫幫貢收益再 +20%（總計 +30%)' }
];

const EXPLORATION_BUILDINGS = [
  { name: '前哨據點', unlockLevel: 2, desc: '野外事件 +20%' },
  { name: '守望塔', unlockLevel: 3, desc: '怪物掉落 +30%' },
  { name: '遺跡挖掘站', unlockLevel: 4, desc: '隱藏遺跡更容易獲得稀有物' },
  { name: '情報中心', unlockLevel: 5, desc: '稀有掉落 +50%' }
];

// ===== 特殊時間 Buff =====
function getCurrentBuff() {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay();
  let multiplier = 1;
  let desc = '';
  if (hour === 22) { multiplier = 2; desc = '🌙 午夜幫貢加倍'; }
  if (day === 0 || day === 6) { multiplier *= 2; desc = desc ? `${desc} + 🎉 週末加倍` : '🎉 週末幫貢加倍'; }
  return { multiplier, desc: desc || '' };
}

// ===== 每日重置 =====
function checkDailyReset() {
  const todayStr = today();
  let changed = false;
  if (world.lastReset !== todayStr) {
    world.lastReset = todayStr;
    users.dailyContrib = {};
    cooldown = {};
    order = {};
    processedEvents.clear();
    changed = true;
  }
  if (taskData.day !== todayStr) {
    taskData = { day: todayStr, task: randomTask() };
    saveJSON(TASK_FILE, taskData);
  }
  if (fixedTaskProgress.day !== todayStr) {
    fixedTaskProgress = { day: todayStr, users: {} };
    saveJSON(FIXED_TASK_FILE, fixedTaskProgress);
  }
  if (hiddenTaskProgress.day !== todayStr) {
    hiddenTaskProgress = { day: todayStr, users: {} };
    saveJSON(HIDDEN_TASK_FILE, hiddenTaskProgress);
  }
  if (changed) {
    saveJSON(WORLD_FILE, world);
    saveJSON(USERS_FILE, users);
    saveJSON(COOLDOWN_FILE, cooldown);
    saveJSON(ORDER_FILE, order);
  }
}

// ===== 隨機任務 =====
function randomTask() {
  const base = TASK_POOL[Math.floor(Math.random() * TASK_POOL.length)];
  const goal = Math.floor(Math.random() * (base.max - base.min + 1)) + base.min;
  return {
    type: base.type,
    desc: base.desc.replace('{goal}', goal),
    goal,
    reward: base.reward,
    progress: {}
  };
}

// ===== 解鎖新區域（初始 target 固定 100）=====
function unlockNextRegion() {
  const nextId = `region_${Object.keys(world.regions).length + 1}`;
  const names = ['東境荒原', '西方大漠', '北方冰原', '南方群島', '天空之城', '幽冥深淵'];
  const name = names[Object.keys(world.regions).length - 1] || `神秘區域 ${Object.keys(world.regions).length}`;
  const landmark = LANDMARK_BUILDINGS[nextId] || '未知地標';

  world.regions[nextId] = {
    name,
    level: 1,
    bless: 0,
    target: 100,  // 固定初始 100
    unlocked: true,
    buildings: [landmark]
  };
  saveJSON(WORLD_FILE, world);
}

// ===== 獎勵發放（每個地區獨立升級難度遞增）=====
function grantReward(msg, uid, amount, reason) {
  const buff = getCurrentBuff();
  const finalAmount = (amount+1) * buff.multiplier;
  //:const finalAmount = amount * buff.multiplier;
  users.totalContrib[uid] = (users.totalContrib[uid] || 0) + finalAmount;
  const region = world.regions[world.currentRegion];
  const previousBless = region.bless;
  region.bless += finalAmount;

  let upgradeMsg = '';
  if (region.bless >= region.target) {
    const overflow = region.bless - region.target;
    region.level += 1;
    region.bless = overflow;

    // 地區獨立遞增難度：越高等級，下次 target 越硬、更難插滿～
    const baseIncrease = 150;  // 基礎增量
    const difficultyMultiplier = region.level * 50;  // 等級每高1，多加50（調整這裡讓它更變態）
    region.target += baseIncrease + difficultyMultiplier;

    upgradeMsg = `\n🏯 ${region.name} 擴建至 Lv.${region.level}！下次需要 ${region.target} 幫貢`;

    const isMainCity = world.currentRegion === 'central';

    if (isMainCity) {
      const unlockIndex = region.level - 2;
      if (unlockIndex >= 0 && unlockIndex < MAIN_CITY_BUFF_BUILDINGS.length) {
        const newBuilding = MAIN_CITY_BUFF_BUILDINGS[unlockIndex];
        if (!region.buildings.includes(newBuilding.name)) {
          region.buildings.push(newBuilding.name);
          upgradeMsg += `\n🛠️ 神聖建築落成：**${newBuilding.name}**\n${newBuilding.desc}`;
        }
      }
      if (region.level >= 5) {
        upgradeMsg += `\n🌟 祈福壇神力覺醒到極致！全幫收益增加`;
      }
    } else {
      const newBuildingObj = EXPLORATION_BUILDINGS.find(b => b.unlockLevel === region.level);
      if (newBuildingObj && !region.buildings.includes(newBuildingObj.name)) {
        region.buildings.push(newBuildingObj.name);
        upgradeMsg += `\n🛠️ 新建築落成：${newBuildingObj.name}\n${newBuildingObj.desc}`;
      }
      if (region.level === 5) {
        upgradeMsg += `\n🌋 ${region.name} 被蓋幫徹底征服！稀有事件 +100%`;
      }
    }

    msg.channel.send(upgradeMsg);
    unlockNextRegion();

    // ===== Era 升級條件：當前 Era 所有 5 個分基地都 Lv.5 =====
    const totalRegions = Object.keys(world.regions).length - 1; // 減去 central
    const expectedForCurrentEra = 5 * world.era;
    if (totalRegions >= expectedForCurrentEra) {
      const currentEraRegions = Object.keys(world.regions)
        .filter(key => key !== 'central')
        .slice(0, expectedForCurrentEra);
      const allConquered = currentEraRegions.every(key => world.regions[key].level >= 5);

      if (allConquered) {
        world.era += 1;
        world.lastReset = today();  // Era 升級時強制新一天
        saveJSON(WORLD_FILE, world);
        msg.channel.send(`🌍 蓋幫勢力升級至 Era ${world.era}！所有分基地解鎖，新紀元開啟`);
      }
    }
  }

  saveJSON(USERS_FILE, users);
  saveJSON(WORLD_FILE, world);

  if (msg && finalAmount > 0) {
    msg.reply(
      `🎁 ${reason} +${finalAmount} ${buff.desc}\n` +
      `據點香火進度 +${finalAmount}（${previousBless} → ${region.bless}/${region.target}）${upgradeMsg}`
    );
  }
}

// ===== 每日簽到 =====
async function handlePray(msg) {
  const uid = msg.author.id;

  // 確保 users 物件存在
  if (!global.users) global.users = {};

  // 確保 dailyContrib 和 totalContrib 初始化
  if (!users.dailyContrib) users.dailyContrib = {};
  if (!users.totalContrib) users.totalContrib = {};

  checkDailyReset();

  if (cooldown[uid]) 
    return msg.reply('⏳ 你今天已經簽到過了～明天再來讓蓋主好好疼愛你吧😘');

  cooldown[uid] = true;
  saveJSON(COOLDOWN_FILE, cooldown);

  // 初始化單個玩家的資料
  users.dailyContrib[uid] = (users.dailyContrib[uid] || 0) + 1;
  users.totalContrib[uid] = (users.totalContrib[uid] || 0) + 1;
  saveJSON(USERS_FILE, users);

  const rank = Object.keys(users.dailyContrib).length;
  const buff = getCurrentBuff();

  msg.reply(
    `✅ 每日簽到完成！你是今日第 ${rank} 位被蓋幫寵愛的幫眾～\n` +
    `累積幫貢：${users.totalContrib[uid]} 次${buff.desc ? `\n🔥 ${buff.desc} 加成！` : ''}`
  );

  handleTasks(msg, 'pray');
}

// ===== 任務處理 =====
function handleTasks(msg, context = 'message') {
  const uid = msg.author.id;
  const eventId = `${today()}_${uid}_${context}_${msg.id}`;
  if (processedEvents.has(eventId)) return;
  processedEvents.add(eventId);

  // 隨機任務
  if (taskData.task && taskData.task.type === context) {
    taskData.task.progress[uid] = (taskData.task.progress[uid] || 0) + 1;
    if (taskData.task.progress[uid] === taskData.task.goal) {
      grantReward(msg, uid, taskData.task.reward, `隨機任務「${taskData.task.desc}」完成！`);
    }
    saveJSON(TASK_FILE, taskData);
  }

  // 固定任務
  fixedTaskProgress.users[uid] = fixedTaskProgress.users[uid] || {};
  const uFixed = fixedTaskProgress.users[uid];
  FIXED_TASKS.forEach(task => {
    if (context === task.type && !uFixed[`${task.type}_claimed`]) {
      uFixed[task.type] = (uFixed[task.type] || 0) + 1;
      if (uFixed[task.type] >= task.required) {
        grantReward(msg, uid, task.reward, `固定任務「${task.desc}」完成！`);
        uFixed[`${task.type}_claimed`] = true;
      }
    }
  });
  saveJSON(FIXED_TASK_FILE, fixedTaskProgress);

  // 隱藏任務
  hiddenTaskProgress[uid] = hiddenTaskProgress[uid] || {};
  const uHidden = hiddenTaskProgress[uid];
  if (context === 'message' && msg.content.includes('我是蓋')) {
    uHidden.secretMessage = (uHidden.secretMessage || 0) + 1;
    if (uHidden.secretMessage >= 3) {
      grantReward(msg, uid, 5, '隱藏任務「偷偷說我是蓋」完成！神明聽見了～💕');
      uHidden.secretMessage = 0;
    }
  }
  if (context === 'pray' && new Date().getHours() === 22) {
    uHidden.nightPray = (uHidden.nightPray || 0) + 1;
    if (uHidden.nightPray >= 1) {
      grantReward(msg, uid, 4, '隱藏任務「午夜簽到」完成！🌙');
      uHidden.nightPray = 0;
    }
  }
  saveJSON(HIDDEN_TASK_FILE, hiddenTaskProgress);
}

// ===== 顯示相關函數 =====
function showTodayTask(msg) {
  checkDailyReset();
  msg.reply(`📜 今日隨機任務\n${taskData.task?.desc || '載入中...'}\n獎勵：幫貢 +${taskData.task?.reward || 0} `);
}

function showTaskProgress(msg) {
  const uid = msg.author.id;
  const p = (taskData.task?.progress[uid] || 0);
  const goal = taskData.task?.goal || 0;
  msg.reply(`📊 隨機任務進度\n${taskData.task?.desc || '無任務'}\n${progressBar(p, goal)} ${p}/${goal}`);
}

function showFixedTaskProgress(msg) {
  const uid = msg.author.id;
  const u = fixedTaskProgress.users[uid] || {};
  let text = '📊 固定任務進度（每天重置）\n';
  FIXED_TASKS.forEach(task => {
    const prog = u[task.type] || 0;
    const claimed = u[`${task.type}_claimed`] ? ' ✅ 已領取' : '';
    text += `${task.desc}：${prog}/${task.required}${claimed}\n`;
  });
  msg.reply(text);
} 

function showWorld(msg) {
  const r = world.regions[world.currentRegion];
  const isMain = world.currentRegion === 'central';
  let buildingsText = `\n🏰 靈魂建築：**${r.buildings[0]}** (永恆存在，蓋幫的硬核聖物)`;
  if (!isMain) {
    buildingsText += `\n🛠️ 已解鎖探索建築：${r.buildings.slice(1).join('、') || '還沒開'} (${r.buildings.length - 1}/4)`;
  } else {
    buildingsText += `\n（主城純潔聖地，不設探索建築～）`;
  }
  msg.reply(
    `🌍 【時代覺醒】蓋幫勢力 Era ${world.era}！\n` +
    `📍當前據點：${r.name} Lv.${r.level}\n` +
    `🕯️幫貢進度：${r.bless}/${r.target}\n` +
    `${progressBar(r.bless, r.target)}${buildingsText}`
  );
}

function showMap(msg) {
  let text = '🗺️ 蓋幫勢力地圖（已被征服的區域）\n\n';
  Object.entries(world.regions).forEach(([key, r]) => {
    const current = world.currentRegion === key ? ' ← 當前征服中' : '';
    text += `${r.name} Lv.${r.level}${current}\n`;
  });
  msg.reply(text);
}

async function showRanking(msg, client, type = 'daily') {
  const data = type === 'daily' ? users.dailyContrib : users.totalContrib;
  const sorted = Object.entries(data)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10);
  let text = `🏆 ${type === 'daily' ? '今日' : '歷史總'}香火排行榜\n\n`;
  for (let i = 0; i < sorted.length; i++) {
    try {
      const user = await client.users.fetch(sorted[i][0]);
      text += `${i+1}. ${user.username} — ${sorted[i][1]} 次\n`;
    } catch {
      text += `${i+1}. 離開的幫眾 — ${sorted[i][1]} 次\n`;
    }
  }
  msg.reply(text);
}

function init() {
  if (!world || !world.regions || Object.keys(world.regions).length === 0) {
    world = {
      era: 1,
      lastReset: today(),
      currentRegion: 'central',
      regions: {
        central: { name: '蓋幫總基地', level: 1, bless: 0, target: 100, unlocked: true, buildings: ['祈福壇'] }
      }
    };
    saveJSON(WORLD_FILE, world);
  }
  Object.keys(world.regions).forEach(key => {
    const r = world.regions[key];
    if (!r.buildings || r.buildings.length === 0) {
      r.buildings = [LANDMARK_BUILDINGS[key] || '祈福壇'];
    }
    if (key === 'central') {
      r.name = '蓋幫總基地';
      if (!r.buildings.includes('祈福壇')) r.buildings.unshift('祈福壇');
    }
  });
  saveJSON(WORLD_FILE, world);
}
init();

module.exports = {
  handlePray,
  handleTasks,
  showTodayTask,
  showTaskProgress,
  showFixedTaskProgress,
  showWorld,
  showMap,
  showRanking,
  grantReward,
  checkDailyReset
};
*/