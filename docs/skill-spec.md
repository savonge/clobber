# `/clobber` — Claude Code Skill Specification

## Overview

A Claude Code skill that turns any folder of static HTML files into a live visual editor. The user types `/clobber` and Claude sets everything up — no Chrome extension, no manual config. The user opens their HTML files in a browser, edits text and images inline, and changes save back to disk. `/clobber off` cleanly reverses everything.

---

## Repo Structure

The skill lives in the same repo as the Chrome extension. Both are install paths for the same core tool — shared helper, shared `data-edit` convention, shared editor logic. The repo is structured to make this clear:

```
clobber/
├── src/              # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── content/
│   │   └── clobber.js
│   ├── popup/
│   ├── background/
│   └── icons/
├── skill/            # Claude Code skill
│   ├── SKILL.md      # Skill definition (this file)
│   └── clobber.js    # Standalone editor script (always-on, helper-only saves)
├── helper/           # Shared Node helper — used by both install paths
│   └── edit-helper.js
├── docs/
└── README.md         # "Two ways to use Clobber" up top
```

The extension's `clobber.js` and the skill's `clobber.js` are related but different builds of the same editor. The extension version has Chrome messaging, IndexedDB directory handles, FS Access API, and an activation gate. The skill version strips all of that — always-on, helper-only, no browser API dependencies. They are not interchangeable and should not be merged into one file.

The shared `helper/edit-helper.js` is identical in both paths. The skill copies it into `.clobber/` at runtime; the extension user runs it manually if they're on Safari/Firefox.

---

## User Flow

```
User: /clobber
Claude: Scans HTML files, auto-tags elements, drops editor script + helper, starts server.
        "Done. Open index.html in your browser — everything is editable. Cmd-click to edit."

User: (edits visually in browser, saves with Cmd-S)

User: /clobber off
Claude: Strips injected tags, removes data-edit attributes, stops helper, deletes dropped files.
        "Cleaned up. Your HTML is back to its original state."
```

---

## What `/clobber` Does (Step by Step)

1. **Scan** — Find all `.html` and `.htm` files in the project (respecting .gitignore).

2. **Auto-tag** — For each HTML file, add `data-edit="key"` attributes to all eligible elements:
   - **Text elements**: `h1`–`h6`, `p`, `a`, `span`, `li`, `td`, `th`, `figcaption`, `blockquote`, `label`, `button`, `dt`, `dd`
   - **Images**: `img` elements with a `src` attribute
   - Skip elements that already have `data-edit` (user may have hand-tagged some)
   - Skip elements inside `<script>`, `<style>`, `<head>`, `<nav>`, `<footer>` (configurable)

3. **Generate keys** — Each `data-edit` value is a human-readable key derived from:
   - The filename (without extension) as a namespace prefix
   - The element's role/content, e.g. `index.hero-heading`, `about.team-photo-1`
   - Keys must be unique within a file

4. **Drop `clobber.js`** — Write the standalone editor script to `.clobber/clobber.js` in the project root. This is a self-contained ~800-line script (ported from the original `editmode.js`) that handles:
   - Source-DOM pairing (fetches source HTML, walks both trees)
   - Inline text editing (contentEditable on Cmd-click)
   - Image replacement (click-to-replace via file input)
   - Byte-range patching (minimal diffs, never serializes full DOM)
   - Save via helper server on localhost:8787
   - Visual UI: edit highlights on hover, save banner, unsaved-changes dot

5. **Drop `edit-helper.js`** — Write the Node helper server to `.clobber/edit-helper.js`. Zero dependencies. Handles:
   - `GET /ping` — health check
   - `POST /save` — writes patched HTML + replaced images to disk
   - Timestamped backups to `.clobber-backups/`
   - Path traversal protection, extension allowlist

6. **Inject script tags** — Add to every HTML file, just before `</body>`:
   ```html
   <!-- clobber:start -->
   <script src="/.clobber/clobber.js"></script>
   <!-- clobber:end -->
   ```
   For files in subdirectories, use a relative path back to root (e.g. `../.clobber/clobber.js`).

7. **Start the helper** — Run `node .clobber/edit-helper.js` in the background, with `CLOBBER_ROOT` set to the project directory. Print the URL and confirm it's listening.

8. **Add to .gitignore** — Append `.clobber/` and `.clobber-backups/` if not already present.

---

## What `/clobber off` Does

1. **Stop the helper** — Kill the running `edit-helper.js` process.

2. **Strip script tags** — Remove the `<!-- clobber:start -->` ... `<!-- clobber:end -->` block from every HTML file.

3. **Strip `data-edit` attributes** — Remove all `data-edit` attributes that were auto-added. (If the user hand-tagged elements before running `/clobber`, those should also be stripped — the skill owns all `data-edit` attributes.)

4. **Delete `.clobber/`** — Remove the dropped script and helper.

