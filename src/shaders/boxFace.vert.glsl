uniform float uMirror;
varying vec2 vUv;

void main() {
  // Cap UVs are written from screen coordinates (u right, v down). Flipping V
  // matches the video layer, whose texture V grows upward after the flipY
  // upload. Mirror U keeps the selfie view consistent.
  vUv = vec2(uMirror > 0.5 ? 1.0 - uv.x : uv.x, 1.0 - uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
