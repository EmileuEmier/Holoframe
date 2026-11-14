import * as THREE from 'three';
import config from '../config.js';
import { landmarkToScreen } from '../core/screenMapping.js';

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
    const verticalTheme = options.themes.vertical ?? horizontalTheme;
    this.currentFillColor = new THREE.Color(horizontalTheme.fill);
    this.currentLineColor = new THREE.Color(horizontalTheme.line);
    this.targetFillColor = new THREE.Color(horizontalTheme.fill);
    this.targetLineColor = new THREE.Color(horizontalTheme.line);

    this.normalThemes = {
      horizontal: {
        fill: new THREE.Color(horizontalTheme.fill),
        line: new THREE.Color(horizontalTheme.line),
      },
      vertical: {
        fill: new THREE.Color(verticalTheme.fill),
        line: new THREE.Color(verticalTheme.line),
      },
    };
    this.thermalThemes = {
      horizontal: {
        fill: new THREE.Color(horizontalTheme.fill),
        line: new THREE.Color(horizontalTheme.line),
      },
      vertical: {
        fill: new THREE.Color(verticalTheme.fill),
        line: new THREE.Color(verticalTheme.line),
      },
    };
    this.lastPanelThemes = null;
    this.thermalMix = 0;
    this.normalFillOpacity = options.fillOpacity;
    this.normalLineOpacity = options.lineOpacity;
    this.thermalFillOpacity = config.thermal.panelFillOpacity ?? 0.7;
    this.thermalLineOpacity = config.thermal.panelLineOpacity ?? 1.0;
    this.thermalGhostLineOpacity = this.thermalLineOpacity * 0.5;
    this.currentFillOpacity = this.normalFillOpacity;
    this.currentLineOpacity = this.normalLineOpacity;

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

    this.lineGeometry2 = new THREE.BufferGeometry();
    this.lineGeometry2.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(CORNER_COUNT * 3), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );

    this.lineMaterial2 = new THREE.LineBasicMaterial({
      color: new THREE.Color(horizontalTheme.line),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    this.line2 = new THREE.LineLoop(this.lineGeometry2, this.lineMaterial2);
    this.line2.frustumCulled = false;
    this.line2.visible = false;

    this.group.add(this.mesh, this.line, this.line2);
  }

  setThermal(mix, panelThemes) {
    this.thermalMix = Math.min(1, Math.max(0, Number(mix) || 0));

    if (panelThemes === this.lastPanelThemes) return;
    this.lastPanelThemes = panelThemes;

    const horizontal = panelThemes?.horizontal ?? this.options.themes.horizontal;
    const vertical =
      panelThemes?.vertical ?? this.options.themes.vertical ?? horizontal;
    this.thermalThemes.horizontal.fill.set(horizontal.fill);
    this.thermalThemes.horizontal.line.set(horizontal.line);
    this.thermalThemes.vertical.fill.set(vertical.fill);
    this.thermalThemes.vertical.line.set(vertical.line);
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

      const themeOrientation = orientation ?? 'horizontal';
      const normalTheme =
        this.normalThemes[themeOrientation] ?? this.normalThemes.horizontal;
      const thermalTheme =
        this.thermalThemes[themeOrientation] ?? this.thermalThemes.horizontal;
      this.orientation = orientation ?? this.orientation;
      this.targetFillColor
        .copy(normalTheme.fill)
        .lerp(thermalTheme.fill, this.thermalMix);
      this.targetLineColor
        .copy(normalTheme.line)
        .lerp(thermalTheme.line, this.thermalMix);
    }

    const themeLerp = 1 - Math.exp(-this.options.themeTransition * delta);
    this.currentFillColor.lerp(this.targetFillColor, themeLerp);
    this.currentLineColor.lerp(this.targetLineColor, themeLerp);

    const targetFillOpacity =
      this.normalFillOpacity +
      (this.thermalFillOpacity - this.normalFillOpacity) * this.thermalMix;
    const targetLineOpacity =
      this.normalLineOpacity +
      (this.thermalLineOpacity - this.normalLineOpacity) * this.thermalMix;
    this.currentFillOpacity +=
      (targetFillOpacity - this.currentFillOpacity) * themeLerp;
    this.currentLineOpacity +=
      (targetLineOpacity - this.currentLineOpacity) * themeLerp;

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

    const linePositions2 = this.lineGeometry2.attributes.position.array;
    for (let i = 0; i < CORNER_COUNT; i += 1) {
      const point = this.smoothedCorners[i];
      const lineOffset = i * 3;
      linePositions[lineOffset] = point.x;
      linePositions[lineOffset + 1] = point.y;
      linePositions[lineOffset + 2] = 0;
      linePositions2[lineOffset] = point.x + 1;
      linePositions2[lineOffset + 1] = point.y + 1;
      linePositions2[lineOffset + 2] = 0;
    }

    this.meshGeometry.attributes.position.needsUpdate = true;
    this.lineGeometry.attributes.position.needsUpdate = true;
    this.lineGeometry2.attributes.position.needsUpdate = true;

    const twistAmount = Math.min(1, Math.max(0, Number(twist) || 0));
    const twistThreshold = this.options.twistOpacityThreshold;
    const twistDrop =
      twistAmount > twistThreshold && twistThreshold < 1
        ? ((twistAmount - twistThreshold) / (1 - twistThreshold)) *
          this.options.twistOpacityDrop
        : 0;

    this.fillMaterial.color.copy(this.currentFillColor);
    this.fillMaterial.opacity =
      this.opacity * this.currentFillOpacity * (1 - twistDrop);
    this.lineMaterial.color.copy(this.currentLineColor);
    this.lineMaterial.opacity = this.opacity * this.currentLineOpacity;

    const ghostVisible = this.thermalMix > 0.01 && this.opacity > 0.001;
    this.line2.visible = ghostVisible;
    this.lineMaterial2.color.copy(this.currentLineColor);
    this.lineMaterial2.opacity = ghostVisible
      ? this.lineMaterial.opacity * this.thermalGhostLineOpacity * this.thermalMix
      : 0;

    this.group.visible = this.opacity > 0.001;
  }

  reset() {
    this.opacity = 0;
    this.initialized = false;
    this.fillMaterial.opacity = 0;
    this.lineMaterial.opacity = 0;
    this.lineMaterial2.opacity = 0;
    this.line2.visible = false;
    this.group.visible = false;
  }

  dispose() {
    this.texture.dispose();
    this.meshGeometry.dispose();
    this.lineGeometry.dispose();
    this.lineGeometry2.dispose();
    this.fillMaterial.dispose();
    this.lineMaterial.dispose();
    this.lineMaterial2.dispose();
  }
}

