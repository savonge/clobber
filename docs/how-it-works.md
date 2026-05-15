# How Clobber Works

This doc covers the internals: why saves are built the way they are, how source-DOM pairing prevents dynamic content from leaking in, and what the byte-range patching system actually does. If you want to contribute to the save path or understand a tricky bug, start here.

## The problem with naive in-place editing

The obvious approach to "edit in the browser and save" is to let the user edit the live DOM, then serialize it back to HTML when they hit save. You'd clone `document.documentElement`, call `.outerHTML`, and write the result to disk.

This breaks in two specific and predictable ways.

**Dynamic content gets baked in.** Say your page has a `<div id="cards"></div>` that JavaScript populates with ten card elements on load. The live DOM contains those ten cards. If you serialize the entire document, those cards are now in the saved HTML. On the next page load, the JS runs again and appends ten more cards to the container that already has ten. Each save-then-reload cycle doubles the dynamic content. After a few rounds, the page is visibly broken.

**Git diffs become useless.** The browser's HTML serializer doesn't preserve your source formatting. It normalizes whitespace, re-quotes attributes, re-encodes entities, and reorders things. A one-word text edit produces a diff with fifty lines of cosmetic noise. You can't tell what actually changed, and code review becomes painful.

Clobber solves both by never serializing the live DOM.

## Source-DOM pairing

When Clobber activates, the first thing it does is fetch the current page's source HTML (the actual file, not the rendered DOM). It parses this into a second document using `DOMParser`, creating what we call the `sourceDoc`.

Then it walks both trees (source and live) in lockstep, building a `pairMap` that links every live element to its source counterpart:

```
pairMap: liveElement -> sourceElement
```

The walk descends both trees simultaneously, matching children by position and tag name. When the trees diverge, for example a `<div>` that's empty in source but full of JS-built cards in the live DOM, pairing stops at that branch. The JS-built children have no source counterpart.

This is the first safety layer. An element with no source pair is never marked editable. You can hold Cmd and hover over a JS-built card all day and nothing happens. The pairing gate prevents dynamic content from ever entering the edit flow, regardless of what other bugs might exist downstream.

## Byte-range position scanning

Alongside the DOMParser parse, Clobber runs a custom position scanner over the raw source string. This scanner walks the HTML character by character and records the exact byte positions of every element's opening and closing tags:

```
{
  tag: 'p',
  openStart: 1842,    // byte offset of '<p'
  openEnd: 1856,      // byte offset just past '>'
  closeStart: 1923,   // byte offset of '</p'
  closeEnd: 1927      // byte offset just past '>'
}
```

The scanner handles comments, `<!DOCTYPE>`, void elements (like `<img>`), raw-text containers (`<script>`, `<style>`), and self-closing tags. Each source-DOM element is mapped to its position entry via `positionMap`.

This means Clobber knows, for every editable element, exactly which bytes in the source file correspond to its inner content.

## Recording edits as patches

When you Cmd-click a text element and edit it, Clobber records the change as a patch keyed by the source element:

```
pendingPatches.set(sourceEl, {
  pos: positionMap.get(sourceEl),
  newInner: preserveEntities(liveEl.innerHTML)
})
```

The `pos` object tells us where the element's content lives in the source string (from `openEnd` to `closeStart`). The `newInner` is the edited content with special characters mapped back to HTML entities so source readability is preserved across saves.

Image deletions work similarly. The patch is a byte-range removal: the `<img>` tag's full range plus its leading whitespace and newline, so the line vanishes cleanly instead of leaving a blank.

## Applying patches at save time

When you hit Save, all pending patches and deletions are collected into a list of `{start, end, text}` operations. The list is sorted in reverse byte order (highest offset first) and applied sequentially to the original source string:

```
ops.sort((a, b) => b.start - a.start);
let out = sourceText;
for (const op of ops) {
  out = out.slice(0, op.start) + op.text + out.slice(op.end);
}
```

Reverse order is critical. If you apply patches from the start of the string forward, each splice shifts all subsequent byte offsets. By going backwards, earlier offsets remain valid because we haven't touched that part of the string yet.

The result: a patched HTML string where only the bytes inside edited elements have changed. Everything else, formatting, whitespace, comments, unrelated attributes, is byte-for-byte identical to the original. Git sees a minimal diff.

## Entity preservation

Browsers decode HTML entities when parsing. `&mdash;` becomes `—`, `&nbsp;` becomes a non-breaking space. If Clobber wrote the decoded characters back to the source file, you'd lose the named entities and the file would drift from your intended authoring style.

The `entityMap` configuration provides a decoded-character-to-named-entity mapping. Before writing any patch, Clobber runs the edited content through `preserveEntities()` to restore the named entities. The default map covers `&nbsp;`, `&middot;`, `&copy;`, `&mdash;`, and `&ndash;`, and you can extend it.

## After save

Once the patched HTML is written to disk, Clobber re-bases its internal state on the freshly saved content. The source text, source DOM, position map, and pair map are all rebuilt from the new file content. Pending patches and deletions are cleared. The next edit session starts from a clean baseline.

## The save tiers

Clobber tries three methods to actually write the patched content:

1. **File System Access API** (preferred). Chrome, Edge, Arc, and Brave support this. Clobber asks for a directory handle to your project root, then reads and writes files within that tree. The handle is stored in IndexedDB so you only need to re-confirm permission on subsequent sessions, not re-pick the folder.

2. **Node helper** (optional). A zero-dependency Node server (`edit-helper.js`) that listens on localhost and accepts `POST /save` with `{filePath, html, images}`. It validates that paths stay within the project root, restricts file extensions to a safe list, creates timestamped backups, and writes. This exists for browsers that don't support FS Access (Safari, Firefox).

3. **Download fallback**. Modified HTML and replaced images are packaged as browser downloads. The user drops them into the project manually. Not ideal, but it works everywhere.

## Backup strategy

Before every overwrite (in both the FS Access tier and the Node helper), the current file is copied to a backup directory with a timestamp in the filename:

```
.clobber-backups/index.20260515-143022.html
```

Rollback is a file copy. No database, no version history UI, just files on disk.
