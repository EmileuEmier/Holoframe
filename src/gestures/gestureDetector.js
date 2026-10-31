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

// All cyclic orders starting at corner A. Used to pick a non-self-intersecting
// quad when the hand orientation makes the nominal order cross itself.
const QUAD_PERMUTATIONS = [
  [0, 1, 2, 3],
  [0, 1, 3, 2],
  [0, 2, 1, 3],
  [0, 2, 3, 1],
  [0, 3, 1, 2],
  [0, 3, 2, 1],
];

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

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a, b, c, d) {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD < 0 && cdA * cdB < 0;
}

function isSelfIntersecting(a, b, c, d) {
  return segmentsIntersect(a, b, c, d) || segmentsIntersect(b, c, d, a);
}

function polygonArea(points, order) {
  let area = 0;
  for (let i = 0; i < order.length; i += 1) {
    const current = points[order[i]];
    const next = points[order[(i + 1) % order.length]];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) * 0.5;
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
      fingerScores: [0, 0, 0, 0, 0],
    }));

    this.quadPoints = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0 }));
    this.frameCorners = Array.from({ length: 4 }, () => ({ x: 0, y: 0, z: 0 }));
    this.handOrder = { left: 0, right: 1 };
    this.orientationState = { stable: null, candidate: null, candidateSince: 0 };
    this.frameState = {
      active: false,
      enterStartedAt: null,
      exitStartedAt: null,
      lastDistance: 0,
    };

    this.result = {
      hands: [],
      twoHands: {
        active: false,
        distance: 0,
        frameCorners: null,
        orientation: null,
        score: 0,
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

  orderHandsByWristX(hands) {
    const order = this.handOrder;
    const firstX = hands[0].landmarks[WRIST].x;
    const secondX = hands[1].landmarks[WRIST].x;

    if (firstX <= secondX) {
      order.left = 0;
      order.right = 1;
    } else {
      order.left = 1;
      order.right = 0;
    }

    return order;
  }

  updateFrameGeometry(hands, leftIndex, rightIndex, aspectRatio) {
    const leftHand = hands[leftIndex];
    const rightHand = hands[rightIndex];

    copyPoint(this.quadPoints[0], leftHand.landmarks[THUMB_TIP]);
    copyPoint(this.quadPoints[1], leftHand.landmarks[INDEX_TIP]);
    copyPoint(this.quadPoints[2], rightHand.landmarks[INDEX_TIP]);
    copyPoint(this.quadPoints[3], rightHand.landmarks[THUMB_TIP]);

    let bestOrder = QUAD_PERMUTATIONS[0];
    let bestArea = -Infinity;
    for (const order of QUAD_PERMUTATIONS) {
      const a = this.quadPoints[order[0]];
      const b = this.quadPoints[order[1]];
      const c = this.quadPoints[order[2]];
      const d = this.quadPoints[order[3]];
      if (isSelfIntersecting(a, b, c, d)) continue;

      const area = polygonArea(this.quadPoints, order);
      if (area > bestArea) {
        bestArea = area;
        bestOrder = order;
      }
    }

    for (let i = 0; i < 4; i += 1) {
      copyPoint(this.frameCorners[i], this.quadPoints[bestOrder[i]]);
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of this.frameCorners) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }

    // Normalized width is scaled by the video aspect so the orientation matches
    // the on-screen panel rather than the raw 0..1 landmark space.
    const width = (maxX - minX) * aspectRatio;
    const height = maxY - minY;
    return width > height ? 'horizontal' : 'vertical';
  }

  updateTwoHands(hands, handResults, aspectRatio, timestamp) {
    const twoHands = this.result.twoHands;
    const frameState = this.frameState;
    const hasTwoHands = hands.length >= 2 && handResults.length >= 2;

    let frameScore = 0;
    let currentDistance = 0;
    let leftIndex = -1;
    let rightIndex = -1;

    if (hasTwoHands) {
      const order = this.orderHandsByWristX(hands);
      leftIndex = order.left;
      rightIndex = order.right;
      frameScore = Math.min(
        handResults[leftIndex].lShapeScore,
        handResults[rightIndex].lShapeScore,
      );
      currentDistance = distance2D(
        hands[leftIndex].landmarks[WRIST],
        hands[rightIndex].landmarks[WRIST],
      );
    }

    twoHands.score = frameScore;

    if (!frameState.active) {
      if (hasTwoHands && frameScore > this.options.enterThreshold) {
        if (frameState.enterStartedAt === null) {
          frameState.enterStartedAt = timestamp;
        }
        if (timestamp - frameState.enterStartedAt >= this.options.enterMs) {
          frameState.active = true;
          frameState.enterStartedAt = null;
          frameState.exitStartedAt = null;

          const rawOrientation = this.updateFrameGeometry(
            hands,
            leftIndex,
            rightIndex,
            aspectRatio,
          );
          frameState.lastDistance = currentDistance;

          twoHands.active = true;
          twoHands.distance = currentDistance;
          twoHands.frameCorners = this.frameCorners;
          twoHands.orientation = this.updateOrientation(
            rawOrientation,
            timestamp,
            true,
          );
          return;
        }
      } else {
        frameState.enterStartedAt = null;
      }

      twoHands.active = false;
      twoHands.distance = 0;
      twoHands.frameCorners = null;
      twoHands.orientation = null;
      return;
    }

    if (hasTwoHands && frameScore >= this.options.exitThreshold) {
      frameState.exitStartedAt = null;

      const rawOrientation = this.updateFrameGeometry(
        hands,
        leftIndex,
        rightIndex,
        aspectRatio,
      );
      frameState.lastDistance = currentDistance;

      twoHands.active = true;
      twoHands.distance = currentDistance;
      twoHands.frameCorners = this.frameCorners;
      twoHands.orientation = this.updateOrientation(rawOrientation, timestamp);
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
      this.resetOrientation();

      twoHands.active = false;
      twoHands.distance = 0;
      twoHands.frameCorners = null;
      twoHands.orientation = null;
      return;
    }

    twoHands.active = true;
    twoHands.distance = frameState.lastDistance;
    twoHands.frameCorners = this.frameCorners;
    twoHands.orientation = this.orientationState.stable;
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

      const output = this.handResults[index];
      output.id = hand.id;
      output.handedness = hand.handedness;
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
