# Holoframe
Real-time webcam hand-tracking AR app in the browser.
Stack: Vite (vanilla JS, ES modules), Three.js, @mediapipe/tasks-vision (pinned 1.2.0).

## Rules
- Keep all tunable values in src/config.js.
- No frameworks. Code must run at 30+ FPS.
- The camera image is mirrored (selfie view). Landmark-to-screen mapping must be shared
  between the HUD and the 3D scene so they always line up.
- Reuse objects in hot paths; avoid per-frame allocations where easy.
- Comment non-obvious math in English.
- Do not rewrite working modules; extend them. After each task run `npm run build`,
  then stop and wait for confirmation.

## Structure
- src/core: camera, hand tracking, smoothing (One Euro Filter)
- src/gestures: gesture detection
- src/hud: HUD canvas overlay
- src/scene: Three.js scene, shapes, materials
- src/shaders: GLSL
- public/models/hand_landmarker.task: MediaPipe model (do not delete)

## Planned gestures (config.js)
- Two-hand L-shape frame: panel (horizontal = neon pink/green, vertical = neon blue)
- Victory: purple triangles; open hands wide apart: big 3D box; fist: thermal filter toggle