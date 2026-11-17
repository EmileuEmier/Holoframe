import './styles/main.css';
import config from './config.js';
import {
  startCamera,
  stopCamera,
  describeCameraError,
} from './core/camera.js';
import { HandTracker } from './core/handTracker.js';
import { LandmarkSmoother } from './core/smoothing.js';
import { GestureDetector } from './gestures/gestureDetector.js';
import { HudOverlay } from './hud/hudOverlay.js';
import { SceneManager } from './scene/sceneManager.js';
import { Recorder } from './ui/recorder.js';
import { UiController } from './ui/uiController.js';

const video = document.querySelector('#camera');
const sceneCanvas = document.querySelector('#scene');
const hudCanvas = document.querySelector('#hud');
const statusElement = document.querySelector('#status');

const hud = new HudOverlay(hudCanvas, config.hud);
const smoother = new LandmarkSmoother(config.smoothing);
const handTracker = new HandTracker();
const gestureDetector = new GestureDetector(config.gestures);
const sceneManager = new SceneManager(sceneCanvas, video, config.scene);
const recorder = new Recorder({ video, sceneCanvas, hudCanvas });

const ui = new UiController({
  hud,
  sceneManager,
  recorder,
  onStart: () => startSession(),
  onStop: () => stopSession(),
});

const initialSmoothing = smoother.getParameters();
const debugState = {
  gestureState: null,
  minCutoff: initialSmoothing.minCutoff,
  beta: initialSmoothing.beta,
  detectionRate: 0,
};

let latestHands = [];
let latestGestureState = null;
let lastDetectionTimestamp = null;
let renderFrameId = null;
let sessionActive = false;
let starting = false;

function syncSmoothingDebug() {
  const parameters = smoother.getParameters();
  debugState.minCutoff = parameters.minCutoff;
  debugState.beta = parameters.beta;
}

function handleHands(hands, timestamp) {
  if (lastDetectionTimestamp !== null) {
    const delta = timestamp - lastDetectionTimestamp;
    if (delta > 0) {
      const instantRate = 1000 / delta;
      debugState.detectionRate =
        debugState.detectionRate === 0
          ? instantRate
          : debugState.detectionRate * 0.9 + instantRate * 0.1;
    }
  }
  lastDetectionTimestamp = timestamp;

  const aspectRatio =
    video.videoWidth && video.videoHeight
      ? video.videoWidth / video.videoHeight
      : config.camera.width / config.camera.height;

  latestHands = smoother.smooth(hands, timestamp, aspectRatio);
  latestGestureState = gestureDetector.detect(latestHands, aspectRatio, timestamp);
  debugState.gestureState = latestGestureState;
}

function renderFrame() {
  if (!sessionActive) return;
  renderFrameId = requestAnimationFrame(renderFrame);

  sceneManager.update(latestGestureState, latestHands);
  debugState.persist = sceneManager.getPersistDebug();
  debugState.thermal = sceneManager.getThermalDebug();
  debugState.box = sceneManager.getBoxDebug();
  hud.render(latestHands, video, debugState);
  // Must run in the same frame right after the scene renders: the WebGL canvas
  // has no preserveDrawingBuffer, so reading it later returns an empty image.
  recorder.captureFrame();
  ui.sync();
}

// Wipe every runtime module back to its initial state so a restart behaves like
// a fresh page load without reloading.
function resetRuntimeState() {
  smoother.reset();
  gestureDetector.reset();
  sceneManager.reset();
  hud.clear();

  latestHands = [];
  latestGestureState = null;
  lastDetectionTimestamp = null;
  debugState.gestureState = null;
  debugState.detectionRate = 0;
  debugState.persist = null;
  debugState.thermal = null;
  debugState.box = null;
  syncSmoothingDebug();
}

// A new track is created for every session, so this listener is never doubled.
function watchStream(stream) {
  const track = stream?.getVideoTracks?.()[0];
  if (!track) return;

  track.addEventListener('ended', async () => {
    if (!sessionActive) return;
    await stopSession();
    ui.showError(config.ui.strings.cameraEnded);
  });
}

function handleTrackingError(error) {
  if (!sessionActive) return;
  stopSession().then(() => {
    ui.showError(
      config.ui.strings.trackingStopped.replace('{message}', error.message),
    );
  });
}

