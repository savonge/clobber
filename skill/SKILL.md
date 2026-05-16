# /clobber

Turn this project's HTML files into a live visual editor. Cmd-click to edit text and images in the browser — saves write back to local files.

## When the user types `/clobber`

1. **Find HTML files** — Glob for `**/*.html` and `**/*.htm` in the project, respecting `.gitignore`. Skip files inside `node_modules/`, `dist/`, `build/`, `.clobber/`, and `.clobber-backups/`.

2. **Auto-tag elements** — For each HTML file, parse the markup and add `data-edit="key"` attributes to eligible elements:
   - **Text**: `h1`–`h6`, `p`, `a`, `span`, `li`, `td`, `th`, `figcaption`, `blockquote`, `label`, `button`, `dt`, `dd`
   - **Images**: `img` elements with a `src` attribute
   - Skip elements that already have `data-edit`
   - Skip elements inside `<script>`, `<style>`, `<head>`

   **Key format**: `{page}.{descriptor}` — lowercase, hyphen-separated.
   - Page prefix = filename without extension
   - Descriptor = semantic name based on content/role
   - Must be unique within the file
   - Examples: `index.hero-heading`, `about.team-photo-1`, `pricing.plan-basic-title`

3. **Drop `.clobber/`** — Create a `.clobber/` directory at the project root containing:
   - `clobber.js` — copy from this skill's directory (the standalone editor script)
   - `edit-helper.js` — copy from `helper/edit-helper.js` in the Clobber repo

   The Clobber repo lives at: `~/Documents/Clobber/clobber-repo/`
   - Skill script: `~/Documents/Clobber/clobber-repo/skill/clobber.js`
   - Helper: `~/Documents/Clobber/clobber-repo/helper/edit-helper.js`

4. **Inject script tags** — In every HTML file, add just before `</body>` (or at end of file if no `</body>`):
   ```html
   <!-- clobber:start -->
   <script src="{relative-path-to-.clobber}/clobber.js"></script>
   <!-- clobber:end -->
   ```
   Compute the relative path from the HTML file to `.clobber/` at the project root.
   If the file already has `<!-- clobber:start -->`, skip it (idempotent).

5. **Update .gitignore** — Append these lines if not already present:
   ```
   .clobber/
   .clobber-backups/
   ```

6. **Start the helper** — Run `node .clobber/edit-helper.js` in the background with `CLOBBER_ROOT` set to the project root. Confirm it's listening on localhost:8787.

7. **Report** — Tell the user:
   - How many files were tagged
   - How many elements are editable
   - That they can open any HTML file in the browser (served via localhost or file://) and Cmd-click to edit
   - That Cmd-S saves changes to disk

## When the user types `/clobber off`

1. **Stop the helper** — Kill the running `edit-helper.js` process (find it by port 8787 or process name).

2. **Strip script tags** — Remove the `<!-- clobber:start -->` through `<!-- clobber:end -->` block (inclusive) from every HTML file.

3. **Strip `data-edit` attributes** — Remove all `data-edit="..."` attributes from every HTML file. Use a regex: `\s*data-edit="[^"]*"` to cleanly remove the attribute and its preceding whitespace.

4. **Delete `.clobber/`** — Remove the directory and its contents.

5. **Leave `.clobber-backups/`** — Don't touch backups.

6. **Leave `.gitignore`** — The entries are harmless to keep.

7. **Report** — Confirm cleanup is complete and files are back to their original state.

## Arguments

- `/clobber` — default, no args needed
- `/clobber off` — clean up and reverse everything
- `/clobber --port 9000` — use a different port for the helper
