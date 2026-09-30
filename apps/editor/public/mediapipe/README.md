MediaPipe Face Landmarker (Apache License 2.0, https://github.com/google-ai-edge/mediapipe),
served to the character studio's face swap:

- `vision_wasm_internal.{js,wasm}`: the WASM runtime from `@mediapipe/tasks-vision` 1.0.1
  (`node_modules/@mediapipe/tasks-vision/wasm/`, the SIMD build). Keep it on the same version
  as the package.
- `face_landmarker.task`: the float16 model,
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
