const config = {
  camera: {
    width: 1280,
    height: 720,
    facingMode: 'user',
    mirror: true,
  },

  handTracking: {
    modelPath: '/models/hand_landmarker.task',
    wasmBaseUrl: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm',
    numHands: 2,
    delegate: 'GPU',
    minHandDetectionConfidence: 0.5,
    minHandTrackingConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    // MediaPipe assumes a mirrored (selfie) input; our raw webcam frame is not
    // mirrored, so the handedness labels are swapped back to the real hand.
    swapHandedness: true,
    // Persistent identity matching is done in aspect-corrected normalized space.
    identityMaxDistance: 0.25,
    identityTtlMs: 400,
  },

  smoothing: {
    enabled: true,
    // One Euro parameters tuned for normalized landmark coordinates (0..1).
    // A moderate minCutoff removes jitter while beta lets fast motion through.
    minCutoff: 1.5,
    beta: 0.08,
    derivativeCutoff: 1.0,
    // Keep a hand's filters while its identity is still tracked. This is longer
    // than the identity TTL, so the same identity never gets fresh filters.
    resetAfterMissingMs: 600,
    tuning: {
      betaStep: 0.01,
      minCutoffStep: 0.1,
      betaMin: 0,
      betaMax: 1,
      minCutoffMin: 0.1,
      minCutoffMax: 10,
    },
  },

  gestures: {
    maxHands: 2,
    // Continuous score smoothing and time-based hysteresis. Times are in ms.
    scoreSmoothingMs: 50,
    enterThreshold: 0.65,
    exitThreshold: 0.35,
    enterMs: 80,
    exitMs: 200,
    graceMs: 250,
    handStateTtlMs: 1000,
    orientationDebounceMs: 150,
    finger: {
      // Extended/curled ratios compare tip-to-wrist distance against the
      // PIP/MCP-to-wrist distance, after normalizing by hand size.
      extensionRatio: 1.2,
      curlRatio: 0.95,
      thumbExtensionRatio: 1.15,
      thumbCurlRatio: 0.95,
    },
    lShapeAngle: {
      min: 55,
      max: 125,
      margin: 25,
    },
  },

  frame: {
    // Facing-sign hysteresis keeps edge-on hands from flickering.
    facingMinMagnitude: 0.15,
    facingMs: 120,
    // Exponential approach speed for the folded/twisted corner blend.
    twistSpeed: 10,
    // cosAB hysteresis band: swap below -0.1, unswap above +0.1.
    swapHysteresis: 0.1,
  },

  victory: {
    // One shard per hand slot; slot colors stay attached to persistent hand ids.
    maxShards: 2,
    colors: ['#b84dff', '#3a6bff'],
    fadeSpeed: 10,
    // 0 means no extra smoothing; the landmarks are already One Euro smoothed.
    motionSmoothing: 40,
    fillOpacity: 0.55,
    lineOpacity: 0.9,
    lineWhiten: 0.5,
    glowScale: 1.15,
    glowOpacity: 0.35,
    requireThumbExtended: false,
    thumbExtendedThreshold: 0.6,
    // Keep a hand's shard/color through short tracking dropouts.
    idTtlMs: 250,
    gradientSize: 64,
  },

  persist: {
    // C freezes ended gestures as static screen-space stamps.
    maxStamps: 12,
    stampOpacity: 0.85,
    pulse: 0,
    pulseSpeed: 1.5,
    clearOnDisable: true,
    minActiveMs: 300,
    // Fade used when the oldest stamp is evicted or persist is turned off.
    removeFadeMs: 250,
  },

  wipe: {
    sampleCapacity: 160,   // 64 idi; pencere uzayınca yüksek FPS'te yetsin
    windowMs: 800,         // 600 idi
    minDistance: 0.30,     // 0.45 idi
    maxVerticalRatio: 0.6,
    minSpeed: 0.45,        // 1.2 idi
    minOpenScore: 0.6,
    directions: 'both',
    maxGapMs: 120,
    cooldownMs: 800,
    waveMs: 350,
    fadeMs: 250,
  },

  scene: {
    maxDevicePixelRatio: 2,
    framePanel: {
      fadeSpeed: 10,
      motionSmoothing: 18,
      themeTransition: 6,
      fillOpacity: 0.5,
      lineOpacity: 0.9,
      gridU: 16,
      gridV: 8,
      // Slightly reduce fill opacity as the panel twists into a fold.
      twistOpacityThreshold: 0.5,
      twistOpacityDrop: 0.3,
      textureSize: 128,
      textureDots: 8,
      textureDotRadius: 0.16,
      textureBackgroundAlpha: 0.22,
      textureDotAlpha: 0.95,
      textureRepeat: { x: 6, y: 4 },
      themes: {
        horizontal: { fill: '#ff2fa0', line: '#39ff88' },
        vertical: { fill: '#1e6bff', line: '#4fd8ff' },
      },
    },
  },

  hud: {
    enabled: true,
    maxDevicePixelRatio: 2,
    color: 'rgba(255, 255, 255, 0.72)',
    bracketColor: 'rgba(255, 255, 255, 0.88)',
    labelColor: 'rgba(255, 255, 255, 0.92)',
    font: '11px "SFMono-Regular", "Cascadia Mono", Consolas, "Liberation Mono", monospace',
    lineWidth: 1,
    dash: [3, 4],
    bracketSize: 10,
    bracketArm: 4,
    dotRadius: 1.5,
    boxLandmarks: [0, 4, 8, 12, 16, 20],
    labelLandmarks: [0, 4, 8, 12, 16, 20],
    labelOffset: { x: 12, y: -10 },
    fps: {
      enabled: true,
      corner: 'top-left',
      padding: 18,
    },
    debug: {
      enabled: true,
      offsetY: 20,
      lineHeight: 15,
      color: 'rgba(255, 255, 255, 0.78)',
      tuningHint: "[ ] beta   ; ' minCutoff",
    },
  },

  controls: {
    toggleHud: 'h',
    togglePersist: 'c',
    clearStamps: 'x',
    betaDown: '[',
    betaUp: ']',
    minCutoffDown: ';',
    minCutoffUp: "'",
  },
};

export default config;
