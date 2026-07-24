/* exported SYNC_INTERVAL_MS, syncCloudKeywords, parseKeywords, getStorageDefaults, invisibleCharsRegex, SYNC_INTERVAL_MINUTES */
const CLOUD_KEYWORDS_URL =
  'https://api.github.com/repos/ethanzhou-dev/x-comment-blocker/contents/keywords.txt';
const SYNC_INTERVAL_MINUTES = 360;
const SYNC_INTERVAL_MS = SYNC_INTERVAL_MINUTES * 60 * 1000;
const invisibleCharsRegex = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

const STORAGE_DEFAULTS = {
  keywords: '',
  cloudEnabled: true,
  cloudKeywords: '',
  checkUsername: true,
  onlyComments: true,
  blockSpecialChars: false,
  blockEmoji: false,
  enabled: true,
  blockedCount: 0,
  blockedHistory: [],
  lastSyncTime: 0,
  syncStatus: '',
  syncError: '',
  cloudETag: '',
  blockedUsersOnX: [],
  historyFilterReason: 'all',
  autoBlockKeywords: [],
};

function getStorageDefaults(...keys) {
  const defaults = {};
  for (const key of keys) {
    if (key in STORAGE_DEFAULTS) {
      const val = STORAGE_DEFAULTS[key];
      defaults[key] = Array.isArray(val) ? [] : val;
    }
  }
  return defaults;
}

function parseKeywords(text) {
  if (!text) return [];
  return text
    .split('\n')
    .map((k) => {
      const trimmed = k.replace(invisibleCharsRegex, '').trim();
      if (!trimmed) return '';
      if (trimmed.length >= 3 && trimmed.startsWith('/') && /\/[a-zA-Z]*$/.test(trimmed)) {
        return trimmed;
      }
      return trimmed.toLowerCase();
    })
    .filter(Boolean);
}

async function syncCloudKeywords() {
  const { cloudEnabled } = await chrome.storage.local.get(getStorageDefaults('cloudEnabled'));
  if (!cloudEnabled) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = { Accept: 'application/vnd.github.v3.raw' };
    const { cloudETag } = await chrome.storage.local.get(getStorageDefaults('cloudETag'));
    if (cloudETag) {
      headers['If-None-Match'] = cloudETag;
    }

    const resp = await fetch(CLOUD_KEYWORDS_URL, {
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });

    if (resp.status === 304) {
      await chrome.storage.local.set({
        lastSyncTime: Date.now(),
        syncStatus: 'ok',
        syncError: '',
      });
      return true;
    }
    if (resp.status === 403 || resp.status === 429) {
      await chrome.storage.local.set({
        syncStatus: 'error',
        syncError: 'API 请求限流，请稍后重试',
      });
      return false;
    }
    if (!resp.ok) {
      await chrome.storage.local.set({
        syncStatus: 'error',
        syncError: `HTTP ${resp.status}`,
      });
      return false;
    }

    const text = await resp.text();
    const newETag = resp.headers.get('ETag') || '';

    const cloudList = parseKeywords(text);
    await chrome.storage.local.set({
      cloudKeywords: cloudList.join('\n'),
      cloudETag: newETag,
      lastSyncTime: Date.now(),
      syncStatus: 'ok',
      syncError: '',
    });
    return true;
  } catch (e) {
    const isTimeout = e.name === 'AbortError';
    await chrome.storage.local
      .set({
        syncStatus: 'error',
        syncError: isTimeout ? '同步超时，请检查网络' : '网络连接失败',
      })
      .catch(() => {});
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
