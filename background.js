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
});

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
