/* global importScripts, syncCloudKeywords, SYNC_INTERVAL_MINUTES, parseKeywords, getStorageDefaults */
importScripts("utils.js");

const ALARM_NAME = "cloudKeywordSync";
let isSyncing = false;

let inMemoryAuth = null;

chrome.webRequest.onSendHeaders.addListener(
  (details) => {
    let auth = null;

    for (let header of details.requestHeaders) {
      if (header.name.toLowerCase() === 'authorization') {
        auth = header.value;
        break;
      }
    }

    if (auth && inMemoryAuth !== auth) {
      inMemoryAuth = auth;
      chrome.storage.local.set({ xAuthHeaders: auth });
    }
  },
  { urls: ["*://*.x.com/i/api/*", "*://*.twitter.com/i/api/*"] },
  ["requestHeaders"]
);

async function getAuthHeaders() {
  if (inMemoryAuth) {
    return { authorization: inMemoryAuth };
  }
  
  const storage = await chrome.storage.local.get('xAuthHeaders');
  if (storage.xAuthHeaders) {
    inMemoryAuth = storage.xAuthHeaders;
    return { authorization: inMemoryAuth };
  }

  return null;
}

const globalSpamCache = new Set();
let storageWritePromise = new Promise((resolve) => {
  chrome.storage.local.get(getStorageDefaults("blockedHistory"), (items) => {
    const history = items.blockedHistory || [];
    for (const item of history) {
      if (item.id) globalSpamCache.add(item.id);
    }
    resolve();
  });
});

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

  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "addToBlocklist",
      title: "添加「%s」到屏蔽词",
      contexts: ["selection"],
      documentUrlPatterns: ["*://*.twitter.com/*", "*://*.x.com/*"],
    });
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
  if (message.action === "recordSpam") {
    handleRecordSpam(message.items);
    sendResponse({ success: true });
    return false;
  }
  if (message.action === "clearSpamCache") {
    globalSpamCache.clear();
    sendResponse({ success: true });
    return false;
  }
  if (message.action === "removeSpamRecord") {
    handleRemoveSpamRecord(message.id, message.time);
    sendResponse({ success: true });
    return false;
  }
});

function handleRemoveSpamRecord(id, time) {
  if (id) {
    globalSpamCache.delete(id);
  }

  storageWritePromise = storageWritePromise
    .then(() => {
      return new Promise((resolve) => {
        chrome.storage.local.get(
          getStorageDefaults("blockedCount", "blockedHistory"),
          (storageItems) => {
            let history = storageItems.blockedHistory || [];
            const originalLength = history.length;
            history = history.filter(
              (item) => !(item.id === id && item.time === time),
            );

            const removedCount = originalLength - history.length;
            if (removedCount > 0) {
              const newCount = Math.max(
                0,
                (storageItems.blockedCount || 0) - removedCount,
              );
              chrome.storage.local.set(
                {
                  blockedCount: newCount,
                  blockedHistory: history,
                },
                () => resolve(),
              );
            } else {
              resolve();
            }
          },
        );
      });
    })
    .catch((e) => {
      console.error("[X-Blocker] storage remove error", e);
    });
}

function handleRecordSpam(items) {
  if (!items || items.length === 0) return;

  storageWritePromise = storageWritePromise
    .then(() => {
      return new Promise((resolve) => {
        const newSpams = [];
        for (const item of items) {
          if (!globalSpamCache.has(item.id)) {
            globalSpamCache.add(item.id);
            newSpams.push({
              id: item.id,
              text: item.text,
              user: item.user,
              displayName: item.displayName,
              reason: item.reason,
              time: item.time,
            });
            if (globalSpamCache.size > 5000) {
              const iter = globalSpamCache.values();
              for (let i = 0; i < 1000; i++)
                globalSpamCache.delete(iter.next().value);
            }
          }
        }

        if (newSpams.length === 0) return resolve();

        chrome.storage.local.get(
          getStorageDefaults("blockedCount", "blockedHistory"),
          (storageItems) => {
            const history = storageItems.blockedHistory || [];
            const historyIds = new Set(history.map((h) => h.id));
            const uniqueSpams = newSpams.filter((s) => !historyIds.has(s.id));

            if (uniqueSpams.length === 0) return resolve();

            history.unshift(...uniqueSpams);
            let droppedCount = 0;
            if (history.length > 2000) {
              droppedCount = history.length - 2000;
              history.length = 2000;
            }

            chrome.storage.local.set(
              {
                blockedCount:
                  (storageItems.blockedCount || 0) +
                  uniqueSpams.length -
                  droppedCount,
                blockedHistory: history,
              },
              () => resolve(),
            );
          },
        );
      });
    })
    .catch((e) => {
      console.error("[X-Blocker] storage update error", e);
    });
}

async function handleBlockUser(screenName, isBlock) {
  try {
    const cookie = await chrome.cookies.get({
      url: "https://x.com",
      name: "ct0",
    });
    if (!cookie) {
      return { success: false, reason: "无法获取身份凭证，请确保已登录 X" };
    }

    const endpoint = isBlock ? "create.json" : "destroy.json";
    const headers = await getAuthHeaders();

    if (!headers) {
      return { success: false, reason: "尚未获取到授权 Token，请先浏览 X 页面并刷新重试" };
    }

    headers["x-csrf-token"] = cookie.value;
    headers["content-type"] = "application/x-www-form-urlencoded";

    const response = await fetch(`https://x.com/i/api/1.1/blocks/${endpoint}`, {
      method: "POST",
      headers,
      body: `screen_name=${encodeURIComponent(screenName)}`,
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
