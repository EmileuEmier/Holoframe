import * as THREE from 'three';
import config from '../config.js';
import { getCoverTransform, landmarkToScreen } from '../core/screenMapping.js';
import { FramePanel, VictoryShard, FrozenShape } from './shapes.js';
import { BoxSlab } from './box.js';
import { VideoLayer } from './videoLayer.js';

const CORNER_COUNT = 4;
const PALM_LANDMARKS = [0, 5, 9, 13, 17];
const PALM_LANDMARK_COUNT = PALM_LANDMARKS.length;

class PalmWipeTracker {
  constructor(options = config.wipe) {
    this.options = options;
    this.capacity = Math.max(2, Math.floor(options.sampleCapacity ?? 64));
    this.samples = Array.from({ length: this.capacity }, () => ({
      t: 0,
      x: 0,
      y: 0,
      open: 0,
    }));
    this.head = 0;
    this.count = 0;
    this.lastSampleAt = 0;
    this.lastSeen = 0;
    this.result = {
      valid: false,
      distance: 0,
      distanceRatio: 0,
      speed: 0,
      speedRatio: 0,
      openScore: 0,
      horizontal: false,
      direction: '-',
      dx: 0,
      dy: 0,
    };
    this.debug = {
      distanceRatio: 0,
      speed: 0,
      openScore: 0,
      direction: '-',
      cooldownMs: 0,
    };
  }

  reset() {
    this.head = 0;
    this.count = 0;
    this.lastSampleAt = 0;
    this.result.valid = false;
    this.result.distance = 0;
    this.result.distanceRatio = 0;
    this.result.speed = 0;
    this.result.speedRatio = 0;
    this.result.openScore = 0;
    this.result.horizontal = false;
    this.result.direction = '-';
    this.result.dx = 0;
    this.result.dy = 0;
    this.debug.distanceRatio = 0;
    this.debug.speed = 0;
    this.debug.openScore = 0;
    this.debug.direction = '-';
  }

  push(t, x, y, open) {
    if (this.count > 0 && t - this.lastSampleAt > this.options.maxGapMs) {
      this.reset();
    }
    const sample = this.samples[this.head];
    sample.t = t;
    sample.x = x;
    sample.y = y;
    sample.open = open;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
    this.lastSampleAt = t;
  }

  evaluate(now, aspectRatio) {
    const result = this.result;
    result.valid = false;

    if (this.count < 2) {
      this.debug.distanceRatio = 0;
      this.debug.speed = 0;
      this.debug.openScore = 0;
      this.debug.direction = '-';
      return result;
    }

    const oldest = (this.head - this.count + this.capacity) % this.capacity;
    let firstIndex = -1;
    for (let n = 0; n < this.count; n += 1) {
      const index = (oldest + n) % this.capacity;
      if (now - this.samples[index].t <= this.options.windowMs) {
        firstIndex = index;
        break;
      }
    }
    if (firstIndex < 0) {
      this.debug.distanceRatio = 0;
      this.debug.speed = 0;
      this.debug.openScore = 0;
      this.debug.direction = '-';
      return result;
    }

    const lastIndex = (this.head - 1 + this.capacity) % this.capacity;
    const first = this.samples[firstIndex];
    const last = this.samples[lastIndex];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) {
      this.debug.distanceRatio = 0;
      this.debug.speed = 0;
      this.debug.openScore = 0;
      this.debug.direction = '-';
      return result;
    }

    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const distance = Math.hypot(dx, dy);
    const speed = distance / dt;

    let openSum = 0;
    let openCount = 0;
    for (let n = 0; n < this.count; n += 1) {
      const index = (oldest + n) % this.capacity;
      const sample = this.samples[index];
      if (now - sample.t <= this.options.windowMs) {
        openSum += sample.open;
        openCount += 1;
      }
    }
    const openScore = openCount > 0 ? openSum / openCount : 0;

    // Palm x is aspect-normalized, so distance and speed thresholds use the
    // same screen-width units as the shared landmark mapping.
    const minDistance = this.options.minDistance * aspectRatio;
    const minSpeed = this.options.minSpeed * aspectRatio;

