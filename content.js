let blockKeywords = [];
let blockRegex = null;
let checkUsername = true;
let onlyComments = true;
let blockSpecialChars = true;
let blockEmoji = false;
let filterEnabled = true;
let cloudEnabled = true;
let filterTimer = null;
let blockedCount = 0;
let filterVersion = 0;
const blockedHashes = new Set();
const emojiRegex = new RegExp('[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]', 'u');
const spamCharsRegex = /[\u02B0-\u02FF\u1D00-\u1D7F\u1D80-\u1DBF\u2070-\u209F\u2980-\u2AFF\u{13000}-\u{1342F}]{3,}/u;

async function mergeKeywords() {
    try {
        const items = await chrome.storage.local.get({
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
    } catch(e) {
        // Extension context invalidated
    }
}

(async function init() {
    try {
        const items = await chrome.storage.local.get({
            checkUsername: true,
            onlyComments: true,
            blockSpecialChars: true,
            blockEmoji: false,
            enabled: true,
            blockedCount: 0,
            lastSyncTime: 0,
            cloudEnabled: true
        });

        checkUsername = items.checkUsername;
        onlyComments = items.onlyComments;
        blockSpecialChars = items.blockSpecialChars;
        blockEmoji = items.blockEmoji;
        filterEnabled = items.enabled;
        cloudEnabled = items.cloudEnabled;
        blockedCount = items.blockedCount || 0;

        await mergeKeywords();
        filterTweets();

        const observer = new MutationObserver((mutations) => {
            if (!chrome.runtime?.id) { observer.disconnect(); return; }
            
            const affectedTweets = new Set();

            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.getAttribute('data-testid') === 'cellInnerDiv') {
                            affectedTweets.add(node);
                        } else if (node.querySelector) {
                            const innerTweets = node.querySelectorAll('[data-testid="cellInnerDiv"]');
                            innerTweets.forEach(t => affectedTweets.add(t));
                        }
                    }
                }
                
                if (mutation.target) {
                    const el = mutation.target.nodeType === Node.ELEMENT_NODE ? mutation.target : mutation.target.parentElement;
                    if (el && el.closest) {
                        const closestTweet = el.closest('[data-testid="cellInnerDiv"]');
                        if (closestTweet) {
                            affectedTweets.add(closestTweet);
                        }
                    }
                }
            }
            
            if (affectedTweets.size > 0) {
                filterTweets(Array.from(affectedTweets));
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    } catch(e) {}
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
    
    if (changes.blockedCount) {
        blockedCount = changes.blockedCount.newValue || 0;
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

function filterTweets(specificTweets = null) {
    if (!chrome.runtime?.id) return;

    const tweets = specificTweets || document.querySelectorAll('[data-testid="cellInnerDiv"]');
    if (tweets.length === 0 && !specificTweets) return; 

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
        let shouldCheck = filterEnabled && (blockRegex !== null || blockEmoji || blockSpecialChars);
        
        if (onlyComments && !isStatusPage) {
            shouldCheck = false;
        }

        if (shouldCheck) {
            if (tweetBody) tweetBody = tweetBody.replace(invisibleCharsRegex, '');
            
            let isEmojiSpam = false;
            let isSpecialCharSpam = false;
            if ((blockEmoji || blockSpecialChars) && isStatusPage) {
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
                
                if (!isMainTweet) {
                    if (blockEmoji && tweetHasEmoji) {
                        isEmojiSpam = true;
                    }
                    if (blockSpecialChars && textNode && spamCharsRegex.test(textNode.textContent)) {
                        isSpecialCharSpam = true;
                    }
                }
            }
            
            if (isEmojiSpam || isSpecialCharSpam) {
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
        chrome.storage.local.set({ blockedCount: blockedCount }).catch(()=>{});
    }
}

function scheduleFilter() {
    if (!chrome.runtime?.id) return;
    filterTweets();
}