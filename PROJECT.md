# Clobber — Project Description

## One-liner

A Chrome extension that lets you Cmd-click any text or image on your own static site and edit it in place, writing changes back to your local files without ever serializing the live DOM.

## What it is

Clobber is a Manifest V3 Chrome extension that adds an invisible editing layer to static HTML sites. You tag elements in your HTML with `data-edit="key.name"`, install the extension, and hold Cmd (Ctrl on Windows) to see dashed outlines on editable elements. Cmd-click text to edit it inline. Cmd-click an image to replace it via the native file picker. Cmd-Shift-click an image to delete the `<img>` tag from source. Cmd-S to save everything back to disk.

Normal visitors see a normal page. Links work, buttons work, nothing intercepts. The editing layer only activates for you through the extension.

## Who it's for

Developers and designers who maintain static HTML sites and want a faster way to make small content changes without the VS Code round-trip. No CMS, no framework, no build step, no dependencies.

## The core problem it solves

Most "edit in the browser" tools serialize the live DOM when you save. This causes two problems that compound over time:

**Dynamic content gets baked in.** If JavaScript populates a container at runtime (a card grid, a filtered list), the serializer captures that output as static HTML. Next page load, the JS runs again and appends to the already-populated container. Each save doubles the dynamic content until the page visibly breaks.

**Git diffs become useless.** The browser's HTML serializer normalizes whitespace, re-quotes attributes, and re-encodes entities. A one-word text edit produces a diff with fifty lines of cosmetic noise. Code review becomes guesswork.

Clobber avoids both by never touching the live DOM at save time.

## How it works

### Source-DOM pairing

When Clobber activates, it fetches the current page's source HTML (the actual file on disk, not the rendered DOM) and parses it into a second document via DOMParser. It walks both trees in lockstep, building a map that links every live element to its source counterpart.