export class VictoryShard {
  constructor(options = config.victory, color = options.colors?.[0] ?? '#ffffff') {
    this.options = options;
    this.color = new THREE.Color(color);
    this.lineColor = new THREE.Color(color).lerp(
      new THREE.Color('#ffffff'),
      options.lineWhiten,
    );

    this.group = new THREE.Group();
    this.group.visible = false;

    this.opacity = 0;
    this.initialized = false;
    this.active = false;
    this.activeSince = null;
    this.handId = null;
    this.lastSeen = 0;

    this.targetPoints = Array.from({ length: 3 }, () => ({ x: 0, y: 0 }));
    this.smoothedPoints = Array.from({ length: 3 }, () => ({ x: 0, y: 0 }));

    this.gradientTexture = this.createGradientTexture();

    const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);

    this.fillGeometry = new THREE.BufferGeometry();
    this.fillGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(9), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.fillGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    this.glowGeometry = new THREE.BufferGeometry();
    this.glowGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(9), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );
    this.glowGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    this.lineGeometry = new THREE.BufferGeometry();
    this.lineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(9), 3).setUsage(
        THREE.DynamicDrawUsage,
      ),
    );

    this.fillMaterial = new THREE.MeshBasicMaterial({
      map: this.gradientTexture,
      color: this.color,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: this.gradientTexture,
      color: this.color,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.lineMaterial = new THREE.LineBasicMaterial({
      color: this.lineColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.fillMesh = new THREE.Mesh(this.fillGeometry, this.fillMaterial);
    this.glowMesh = new THREE.Mesh(this.glowGeometry, this.glowMaterial);
    this.line = new THREE.LineLoop(this.lineGeometry, this.lineMaterial);

    this.fillMesh.frustumCulled = false;
    this.glowMesh.frustumCulled = false;
    this.line.frustumCulled = false;

    this.group.add(this.glowMesh, this.fillMesh, this.line);
  }

  createGradientTexture() {
    const size = this.options.gradientSize;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    // With flipY disabled, v=0 is transparent and v=1 is bright, giving the
    // triangle a soft gradient instead of a flat, hard-edged fill.
    gradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.flipY = false;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  update(active, landmarks, transform, dt) {
    const delta = Math.min(dt, 0.1);
    this.active = Boolean(active && landmarks);

    const fade = 1 - Math.exp(-this.options.fadeSpeed * delta);
    const targetOpacity = this.active ? 1 : 0;
    this.opacity += (targetOpacity - this.opacity) * fade;
    if (this.opacity < 0.001) this.opacity = 0;
    if (this.opacity > 0.999) this.opacity = 1;

    if (this.active) {
      // The triangle corners are the thumb, index and middle fingertips.
      landmarkToScreen(landmarks[4], transform, this.targetPoints[0]);
      landmarkToScreen(landmarks[8], transform, this.targetPoints[1]);
      landmarkToScreen(landmarks[12], transform, this.targetPoints[2]);

      for (let i = 0; i < 3; i += 1) {
        const target = this.targetPoints[i];
        const smoothed = this.smoothedPoints[i];
        // A bad landmark must not poison the geometry with NaN.
        if (!Number.isFinite(target.x)) target.x = smoothed.x;
        if (!Number.isFinite(target.y)) target.y = smoothed.y;
      }

      if (!this.initialized || this.opacity < 0.01) {
        for (let i = 0; i < 3; i += 1) {
          this.smoothedPoints[i].x = this.targetPoints[i].x;
          this.smoothedPoints[i].y = this.targetPoints[i].y;
        }
        this.initialized = true;
      } else {
        // 0 disables the extra smoothing entirely; the landmarks are already
        // One Euro smoothed, so the corners can stay glued to the fingertips.
        const motion =
          this.options.motionSmoothing > 0
            ? 1 - Math.exp(-this.options.motionSmoothing * delta)
            : 1;
        for (let i = 0; i < 3; i += 1) {
          const smoothed = this.smoothedPoints[i];
          smoothed.x += (this.targetPoints[i].x - smoothed.x) * motion;
          smoothed.y += (this.targetPoints[i].y - smoothed.y) * motion;
        }
      }
    }

    const fillPositions = this.fillGeometry.attributes.position.array;
    const glowPositions = this.glowGeometry.attributes.position.array;
    const linePositions = this.lineGeometry.attributes.position.array;
    const p0 = this.smoothedPoints[0];
    const p1 = this.smoothedPoints[1];
    const p2 = this.smoothedPoints[2];
    const centroidX = (p0.x + p1.x + p2.x) / 3;
    const centroidY = (p0.y + p1.y + p2.y) / 3;
    // A collapsed triangle (overlapping fingers) is still drawn as a line or
    // point. We never divide by its area, and the glow falls back to scale 1
    // so a degenerate shape cannot produce NaN.
    const area =
      Math.abs(
        (p1.x - p0.x) * (p2.y - p0.y) -
          (p2.x - p0.x) * (p1.y - p0.y),
      ) * 0.5;
    const glowScale =
      area > 1e-6 && Number.isFinite(this.options.glowScale)
        ? this.options.glowScale
        : 1;

    for (let i = 0; i < 3; i += 1) {
      const point = this.smoothedPoints[i];
      const offset = i * 3;

      fillPositions[offset] = point.x;
      fillPositions[offset + 1] = point.y;
      fillPositions[offset + 2] = 0;

      glowPositions[offset] = centroidX + (point.x - centroidX) * glowScale;
      glowPositions[offset + 1] = centroidY + (point.y - centroidY) * glowScale;
      glowPositions[offset + 2] = 0;

      linePositions[offset] = point.x;
      linePositions[offset + 1] = point.y;
      linePositions[offset + 2] = 0;
    }

    this.fillGeometry.attributes.position.needsUpdate = true;
    this.glowGeometry.attributes.position.needsUpdate = true;
    this.lineGeometry.attributes.position.needsUpdate = true;

    this.fillMaterial.opacity = this.opacity * this.options.fillOpacity;
    this.glowMaterial.opacity = this.opacity * this.options.glowOpacity;
    this.lineMaterial.opacity = this.opacity * this.options.lineOpacity;
    this.group.visible = this.opacity > 0.001;
  }

  reset() {
    this.opacity = 0;
    this.initialized = false;
    this.active = false;
    this.activeSince = null;
    this.handId = null;
    this.lastSeen = 0;
    this.fillMaterial.opacity = 0;
    this.glowMaterial.opacity = 0;
    this.lineMaterial.opacity = 0;
    this.group.visible = false;
  }

  dispose() {
    this.gradientTexture.dispose();
    this.fillGeometry.dispose();
    this.glowGeometry.dispose();
    this.lineGeometry.dispose();
    this.fillMaterial.dispose();
    this.glowMaterial.dispose();
    this.lineMaterial.dispose();
  }
}

export class FrozenShape {
  constructor({
    group,
    geometries,
    materials,
    fillMaterial,
    glowMaterial = null,
    lineMaterial,
    ghostLineMaterial = null,
    baseFillOpacity,
    baseGlowOpacity = 0,
    baseLineOpacity,
    baseGhostLineOpacity = 0,
    centroidX,
    centroidY,
    options = config.persist,
  }) {
    this.group = group;
    this.geometries = geometries;
    this.materials = materials;
    this.fillMaterial = fillMaterial;
    this.glowMaterial = glowMaterial;
    this.lineMaterial = lineMaterial;
    this.ghostLineMaterial = ghostLineMaterial;
    this.baseFillOpacity = baseFillOpacity;
    this.baseGlowOpacity = baseGlowOpacity;
    this.baseLineOpacity = baseLineOpacity;
    this.baseGhostLineOpacity = baseGhostLineOpacity;
    this.centroidX = centroidX;
    this.centroidY = centroidY;
    this.options = options;

    this.opacity = 1;
    this.removing = false;
    this.fadeStart = 0;
    this.fadeMs = 1;
    this.applyOpacity(performance.now());
  }

  static fromFramePanel(framePanel, options = config.persist) {
    // Clone the live geometry and materials so the stamp keeps the exact
    // current look while the live shape fades. Textures stay shared and are
    // owned by the live shape.
    const meshGeometry = framePanel.meshGeometry.clone();
    const lineGeometry = framePanel.lineGeometry.clone();
    const lineGeometry2 = framePanel.lineGeometry2.clone();
    const fillMaterial = framePanel.fillMaterial.clone();
    const lineMaterial = framePanel.lineMaterial.clone();
    const lineMaterial2 = framePanel.lineMaterial2.clone();
    fillMaterial.opacity = 0;
    lineMaterial.opacity = 0;
    lineMaterial2.opacity = 0;

    const mesh = new THREE.Mesh(meshGeometry, fillMaterial);
    const line = new THREE.LineLoop(lineGeometry, lineMaterial);
    const line2 = new THREE.LineLoop(lineGeometry2, lineMaterial2);
    mesh.frustumCulled = false;
    line.frustumCulled = false;
    line2.frustumCulled = false;
    line2.visible = framePanel.line2.visible;

    const group = new THREE.Group();
    group.add(mesh, line, line2);

    const liveOpacity = Math.max(framePanel.opacity, 1e-6);
    let centroidX = 0;
    let centroidY = 0;
    for (let i = 0; i < framePanel.smoothedCorners.length; i += 1) {
      centroidX += framePanel.smoothedCorners[i].x;
      centroidY += framePanel.smoothedCorners[i].y;
    }
    const cornerCount = framePanel.smoothedCorners.length || 1;
    centroidX /= cornerCount;
    centroidY /= cornerCount;

    return new FrozenShape({
      group,
      geometries: [meshGeometry, lineGeometry, lineGeometry2],
      materials: [fillMaterial, lineMaterial, lineMaterial2],
      fillMaterial,
      lineMaterial,
      ghostLineMaterial: lineMaterial2,
      baseFillOpacity: framePanel.fillMaterial.opacity / liveOpacity,
      baseLineOpacity: framePanel.lineMaterial.opacity / liveOpacity,
      baseGhostLineOpacity: framePanel.lineMaterial2.opacity / liveOpacity,
      centroidX,
      centroidY,
      options,
    });
  }

  static fromVictoryShard(shard, options = config.persist) {
    const fillGeometry = shard.fillGeometry.clone();
    const glowGeometry = shard.glowGeometry.clone();
    const lineGeometry = shard.lineGeometry.clone();
    const fillMaterial = shard.fillMaterial.clone();
    const glowMaterial = shard.glowMaterial.clone();
    const lineMaterial = shard.lineMaterial.clone();
    fillMaterial.opacity = 0;
    glowMaterial.opacity = 0;
    lineMaterial.opacity = 0;

    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    const glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    const line = new THREE.LineLoop(lineGeometry, lineMaterial);
    fillMesh.frustumCulled = false;
    glowMesh.frustumCulled = false;
    line.frustumCulled = false;

    const group = new THREE.Group();
    group.add(glowMesh, fillMesh, line);

    const liveOpacity = Math.max(shard.opacity, 1e-6);
    let centroidX = 0;
    let centroidY = 0;
    for (let i = 0; i < shard.smoothedPoints.length; i += 1) {
      centroidX += shard.smoothedPoints[i].x;
      centroidY += shard.smoothedPoints[i].y;
    }
    const pointCount = shard.smoothedPoints.length || 1;
    centroidX /= pointCount;
    centroidY /= pointCount;

    return new FrozenShape({
      group,
      geometries: [fillGeometry, glowGeometry, lineGeometry],
      materials: [fillMaterial, glowMaterial, lineMaterial],
      fillMaterial,
      glowMaterial,
      lineMaterial,
      baseFillOpacity: shard.fillMaterial.opacity / liveOpacity,
      baseGlowOpacity: shard.glowMaterial.opacity / liveOpacity,
      baseLineOpacity: shard.lineMaterial.opacity / liveOpacity,
      centroidX,
      centroidY,
      options,
    });
  }

  applyOpacity(now) {
    const pulseAmount = Math.min(1, Math.max(0, this.options.pulse ?? 0));
    const pulse =
      pulseAmount > 0
        ? 1 -
          pulseAmount *
            (0.5 +
              0.5 *
                Math.sin(now * 0.001 * (this.options.pulseSpeed || 1)))
        : 1;
    const stampOpacity = Math.min(
      1,
      Math.max(0, this.options.stampOpacity ?? 0.85),
    );
    const alpha = this.opacity * stampOpacity * pulse;
    this.fillMaterial.opacity = this.baseFillOpacity * alpha;
    if (this.glowMaterial) {
      this.glowMaterial.opacity = this.baseGlowOpacity * alpha;
    }
    this.lineMaterial.opacity = this.baseLineOpacity * alpha;
    if (this.ghostLineMaterial) {
      this.ghostLineMaterial.opacity = this.baseGhostLineOpacity * alpha;
    }
    this.group.visible = alpha > 0.001;
  }

  update(now) {
    if (this.removing) {
      if (now < this.fadeStart) {
        this.opacity = 1;
      } else {
        const progress = (now - this.fadeStart) / Math.max(1, this.fadeMs);
        if (progress >= 1) return false;
        this.opacity = Math.max(0, 1 - progress);
      }
    }
    this.applyOpacity(now);
    return true;
  }

  dismiss(now, fadeMs, delayMs = 0) {
    const start = now + Math.max(0, delayMs);
    if (!this.removing || start < this.fadeStart) {
      this.removing = true;
      this.fadeStart = start;
      this.fadeMs = Math.max(1, fadeMs);
    }
  }

  dispose() {
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
  }
}