5. **Leave `.clobber-backups/`** — Don't delete backups. User may want them.

6. **Leave .gitignore entry** — Harmless to keep; avoids accidental commits if user re-runs `/clobber` later.

---

## The Standalone `clobber.js` Script

Based on the original `editmode.js` with the following changes:

| Original (`editmode.js`) | Skill version (`clobber.js`) |
|---|---|
| Activated by `?edit=1` query param | Always active (script present = editing on) |
| `em-*` CSS classes | `clobber-*` CSS classes |
| `data-em-text` / `data-em-img` | `data-edit` (unified attribute) |
| `EDITMODE_CONFIG` global | `CLOBBER_CONFIG` global |
| `localStorage['em-on']` | No localStorage gate needed |
| Helper URL configurable | Hardcoded to `http://localhost:8787` |
| Download fallback for saves | Helper-only (skill guarantees helper is running) |

### Activation Model

The script is always-on. If `clobber.js` is loaded, editing is active. No toggle, no query param, no localStorage flag. The skill's job is to inject/remove the script — that IS the on/off switch.

### Save Mechanism

Helper server only. The skill guarantees the helper is running, so there's no need for File System Access API or download fallbacks. This simplifies the script significantly.

### Source-DOM Pairing

Same as the extension version:
1. On load, fetch the page's own URL to get the raw source HTML
2. Parse source into a shadow DOM via DOMParser
3. Walk both trees in lockstep to pair live elements with source elements
4. Record byte offsets of each element's content in the source
5. On save, splice edits into source at recorded byte offsets (reverse order)

This preserves formatting, comments, and non-standard markup. Git diffs show only the changed text.

### What's Editable

Only elements with `data-edit` are editable. The script:
- Adds hover outlines to `data-edit` elements
- Shows a tooltip with the edit key on hover
- On Cmd-click: makes text elements contentEditable, or opens file picker for images
- Tracks dirty state per element

---

## File Layout After `/clobber`

```
project/
├── .clobber/
│   ├── clobber.js          # Standalone editor script
│   └── edit-helper.js      # Node save server
├── .clobber-backups/       # Created on first save (timestamped backups)
├── index.html              # Modified: data-edit attrs + script tag
├── about.html              # Modified: data-edit attrs + script tag
└── ...
```

---

## Key Naming Convention

Claude generates `data-edit` keys using this pattern:

```
{page}.{descriptor}
```

Examples:
- `index.hero-heading` — main h1 on index.html
- `index.hero-subtext` — subtitle paragraph
- `index.hero-image` — hero section image
- `about.team-photo-1` — first team photo
- `pricing.plan-basic-title` — heading in the basic plan card

Rules:
- Lowercase, hyphen-separated words
- Page prefix = filename without extension
- Descriptor = semantic name based on content/role
- Numbers appended for repeated similar elements (e.g. `feature-1`, `feature-2`)
- Must be unique within the file

---

## Configuration (Optional)

The skill can accept optional parameters:

```
/clobber --port 9000          # Use a different port for the helper
/clobber --skip nav,footer    # Don't tag elements inside these containers
/clobber --include header     # Also tag elements in header (excluded by default)
```

Defaults are sensible — most users just type `/clobber` with no args.

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| HTML file has no `</body>` | Append script tag at end of file |
| File already has `<!-- clobber:start -->` | Skip injection (idempotent) |
| Element already has `data-edit` | Skip tagging (preserve existing) |
| User opens HTML via `file://` (double-click) | Script detects `file://` and fetches source from helper via `GET /source?path=` instead of `fetch(location.href)` |
| Project uses a static server (e.g. `python -m http.server`) | Skill still starts its own helper on 8787; user opens pages via their own server |
| Binary/minified HTML | Tag it anyway — byte-range patching still works |
| Nested projects (HTML in subdirs) | Script src uses relative path to `.clobber/` at root |
| `/clobber` run twice | Idempotent — detects existing setup, skips or updates |

---

## What the Skill Does NOT Do

- Does not install any npm packages
- Does not modify `package.json`
- Does not require a build step
- Does not touch non-HTML files (CSS, JS, images are untouched)
- Does not need the Chrome extension installed
- Does not persist any state between sessions (each `/clobber` is fresh)
- Does not require internet access (all local)

---

## Implementation Notes

- The skill script (`clobber.js`) should be generated from the original `editmode.js` with the renames/simplifications listed above, not from the extension's `clobber.js` (which has Chrome messaging, IndexedDB handles, and other extension-specific code).
- The helper (`edit-helper.js`) is already ported and lives at `clobber-repo/helper/edit-helper.js`. The skill drops a copy into `.clobber/`.
- HTML file scanning should respect `.gitignore` patterns to avoid tagging files in `node_modules/`, `dist/`, etc.
- The skill should confirm the number of files and elements tagged before making changes.