async function startSession() {
  if (starting || sessionActive) return;
  starting = true;

  ui.setLoading(config.ui.strings.loadingCamera);

  // Fullscreen must be requested inside the user gesture (the Start click),
  // before any await, or the browser rejects it.
  if (ui.shouldStartFullscreen()) {
    await ui.requestFullscreen();
  }

  let stream;
  try {
    stream = await startCamera(video, statusElement);
  } catch (error) {
    starting = false;
    // camera.js already produced a clear, localized message.
    ui.showError(describeCameraError(error));
    return;
  }

  // Reuse the landmarker across sessions; only the first start loads the model.
  if (!handTracker.isInitialized()) {
    ui.setLoading(config.ui.strings.loadingModel);
    try {
      await handTracker.init();
    } catch (error) {
      starting = false;
      stopCamera(video);
      ui.showError(
        config.ui.strings.modelFailed.replace('{message}', error.message),
      );
      return;
    }
  }

  resetRuntimeState();
  watchStream(stream);

  starting = false;
  sessionActive = true;
  ui.finishStart();

  handTracker.start(video, handleHands, handleTrackingError);
  renderFrameId = requestAnimationFrame(renderFrame);
}

async function stopSession() {
  sessionActive = false;
  starting = false;

  if (renderFrameId !== null) {
    cancelAnimationFrame(renderFrameId);
    renderFrameId = null;
  }

  handTracker.stop();
  // Cancel any active recording (no result card), close the result card and
  // release the offscreen compositor canvas.
  ui.resetCapture();
  stopCamera(video);

  resetRuntimeState();

  const fullscreenElement =
    document.fullscreenElement || document.webkitFullscreenElement;
  if (fullscreenElement) {
    try {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } catch {
      // Ignore; some browsers reject exitFullscreen when not active.
    }
  }

  ui.showLanding();
}

// The renderer, orthographic camera, box perspective camera and video cover all
// depend on the viewport size, so re-run their resize handlers whenever the
// viewport can change without a plain window resize.
function handleViewportChange() {
  hud.handleResize();
  sceneManager.handleResize();
}

window.addEventListener('orientationchange', () => {
  handleViewportChange();
  // Some mobile browsers report stale dimensions right after the event.
  window.setTimeout(handleViewportChange, 250);
});
window.addEventListener('fullscreenchange', handleViewportChange);
window.addEventListener('webkitfullscreenchange', handleViewportChange);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', handleViewportChange);
}

window.addEventListener('keydown', (event) => {
  const key = event.key;
  const lowerKey = key.toLowerCase();

  if (lowerKey === config.controls.help) {
    ui.toggleHelp();
    event.preventDefault();
    return;
  }

  // While the Help dialog owns focus, only the dialog keys are handled.
  if (ui.isHelpOpen()) {
    if (key === 'Escape') {
      ui.closeHelp();
      event.preventDefault();
    }
    return;
  }

  if (lowerKey === config.controls.toggleFullscreen) {
    ui.toggleFullscreen();
    event.preventDefault();
    return;
  }

  if (key === 'Escape' && ui.isResultOpen()) {
    ui.closeResult();
    event.preventDefault();
    return;
  }

  if (key.toLowerCase() === config.controls.toggleHud) {
    hud.toggle();
    event.preventDefault();
    return;
  }

  if (key.toLowerCase() === config.controls.togglePersist) {
    sceneManager.togglePersist();
    event.preventDefault();
    return;
  }

  if (key.toLowerCase() === config.controls.clearStamps) {
    sceneManager.clearStamps();
    event.preventDefault();
    return;
  }

  if (key.toLowerCase() === config.controls.toggleThermal) {
    sceneManager.toggleThermal();
    event.preventDefault();
    return;
  }

  if (key.toLowerCase() === config.controls.cyclePalette) {
    sceneManager.cycleThermalPalette();
    event.preventDefault();
    return;
  }

  if (key.toLowerCase() === config.controls.cycleBoxUv) {
    sceneManager.cycleBoxUv();
    event.preventDefault();
    return;
  }

  if (key.toLowerCase() === config.controls.toggleDebug) {
    hud.toggleDebugText();
    event.preventDefault();
    return;
  }

  if (key.toLowerCase() === config.controls.record) {
    ui.toggleRecord();
    event.preventDefault();
    return;
  }

  if (key.toLowerCase() === config.controls.photo) {
    ui.takePhoto();
    event.preventDefault();
    return;
  }

  if (key === config.controls.betaDown) {
    smoother.adjustBeta(-config.smoothing.tuning.betaStep);
    syncSmoothingDebug();
    event.preventDefault();
    return;
  }

  if (key === config.controls.betaUp) {
    smoother.adjustBeta(config.smoothing.tuning.betaStep);
    syncSmoothingDebug();
    event.preventDefault();
    return;
  }

  if (key === config.controls.minCutoffDown) {
    smoother.adjustMinCutoff(-config.smoothing.tuning.minCutoffStep);
    syncSmoothingDebug();
    event.preventDefault();
    return;
  }

  if (key === config.controls.minCutoffUp) {
    smoother.adjustMinCutoff(config.smoothing.tuning.minCutoffStep);
    syncSmoothingDebug();
    event.preventDefault();
  }
});
