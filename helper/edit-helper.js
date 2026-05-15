#!/usr/bin/env node
/*
  clobber-helper — optional local writer for Clobber extension
  ─────────────────────────────────────────────────────────────
  Run from your project root:
      node edit-helper.js

  Listens on http://localhost:8787 (configurable via PORT env) and accepts:
    GET  /ping             → liveness probe
    POST /save             → { filePath, html, images[] }

  Writes are sandboxed to the project root and limited to a small list of
  safe extensions. Every overwrite is preceded by a timestamped backup to
  .clobber-backups/ — set CLOBBER_BACKUP_DIR to change the directory name.

  Used for browsers without File System Access support (Safari, Firefox).
  Browsers that have FS Access skip this entirely.

  License: MIT
*/

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT       = Number(process.env.PORT || 8787);
const ROOT       = path.resolve(process.env.CLOBBER_ROOT || process.cwd());
const BACKUP_DIR = path.join(ROOT, process.env.CLOBBER_BACKUP_DIR || '.clobber-backups');
const ALLOWED_EXTS = new Set(['.html','.htm','.png','.jpg','.jpeg','.gif','.webp','.svg','.avif']);

function safeJoin(rel){
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT + path.sep) && full !== ROOT) {
    throw new Error('Path escapes project root: ' + rel);
  }
  const ext = path.extname(full).toLowerCase();
  if (!ALLOWED_EXTS.has(ext)) {
    throw new Error('Disallowed file extension: ' + ext);
  }
  return full;
}

function ts(){
  const d = new Date();
  const pad = n => String(n).padStart(2,'0');
  return d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate())
       + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
}

function backup(fullPath){
  if (!fs.existsSync(fullPath)) return null;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const base = path.basename(fullPath);
  const dot  = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const ext  = dot > 0 ? base.slice(dot)    : '';
  const dst  = path.join(BACKUP_DIR, stem + '.' + ts() + ext);
  fs.copyFileSync(fullPath, dst);
  return dst;
}

function writeImage(targetPath, dataUrl){
  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('Bad data URL for ' + targetPath);
  const buf  = Buffer.from(m[2], 'base64');
  const full = safeJoin(targetPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  backup(full);
  fs.writeFileSync(full, buf);
  return full;
}

function setCors(req, res){
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST,GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
}

function readBody(req){
  return new Promise((resolve, reject) => {
    let len = 0; const chunks = [];
    const MAX = 50 * 1024 * 1024;
    req.on('data', c => {
      len += c.length;
      if (len > MAX) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end',   () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  setCors(req, res);
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

  if (req.method === 'GET' && req.url === '/ping') {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ ok:true, root: ROOT }));
    return;
  }

  if (req.method !== 'POST' || req.url !== '/save') {
    res.statusCode = 404; res.end('Not found'); return;
  }

  try {
    const raw = await readBody(req);
    const { filePath, html, images } = JSON.parse(raw);
    if (typeof filePath !== 'string' || typeof html !== 'string') {
      throw new Error('Missing filePath or html');
    }

    const htmlFull = safeJoin(filePath);
    const backupPath = backup(htmlFull);
    fs.mkdirSync(path.dirname(htmlFull), { recursive: true });
    fs.writeFileSync(htmlFull, html, 'utf8');

    const imgsWritten = [];
    if (Array.isArray(images)) {
      for (const im of images) {
        if (!im || !im.targetPath || !im.dataUrl) continue;
        const full = writeImage(im.targetPath, im.dataUrl);
        imgsWritten.push(path.relative(ROOT, full));
      }
    }

    const wrote = path.relative(ROOT, htmlFull);
    console.log('[' + new Date().toISOString() + '] saved', wrote,
                imgsWritten.length ? ('+ ' + imgsWritten.length + ' image(s)') : '');

    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({
      ok: true,
      wrote,
      backup: backupPath ? path.relative(ROOT, backupPath) : null,
      images: imgsWritten
    }));
  } catch (err) {
    console.error('[clobber-helper] error:', err.message);
    res.statusCode = 400;
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ ok:false, error: err.message }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('clobber-helper');
  console.log('  root:    ' + ROOT);
  console.log('  listen:  http://localhost:' + PORT);
  console.log('  backups: ' + path.relative(ROOT, BACKUP_DIR));
  console.log('  Ctrl+C to stop.');
});
