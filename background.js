/* global importScripts, syncCloudKeywords, SYNC_INTERVAL_MINUTES, parseKeywords, getStorageDefaults */
importScripts("utils.js");

const ALARM_NAME = "cloudKeywordSync";
let isSyncing = false;

async function doSync() {
  if (isSyncing) return { success: false, reason: "busy" };
  isSyncing = true;
  try {
    const success = await syncCloudKeywords();
    return { success };
  } finally {
    isSyncing = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: SYNC_INTERVAL_MINUTES,
  });

  chrome.contextMenus.create({
    id: "addToBlocklist",
    title: "添加「%s」到屏蔽词",
    contexts: ["selection"],
    documentUrlPatterns: ["*://*.twitter.com/*", "*://*.x.com/*"],
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    doSync();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "syncNow") {
    doSync().then(sendResponse);
    return true;
  }
  if (message.action === "blockUserOnX") {
    handleBlockUser(message.screenName, true).then(sendResponse);
    return true;
  }
  if (message.action === "unblockUserOnX") {
    handleBlockUser(message.screenName, false).then(sendResponse);
    return true;
  }
});

async function handleBlockUser(screenName, isBlock) {
  try {
    const cookie = await chrome.cookies.get({ url: "https://x.com", name: "ct0" });
    if (!cookie) {
      return { success: false, reason: "无法获取身份凭证，请确保已登录 X" };
    }
    
    const endpoint = isBlock ? "create.json" : "destroy.json";
    const response = await fetch(`https://x.com/i/api/1.1/blocks/${endpoint}`, {
      method: "POST",
      headers: {
        "authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
        "x-csrf-token": cookie.value,
        "content-type": "application/x-www-form-urlencoded"
      },
      body: `screen_name=${encodeURIComponent(screenName)}`
    });

    if (response.ok) {
      return { success: true };
    } else {
      return { success: false, reason: `请求失败: HTTP ${response.status}` };
    }
  } catch (error) {
    return { success: false, reason: error.message };
  }
}

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === "addToBlocklist" && info.selectionText) {
    const inputKws = parseKeywords(info.selectionText);
    if (inputKws.length === 0) return;

    const keyword = inputKws[0];

    chrome.storage.local.get(getStorageDefaults("keywords"), (items) => {
      const existing = parseKeywords(items.keywords);
      if (!existing.includes(keyword)) {
        existing.push(keyword);
        chrome.storage.local.set({ keywords: existing.join("\n") });
      }
    });
  }
});
