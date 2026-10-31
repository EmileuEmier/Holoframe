import './styles/main.css';
import config from './config.js';
import { startCamera, showStatus } from './core/camera.js';
import { HandTracker } from './core/handTracker.js';
import { LandmarkSmoother } from './core/smoothing.js';
import { GestureDetector } from './gestures/gestureDetector.js';
import { HudOverlay } from './hud/hudOverlay.js';
import { SceneManager } from './scene/sceneManager.js';

const video = document.querySelector('#camera');
const sceneCanvas = document.querySelector('#scene');
const hudCanvas = document.querySelector('#hud');
const statusElement = document.querySelector('#status');

const hud = new HudOverlay(hudCanvas, config.hud);
const smoother = new LandmarkSmoother(config.smoothing);
const handTracker = new HandTracker();
const gestureDetector = new GestureDetector(config.gestures);
const sceneManager = new SceneManager(sceneCanvas, video, config.scene);

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
  hud.render(latestHands, video, debugState);
  requestAnimationFrame(renderFrame);
}

async function boot() {
  try {
    await startCamera(video, statusElement);
  } catch {
    // camera.js already displayed a clear permission/device message.
    return;
  }

  try {
    showStatus(statusElement, 'Loading hand tracking model...');
    await handTracker.init();
    showStatus(statusElement, '');

    handTracker.start(video, handleHands, (error) => {
      lastDetectionTimestamp = null;
      debugState.detectionRate = 0;
      latestHands = [];
      latestGestureState = null;
      debugState.gestureState = null;
      showStatus(statusElement, `Hand tracking stopped: ${error.message}`, true);
    });

    requestAnimationFrame(renderFrame);
  } catch (error) {
    showStatus(
      statusElement,
      `Could not load hand tracking: ${error.message}. Make sure public/models/hand_landmarker.task exists.`,
      true,
    );
  }
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

boot();
