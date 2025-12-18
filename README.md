# GUYBar Discord Bot

## 安裝(download)
1. 下載或 clone 專案(download or clone the project)
2. ## 安裝
git clone https://github.com/ink-afk/GUYBar.git
cd GUYBar
npm install
3. 建立 `.env` 並填入 Discord Bot Token：(create .env and enter your Discord Bot Token)
TOKEN=你的BotToken <-(YourBotToken here)

## 指令列表
- 🕯 **每日掃墓**：每天上香一次  
- 🌏 **!世界**：查看世界狀態  
- 🗺 **!地圖**：查看世界地圖  
- 🏆 **!上香排行**：查看今日或總計排行榜  
- 📋 **!今日任務**：查看隨機任務  
- 📊 **!任務進度**：查看隨機任務進度  
- 📊 **!固定任務進度**：查看固定任務（每日上香）進度  
- !機器人：毒舌嚮導幫你介紹指令  

## 運作方式
- 每日自動重置任務與世界數據  (reset misson and worlds data daily)
- 任務完成會透過 `grantReward()` 統一加香火  (when mission is completed, grantReward() manage the rewards)
- 特殊時間（午夜、週末）會自動 Buff 獎勵  (special evnet)

## 注意事項(Note:)
- 請勿刪除 `data/` 裡的 JSON 檔，否則會重置所有進度(if delete your json file in data/ you would lost all your process)
