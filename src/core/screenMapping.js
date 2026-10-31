/**
 * Shared mapping from normalized MediaPipe landmarks to CSS-pixel screen
 * coordinates. The HUD and the Three.js overlay both use this so they always
 * line up, including object-fit: cover cropping and the mirrored selfie view.
 */
export function getCoverTransform(
  video,
  viewportWidth,
  viewportHeight,
  fallbackWidth,
  fallbackHeight,
  target = {},
) {
  const videoWidth = video?.videoWidth || fallbackWidth;
  const videoHeight = video?.videoHeight || fallbackHeight;
  const scale = Math.max(viewportWidth / videoWidth, viewportHeight / videoHeight);

  target.videoWidth = videoWidth;
  target.videoHeight = videoHeight;
  target.scale = scale;
  target.offsetX = (viewportWidth - videoWidth * scale) / 2;
  target.offsetY = (viewportHeight - videoHeight * scale) / 2;
  return target;
}

export function landmarkToScreen(landmark, transform, target = {}) {
  target.x = landmark.x * transform.videoWidth * transform.scale + transform.offsetX;
  target.y = landmark.y * transform.videoHeight * transform.scale + transform.offsetY;
  return target;
}
