require('dotenv').config();

const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const path = require('path');

// 檢查 TOKEN
if (!process.env.TOKEN) {
  console.error('TOKEN 未設定，請檢查 .env 檔案');
  process.exit(1);
}

console.log('TOKEN 已載入');

// Client 設定
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// 匯入系統功能
const {
  handleTasks,
  showTodayTask,
  showTaskProgress,
  showFixedTaskProgress,
  handlePray,
  showWorld,
  showMap,
  showRanking,
  grantReward,
  checkDailyReset,
  progressBar,
  getWorld,
  handleExplore,
  getStamina,
  users  // 用於 NPC 事件扣/加幫貢
} = require('./systems/gameSystem');

const { showBotGuide } = require('./systems/help');
const { saveJSON } = require('./systems/utils');

const world = getWorld();

// 工具函數
const hasUnicodeEmoji = (text) => /\p{Extended_Pictographic}/u.test(text);
const hasCustomEmoji = (text) => /<a?:\w+:\d+>/.test(text);
const isGreeting = (text) => /早安|午安|晚安|安安|早|安/.test(text);

// 指令表
const commands = new Map([
  ['每日掃墓', async (msg) => {
    await handlePray(msg);
    handleTasks(msg, 'pray');
  }],
  ['!世界', showWorld],
  ['!地圖', showMap],
  ['!上香排行', (msg) => showRanking(msg, client, 'daily')],
  ['!總排行', (msg) => showRanking(msg, client, 'total')],
  ['!今日任務', showTodayTask],
  ['!任務進度', showTaskProgress],
  ['!固定任務進度', showFixedTaskProgress],
  ['!機器人', showBotGuide],
  ['!ㄐㄐ人', showBotGuide],

  // !據點
  ['!據點', async (msg) => {
    try {
      const args = msg.content.trim().split(' ').slice(1).join(' ').toLowerCase();

      let targetRegion;
      if (!args) {
        targetRegion = world.regions[world.currentRegion];
      } else {
        targetRegion = Object.values(world.regions).find(r => r.name && r.name.toLowerCase().includes(args));
        if (!targetRegion) {
          const available = Object.values(world.regions).filter(r => r.name).map(r => r.name).join('、');
          return msg.reply(`找不到該據點\n可用據點：${available}`);
        }
      }

      const r = targetRegion;
      const isMain = r.name === '蓋幫總基地';
      let text = `【${r.name}】等級 ${r.level}\n`;
      text += `幫貢進度：${r.bless || 0}/${r.target || 100}\n${progressBar(r.bless || 0, r.target || 100)}\n\n`;
      text += `靈魂建築：${r.buildings?.[0] || '祈福壇'}\n`;

      if (isMain) {
        text += `\n主城神聖建築：\n`;
        const unlocked = r.buildings.slice(1);
        text += unlocked.length > 0 ? unlocked.join('、') : '（尚未解鎖）';
      } else {
        text += `\n探索建築（${(r.buildings.length - 1)}/4）：\n`;
        text += r.buildings.length > 1 ? r.buildings.slice(1).join('、') : '（尚未解鎖）';
      }

      msg.reply(text);
    } catch (error) {
      console.error('!據點 錯誤：', error);
      msg.reply('據點情報讀取失敗，請稍後再試');
    }
  }],

  // !切換據點（按鈕版）
  ['!切換據點', async (msg) => {
    const regions = Object.entries(world.regions);
    if (regions.length === 1) {
      return msg.reply('目前只有蓋幫總基地，無其他據點可切換');
    }

    const rows = [];
    let row = new ActionRowBuilder();

    regions.forEach(([key, r]) => {
      if (row.components.length === 5) {
        rows.push(row);
        row = new ActionRowBuilder();
      }

      const isCurrent = world.currentRegion === key;
      const button = new ButtonBuilder()
        .setCustomId(`switch_${key}`)
        .setLabel(r.name + (isCurrent ? ' (當前)' : ''))
        .setStyle(isCurrent ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(isCurrent);

      row.addComponents(button);
    });

    if (row.components.length > 0) rows.push(row);

    msg.reply({
      content: '請選擇要切換的據點：',
      components: rows
    });
  }],

  // !探索
  ['!探索', async (msg) => {
    await handleExplore(msg);
  }],

  // !體力
  ['!體力', (msg) => {
    const uid = msg.author.id;
    const s = getStamina(uid);
    msg.reply(`你的體力：${s.current}/${s.max}\n（每日自動恢復滿值）`);
  }],
]);

// Ready 事件
client.once('ready', () => {
  console.log(`機器人已上線：${client.user.tag}`);
  client.user.setActivity('!機器人 查看指令', { type: 'PLAYING' });
});

// 按鈕交互處理（切換據點 + 探索NPC選擇）
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  // 切換據點
  if (interaction.customId.startsWith('switch_')) {
    const regionKey = interaction.customId.replace('switch_', '');

    if (!world.regions[regionKey]) {
      return interaction.reply({ content: '該據點不存在', ephemeral: true });
    }

    world.currentRegion = regionKey;
    saveJSON(path.join(__dirname, 'data', 'world.json'), world);

    await interaction.reply(`已切換至 **${world.regions[regionKey].name}**`);

    const newRows = interaction.message.components.map(row => {
      const newRow = ActionRowBuilder.from(row);
      newRow.components.forEach(comp => {
        const btn = ButtonBuilder.from(comp);
        const btnKey = btn.data.custom_id.replace('switch_', '');
        const isCurrent = btnKey === regionKey;
        btn.setStyle(isCurrent ? ButtonStyle.Success : ButtonStyle.Primary);
        btn.setDisabled(isCurrent);
        if (isCurrent) {
          btn.setLabel(btn.data.label.split(' (當前)')[0] + ' (當前)');
        }
      });
      return newRow;
    });

    await interaction.message.edit({ components: newRows });
  }

  // 探索NPC選擇
  if (interaction.customId.startsWith('explore_npc_')) {
    const [, uid, choiceIndex] = interaction.customId.split('_');
    if (interaction.user.id !== uid) {
      return interaction.reply({ content: '這不是你的探索事件', ephemeral: true });
    }

    const temp = world.tempExplore?.[uid];
    if (!temp) {
      return interaction.reply({ content: '事件已過期', ephemeral: true });
    }

    const opt = temp.event.options[parseInt(choiceIndex)];
    let result = `你選擇：${opt.text}\n${opt.message}`;

    if (opt.result === 'good') {
      users[uid] = (users[uid] || 0) + opt.reward;
      result += `\n獲得 ${opt.reward} 幫貢`;
    } else if (opt.result === 'bad') {
      users[uid] = (users[uid] || 0) - opt.penalty;
      result += `\n損失 ${opt.penalty} 幫貢`;
    }

    saveJSON(path.join(__dirname, 'data', 'users.json'), users);
    delete world.tempExplore[uid];
    saveJSON(path.join(__dirname, 'data', 'world.json'), world);

    await interaction.update({ content: result, components: [] });
  }
});

