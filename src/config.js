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
    fist: {
      // Thumb tip distance from palm center, normalized by wrist-to-middle-MCP.
      // Folded/tucked thumbs stay below max; extended thumbs fade out by margin.
      thumbFistMaxDistance: 0.8,
      thumbFistMargin: 0.25,
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

  box: {
    // Separate perspective pass calibrated so world z=0 maps 1:1 to CSS px.
    fov: 40,
    // Two open palms further apart than this fraction of the screen width.
    minHandDistance: 0.25,
    enterMs: 120,
    exitMs: 180,
    // Keep an active box through brief tracking dropouts.
    graceMs: 250,
    // Distance hysteresis when leaving: exit below this fraction of the enter
    // distance.
    exitDistanceRatio: 0.8,
    // Fingertip depth: landmark z scaled by the cover width, plus a per-hand
    // offset so the closer/larger hand sits toward the camera.
    zScale: 1.0,
    handDepthGain: 400,
    maxDepthPx: 400,
    // 0 disables extra smoothing; the landmarks are already One Euro smoothed.
    motionSmoothing: 0,
    popMs: 220,
    // Final prism look.
    faceOpacity: 0.7,
    capOpacityScale: 0.6,
    faceShade: { sides: 0.9, caps: 1.0 },
    uvMode: 'face',
    hatch: { stripeWidthPx: 10, angleDeg: 45 },
    hatchOpacity: 0.9,
    glowOpacity: 0.35,
    vertexSizePx: 6,
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

  thermal: {
    // Initial filter state; a held fist or the T key toggles it.
    enabled: false,
    holdMs: 400,
    cooldownMs: 1000,
    transitionSpeed: 6,
    contrast: 1.25,
    gamma: 1.0,
    bands: 0,
    shimmer: 0.03,
    panelFillOpacity: 0.7,
    panelLineOpacity: 1.0,
    palettes: [
      {
        name: 'neon',
        colors: ['#14003d', '#6a00f4', '#ff00c8', '#00e5ff', '#fff700'],
        panel: {
          horizontal: { fill: '#39ff14', line: '#ffffff' },
          vertical: { fill: '#ff7a00', line: '#ffffff' },
        },
      },
      {
        name: 'ice',
        colors: ['#02041a', '#0b2a8a', '#2f7bff', '#7ff3ff', '#ffffff'],
        panel: {
          horizontal: { fill: '#ff3b30', line: '#ffffff' },
          vertical: { fill: '#ffb300', line: '#ffffff' },
        },
      },
      {
        name: 'heat',
        colors: ['#0a0014', '#7a0070', '#ff2a2a', '#ff9a00', '#fff6b0'],
        panel: {
          horizontal: { fill: '#00e5ff', line: '#ffffff' },
          vertical: { fill: '#39ff14', line: '#ffffff' },
        },
      },
    ],
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

  recording: {
    // Screen recorder output. Width is capped so the composited canvas stays
    // cheap to draw every frame on phones.
    fps: 30,
    maxWidth: 1280,
    // Auto-stop after this many seconds and show the result card.
    maxSeconds: 120,
    // The HUD (landmark dots/brackets) is not burned into the recording by
    // default; the thermal layer and shapes are always part of the scene.
    includeHud: false,
    // Target video bitrate at maxWidth; scaled down for narrower output.
    bitrate: 5000000,
    // Cancel an in-progress recording if the tab stays hidden this long.
    hiddenCancelMs: 10000,
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

  ui: {
    // Toolbar auto-hide delay after the last pointer/touch activity.
    autoHideMs: 5000,
    // How long a toggle toast stays on screen.
    toastMs: 1600,
    // Landing checkbox default; only used when the Fullscreen API exists.
    startFullscreenDefault: true,
    // How long the Stop button stays armed waiting for the second tap.
    stopConfirmMs: 2000,
    // Small credit line shown on the landing page.
    credit: 'Made by Emir Aytekin',
    // All user-facing text lives here so the UI stays in one language.
    strings: {
      title: 'Holoframe',
      tagline: 'A real-time holographic frame you control with your hands.',
      start: 'Start',
      startFullscreen: 'Start in fullscreen',
      stop: 'Stop',
      stopConfirm: 'Tap again to stop',
      retry: 'Try again',
      privacy:
        'Your video never leaves your device. Hand tracking runs in your browser.',
      fullscreenHint: 'For fullscreen, tap Share > Add to Home Screen.',
      loadingCamera: 'Starting camera...',
      loadingModel: 'Loading model...',
      gestures: [
        { title: 'Two-hand L shape', description: 'panel' },
        { title: 'V sign', description: 'triangles' },
        { title: 'Hold a fist', description: 'thermal filter' },
        { title: 'Two open hands', description: 'prism' },
        { title: 'Open-hand sweep', description: 'clear shapes' },
      ],
      toolbar: {
        thermal: 'Thermal',
        palette: 'Palette',
        persist: 'Persist',
        clear: 'Clear',
        landmarks: 'Hand points',
        debug: 'Debug',
        fullscreen: 'Fullscreen',
        record: 'Record',
        photo: 'Photo',
        stop: 'Stop',
      },
      toast: {
        thermalOn: 'Thermal: on',
        thermalOff: 'Thermal: off',
        palette: 'Palette: {name}',
        persistOn: 'Persist: on',
        persistOff: 'Persist: off',
        clear: 'Shapes cleared',
        landmarksOn: 'Hand points: on',
        landmarksOff: 'Hand points: off',
        debugOn: 'Debug: on',
        debugOff: 'Debug: off',
        recordingStarted: 'Recording started',
        recordingStopped: 'Recording stopped',
        photoCaptured: 'Photo captured',
        recordingUnsupported: 'Recording is not supported in this browser',
      },
      recording: {
        // Prefix shown in the top-center "REC 00:12" pill.
        rec: 'REC',
        videoTitle: 'Recording',
        photoTitle: 'Photo',
        save: 'Save',
        share: 'Share',
        close: 'Close',
      },
      // Reused by camera.js so the error text has a single source.
      camera: {
        requesting: 'Requesting camera access...',
        unsupported:
          'This browser does not support webcam access. Try a recent version of Chrome, Edge, or Firefox over HTTPS or localhost.',
        denied:
          'Camera permission denied. Allow camera access in your browser, then try again.',
        notFound: 'No camera found. Connect a webcam, then try again.',
        inUse:
          'The camera is already in use by another app. Close it, then try again.',
        overconstrained:
          'The camera does not support the requested video settings. Try a different camera.',
        unknown: 'Could not start the camera: {message}',
      },
      modelFailed: 'Could not load hand tracking: {message}',
      trackingStopped: 'Hand tracking stopped: {message}',
      cameraEnded: 'Camera disconnected. Press Start to resume.',
    },
  },

  controls: {
    toggleHud: 'h',
    togglePersist: 'c',
    clearStamps: 'x',
    toggleThermal: 't',
    cyclePalette: 'p',
    cycleBoxUv: 'b',
    toggleDebug: 'd',
    record: 'r',
    photo: 'v',
    betaDown: '[',
    betaUp: ']',
    minCutoffDown: ';',
    minCutoffUp: "'",
  },
};

export default config;
