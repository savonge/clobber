# Configuration Reference

Clobber has two layers of configuration: the extension popup (for common settings) and an optional in-page config object (for advanced control).

## Extension popup

Click the Clobber icon in your toolbar to access these:

| Setting | Description |
|---|---|
| **Folder path** | The project root directory. Set automatically on first save via the File System Access directory picker. Stored in IndexedDB and persists across sessions. |
| **Deploy hook URL** | A Vercel deploy hook URL. When set, a Deploy button appears after saving. Clicking it fires a POST to the hook, triggering a production deploy. |

## In-page config

For site-specific behavior, define `window.CLOBBER_CONFIG` in a script tag before the Clobber content script runs:

```html
<script>
  window.CLOBBER_CONFIG = {
    blockSelectors: 'nav, footer, [data-no-edit]',
    suspiciousBytes: 5000,
    suspiciousPct: 10,
    textTags: 'p,h1,h2,h3,h4,h5,h6,a,span,li,figcaption,em,strong,b',
    backupDir: '.clobber-backups',
    entityMap: {
      '\u00a0': '&nbsp;',
      '\u00b7': '&middot;',
      '\u00a9': '&copy;',
      '\u2014': '&mdash;',
      '\u2013': '&ndash;'
    }
  };
</script>
```

### Config options

**blockSelectors** `string`
Default: `'nav, footer'`

CSS selector for ancestor containers whose contents should never be editable, even if they have `data-edit` attributes. Useful for navigation, footers, or any section you don't want to accidentally modify.

```js
blockSelectors: 'nav, footer, .sidebar, [data-no-edit]'
```

**suspiciousBytes** `number`
Default: `5000`

If the patched HTML differs from the original by more than this many bytes, Clobber shows a confirmation dialog before saving. This catches bugs where dynamic content might have leaked into the save (the exact scenario source-DOM pairing is designed to prevent, but defense in depth is the point).

**suspiciousPct** `number`
Default: `10`

Same as above but as a percentage of the original file size. Either threshold triggers the confirmation.

**textTags** `string`
Default: `'p,h1,h2,h3,h4,h5,h6,a,span,li,figcaption,em,strong,b'`

Comma-separated list of tag names eligible for inline text editing. Only elements matching these tags (that also have a source-DOM pair and aren't inside a blocked container) get the editable marker.

**backupDir** `string`
Default: `'.clobber-backups'`

Name of the backup directory relative to the project root. Created automatically on first save.

**entityMap** `object`
Default: `{ '\u00a0': '&nbsp;', '\u00b7': '&middot;', '\u00a9': '&copy;', '\u2014': '&mdash;', '\u2013': '&ndash;' }`

Maps decoded characters back to named HTML entities before writing patches to disk. This prevents the browser's entity decoding from silently changing your source authoring style. Extend this map if your HTML uses other named entities you want to preserve.

## CSS theming

The editor chrome (banner, toast, done pill, hover outlines) is styled via CSS custom properties. Override them on `:root` to match your site's look:

```css
:root {
  --clobber-bg:     #1a1a1a;   /* Banner background */
  --clobber-fg:     #f4f4f4;   /* Banner text */
  --clobber-accent: #4a9eff;   /* Buttons, outlines, done pill */
}
```

The defaults are a dark theme with warm off-white text. The editor chrome uses `color-mix()` and `backdrop-filter` for translucency, so it adapts reasonably well to most backgrounds without customization.

## Script tag attributes

If Clobber lives in a subdirectory rather than the project root, use the `data-root` attribute on the script tag to tell it where root is:

```html
<script src="assets/js/clobber.js" data-root="../../"></script>
```

The path is resolved relative to the script's own URL.
