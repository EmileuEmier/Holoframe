import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import config from '../config.js';
import { HandIdentityMatcher } from './handIdentity.js';

function swapHandedness(label) {
  if (label === 'Left') return 'Right';
  if (label === 'Right') return 'Left';
  return label;
}

export class HandTracker {
  constructor(options = {}) {
    this.options = {
      ...config.handTracking,
      mirrorLandmarks: config.camera.mirror,
      ...options,
    };
    this.landmarker = null;
    this.running = false;
    this.animationFrameId = null;
    this.lastTimestamp = -1;
    this.lastVideoTime = -1;
    this.identityMatcher = new HandIdentityMatcher({
      maxDistance: this.options.identityMaxDistance,
      ttlMs: this.options.identityTtlMs,
    });
  }

  isInitialized() {
    return Boolean(this.landmarker);
  }

  async init() {
    // Keep the landmarker alive across sessions so a restart skips loading.
    if (this.landmarker) return;

    const vision = await FilesetResolver.forVisionTasks(this.options.wasmBaseUrl);

    const createLandmarker = (delegate) =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: this.options.modelPath,
          delegate,
        },
        runningMode: 'VIDEO',
        numHands: this.options.numHands,
        minHandDetectionConfidence: this.options.minHandDetectionConfidence,
        minHandTrackingConfidence: this.options.minHandTrackingConfidence,
        minHandPresenceConfidence: this.options.minHandPresenceConfidence,
      });

    try {
      this.landmarker = await createLandmarker(this.options.delegate);
    } catch {
      // Some browsers/drivers fail to create a GPU delegate. CPU keeps the
      // tracker usable, at the cost of some performance.
      this.landmarker = await createLandmarker('CPU');
    }
  }

  formatResult(result, video, timestamp) {
    const landmarksList = result.landmarks ?? [];
    const worldLandmarksList = result.worldLandmarks ?? [];
    const handednessList = result.handedness ?? [];

    const hands = landmarksList.map((landmarks, index) => {
      const category = handednessList[index]?.[0];
      const rawHandedness = category?.categoryName ?? 'Unknown';
      const handedness = this.options.swapHandedness
        ? swapHandedness(rawHandedness)
        : rawHandedness;

      const worldLandmarks = worldLandmarksList[index];

      return {
        landmarks: landmarks.map((landmark) => ({
          // Flip x so normalized points line up with the mirrored selfie view.
          x: this.options.mirrorLandmarks ? 1 - landmark.x : landmark.x,
          y: landmark.y,
          z: landmark.z,
        })),
        // World landmarks are metric and independent of screen aspect. Mirror x
        // as well so world-space math matches the displayed selfie view.
        world: worldLandmarks
          ? worldLandmarks.map((landmark) => ({
              x: this.options.mirrorLandmarks ? -landmark.x : landmark.x,
              y: landmark.y,
              z: landmark.z,
            }))
          : null,
        handedness,
        confidence: category?.score ?? 0,
      };
    });

    const aspectRatio =
      video?.videoWidth && video?.videoHeight
        ? video.videoWidth / video.videoHeight
        : config.camera.width / config.camera.height;

    this.identityMatcher.assign(hands, timestamp, aspectRatio);
    return hands;
  }

  start(video, onResults, onError) {
    this.stop();
    this.running = true;
    this.lastTimestamp = -1;
    this.lastVideoTime = -1;
    this.identityMatcher.reset();

    const loop = () => {
      if (!this.running) return;
      this.animationFrameId = requestAnimationFrame(loop);

      // HAVE_CURRENT_DATA (2) guarantees there is a decodable frame to track.
      if (!this.landmarker || video.readyState < 2) {
        return;
      }

      // The rAF loop can run much faster than the camera. Only run MediaPipe
      // when the video element has advanced to a new frame.
      const videoTime = video.currentTime;
      if (!Number.isFinite(videoTime) || videoTime === this.lastVideoTime) {
        return;
      }
      this.lastVideoTime = videoTime;

      const timestamp = performance.now();
      if (timestamp <= this.lastTimestamp) return;
      this.lastTimestamp = timestamp;

      try {
        const result = this.landmarker.detectForVideo(video, timestamp);
        onResults(this.formatResult(result, video, timestamp), timestamp);
      } catch (error) {
        this.stop();
        onError?.(error);
      }
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}