When the trees diverge (a `<div>` that's empty in source but JavaScript has filled with cards in the live DOM), pairing stops at that branch. Elements with no source pair are never marked editable. You literally cannot Cmd-click a JS-built element. That's the safety mechanism.

### Byte-range patching

A position scanner walks the raw source string and records the exact byte offsets of every element's opening and closing tags. Edits are stored as patches keyed by source element:

```
pendingPatches.set(sourceEl, { pos, newInner })
```

At save time, all patches are collected as `{start, end, text}` operations, sorted in reverse byte order, and spliced into the original source string. Reverse order ensures earlier offsets remain valid as later portions are modified. Nothing outside an edited element's content range moves. Git diffs show exactly what changed.

### Save tiers

Clobber tries three methods in order:

1. **File System Access API** (Chrome, Edge, Arc, Brave) reads and writes local files directly. First save prompts for the project root directory; the handle persists in IndexedDB across sessions.
2. **Node helper** (optional) is a zero-dependency local server for browsers without FS Access (Safari, Firefox). Accepts POST /save with the patched HTML and any replacement images.
3. **Download fallback** packages modified files as browser downloads for manual drop-in.

### Safety nets

Three independent layers stack behind every save:

- **Source-DOM pairing** ensures dynamic content can never leak into your HTML. If JavaScript built it, Clobber ignores it.
- **Sanity check** compares the patched HTML size to the original. If the byte delta exceeds a configurable threshold, a confirmation dialog blocks the write.
- **Timestamped backups** copy each file to `.clobber-backups/` before overwriting. Rollback is one file copy.

## Extension architecture

```
src/
  manifest.json              MV3 manifest
  content/clobber.js         Content script: editor core (~900 lines)
  popup/popup.html|js|css    Extension popup: toggle, deploy hook, folder display
  background/service-worker.js   Deploy hook handler, badge updates
  icons/clobber-16|48|128.png    Extension icons

helper/
  edit-helper.js             Optional Node server for non-Chromium browsers (~155 lines)
```

**Total codebase: ~1,140 lines of plain JavaScript. No framework, no build step, no transpilation.**

### Content script (clobber.js)

The editor. Handles activation/deactivation via extension messaging, source fetching, tree pairing, position scanning, inline text editing (contenteditable + Done pill), image replacement, image deletion, byte-range patch assembly, File System Access I/O, helper fallback, download fallback, backup creation, and UI (banner, toasts, hover hints).

Activation is message-driven: the popup sends `toggle-clobber`, the content script activates or deactivates. State persists per domain (per file on `file://` URLs) via `chrome.storage.local`. A `?clobber=1` query param is supported as a debug override.

### Popup (popup.html/js/css)

Minimal dark-themed popup with:
- On/off toggle for the current tab
- Deploy hook URL input (saved to chrome.storage.local)
- Project folder display (read-only, set by the content script)
- Status line: "Active on this page" / "Inactive" / "No data-edit elements found"

### Service worker (service-worker.js)

Two responsibilities:
- **Deploy hook**: receives a message with a Vercel hook URL, fires a POST, reports success/failure back.
- **Badge**: sets the extension badge text to show pending change count per tab.

### Node helper (edit-helper.js)

Zero-dependency HTTP server for Safari/Firefox users. Binds to localhost:8787, accepts GET /ping and POST /save. Validates paths stay within the project root, restricts extensions to a safe list, creates timestamped backups, writes files. Configurable via PORT, CLOBBER_ROOT, and CLOBBER_BACKUP_DIR environment variables.

## User-facing features (v1)

- Inline text editing via contenteditable with a floating Done pill
- Image replacement via native file picker
- Image deletion (removes the `<img>` tag from source, leaves the file on disk)
- Undo: Discard button reloads the page, reverting all in-memory changes
- Multi-page navigation: start at index.html, every subpage within the granted folder is editable
- Local file save via File System Access API
- Optional Node helper for browsers without FS Access
- Download fallback for everything else
- Vercel deploy hook button (appears in the banner only when a hook URL is configured)
- Extension popup with settings
- Per-domain activation state that persists across page reloads
- Cmd-hold hover hints showing which elements are editable
- Timestamped backups before every overwrite
- Configurable block selectors, sanity thresholds, entity maps, and CSS theming

## What's not in v1

- Team/auth workflows
- Cloud sync or storage
- Image optimization or resizing
- Rich text toolbar (no formatting bar; inline tags like `<a>` and `<strong>` are preserved but adding new markup means typing HTML)
- Settings beyond the popup
- Deploy targets other than Vercel
- Attribute editing (href, alt, class, etc.)

## Configuration

### data-edit attributes

Tag any element you want editable:

```html
<h1 data-edit="hero.title">Welcome to my site</h1>
<p data-edit="hero.subtitle">A short description</p>
<img data-edit="hero.photo" src="images/hero.jpg" alt="Hero">
```

The key is yours to organize however you want. Clobber uses it to identify edit targets. Text elements get text editing behavior. `<img>` elements get image replace/delete behavior. Elements without `data-edit` are never editable regardless of source-DOM pairing.

### In-page config

```html
<script>
  window.CLOBBER_CONFIG = {
    blockSelectors: 'nav, footer, [data-no-edit]',
    backupDir: '.clobber-backups',
    suspiciousBytes: 5000,
    suspiciousPct: 10,
    entityMap: { ' ': '&nbsp;', '·': '&middot;' }
  };
</script>
```

### CSS theming

```css
:root {
  --clobber-bg:     #1a1a1a;
  --clobber-fg:     #f4f4f4;
  --clobber-accent: #4a9eff;
}
```

## Limitations

- **Static elements only.** Anything injected by JavaScript at runtime is intentionally non-editable.
- **One edit per element per save.** Multiple edits to the same element keep the latest.
- **Chromium for full functionality.** File System Access API is Chromium-only. Safari/Firefox users need the Node helper or download fallback.
- **No rich text toolbar.** You can type HTML in the contenteditable region, but there's no WYSIWYG formatting bar.
- **Whitespace at element boundaries.** Inside an element's content range, you get what you typed. Outside the range, original source bytes are preserved verbatim.
- **file:// URLs require the directory picker.** The first Cmd-click on a local file will prompt you to select the project folder. This is a one-time gesture requirement from the File System Access API.

## Technical decisions

- **No build step.** The extension is plain JavaScript loaded directly by Chrome. No bundler, no transpiler, no node_modules.
- **No framework.** The popup is 60 lines of vanilla JS. The content script is a single IIFE.
- **Byte-range patching over DOM serialization.** The entire save architecture exists to produce minimal, predictable git diffs.
- **Source-DOM pairing as a structural safety gate.** Not a filter, not a heuristic. If the source tree doesn't have it, it cannot be edited.
- **Extension messaging for activation.** No URL hacks, no localStorage flags (except debug override). Activation state flows through chrome.storage.local and chrome.runtime.onMessage.

## Creator

Liron Ross

## License

MIT
