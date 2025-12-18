// systems/help.js
function showBotGuide(msg) {
  msg.reply(
`……幹嘛？
你是不是又懶得看說明。

📜 我會的指令如下：

🕯 每日掃墓 —— 每天上香一次，不要多
🌏 !世界 —— 看世界現在長怎樣
🗺 !地圖 —— 地圖，不是 Google Map
🏆 !上香排行 —— 看誰比較閒
📋 !今日任務 —— 今天該打工了
📊 !任務進度 —— 看你到底有沒有在做

就這樣，沒了。
自己學，不要再叫我。`
  );
}

module.exports = { showBotGuide };
