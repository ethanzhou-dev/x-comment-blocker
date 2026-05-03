// --- State ---
let keywords = [];

// --- DOM refs ---
const keywordList = document.getElementById('keywordList');
const keywordCount = document.getElementById('keywordCount');
const newKeywordInput = document.getElementById('newKeyword');
const addBtn = document.getElementById('addBtn');
const checkUsernameEl = document.getElementById('checkUsername');
const saveBtn = document.getElementById('saveBtn');
const statusEl = document.getElementById('status');

// --- Render keyword tags ---
function renderKeywords() {
    keywordList.innerHTML = '';

    if (keywords.length === 0) {
        const hint = document.createElement('div');
        hint.className = 'empty-hint';
        hint.textContent = '暂无屏蔽词，请在上方添加';
        keywordList.appendChild(hint);
        keywordCount.textContent = '';
        return;
    }

    keywords.forEach((kw, index) => {
        const tag = document.createElement('span');
        tag.className = 'keyword-tag';

        const textSpan = document.createElement('span');
        textSpan.className = 'tag-text';
        textSpan.textContent = kw;
        textSpan.title = kw;

        // Edit button
        const editBtn = document.createElement('button');
        editBtn.className = 'tag-btn tag-btn-edit';
        editBtn.textContent = '✎';
        editBtn.title = '编辑';
        editBtn.addEventListener('click', () => startEdit(tag, index));

        // Delete button
        const delBtn = document.createElement('button');
        delBtn.className = 'tag-btn tag-btn-del';
        delBtn.textContent = '✕';
        delBtn.title = '删除';
        delBtn.addEventListener('click', () => {
            keywords.splice(index, 1);
            renderKeywords();
        });

        tag.appendChild(textSpan);
        tag.appendChild(editBtn);
        tag.appendChild(delBtn);
        keywordList.appendChild(tag);
    });

    keywordCount.textContent = `共 ${keywords.length} 个屏蔽词`;
}

// --- Inline edit mode ---
function startEdit(tagEl, index) {
    tagEl.innerHTML = '';

    const input = document.createElement('input');
    input.className = 'tag-edit-input';
    input.value = keywords[index];
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmEdit(input, index);
        } else if (e.key === 'Escape') {
            renderKeywords(); // cancel
        }
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'tag-btn tag-btn-save';
    saveBtn.textContent = '✓';
    saveBtn.title = '确认';
    saveBtn.addEventListener('click', () => confirmEdit(input, index));

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'tag-btn tag-btn-del';
    cancelBtn.textContent = '✕';
    cancelBtn.title = '取消';
    cancelBtn.addEventListener('click', () => renderKeywords());

    tagEl.appendChild(input);
    tagEl.appendChild(saveBtn);
    tagEl.appendChild(cancelBtn);

    input.focus();
    input.select();
}

function confirmEdit(inputEl, index) {
    const val = inputEl.value.trim();
    if (val) {
        keywords[index] = val;
    }
    renderKeywords();
}

// --- Add keyword ---
function addKeyword() {
    const val = newKeywordInput.value.trim();
    if (!val) return;

    // Prevent duplicates
    if (keywords.includes(val)) {
        newKeywordInput.value = '';
        newKeywordInput.focus();
        return;
    }

    keywords.push(val);
    newKeywordInput.value = '';
    newKeywordInput.focus();
    renderKeywords();

    // Scroll to bottom of list
    keywordList.scrollTop = keywordList.scrollHeight;
}

addBtn.addEventListener('click', addKeyword);

newKeywordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        addKeyword();
    }
});

// --- Save ---
saveBtn.addEventListener('click', () => {
    const keywordsStr = keywords.join('\n');
    const checkUsername = checkUsernameEl.checked;

    chrome.storage.local.set({
        keywords: keywordsStr,
        checkUsername: checkUsername
    }, () => {
        statusEl.classList.add('visible');
        setTimeout(() => {
            statusEl.classList.remove('visible');
        }, 2000);
    });
});

// --- Load on init ---
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get({
        keywords: "关注我\n主页有惊喜\n空投\nBTC\ntg群",
        checkUsername: true
    }, (items) => {
        keywords = items.keywords.split('\n').map(k => k.trim()).filter(k => k);
        checkUsernameEl.checked = items.checkUsername;
        renderKeywords();
    });
});