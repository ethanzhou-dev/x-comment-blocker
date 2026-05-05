let userKeywords = [];
let isLoading = true;

const keywordList = document.getElementById('keywordList');
const keywordCount = document.getElementById('keywordCount');
const newKeywordInput = document.getElementById('newKeyword');
const addBtn = document.getElementById('addBtn');
const checkUsernameEl = document.getElementById('checkUsername');
const onlyCommentsEl = document.getElementById('onlyComments');
const blockSpecialCharsEl = document.getElementById('blockSpecialChars');
const blockEmojiEl = document.getElementById('blockEmoji');
const enableToggleEl = document.getElementById('enableToggle');
const cloudToggleEl = document.getElementById('cloudToggle');
const cloudInfoEl = document.getElementById('cloudInfo');
const syncBtn = document.getElementById('syncBtn');
const statusEl = document.getElementById('status');
const blockedCountEl = document.getElementById('blockedCount');
const resetCountBtn = document.getElementById('resetCount');

function showStatus(text) {
    statusEl.textContent = text;
    statusEl.classList.add('visible');
    setTimeout(() => {
        statusEl.classList.remove('visible');
    }, 1500);
}

async function autoSave() {
    if (isLoading) return;

    await chrome.storage.local.set({
        keywords: userKeywords.join('\n'),
        checkUsername: checkUsernameEl.checked,
        onlyComments: onlyCommentsEl.checked,
        blockSpecialChars: blockSpecialCharsEl.checked,
        blockEmoji: blockEmojiEl.checked,
        enabled: enableToggleEl.checked,
        cloudEnabled: cloudToggleEl.checked
    });
    showStatus('已自动保存');
}

function updateEnabledState() {
    document.body.classList.toggle('disabled', !enableToggleEl.checked);
}

function el(tag, props, children) {
    const element = document.createElement(tag);
    Object.assign(element, props);
    if (children) children.forEach(c => element.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return element;
}

function renderUserKeywords() {
    keywordList.innerHTML = '';

    if (userKeywords.length === 0) {
        keywordList.appendChild(el('div', { className: 'empty-hint', textContent: '暂无自定义屏蔽词' }));
        keywordCount.textContent = '';
        return;
    }

    const fragment = document.createDocumentFragment();

    userKeywords.forEach((kw, index) => {
        let tag;
        const editBtn = el('button', { className: 'tag-btn tag-btn-edit', textContent: '✎', title: '编辑', onclick: () => startEdit(tag, index) });
        const delBtn = el('button', { className: 'tag-btn tag-btn-del', textContent: '✕', title: '删除', onclick: () => {
            userKeywords.splice(index, 1);
            renderUserKeywords();
            autoSave();
        }});

        tag = el('span', { className: 'keyword-tag' }, [
            el('span', { className: 'tag-text', textContent: kw, title: kw }),
            editBtn,
            delBtn
        ]);

        fragment.appendChild(tag);
    });

    keywordList.appendChild(fragment);
    keywordCount.textContent = `共 ${userKeywords.length} 个自定义词`;
}

function startEdit(tagEl, index) {
    tagEl.innerHTML = '';

    const input = el('input', { className: 'tag-edit-input', value: userKeywords[index] });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmEdit(input, index);
        } else if (e.key === 'Escape') {
            renderUserKeywords();
        }
    });

    const confirmBtn = el('button', { className: 'tag-btn tag-btn-save', textContent: '✓', title: '确认', onclick: () => confirmEdit(input, index) });
    const cancelBtn = el('button', { className: 'tag-btn tag-btn-del', textContent: '✕', title: '取消', onclick: () => renderUserKeywords() });

    tagEl.appendChild(input);
    tagEl.appendChild(confirmBtn);
    tagEl.appendChild(cancelBtn);

    input.focus();
    input.select();
}

function confirmEdit(inputEl, index) {
    const inputKws = parseKeywords(inputEl.value);
    if (inputKws.length > 0) {
        userKeywords[index] = inputKws[0];
    }
    renderUserKeywords();
    autoSave();
}

function addKeyword() {
    const inputKws = parseKeywords(newKeywordInput.value);
    if (inputKws.length === 0) return;
    const val = inputKws[0];

    if (userKeywords.includes(val)) {
        newKeywordInput.value = '';
        newKeywordInput.focus();
        return;
    }

    userKeywords.push(val);
    newKeywordInput.value = '';
    newKeywordInput.focus();
    renderUserKeywords();
    autoSave();

    keywordList.scrollTop = keywordList.scrollHeight;
}

addBtn.addEventListener('click', addKeyword);

newKeywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        addKeyword();
    }
});

async function triggerCloudSync(manual = false) {
    const success = await syncCloudKeywords();
    if (!success) {
        if (manual) showStatus('同步失败，请检查网络');
    } else {
        const items = await chrome.storage.local.get({ cloudKeywords: '' });
        const cloudList = parseKeywords(items.cloudKeywords);
        cloudInfoEl.textContent = cloudList.length > 0 ? `${cloudList.length} 个词` : '';
        if (manual) showStatus('云端词库已同步');
    }
    syncBtn.textContent = '同步';
    syncBtn.classList.remove('syncing');
}

enableToggleEl.addEventListener('change', () => {
    updateEnabledState();
    autoSave();
});

checkUsernameEl.addEventListener('change', () => autoSave());
onlyCommentsEl.addEventListener('change', () => autoSave());
blockSpecialCharsEl.addEventListener('change', () => autoSave());
blockEmojiEl.addEventListener('change', () => autoSave());
cloudToggleEl.addEventListener('change', () => autoSave());

syncBtn.addEventListener('click', () => {
    syncBtn.textContent = '同步中…';
    syncBtn.classList.add('syncing');
    triggerCloudSync(true);
});

document.addEventListener('DOMContentLoaded', async () => {
    const settingsHeader = document.getElementById('settingsHeader');
    const settingsContent = document.getElementById('settingsContent');
    const settingsArrow = document.getElementById('settingsArrow');

    if (settingsHeader) {
        settingsHeader.addEventListener('click', () => {
            settingsContent.classList.toggle('open');
            settingsArrow.classList.toggle('open');
        });
    }

    const items = await chrome.storage.local.get({
        keywords: '',
        checkUsername: true,
        onlyComments: true,
        blockSpecialChars: true,
        blockEmoji: false,
        enabled: true,
        cloudEnabled: true,
        blockedCount: 0,
        cloudKeywords: '',
        lastSyncTime: 0
    });

    userKeywords = parseKeywords(items.keywords);
    checkUsernameEl.checked = items.checkUsername;
    onlyCommentsEl.checked = items.onlyComments;
    blockSpecialCharsEl.checked = items.blockSpecialChars;
    blockEmojiEl.checked = items.blockEmoji;
    enableToggleEl.checked = items.enabled;
    cloudToggleEl.checked = items.cloudEnabled;
    blockedCountEl.textContent = items.blockedCount || 0;

    const cloudList = parseKeywords(items.cloudKeywords);
    cloudInfoEl.textContent = cloudList.length > 0 ? `${cloudList.length} 个词` : '';

    updateEnabledState();
    renderUserKeywords();
    isLoading = false;

    if (!items.lastSyncTime || (Date.now() - items.lastSyncTime > SYNC_INTERVAL_MS)) {
        triggerCloudSync();
    }
});

resetCountBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ blockedCount: 0 });
    blockedCountEl.textContent = '0';
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.blockedCount) {
        blockedCountEl.textContent = changes.blockedCount.newValue || 0;
    }
});