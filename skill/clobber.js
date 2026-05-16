/*
  Clobber — standalone inline editor for static HTML sites
  ─────────────────────────────────────────────────────────
  Dropped into projects by the /clobber Claude Code skill.
  Always-on: if this script is loaded, editing is active.
  Saves go through the clobber-helper on localhost:8787.

  Cmd-hold to see hover hints. Cmd-click text to edit.
  Cmd-click image to replace. Cmd-Shift-click image to remove.
  Cmd-S or the Save button writes to disk via the helper.

  Source-DOM pairing ensures only source-present elements are
  editable. Byte-range patching keeps git diffs minimal.

  Configuration (all optional):
    window.CLOBBER_CONFIG = {
      helperUrl:       'http://localhost:8787',
      backupDir:       '.clobber-backups',
      blockPaths:      [/-legacy\.html$/],
      blockSelectors:  'nav, footer',
      suspiciousBytes: 5000,
      suspiciousPct:   10,
      textTags:        'p,h1,h2,h3,h4,h5,h6,a,span,li,td,th,figcaption,blockquote,label,button,dt,dd',
      entityMap:       { ' ': '&nbsp;', '·': '&middot;', '©': '&copy;', '—': '&mdash;', '–': '&ndash;' },
    };

  License: MIT
*/
/* CLOBBER_MARKER_V1 — identifier used to strip this script on cleanup */
(function(){
  // ── config (defaults merged with user overrides) ────────────────
  const CFG = Object.assign({
    helperUrl: 'http://localhost:8787',
    backupDir: '.clobber-backups',
    blockPaths: [],
    blockSelectors: '',
    suspiciousBytes: 5000,
    suspiciousPct: 10,
    textTags: 'p,h1,h2,h3,h4,h5,h6,a,span,li,td,th,figcaption,blockquote,label,button,dt,dd',
    entityMap: {
      ' ': '&nbsp;',
      '·': '&middot;',
      '©': '&copy;',
      '—': '&mdash;',
      '–': '&ndash;'
    }
  }, window.CLOBBER_CONFIG || {});

  // ── resolve project root + this page's path from script URL ─────
  const scriptEl = document.currentScript;
  let rootUrl = '';
  if (scriptEl && scriptEl.src) {
    const dataRoot = scriptEl.getAttribute('data-root');
    rootUrl = dataRoot
      ? new URL(dataRoot, scriptEl.src).href
      : new URL('./', scriptEl.src).href;
  }
  function derivePath(){
    const href = location.href.split('?')[0].split('#')[0];
    if (rootUrl && href.startsWith(rootUrl)) {
      return decodeURIComponent(href.slice(rootUrl.length)) || 'index.html';
    }
    if (location.protocol === 'file:') {
      // On file://, pathname is the full OS path. Use just the filename
      // (or relative path from project root if script src tells us).
      const pathname = decodeURIComponent(location.pathname);
      if (scriptEl && scriptEl.getAttribute('src')) {
        // Script src is like ".clobber/clobber.js" or "../.clobber/clobber.js"
        // The script's resolved directory is .clobber/, so parent = project root
        const scriptUrl = new URL(scriptEl.src);
        const scriptDir = decodeURIComponent(scriptUrl.pathname).replace(/\/[^/]+$/, '/');
        // scriptDir ends with /.clobber/, so project root is one level up
        const projectRoot = scriptDir.replace(/\.clobber\/$/, '');
        if (pathname.startsWith(projectRoot)) {
          return pathname.slice(projectRoot.length) || 'index.html';
        }
      }
      // Fallback: just the filename
      return pathname.split('/').pop() || 'index.html';
    }
    return decodeURIComponent(location.pathname).replace(/^\//, '') || 'index.html';
  }
  const FILE_PATH = derivePath();

  // Block-list check (config.blockPaths is an array of RegExp)
  for (const re of CFG.blockPaths) {
    if (re && re.test && re.test(FILE_PATH)) return;
  }

  // ── state ────────────────────────────────────────────────────────
  let sourceDoc  = null;
  let sourceText = '';
  let initState  = 'idle';      // idle | loading | ready | error
  let pairMap            = new WeakMap();  // liveEl   -> sourceEl
  let positionMap        = new WeakMap();  // sourceEl -> position info
  const pendingPatches   = new Map();      // sourceEl -> { newInner, pos }
  const pendingDeletions = new Set();      // sourceEl entries to remove entirely
  const textChanges      = new Set();
  const imageQueue       = new Map();      // blobUrl  -> { file, originalSrc, sourceImg, filename }
  let editingEl     = null;

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

    body.clobber-cmd [data-edit]:hover{outline:1px dashed var(--clobber-dim);outline-offset:4px;cursor:text}
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
  banner.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'save')    save();
    else if (b.dataset.act === 'discard') discard();
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
      if (location.protocol === 'file:') {
        // file:// can't fetch itself — get source from the helper
        const res = await fetch(CFG.helperUrl + '/source?path=' + encodeURIComponent(FILE_PATH));
        if (!res.ok) throw new Error('helper /source ' + res.status);
        html = await res.text();
      } else {
        const res = await fetch(location.href, { cache:'no-store' });
        if (!res.ok) throw new Error('fetch ' + res.status);
        html = await res.text();
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
  loadSource();

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
    // Text elements with data-edit
    document.querySelectorAll(CFG.textTags).forEach(el => {
      if (isOutOfScope(el) || isUiNode(el)) return;
      if (!pairMap.has(el)) return;
      if (!el.hasAttribute('data-edit')) return;
      if (!el.textContent.trim()) return;
      // Already marked by the skill's auto-tagger — leave as-is
    });
    // Images with data-edit — same, already tagged
  }

  function nearestEditableText(el){
    let cur = el;
    while (cur && cur !== document.body) {
      if (cur.nodeType === 1 && cur.hasAttribute('data-edit') && cur.tagName !== 'IMG') return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function isEditableImg(el){
    return el && el.tagName === 'IMG' && el.hasAttribute('data-edit') && pairMap.has(el);
  }

  // ── Cmd-key hover hints ──────────────────────────────────────────
  function setCmd(on){ document.body.classList.toggle('clobber-cmd', !!on); }
  window.addEventListener('keydown', e => { if (e.key==='Meta'||e.key==='Control') setCmd(true); });
  window.addEventListener('keyup',   e => { if (e.key==='Meta'||e.key==='Control') setCmd(false); });
  window.addEventListener('blur',    () => setCmd(false));

  // ── click handler ────────────────────────────────────────────────
  document.addEventListener('click', async (e) => {
    if (isUiNode(e.target)) return;
    if (!(e.metaKey || e.ctrlKey)) return;
    if (isOutOfScope(e.target)) return;

    if (initState !== 'ready') {
      e.preventDefault(); e.stopPropagation();
      toast('Setting up clobber…');
      await loadSource();
      if (initState !== 'ready') { toast('Init failed','warn'); return; }
      toast('Ready — Cmd-click again to edit');
      return;
    }

    if (isEditableImg(e.target)) {
      e.preventDefault(); e.stopPropagation();
      if (e.shiftKey) deleteImage(e.target);
      else            startImgReplace(e.target);
      return;
    }
    const textEl = nearestEditableText(e.target);
    if (textEl && pairMap.has(textEl)) {
      e.preventDefault(); e.stopPropagation();
      startEdit(textEl);
    }
  }, true);

  document.addEventListener('mousedown', e => {
    if (!editingEl) return;
    if (editingEl.contains(e.target)) return;
    if (isUiNode(e.target)) return;
    commitCurrentEdit();
  }, true);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && editingEl) commitCurrentEdit();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && hasChanges()) {
      e.preventDefault(); save();
    }
  });

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
    if (/^https?:/.test(originalSrc)) {
      // External URL — map to local images/ directory
      let urlFilename = originalSrc.split('?')[0].split('/').pop();
      // If URL has no extension, derive from MIME type or default to .jpg
      if (!urlFilename.includes('.')) {
        const ext = file && file.type ? ('.' + file.type.split('/').pop().replace('jpeg','jpg')) : '.jpg';
        urlFilename += ext;
      }
      const d = pageDir();
      return d ? d + '/images/' + urlFilename : 'images/' + urlFilename;
    }
    if (originalSrc.startsWith('/'))      return originalSrc.slice(1);
    if (originalSrc.startsWith('../../')) return originalSrc.replace(/^\.\.\/\.\.\//,'');
    if (originalSrc.startsWith('../'))    return originalSrc.replace(/^\.\.\//,'');
    const d = pageDir();
    return d ? d + '/' + originalSrc : originalSrc;
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

  // ── save (helper only) ──────────────────────────────────────────
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

    // Build image payload
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
      afterSave(newHtml);
    } catch (err) {
      console.error('[clobber] save failed:', err);
      toast('Save failed — is clobber-helper running?','warn');
    }
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

  // ── utility ──────────────────────────────────────────────────────
  function fileToDataUrl(file){
    return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  }
})();
