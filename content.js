/* global getStorageDefaults, parseKeywords, invisibleCharsRegex */
let blockRegex = null;
let lastKeywordsKey = "";
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
const emojiRegex = new RegExp(
  "[\\p{Emoji_Presentation}\\p{Extended_Pictographic}]",
  "u",
);
/* eslint-disable no-misleading-character-class */
const spamCharsRegex =
  /[\u02B0-\u02FF\u0F00-\u0FFF\u1D00-\u1D7F\u1D80-\u1DBF\u2070-\u209F\u2100-\u2BFF\uA980-\uA9DF\uAA00-\uAADF\u{13000}-\u{1342F}\u{1D400}-\u{1D7FF}]/u;
/* eslint-enable no-misleading-character-class */

function isExtensionAlive() {
  return !!chrome.runtime?.id;
}

function matchesBlocklist(text) {
  return blockRegex ? blockRegex.test(text) : false;
}

async function mergeKeywords() {
  try {
    const items = await chrome.storage.local.get(
      getStorageDefaults("keywords", "cloudEnabled", "cloudKeywords"),
    );

    const userKws = parseKeywords(items.keywords);
    const cloudKws = items.cloudEnabled
      ? parseKeywords(items.cloudKeywords)
      : [];

    const blockKeywords = [...new Set([...cloudKws, ...userKws])];

    const newKey = blockKeywords.join("\n");
    if (newKey === lastKeywordsKey) return;
    lastKeywordsKey = newKey;

    if (blockKeywords.length > 0) {
      const escaped = blockKeywords.map((kw) =>
        kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      );
      blockRegex = new RegExp(escaped.join("|"), "i");
    } else {
      blockRegex = null;
    }
  } catch (e) {
    console.debug("[X-Blocker] mergeKeywords error:", e.message);
  }
}

