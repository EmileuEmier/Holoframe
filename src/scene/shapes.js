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

    this.gridU = Math.max(1, Math.floor(options.gridU ?? 16));
    this.gridV = Math.max(1, Math.floor(options.gridV ?? 8));
    this.vertexCount = (this.gridU + 1) * (this.gridV + 1);

    const uvs = new Float32Array(this.vertexCount * 2);
    let uvOffset = 0;
    for (let j = 0; j <= this.gridV; j += 1) {
      const v = j / this.gridV;
      for (let i = 0; i <= this.gridU; i += 1) {
        uvs[uvOffset] = i / this.gridU;
        uvs[uvOffset + 1] = v;
        uvOffset += 2;
      }
    }

    const indices = [];
    for (let j = 0; j < this.gridV; j += 1) {
      for (let i = 0; i < this.gridU; i += 1) {
        const row = j * (this.gridU + 1);
        const nextRow = row + this.gridU + 1;
        const a = row + i;
        const b = a + 1;
        const c = nextRow + i;
        const d = c + 1;
        indices.push(a, b, c, b, d, c);
      }
    }

    this.meshGeometry = new THREE.BufferGeometry();
    this.meshGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(this.vertexCount * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.meshGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.meshGeometry.setIndex(indices);

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

  update(active, corners, orientation, dt, twist = 0) {
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

    const c0 = this.smoothedCorners[0];
    const c1 = this.smoothedCorners[1];
    const c2 = this.smoothedCorners[2];
    const c3 = this.smoothedCorners[3];
    const meshPositions = this.meshGeometry.attributes.position.array;
    const linePositions = this.lineGeometry.attributes.position.array;

    // Bilinear patch: P(u,v) = (1-u)*lerp(c0,c1,v) + u*lerp(c3,c2,v).
    // A crossed corner order therefore folds smoothly instead of breaking into
    // two triangles with a visible diagonal seam.
    let offset = 0;
    for (let j = 0; j <= this.gridV; j += 1) {
      const v = j / this.gridV;
      const edge0x = c0.x + (c1.x - c0.x) * v;
      const edge0y = c0.y + (c1.y - c0.y) * v;
      const edge1x = c3.x + (c2.x - c3.x) * v;
      const edge1y = c3.y + (c2.y - c3.y) * v;

      for (let i = 0; i <= this.gridU; i += 1) {
        const u = i / this.gridU;
        meshPositions[offset] = edge0x + (edge1x - edge0x) * u;
        meshPositions[offset + 1] = edge0y + (edge1y - edge0y) * u;
        meshPositions[offset + 2] = 0;
        offset += 3;
      }
    }

    for (let i = 0; i < CORNER_COUNT; i += 1) {
      const point = this.smoothedCorners[i];
      const lineOffset = i * 3;
      linePositions[lineOffset] = point.x;
      linePositions[lineOffset + 1] = point.y;
      linePositions[lineOffset + 2] = 0;
    }

    this.meshGeometry.attributes.position.needsUpdate = true;
    this.lineGeometry.attributes.position.needsUpdate = true;

    const twistAmount = Math.min(1, Math.max(0, Number(twist) || 0));
    const twistThreshold = this.options.twistOpacityThreshold;
    const twistDrop =
      twistAmount > twistThreshold && twistThreshold < 1
        ? ((twistAmount - twistThreshold) / (1 - twistThreshold)) *
          this.options.twistOpacityDrop
        : 0;

    this.fillMaterial.color.copy(this.currentFillColor);
    this.fillMaterial.opacity =
      this.opacity * this.options.fillOpacity * (1 - twistDrop);
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
