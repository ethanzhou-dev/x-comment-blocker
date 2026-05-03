chrome.storage.local.get({
    keywords: "关注我\n主页有惊喜\n空投\nBTC\ntg群",
    checkUsername: true
}, (items) => {
    const blockKeywords = items.keywords.split('\n').map(k => k.trim()).filter(k => k);
    const checkUsername = items.checkUsername;

    function filterTweets() {
        const tweets = document.querySelectorAll('[data-testid="cellInnerDiv"]:not(.checked-by-script)');

        tweets.forEach(tweet => {
            tweet.classList.add('checked-by-script');

            const userNode = tweet.querySelector('[data-testid="User-Name"]');
            const textNode = tweet.querySelector('[data-testid="tweetText"]');

            const userName = userNode ? userNode.innerText : "";
            const tweetBody = textNode ? textNode.innerText : "";

            let isSpam = blockKeywords.some(keyword => tweetBody.includes(keyword));

            if (!isSpam && checkUsername) {
                isSpam = blockKeywords.some(keyword => userName.includes(keyword));
            }

            if (isSpam) {
                tweet.style.display = 'none';
            }
        });
    }

    const observer = new MutationObserver(() => {
        filterTweets();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
});