    result.valid = true;
    result.distance = distance;
    result.distanceRatio = minDistance > 0 ? distance / minDistance : 0;
    result.speed = aspectRatio > 0 ? speed / aspectRatio : 0;
    result.speedRatio = minSpeed > 0 ? speed / minSpeed : 0;
    result.openScore = openScore;
    result.horizontal =
      Math.abs(dy) <= this.options.maxVerticalRatio * Math.abs(dx);
    result.direction = dx >= 0 ? 'ltr' : 'rtl';
    result.dx = dx;
    result.dy = dy;

    this.debug.distanceRatio = result.distanceRatio;
    this.debug.speed = result.speed;
    this.debug.openScore = openScore;
    this.debug.direction = result.direction;
    return result;
  }
}

export class SceneManager {
  constructor(canvas, video, options = config.scene) {
    this.video = video;
    this.options = options;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;

    this.scene = new THREE.Scene();
    // Camera planes use CSS pixels with y increasing downward, matching the HUD
    // and the shared screen mapping exactly.
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 100);
    this.camera.position.z = 10;

    // Separate perspective pass for the 3D slab. The camera is placed so the
    // world z = 0 plane spans exactly the viewport in CSS pixels.
    this.sceneBox = new THREE.Scene();
    this.boxCamera = new THREE.PerspectiveCamera(config.box.fov, 1, 0.1, 100000);
    this.boxCamera.position.set(0, 0, 1000);
    this.boxCamera.lookAt(0, 0, 0);

    this.boxSlab = new BoxSlab(config.box);
    this.sceneBox.add(this.boxSlab.group);

    this.boxHands = {
      a: { x: 0, y: 0, size: 0, valid: false },
      b: { x: 0, y: 0, size: 0, valid: false },
    };
    this.boxPalmCenter = { x: 0, y: 0 };
    this.boxWrist = { x: 0, y: 0 };
    this.boxMcp = { x: 0, y: 0 };
    this.boxDebug = {
      active: false,
      width: 0,
      height: 0,
      depth: 0,
      roll: 0,
      yaw: 0,
      pitch: 0,
      idA: null,
      idB: null,
    };

    this.width = 0;
    this.height = 0;
    this.coverTransform = {};
    this.screenCorners = Array.from({ length: CORNER_COUNT }, () => ({ x: 0, y: 0 }));
    this.lastTime = performance.now();

    this.thermalTarget = config.thermal.enabled ? 1 : 0;
    this.thermalFistHolds = new Map();
    this.thermalFistLocked = false;
    this.thermalCooldownUntil = 0;
    this.thermalHoldMs = 0;
    this.thermalFrameId = 0;
    this.anyFistHeld = false;
    this.thermalDebug = {
      enabled: this.thermalTarget === 1,
      palette: '',
      mix: this.thermalTarget,
      fistHoldMs: 0,
      holdMs: config.thermal.holdMs,
    };

    this.videoLayer = new VideoLayer(video, config.thermal);
    this.scene.add(this.videoLayer.mesh);
    this.thermalDebug.palette = this.videoLayer.paletteName;

    this.persistEnabled = false;
    this.persistDebug = { enabled: false, stamps: 0 };
    this.stamps = [];
    this.frameWasActive = false;
    this.frameActiveSince = null;
    this.wipeTrackers = new Map();
    this.wipeCooldownUntil = 0;

    this.framePanel = new FramePanel(options.framePanel);
    this.scene.add(this.framePanel.group);

