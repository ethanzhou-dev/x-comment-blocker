// --- State ---
let blockKeywords = [];
let blockRegex = null;
let checkUsername = true;
let filterEnabled = true;
let cloudEnabled = true;
let filterTimer = null;
let blockedCount = 0;
let contextValid = true;

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
        const userKws = items.keywords.split('\n').map(k => k.trim().toLowerCase()).filter(k => k);

        let cloudKws = [];
        if (items.cloudEnabled && items.cloudKeywords) {
            cloudKws = items.cloudKeywords.split('\n').map(k => k.trim().toLowerCase()).filter(k => k);
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

// --- Core filter logic ---
function filterTweets() {
    if (!contextValid || !filterEnabled || !blockRegex) return;

    const tweets = document.querySelectorAll('[data-testid="cellInnerDiv"]:not(.checked-by-script)');
    let newBlocks = 0;

    tweets.forEach(tweet => {
        tweet.classList.add('checked-by-script');

        const userNode = tweet.querySelector('[data-testid="User-Name"]');
        const textNode = tweet.querySelector('[data-testid="tweetText"]');

        // textContent is much faster than innerText as it doesn't trigger layout recalculations
        const tweetBody = textNode ? textNode.textContent : "";

        let isSpam = blockRegex.test(tweetBody);

        if (!isSpam && checkUsername) {
            const userName = userNode ? userNode.textContent : "";
            isSpam = blockRegex.test(userName);
        }

        if (isSpam) {
            tweet.style.display = 'none';
            newBlocks++;
        }
    });

    if (newBlocks > 0) {
        blockedCount += newBlocks;
        safeStorageSet({ blockedCount: blockedCount });
    }
}

// --- Throttled filter ---
function scheduleFilter() {
    if (!contextValid) return;
    if (filterTimer) clearTimeout(filterTimer);
    // Use setTimeout for debouncing instead of rAF to prevent excessive matching
    filterTimer = setTimeout(() => {
        filterTweets();
    }, 150); 
}
