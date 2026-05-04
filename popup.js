// --- Config ---
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// --- State ---
let userKeywords = [];
let isLoading = true;

// --- DOM refs ---
const keywordList = document.getElementById('keywordList');
const keywordCount = document.getElementById('keywordCount');
const newKeywordInput = document.getElementById('newKeyword');
const addBtn = document.getElementById('addBtn');
const checkUsernameEl = document.getElementById('checkUsername');
const onlyCommentsEl = document.getElementById('onlyComments');
const blockEmojiEl = document.getElementById('blockEmoji');
const enableToggleEl = document.getElementById('enableToggle');
const cloudToggleEl = document.getElementById('cloudToggle');
const cloudInfoEl = document.getElementById('cloudInfo');
const syncBtn = document.getElementById('syncBtn');
const statusEl = document.getElementById('status');
const blockedCountEl = document.getElementById('blockedCount');
const resetCountBtn = document.getElementById('resetCount');

// --- Show status toast ---
function showStatus(text) {
    statusEl.textContent = text;
    statusEl.classList.add('visible');
    setTimeout(() => {
        statusEl.classList.remove('visible');
    }, 1500);
}

// --- Auto-save to storage ---
function autoSave() {
    if (isLoading) return;

    chrome.storage.local.set({
        keywords: userKeywords.join('\n'),
        checkUsername: checkUsernameEl.checked,
        onlyComments: onlyCommentsEl.checked,
        blockEmoji: blockEmojiEl.checked,
        enabled: enableToggleEl.checked,
        cloudEnabled: cloudToggleEl.checked
    }, () => {
        showStatus('已自动保存');
    });
}

// --- Update disabled state ---
function updateEnabledState() {
    if (enableToggleEl.checked) {
        document.body.classList.remove('disabled');
    } else {
        document.body.classList.add('disabled');
    }
}

// --- Render user keyword tags ---
function renderUserKeywords() {
    keywordList.innerHTML = '';

    if (userKeywords.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-hint';
        hint.textContent = '暂无自定义屏蔽词';
        keywordList.appendChild(hint);
        keywordCount.textContent = '';
        return;
    }

    userKeywords.forEach((kw, index) => {
        const tag = document.createElement('span');
        tag.className = 'keyword-tag';

        const textSpan = document.createElement('span');
        textSpan.className = 'tag-text';
        textSpan.textContent = kw;
        textSpan.title = kw;

        const editBtn = document.createElement('button');
        editBtn.className = 'tag-btn tag-btn-edit';
        editBtn.textContent = '✎';
        editBtn.title = '编辑';
        editBtn.addEventListener('click', () => startEdit(tag, index));

        const delBtn = document.createElement('button');
        delBtn.className = 'tag-btn tag-btn-del';
        delBtn.textContent = '✕';
        delBtn.title = '删除';
        delBtn.addEventListener('click', () => {
            userKeywords.splice(index, 1);
            renderUserKeywords();
            autoSave();
        });

        tag.appendChild(textSpan);
        tag.appendChild(editBtn);
        tag.appendChild(delBtn);
        keywordList.appendChild(tag);
    });

    keywordCount.textContent = `共 ${userKeywords.length} 个自定义词`;
}

// --- Inline edit mode ---
function startEdit(tagEl, index) {
    tagEl.innerHTML = '';

    const input = document.createElement('input');
    input.className = 'tag-edit-input';
    input.value = userKeywords[index];
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmEdit(input, index);
        } else if (e.key === 'Escape') {
            renderUserKeywords();
        }
    });

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'tag-btn tag-btn-save';
    confirmBtn.textContent = '✓';
    confirmBtn.title = '确认';
    confirmBtn.addEventListener('click', () => confirmEdit(input, index));

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'tag-btn tag-btn-del';
    cancelBtn.textContent = '✕';
    cancelBtn.title = '取消';
    cancelBtn.addEventListener('click', () => renderUserKeywords());

    tagEl.appendChild(input);
    tagEl.appendChild(confirmBtn);
    tagEl.appendChild(cancelBtn);

    input.focus();
    input.select();
}

function confirmEdit(inputEl, index) {
    const val = inputEl.value.trim();
    if (val) {
        userKeywords[index] = val;
    }
    renderUserKeywords();
    autoSave();
}

// --- Add keyword ---
function addKeyword() {
    const val = newKeywordInput.value.trim();
    if (!val) return;

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

// --- Sync cloud keywords ---
function syncCloudKeywords(manual = false) {
    chrome.runtime.sendMessage({ action: 'manualSync' }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok) {
            if (manual) showStatus('同步失败，请检查网络');
        } else {
            chrome.storage.local.get({ cloudKeywords: '' }, (items) => {
                const cloudList = items.cloudKeywords
                    ? items.cloudKeywords.split('\n').map(k => k.trim()).filter(k => k)
                    : [];
                cloudInfoEl.textContent = cloudList.length > 0 ? `${cloudList.length} 个词` : '';
                if (manual) showStatus('云端词库已同步');
            });
        }
        syncBtn.textContent = '同步';
        syncBtn.classList.remove('syncing');
    });
}

// --- Toggle & checkbox ---
enableToggleEl.addEventListener('change', () => {
    updateEnabledState();
    autoSave();
});

checkUsernameEl.addEventListener('change', () => autoSave());
onlyCommentsEl.addEventListener('change', () => autoSave());
blockEmojiEl.addEventListener('change', () => autoSave());
cloudToggleEl.addEventListener('change', () => autoSave());

syncBtn.addEventListener('click', () => {
    syncBtn.textContent = '同步中…';
    syncBtn.classList.add('syncing');
    syncCloudKeywords(true);
});

// --- Load on init ---
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        keywords: '',
        checkUsername: true,
        onlyComments: true,
        blockEmoji: false,
        enabled: true,
        cloudEnabled: true,
        blockedCount: 0,
        cloudKeywords: '',
        lastSyncTime: 0
    }, (items) => {
        userKeywords = items.keywords.split('\n').map(k => k.trim()).filter(k => k);
        checkUsernameEl.checked = items.checkUsername;
        onlyCommentsEl.checked = items.onlyComments;
        blockEmojiEl.checked = items.blockEmoji;
        enableToggleEl.checked = items.enabled;
        cloudToggleEl.checked = items.cloudEnabled;
        blockedCountEl.textContent = items.blockedCount || 0;

        const cloudList = items.cloudKeywords
            ? items.cloudKeywords.split('\n').map(k => k.trim()).filter(k => k)
            : [];
        cloudInfoEl.textContent = cloudList.length > 0 ? `${cloudList.length} 个词` : '';

        updateEnabledState();
        renderUserKeywords();
        isLoading = false;

        // Auto-sync if interval expired
        if (!items.lastSyncTime || (Date.now() - items.lastSyncTime > SYNC_INTERVAL_MS)) {
            syncCloudKeywords();
        }
    });
});

// --- Reset blocked count ---
resetCountBtn.addEventListener('click', () => {
    chrome.storage.local.set({ blockedCount: 0 }, () => {
        blockedCountEl.textContent = '0';
    });
});

// --- Live update blocked count ---
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.blockedCount) {
        blockedCountEl.textContent = changes.blockedCount.newValue || 0;
    }
});