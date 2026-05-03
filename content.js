// --- Config ---
const CLOUD_KEYWORDS_URL = 'https://api.github.com/repos/ethanzhou-dev/x-comment-blocker/contents/keywords.txt';
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// --- State ---
let blockKeywords = [];
let checkUsername = true;
let filterEnabled = true;
let cloudEnabled = true;
let filterPending = false;
let blockedCount = 0;

// --- Rebuild keyword list from storage ---
function mergeKeywords(callback) {
    chrome.storage.local.get({
        keywords: '',
        cloudEnabled: true,
        cloudKeywords: ''
    }, (items) => {
        const userKws = items.keywords.split('\n').map(k => k.trim().toLowerCase()).filter(k => k);

        let cloudKws = [];
        if (items.cloudEnabled && items.cloudKeywords) {
            cloudKws = items.cloudKeywords.split('\n').map(k => k.trim().toLowerCase()).filter(k => k);
        }

        cloudEnabled = items.cloudEnabled;
        blockKeywords = [...new Set([...cloudKws, ...userKws])];
        if (callback) callback();
    });
}

// --- Load settings ---
chrome.storage.local.get({
    checkUsername: true,
    enabled: true,
    blockedCount: 0,
    lastSyncTime: 0,
    cloudEnabled: true
}, (items) => {
    checkUsername = items.checkUsername;
    filterEnabled = items.enabled;
    cloudEnabled = items.cloudEnabled;
    blockedCount = items.blockedCount || 0;

    mergeKeywords(() => {
        // Auto-sync cloud keywords if enabled and interval expired
        if (cloudEnabled && (!items.lastSyncTime || (Date.now() - items.lastSyncTime > SYNC_INTERVAL_MS))) {
            fetchCloudKeywords();
        }

        // Initial scan
        filterTweets();

        // Observe DOM mutations with rAF throttle
        const observer = new MutationObserver(() => {
            scheduleFilter();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    });
});

// --- React to settings changes from popup ---
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.enabled) {
        filterEnabled = changes.enabled.newValue;
    }
    if (changes.checkUsername) {
        checkUsername = changes.checkUsername.newValue;
    }

    // Re-merge keywords when cloud toggle, cloud data, or user keywords change
    if (changes.cloudEnabled || changes.cloudKeywords || changes.keywords) {
        mergeKeywords();
    }
});

// --- Decode base64 with UTF-8 support ---
function decodeBase64UTF8(base64) {
    const raw = atob(base64.replace(/\n/g, ''));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
}

// --- Fetch cloud keywords and refresh filter ---
async function fetchCloudKeywords() {
    try {
        const headers = { 'Accept': 'application/vnd.github.v3+json' };
        const stored = await chrome.storage.local.get({ cloudETag: '' });
        if (stored.cloudETag) {
            headers['If-None-Match'] = stored.cloudETag;
        }

        const resp = await fetch(CLOUD_KEYWORDS_URL, { headers, cache: 'no-store' });

        if (resp.status === 304 || resp.status === 403 || resp.status === 429) {
            if (resp.status === 304) {
                chrome.storage.local.set({ lastSyncTime: Date.now() });
            }
            return;
        }

        if (!resp.ok) return;

        const json = await resp.json();
        const text = decodeBase64UTF8(json.content);
        const newETag = resp.headers.get('ETag') || '';

        const cloudList = text.split('\n').map(k => k.trim()).filter(k => k);
        chrome.storage.local.set({
            cloudKeywords: cloudList.join('\n'),
            cloudETag: newETag,
            lastSyncTime: Date.now()
        });

        // mergeKeywords will be triggered automatically by storage.onChanged
    } catch (e) {
        // Silently fail, use cached keywords
    }
}

// --- Core filter logic ---
function filterTweets() {
    if (!filterEnabled || blockKeywords.length === 0) return;

    const tweets = document.querySelectorAll('[data-testid="cellInnerDiv"]:not(.checked-by-script)');
    let newBlocks = 0;

    tweets.forEach(tweet => {
        tweet.classList.add('checked-by-script');

        const userNode = tweet.querySelector('[data-testid="User-Name"]');
        const textNode = tweet.querySelector('[data-testid="tweetText"]');

        const tweetBody = textNode ? textNode.innerText.toLowerCase() : "";

        let isSpam = blockKeywords.some(keyword => tweetBody.includes(keyword));

        if (!isSpam && checkUsername) {
            const userName = userNode ? userNode.innerText.toLowerCase() : "";
            isSpam = blockKeywords.some(keyword => userName.includes(keyword));
        }

        if (isSpam) {
            tweet.style.display = 'none';
            newBlocks++;
        }
    });

    if (newBlocks > 0) {
        blockedCount += newBlocks;
        chrome.storage.local.set({ blockedCount: blockedCount });
    }
}

// --- Throttled filter ---
function scheduleFilter() {
    if (filterPending) return;
    filterPending = true;
    requestAnimationFrame(() => {
        filterTweets();
        filterPending = false;
    });
}