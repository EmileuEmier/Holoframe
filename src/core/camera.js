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

function describeCameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission denied. Allow camera access in your browser, then reload Holoframe.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera found. Connect a webcam, then reload Holoframe.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is already in use by another app. Close it, then reload Holoframe.';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'The camera does not support the requested video settings. Try a different camera.';
    default:
      return `Could not start the camera: ${error?.message ?? 'unknown error'}`;
  }
}

export async function startCamera(video, statusElement) {
  if (!navigator.mediaDevices?.getUserMedia) {
    const message = 'This browser does not support webcam access. Try a recent version of Chrome, Edge, or Firefox over HTTPS or localhost.';
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
    showStatus(statusElement, 'Requesting camera access...');

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
