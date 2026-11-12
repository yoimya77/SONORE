// SONORE — 裏で動く処理
// ツールバーのアイコンに今の状態（遮 / 解）を表示するだけです。

importScripts("common.js");

async function updateBadge() {
  const { settings, state } = await OD.load();
  const now = Date.now();
  let text = "";
  let color = "#e0002a";
  if (OD.inSchedule(settings, now) && OD.isUnlocked(state, now)) {
    text = "解";
    color = "#101214";
  } else if (OD.isBlocking(settings, state, now)) {
    text = "遮";
    color = "#e0002a";
  }
  await chrome.action.setBadgeText({ text });
  if (text) await chrome.action.setBadgeBackgroundColor({ color });
}

function startTicking() {
  chrome.alarms.create("tick", { periodInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await OD.ensureDefaults();
  startTicking();
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => {
  startTicking();
  updateBadge();
});

chrome.alarms.onAlarm.addListener(updateBadge);
chrome.storage.onChanged.addListener(updateBadge);
