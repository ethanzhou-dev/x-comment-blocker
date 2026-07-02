let userKeywords = [];
let isLoading = true;

const ICON_EDIT = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>`;
const ICON_DEL = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

const keywordList = document.getElementById('keywordList');
const keywordCount = document.getElementById('keywordCount');
const newKeywordInput = document.getElementById('newKeyword');
const addBtn = document.getElementById('addBtn');
const importBtn = document.getElementById('importBtn');
const exportBtn = document.getElementById('exportBtn');
const importFile = document.getElementById('importFile');
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

const viewHistoryBtn = document.getElementById('viewHistory');
const historyModal = document.getElementById('historyModal');
const closeHistoryBtn = document.getElementById('closeHistory');
const historyList = document.getElementById('historyList');

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

function renderUserKeywords(animateIndex = -1, fadeIndex = -1) {
    keywordList.innerHTML = '';

    if (userKeywords.length === 0) {
        keywordList.appendChild(el('div', { className: 'empty-hint', textContent: '暂无自定义屏蔽词' }));
        keywordCount.textContent = '';
        return;
    }

    const fragment = document.createDocumentFragment();

    userKeywords.forEach((kw, index) => {
        const editBtn = el('button', { className: 'tag-btn tag-btn-edit', innerHTML: ICON_EDIT, title: '编辑' });
        const delBtn = el('button', { className: 'tag-btn tag-btn-del', innerHTML: ICON_DEL, title: '删除', onclick: () => {
            tag.classList.add('animate-out');
            setTimeout(() => {
                userKeywords.splice(index, 1);
                renderUserKeywords();
                autoSave();
            }, 150);
        }});

        const tag = el('span', { className: 'keyword-tag' + (index === animateIndex ? ' animate-in' : '') + (index === fadeIndex ? ' fade-in' : '') }, [
            el('span', { className: 'tag-text', textContent: kw, title: kw }),
            editBtn,
            delBtn
        ]);

        editBtn.onclick = () => startEdit(tag, index);
        fragment.appendChild(tag);
    });

    keywordList.appendChild(fragment);
    keywordCount.textContent = `共 ${userKeywords.length} 个自定义词`;
}

function startEdit(tagEl, index) {
    tagEl.innerHTML = '';
    tagEl.classList.add('is-editing');

    const input = el('input', { className: 'tag-edit-input', value: userKeywords[index] });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmEdit(input, index);
        } else if (e.key === 'Escape') {
            renderUserKeywords(-1, index);
        }
    });

    const confirmBtn = el('button', { className: 'tag-btn tag-btn-save', innerHTML: ICON_CHECK, title: '确认', onclick: () => confirmEdit(input, index) });
    const cancelBtn = el('button', { className: 'tag-btn tag-btn-del', innerHTML: ICON_DEL, title: '取消', onclick: () => renderUserKeywords(-1, index) });

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
    renderUserKeywords(-1, index);
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
    renderUserKeywords(userKeywords.length - 1);
    autoSave();

    keywordList.scrollTop = keywordList.scrollHeight;
}

addBtn.addEventListener('click', addKeyword);

newKeywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        addKeyword();
    }
});

exportBtn.addEventListener('click', () => {
    if (userKeywords.length === 0) {
        showStatus('词库为空');
        return;
    }
    const content = userKeywords.join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `x-comment-blocker-keywords-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
});

importBtn.addEventListener('click', () => {
    importFile.click();
});

importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        const content = ev.target.result;
        let newKeywords = [];
        
        try {
            const parsed = JSON.parse(content);
            if (Array.isArray(parsed)) {
                newKeywords = parsed.map(k => String(k));
            }
        } catch {
            newKeywords = parseKeywords(content);
        }

        if (newKeywords.length > 0) {
            let addedCount = 0;
            newKeywords.forEach(kw => {
                if (!userKeywords.includes(kw)) {
                    userKeywords.push(kw);
                    addedCount++;
                }
            });
            if (addedCount > 0) {
                renderUserKeywords();
                autoSave();
                showStatus(`成功导入 ${addedCount} 个新词`);
            } else {
                showStatus('未发现新词，词库已包含这些内容');
            }
        } else {
            showStatus('文件内容无效');
        }
    };
    reader.readAsText(file);
    importFile.value = '';
});

function relativeTime(ts) {
    if (!ts) return '';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return '刚刚同步';
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前同步`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前同步`;
    return `${Math.floor(diff / 86400)}天前同步`;
}

