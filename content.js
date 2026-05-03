// --- State ---
let blockKeywords = [];
let blockRegex = null;
let checkUsername = true;
let filterEnabled = true;
let cloudEnabled = true;
let filterTimer = null;
let blockedCount = 0;
let contextValid = true;
const blockedHashes = new Set();
const invisibleCharsRegex = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

// --- Check if extension context is still valid ---
function isContextValid() {
    try {
        return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}

// --- Safe wrapper for chrome.storage calls ---
function safeStorageGet(defaults, callback) {
    if (!isContextValid()) { contextValid = false; return; }
    try {
        chrome.storage.local.get(defaults, callback);
    } catch (e) {
        contextValid = false;
    }
}

function safeStorageSet(data) {
    if (!isContextValid()) { contextValid = false; return; }
    try {
        chrome.storage.local.set(data);
    } catch (e) {
        contextValid = false;
    }
}

// --- Rebuild keyword list from storage ---
function mergeKeywords(callback) {
    safeStorageGet({
        keywords: '',
        cloudEnabled: true,
        cloudKeywords: ''
    }, (items) => {
        const userKws = items.keywords.split('\n')
            .map(k => k.replace(invisibleCharsRegex, '').trim().toLowerCase())
            .filter(k => k);

        let cloudKws = [];
        if (items.cloudEnabled && items.cloudKeywords) {
            cloudKws = items.cloudKeywords.split('\n')
                .map(k => k.replace(invisibleCharsRegex, '').trim().toLowerCase())
                .filter(k => k);
        }

        cloudEnabled = items.cloudEnabled;
        blockKeywords = [...new Set([...cloudKws, ...userKws])];
        
        if (blockKeywords.length > 0) {
            // Escape special regex characters and join with OR
            const escaped = blockKeywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            blockRegex = new RegExp(escaped.join('|'), 'i');
        } else {
            blockRegex = null;
        }

        if (callback) callback();
    });
}

// --- Load settings ---
safeStorageGet({
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
        // Initial scan
        filterTweets();

        // Observe DOM mutations with a setTimeout debounce
        const observer = new MutationObserver(() => {
            if (!contextValid) { observer.disconnect(); return; }
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
    if (!isContextValid()) return;
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

// --- Inject CSS for hidden comments ---
const style = document.createElement('style');
style.textContent = `
    .x-comment-blocker-hidden {
        display: none !important;
    }
`;
if (document.head) {
    document.head.appendChild(style);
}

// --- Core filter logic ---
function filterTweets() {
    if (!contextValid || !filterEnabled || !blockRegex) return;

    // We check all cells because virtual lists (like Twitter's) recycle DOM nodes.
    const tweets = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    let newBlocks = 0;

    tweets.forEach(tweet => {
        const userNode = tweet.querySelector('[data-testid="User-Name"]');
        const textNode = tweet.querySelector('[data-testid="tweetText"]');

        let tweetBody = textNode ? textNode.textContent : "";
        let userName = userNode ? userNode.textContent : "";
        
        // Cache key based on text and username to quickly skip unchanged recycled elements
        const cacheKey = tweetBody + "|" + userName;
        if (tweet.__cbxHash === cacheKey) {
            return; // Content hasn't changed, skip re-evaluating
        }
        tweet.__cbxHash = cacheKey;

        if (tweetBody) tweetBody = tweetBody.replace(invisibleCharsRegex, '');
        let isSpam = blockRegex.test(tweetBody);

        if (!isSpam && checkUsername && userName) {
            userName = userName.replace(invisibleCharsRegex, '');
            isSpam = blockRegex.test(userName);
        }

        if (isSpam) {
            if (!tweet.classList.contains('x-comment-blocker-hidden')) {
                tweet.classList.add('x-comment-blocker-hidden');
            }
            if (!blockedHashes.has(cacheKey)) {
                blockedHashes.add(cacheKey);
                newBlocks++;
            }
        } else {
            tweet.classList.remove('x-comment-blocker-hidden');
        }
    });

    if (newBlocks > 0) {
        blockedCount += newBlocks;
        safeStorageSet({ blockedCount: blockedCount });
    }
}

// --- Throttled filter ---
let filterRequested = false;
function scheduleFilter() {
    if (!contextValid) return;
    
    // Use requestAnimationFrame to process immediately before the next render.
    // This avoids visual flashing of blocked comments.
    if (!filterRequested) {
        filterRequested = true;
        requestAnimationFrame(() => {
            filterTweets();
            filterRequested = false;
        });
    }
}
