const CLOUD_KEYWORDS_URL = 'https://api.github.com/repos/ethanzhou-dev/x-comment-blocker/contents/keywords.txt';
const SYNC_INTERVAL_MINUTES = 360;
const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60 * 1000;
const invisibleCharsRegex = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

function parseKeywords(text) {
    if (!text) return [];
    return text.split('\n')
        .map(k => k.replace(invisibleCharsRegex, '').trim().toLowerCase())
        .filter(Boolean);
}

async function syncCloudKeywords() {
    const { cloudEnabled } = await chrome.storage.local.get({ cloudEnabled: true });
    if (!cloudEnabled) return false;

    try {
        const headers = { 'Accept': 'application/vnd.github.v3.raw' };
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

        const text = await resp.text();
        const newETag = resp.headers.get('ETag') || '';

        const cloudList = parseKeywords(text);
        await chrome.storage.local.set({
            cloudKeywords: cloudList.join('\n'),
            cloudETag: newETag,
            lastSyncTime: Date.now()
        });
        return true;
    } catch (e) {
        return false;
    }
}