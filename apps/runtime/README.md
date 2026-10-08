# MMM Studio Runtime

This package is the editor-free desktop shell used by the Publish & Build flow. It opens only a
published `/play/:sceneId` experience, so configurators, saved cameras, interactions, Firebase
presence, and chat remain identical between web and desktop exports.

## Dev

`bun dev` at the repo root also starts this shell (`electron .`) before the editor's Next server
is listening. Unpackaged, the shell shows a "에디터 서버를 기다리는 중…" page and polls
`<origin>/api/health` with backoff (up to 5 minutes), then checks `GET /api/scenes/<id>` for the
scene in `runtime-config.json` `playUrl` (or `MMM_PLAY_URL`). A scene that does not exist on this
server opens `<origin>/dashboard` instead, with one `[runtime]` log line saying so. The first
main-frame load that fails in a window's life is retried once; later failures are only logged.

Packaged builds skip all of this and open their published `playUrl` directly, retrying a failed
load once.

## Scene-specific build

```bash
node scripts/configure-runtime.mjs "https://studio.example.com/play/SCENE_ID" "Project name"
npm run build:mac
npm run build:windows
```

The macOS build produces an Apple Silicon DMG and ZIP. The Windows build produces x64 NSIS and
portable EXE files. Production workers configured through `MMM_MAC_BUILD_ENDPOINT` and
`MMM_WINDOWS_BUILD_ENDPOINT` run these commands, upload artifacts to Firebase Storage, and return
`{ jobId, status, downloadUrl }`.

Distribution builds require an Apple Developer ID with notarization credentials and a Windows
code-signing certificate. Keep those credentials in the build worker secret store; never commit
them to this repository.
