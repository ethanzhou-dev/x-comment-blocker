// 从 Chrome 存储中读取用户的配置
chrome.storage.local.get({
    keywords: "关注我\n主页有惊喜\n空投\nBTC\ntg群",
    checkUsername: true
}, (items) => {
    // 将多行字符串转成数组，并过滤掉空行
    const blockKeywords = items.keywords.split('\n').map(k => k.trim()).filter(k => k);
    const checkUsername = items.checkUsername;

    // 核心过滤函数
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
                // 简单粗暴，直接让整个评论块彻底消失
                tweet.style.display = 'none';
            }
        });
    }

    // 启动 MutationObserver 监听
    const observer = new MutationObserver(() => {
        filterTweets();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
});