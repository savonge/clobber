# Node Helper

`edit-helper.js` is an optional local server for browsers that don't support the File System Access API (Safari, Firefox). If you're using Chrome, Edge, Arc, or Brave, you don't need this. The extension handles file access directly.

## Setup

The helper has zero npm dependencies. It's a single Node.js file using only built-in modules (`http`, `fs`, `path`).

```bash
cd your-project-root
node path/to/edit-helper.js
```

It binds to `127.0.0.1:8787` by default. You should see:

```
clobber-helper
  root:    /Users/you/your-project
  listen:  http://localhost:8787
  backups: .clobber-backups
  Ctrl+C to stop.
```

The helper only accepts connections from localhost. It is not designed to be exposed to a network.

## How it works

Three endpoints:

- `GET /ping` returns `{ ok: true, root: "/absolute/path" }`. Clobber probes this on activation to check if the helper is available.
- `GET /source?path=<relative>` returns the raw HTML of the requested file. Used by the standalone editor when opening files via `file://` (where `fetch()` can't read the page's own URL due to CORS). Path traversal is blocked.
- `POST /save` accepts `{ filePath, html, images }` and writes the patched HTML and any replaced images to disk.

Every write is preceded by a timestamped backup of the existing file to the backup directory.

## Configuration

All configuration is via environment variables:

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` | Port the helper listens on |
| `CLOBBER_ROOT` | Current working directory | Project root. All writes are sandboxed to this directory |
| `CLOBBER_BACKUP_DIR` | `.clobber-backups` | Backup directory name (relative to root) |

Example with custom settings:

```bash
PORT=9000 CLOBBER_ROOT=~/sites/my-blog node edit-helper.js
```

## Security

The helper enforces two safety checks:

1. **Path traversal protection.** Every file path is resolved against the project root. If the resolved path escapes the root directory, the request is rejected.
2. **Extension allowlist.** Only files with approved extensions can be written: `.html`, `.htm`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.avif`. Requests targeting other file types are rejected.

The CORS headers are permissive but scoped to localhost. The helper binds to `127.0.0.1`, so it's unreachable from other machines on the network.

## Payload limits

The helper enforces a 50 MB ceiling on request bodies. This is generous enough for pages with several replaced images but prevents runaway writes.

## Backup format

Backups are written to the backup directory with a timestamp inserted before the extension:

```
.clobber-backups/index.20260515-143022.html
.clobber-backups/hero.20260515-143022.jpg
```

The backup directory is created automatically on first save.
