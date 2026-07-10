# MMM Studio Runtime

This package is the editor-free desktop shell used by the Publish & Build flow. It opens only a
published `/play/:sceneId` experience, so configurators, saved cameras, interactions, Firebase
presence, and chat remain identical between web and desktop exports.

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
