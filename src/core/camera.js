import config from '../config.js';

export function showStatus(element, message, isError = false) {
  if (!element) return;

  if (!message) {
    element.textContent = '';
    element.hidden = true;
    element.classList.remove('is-error');
    return;
  }

  element.textContent = message;
  element.hidden = false;
  element.classList.toggle('is-error', isError);
}

export function describeCameraError(error) {
  const strings = config.ui.strings.camera;
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return strings.denied;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return strings.notFound;
    case 'NotReadableError':
    case 'TrackStartError':
      return strings.inUse;
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return strings.overconstrained;
    default:
      return strings.unknown.replace('{message}', error?.message ?? '?');
  }
}

export async function startCamera(video, statusElement) {
  if (!navigator.mediaDevices?.getUserMedia) {
    const message = config.ui.strings.camera.unsupported;
    showStatus(statusElement, message, true);
    throw new Error(message);
  }

  video.classList.add('camera-video');
  video.muted = true;
  video.playsInline = true;
  // Mirror the displayed video for a natural selfie view. Landmark mirroring is
  // handled separately in handTracker.js.
  video.style.transform = config.camera.mirror ? 'scaleX(-1)' : 'none';

  try {
    showStatus(statusElement, config.ui.strings.camera.requesting);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: config.camera.width },
        height: { ideal: config.camera.height },
        facingMode: config.camera.facingMode,
      },
    });

    video.srcObject = stream;
    await video.play();

    // The HUD needs real video dimensions to map normalized landmarks onto the
    // cover-scaled, full-window video.
    if (!video.videoWidth) {
      await new Promise((resolve) => {
        video.addEventListener('loadedmetadata', resolve, { once: true });
      });
    }

    showStatus(statusElement, '');
    return stream;
  } catch (error) {
    showStatus(statusElement, describeCameraError(error), true);
    throw error;
  }
}

export function stopCamera(video) {
  const stream = video?.srcObject;
  if (!stream) return;

  for (const track of stream.getTracks()) track.stop();
  video.srcObject = null;
}
