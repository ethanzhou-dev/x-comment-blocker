// 页面加载时，从存储中读取配置
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        // 设置默认值
        keywords: "关注我\n主页有惊喜\n空投\nBTC\ntg群", 
        checkUsername: true
    }, (items) => {
        document.getElementById('keywords').value = items.keywords;
        document.getElementById('checkUsername').checked = items.checkUsername;
    });
});

// 点击保存按钮时，写入存储
document.getElementById('saveBtn').addEventListener('click', () => {
    const keywords = document.getElementById('keywords').value;
    const checkUsername = document.getElementById('checkUsername').checked;

    chrome.storage.local.set({
        keywords: keywords,
        checkUsername: checkUsername
    }, () => {
        // 显示保存成功提示
        const status = document.getElementById('status');
        status.style.display = 'block';
        setTimeout(() => {
            status.style.display = 'none';
        }, 2000);
    });
});