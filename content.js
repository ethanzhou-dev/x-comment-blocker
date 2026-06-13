let blockRegex = null;
let lastKeywordsKey = '';
let checkUsername = true;
let onlyComments = true;
let blockSpecialChars = true;
let blockEmojiThreshold = 10;
let filterEnabled = true;
let filterTimer = null;
let filterVersion = 0;
let lastUrl = location.href;
const blockedHashes = new Set();
const MAX_HASHES = 5000;
const emojiRegex = new RegExp('[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]', 'u');
const spamCharsRegex = /[\u02B0-\u02FF\u0F00-\u0FFF\u1D00-\u1D7F\u1D80-\u1DBF\u2070-\u209F\u2100-\u2BFF\uA980-\uA9DF\uAA00-\uAADF\u{13000}-\u{1342F}\u{1D400}-\u{1D7FF}]/u;

function clampEmojiThreshold(value) {
    if (value === '') return 10;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 10;
    return Math.min(100, Math.max(0, Math.round(parsed)));
}

function resolveEmojiThreshold(items) {
    if (items.blockEmojiThreshold !== null && items.blockEmojiThreshold !== undefined) {
        return clampEmojiThreshold(items.blockEmojiThreshold);
    }
    if (items.blockEmoji) return 0;
    if (items.blockEmojiRatio) return 10;
    return 100;
}

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
            blockEmojiRatio: true,
            blockEmojiThreshold: null,
            enabled: true,
            blockedCount: 0,
            lastSyncTime: 0,
            cloudEnabled: true
        });

        checkUsername = items.checkUsername;
        onlyComments = items.onlyComments;
        blockSpecialChars = items.blockSpecialChars;
        blockEmojiThreshold = resolveEmojiThreshold(items);
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
    if (changes.blockEmojiThreshold) {
        blockEmojiThreshold = clampEmojiThreshold(changes.blockEmojiThreshold.newValue);
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

function getEmojiRatio(node) {
    if (!node) return 0;

    const text = getTweetTextForKeywords(node)
        .replace(invisibleCharsRegex, '')
        .replace(/\s+/g, '');
    const chars = Array.from(text);
    if (chars.length === 0) return 0;

    const emojiCount = chars.filter(char => emojiRegex.test(char)).length;
    return emojiCount / chars.length;
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
    const isStatusPage = !!pageStatusId && !isPhotoVideoOverlay;

    tweets.forEach(tweet => {
        const userNode = tweet.querySelector('[data-testid="User-Name"]');
        const textNode = tweet.querySelector('[data-testid="tweetText"]');
        const quickText = textNode ? getTweetTextForKeywords(textNode) : "";

        const quickHash = quickText + "|" + (userNode ? getTweetTextForKeywords(userNode) : "") + "|" + filterVersion + "|" + isStatusPage;
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
        let shouldCheck = filterEnabled && (blockRegex !== null || blockEmojiThreshold < 100 || blockSpecialChars);
        let blockReason = "";
        
        if (shouldCheck && onlyComments && !isStatusPage) {
            shouldCheck = false;
        }

        let isMainTweet = false;
        let tweetBody = "";
        let userName = "";
        let stableHandle = "";

        if (shouldCheck && isStatusPage && pageStatusId) {
            const timeNodes = tweet.querySelectorAll('time');
            if (timeNodes.length === 0) {
                tweet.__cbxQuickHash = ""; 
                return;
            }
            for (let timeEl of timeNodes) {
                const link = timeEl.closest('a');
                if (link) {
                    const href = link.getAttribute('href');
                    if (href) {
                        const hrefMatch = href.match(/\/status\/(\d+)/i);
                        if (hrefMatch && hrefMatch[1] === pageStatusId) {
                            isMainTweet = true;
                            break;
                        }
                    }
                }
            }
        }
        
        if (shouldCheck && onlyComments && isMainTweet) {
            shouldCheck = false;
        }

        if (shouldCheck) {
            tweetBody = quickText;
            userName = userNode ? getTweetTextForKeywords(userNode) : "";
            
            if (userNode) {
                const handleLink = userNode.querySelector('a[href^="/"]');
                if (handleLink) {
                    stableHandle = (handleLink.getAttribute('href') || "").toLowerCase();
                }
            }
            
            if (tweetBody) tweetBody = tweetBody.replace(invisibleCharsRegex, '');
            
            let isEmojiSpam = false;
            let isSpecialCharSpam = false;
            
            if (isStatusPage && !isMainTweet) {
                if (textNode && getEmojiRatio(textNode) > blockEmojiThreshold / 100) {
                    isEmojiSpam = true;
                    blockReason = "Emoji过多屏蔽";
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
            const normalizedBody = quickText.replace(invisibleCharsRegex, '').replace(/\s+/g, ' ').trim();
            const stableHash = normalizedBody + "|" + stableHandle;
            if (!blockedHashes.has(stableHash)) {
                if (blockedHashes.size >= MAX_HASHES) blockedHashes.clear();
                blockedHashes.add(stableHash);
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