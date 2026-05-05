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

function isContextValid() {
    try {
        return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
        return false;
    }
}

async function safeStorageGet(defaults) {
    if (!isContextValid()) { contextValid = false; return defaults; }
    try {
        return await chrome.storage.local.get(defaults);
    } catch (e) {
        contextValid = false;
        return defaults;
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

function parseKeywords(text) {
    if (!text) return [];
    return text.split('\n')
        .map(k => k.replace(invisibleCharsRegex, '').trim().toLowerCase())
        .filter(Boolean);
}

async function mergeKeywords() {
    const items = await safeStorageGet({
        keywords: '',
        cloudEnabled: true,
        cloudKeywords: ''
    });

    const userKws = parseKeywords(items.keywords);
    const cloudKws = items.cloudEnabled ? parseKeywords(items.cloudKeywords) : [];

    cloudEnabled = items.cloudEnabled;
    blockKeywords = [...new Set([...cloudKws, ...userKws])];
    
    if (blockKeywords.length > 0) {
        const escaped = blockKeywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        blockRegex = new RegExp(escaped.join('|'), 'i');
    } else {
        blockRegex = null;
    }
}

(async function init() {
    const items = await safeStorageGet({
        checkUsername: true,
        onlyComments: true,
        blockEmoji: false,
        enabled: true,
        blockedCount: 0,
        lastSyncTime: 0,
        cloudEnabled: true
    });

    checkUsername = items.checkUsername;
    onlyComments = items.onlyComments;
    blockEmoji = items.blockEmoji;
    filterEnabled = items.enabled;
    cloudEnabled = items.cloudEnabled;
    blockedCount = items.blockedCount || 0;

    await mergeKeywords();
    filterTweets();

    const observer = new MutationObserver(() => {
        if (!contextValid) { observer.disconnect(); return; }
        scheduleFilter();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();

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

    if (changes.cloudEnabled || changes.cloudKeywords || changes.keywords) {
        mergeKeywords().then(() => {
            filterVersion++;
            scheduleFilter();
        });
    } else if (needsFilter) {
        scheduleFilter();
    }
});

const style = document.createElement('style');
style.textContent = `
    .x-comment-blocker-hidden {
        display: none !important;
    }
`;
if (document.head) {
    document.head.appendChild(style);
}

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
    
    if (emojiRegex.test(node.textContent || '')) return true;
    
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

    const tweets = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    let newBlocks = 0;
    
    const urlMatch = window.location.pathname.match(/\/status\/(\d+)/i);
    const pageStatusId = urlMatch ? urlMatch[1] : null;
    const isStatusPage = !!pageStatusId;

    tweets.forEach(tweet => {
        const userNode = tweet.querySelector('[data-testid="User-Name"]');
        const textNode = tweet.querySelector('[data-testid="tweetText"]');

        const quickHash = (textNode ? textNode.textContent : "") + "|" + (userNode ? userNode.textContent : "") + "|" + filterVersion + "|" + isStatusPage;
        if (tweet.__cbxQuickHash === quickHash) {
            if (tweet.__cbxIsSpam) {
                if (!tweet.classList.contains('x-comment-blocker-hidden')) {
                    tweet.classList.add('x-comment-blocker-hidden');
                }
            } else {
                tweet.classList.remove('x-comment-blocker-hidden');
            }
            return;
        }
        tweet.__cbxQuickHash = quickHash;

        let tweetBody = textNode ? getTweetTextForKeywords(textNode) : "";
        let userName = userNode ? getTweetTextForKeywords(userNode) : "";
        
        let tweetHasEmoji = false;
        if (blockEmoji && isStatusPage && textNode) {
            tweetHasEmoji = hasEmoji(textNode);
        }

        let isSpam = false;
        let shouldCheck = filterEnabled && (blockRegex !== null || blockEmoji);
        
        if (onlyComments && !isStatusPage) {
            shouldCheck = false;
        }

        if (shouldCheck) {
            if (tweetBody) tweetBody = tweetBody.replace(invisibleCharsRegex, '');
            
            let isEmojiSpam = false;
            if (blockEmoji && isStatusPage) {
                let isMainTweet = false;
                
                if (pageStatusId) {
                    const timeNodes = tweet.querySelectorAll('time');
                    for (let timeEl of timeNodes) {
                        const link = timeEl.closest('a');
                        if (link) {
                            const hrefMatch = link.getAttribute('href').match(/\/status\/(\d+)/i);
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
                    let cleanUserName = userName.replace(/[\s_.-]+/g, '').replace(invisibleCharsRegex, '');
                    isSpam = blockRegex ? blockRegex.test(cleanUserName) : false;
                }
            }
        }

        tweet.__cbxIsSpam = isSpam;

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

function scheduleFilter() {
    if (!contextValid) return;
    filterTweets();
}
