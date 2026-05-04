// --- State ---
let blockKeywords = [];
let blockRegex = null;
let checkUsername = true;
let onlyComments = true;
let blockEmoji = false;
let filterEnabled = true;
let cloudEnabled = true;
let filterTimer = null;
let blockedCount = 0;
let contextValid = true;
let filterVersion = 0;
const blockedHashes = new Set();
const invisibleCharsRegex = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

let emojiRegex;
try {
    emojiRegex = new RegExp('[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]', 'u');
} catch (e) {
    emojiRegex = /[\uD800-\uDBFF][\uDC00-\uDFFF]/;
}

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
    onlyComments: true,
    blockEmoji: false,
    enabled: true,
    blockedCount: 0,
    lastSyncTime: 0,
    cloudEnabled: true
}, (items) => {
    checkUsername = items.checkUsername;
    onlyComments = items.onlyComments;
    blockEmoji = items.blockEmoji;
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

    let needsFilter = false;

    if (changes.enabled) {
        filterEnabled = changes.enabled.newValue;
        needsFilter = true;
    }
    if (changes.checkUsername) {
        checkUsername = changes.checkUsername.newValue;
        needsFilter = true;
    }
    if (changes.onlyComments) {
        onlyComments = changes.onlyComments.newValue;
        needsFilter = true;
    }
    if (changes.blockEmoji) {
        blockEmoji = changes.blockEmoji.newValue;
        needsFilter = true;
    }

    if (needsFilter) {
        filterVersion++;
    }

    // Re-merge keywords when cloud toggle, cloud data, or user keywords change
    if (changes.cloudEnabled || changes.cloudKeywords || changes.keywords) {
        mergeKeywords(() => {
            filterVersion++;
            scheduleFilter();
        });
    } else if (needsFilter) {
        scheduleFilter();
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
function getTweetTextForKeywords(node) {
    if (!node) return "";
    let result = "";
    for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
            result += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
            if (child.tagName.toLowerCase() === 'img' && child.alt) {
                result += child.alt;
            } else {
                result += getTweetTextForKeywords(child);
            }
        }
    }
    return result;
}

function hasEmoji(node) {
    if (!node) return false;
    
    // Check raw text content for native emojis
    if (emojiRegex.test(node.textContent || '')) return true;
    
    // Check all images within the node for twemojis
    const imgs = node.querySelectorAll('img');
    for (let img of imgs) {
        const src = img.src || '';
        if (src.includes('emoji') || src.includes('twemoji')) return true;
        if (img.alt && emojiRegex.test(img.alt)) return true;
    }
    return false;
}

function filterTweets() {
    if (!contextValid) return;

    // We check all cells because virtual lists (like Twitter's) recycle DOM nodes.
    const tweets = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    let newBlocks = 0;
    
    const isStatusPage = /\/[^/]+\/status\/\d+/i.test(window.location.pathname);

    tweets.forEach(tweet => {
        const userNode = tweet.querySelector('[data-testid="User-Name"]');
        const textNode = tweet.querySelector('[data-testid="tweetText"]');

        let tweetBody = textNode ? getTweetTextForKeywords(textNode) : "";
        let userName = userNode ? getTweetTextForKeywords(userNode) : "";
        
        let tweetHasEmoji = false;
        if (blockEmoji && isStatusPage && textNode) {
            tweetHasEmoji = hasEmoji(textNode);
        }
        
        // Cache key based on text, username, filterVersion, and page type
        const cacheKey = tweetBody + "|" + userName + "|" + filterVersion + "|" + isStatusPage + "|" + tweetHasEmoji;
        if (tweet.__cbxHash === cacheKey) {
            return; // Content hasn't changed, skip re-evaluating
        }
        tweet.__cbxHash = cacheKey;

        let isSpam = false;
        let shouldCheck = filterEnabled && (blockRegex !== null || blockEmoji);
        
        if (onlyComments && !isStatusPage) {
            shouldCheck = false;
        }

        if (shouldCheck) {
            if (tweetBody) tweetBody = tweetBody.replace(invisibleCharsRegex, '');
            
            let isEmojiSpam = false;
            // 屏蔽Emoji功能：强制只在评论区(isStatusPage)生效，且仅检测推文正文
            if (blockEmoji && isStatusPage) {
                // 判断是否是当前详情页的主推文，避免误伤
                let isMainTweet = false;
                const urlMatch = window.location.pathname.match(/\/status\/(\d+)/i);
                const pageStatusId = urlMatch ? urlMatch[1] : null;
                
                if (pageStatusId) {
                    const timeNodes = tweet.querySelectorAll('time');
                    for (let timeEl of timeNodes) {
                        const link = timeEl.closest('a');
                        if (link) {
                            const hrefMatch = link.getAttribute('href').match(/\/status\/(\d+)/i);
                            // 只要该推文区域里有任何时间链接指向当前页面的 ID，就当做是主推文放行
                            if (hrefMatch && hrefMatch[1] === pageStatusId) {
                                isMainTweet = true;
                                break;
                            }
                        }
                    }
                }
                
                if (!isMainTweet && tweetHasEmoji) {
                    isEmojiSpam = true;
                }
            }
            
            if (isEmojiSpam) {
                isSpam = true;
            } else {
                isSpam = blockRegex ? blockRegex.test(tweetBody) : false;

                if (!isSpam && checkUsername && userName) {
                    userName = userName.replace(invisibleCharsRegex, '');
                    isSpam = blockRegex ? blockRegex.test(userName) : false;
                }
            }
        }

        if (isSpam) {
            if (!tweet.classList.contains('x-comment-blocker-hidden')) {
                tweet.classList.add('x-comment-blocker-hidden');
            }
            const stableHash = tweetBody + "|" + userName;
            if (!blockedHashes.has(stableHash)) {
                blockedHashes.add(stableHash);
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

// --- Instant filter ---
// We do not use requestAnimationFrame here anymore. Running synchronously inside the MutationObserver 
// microtask ensures elements are hidden *before* the browser calculates layout or restores scroll position,
// fixing the bug where the page jumps down when returning from a clicked comment.
function scheduleFilter() {
    if (!contextValid) return;
    filterTweets();
}