// 訊息處理
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  if (!content) return;

  try {
    if (commands.has(content)) {
      await commands.get(content)(message);
      return;
    }

    const triggers = new Set(['message']);
    if (hasUnicodeEmoji(content) || hasCustomEmoji(content)) triggers.add('emoji');
    if (message.reference) triggers.add('reply');
    if (message.attachments.size > 0) triggers.add('attachment');
    if (isGreeting(content)) triggers.add('greet');

    for (const type of triggers) {
      handleTasks(message, type);
    }
  } catch (error) {
    console.error('訊息處理錯誤：', error);
    await message.reply('系統發生錯誤，請稍後再試');
  }
});

// 登入
client.login(process.env.TOKEN)
  .then(() => console.log('登入成功'))
  .catch(err => {
    console.error('登入失敗：', err);
    process.exit(1);
  });
/*require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const path = require('path');  // 用來穩定存檔

// 檢查 TOKEN
if (!process.env.TOKEN) {
  console.error('❌ TOKEN 未設定！快去 .env 給我你的大權杖啦～');
  process.exit(1);
}

console.log('TOKEN 已載入🔥');

// ===== Client 設定 =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ===== 匯入系統功能 =====
const {
  handleTasks,
  showTodayTask,
  showTaskProgress,
  showFixedTaskProgress,
  handlePray,
  showWorld,
  showMap,
  showRanking,
  grantReward,
  checkDailyReset,
  progressBar  // ← 必須加這行，!據點 要用
} = require('./systems/gameSystem');

const { showBotGuide } = require('./systems/help');
const { world } = require('./systems/gameSystem');
const { saveJSON } = require('./systems/utils');  // ← 穩定存檔用

// ===== 工具函數 =====
const hasUnicodeEmoji = (text) => /\p{Extended_Pictographic}/u.test(text);
const hasCustomEmoji = (text) => /<a?:\w+:\d+>/.test(text);
const isGreeting = (text) => /早安|午安|晚安|安安|早|安/.test(text);

// ===== 指令表 =====
const commands = new Map([
  ['每日掃墓', async (msg) => {
    await handlePray(msg);
    handleTasks(msg, 'pray');
  }],
  ['!世界', showWorld],
  ['!地圖', showMap],
  ['!上香排行', (msg) => showRanking(msg, client, 'daily')],
  ['!總排行', (msg) => showRanking(msg, client, 'total')],
  ['!今日任務', showTodayTask],
  ['!任務進度', showTaskProgress],
  ['!固定任務進度', showFixedTaskProgress],
  ['!機器人', showBotGuide],
  ['!ㄐㄐ人', showBotGuide],

  // ===== !據點 指令（已修好 progressBar + 更詳細更色）=====
  ['!據點', async (msg) => {
    const args = msg.content.trim().split(' ').slice(1).join(' ').toLowerCase();
    
    let targetRegion;
    if (!args) {
      targetRegion = world.regions[world.currentRegion];
    } else {
      targetRegion = Object.values(world.regions).find(r => r.name.toLowerCase().includes(args));
      if (!targetRegion) {
        return msg.reply(`❌ 找不到「${args}」這個據點～\n可用據點：${Object.values(world.regions).map(r => r.name).join('、')}`);
      }
    }

    const r = targetRegion;
    const isMain = r.name === '蓋幫總基地';
    let text = `🏰 【據點情報】${r.name} Lv.${r.level}\n`;
    text += `幫貢進度：${r.bless}/${r.target}\n${progressBar(r.bless, r.target)}\n`;
    text += `🏰 靈魂建築：**${r.buildings[0]}** (永恆存在)\n`;

    if (!isMain) {
      const exploreCount = r.buildings.length - 1;
      text += `🛠️ 已解鎖探索建築：${exploreCount}/4\n`;
      if (exploreCount > 0) text += `${r.buildings.slice(1).join('、')}\n`;
      text += exploreCount === 4 ? '🌋 已被蓋幫徹底征服！稀有事件' : '還沒全滿～快來繼續農吧';
    } else {
      text += '（主城純潔聖地，只獻給祈福壇）';
    }

    msg.reply(text);
  }],

  // ===== !切換據點（穩定存檔版）=====
  ['!切換據點', async (msg) => {
    const args = msg.content.trim().split(' ').slice(1).join(' ').toLowerCase();
    if (!args) {
      return msg.reply(`❌ 用法：!切換據點 <據點名稱>\n可用據點：${Object.values(world.regions).map(r => r.name).join('、')}`);
    }

    const foundKey = Object.keys(world.regions).find(key => 
      world.regions[key].name.toLowerCase().includes(args)
    );

    if (!foundKey) {
      return msg.reply('❌ 找不到這個據點～');
    }

    world.currentRegion = foundKey;
    saveJSON(path.join(__dirname, 'data', 'world.json'), world);

    msg.reply(`✅ 全幫貢獻流向切換至：**${world.regions[foundKey].name}**\n現在大家一起用力農這裡吧～`);
  }],
]);

// ===== Ready 事件 =====
client.once('clientReady', () => {
  console.log(`🌏 蓋幫世界已徹底啟動！${client.user.tag}`);
  client.user.setActivity('!機器人 查看指令 | 蓋幫征服大陸中', { type: 'PLAYING' });
});

// ===== 訊息監聽 =====
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content?.trim();
  if (!content) return;

  try {
    if (commands.has(content)) {
      await commands.get(content)(message);
      return;
    }

    const triggers = new Set(['message']);
    if (hasUnicodeEmoji(content) || hasCustomEmoji(content)) triggers.add('emoji');
    if (message.reference) triggers.add('reply');
    if (message.attachments.size > 0) triggers.add('attachment');
    if (isGreeting(content)) triggers.add('greet');

    for (const type of triggers) {
      handleTasks(message, type);
    }

  } catch (error) {
    console.error('❌ messageCreate 錯誤：', error);
    await message.reply('⚠️ 蓋幫世界線劇烈震盪，神明正在用力按住～');
  }
});

// ===== 登入 =====
client.login(process.env.TOKEN)
  .then(() => console.log('登入成功～'))
  .catch(err => {
    console.error('❌ 登入失敗：', err);
    process.exit(1);
  });

require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

// 檢查 TOKEN
if (!process.env.TOKEN) {
  console.error('❌ TOKEN 未設定！');
  process.exit(1);
}

console.log('TOKEN 已載入');

// ===== Client 設定 =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,     // 這是必須的，不然讀不到訊息內容
    GatewayIntentBits.GuildMembers
  ]
});

// ===== 匯入系統功能 =====
const {
  handleTasks,
  showTodayTask,
  showTaskProgress,
  showFixedTaskProgress,
  handlePray,
  showWorld,
  showMap,
  showRanking,
  grantReward
} = require('./systems/gameSystem');

const { showBotGuide } = require('./systems/help');

// ===== 工具函數 =====
const hasUnicodeEmoji = (text) => /\p{Extended_Pictographic}/u.test(text);
const hasCustomEmoji = (text) => /<a?:\w+:\d+>/.test(text);
const isGreeting = (text) => /早安|午安|晚安|安安|早|午安|晚安|安/.test(text);

// ===== 指令表 =====
const commands = new Map([
  ['每日掃墓', async (msg) => {
    await handlePray(msg);
    handleTasks(msg, 'pray');
  }],
  ['!世界', showWorld],
  ['!地圖', showMap],
  ['!上香排行', (msg) => showRanking(msg, client)],
  ['!今日任務', showTodayTask],
  ['!任務進度', showTaskProgress],
  ['!固定任務進度', showFixedTaskProgress],
  ['!機器人', showBotGuide],
  ['!ㄐㄐ人', showBotGuide],  // 加進來，避免重複判斷
  ['!據點', (msg) => {
  // 讓玩家打 !據點 東境森林 看特定分基地
  const args = msg.content.trim().split(' ').slice(1).join(' ');
  const targetRegion = Object.entries(world.regions).find(([id, r]) => r.name.includes(args));
  if (!targetRegion) return msg.reply('❌ 找不到這據點～');
  
  const r = targetRegion[1];
  const buildingBuff = r.buildings.slice(1).length;
  msg.reply(
    `🏰 ${r.name} 狀態\n` +
    `等級：Lv.${r.level}\n` +
    `幫貢進度：${r.bless}/${r.target}\n` +
    `${progressBar(r.bless, r.target)}\n` +
    `已蓋建築：${buildingBuff}/4 （${r.buildings.slice(1).join('、') || 'none'}）`
  );
}],
]);

// ===== Ready 事件 =====
client.once('clientReady', () => {
  console.log(`🌏 世界已徹底啟動！${client.user.tag} `);
  client.user.setActivity('！機器人 查看指令', { type: 'PLAYING' });
});

// ===== 訊息監聽 =====
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content?.trim();
  if (!content) return;

  try {
    // === 精確指令匹配 ===
    if (commands.has(content)) {
      await commands.get(content)(message);
      return;
    }

    // === 行為觸發收集 ===
    const triggers = new Set(['message']);

    if (hasUnicodeEmoji(content) || hasCustomEmoji(content)) triggers.add('emoji');
    if (message.reference) triggers.add('reply');
    if (message.attachments.size > 0) triggers.add('attachment');
    if (isGreeting(content)) triggers.add('greet');

    // === 統一結算任務 ===
    for (const type of triggers) {
      handleTasks(message, type);
    }

  } catch (error) {
    console.error('❌ messageCreate 錯誤：', error);
    await message.reply('⚠️ 世界線劇烈震盪，神明正在用力按住');
  }
});

// ===== 登入 =====
client.login(process.env.TOKEN)
  .then(() => console.log('登入成功'))
  .catch(err => {
    console.error('❌ 登入失敗：', err);
    process.exit(1);
  });

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
