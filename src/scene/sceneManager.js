import * as THREE from 'three';
import config from '../config.js';
import { getCoverTransform, landmarkToScreen } from '../core/screenMapping.js';
import { FramePanel, VictoryShard } from './shapes.js';

const CORNER_COUNT = 4;

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
    this.renderer.autoClear = true;

    this.scene = new THREE.Scene();
    // Camera planes use CSS pixels with y increasing downward, matching the HUD
    // and the shared screen mapping exactly.
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, 0.1, 100);
    this.camera.position.z = 10;

    this.width = 0;
    this.height = 0;
    this.coverTransform = {};
    this.screenCorners = Array.from({ length: CORNER_COUNT }, () => ({ x: 0, y: 0 }));
    this.lastTime = performance.now();

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

    const twoHands = gestureState?.twoHands;
    const active = Boolean(twoHands?.active && twoHands.frameCorners);

    if (active) {
      for (let i = 0; i < CORNER_COUNT; i += 1) {
        landmarkToScreen(twoHands.frameCorners[i], transform, this.screenCorners[i]);
      }
    }

    this.framePanel.update(
      active,
      active ? this.screenCorners : null,
      twoHands?.orientation ?? null,
      dt,
      twoHands?.twist ?? 0,
    );

    this.updateVictoryShards(gestureState, hands, transform, dt, now);

    this.renderer.render(this.scene, this.camera);
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
        shard.update(
          this.isVictoryShardActive(gestureHands, handIndex),
          hands[handIndex].landmarks,
          transform,
          dt,
        );
      } else {
        if (shard.handId !== null && now - shard.lastSeen > config.victory.idTtlMs) {
          shard.handId = null;
        }
        shard.update(false, null, transform, dt);
      }
    }

    // Assign a shard when a hand first shows victory, then keep that shard tied
    // to its persistent id until the hand disappears.
    for (let i = 0; i < hands.length; i += 1) {
      const id = hands[i].id;
      if (id == null || !this.isVictoryShardActive(gestureHands, i)) continue;

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
      freeShard.update(
        this.isVictoryShardActive(gestureHands, i),
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

  destroy() {
    window.removeEventListener('resize', this.handleResize);
    this.framePanel.dispose();
    for (const shard of this.victoryShards) {
      shard.dispose();
    }
    this.renderer.dispose();
  }
}
