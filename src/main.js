import './styles/main.css';
import config from './config.js';
import { startCamera, showStatus, describeCameraError } from './core/camera.js';
import { HandTracker } from './core/handTracker.js';
import { LandmarkSmoother } from './core/smoothing.js';
import { GestureDetector } from './gestures/gestureDetector.js';
import { HudOverlay } from './hud/hudOverlay.js';
import { SceneManager } from './scene/sceneManager.js';
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

const ui = new UiController({
  hud,
  sceneManager,
  onStart: () => start(),
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
let starting = false;
let started = false;

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
  sceneManager.update(latestGestureState, latestHands);
  debugState.persist = sceneManager.getPersistDebug();
  debugState.thermal = sceneManager.getThermalDebug();
  debugState.box = sceneManager.getBoxDebug();
  hud.render(latestHands, video, debugState);
  ui.sync();
  requestAnimationFrame(renderFrame);
}

async function start() {
  if (starting || started) return;
  starting = true;

  ui.setLoading(config.ui.strings.loadingCamera);

  // Fullscreen must be requested inside the user gesture (the Start click),
  // before any await, or the browser rejects it.
  if (ui.shouldStartFullscreen()) {
    await ui.requestFullscreen();
  }

  try {
    await startCamera(video, statusElement);
  } catch (error) {
    starting = false;
    // camera.js already produced a clear, localized message.
    ui.showError(describeCameraError(error));
    return;
  }

  ui.setLoading(config.ui.strings.loadingModel);

  try {
    await handTracker.init();
  } catch (error) {
    starting = false;
    ui.showError(
      config.ui.strings.modelFailed.replace('{message}', error.message),
    );
    return;
  }

  handTracker.start(video, handleHands, (error) => {
    lastDetectionTimestamp = null;
    debugState.detectionRate = 0;
    latestHands = [];
    latestGestureState = null;
    debugState.gestureState = null;
    showStatus(
      statusElement,
      config.ui.strings.trackingStopped.replace('{message}', error.message),
      true,
    );
  });

  starting = false;
  started = true;
  ui.finishStart();
  requestAnimationFrame(renderFrame);
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
