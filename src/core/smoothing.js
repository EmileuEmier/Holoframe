import config from '../config.js';
import { HandIdentityMatcher } from './handIdentity.js';

const LANDMARK_COUNT = 21;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

class LowPassFilter {
  constructor() {
    this.initialized = false;
    this.value = 0;
  }

  filter(value, alpha) {
    if (!this.initialized) {
      this.initialized = true;
      this.value = value;
      return value;
    }

    this.value = alpha * value + (1 - alpha) * this.value;
    return this.value;
  }

  reset() {
    this.initialized = false;
    this.value = 0;
  }
}

class OneEuroFilter {
  constructor(params) {
    // Keep the params object by reference so live tuning updates every filter.
    this.params = params;
    this.valueFilter = new LowPassFilter();
    this.derivativeFilter = new LowPassFilter();
    this.previousValue = 0;
    this.initialized = false;
  }

  static alpha(cutoff, dt) {
    // Standard One Euro smoothing coefficient: tau = 1 / (2 * PI * cutoff).
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value, dt) {
    if (!Number.isFinite(value)) return value;

    if (!this.initialized) {
      this.initialized = true;
      this.previousValue = value;
      return this.valueFilter.filter(value, 1);
    }

    const derivative = (value - this.previousValue) / Math.max(dt, 1e-6);
    const filteredDerivative = this.derivativeFilter.filter(
      derivative,
      OneEuroFilter.alpha(this.params.derivativeCutoff, dt),
    );

    // Faster movement raises the cutoff, which keeps quick gestures responsive.
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(filteredDerivative);
    const result = this.valueFilter.filter(value, OneEuroFilter.alpha(cutoff, dt));

    this.previousValue = value;
    return result;
  }

  reset() {
    this.valueFilter.reset();
    this.derivativeFilter.reset();
    this.initialized = false;
  }
}

export class LandmarkSmoother {
  constructor(options = config.smoothing) {
    this.enabled = options.enabled;
    this.resetAfterMissingMs = options.resetAfterMissingMs;

    this.filterParams = {
      minCutoff: options.minCutoff,
      beta: options.beta,
      derivativeCutoff: options.derivativeCutoff,
    };

    this.identityMatcher = new HandIdentityMatcher({
      maxDistance: config.handTracking.identityMaxDistance,
      ttlMs: config.handTracking.identityTtlMs,
    });
    this.handStates = new Map();
    this.lastTimestamp = null;
  }

  createHandState() {
    const filters = Array.from({ length: LANDMARK_COUNT }, () => [
      new OneEuroFilter(this.filterParams),
      new OneEuroFilter(this.filterParams),
      new OneEuroFilter(this.filterParams),
    ]);

    return { filters, lastSeen: 0 };
  }

  getParameters() {
    return {
      minCutoff: this.filterParams.minCutoff,
      beta: this.filterParams.beta,
      derivativeCutoff: this.filterParams.derivativeCutoff,
    };
  }

  adjustBeta(delta) {
    const tuning = config.smoothing.tuning;
    this.filterParams.beta = clamp(
      this.filterParams.beta + delta,
      tuning.betaMin,
      tuning.betaMax,
    );
    config.smoothing.beta = this.filterParams.beta;
    return this.filterParams.beta;
  }

  adjustMinCutoff(delta) {
    const tuning = config.smoothing.tuning;
    this.filterParams.minCutoff = clamp(
      this.filterParams.minCutoff + delta,
      tuning.minCutoffMin,
      tuning.minCutoffMax,
    );
    config.smoothing.minCutoff = this.filterParams.minCutoff;
    return this.filterParams.minCutoff;
  }

  reset() {
    this.handStates.clear();
    this.identityMatcher.reset();
    this.lastTimestamp = null;
  }

  smooth(
    hands,
    timestamp = performance.now(),
    aspectRatio = config.camera.width / config.camera.height,
  ) {
    if (!this.enabled) return hands;

    let dt = this.lastTimestamp === null ? 1 / 60 : (timestamp - this.lastTimestamp) / 1000;
    this.lastTimestamp = timestamp;
    dt = clamp(dt, 1 / 240, 0.1);

    // HandTracker normally provides ids. This fallback keeps direct callers and
    // tests working without depending on MediaPipe's array order.
    for (let i = 0; i < hands.length; i += 1) {
      if (hands[i].id == null) {
        this.identityMatcher.assign(hands, timestamp, aspectRatio);
        break;
      }
    }

    const smoothedHands = hands.map((hand) => {
      const id = hand.id;
      let state = this.handStates.get(id);
      if (!state) {
        state = this.createHandState();
        this.handStates.set(id, state);
      }

      state.lastSeen = timestamp;

      const landmarks = hand.landmarks.map((landmark, landmarkIndex) => {
        const filters = state.filters[landmarkIndex];
        return {
          ...landmark,
          x: filters[0].filter(landmark.x, dt),
          y: filters[1].filter(landmark.y, dt),
          z: filters[2].filter(landmark.z, dt),
        };
      });

      // world is passed through untouched; gesture math needs the metric points.
      return { ...hand, landmarks };
    });

    // Identity TTL is shorter than this, so a new identity always gets new
    // filters while a brief dropout keeps the existing filters.
    for (const [id, state] of this.handStates) {
      if (timestamp - state.lastSeen >= this.resetAfterMissingMs) {
        this.handStates.delete(id);
      }
    }

    return smoothedHands;
  }
}
