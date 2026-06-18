let blockRegex = null;
let lastKeywordsKey = '';
let checkUsername = true;
let onlyComments = true;
let blockSpecialChars = true;
let blockEmoji = false;
let filterEnabled = true;
let filterTimer = null;
let filterVersion = 0;
let lastUrl = location.href;
const blockedHashes = new Map();
const MAX_HASHES = 5000;
const HASH_TTL_MS = 30 * 60 * 1000;
let pruneCounter = 0;
const emojiRegex = new RegExp('[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]', 'u');
const spamCharsRegex = /[\u02B0-\u02FF\u0F00-\u0FFF\u1D00-\u1D7F\u1D80-\u1DBF\u2070-\u209F\u2100-\u2BFF\uA980-\uA9DF\uAA00-\uAADF\u{13000}-\u{1342F}\u{1D400}-\u{1D7FF}]/u;

async function mergeKeywords() {
    try {
        const items = await chrome.storage.local.get({
            keywords: '',
            cloudEnabled: true,
            cloudKeywords: ''
        });

        const userKws = parseKeywords(items.keywords);
        const cloudKws = items.cloudEnabled ? parseKeywords(items.cloudKeywords) : [];

        const blockKeywords = [...new Set([...cloudKws, ...userKws])];
        
        const newKey = blockKeywords.join('\n');
        if (newKey === lastKeywordsKey) return;
        lastKeywordsKey = newKey;

        if (blockKeywords.length > 0) {
            const escaped = blockKeywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
            blockRegex = new RegExp(escaped.join('|'), 'i');
        } else {
            blockRegex = null;
        }
    } catch(e) {
        console.debug('[X-Blocker] mergeKeywords error:', e.message);
    }
}

(async function init() {
    try {
        const items = await chrome.storage.local.get({
            checkUsername: true,
            onlyComments: true,
            blockSpecialChars: true,
            blockEmoji: false,
            enabled: true
        });

        checkUsername = items.checkUsername;
        onlyComments = items.onlyComments;
        blockSpecialChars = items.blockSpecialChars;
        blockEmoji = items.blockEmoji;
        filterEnabled = items.enabled;

        await mergeKeywords();
        filterTweets();

        let pendingTweets = new Set();
        let rafScheduled = false;

        const observer = new MutationObserver((mutations) => {
            if (!chrome.runtime?.id) { observer.disconnect(); return; }

            if (location.href !== lastUrl) {
                lastUrl = location.href;
                blockedHashes.clear();
            }

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.getAttribute('data-testid') === 'cellInnerDiv') {
                            pendingTweets.add(node);
                        } else if (node.querySelector) {
                            const innerTweets = node.querySelectorAll('[data-testid="cellInnerDiv"]');
                            innerTweets.forEach(t => pendingTweets.add(t));
                        }
                    }
                }
                
                if (mutation.target) {
                    const el = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
                    if (el && el.closest) {
                        const closestTweet = el.closest('[data-testid="cellInnerDiv"]');
                        if (closestTweet) {
                            pendingTweets.add(closestTweet);
                        }
                    }
                }
            }
            
            if (pendingTweets.size > 0 && !rafScheduled) {
                rafScheduled = true;
                requestAnimationFrame(() => {
                    filterTweets(Array.from(pendingTweets));
                    pendingTweets.clear();
                    rafScheduled = false;
                });
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    } catch(e) {
        console.debug('[X-Blocker] init error:', e.message);
    }
})();

chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !chrome.runtime?.id) return;

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
    if (changes.blockSpecialChars) {
        blockSpecialChars = changes.blockSpecialChars.newValue;
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

function getTweetTextForKeywords(node) {
    if (!node) return "";
    let text = "";
    function traverse(n) {
        if (n.nodeType === Node.TEXT_NODE) {
            text += n.textContent;
        } else if (n.nodeType === Node.ELEMENT_NODE) {
            if (n.tagName.toLowerCase() === 'img' && n.alt) {
                text += n.alt;
            } else {
                for (let child of n.childNodes) {
                    traverse(child);
                }
            }
        }
    }
    traverse(node);
    return text;
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

function pruneOldHashes() {
    if (++pruneCounter < 100) return;
    pruneCounter = 0;
    const now = Date.now();
    for (const [hash, time] of blockedHashes) {
        if (now - time > HASH_TTL_MS) {
            blockedHashes.delete(hash);
        }
    }
    if (blockedHashes.size >= MAX_HASHES) {
        const entries = [...blockedHashes.entries()].sort((a, b) => a[1] - b[1]);
        const deleteCount = Math.floor(entries.length / 4);
        for (let i = 0; i < deleteCount; i++) {
            blockedHashes.delete(entries[i][0]);
        }
    }
}

function filterTweets(specificTweets = null) {
    if (!chrome.runtime?.id) return;

    const tweets = specificTweets || document.querySelectorAll('[data-testid="cellInnerDiv"]');
    if (tweets.length === 0 && !specificTweets) return; 

    let newBlocks = 0;
    let newBlockedItems = [];
    
    const urlMatch = window.location.pathname.match(/\/status\/(\d+)/i);
    const pageStatusId = urlMatch ? urlMatch[1] : null;
    const isPhotoVideoOverlay = /\/status\/\d+\/(?:photo|video)\//i.test(window.location.pathname);

    tweets.forEach(tweet => {
        const userNode = tweet.querySelector('[data-testid="User-Name"]');
        const textNode = tweet.querySelector('[data-testid="tweetText"]');

        let isStatusPage = false;
        if (isPhotoVideoOverlay) {
            const isOverlayTweet = tweet.closest('[role="dialog"]') !== null;
            if (isOverlayTweet) {
                isStatusPage = true;
            } else {
                if (tweet.__cbxQuickHash) {
                    isStatusPage = tweet.__cbxQuickHash.endsWith("|true");
                } else {
                    isStatusPage = false;
                }
            }
        } else {
            isStatusPage = !!pageStatusId;
        }

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
        
        if (tweet.closest('[aria-hidden="true"]')) {
            return;
        }

        tweet.__cbxQuickHash = quickHash;

        let isSpam = false;
        let shouldCheck = filterEnabled && (blockRegex !== null || blockEmoji || blockSpecialChars);
        let blockReason = "";
        
        if (shouldCheck && onlyComments && !isStatusPage) {
            shouldCheck = false;
        }

        let isMainTweet = false;
        let tweetBody = "";
        let userName = "";
        let stableHandle = "";

        if (shouldCheck && isStatusPage && pageStatusId) {
            let currentTweetId = null;
            const timeNodes = tweet.querySelectorAll('time');
            
            for (let timeEl of timeNodes) {
                const link = timeEl.closest('a');
                if (link) {
                    const href = link.getAttribute('href');
                    const match = href ? href.match(/\/status\/(\d+)/i) : null;
                    if (match) {
                        currentTweetId = match[1];
                        break;
                    }
                }
            }

            if (currentTweetId === pageStatusId) {
                isMainTweet = true;
            } else if (!currentTweetId && tweet.querySelector('article')) {
                isMainTweet = true;
            }

            if (!tweet.querySelector('article')) {
                tweet.__cbxQuickHash = ""; 
                return;
            }
        }
        
        if (shouldCheck && onlyComments && isMainTweet) {
            shouldCheck = false;
        }

        if (shouldCheck) {
            tweetBody = textNode ? getTweetTextForKeywords(textNode) : "";
            userName = userNode ? getTweetTextForKeywords(userNode) : "";
            
            if (userNode) {
                const handleLink = userNode.querySelector('a[href^="/"]');
                if (handleLink) {
                    stableHandle = (handleLink.getAttribute('href') || "").toLowerCase();
                }
            }
            
            let tweetHasEmoji = false;
            if (blockEmoji && isStatusPage && textNode) {
                tweetHasEmoji = hasEmoji(textNode);
            }

            if (tweetBody) tweetBody = tweetBody.replace(invisibleCharsRegex, '');
            
            let isEmojiSpam = false;
            let isSpecialCharSpam = false;
            
            if (isStatusPage && !isMainTweet) {
                if (blockEmoji && tweetHasEmoji) {
                    isEmojiSpam = true;
                    blockReason = "表情屏蔽";
                }
                if (blockSpecialChars && textNode && spamCharsRegex.test(textNode.textContent)) {
                    isSpecialCharSpam = true;
                    if (!blockReason) blockReason = "特殊字符屏蔽";
                }
            }
            
            if (isEmojiSpam || isSpecialCharSpam) {
                isSpam = true;
            } else {
                isSpam = blockRegex ? blockRegex.test(tweetBody) : false;
                if (isSpam) {
                    blockReason = "内容屏蔽";
                }

                if (!isSpam && checkUsername && userName) {
                    let cleanUserName = userName.replace(/[\s_.-]+/g, '').replace(invisibleCharsRegex, '');
                    isSpam = blockRegex ? blockRegex.test(cleanUserName) : false;
                    if (isSpam) {
                        blockReason = "昵称屏蔽";
                    }
                }
            }
        }

        tweet.__cbxIsSpam = isSpam;

        if (isSpam) {
            if (!tweet.classList.contains('x-comment-blocker-hidden')) {
                tweet.classList.add('x-comment-blocker-hidden');
            }
            const normalizedBody = (textNode ? textNode.textContent : "").replace(invisibleCharsRegex, '').replace(/\s+/g, ' ').trim();
            const stableHash = normalizedBody + "|" + stableHandle;
            if (!blockedHashes.has(stableHash)) {
                blockedHashes.set(stableHash, Date.now());
                newBlocks++;
                newBlockedItems.push({
                    text: normalizedBody,
                    user: stableHandle || userName,
                    reason: blockReason,
                    time: Date.now()
                });
            }
        } else {
            tweet.classList.remove('x-comment-blocker-hidden');
        }
    });

    pruneOldHashes();

    if (newBlocks > 0) {
        chrome.storage.local.get({ blockedCount: 0, blockedHistory: [] }).then(items => {
            let history = items.blockedHistory;
            history.unshift(...newBlockedItems);
            if (history.length > 100) history.length = 100;
            chrome.storage.local.set({ 
                blockedCount: items.blockedCount + newBlocks,
                blockedHistory: history
            }).catch(()=>{});
        });
    }
}

function scheduleFilter() {
    if (!chrome.runtime?.id) return;
    if (filterTimer) cancelAnimationFrame(filterTimer);
    filterTimer = requestAnimationFrame(() => filterTweets());
}