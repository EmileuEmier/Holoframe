import * as THREE from 'three';
import config from '../config.js';
import { getCoverTransform, landmarkToScreen } from '../core/screenMapping.js';
import { FramePanel } from './shapes.js';

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

  update(gestureState) {
    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    const twoHands = gestureState?.twoHands;
    const active = Boolean(twoHands?.active && twoHands.frameCorners);

    if (active) {
      const transform = getCoverTransform(
        this.video,
        this.width,
        this.height,
        config.camera.width,
        config.camera.height,
        this.coverTransform,
      );

      for (let i = 0; i < CORNER_COUNT; i += 1) {
        landmarkToScreen(twoHands.frameCorners[i], transform, this.screenCorners[i]);
      }
    }

    this.framePanel.update(
      active,
      active ? this.screenCorners : null,
      twoHands?.orientation ?? null,
      dt,
    );

    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    window.removeEventListener('resize', this.handleResize);
    this.framePanel.dispose();
    this.renderer.dispose();
  }
}
