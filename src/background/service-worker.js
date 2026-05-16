chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'deploy') {
    const targets = msg.targets;
    if (!targets || !targets.length) {
      sendResponse({ ok: false, error: 'No deploy targets configured' });
      return;
    }

    Promise.allSettled(targets.map(t => {
      const opts = { method: t.method || 'POST' };
      if (t.headers && Object.keys(t.headers).length) {
        opts.headers = t.headers;
      }
      if (t.body) {
        opts.body = t.body;
      }
      return fetch(t.url, opts).then(res => ({
        name: t.name,
        ok: res.ok,
        status: res.status
      }));
    })).then(results => {
      const out = results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return { name: targets[i].name, ok: false, error: r.reason && r.reason.message };
      });
      const allOk = out.every(r => r.ok);
      sendResponse({ ok: allOk, results: out });
    });

    return true; // async response
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