function updateCloudInfo() {
    chrome.storage.local.get(getStorageDefaults('cloudKeywords', 'lastSyncTime', 'syncStatus', 'syncError')).then(items => {
        const cloudList = parseKeywords(items.cloudKeywords);
        const countText = cloudList.length > 0 ? `${cloudList.length} 个词` : '';

        cloudInfoEl.classList.remove('error');

        if (items.syncStatus === 'error') {
            cloudInfoEl.classList.add('error');
            cloudInfoEl.textContent = countText ? `${countText} · 同步失败` : '同步失败';
        } else if (items.lastSyncTime) {
            const timeText = relativeTime(items.lastSyncTime);
            cloudInfoEl.textContent = countText ? `${countText} · ${timeText}` : timeText;
        } else {
            cloudInfoEl.textContent = countText;
        }
    });
}

async function triggerCloudSync(manual = false) {
    try {
        const result = await chrome.runtime.sendMessage({ action: 'syncNow' });
        if (!result || !result.success) {
            if (manual) showStatus('同步失败，请检查网络');
        } else if (manual) {
            showStatus('云端词库已同步');
        }
    } catch {
        if (manual) showStatus('同步失败，请检查网络');
    }
    
    updateCloudInfo();

    if (syncBtn.classList.contains('syncing')) {
        const startTime = parseInt(syncBtn.dataset.syncStartTime || Date.now());
        const elapsed = Date.now() - startTime;
        const animationDuration = 1000;
        const mod = elapsed % animationDuration;
        const remaining = mod === 0 ? 0 : animationDuration - mod;
        
        setTimeout(() => {
            syncBtn.classList.remove('syncing');
        }, remaining);
    }
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
    syncBtn.dataset.syncStartTime = Date.now();
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

    const items = await chrome.storage.local.get(
        getStorageDefaults('keywords', 'checkUsername', 'onlyComments', 'blockSpecialChars', 'blockEmoji', 'enabled', 'cloudEnabled', 'blockedCount', 'lastSyncTime')
    );

    userKeywords = parseKeywords(items.keywords);
    checkUsernameEl.checked = items.checkUsername;
    onlyCommentsEl.checked = items.onlyComments;
    blockSpecialCharsEl.checked = items.blockSpecialChars;
    blockEmojiEl.checked = items.blockEmoji;
    enableToggleEl.checked = items.enabled;
    cloudToggleEl.checked = items.cloudEnabled;
    blockedCountEl.textContent = items.blockedCount || 0;

    updateEnabledState();
    renderUserKeywords();
    isLoading = false;
    updateCloudInfo();

    if (!items.lastSyncTime || (Date.now() - items.lastSyncTime > SYNC_INTERVAL_MS)) {
        syncBtn.dataset.syncStartTime = Date.now();
        syncBtn.classList.add('syncing');
        triggerCloudSync();
    }
});

resetCountBtn.addEventListener('click', async () => {
    await chrome.storage.local.set({ blockedCount: 0, blockedHistory: [] });
    blockedCountEl.textContent = '0';
});

viewHistoryBtn.addEventListener('click', async () => {
    historyModal.classList.add('open');
    historyList.innerHTML = `
        <div class="history-item">
            <div class="history-item-text" style="text-align: center; color: var(--text-muted); padding: 12px 0;">
                加载中...
            </div>
        </div>
    `;
    
    const items = await chrome.storage.local.get(getStorageDefaults('blockedHistory'));
    const history = items.blockedHistory;
    
    historyList.innerHTML = '';
    if (history.length === 0) {
        historyList.innerHTML = `
            <div class="history-item">
                <div class="history-item-text" style="text-align: center; color: var(--text-muted); padding: 12px 0;">
                    暂无记录
                </div>
            </div>
        `;
        return;
    }
    
    const fragment = document.createDocumentFragment();
    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';
        
        const header = document.createElement('div');
        header.className = 'history-item-header';
        
        const userSpan = document.createElement('span');
        userSpan.textContent = item.user || '未知用户';
        
        const timeSpan = document.createElement('span');
        timeSpan.textContent = new Date(item.time).toLocaleString();
        
        header.appendChild(userSpan);
        header.appendChild(timeSpan);
        
        let displayText = item.text || '[无内容或已隐藏]';
        if (item.reason) {
            displayText = `[${item.reason}] ${displayText}`;
        }
        
        const textDiv = document.createElement('div');
        textDiv.className = 'history-item-text';
        textDiv.textContent = displayText;
        
        div.appendChild(header);
        div.appendChild(textDiv);
        fragment.appendChild(div);
    });
    historyList.appendChild(fragment);
});

closeHistoryBtn.addEventListener('click', () => {
    historyModal.classList.remove('open');
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.blockedCount) {
        blockedCountEl.textContent = changes.blockedCount.newValue || 0;
    }
});