(async function init() {
  try {
    const items = await chrome.storage.local.get(
      getStorageDefaults(
        "checkUsername",
        "onlyComments",
        "blockSpecialChars",
        "blockEmoji",
        "enabled",
      ),
    );

    checkUsername = items.checkUsername;
    onlyComments = items.onlyComments;
    blockSpecialChars = items.blockSpecialChars;
    blockEmoji = items.blockEmoji;
    filterEnabled = items.enabled;

    await mergeKeywords();
    filterTweets();

    const pendingTweets = new Set();

    const observer = new MutationObserver((mutations) => {
      if (!isExtensionAlive()) {
        observer.disconnect();
        return;
      }

      if (location.href !== lastUrl) {
        lastUrl = location.href;
        blockedHashes.clear();
      }

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.getAttribute("data-testid") === "cellInnerDiv") {
              pendingTweets.add(node);
            } else if (node.querySelector) {
              const innerTweets = node.querySelectorAll(
                '[data-testid="cellInnerDiv"]',
              );
              innerTweets.forEach((t) => pendingTweets.add(t));
            }
          }
        }

        if (mutation.target) {
          const el =
            mutation.target.nodeType === Node.ELEMENT_NODE
              ? mutation.target
              : mutation.target.parentElement;
          if (el && el.closest) {
            const closestTweet = el.closest('[data-testid="cellInnerDiv"]');
            if (closestTweet) {
              pendingTweets.add(closestTweet);
            }
          }
        }
      }

      if (pendingTweets.size > 0) {
        filterTweets(Array.from(pendingTweets));
        pendingTweets.clear();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  } catch (e) {
    console.debug("[X-Blocker] init error:", e.message);
  }
})();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !isExtensionAlive()) return;

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
      if (n.tagName.toLowerCase() === "img" && n.alt) {
        text += n.alt;
      } else {
        for (const child of n.childNodes) {
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

  if (emojiRegex.test(node.textContent || "")) return true;

  const imgs = node.querySelectorAll("img");
  for (const img of imgs) {
    const src = img.src || "";
    if (src.includes("emoji") || src.includes("twemoji")) return true;
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

function getPageContext() {
  const urlMatch = window.location.pathname.match(/\/status\/(\d+)/i);
  return {
    pageStatusId: urlMatch ? urlMatch[1] : null,
    isPhotoVideoOverlay: /\/status\/\d+\/(?:photo|video)\//i.test(
      window.location.pathname,
    ),
  };
}

function resolveStatusPage(tweet, pageContext) {
  if (pageContext.isPhotoVideoOverlay) {
    if (tweet.closest('[role="dialog"]') !== null) return true;
    if (tweet.__cbxQuickHash) return tweet.__cbxQuickHash.endsWith("|true");
    return false;
  }
  return !!pageContext.pageStatusId;
}

function checkIsMainTweet(tweet, pageStatusId) {
  const timeNodes = tweet.querySelectorAll("time");

  for (const timeEl of timeNodes) {
    const link = timeEl.closest("a");
    if (link) {
      const href = link.getAttribute("href");
      const match = href ? href.match(/\/status\/(\d+)/i) : null;
      if (match) {
        return match[1] === pageStatusId;
      }
    }
  }

  return !!tweet.querySelector("article");
}

function detectSpam(textNode, userNode, isStatusPage, isMainTweet) {
  const tweetBody = textNode
    ? getTweetTextForKeywords(textNode).replace(invisibleCharsRegex, "")
    : "";
  const userName = userNode ? getTweetTextForKeywords(userNode) : "";
  let stableHandle = "";

  if (userNode) {
    const handleLink = userNode.querySelector('a[href^="/"]');
    if (handleLink) {
      stableHandle = (handleLink.getAttribute("href") || "").toLowerCase();
    }
  }

  if (isStatusPage && !isMainTweet) {
    if (blockEmoji && textNode && hasEmoji(textNode)) {
      return { isSpam: true, blockReason: "表情屏蔽", userName, stableHandle };
    }
    if (
      blockSpecialChars &&
      textNode &&
      spamCharsRegex.test(textNode.textContent)
    ) {
      return {
        isSpam: true,
        blockReason: "特殊字符屏蔽",
        userName,
        stableHandle,
      };
    }
  }

  if (matchesBlocklist(tweetBody)) {
    return { isSpam: true, blockReason: "内容屏蔽", userName, stableHandle };
  }

  if (checkUsername && userName) {
    const cleanUserName = userName
      .replace(/[\s_.-]+/g, "")
      .replace(invisibleCharsRegex, "");
    if (matchesBlocklist(cleanUserName)) {
      return { isSpam: true, blockReason: "昵称屏蔽", userName, stableHandle };
    }
  }

  return { isSpam: false, blockReason: "", userName, stableHandle };
}

function recordBlocked(newBlocks, newBlockedItems) {
  if (newBlocks <= 0) return;
  chrome.storage.local
    .get(getStorageDefaults("blockedCount", "blockedHistory"))
    .then((items) => {
      const history = items.blockedHistory;
      history.unshift(...newBlockedItems);
      if (history.length > 100) history.length = 100;
      chrome.storage.local
        .set({
          blockedCount: items.blockedCount + newBlocks,
          blockedHistory: history,
        })
        .catch(() => {});
    });
}

function filterTweets(specificTweets = null) {
  if (!isExtensionAlive()) return;

  const tweets =
    specificTweets || document.querySelectorAll('[data-testid="cellInnerDiv"]');
  if (tweets.length === 0 && !specificTweets) return;

  let newBlocks = 0;
  const newBlockedItems = [];
  const pageContext = getPageContext();

  tweets.forEach((tweet) => {
    const userNode = tweet.querySelector('[data-testid="User-Name"]');
    const textNode = tweet.querySelector('[data-testid="tweetText"]');
    const isStatusPage = resolveStatusPage(tweet, pageContext);

    const quickHash =
      (textNode ? textNode.textContent : "") +
      "|" +
      (userNode ? userNode.textContent : "") +
      "|" +
      filterVersion +
      "|" +
      isStatusPage;
    if (tweet.__cbxQuickHash === quickHash) {
      if (tweet.__cbxIsSpam) {
        if (!tweet.classList.contains("x-comment-blocker-hidden")) {
          tweet.classList.add("x-comment-blocker-hidden");
        }
      } else {
        tweet.classList.remove("x-comment-blocker-hidden");
      }
      return;
    }

    if (tweet.closest('[aria-hidden="true"]')) return;
    tweet.__cbxQuickHash = quickHash;

    let shouldCheck =
      filterEnabled && (blockRegex !== null || blockEmoji || blockSpecialChars);
    if (shouldCheck && onlyComments && !isStatusPage) shouldCheck = false;

    let isMainTweet = false;
    if (shouldCheck && isStatusPage && pageContext.pageStatusId) {
      isMainTweet = checkIsMainTweet(tweet, pageContext.pageStatusId);

      if (!tweet.querySelector("article")) {
        tweet.__cbxQuickHash = "";
        return;
      }
    }

    if (shouldCheck && onlyComments && isMainTweet) shouldCheck = false;

    let isSpam = false;
    let blockReason = "";
    let userName = "";
    let stableHandle = "";

    if (shouldCheck) {
      const result = detectSpam(textNode, userNode, isStatusPage, isMainTweet);
      isSpam = result.isSpam;
      blockReason = result.blockReason;
      userName = result.userName;
      stableHandle = result.stableHandle;
    }

    tweet.__cbxIsSpam = isSpam;
    if (isSpam) {
      if (!tweet.classList.contains("x-comment-blocker-hidden")) {
        tweet.classList.add("x-comment-blocker-hidden");
      }
      const normalizedBody = (textNode ? textNode.textContent : "")
        .replace(invisibleCharsRegex, "")
        .replace(/\s+/g, " ")
        .trim();
      const stableHash = normalizedBody + "|" + stableHandle;
      if (!blockedHashes.has(stableHash)) {
        blockedHashes.set(stableHash, Date.now());
        newBlocks++;
        newBlockedItems.push({
          text: normalizedBody,
          user: stableHandle || userName,
          reason: blockReason,
          time: Date.now(),
        });
      }
    } else {
      tweet.classList.remove("x-comment-blocker-hidden");
    }
  });

  pruneOldHashes();
  recordBlocked(newBlocks, newBlockedItems);
}

function scheduleFilter() {
  if (!isExtensionAlive()) return;
  if (filterTimer) cancelAnimationFrame(filterTimer);
  filterTimer = requestAnimationFrame(() => filterTweets());
}
