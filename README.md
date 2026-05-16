# Clobber

Cmd-click to edit text and images on your own static sites. Changes write back to your local files. No CMS, no build step, no framework required.

![Chrome Web Store](https://img.shields.io/badge/chrome-extension-4285F4?logo=googlechrome&logoColor=white)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

## Two ways to use Clobber

### 1. Chrome Extension
Install the extension, tag your HTML with `data-edit` attributes, and edit visually. Best for ongoing use — always available, no setup per session.

### 2. Claude Code Skill (`/clobber`)
Type `/clobber` in Claude Code and it sets everything up automatically — scans your HTML, tags elements, drops in the editor script and save server, and starts it. Type `/clobber off` to cleanly reverse everything. Best for quick editing sessions.

Both paths use the same `data-edit` convention, the same editing UX, and the same Node helper for saves.

---

## What it does

Tag elements in your HTML with `data-edit="key.name"`, then edit via the extension or the `/clobber` skill:

- **Cmd-click text** to edit it inline (contenteditable with a Done pill)
- **Cmd-click an image** to replace it via the native file picker
- **Cmd-Shift-click an image** to delete the `<img>` tag from source
- **Cmd-S** or hit the Save button to write everything back to disk

On Windows, Ctrl substitutes for Cmd everywhere.

Normal visitors see a normal page. Links work, buttons work, nothing intercepts. The editing layer only activates for you through the extension.

## Why this exists

Most "edit in the browser" tools serialize the live DOM when you save. That causes two problems that get worse over time:

1. **Dynamic content gets baked in.** If JavaScript populates a container at runtime (a card grid, a filtered list), the serializer captures that output. Next page load, the JS runs again and appends to the already-populated container. Each save doubles the dynamic content.

2. **Git diffs explode.** The browser's HTML serializer normalizes whitespace, attribute quoting, and entity encoding. A one-word edit produces a 50-line diff of cosmetic noise.

Clobber avoids both by never touching the live DOM at save time. Instead, it fetches your source HTML, parses it into a separate document, and records each edit as a byte-range patch against the original string. On save, patches are spliced in reverse byte order so nothing outside an edited element's content range moves. Git diffs show exactly what you changed.

## Install

### From source (development)

```
git clone https://github.com/savonge/clobber.git
```

1. Open `chrome://extensions` in Chrome, Edge, Arc, or Brave
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `src/` folder
4. Pin the Clobber icon in your toolbar

### Chrome Web Store

Coming soon.

## Quick start

### 1. Tag your elements

Add `data-edit` attributes to anything you want to be editable:

```html
<h1 data-edit="hero.title">Welcome to my site</h1>
<p data-edit="hero.subtitle">A short description here</p>
<img data-edit="hero.photo" src="images/hero.jpg" alt="Hero shot">
```

The `key.name` value is yours to organize however you want. Clobber uses it to identify elements across saves.

### 2. Grant folder access

The first time you save, Clobber asks you to pick your project's root folder using Chrome's File System Access API. This grants read/write permission to that directory. The handle is stored in IndexedDB so subsequent sessions just re-confirm with one click.

### 3. Edit and save

Hold Cmd (or Ctrl) to see dashed outlines on editable elements, then click to start editing. Hit Cmd-S or the floating Save button when you're done. Clobber writes the patched HTML (and any replaced images) back to disk, creating a timestamped backup of each overwritten file first.

### 4. Deploy (optional)

If you've set a Vercel deploy hook URL in the extension popup, clicking Deploy pushes your saved changes live. That's it. Edit, save, deploy, move on.

## How it works

### Source-DOM pairing

On activation, Clobber fetches the current page's source HTML and parses it into a second DOM (`sourceDoc`) via DOMParser. It then walks both trees in lockstep, building a `pairMap` that links each live element to its source counterpart.

When the trees diverge (an empty `<div>` in source that JavaScript has filled with cards in the live DOM), pairing stops at that branch. Children of dynamic containers have no source counterpart and are never marked editable. You literally cannot Cmd-click a JS-built element. That's the safety, not a bug.

### Byte-range patching

A position scanner walks the raw source string and records `{openStart, openEnd, closeStart, closeEnd}` for every element. Edits are stored as patches keyed by source element:

```
pendingPatches.set(sourceEl, { pos, newInner: '<new content>' })
```

Image deletions become byte-range removals (the `<img>` tag plus its leading whitespace, so the line vanishes cleanly).

At save time, all patches are collected as `{start, end, text}` operations, sorted in reverse byte order, and spliced into the original source string. Nothing outside an edited range moves.

### Save tiers

Clobber tries these in order:

1. **File System Access API** (Chrome, Edge, Arc, Brave) reads and writes your local files directly. First save prompts for the project root; the directory handle persists in IndexedDB.
2. **Node helper** (optional, for Safari/Firefox) is a zero-dependency local server (`edit-helper.js`) that accepts `POST /save` and writes to disk. See [helper docs](docs/helper.md).
3. **Download fallback** packages modified files as downloads for manual drop-in.

### Safety nets

Three independent layers stack behind every save:

- **Source-DOM pairing** ensures dynamic content can never leak into your HTML. If JavaScript built it, Clobber ignores it.
- **Sanity check** compares the patched HTML size to the original. If the delta exceeds a configurable threshold, you get a confirmation prompt before the write goes through.
- **Timestamped backups** copy each file to a backup directory before overwriting. Rollback is one copy away.

## Configuration

Click the Clobber toolbar icon to open settings:

| Setting | What it does |
|---|---|
| **Folder path** | Project root for File System Access (set on first save) |
| **Deploy hook URL** | Vercel deploy hook. Enables the Deploy button after save |

### Advanced (in-page config)

For granular control, set `window.CLOBBER_CONFIG` before the content script runs:

```html
<script>
  window.CLOBBER_CONFIG = {
    // CSS selector for containers that should never be editable
    blockSelectors: 'nav, footer, [data-no-edit]',

    // Sanity check thresholds
    suspiciousBytes: 5000,
    suspiciousPct: 10,

    // Which tags are eligible for inline text editing
    textTags: 'p,h1,h2,h3,h4,h5,h6,a,span,li,figcaption,em,strong,b',

    // Backup directory name (relative to project root)
    backupDir: '.clobber-backups',
  };
</script>
```

### Theming

Override the editor chrome via CSS variables:

```css
:root {
  --clobber-bg:     #1a1a1a;
  --clobber-fg:     #f4f4f4;
  --clobber-accent: #4a9eff;
}
```

## Multi-page support

Clobber navigates your entire site. Start at `index.html` and every subpage reachable within the granted folder is editable. The extension tracks which page you're on and writes patches to the correct file.

## What's in v1

- Inline text editing with contenteditable
- Image replacement via native file picker
- Image deletion (removes the `<img>` tag from source, leaves the file on disk)
- Undo history within a session
- Multi-page navigation across your site
- Local file save via File System Access API
- Optional Node helper for browsers without FS Access
- Download fallback for everything else
- Vercel deploy hook button
- Extension popup with settings (hook URL, folder path)

## What's not in v1

- Team/auth workflows
- Cloud sync or storage
- Image optimization or resizing
- Settings beyond the popup
- Deploy targets other than Vercel

These are all reasonable future additions. v1 ships the core editing loop.

## Limitations

- **Text-only inline editing.** You can edit an element's inner content, including inline tags like `<a>` and `<strong>`, but you cannot change attributes (href, alt, class) through the UI.
- **Static elements only.** Anything injected by JavaScript at runtime is intentionally non-editable. Source-DOM pairing is the mechanism; if it's not in the source HTML, it's not a valid edit target.
- **One edit per element per save.** Multiple edits to the same element are deduped to the latest one. Editing a parent and then a child applies the parent's captured innerHTML (which already includes the child's edit), so child patches are absorbed.
- **Chromium browsers for full functionality.** File System Access API is Chromium-only. The extension itself is Chrome/MV3. Safari and Firefox users can use the Node helper or download fallback, but not the extension.
- **No rich text toolbar.** There's no formatting bar. Inline tags in your source HTML are preserved, but adding new bold/italic/link markup means typing the HTML yourself in the contenteditable region.
- **Whitespace at element boundaries.** Inside an element's content range, you get what you typed. Outside the range, original source bytes are preserved verbatim.

## Project structure

```
clobber/
├── src/                          # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── content/
│   │   └── clobber.js            # Content script: the editor
│   ├── popup/
│   │   ├── popup.html            # Extension popup UI
│   │   ├── popup.js
│   │   └── popup.css
│   ├── background/
│   │   └── service-worker.js     # Deploy hook, badge updates
│   └── icons/
│       ├── clobber-16.png
│       ├── clobber-48.png
│       └── clobber-128.png
├── skill/                        # Claude Code skill (/clobber)
│   ├── SKILL.md                  # Skill definition
│   └── clobber.js                # Standalone editor (always-on, helper-only)
├── helper/
│   └── edit-helper.js            # Shared Node server (zero deps)
├── docs/
│   ├── how-it-works.md           # Deep dive on source-DOM + patching
│   ├── helper.md                 # Node helper setup and usage
│   ├── configuration.md          # Full config reference
│   └── skill-spec.md             # Skill development specification
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── PULL_REQUEST_TEMPLATE.md
├── README.md
├── CONTRIBUTING.md
├── LICENSE
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── .gitignore
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Short version: open an issue before a big PR, keep changes focused, test on at least one static site.

## License

[MIT](LICENSE)
