const toggle   = document.getElementById('toggle');
const statusEl = document.getElementById('status');
const hookInput= document.getElementById('hook-url');
const folderEl = document.getElementById('folder');

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

chrome.storage.local.get(['clobber-deploy-hook', 'clobber-folder'], (result) => {
  if (result['clobber-deploy-hook']) hookInput.value = result['clobber-deploy-hook'];
  if (result['clobber-folder'])      folderEl.textContent = result['clobber-folder'];
});

let hookDebounce;
hookInput.addEventListener('input', () => {
  clearTimeout(hookDebounce);
  hookDebounce = setTimeout(() => {
    const val = hookInput.value.trim();
    chrome.storage.local.set({ 'clobber-deploy-hook': val });
  }, 400);
});
