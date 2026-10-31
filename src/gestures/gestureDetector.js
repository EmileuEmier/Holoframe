import config from '../config.js';
import { HandIdentityMatcher } from '../core/handIdentity.js';

const LANDMARK_COUNT = 21;
const WRIST = 0;
const THUMB_CMC = 1;
const THUMB_MCP = 2;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_TIP = 20;

// joint is the PIP (or MCP for the thumb) used in the distance comparison.
const FINGERS = [
  { tip: THUMB_TIP, joint: THUMB_MCP },
  { tip: INDEX_TIP, joint: 6 },
  { tip: MIDDLE_TIP, joint: 10 },
  { tip: RING_TIP, joint: 14 },
  { tip: PINKY_TIP, joint: 18 },
];

const GESTURE_NAMES = ['openPalm', 'fist', 'victory', 'lShape'];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function distance3D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  return Math.hypot(dx, dy, dz);
}

function copyPoint(target, source) {
  target.x = source.x;
  target.y = source.y;
  target.z = source.z ?? 0;
  return target;
}

export class GestureDetector {
  constructor(options = config.gestures) {
    this.options = options;
    this.identityMatcher = new HandIdentityMatcher({
      maxDistance: config.handTracking.identityMaxDistance,
      ttlMs: config.handTracking.identityTtlMs,
    });
    this.handStates = new Map();

    this.rawScores = {
      openPalm: 0,
      fist: 0,
      victory: 0,
      lShape: 0,
    };
    this.fingerScores = [0, 0, 0, 0, 0];
    this.angleDegrees = 0;
    this.facingValue = 0;
    this.fallbackPoints = Array.from({ length: LANDMARK_COUNT }, () => ({
      x: 0,
      y: 0,
      z: 0,
    }));

    this.handResults = Array.from({ length: options.maxHands }, () => ({
      id: null,
      handedness: 'Unknown',
      openPalm: false,
      fist: false,
      victory: false,
      lShape: false,
      lShapeScore: 0,
      angleDegrees: 0,
      facingValue: 0,
      facingSign: 0,
      fingerScores: [0, 0, 0, 0, 0],
    }));

    // Raw endpoints are kept in role order: A0/A1 and B0/B1. frameCorners is
    // the blended ring that gets rendered and mapped to screen space.
    this.a0 = { x: 0, y: 0, z: 0 };
    this.a1 = { x: 0, y: 0, z: 0 };
    this.b0 = { x: 0, y: 0, z: 0 };
    this.b1 = { x: 0, y: 0, z: 0 };
    this.frameCorners = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0 }));
    this.orientationState = { stable: null, candidate: null, candidateSince: 0 };
    this.frameState = {
      active: false,
      enterStartedAt: null,
      exitStartedAt: null,
      lastDistance: 0,
      idA: null,
      idB: null,
      facingA: 0,
      facingB: 0,
      baseSwap: false,
      folded: false,
      twist: 0,
      lastTimestamp: null,
    };

    this.result = {
      hands: [],
      twoHands: {
        active: false,
        distance: 0,
        frameCorners: null,
        orientation: null,
        score: 0,
        twist: 0,
        folded: false,
        facing: [0, 0],
        idA: null,
        idB: null,
      },
    };
  }

  createHandState() {
    const smoothedScores = {};
    const states = {};

    for (const name of GESTURE_NAMES) {
      smoothedScores[name] = 0;
      states[name] = {
        active: false,
        enterStartedAt: null,
        exitStartedAt: null,
      };
    }

    return {
      smoothedScores,
      states,
      lastScoreTimestamp: null,
      lastSeen: 0,
      facingSign: 0,
      facingCandidate: 0,
      facingSince: 0,
    };
  }

  getHandState(id) {
    let state = this.handStates.get(id);
    if (!state) {
      state = this.createHandState();
      this.handStates.set(id, state);
    }
    return state;
  }

  getHandPoints(hand, aspectRatio) {
    if (hand.world && hand.world.length >= LANDMARK_COUNT) {
      return hand.world;
    }

    // Normalized landmarks are not isotropic: x is scaled by image width and y
    // by image height. Convert both axes to the same unit before doing 3D math.
    const points = this.fallbackPoints;
    const landmarks = hand.landmarks ?? [];
    for (let i = 0; i < LANDMARK_COUNT; i += 1) {
      const landmark = landmarks[i];
      if (landmark) {
        points[i].x = landmark.x * aspectRatio;
        points[i].y = landmark.y;
        points[i].z = (landmark.z ?? 0) * aspectRatio;
      } else {
        points[i].x = 0;
        points[i].y = 0;
        points[i].z = 0;
      }
    }
    return points;
  }

  computeFacingValue(hand, aspectRatio) {
    const landmarks = hand.landmarks;
    if (!landmarks) return 0;

    const wrist = landmarks[WRIST];
    const indexMcp = landmarks[INDEX_MCP];
    const middleMcp = landmarks[MIDDLE_MCP];
    const pinkyMcp = landmarks[PINKY_MCP];
    if (!wrist || !indexMcp || !middleMcp || !pinkyMcp) return 0;

    // Aspect-correct x before the 2D cross product. The sign is unchanged, but
    // the magnitude becomes scale-independent in screen space.
    const indexX = (indexMcp.x - wrist.x) * aspectRatio;
    const indexY = indexMcp.y - wrist.y;
    const pinkyX = (pinkyMcp.x - wrist.x) * aspectRatio;
    const pinkyY = pinkyMcp.y - wrist.y;
    const middleX = (middleMcp.x - wrist.x) * aspectRatio;
    const middleY = middleMcp.y - wrist.y;
    const scaleSquared = middleX * middleX + middleY * middleY;

    if (scaleSquared <= 1e-12) return 0;
    return (indexX * pinkyY - indexY * pinkyX) / scaleSquared;
  }

  updateFacing(state, facingValue, timestamp) {
    if (!Number.isFinite(facingValue)) return state.facingSign;

    const { facingMinMagnitude, facingMs } = config.frame;
    const magnitude = Math.abs(facingValue);
    const sign = facingValue >= 0 ? 1 : -1;

    if (state.facingSign === 0) {
      if (magnitude > facingMinMagnitude) {
        state.facingSign = sign;
        state.facingCandidate = 0;
        state.facingSince = timestamp;
      }
      return state.facingSign;
    }

    // Edge-on hands are ambiguous. Keep the old sign instead of flickering.
    if (magnitude <= facingMinMagnitude) {
      state.facingCandidate = 0;
      state.facingSince = timestamp;
      return state.facingSign;
    }

    if (sign === state.facingSign) {
      state.facingCandidate = 0;
      state.facingSince = timestamp;
      return state.facingSign;
    }

    if (sign !== state.facingCandidate) {
      state.facingCandidate = sign;
      state.facingSince = timestamp;
      return state.facingSign;
    }

    if (timestamp - state.facingSince >= facingMs) {
      state.facingSign = sign;
      state.facingCandidate = 0;
      state.facingSince = timestamp;
    }

    return state.facingSign;
  }

  computeAngleScore(angle) {
    const { min, max, margin } = this.options.lShapeAngle;
    const safeMargin = Math.max(margin, 1e-6);

    if (angle >= min && angle <= max) return 1;
    if (angle < min) {
      return clamp01((angle - (min - safeMargin)) / safeMargin);
    }
    return clamp01((max + safeMargin - angle) / safeMargin);
  }

  analyzeHand(hand, aspectRatio) {
    const points = this.getHandPoints(hand, aspectRatio);
    const wrist = points[WRIST];
    const handScale = Math.max(distance3D(wrist, points[MIDDLE_MCP]), 1e-6);

    for (let i = 0; i < FINGERS.length; i += 1) {
      const finger = FINGERS[i];
      const tipDistance = distance3D(wrist, points[finger.tip]) / handScale;
      const jointDistance = distance3D(wrist, points[finger.joint]) / handScale;
      const ratio = tipDistance / Math.max(jointDistance, 1e-6);

      const extensionThreshold =
        i === 0
          ? this.options.finger.thumbExtensionRatio
          : this.options.finger.extensionRatio;
      const curlThreshold =
        i === 0 ? this.options.finger.thumbCurlRatio : this.options.finger.curlRatio;

      this.fingerScores[i] = clamp01(
        (ratio - curlThreshold) /
          Math.max(extensionThreshold - curlThreshold, 1e-6),
      );
    }

    // Thumb direction uses CMC -> tip and index direction uses MCP -> tip.
    const thumbX = points[THUMB_TIP].x - points[THUMB_CMC].x;
    const thumbY = points[THUMB_TIP].y - points[THUMB_CMC].y;
    const thumbZ = (points[THUMB_TIP].z ?? 0) - (points[THUMB_CMC].z ?? 0);
    const indexX = points[INDEX_TIP].x - points[INDEX_MCP].x;
    const indexY = points[INDEX_TIP].y - points[INDEX_MCP].y;
    const indexZ = (points[INDEX_TIP].z ?? 0) - (points[INDEX_MCP].z ?? 0);

    const thumbLength = Math.hypot(thumbX, thumbY, thumbZ);
    const indexLength = Math.hypot(indexX, indexY, indexZ);
    const dot = thumbX * indexX + thumbY * indexY + thumbZ * indexZ;

    let angle = 0;
    let angleScore = 0;
    if (thumbLength > 1e-6 && indexLength > 1e-6) {
      const cosine = clamp(dot / (thumbLength * indexLength), -1, 1);
      angle = (Math.acos(cosine) * 180) / Math.PI;
      angleScore = this.computeAngleScore(angle);
    }
    this.angleDegrees = angle;

    const thumbExt = this.fingerScores[0];
    const indexExt = this.fingerScores[1];
    const middleExt = this.fingerScores[2];
    const ringExt = this.fingerScores[3];
    const pinkyExt = this.fingerScores[4];

    const thumbCurl = 1 - thumbExt;
    const indexCurl = 1 - indexExt;
    const middleCurl = 1 - middleExt;
    const ringCurl = 1 - ringExt;
    const pinkyCurl = 1 - pinkyExt;

    // A gesture score is limited by its weakest component, so one extended
    // finger or a bad thumb-index angle prevents a false positive.
    this.rawScores.openPalm = Math.min(
      thumbExt,
      indexExt,
      middleExt,
      ringExt,
      pinkyExt,
    );
    this.rawScores.fist = Math.min(
      thumbCurl,
      indexCurl,
      middleCurl,
      ringCurl,
      pinkyCurl,
    );
    this.rawScores.victory = Math.min(
      indexExt,
      middleExt,
      (ringCurl + pinkyCurl) * 0.5,
    );
    this.rawScores.lShape = Math.min(
      thumbExt,
      indexExt,
      angleScore,
      (middleCurl + ringCurl + pinkyCurl) / 3,
    );
  }

  smoothScores(state, timestamp) {
    const raw = this.rawScores;
    const smoothed = state.smoothedScores;

    if (state.lastScoreTimestamp === null) {
      smoothed.openPalm = raw.openPalm;
      smoothed.fist = raw.fist;
      smoothed.victory = raw.victory;
      smoothed.lShape = raw.lShape;
      state.lastScoreTimestamp = timestamp;
      return;
    }

    const dt = Math.max(0, (timestamp - state.lastScoreTimestamp) / 1000);
    state.lastScoreTimestamp = timestamp;

    // Exponential smoothing is frame-rate independent: alpha depends on dt.
    const smoothingMs = this.options.scoreSmoothingMs;
    const alpha =
      smoothingMs > 0 ? 1 - Math.exp(-dt / (smoothingMs / 1000)) : 1;

    smoothed.openPalm += (raw.openPalm - smoothed.openPalm) * alpha;
    smoothed.fist += (raw.fist - smoothed.fist) * alpha;
    smoothed.victory += (raw.victory - smoothed.victory) * alpha;
    smoothed.lShape += (raw.lShape - smoothed.lShape) * alpha;
  }

  updateHysteresis(state, score, timestamp) {
    const { enterThreshold, exitThreshold, enterMs, exitMs } = this.options;

    if (!state.active) {
      if (score > enterThreshold) {
        if (state.enterStartedAt === null) state.enterStartedAt = timestamp;
        if (timestamp - state.enterStartedAt >= enterMs) {
          state.active = true;
          state.enterStartedAt = null;
          state.exitStartedAt = null;
        }
      } else {
        state.enterStartedAt = null;
      }
      return state.active;
    }

    if (score < exitThreshold) {
      if (state.exitStartedAt === null) state.exitStartedAt = timestamp;
      if (timestamp - state.exitStartedAt >= exitMs) {
        state.active = false;
        state.exitStartedAt = null;
        state.enterStartedAt = null;
      }
    } else {
      state.exitStartedAt = null;
    }

    return state.active;
  }

  resetOrientation() {
    this.orientationState.stable = null;
    this.orientationState.candidate = null;
    this.orientationState.candidateSince = 0;
  }

  updateOrientation(rawOrientation, timestamp, immediate = false) {
    const state = this.orientationState;
    if (rawOrientation === null) return state.stable;

    if (state.stable === null || immediate) {
      state.stable = rawOrientation;
      state.candidate = null;
      state.candidateSince = timestamp;
      return state.stable;
    }

    if (rawOrientation === state.stable) {
      state.candidate = null;
      state.candidateSince = timestamp;
      return state.stable;
    }

    if (rawOrientation !== state.candidate) {
      state.candidate = rawOrientation;
      state.candidateSince = timestamp;
      return state.stable;
    }

    if (timestamp - state.candidateSince >= this.options.orientationDebounceMs) {
      state.stable = rawOrientation;
      state.candidate = null;
      state.candidateSince = timestamp;
    }

    return state.stable;
  }

  copySideEndpoints(handA, handB) {
    copyPoint(this.a0, handA.landmarks[THUMB_TIP]);
    copyPoint(this.a1, handA.landmarks[INDEX_TIP]);
    copyPoint(this.b0, handB.landmarks[THUMB_TIP]);
    copyPoint(this.b1, handB.landmarks[INDEX_TIP]);
  }

  computeCosAB(aspectRatio) {
    const vAx = (this.a1.x - this.a0.x) * aspectRatio;
    const vAy = this.a1.y - this.a0.y;
    const vBx = (this.b1.x - this.b0.x) * aspectRatio;
    const vBy = this.b1.y - this.b0.y;
    const lengthA = Math.hypot(vAx, vAy);
    const lengthB = Math.hypot(vBx, vBy);

    if (lengthA <= 1e-6 || lengthB <= 1e-6) return 0;
    return clamp(
      (vAx * vBx + vAy * vBy) / (lengthA * lengthB),
      -1,
      1,
    );
  }

  updateBaseSwap(cosAB) {
    const hysteresis = config.frame.swapHysteresis;
    if (this.frameState.baseSwap) {
      if (cosAB > hysteresis) this.frameState.baseSwap = false;
    } else if (cosAB < -hysteresis) {
      this.frameState.baseSwap = true;
    }
  }

  computeWantFold() {
    const { facingA, facingB } = this.frameState;
    return facingA !== 0 && facingA === facingB;
  }

  computeRawOrientation(aspectRatio) {
    const minX = Math.min(this.a0.x, this.a1.x, this.b0.x, this.b1.x);
    const maxX = Math.max(this.a0.x, this.a1.x, this.b0.x, this.b1.x);
    const minY = Math.min(this.a0.y, this.a1.y, this.b0.y, this.b1.y);
    const maxY = Math.max(this.a0.y, this.a1.y, this.b0.y, this.b1.y);

    // Normalized width is scaled by the video aspect so the orientation matches
    // the on-screen panel rather than the raw 0..1 landmark space.
    const width = (maxX - minX) * aspectRatio;
    const height = maxY - minY;
    return width > height ? 'horizontal' : 'vertical';
  }

  updateFrameCorners(twist) {
    const s = clamp01(twist);
    copyPoint(this.frameCorners[0], this.a0);
    copyPoint(this.frameCorners[1], this.a1);

    // B1' = lerp(B1, B0, s), B0' = lerp(B0, B1, s). At s=0 the ring is the
    // nominal order; at s=1 side B is swapped.
    const b1Prime = this.frameCorners[2];
    b1Prime.x = this.b1.x + (this.b0.x - this.b1.x) * s;
    b1Prime.y = this.b1.y + (this.b0.y - this.b1.y) * s;
    b1Prime.z = this.b1.z + (this.b0.z - this.b1.z) * s;

    const b0Prime = this.frameCorners[3];
    b0Prime.x = this.b0.x + (this.b1.x - this.b0.x) * s;
    b0Prime.y = this.b0.y + (this.b1.y - this.b0.y) * s;
    b0Prime.z = this.b0.z + (this.b1.z - this.b0.z) * s;
  }

  updateTwoHands(hands, handResults, aspectRatio, timestamp) {
    const twoHands = this.result.twoHands;
    const frameState = this.frameState;
    const hasTwoHands = hands.length >= 2 && handResults.length >= 2;

    let frameScore = 0;
    let currentDistance = 0;
    let handA = null;
    let handB = null;
    let resultA = null;
    let resultB = null;

    if (!frameState.active) {
      // At activation, A is the hand with the smaller wrist x. The ids are then
      // frozen so crossing arms or close wrists cannot swap the sides later.
      if (hasTwoHands) {
        const first = hands[0];
        const second = hands[1];
        if (first.landmarks[WRIST].x <= second.landmarks[WRIST].x) {
          handA = first;
          resultA = handResults[0];
          handB = second;
          resultB = handResults[1];
        } else {
          handA = second;
          resultA = handResults[1];
          handB = first;
          resultB = handResults[0];
        }

        frameScore = Math.min(resultA.lShapeScore, resultB.lShapeScore);
        currentDistance = distance2D(
          handA.landmarks[WRIST],
          handB.landmarks[WRIST],
        );
      }
    } else if (frameState.idA !== null && frameState.idB !== null) {
      // While active, look up the same two ids. A new id is ignored until the
      // frame fully deactivates and the activation path runs again.
      for (let i = 0; i < hands.length && i < handResults.length; i += 1) {
        const id = hands[i].id;
        if (id === frameState.idA) {
          handA = hands[i];
          resultA = handResults[i];
        } else if (id === frameState.idB) {
          handB = hands[i];
          resultB = handResults[i];
        }
      }

      if (handA && handB) {
        frameScore = Math.min(resultA.lShapeScore, resultB.lShapeScore);
        currentDistance = distance2D(
          handA.landmarks[WRIST],
          handB.landmarks[WRIST],
        );
      }
    }

    twoHands.score = frameScore;

    if (!frameState.active) {
      if (handA && handB && frameScore > this.options.enterThreshold) {
        if (frameState.enterStartedAt === null) {
          frameState.enterStartedAt = timestamp;
        }
        if (timestamp - frameState.enterStartedAt >= this.options.enterMs) {
          frameState.active = true;
          frameState.enterStartedAt = null;
          frameState.exitStartedAt = null;
          frameState.idA = handA.id;
          frameState.idB = handB.id;
          frameState.facingA = resultA.facingSign;
          frameState.facingB = resultB.facingSign;
          frameState.lastDistance = currentDistance;
          frameState.lastTimestamp = timestamp;

          this.copySideEndpoints(handA, handB);
          const cosAB = this.computeCosAB(aspectRatio);
          frameState.baseSwap = cosAB < 0;

          const wantFold = this.computeWantFold();
          const swapB = wantFold ? !frameState.baseSwap : frameState.baseSwap;
          frameState.folded = wantFold;
          // Start in the correct flat/folded state instead of untwisting on
          // the first visible frame.
          frameState.twist = swapB ? 1 : 0;
          this.updateFrameCorners(frameState.twist);

          const rawOrientation = this.computeRawOrientation(aspectRatio);

          twoHands.active = true;
          twoHands.distance = currentDistance;
          twoHands.frameCorners = this.frameCorners;
          twoHands.orientation = this.updateOrientation(
            rawOrientation,
            timestamp,
            true,
          );
          twoHands.twist = frameState.twist;
          twoHands.folded = wantFold;
          twoHands.facing[0] = frameState.facingA;
          twoHands.facing[1] = frameState.facingB;
          twoHands.idA = frameState.idA;
          twoHands.idB = frameState.idB;
          return;
        }
      } else {
        frameState.enterStartedAt = null;
      }

      twoHands.active = false;
      twoHands.distance = 0;
      twoHands.frameCorners = null;
      twoHands.orientation = null;
      twoHands.twist = 0;
      twoHands.folded = false;
      twoHands.facing[0] = 0;
      twoHands.facing[1] = 0;
      twoHands.idA = null;
      twoHands.idB = null;
      return;
    }

    if (handA && handB && frameScore >= this.options.exitThreshold) {
      frameState.exitStartedAt = null;
      frameState.facingA = resultA.facingSign;
      frameState.facingB = resultB.facingSign;

      this.copySideEndpoints(handA, handB);
      const cosAB = this.computeCosAB(aspectRatio);
      this.updateBaseSwap(cosAB);

      const wantFold = this.computeWantFold();
      frameState.folded = wantFold;
      const swapB = wantFold ? !frameState.baseSwap : frameState.baseSwap;
      const target = swapB ? 1 : 0;

      const dt =
        frameState.lastTimestamp === null
          ? 0
          : Math.max(0, (timestamp - frameState.lastTimestamp) / 1000);
      frameState.lastTimestamp = timestamp;

      // Frame-rate independent exponential approach to the target blend.
      const twistSpeed = config.frame.twistSpeed;
      const alpha = twistSpeed > 0 ? 1 - Math.exp(-twistSpeed * dt) : 1;
      frameState.twist += (target - frameState.twist) * alpha;
      if (Math.abs(target - frameState.twist) < 0.001) {
        frameState.twist = target;
      }
      frameState.twist = clamp01(frameState.twist);

      this.updateFrameCorners(frameState.twist);
      frameState.lastDistance = currentDistance;

      const rawOrientation = this.computeRawOrientation(aspectRatio);

      twoHands.active = true;
      twoHands.distance = currentDistance;
      twoHands.frameCorners = this.frameCorners;
      twoHands.orientation = this.updateOrientation(rawOrientation, timestamp);
      twoHands.twist = frameState.twist;
      twoHands.folded = wantFold;
      twoHands.facing[0] = frameState.facingA;
      twoHands.facing[1] = frameState.facingB;
      twoHands.idA = frameState.idA;
      twoHands.idB = frameState.idB;
      return;
    }

    // Keep the previous frame visible through a short dropout or score dip.
    if (frameState.exitStartedAt === null) {
      frameState.exitStartedAt = timestamp;
    }

    if (timestamp - frameState.exitStartedAt >= this.options.graceMs) {
      frameState.active = false;
      frameState.exitStartedAt = null;
      frameState.enterStartedAt = null;
      frameState.idA = null;
      frameState.idB = null;
      frameState.facingA = 0;
      frameState.facingB = 0;
      frameState.baseSwap = false;
      frameState.folded = false;
      frameState.twist = 0;
      frameState.lastTimestamp = null;
      this.resetOrientation();

      twoHands.active = false;
      twoHands.distance = 0;
      twoHands.frameCorners = null;
      twoHands.orientation = null;
      twoHands.twist = 0;
      twoHands.folded = false;
      twoHands.facing[0] = 0;
      twoHands.facing[1] = 0;
      twoHands.idA = null;
      twoHands.idB = null;
      return;
    }

    twoHands.active = true;
    twoHands.distance = frameState.lastDistance;
    twoHands.frameCorners = this.frameCorners;
    twoHands.orientation = this.orientationState.stable;
    twoHands.twist = frameState.twist;
    twoHands.folded = frameState.folded;
    twoHands.facing[0] = frameState.facingA;
    twoHands.facing[1] = frameState.facingB;
    twoHands.idA = frameState.idA;
    twoHands.idB = frameState.idB;
  }

  detect(
    hands,
    aspectRatio = config.camera.width / config.camera.height,
    timestamp = performance.now(),
  ) {
    let needsIdentity = false;
    for (let i = 0; i < hands.length; i += 1) {
      if (hands[i].id == null) {
        needsIdentity = true;
        break;
      }
    }
    if (needsIdentity) {
      this.identityMatcher.assign(hands, timestamp, aspectRatio);
    }

    this.result.hands.length = 0;

    for (
      let index = 0;
      index < hands.length && index < this.options.maxHands;
      index += 1
    ) {
      const hand = hands[index];
      const state = this.getHandState(hand.id);
      state.lastSeen = timestamp;

      this.analyzeHand(hand, aspectRatio);
      this.smoothScores(state, timestamp);

      this.facingValue = this.computeFacingValue(hand, aspectRatio);
      const facingSign = this.updateFacing(state, this.facingValue, timestamp);

      const output = this.handResults[index];
      output.id = hand.id;
      output.handedness = hand.handedness;
      output.facingValue = this.facingValue;
      output.facingSign = facingSign;
      output.openPalm = this.updateHysteresis(
        state.states.openPalm,
        state.smoothedScores.openPalm,
        timestamp,
      );
      output.fist = this.updateHysteresis(
        state.states.fist,
        state.smoothedScores.fist,
        timestamp,
      );
      output.victory = this.updateHysteresis(
        state.states.victory,
        state.smoothedScores.victory,
        timestamp,
      );
      output.lShape = this.updateHysteresis(
        state.states.lShape,
        state.smoothedScores.lShape,
        timestamp,
      );
      output.lShapeScore = state.smoothedScores.lShape;
      output.angleDegrees = this.angleDegrees;

      for (let i = 0; i < this.fingerScores.length; i += 1) {
        output.fingerScores[i] = this.fingerScores[i];
      }

      this.result.hands.push(output);
    }

    for (const [id, state] of this.handStates) {
      if (timestamp - state.lastSeen >= this.options.handStateTtlMs) {
        this.handStates.delete(id);
      }
    }

    this.updateTwoHands(hands, this.result.hands, aspectRatio, timestamp);
    return this.result;
  }
}
