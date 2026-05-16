chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'deploy') {
    const hookUrl = msg.hookUrl;
    if (!hookUrl) {
      sendResponse({ ok: false, error: 'No hook URL' });
      return;
    }
    fetch(hookUrl, { method: 'POST' })
      .then(res => {
        sendResponse({ ok: res.ok, status: res.status });
      })
      .catch(err => {
        sendResponse({ ok: false, error: err.message });
      });
    return true;
  }

  if (msg.action === 'update-badge') {
    const count = msg.count || 0;
    const tabId = sender.tab && sender.tab.id;
    if (tabId) {
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#faf4e6', tabId });
    }
  }
});
