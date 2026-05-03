document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        keywords: "关注我\n主页有惊喜\n空投\nBTC\ntg群", 
        checkUsername: true
    }, (items) => {
        document.getElementById('keywords').value = items.keywords;
        document.getElementById('checkUsername').checked = items.checkUsername;
    });
});

document.getElementById('saveBtn').addEventListener('click', () => {
    const keywords = document.getElementById('keywords').value;
    const checkUsername = document.getElementById('checkUsername').checked;

    chrome.storage.local.set({
        keywords: keywords,
        checkUsername: checkUsername
    }, () => {
        const status = document.getElementById('status');
        status.style.display = 'block';
        setTimeout(() => {
            status.style.display = 'none';
        }, 2000);
    });
});