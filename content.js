// --- State ---
let blockKeywords = [];
let checkUsername = true;
let filterEnabled = true;
let filterPending = false;
let blockedCount = 0;

// --- Load settings ---
chrome.storage.local.get({
    keywords: "关注我\n主页有惊喜\n空投\nBTC\ntg群",
    checkUsername: true,
    enabled: true,
    blockedCount: 0
}, (items) => {
    blockKeywords = items.keywords
        .split('\n')
        .map(k => k.trim().toLowerCase())
        .filter(k => k);
    checkUsername = items.checkUsername;
    filterEnabled = items.enabled;
    blockedCount = items.blockedCount || 0;

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

    // Persist count
    if (newBlocks > 0) {
        blockedCount += newBlocks;
        chrome.storage.local.set({ blockedCount: blockedCount });
    }
}

// --- Throttled filter using requestAnimationFrame ---
function scheduleFilter() {
    if (filterPending) return;
    filterPending = true;
    requestAnimationFrame(() => {
        filterTweets();
        filterPending = false;
    });
}