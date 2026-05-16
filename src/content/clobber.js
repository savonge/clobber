/*
  Clobber — inline editor for static HTML sites (Chrome extension content script)
  ────────────────────────────────────────────────────────────────────────────────
  Activated via extension popup or service worker message.
  Hold Cmd to see hover hints. Cmd-Click text/image to edit. Cmd-Shift-
  Click an image to remove it. Cmd-S or the Save button writes to disk.

  Save tiers (tried in order):
    1. File System Access API   — Chrome / Edge / Arc / Brave.
    2. Optional Node helper     — config.helperUrl ?? null.
    3. Download fallback        — every browser.

  Defense in depth:
    • Source-DOM pairing — dynamic JS-built content is never editable.
    • Byte-range patches — saves splice into the original source string;
      nothing outside an edit moves. Git diffs stay minimal.
    • Sanity check       — confirms before writing if size delta is large.
    • Timestamped backups — every overwrite copies the prior file into
      <backupDir>/<basename>.<timestamp>.<ext> first.

  Configuration (all optional):
    window.CLOBBER_CONFIG = {
      helperUrl:        'http://localhost:8787',
      backupDir:        '.clobber-backups',
      blockPaths:       [/-legacy\.html$/],
      blockSelectors:   'nav, footer',
      suspiciousBytes:  5000,
      suspiciousPct:    10,
      entityMap:        { ' ': '&nbsp;', '·': '&middot;', '©': '&copy;', '—': '&mdash;', '–': '&ndash;' },
    };

  License: MIT
*/
/* CLOBBER_MARKER_V1 */
(function(){

  let active = false;
  let cleanupFn = null;

  // ── extension message listener ────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'toggle-clobber') {
      if (active) {
        deactivate();
      } else {
        activate();
      }
      const editEls = document.querySelectorAll('[data-edit]');
      sendResponse({ active, editableCount: editEls.length });
    }
    if (msg.action === 'get-status') {
      const editEls = document.querySelectorAll('[data-edit]');
      sendResponse({
        active,
        editableCount: editEls.length
      });
    }
  });

  // Support ?clobber=1 as manual debug override
  const params = new URLSearchParams(location.search);
  if (params.get('clobber') === '1') activate();

  // Use hostname for http(s), full pathname for file:// (hostname is empty)
  const storageKey = 'clobber-on:' + (location.protocol === 'file:'
    ? 'file://' + location.pathname
    : location.hostname);

  function deactivate(){
    active = false;
    if (cleanupFn) cleanupFn();
    cleanupFn = null;
    chrome.storage.local.set({ [storageKey]: false });
  }

  function activate(){
    if (active) return;
    active = true;
    chrome.storage.local.set({ [storageKey]: true });
    cleanupFn = initClobber();
  }

  // Auto-activate if previously on for this domain/file
  chrome.storage.local.get([storageKey], (result) => {
    if (result[storageKey] === true) activate();
  });

  function initClobber(){
    // ── config (defaults merged with user overrides) ────────────────
    const CFG = Object.assign({
      helperUrl: null,
      backupDir: '.clobber-backups',
      blockPaths: [],
      blockSelectors: 'nav, footer',
      suspiciousBytes: 5000,
      suspiciousPct: 10,
      entityMap: {
        ' ': '&nbsp;',
        '·': '&middot;',
        '©': '&copy;',
        '—': '&mdash;',
        '–': '&ndash;'
      }
    }, window.CLOBBER_CONFIG || {});

    // ── resolve this page's path ─────────────────────────────────────
    // On http(s), pathname is relative to server root (e.g. /about/index.html → about/index.html).
    // On file://, pathname is the full OS path — we use just the filename and expect
    // the user to pick the containing directory as the project root.
    function derivePath(){
      const decoded = decodeURIComponent(location.pathname);
      if (location.protocol === 'file:') {
        return decoded.split('/').pop() || 'index.html';
      }
      return decoded.replace(/^\//, '') || 'index.html';
    }
    const FILE_PATH = derivePath();

    for (const re of CFG.blockPaths) {
      if (re && re.test && re.test(FILE_PATH)) return () => {};
    }

    // ── state ────────────────────────────────────────────────────────
    let sourceDoc  = null;
    let sourceText = '';
    let initState  = 'idle';
    let pairMap            = new WeakMap();
    let positionMap        = new WeakMap();
    const pendingPatches   = new Map();
    const pendingDeletions = new Set();
    const textChanges      = new Set();
    const imageQueue       = new Map();
    let editingEl     = null;
    let rootDirHandle = null;

    // ── HTML position scanner ────────────────────────────────────────
    const VOID_TAGS = new Set([
      'area','base','br','col','embed','hr','img','input',
      'link','meta','param','source','track','wbr'
    ]);
    const RAW_TAGS = new Set(['script','style']);

    function parseSourcePositions(src){
      const out = [];
      const stack = [];
      let i = 0;
      while (i < src.length) {
        const lt = src.indexOf('<', i);
        if (lt === -1) break;
        if (src.startsWith('<!--', lt)) {
          const end = src.indexOf('-->', lt + 4);
          i = end === -1 ? src.length : end + 3;
          continue;
        }
        if (src.startsWith('<!', lt)) {
          const gt = src.indexOf('>', lt);
          i = gt === -1 ? src.length : gt + 1;
          continue;
        }
        if (src[lt+1] === '/') {
          const gt = src.indexOf('>', lt);
          if (gt === -1) break;
          const name = src.slice(lt+2, gt).trim().toLowerCase();
          for (let j = stack.length - 1; j >= 0; j--) {
            if (stack[j].tag === name) {
              stack[j].closeStart = lt;
              stack[j].closeEnd   = gt + 1;
              stack.length = j;
              break;
            }
          }
          i = gt + 1;
          continue;
        }
        const gt = src.indexOf('>', lt);
        if (gt === -1) break;
        const head = src.slice(lt+1, gt);
        const m = head.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
        if (!m) { i = gt + 1; continue; }
        const tag = m[1].toLowerCase();
        const selfClosing = head.endsWith('/') || VOID_TAGS.has(tag);
        const info = {
          tag,
          openStart: lt,
          openEnd: gt + 1,
          closeStart: -1,
          closeEnd: -1
        };
        out.push(info);
        if (selfClosing) {
          info.closeStart = info.openEnd;
          info.closeEnd   = info.openEnd;
          i = gt + 1;
          continue;
        }
        if (RAW_TAGS.has(tag)) {
          const closer = '</' + tag;
          const lower = src.toLowerCase();
          const close = lower.indexOf(closer, gt);
          if (close === -1) { i = src.length; continue; }
          const closeGt = src.indexOf('>', close);
          info.closeStart = close;
          info.closeEnd   = closeGt + 1;
          i = closeGt + 1;
          continue;
        }
        stack.push(info);
        i = gt + 1;
      }
      return out;
    }

    function mapSourceToPositions(srcDoc, positions){
      const map = new WeakMap();
      const elements = [];
      (function collect(node){
        if (node.nodeType === 1) {
          elements.push(node);
          for (const c of node.childNodes) collect(c);
        }
      })(srcDoc.documentElement);

      if (elements.length === positions.length) {
        for (let i = 0; i < elements.length; i++) map.set(elements[i], positions[i]);
        return map;
      }
      let ei = 0, pi = 0;
      while (ei < elements.length && pi < positions.length) {
        if (elements[ei].tagName.toLowerCase() === positions[pi].tag) {
          map.set(elements[ei], positions[pi]);
          ei++; pi++;
        } else if (elements[ei].tagName.toLowerCase() === 'tbody') {
          ei++;
        } else {
          pi++;
        }
      }
      return map;
    }

    function preserveEntities(html){
      let out = html;
      for (const [ch, ent] of Object.entries(CFG.entityMap)) {
        out = out.split(ch).join(ent);
      }
      return out;
    }

    // ── styles (theme via CSS vars on :root) ────────────────────────
    const css = `
      :root {
        --clobber-bg:     #222;
        --clobber-fg:     #faf4e6;
        --clobber-accent: #faf4e6;
        --clobber-hair:   rgba(250,244,230,0.18);
        --clobber-dim:    rgba(250,244,230,0.42);
        --clobber-mono:   ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace;
      }
      .clobber-banner{position:fixed;top:14px;right:14px;z-index:9999;display:none;
        align-items:center;gap:10px;padding:10px 14px;
        background:color-mix(in srgb, var(--clobber-bg) 92%, transparent);
        backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
        border:1px solid var(--clobber-hair);border-radius:10px;
        font-family:var(--clobber-mono);font-size:11px;
        text-transform:uppercase;letter-spacing:0.06em;color:var(--clobber-fg)}
      body.clobber-dirty .clobber-banner{display:flex}
      .clobber-banner .clobber-dot{width:7px;height:7px;border-radius:50%;
        background:var(--clobber-accent);box-shadow:0 0 8px color-mix(in srgb, var(--clobber-accent) 60%, transparent)}
      .clobber-banner button{background:transparent;color:var(--clobber-dim);
        border:1px solid var(--clobber-hair);border-radius:6px;
        padding:6px 10px;font-family:inherit;font-size:10px;
        letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;
        transition:color .15s,border-color .15s,background .15s}
      .clobber-banner button:hover{color:var(--clobber-fg);border-color:var(--clobber-accent)}
      .clobber-banner button.clobber-primary{color:var(--clobber-bg);background:var(--clobber-accent);border-color:var(--clobber-accent)}
      .clobber-banner button.clobber-primary:hover{filter:brightness(1.08)}
      .clobber-banner .clobber-sep{width:1px;height:16px;background:var(--clobber-hair)}
      .clobber-banner .clobber-count{color:var(--clobber-dim)}

      body.clobber-cmd [data-edit]:not(img):hover{outline:1px dashed var(--clobber-dim);outline-offset:4px;cursor:text}
      body.clobber-cmd img[data-edit]:hover{outline:1px dashed var(--clobber-accent);cursor:copy}
      [contenteditable="true"]{outline:1px solid var(--clobber-accent) !important;
        outline-offset:4px;cursor:text;
        background:color-mix(in srgb, var(--clobber-accent) 4%, transparent)}

      .clobber-done-pill{position:absolute;z-index:9998;transform:translateY(-100%);
        margin-top:-6px;padding:5px 9px;background:var(--clobber-accent);color:var(--clobber-bg);
        border-radius:6px;font-family:var(--clobber-mono);font-size:10px;
        letter-spacing:0.06em;text-transform:uppercase;cursor:pointer;
        box-shadow:0 4px 12px rgba(0,0,0,0.3)}
      .clobber-done-pill:hover{filter:brightness(1.08)}

      .clobber-toast{position:fixed;bottom:24px;left:50%;
        transform:translateX(-50%) translateY(20px);z-index:10000;
        padding:12px 18px;background:var(--clobber-accent);color:var(--clobber-bg);border-radius:8px;
        font-family:var(--clobber-mono);font-size:11px;
        letter-spacing:0.06em;text-transform:uppercase;opacity:0;
        transition:opacity .2s,transform .2s;
        box-shadow:0 6px 20px rgba(0,0,0,0.4);pointer-events:none;
        max-width:80vw;text-align:center}
      .clobber-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
      .clobber-toast.warn{background:#ffb38a;color:#3a1a0a}
    `;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-clobber-style','');
    styleEl.textContent = css;
    document.head.appendChild(styleEl);

    // ── banner ───────────────────────────────────────────────────────
    const banner = document.createElement('div');
    banner.className = 'clobber-banner';
    banner.setAttribute('data-clobber-ui','');
    banner.innerHTML =
      '<span class="clobber-dot"></span>'+
      '<span class="clobber-count" data-clobber-count>clobber</span>'+
      '<span class="clobber-sep"></span>'+
      '<button class="clobber-primary" data-act="save">Save</button>'+
      '<button data-act="discard">Discard</button>';
    document.body.appendChild(banner);
    const countEl = banner.querySelector('[data-clobber-count]');

    // Deploy button: added dynamically if hook URL is configured
    let deployBtn = null;
    chrome.storage.local.get(['clobber-deploy-hook'], (result) => {
      const hookUrl = result['clobber-deploy-hook'];
      if (hookUrl) {
        addDeployButton(hookUrl);
      }
    });

    function addDeployButton(hookUrl){
      if (deployBtn) return;
      const sep = document.createElement('span');
      sep.className = 'clobber-sep';
      banner.appendChild(sep);
      deployBtn = document.createElement('button');
      deployBtn.setAttribute('data-act', 'deploy');
      deployBtn.textContent = 'Deploy';
      banner.appendChild(deployBtn);
      deployBtn._hookUrl = hookUrl;
    }

    banner.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'save')    save();
      else if (b.dataset.act === 'discard') discard();
      else if (b.dataset.act === 'deploy') deploy();
    });

    // ── file input (lazy, for image replace) ─────────────────────────
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    fileInput.setAttribute('data-clobber-ui','');
    document.body.appendChild(fileInput);
    let pendingImg = null;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file || !pendingImg) return;
      onImagePicked(pendingImg, file);
      pendingImg = null;
    });

    // ── helpers ──────────────────────────────────────────────────────
    function toast(msg, level){
      const t = document.createElement('div');
      t.className = 'clobber-toast' + (level === 'warn' ? ' warn' : '');
      t.setAttribute('data-clobber-ui','');
      t.textContent = msg;
      document.body.appendChild(t);
      requestAnimationFrame(() => t.classList.add('show'));
      setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
    }
    function updateDirty(){
      const n = textChanges.size + imageQueue.size + pendingDeletions.size;
      countEl.textContent = n ? (n + ' change' + (n>1?'s':'')) : 'clobber';
      document.body.classList.toggle('clobber-dirty', n > 0);
      // Update badge via service worker (callback suppresses lastError noise)
      chrome.runtime.sendMessage({ action: 'update-badge', count: n }, () => {
        if (chrome.runtime.lastError) { /* service worker may be inactive */ }
      });
    }
    function hasChanges(){
      return textChanges.size + imageQueue.size + pendingDeletions.size > 0;
    }
    function isUiNode(el){
      return !!(el && el.closest && el.closest('.clobber-banner,.clobber-toast,.clobber-done-pill,[data-clobber-ui]'));
    }
    function isOutOfScope(el){
      if (!CFG.blockSelectors) return false;
      return !!(el && el.closest && el.closest(CFG.blockSelectors));
    }
    function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

    // ── source load + pairing ────────────────────────────────────────
    async function loadSource(){
      if (initState === 'ready')   return;
      if (initState === 'loading') { while (initState === 'loading') await sleep(40); return; }
      initState = 'loading';
      try {
        let html = null;
        // Direct fetch works on http(s):// but not file:// (CORS blocks it)
        if (location.protocol !== 'file:') {
          try {
            const res = await fetch(location.href, { cache:'no-store' });
            if (res.ok) html = await res.text();
          } catch(_){}
        }
        // For file:// (and fetch failures), fall through to FS Access API
        if (!html) {
          let root = await ensureRoot();
          try {
            const fh = await fileHandleAt(root, FILE_PATH, false);
            const file = await fh.getFile();
            html = await file.text();
          } catch (fsErr) {
            // File not found in stored directory — clear it and ask user to re-pick
            console.warn('[clobber] file not found in stored folder, re-picking:', fsErr.message);
            rootDirHandle = null;
            try { await idbOp('delete', HKEY); } catch(_){}
            root = await ensureRoot();
            const fh = await fileHandleAt(root, FILE_PATH, false);
            const file = await fh.getFile();
            html = await file.text();
          }
        }
        sourceText = html;
        sourceDoc  = new DOMParser().parseFromString(html, 'text/html');
        pairMap     = new WeakMap();
        positionMap = mapSourceToPositions(sourceDoc, parseSourcePositions(html));
        pendingPatches.clear();
        pendingDeletions.clear();
        pairTrees(sourceDoc.body, document.body);
        markEditables();
        initState = 'ready';
        console.log('[clobber] ready · ' + FILE_PATH + ' · pairs: ' + countPaired());
      } catch (err) {
        initState = 'error';
        console.error('[clobber] init failed:', err);
        toast('Clobber init failed','warn');
      }
    }
    // On http(s), eagerly fetch source (no user gesture needed).
    // On file://, defer to first Cmd-click — showDirectoryPicker requires a gesture.
    if (location.protocol !== 'file:') loadSource();

    function pairTrees(s, l){
      if (!s || !l || s.nodeType !== 1 || l.nodeType !== 1) return;
      if (s.tagName !== l.tagName) return;
      pairMap.set(l, s);
      const sc = s.children, lc = l.children;
      const n = Math.min(sc.length, lc.length);
      for (let i = 0; i < n; i++) {
        if (sc[i].tagName === lc[i].tagName) pairTrees(sc[i], lc[i]);
        else break;
      }
    }
    function countPaired(){
      let n = 0;
      document.querySelectorAll('*').forEach(el => { if (pairMap.has(el)) n++; });
      return n;
    }

    function markEditables(){
      document.querySelectorAll('[data-edit]').forEach(el => {
        if (isOutOfScope(el) || isUiNode(el)) return;
        if (!pairMap.has(el)) return;
      });
    }

    function nearestEditEl(el){
      let cur = el;
      while (cur && cur !== document.body) {
        if (cur.nodeType === 1 && cur.hasAttribute && cur.hasAttribute('data-edit') && pairMap.has(cur)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }

    // ── Cmd-key hover hints ──────────────────────────────────────────
    function setCmd(on){ document.body.classList.toggle('clobber-cmd', !!on); }
    function onKeyDown(e){ if (e.key==='Meta'||e.key==='Control') setCmd(true); }
    function onKeyUp(e){ if (e.key==='Meta'||e.key==='Control') setCmd(false); }
    function onBlur(){ setCmd(false); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    // ── click handler ────────────────────────────────────────────────
    function onClick(e){
      if (isUiNode(e.target)) return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (isOutOfScope(e.target)) return;

      if (initState !== 'ready') {
        e.preventDefault(); e.stopPropagation();
        toast('Setting up Clobber…');
        loadSource().then(() => {
          if (initState !== 'ready') { toast('Init failed','warn'); return; }
          toast('Ready — Cmd-click again to edit');
        });
        return;
      }

      // Image with data-edit: check directly
      if (e.target.tagName === 'IMG' && e.target.hasAttribute('data-edit') && pairMap.has(e.target)) {
        e.preventDefault(); e.stopPropagation();
        if (e.shiftKey) deleteImage(e.target);
        else            startImgReplace(e.target);
        return;
      }

      // Text element with data-edit (or nearest ancestor)
      const editEl = nearestEditEl(e.target);
      if (editEl) {
        if (editEl.tagName === 'IMG') {
          e.preventDefault(); e.stopPropagation();
          if (e.shiftKey) deleteImage(editEl);
          else            startImgReplace(editEl);
        } else {
          e.preventDefault(); e.stopPropagation();
          startEdit(editEl);
        }
      }
    }
    document.addEventListener('click', onClick, true);

    function onMouseDown(e){
      if (!editingEl) return;
      if (editingEl.contains(e.target)) return;
      if (isUiNode(e.target)) return;
      commitCurrentEdit();
    }
    document.addEventListener('mousedown', onMouseDown, true);

    function onKeyDownDoc(e){
      if (e.key === 'Escape' && editingEl) commitCurrentEdit();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && hasChanges()) {
        e.preventDefault(); save();
      }
    }
    document.addEventListener('keydown', onKeyDownDoc);

    // ── inline text edit ─────────────────────────────────────────────
    function startEdit(liveEl){
      commitCurrentEdit();
      editingEl = liveEl;
      liveEl.setAttribute('contenteditable','true');
      liveEl.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(liveEl);
      range.collapse(false);
      sel.removeAllRanges(); sel.addRange(range);

      const pill = document.createElement('div');
      pill.className = 'clobber-done-pill';
      pill.textContent = 'Done';
      pill.setAttribute('data-clobber-ui','');
      pill.addEventListener('mousedown', ev => { ev.preventDefault(); commitCurrentEdit(); });
      document.body.appendChild(pill);
      liveEl._clobberPill = pill;
      liveEl._clobberReposition = () => {
        const r = liveEl.getBoundingClientRect();
        pill.style.left = (window.scrollX + r.left) + 'px';
        pill.style.top  = (window.scrollY + r.top)  + 'px';
      };
      liveEl._clobberReposition();
      window.addEventListener('scroll', liveEl._clobberReposition, { passive:true });
      window.addEventListener('resize', liveEl._clobberReposition);
    }
    function commitCurrentEdit(){
      if (!editingEl) return;
      editingEl.removeAttribute('contenteditable');
      const sourceEl = pairMap.get(editingEl);
      const pos = sourceEl ? positionMap.get(sourceEl) : null;
      if (sourceEl && pos && pos.closeStart >= 0) {
        pendingPatches.set(sourceEl, {
          pos,
          newInner: preserveEntities(editingEl.innerHTML)
        });
      }
      textChanges.add(editingEl);
      if (editingEl._clobberPill) editingEl._clobberPill.remove();
      if (editingEl._clobberReposition) {
        window.removeEventListener('scroll', editingEl._clobberReposition);
        window.removeEventListener('resize', editingEl._clobberReposition);
      }
      editingEl = null;
      updateDirty();
    }

    // ── image replace ────────────────────────────────────────────────
    function startImgReplace(liveImg){
      pendingImg = liveImg;
      fileInput.value = '';
      fileInput.click();
    }
    function onImagePicked(liveImg, file){
      const blobUrl = URL.createObjectURL(file);
      const sourceImg = pairMap.get(liveImg) || null;
      const originalSrc = liveImg.dataset.clobberOrigSrc
                       || (sourceImg && sourceImg.getAttribute('src'))
                       || liveImg.getAttribute('src');
      const filename = originalSrc.split('?')[0].split('/').pop();
      const oldW = liveImg.naturalWidth, oldH = liveImg.naturalHeight;
      const probe = new Image();
      probe.onload = () => {
        liveImg.dataset.clobberOrigSrc = originalSrc;
        liveImg.src = blobUrl;
        imageQueue.set(blobUrl, { file, originalSrc, sourceImg, filename });
        updateDirty();
        if (oldW && oldH) {
          const oldAR = oldW/oldH, newAR = probe.width/probe.height;
          if (Math.abs(oldAR - newAR) / oldAR > 0.05) toast('Queued · aspect ratio differs','warn');
          else toast('Queued · ' + filename);
        } else {
          toast('Queued · ' + filename);
        }
      };
      probe.src = blobUrl;
    }

    // ── image delete ─────────────────────────────────────────────────
    function deleteImage(liveImg){
      const sourceImg = pairMap.get(liveImg);
      if (!sourceImg) return;
      if (!confirm('Remove this image from the page?\n\nThe file on disk is left alone — only the <img> tag is removed. Use Discard to undo.')) return;

      pendingDeletions.add(sourceImg);

      for (const [blobUrl, q] of imageQueue.entries()) {
        if (q.sourceImg === sourceImg) {
          URL.revokeObjectURL(blobUrl);
          imageQueue.delete(blobUrl);
          if (liveImg.dataset.clobberOrigSrc) liveImg.src = liveImg.dataset.clobberOrigSrc;
        }
      }

      liveImg.dataset.clobberDeleted = '1';
      liveImg.style.display = 'none';
      updateDirty();
      toast('Image removed');
    }

    // ── image path resolution ────────────────────────────────────────
    function pageDir(){ return FILE_PATH.split('/').slice(0,-1).join('/'); }
    function resolveImgPath(originalSrc, file){
      // External URLs → save locally using just the filename in an images/ dir
      if (/^https?:\/\//.test(originalSrc) || originalSrc.startsWith('//')) {
        let name = originalSrc.split('?')[0].split('/').pop() || 'image.png';
        // If URL has no extension, derive from MIME type or default to .jpg
        if (!name.includes('.')) {
          const ext = file && file.type ? ('.' + file.type.split('/').pop().replace('jpeg','jpg')) : '.jpg';
          name += ext;
        }
        const d = pageDir();
        return d ? d + '/images/' + name : 'images/' + name;
      }
      if (originalSrc.startsWith('/'))      return originalSrc.slice(1);
      if (originalSrc.startsWith('../../')) return originalSrc.replace(/^\.\.\/\.\.\//,'');
      if (originalSrc.startsWith('../'))    return originalSrc.replace(/^\.\.\//,'');
      const d = pageDir();
      return d ? d + '/' + originalSrc : originalSrc;
    }
    // Check if source points externally (needs src attribute update after save)
    function isExternalSrc(src){
      return /^(https?:)?\/\//.test(src);
    }

    // ── build patched HTML ───────────────────────────────────────────
    function buildPatchedHTML(){
      commitCurrentEdit();
      if (!sourceText) throw new Error('source not loaded');
      if (pendingPatches.size === 0 && pendingDeletions.size === 0) return sourceText;

      const ops = [];
      for (const p of pendingPatches.values()) {
        if (!p.pos || p.pos.closeStart < p.pos.openEnd) continue;
        ops.push({ start: p.pos.openEnd, end: p.pos.closeStart, text: p.newInner });
      }
      for (const sourceEl of pendingDeletions) {
        const pos = positionMap.get(sourceEl);
        if (!pos) continue;
        const rangeEnd = pos.closeEnd > pos.openEnd ? pos.closeEnd : pos.openEnd;
        let rangeStart = pos.openStart;
        while (rangeStart > 0 && (sourceText[rangeStart-1] === ' ' || sourceText[rangeStart-1] === '\t')) rangeStart--;
        if (rangeStart > 0 && sourceText[rangeStart-1] === '\n') rangeStart--;
        ops.push({ start: rangeStart, end: rangeEnd, text: '' });
      }
      if (ops.length === 0) return sourceText;
      ops.sort((a, b) => b.start - a.start);
      let out = sourceText;
      for (const op of ops) {
        out = out.slice(0, op.start) + op.text + out.slice(op.end);
      }
      return out;
    }

    // ── sanity check ─────────────────────────────────────────────────
    function sanityOk(oldText, newText){
      const oldLen = oldText.length, newLen = newText.length;
      const dBytes = Math.abs(newLen - oldLen);
      const dPct   = (dBytes / Math.max(oldLen, 1)) * 100;
      if (dBytes > CFG.suspiciousBytes || dPct > CFG.suspiciousPct) {
        return { ok:false, reason: 'Δ ' + dBytes + ' bytes (' + dPct.toFixed(1) + '%)' };
      }
      const oldLines = oldText.split('\n').length;
      const newLines = newText.split('\n').length;
      if (Math.abs(newLines - oldLines) > 50) {
        return { ok:false, reason: 'line count Δ ' + Math.abs(newLines - oldLines) };
      }
      return { ok:true };
    }

    // ── deploy ───────────────────────────────────────────────────────
    function deploy(){
      const hookUrl = deployBtn && deployBtn._hookUrl;
      if (!hookUrl) { toast('No deploy hook configured','warn'); return; }
      chrome.runtime.sendMessage({ action: 'deploy', hookUrl }, (response) => {
        if (chrome.runtime.lastError) { toast('Deploy failed: extension error','warn'); return; }
        if (response && response.ok) toast('Deployed');
        else toast('Deploy failed' + (response && response.error ? ': ' + response.error : ''),'warn');
      });
    }

    // ── save ─────────────────────────────────────────────────────────
    async function save(){
      if (!hasChanges()) { toast('No changes to save'); return; }
      if (initState !== 'ready') { toast('Clobber not ready yet','warn'); return; }

      const newHtml = buildPatchedHTML();
      const check = sanityOk(sourceText, newHtml);
      if (!check.ok) {
        if (!confirm('Sanity check failed: ' + check.reason +
                     '\n\nThis usually means a bug. Save anyway?')) {
          toast('Aborted by sanity check','warn'); return;
        }
      }

      // 1) File System Access API
      if (typeof window.showDirectoryPicker === 'function') {
        try {
          const root = await ensureRoot();

          // If any replaced images had external URLs, rewrite src to local paths
          let htmlToWrite = newHtml;
          for (const q of imageQueue.values()) {
            if (isExternalSrc(q.originalSrc)) {
              const localPath = resolveImgPath(q.originalSrc, q.file);
              htmlToWrite = htmlToWrite.split(q.originalSrc).join(localPath);
            }
          }

          // Backup must finish reading before we overwrite the same file
          await backupFile(root, FILE_PATH);
          await writeFile(root, FILE_PATH, htmlToWrite);

          // Write replacement images individually (don't let one failure kill the rest)
          let imgFails = 0;
          for (const q of imageQueue.values()) {
            try {
              const buf = await q.file.arrayBuffer();
              const target = resolveImgPath(q.originalSrc, q.file);
              backupFile(root, target).catch(()=>{});
              await writeFile(root, target, buf);
            } catch (imgErr) {
              imgFails++;
              console.warn('[clobber] image write failed:', q.originalSrc, imgErr.message);
            }
          }
          if (imgFails > 0) {
            toast('Saved HTML · ' + imgFails + ' image(s) failed','warn');
          } else {
            toast('Saved · ' + FILE_PATH.split('/').pop());
          }
          // Defer heavy re-parse so toast renders immediately
          // Use htmlToWrite (which may have updated src attrs) as the new baseline
          setTimeout(() => afterSave(htmlToWrite), 0);
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') { toast('Cancelled','warn'); return; }
          console.warn('[clobber] FS Access failed:', err);
        }
      }

      // 2) Optional helper
      if (CFG.helperUrl) {
        const images = [];
        for (const q of imageQueue.values()) {
          images.push({
            targetPath: resolveImgPath(q.originalSrc, q.file),
            filename:   q.filename,
            dataUrl:    await fileToDataUrl(q.file)
          });
        }
        try {
          const res = await fetch(CFG.helperUrl + '/save', {
            method: 'POST',
            headers: { 'Content-Type':'application/json' },
            body: JSON.stringify({ filePath: FILE_PATH, html: newHtml, images })
          });
          if (!res.ok) throw new Error('helper ' + res.status);
          const r = await res.json().catch(() => ({}));
          toast('Saved · ' + (r.wrote || FILE_PATH.split('/').pop()));
          setTimeout(() => afterSave(newHtml), 0);
          return;
        } catch (err) {
          console.warn('[clobber] helper unavailable:', err.message);
        }
      }

      // 3) Download fallback
      download(new Blob([newHtml], { type:'text/html' }), FILE_PATH.split('/').pop());
      for (const q of imageQueue.values()) download(q.file, q.filename);
      toast('Downloaded files','warn');
      setTimeout(() => afterSave(newHtml), 0);
    }

    function afterSave(newHtml){
      sourceText = newHtml;
      sourceDoc  = new DOMParser().parseFromString(newHtml, 'text/html');
      pairMap     = new WeakMap();
      positionMap = mapSourceToPositions(sourceDoc, parseSourcePositions(newHtml));
      pendingPatches.clear();
      pendingDeletions.clear();
      pairTrees(sourceDoc.body, document.body);
      textChanges.clear();
      imageQueue.forEach((q, b) => URL.revokeObjectURL(b));
      imageQueue.clear();
      updateDirty();
    }

    function discard(){
      if (!hasChanges()) return;
      if (!confirm('Discard all changes and reload the page?')) return;
      location.reload();
    }

    // ── File System Access plumbing ──────────────────────────────────
    const HDB = 'clobber-fs', HSTORE = 'h', HKEY = 'root';
    function idbOp(method, ...args){
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(HDB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(HSTORE);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(HSTORE, method === 'get' ? 'readonly' : 'readwrite');
          const op = tx.objectStore(HSTORE)[method](...args);
          op.onsuccess = () => resolve(op.result);
          op.onerror   = () => reject(op.error);
        };
      });
    }
    async function verifyRW(handle){
      if (!handle || !handle.queryPermission) return false;
      if ((await handle.queryPermission({ mode:'readwrite' })) === 'granted') return true;
      if ((await handle.requestPermission({ mode:'readwrite' })) === 'granted') return true;
      return false;
    }
    async function ensureRoot(){
      if (rootDirHandle && await verifyRW(rootDirHandle)) return rootDirHandle;
      try {
        const stored = await idbOp('get', HKEY);
        if (stored && await verifyRW(stored)) { rootDirHandle = stored; return rootDirHandle; }
      } catch(_){}
      const ok = confirm(
        'Clobber needs access to your project folder.\n\n' +
        'Choose the folder that contains "' + FILE_PATH + '" and any images you want to replace.\n\n' +
        'Clobber will read and write files in this folder. A file picker will open next.'
      );
      if (!ok) throw new DOMException('User cancelled folder picker', 'AbortError');
      rootDirHandle = await window.showDirectoryPicker({
        id: 'clobber-root', mode: 'readwrite', startIn: 'documents'
      });
      try { await idbOp('put', rootDirHandle, HKEY); } catch(_){}
      // Report folder name to storage for popup display
      chrome.storage.local.set({ 'clobber-folder': rootDirHandle.name });
      return rootDirHandle;
    }
    async function fileHandleAt(root, relPath, create){
      const parts = relPath.split('/').filter(Boolean);
      const filename = parts.pop();
      let dir = root;
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: !!create });
      return await dir.getFileHandle(filename, { create: !!create });
    }
    async function writeFile(root, relPath, body){
      const fh = await fileHandleAt(root, relPath, true);
      const w = await fh.createWritable();
      await w.write(body);
      await w.close();
    }
    async function backupFile(root, relPath){
      try {
        const fh = await fileHandleAt(root, relPath, false);
        const file = await fh.getFile();
        const buf = await file.arrayBuffer();
        const base = relPath.split('/').pop();
        const dot = base.lastIndexOf('.');
        const stem = dot > 0 ? base.slice(0, dot) : base;
        const ext  = dot > 0 ? base.slice(dot)    : '';
        const ts   = new Date().toISOString().replace(/[-:T]/g,'').slice(0,15);
        const backupDir = await root.getDirectoryHandle(CFG.backupDir, { create:true });
        const bh = await backupDir.getFileHandle(stem + '.' + ts + ext, { create:true });
        const w = await bh.createWritable();
        await w.write(buf);
        await w.close();
      } catch (err) {
        if (err && err.name !== 'NotFoundError') {
          console.warn('[clobber] backup skipped for', relPath, err.message);
        }
      }
    }
    function fileToDataUrl(file){
      return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
    }
    function download(blob, name){
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    // ── cleanup function (returned to deactivate) ────────────────────
    return function cleanup(){
      banner.remove();
      styleEl.remove();
      fileInput.remove();
      document.body.classList.remove('clobber-dirty', 'clobber-cmd');
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKeyDownDoc);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      if (editingEl) commitCurrentEdit();
      document.querySelectorAll('.clobber-done-pill,.clobber-toast').forEach(el => el.remove());
      chrome.runtime.sendMessage({ action: 'update-badge', count: 0 }, () => {
        if (chrome.runtime.lastError) { /* ok */ }
      });
    };
  }

})();
