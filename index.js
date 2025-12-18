// index.js
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const { 
  handleTasks, showTodayTask, showTaskProgress, showFixedTaskProgress, resetTask,
  handlePray, showWorld, showMap, showRanking, grantReward
} = require('./systems/gameSystem');

const { showBotGuide } = require('./systems/help');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ===== 通解工具 =====
const hasUnicodeEmoji = (text) => /\p{Extended_Pictographic}/u.test(text);
const hasCustomEmoji = (text) => /<a?:\w+:\d+>/.test(text);
const isGreeting = (text) => /早安|午安|晚安|安安/.test(text);

// ===== 指令表 =====
const commands = new Map([
  ['每日掃墓', async (msg) => { await handlePray(msg); handleTasks(msg, 'pray'); }],
  ['!世界', showWorld],
  ['!地圖', showMap],
  ['!上香排行', (msg) => showRanking(msg, client)],
  ['!今日任務', showTodayTask],
  ['!任務進度', showTaskProgress],
  ['!固定任務進度', showFixedTaskProgress],
  ['!機器人', showBotGuide]
]);

client.once('ready', () => {
  console.log(`🌏 世界啟動：${client.user.tag}`);
});

// ===== 訊息監聽 =====
client.on('messageCreate', async (msg) => {
  if (msg.author.bot) return;
  const content = msg.content.trim();

  // 指令優先
  if (commands.has(content)) {
    await commands.get(content)(msg);
    return;
  }

  // ===== 行為收集 =====
  const triggers = new Set(['message']);

  if (hasUnicodeEmoji(content) || hasCustomEmoji(content)) triggers.add('emoji');
  if (msg.reference) triggers.add('reply');
  if (msg.attachments.size > 0) triggers.add('attachment');
  if (isGreeting(content)) triggers.add('greet');

  // ===== 統一結算 =====
  for (const type of triggers) {
    handleTasks(msg, type);
  }
});

client.login(process.env.TOKEN);




/*
const fs = require('fs');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();



const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]
});

const DATA_DIR = './data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const FILES = {
  users: `${DATA_DIR}/users.json`,
  cooldown: `${DATA_DIR}/cooldown.json`,
  order: `${DATA_DIR}/order.json`,
  total: `${DATA_DIR}/total.json`,
  city: `${DATA_DIR}/city.json`,
  task: `${DATA_DIR}/dailyTask.json`
};



function load(file, def) {
  return fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : def;
}

function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function todayKey() {
  return new Date().toDateString();
}



let users = load(FILES.users, {});
let cooldown = load(FILES.cooldown, {});
let orderData = load(FILES.order, {});
let totalData = load(FILES.total, { total: 0 });
let city = load(FILES.city, {
  level: 1,
  currentBless: 0,
  capacity: 50,
  lastResetDay: ''
});
let dailyTask = load(FILES.task, {});



const TASK_POOL = [
  { id: 'msg5', desc: '在伺服器留言 5 則', type: 'message', target: 5, reward: 1 },
  { id: 'msg10', desc: '在伺服器留言 10 則', type: 'message', target: 10, reward: 2 },
  { id: 'keyword', desc: '說出關鍵字「笑死」一次', type: 'keyword', keyword: '笑死', target: 1, reward: 3 },
  { id: 'incense', desc: '完成一次每日掃墓', type: 'incense', target: 1, reward: 2 },
];

function pickTask() {
  return TASK_POOL[Math.floor(Math.random() * TASK_POOL.length)];
}


function dailyReset() {
  const today = todayKey();
  if (city.lastResetDay !== today) {
    orderData = {};
    dailyTask = {
      task: pickTask(),
      progress: {},
      done: {}
    };
    city.lastResetDay = today;

    save(FILES.order, orderData);
    save(FILES.task, dailyTask);
    save(FILES.city, city);

    console.log('🌅 每日資料已重置');
  }
}


function checkCityUpgrade(channel) {
  if (city.currentBless >= city.capacity) {
    city.level++;
    city.currentBless = 0;
    city.capacity += 50;

    channel.send(
      `🏛️【城邦升級】
等級提升至 Lv.${city.level}
香火上限 ➜ ${city.capacity}`
    );

    save(FILES.city, city);
  }
}


client.once('ready', () => {
  console.log(`Ciallo～ ${client.user.tag} 已就位 ✨`);
});



client.on('messageCreate', msg => {
  if (msg.author.bot) return;

  dailyReset();

  const userId = msg.author.id;
  const content = msg.content.trim();

  if (!users[userId]) users[userId] = 0;

  const task = dailyTask.task;
  if (!dailyTask.done[userId]) {
    dailyTask.progress[userId] ??= 0;

    if (task.type === 'message') {
      dailyTask.progress[userId]++;
    }

    if (task.type === 'keyword' && content.includes(task.keyword)) {
      dailyTask.progress[userId] = task.target;
    }

    if (dailyTask.progress[userId] >= task.target) {
      dailyTask.done[userId] = true;
      users[userId] += task.reward;
      city.currentBless += task.reward;
      totalData.total += task.reward;

      msg.channel.send(
        `🎉 ${msg.author.username} 完成每日任務！
📜 ${task.desc}
🔥 香火 +${task.reward}`
      );

      save(FILES.users, users);
      save(FILES.total, totalData);
      save(FILES.city, city);
    }
  }


  switch (true) {

    case content === '每日掃墓': {
      if (cooldown[userId] === todayKey()) {
        msg.reply('⏳ 今天已經上過香了，明天再來。');
        return;
      }

      cooldown[userId] = todayKey();
      orderData[todayKey()] ??= 0;
      orderData[todayKey()]++;

      users[userId]++;
      city.currentBless++;
      totalData.total++;

      msg.reply(
        `🕯️ 上香完成！
今日第 ${orderData[todayKey()]} 位
個人累積：${users[userId]}
全服香火：${totalData.total}`
      );

      save(FILES.cooldown, cooldown);
      save(FILES.order, orderData);
      save(FILES.users, users);
      save(FILES.total, totalData);
      save(FILES.city, city);

      checkCityUpgrade(msg.channel);
      break;
    }

    case content === '!每日任務': {
      const p = dailyTask.progress[userId] || 0;
      const done = dailyTask.done[userId];

      msg.reply(
`📜【今日神明任務】
${task.desc}
進度：${done ? '✅ 已完成' : `${p}/${task.target}`}
獎勵：🔥 ${task.reward}`
      );
      break;
    }

    case content === '!城邦': {
      msg.reply(
`🏛️【城邦資訊】
等級：Lv.${city.level}
香火：${city.currentBless}/${city.capacity}
全服香火：${totalData.total}`
      );
      break;
    }
  }
});

client.login(process.env.TOKEN);*/