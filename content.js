// --- Config ---
const CLOUD_KEYWORDS_URL = 'https://raw.githubusercontent.com/ethanzhou-dev/x-comment-blocker/main/keywords.txt';
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// --- State ---
let blockKeywords = [];
let checkUsername = true;
let filterEnabled = true;
let filterPending = false;
let blockedCount = 0;

// --- Load settings and merge keyword lists ---
chrome.storage.local.get({
    keywords: '',
    checkUsername: true,
    enabled: true,
    blockedCount: 0,
    cloudKeywords: '',
    lastSyncTime: 0
}, (items) => {
    const userKeywords = items.keywords
        .split('\n')
        .map(k => k.trim().toLowerCase())
        .filter(k => k);

    const cloudKeywords = items.cloudKeywords
        ? items.cloudKeywords.split('\n').map(k => k.trim().toLowerCase()).filter(k => k)
        : [];

    // Merge and deduplicate
    blockKeywords = [...new Set([...cloudKeywords, ...userKeywords])];
    checkUsername = items.checkUsername;
    filterEnabled = items.enabled;
    blockedCount = items.blockedCount || 0;

    // Auto-sync cloud keywords if interval expired
    if (!items.lastSyncTime || (Date.now() - items.lastSyncTime > SYNC_INTERVAL_MS)) {
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

// --- Fetch cloud keywords and refresh filter ---
async function fetchCloudKeywords() {
    try {
        const resp = await fetch(CLOUD_KEYWORDS_URL + '?t=' + Date.now());
        if (!resp.ok) return;
        const text = await resp.text();

        const cloudList = text.split('\n').map(k => k.trim()).filter(k => k);
        chrome.storage.local.set({
            cloudKeywords: cloudList.join('\n'),
            lastSyncTime: Date.now()
        });

        // Re-merge with user keywords
        chrome.storage.local.get({ keywords: '' }, (items) => {
            const userKws = items.keywords.split('\n').map(k => k.trim().toLowerCase()).filter(k => k);
            const cloudKws = cloudList.map(k => k.toLowerCase());
            blockKeywords = [...new Set([...cloudKws, ...userKws])];
        });
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