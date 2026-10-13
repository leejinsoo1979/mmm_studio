MediaPipe Face Landmarker and Selfie Segmenter (Apache License 2.0, https://github.com/google-ai-edge/mediapipe),
served to the character studio's face swap and photo avatars:

- `vision_wasm_internal.{js,wasm}`: the WASM runtime from `@mediapipe/tasks-vision` 1.0.1
  (`node_modules/@mediapipe/tasks-vision/wasm/`, the SIMD build). Keep it on the same version
  as the package.
- `face_landmarker.task`: the float16 model,
  https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
- `selfie_segmenter.tflite`: the float16 square (256 × 256) selfie segmentation model, the person
  against the background, for a side photo's profile,
  https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/1/selfie_segmenter.tflite
  (sha256 `191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b`). Its model card
  ("Model Card MediaPipe Selfie Segmentation", Google, 2021) says: licensed under Apache License,
  Version 2.0.
