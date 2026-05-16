const toggle    = document.getElementById('toggle');
const statusEl  = document.getElementById('status');
const folderEl  = document.getElementById('folder');
const addBtn    = document.getElementById('add-target');
const listEl    = document.getElementById('targets-list');
const formEl    = document.getElementById('target-form');
const tfName    = document.getElementById('tf-name');
const tfUrl     = document.getElementById('tf-url');
const tfMethod  = document.getElementById('tf-method');
const tfHeaders = document.getElementById('tf-headers');
const tfBody    = document.getElementById('tf-body');
const tfSave    = document.getElementById('tf-save');
const tfCancel  = document.getElementById('tf-cancel');

let targets = [];
let editingIdx = -1; // -1 = adding new, >= 0 = editing existing

// ── status ──────────────────────────────────────────────────────
function updateStatus(info){
  if (!info) {
    statusEl.textContent = 'No data-edit elements found';
    statusEl.classList.remove('active');
    return;
  }
  if (info.active) {
    statusEl.textContent = 'Active on this page';
    statusEl.classList.add('active');
    toggle.checked = true;
  } else if (info.editableCount > 0) {
    statusEl.textContent = 'Inactive · ' + info.editableCount + ' editable';
    statusEl.classList.remove('active');
    toggle.checked = false;
  } else {
    statusEl.textContent = 'No data-edit elements found';
    statusEl.classList.remove('active');
    toggle.checked = false;
  }
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (!tabs[0]) return;
  chrome.tabs.sendMessage(tabs[0].id, { action: 'get-status' }, (response) => {
    if (chrome.runtime.lastError) {
      statusEl.textContent = 'Cannot reach page';
      return;
    }
    updateStatus(response);
  });
});

toggle.addEventListener('change', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle-clobber' }, (response) => {
      if (chrome.runtime.lastError) return;
      updateStatus(response);
    });
  });
});

// ── deploy targets ──────────────────────────────────────────────
function parseHeaders(str){
  const h = {};
  str.split('\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx > 0) h[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  });
  return h;
}

function headersToStr(h){
  if (!h || !Object.keys(h).length) return '';
  return Object.entries(h).map(([k, v]) => k + ': ' + v).join('\n');
}

function saveTargets(){
  chrome.storage.local.set({ 'clobber-deploy-targets': targets });
}

function renderTargets(){
  listEl.innerHTML = '';
  if (targets.length === 0) {
    listEl.innerHTML = '<div class="empty">No deploy targets</div>';
    return;
  }
  targets.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'target-row';
    row.innerHTML =
      '<div class="target-info">' +
        '<span class="target-name">' + (t.name || 'Untitled') + '</span>' +
        '<span class="target-url">' + (t.url || '').slice(0, 35) + (t.url.length > 35 ? '…' : '') + '</span>' +
      '</div>' +
      '<div class="target-actions">' +
        '<button class="btn-icon" data-action="deploy" data-idx="' + i + '" title="Deploy">▶</button>' +
        '<button class="btn-icon" data-action="edit" data-idx="' + i + '" title="Edit">✎</button>' +
        '<button class="btn-icon" data-action="delete" data-idx="' + i + '" title="Delete">×</button>' +
      '</div>';
    listEl.appendChild(row);
  });
}

function showForm(idx){
  editingIdx = idx;
  if (idx >= 0) {
    const t = targets[idx];
    tfName.value = t.name || '';
    tfUrl.value = t.url || '';
    tfMethod.value = t.method || 'POST';
    tfHeaders.value = headersToStr(t.headers);
    tfBody.value = t.body || '';
  } else {
    tfName.value = '';
    tfUrl.value = '';
    tfMethod.value = 'POST';
    tfHeaders.value = '';
    tfBody.value = '';
  }
  formEl.classList.remove('hidden');
  addBtn.classList.add('hidden');
  tfName.focus();
}

function hideForm(){
  formEl.classList.add('hidden');
  addBtn.classList.remove('hidden');
  editingIdx = -1;
}

addBtn.addEventListener('click', () => showForm(-1));
tfCancel.addEventListener('click', hideForm);

tfSave.addEventListener('click', () => {
  const url = tfUrl.value.trim();
  if (!url) { tfUrl.focus(); return; }
  const target = {
    name: tfName.value.trim() || 'Deploy',
    url: url,
    method: tfMethod.value,
    headers: parseHeaders(tfHeaders.value),
    body: tfBody.value.trim() || ''
  };
  if (editingIdx >= 0) {
    targets[editingIdx] = target;
  } else {
    targets.push(target);
  }
  saveTargets();
  renderTargets();
  hideForm();
});

listEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const idx = parseInt(btn.dataset.idx);
  const action = btn.dataset.action;

  if (action === 'delete') {
    targets.splice(idx, 1);
    saveTargets();
    renderTargets();
  } else if (action === 'edit') {
    showForm(idx);
  } else if (action === 'deploy') {
    btn.textContent = '…';
    chrome.runtime.sendMessage({ action: 'deploy', targets: [targets[idx]] }, (res) => {
      if (chrome.runtime.lastError) {
        btn.textContent = '✗';
        return;
      }
      btn.textContent = (res && res.ok) ? '✓' : '✗';
      setTimeout(() => { btn.textContent = '▶'; }, 2000);
    });
  }
});

// ── init storage ────────────────────────────────────────────────
chrome.storage.local.get(['clobber-deploy-targets', 'clobber-deploy-hook', 'clobber-folder'], (result) => {
  // Migrate old single hook URL to targets array
  if (!result['clobber-deploy-targets'] && result['clobber-deploy-hook']) {
    targets = [{ name: 'Default', url: result['clobber-deploy-hook'], method: 'POST', headers: {}, body: '' }];
    saveTargets();
    chrome.storage.local.remove('clobber-deploy-hook');
  } else {
    targets = result['clobber-deploy-targets'] || [];
  }
  renderTargets();
  if (result['clobber-folder']) folderEl.textContent = result['clobber-folder'];
});
