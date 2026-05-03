// --- Config ---
const CLOUD_KEYWORDS_URL = 'https://api.github.com/repos/ethanzhou-dev/x-comment-blocker/contents/keywords.txt';
const ALARM_NAME = 'cloudKeywordSync';
const SYNC_INTERVAL_MINUTES = 360; // 6 hours

// --- Decode base64 with UTF-8 support ---
function decodeBase64UTF8(base64) {
    const raw = atob(base64.replace(/\n/g, ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
}

// --- Setup on install ---
chrome.runtime.onInstalled.addListener(() => {
    // Periodic cloud sync alarm
    chrome.alarms.create(ALARM_NAME, {
        delayInMinutes: 1,
        periodInMinutes: SYNC_INTERVAL_MINUTES
    });

    // Right-click context menu for quick keyword addition
    chrome.contextMenus.create({
        id: 'addToBlocklist',
        title: '添加「%s」到屏蔽词',
        contexts: ['selection'],
        documentUrlPatterns: ['*://*.twitter.com/*', '*://*.x.com/*']
    });
});

// --- Handle alarm ---
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        syncCloudKeywords();
    }
});

// --- Handle context menu click ---
chrome.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === 'addToBlocklist' && info.selectionText) {
        const keyword = info.selectionText.trim();
        if (!keyword) return;

        chrome.storage.local.get({ keywords: '' }, (items) => {
            const existing = items.keywords.split('\n').map(k => k.trim()).filter(k => k);
            if (!existing.includes(keyword)) {
                existing.push(keyword);
                chrome.storage.local.set({ keywords: existing.join('\n') });
            }
        });
    }
});

// --- Cloud keyword sync ---
async function syncCloudKeywords() {
    const { cloudEnabled } = await chrome.storage.local.get({ cloudEnabled: true });
    if (!cloudEnabled) return false;

    try {
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        const { cloudETag } = await chrome.storage.local.get({ cloudETag: '' });
        if (cloudETag) {
            headers['If-None-Match'] = cloudETag;
        }

        const resp = await fetch(CLOUD_KEYWORDS_URL, { headers, cache: 'no-store' });

        if (resp.status === 304) {
            await chrome.storage.local.set({ lastSyncTime: Date.now() });
            return true;
        }
        if (resp.status === 403 || resp.status === 429 || !resp.ok) return false;

        const json = await resp.json();
        const text = decodeBase64UTF8(json.content);
        const newETag = resp.headers.get('ETag') || '';

        const cloudList = text.split('\n').map(k => k.trim()).filter(k => k);
        await chrome.storage.local.set({
            cloudKeywords: cloudList.join('\n'),
            cloudETag: newETag,
            lastSyncTime: Date.now()
        });
        return true;
    } catch (e) {
        // Silently fail, use cached keywords
        return false;
    }
}

// --- Listen for manual sync requests from popup ---
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.action === 'manualSync') {
        syncCloudKeywords()
            .then((success) => sendResponse({ ok: success }))
            .catch(() => sendResponse({ ok: false }));
        return true; // async response
    }
});
