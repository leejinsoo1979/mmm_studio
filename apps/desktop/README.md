# MMM Studio — Desktop Editor

Electron shell that ships the full editor as an installable app. Scenes stay
local-first (`~/.pascal/data/pascal.db`), so the desktop editor works offline.

## Dev

Run the regular dev server, then open the shell against it:

```bash
bun dev                            # repo root — editor on :3002
cd apps/desktop && bun run start   # Electron window loading localhost:3002
```

`MMM_DESKTOP_URL` overrides the URL the dev shell loads.

## Package

```bash
cd apps/desktop
bun run build:mac       # DMG + ZIP in apps/desktop/dist/
bun run build:windows   # NSIS installer + portable exe
```

Packaging runs `scripts/bundle-editor.mjs` first: it builds the editor with
`output: 'standalone'` and stages the self-contained server under `bundle/`.
The packaged app boots that server on `127.0.0.1:3521` (Electron utility
process) and opens the window against it — no external services required.
