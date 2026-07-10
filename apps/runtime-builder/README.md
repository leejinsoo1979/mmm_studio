# Runtime builder worker

Run this service on a signed macOS build machine for macOS and Windows cross-builds. It serializes
scene build jobs, creates the editor-free Electron package, uploads the artifact to Firebase
Storage, records status in `runtimeBuildJobs`, and returns a signed download URL.

Required environment variables:

- `GOOGLE_APPLICATION_CREDENTIALS` or workload identity for Firebase Admin
- `FIREBASE_STORAGE_BUCKET`
- `MMM_BUILDER_TOKEN`
- `PORT` (optional, defaults to `8080`)

The editor server points `MMM_MAC_BUILD_ENDPOINT` and `MMM_WINDOWS_BUILD_ENDPOINT` to `/jobs` on
this worker and uses the same `MMM_BUILDER_TOKEN`.
