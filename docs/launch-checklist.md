# Launch Checklist

## Before Chrome Web Store submission

- [x] Extension icons created at 16x16, 48x48, and 128x128 px (PNG, placed in `src/icons/`) — placeholders; replace with final icons before submission
- [ ] Promotional images for the store listing:
  - [ ] Small tile: 440x280 px (required)
  - [ ] Marquee: 1400x560 px (optional but recommended)
- [ ] Screenshots: 1-5 screenshots at 1280x800 or 640x400 px
  - Suggested shots: hover hints visible, inline text editing, save banner, popup settings
- [ ] Privacy policy URL live (host PRIVACY.md on the repo or a standalone page)
- [x] Store listing copy finalized (see docs/store-listing.md)
- [x] manifest.json version set to 1.0.0
- [ ] Test the extension from a clean install (load unpacked, edit, save, verify file)
- [ ] Pay the Chrome Web Store developer registration fee ($5 one-time)
- [ ] Submit at https://chrome.google.com/webstore/devconsole

## Before GitHub public release

- [x] Phase 2 code cleanup complete (rename em-* to clobber-*, data-edit attributes, etc.)
- [x] All docs reference final naming conventions
- [x] Fix file:// loadSource() bug (fetch CORS fallback via FS Access)
- [x] README badge URLs updated (savonge)
- [x] Helper docs updated (CLOBBER_ROOT, CLOBBER_BACKUP_DIR, .clobber-backups)
- [ ] SECURITY.md: enable private vulnerability reporting in repo Settings > Security
- [ ] Repository description set: "Cmd-click to edit your own static sites. Chrome extension."
- [ ] Repository topics set: chrome-extension, static-sites, html-editor, developer-tools
- [ ] Create a GitHub Release tagged v1.0.0 with a zip of the src/ folder
- [x] Release zip of src/ prepared (clobber-v1.0.0.zip in repo root)

## Launch day

- [ ] Share on relevant channels (Twitter/X, Hacker News, Reddit r/webdev, etc.)
- [ ] Monitor GitHub issues for first-day bug reports
- [ ] Monitor Chrome Web Store reviews
