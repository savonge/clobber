# Chrome Web Store Listing

## Short description (132 char max)
Cmd-click to edit text and images on your own static sites. Saves write back to local files. No CMS, no build step.

## Detailed description

Clobber adds a Cmd-click editing layer to your own static HTML pages. Tag elements with data-edit attributes, hold Cmd (or Ctrl on Windows), and click to edit text inline or swap images via the file picker. Hit Save and changes write directly back to your local files through Chrome's File System Access API.

HOW IT WORKS

Normal visitors see a normal page. Links work, buttons work, nothing intercepts. The editing layer only activates for you through the extension.

When you save, Clobber doesn't serialize the browser's live DOM (which would bake in JavaScript-generated content and produce noisy git diffs). Instead, it fetches your source HTML, parses it into a separate document, and records each edit as a byte-range patch against the original string. On save, patches are spliced in reverse byte order so nothing outside an edited element moves. Git diffs show exactly what you changed.

FEATURES

- Inline text editing via contenteditable
- Image replacement via native file picker
- Image deletion (removes the tag from source)
- Undo history within a session
- Multi-page navigation across your site
- Local file save via File System Access API
- Optional deploy hook for Vercel
- Timestamped backups before every overwrite
- Source-DOM pairing prevents dynamic JS content from leaking into saves

SAFETY

Three independent safety nets: source-DOM pairing (dynamic content is structurally excluded), a pre-save sanity check on file size delta, and timestamped backups before every overwrite.

WHO THIS IS FOR

Developers and designers who maintain static HTML sites and want a faster way to make small content changes without the VS Code round-trip. No CMS, no framework, no build step required.

Open source under MIT: https://github.com/lironross/clobber

## Category
Developer Tools

## Language
English

## Tags (up to 5)
- static sites
- HTML editor
- content editing
- developer tools
- web development
