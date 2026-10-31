import * as THREE from 'three';
import config from '../config.js';

const CORNER_COUNT = 4;

export class FramePanel {
  constructor(options = config.scene.framePanel) {
    this.options = options;
    this.group = new THREE.Group();
    this.group.visible = false;

    this.opacity = 0;
    this.initialized = false;
    this.orientation = 'horizontal';

    const horizontalTheme = options.themes.horizontal;
    this.currentFillColor = new THREE.Color(horizontalTheme.fill);
    this.currentLineColor = new THREE.Color(horizontalTheme.line);
    this.targetFillColor = new THREE.Color(horizontalTheme.fill);
    this.targetLineColor = new THREE.Color(horizontalTheme.line);

    this.smoothedCorners = Array.from({ length: CORNER_COUNT }, () => ({ x: 0, y: 0 }));
    this.texture = this.createHalftoneTexture();

    this.meshGeometry = new THREE.BufferGeometry();
    this.meshGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(CORNER_COUNT * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.meshGeometry.setAttribute(
      'uv',
      new THREE.BufferAttribute(
        new Float32Array([0, 0, 0, 1, 1, 1, 1, 0]),
        2,
      ),
    );
    this.meshGeometry.setIndex([0, 1, 2, 0, 2, 3]);

    this.fillMaterial = new THREE.MeshBasicMaterial({
      map: this.texture,
      color: this.currentFillColor,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    this.mesh = new THREE.Mesh(this.meshGeometry, this.fillMaterial);
    this.mesh.frustumCulled = false;

    this.lineGeometry = new THREE.BufferGeometry();
    this.lineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(CORNER_COUNT * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );

    this.lineMaterial = new THREE.LineBasicMaterial({
      color: this.currentLineColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    this.line = new THREE.LineLoop(this.lineGeometry, this.lineMaterial);
    this.line.frustumCulled = false;

    this.group.add(this.mesh, this.line);
  }

  createHalftoneTexture() {
    const size = this.options.textureSize;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Faint background keeps the panel readable; brighter dots form a halftone
    // pattern on top of it.
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = `rgba(255, 255, 255, ${this.options.textureBackgroundAlpha})`;
    ctx.fillRect(0, 0, size, size);

    const step = size / this.options.textureDots;
    const radius = step * this.options.textureDotRadius;
    ctx.fillStyle = `rgba(255, 255, 255, ${this.options.textureDotAlpha})`;
    for (let y = step / 2; y < size; y += step) {
      for (let x = step / 2; x < size; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(this.options.textureRepeat.x, this.options.textureRepeat.y);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  update(active, corners, orientation, dt) {
    const delta = Math.min(dt, 0.1);
    const fade = 1 - Math.exp(-this.options.fadeSpeed * delta);
    const targetOpacity = active ? 1 : 0;
    this.opacity += (targetOpacity - this.opacity) * fade;

    if (this.opacity < 0.001) this.opacity = 0;
    if (this.opacity > 0.999) this.opacity = 1;

    if (active && corners) {
      if (!this.initialized || this.opacity < 0.01) {
        for (let i = 0; i < CORNER_COUNT; i += 1) {
          this.smoothedCorners[i].x = corners[i].x;
          this.smoothedCorners[i].y = corners[i].y;
        }
        this.initialized = true;
      } else {
        const motion = 1 - Math.exp(-this.options.motionSmoothing * delta);
        for (let i = 0; i < CORNER_COUNT; i += 1) {
          const smoothed = this.smoothedCorners[i];
          smoothed.x += (corners[i].x - smoothed.x) * motion;
          smoothed.y += (corners[i].y - smoothed.y) * motion;
        }
      }

      const theme =
        this.options.themes[orientation] ?? this.options.themes.horizontal;
      this.orientation = orientation ?? this.orientation;
      this.targetFillColor.set(theme.fill);
      this.targetLineColor.set(theme.line);
    }

    const themeLerp = 1 - Math.exp(-this.options.themeTransition * delta);
    this.currentFillColor.lerp(this.targetFillColor, themeLerp);
    this.currentLineColor.lerp(this.targetLineColor, themeLerp);

    const meshPositions = this.meshGeometry.attributes.position.array;
    const linePositions = this.lineGeometry.attributes.position.array;
    for (let i = 0; i < CORNER_COUNT; i += 1) {
      const point = this.smoothedCorners[i];
      const offset = i * 3;
      meshPositions[offset] = point.x;
      meshPositions[offset + 1] = point.y;
      meshPositions[offset + 2] = 0;
      linePositions[offset] = point.x;
      linePositions[offset + 1] = point.y;
      linePositions[offset + 2] = 0;
    }

    this.meshGeometry.attributes.position.needsUpdate = true;
    this.lineGeometry.attributes.position.needsUpdate = true;

    this.fillMaterial.color.copy(this.currentFillColor);
    this.fillMaterial.opacity = this.opacity * this.options.fillOpacity;
    this.lineMaterial.color.copy(this.currentLineColor);
    this.lineMaterial.opacity = this.opacity * this.options.lineOpacity;

    this.group.visible = this.opacity > 0.001;
  }

  dispose() {
    this.texture.dispose();
    this.meshGeometry.dispose();
    this.lineGeometry.dispose();
    this.fillMaterial.dispose();
    this.lineMaterial.dispose();
  }
}