    this.victoryShards = Array.from(
      { length: config.victory.maxShards },
      (_, index) =>
        new VictoryShard(
          config.victory,
          config.victory.colors[index % config.victory.colors.length],
        ),
    );
    for (const shard of this.victoryShards) {
      this.scene.add(shard.group);
    }

    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
  }

  handleResize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.options.maxDevicePixelRatio),
    );
    this.renderer.setSize(this.width, this.height, false);

    this.camera.left = 0;
    this.camera.right = this.width;
    this.camera.top = 0;
    this.camera.bottom = this.height;
    this.camera.updateProjectionMatrix();

    // Distance where the vertical FOV covers exactly the viewport height, so
    // one world unit equals one CSS pixel on z = 0.
    const halfFov = THREE.MathUtils.degToRad(this.boxCamera.fov) * 0.5;
    const cameraZ = this.height * 0.5 / Math.max(Math.tan(halfFov), 1e-6);
    this.boxCamera.aspect = this.width / Math.max(1, this.height);
    this.boxCamera.position.set(0, 0, cameraZ);
    this.boxCamera.near = 0.1;
    this.boxCamera.far = cameraZ * 2 + 2000;
    this.boxCamera.lookAt(0, 0, 0);
    this.boxCamera.updateProjectionMatrix();

    const transform = getCoverTransform(
      this.video,
      this.width,
      this.height,
      config.camera.width,
      config.camera.height,
      this.coverTransform,
    );
    this.videoLayer.updateCover(transform, this.width, this.height);
  }

  update(gestureState, hands = []) {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    const transform = getCoverTransform(
      this.video,
      this.width,
      this.height,
      config.camera.width,
      config.camera.height,
      this.coverTransform,
    );
    const aspectRatio =
      this.video?.videoWidth && this.video?.videoHeight
        ? this.video.videoWidth / this.video.videoHeight
        : config.camera.width / config.camera.height;

    this.videoLayer.updateCover(transform, this.width, this.height);

    const twoHands = gestureState?.twoHands;
    const active = Boolean(twoHands?.active && twoHands.frameCorners);

    if (active) {
      for (let i = 0; i < CORNER_COUNT; i += 1) {
        landmarkToScreen(twoHands.frameCorners[i], transform, this.screenCorners[i]);
      }
    }

    // Snapshot before FramePanel.update() starts the live fade.
    this.updateFrameStampState(active, now);
    this.framePanel.setThermal(
      this.videoLayer.mix,
      this.videoLayer.palette?.panel,
    );
    this.framePanel.update(
      active,
      active ? this.screenCorners : null,
      twoHands?.orientation ?? null,
      dt,
      twoHands?.twist ?? 0,
    );

    this.updateVictoryShards(gestureState, hands, transform, dt, now);
    this.updateWipe(gestureState, hands, aspectRatio, now);
    this.updateBox(gestureState, hands, transform, dt, now);
    this.updateThermal(gestureState, now);
    this.videoLayer.update(dt, this.thermalTarget, now);
    this.thermalDebug.enabled = this.thermalTarget === 1;
    this.thermalDebug.palette = this.videoLayer.paletteName;
    this.thermalDebug.mix = this.videoLayer.mix;
    this.thermalDebug.fistHoldMs = this.thermalHoldMs;
    this.thermalDebug.holdMs = config.thermal.holdMs;
    this.updateStamps(now);

    // Orthographic overlay first, then the perspective slab on a fresh depth
    // buffer so it always composites in front of the existing visuals.
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.sceneBox, this.boxCamera);
  }

  isVictoryShardActive(gestureHands, handIndex) {
    const hand = gestureHands?.[handIndex];
    if (!hand?.victory) return false;
    if (!config.victory.requireThumbExtended) return true;
    return (
      Number(hand.fingerScores?.[0] ?? 0) >
      config.victory.thumbExtendedThreshold
    );
  }

  updateVictoryShards(gestureState, hands, transform, dt, now) {
    const gestureHands = gestureState?.hands;
    const shards = this.victoryShards;

    // Keep assigned shards attached to their persistent hand id. Array reorder
    // or a brief dropout must not swap the purple/blue slot colors.
    for (let s = 0; s < shards.length; s += 1) {
      const shard = shards[s];
      let handIndex = -1;

      if (shard.handId !== null) {
        for (let i = 0; i < hands.length; i += 1) {
          if (hands[i].id === shard.handId) {
            handIndex = i;
            break;
          }
        }
      }

      if (handIndex >= 0) {
        shard.lastSeen = now;
        const nextActive = this.isVictoryShardActive(gestureHands, handIndex);
        this.prepareShardUpdate(shard, nextActive, now);
        shard.update(
          nextActive,
          hands[handIndex].landmarks,
          transform,
          dt,
        );
      } else {
        if (shard.handId !== null && now - shard.lastSeen > config.victory.idTtlMs) {
          shard.handId = null;
        }
        this.prepareShardUpdate(shard, false, now);
        shard.update(false, null, transform, dt);
      }
    }

    // Assign a shard when a hand first shows victory, then keep that shard tied
    // to its persistent id until the hand disappears.
    for (let i = 0; i < hands.length; i += 1) {
      const id = hands[i].id;
      const nextActive = this.isVictoryShardActive(gestureHands, i);
      if (id == null || !nextActive) continue;

      let assigned = false;
      for (let s = 0; s < shards.length; s += 1) {
        if (shards[s].handId === id) {
          assigned = true;
          break;
        }
      }
      if (assigned) continue;

      let freeShard = null;
      for (let s = 0; s < shards.length; s += 1) {
        if (shards[s].handId === null) {
          freeShard = shards[s];
          break;
        }
      }

      if (!freeShard) {
        // If a slot is still held by an absent hand, a new active hand may take
        // it immediately instead of waiting for the id TTL.
        for (let s = 0; s < shards.length; s += 1) {
          const shard = shards[s];
          if (shard.handId === null) continue;

          let present = false;
          for (let h = 0; h < hands.length; h += 1) {
            if (hands[h].id === shard.handId) {
              present = true;
              break;
            }
          }
          if (!present) {
            freeShard = shard;
            break;
          }
        }
      }

      if (!freeShard) continue;

      freeShard.handId = id;
      freeShard.lastSeen = now;
      // A reused slot must not fly in from the previous hand's pose.
      freeShard.opacity = 0;
      freeShard.initialized = false;
      freeShard.activeSince = nextActive ? now : null;
      freeShard.update(
        nextActive,
        hands[i].landmarks,
        transform,
        dt,
      );
    }

    let firstActiveShard = null;
    for (let s = 0; s < shards.length; s += 1) {
      if (shards[s].active) {
        firstActiveShard = shards[s];
        break;
      }
    }
    if (gestureState) {
      gestureState.victoryCorners = firstActiveShard
        ? firstActiveShard.smoothedPoints
        : null;
    }
  }

  updateBox(gestureState, hands, transform, dt, now) {
    const box = gestureState?.box;
    const active = Boolean(box?.active);
    const data = this.boxHands;
    data.a.valid = false;
    data.b.valid = false;

    if (active) {
      for (let i = 0; i < hands.length; i += 1) {
        const hand = hands[i];
        const id = hand.id;
        if (id == null || !hand.landmarks) continue;

        let target = null;
        if (id === box.idA) {
          target = data.a;
        } else if (id === box.idB) {
          target = data.b;
        } else {
          continue;
        }

        const landmarks = hand.landmarks;
        let palmX = 0;
        let palmY = 0;
        let valid = true;
        for (let k = 0; k < PALM_LANDMARK_COUNT; k += 1) {
          const landmark = landmarks[PALM_LANDMARKS[k]];
          if (!landmark) {
            valid = false;
            break;
          }
          palmX += landmark.x;
          palmY += landmark.y;
        }
        if (!valid) continue;

        // Same landmark -> screen mapping as the HUD.
        this.boxPalmCenter.x = palmX / PALM_LANDMARK_COUNT;
        this.boxPalmCenter.y = palmY / PALM_LANDMARK_COUNT;
        landmarkToScreen(this.boxPalmCenter, transform, target);

        const wrist = landmarks[0];
        const middleMcp = landmarks[9];
        if (!wrist || !middleMcp) continue;
        landmarkToScreen(wrist, transform, this.boxWrist);
        landmarkToScreen(middleMcp, transform, this.boxMcp);
        target.size = Math.hypot(
          this.boxMcp.x - this.boxWrist.x,
          this.boxMcp.y - this.boxWrist.y,
        );
        target.valid = true;
      }
    }

    this.boxSlab.update(active, data, this.width, this.height, dt, now);

    const debug = this.boxDebug;
    debug.active = active;
    debug.width = this.boxSlab.width;
    debug.height = this.boxSlab.height;
    debug.depth = this.boxSlab.depth;
    debug.roll = this.boxSlab.roll;
    debug.yaw = this.boxSlab.yaw;
    debug.pitch = this.boxSlab.pitch;
    debug.idA = box?.idA ?? null;
    debug.idB = box?.idB ?? null;
  }

  getBoxDebug() {
    return this.boxDebug;
  }

  updateThermal(gestureState, now) {
    const gestureHands = gestureState?.hands;
    const handCount = gestureHands?.length ?? 0;
    const frame = gestureState?.twoHands;
    const frameId = (this.thermalFrameId += 1);
    let anyFist = false;
    let maxHold = 0;

    for (let i = 0; i < handCount; i += 1) {
      const hand = gestureHands[i];
      if (!hand) continue;
      if (hand.fist) anyFist = true;

      const id = hand.id;
      if (id == null) continue;

      const inFrame = Boolean(
        frame?.active && (id === frame.idA || id === frame.idB),
      );
      const eligible = Boolean(hand.fist && !inFrame && !hand.victory);
      if (!eligible) {
        this.thermalFistHolds.delete(id);
        continue;
      }

      let hold = this.thermalFistHolds.get(id);
      if (!hold) {
        hold = { start: now, frame: frameId };
        this.thermalFistHolds.set(id, hold);
      }
      hold.frame = frameId;

      const duration = now - hold.start;
      if (duration > maxHold) maxHold = duration;

      if (
        !this.thermalFistLocked &&
        now >= this.thermalCooldownUntil &&
        duration >= config.thermal.holdMs
      ) {
        this.thermalTarget = this.thermalTarget ? 0 : 1;
        this.thermalFistLocked = true;
        this.thermalCooldownUntil = now + config.thermal.cooldownMs;
      }
    }

    for (const [id, hold] of this.thermalFistHolds) {
      if (hold.frame !== frameId) this.thermalFistHolds.delete(id);
    }

    if (!anyFist) this.thermalFistLocked = false;
    this.anyFistHeld = anyFist;
    this.thermalHoldMs = Math.min(config.thermal.holdMs, maxHold);
  }

  getThermalDebug() {
    return this.thermalDebug;
  }

  toggleThermal() {
    this.thermalTarget = this.thermalTarget ? 0 : 1;
    this.thermalFistHolds.clear();
    this.thermalHoldMs = 0;
    if (this.anyFistHeld) this.thermalFistLocked = true;
    return this.thermalTarget;
  }

  cycleThermalPalette() {
    return this.videoLayer.cyclePalette(config.thermal.palettes);
  }

  updateFrameStampState(active, now) {
    if (active && !this.frameWasActive) {
      this.frameActiveSince = now;
    } else if (!active && this.frameWasActive) {
      if (
        this.persistEnabled &&
        this.frameActiveSince !== null &&
        now - this.frameActiveSince >= config.persist.minActiveMs
      ) {
        this.addStamp(
          FrozenShape.fromFramePanel(this.framePanel, config.persist),
          now,
        );
      }
      this.frameActiveSince = null;
    }
    this.frameWasActive = active;
  }

  prepareShardUpdate(shard, nextActive, now) {
    if (nextActive) {
      if (!shard.active || shard.activeSince === null) {
        shard.activeSince = now;
      }
      return;
    }

    if (shard.active) {
      if (
        this.persistEnabled &&
        shard.activeSince !== null &&
        now - shard.activeSince >= config.persist.minActiveMs
      ) {
        this.addStamp(
          FrozenShape.fromVictoryShard(shard, config.persist),
          now,
        );
      }
      shard.activeSince = null;
    }
  }

  getPersistDebug() {
    return this.persistDebug;
  }

  togglePersist() {
    this.setPersist(!this.persistEnabled);
    return this.persistEnabled;
  }

  setPersist(enabled) {
    this.persistEnabled = Boolean(enabled);
    this.persistDebug.enabled = this.persistEnabled;
    if (!this.persistEnabled && config.persist.clearOnDisable) {
      this.dismissAllStamps(performance.now(), config.persist.removeFadeMs);
    }
  }

  clearStamps() {
    this.dismissAllStamps(performance.now(), config.wipe.fadeMs);
  }

  dismissAllStamps(now, fadeMs) {
    for (const stamp of this.stamps) {
      stamp.dismiss(now, fadeMs);
    }
  }

  addStamp(stamp, now) {
    this.stamps.push(stamp);
    this.scene.add(stamp.group);

    const maxStamps = Math.max(0, Math.floor(config.persist.maxStamps));
    let overflow = this.stamps.length - maxStamps;
    for (let i = 0; i < this.stamps.length && overflow > 0; i += 1) {
      const oldest = this.stamps[i];
      if (oldest.removing) continue;
      oldest.dismiss(now, config.persist.removeFadeMs);
      overflow -= 1;
    }
  }

  updateStamps(now) {
    for (let i = this.stamps.length - 1; i >= 0; i -= 1) {
      const stamp = this.stamps[i];
      if (!stamp.update(now)) {
        this.scene.remove(stamp.group);
        stamp.dispose();
        this.stamps.splice(i, 1);
      }
    }
    this.persistDebug.stamps = this.stamps.length;
  }

  getWipeTracker(id) {
    let tracker = this.wipeTrackers.get(id);
    if (!tracker) {
      tracker = new PalmWipeTracker(config.wipe);
      this.wipeTrackers.set(id, tracker);
    }
    return tracker;
  }

  updateWipe(gestureState, hands, aspectRatio, now) {
    const gestureHands = gestureState?.hands;
    const frame = gestureState?.twoHands;
    const box = gestureState?.box;

    for (let i = 0; i < hands.length; i += 1) {
      const hand = hands[i];
      const id = hand.id;
      if (id == null || !hand.landmarks) continue;

      const tracker = this.getWipeTracker(id);
      tracker.lastSeen = now;

      const landmarks = hand.landmarks;
      let palmX = 0;
      let palmY = 0;
      let palmValid = true;
      for (let k = 0; k < PALM_LANDMARK_COUNT; k += 1) {
        const landmark = landmarks[PALM_LANDMARKS[k]];
        if (!landmark) {
          palmValid = false;
          break;
        }
        palmX += landmark.x;
        palmY += landmark.y;
      }
      if (!palmValid) continue;
      palmX = (palmX / PALM_LANDMARK_COUNT) * aspectRatio;
      palmY /= PALM_LANDMARK_COUNT;

      const handState = gestureHands?.[i];
      const fingers = handState?.fingerScores;
      let openScore = 0;
      if (fingers && fingers.length > 0) {
        for (let k = 0; k < fingers.length; k += 1) {
          openScore += fingers[k];
        }
        openScore /= fingers.length;
      }

      tracker.push(now, palmX, palmY, openScore);
      const result = tracker.evaluate(now, aspectRatio);
      tracker.debug.cooldownMs = Math.max(0, this.wipeCooldownUntil - now);
      if (handState) handState.wipeDebug = tracker.debug;

      const inFrame = Boolean(
        frame?.active && (id === frame.idA || id === frame.idB),
      );
      const inVictory = Boolean(handState?.victory);
      const inBox = Boolean(
        box?.active && (id === box.idA || id === box.idB),
      );
      if (inFrame || inVictory || inBox || !result.valid) continue;
      if (result.distanceRatio < 1) continue;
      if (result.speedRatio < 1) continue;
      if (!result.horizontal) continue;
      if (result.openScore < config.wipe.minOpenScore) continue;
      if (
        config.wipe.directions !== 'both' &&
        config.wipe.directions !== result.direction
      ) {
        continue;
      }
      if (now < this.wipeCooldownUntil || this.stamps.length === 0) continue;

      this.fireWipe(result.dx >= 0 ? 1 : -1, now);
      tracker.reset();
      tracker.debug.cooldownMs = config.wipe.cooldownMs;
    }

    const staleAfter = config.wipe.maxGapMs + config.wipe.windowMs;
    for (const entry of this.wipeTrackers) {
      if (now - entry[1].lastSeen > staleAfter) {
        this.wipeTrackers.delete(entry[0]);
      }
    }
  }

  fireWipe(directionSign, now) {
    this.wipeCooldownUntil = now + config.wipe.cooldownMs;
    const width = Math.max(1, this.width);

    for (const stamp of this.stamps) {
      // Delay each stamp by its position along the sweep so the clear reads as
      // one wave instead of every stamp fading at once.
      const progress =
        directionSign >= 0
          ? stamp.centroidX / width
          : (width - stamp.centroidX) / width;
      const delay = Math.min(1, Math.max(0, progress)) * config.wipe.waveMs;
      stamp.dismiss(now, config.wipe.fadeMs, delay);
    }
  }

  destroy() {
    window.removeEventListener('resize', this.handleResize);
    for (const stamp of this.stamps) {
      this.scene.remove(stamp.group);
      stamp.dispose();
    }
    this.stamps.length = 0;
    this.persistDebug.stamps = 0;
    this.wipeTrackers.clear();
    this.thermalFistHolds.clear();
    this.scene.remove(this.videoLayer.mesh);
    this.videoLayer.dispose();
    this.framePanel.dispose();
    for (const shard of this.victoryShards) {
      shard.dispose();
    }
    this.sceneBox.remove(this.boxSlab.group);
    this.boxSlab.dispose();
    this.renderer.dispose();
  }
}
