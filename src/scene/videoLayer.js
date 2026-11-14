import * as THREE from 'three';
import config from '../config.js';
import thermalFragmentShader from '../shaders/thermal.frag.glsl?raw';

const MAX_PALETTE_STOPS = 5;

const THERMAL_VERTEX_SHADER = /* glsl */ `
uniform float uMirror;
varying vec2 vUv;

void main() {
  // The scene camera uses screen pixels with y increasing downward, so flip V
  // to keep the video upright. The visible <video> is CSS-mirrored, so mirror U
  // here as well.
  vUv = vec2(uMirror > 0.5 ? 1.0 - uv.x : uv.x, 1.0 - uv.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

function setVectorFromHex(target, hex) {
  const value = typeof hex === 'string' ? hex.replace('#', '') : '';
  if (value.length !== 6) {
    target.set(0, 0, 0);
    return target;
  }

  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  target.set(
    Number.isFinite(r) ? r / 255 : 0,
    Number.isFinite(g) ? g / 255 : 0,
    Number.isFinite(b) ? b / 255 : 0,
  );
  return target;
}

function fillPalette(palette, vectors) {
  const colors = palette?.colors ?? [];
  const count = Math.min(MAX_PALETTE_STOPS, Math.max(1, colors.length));
  for (let i = 0; i < MAX_PALETTE_STOPS; i += 1) {
    const hex = colors[Math.min(i, count - 1)] ?? '#000000';
    setVectorFromHex(vectors[i], hex);
  }
  return count;
}

export function createThermalMaterial(texture, options = config.thermal) {
  const palettes = options.palettes ?? config.thermal.palettes;
  const palette = palettes?.[0] ?? {
    name: 'custom',
    colors: ['#000000', '#000000', '#000000', '#000000', '#ffffff'],
  };
  const paletteVectors = Array.from(
    { length: MAX_PALETTE_STOPS },
    () => new THREE.Vector3(),
  );
  const paletteSize = fillPalette(palette, paletteVectors);
  const mirror = options.mirror ?? config.camera.mirror;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uMix: { value: options.enabled ? 1 : 0 },
      uTime: { value: 0 },
      uContrast: { value: options.contrast ?? 1.25 },
      uGamma: { value: options.gamma ?? 1.0 },
      uBands: { value: options.bands ?? 0 },
      uShimmer: { value: options.shimmer ?? 0.03 },
      uPalette: { value: paletteVectors },
      uPaletteSize: { value: paletteSize },
      uMirror: { value: mirror ? 1 : 0 },
    },
    vertexShader: THERMAL_VERTEX_SHADER,
    fragmentShader: thermalFragmentShader,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  material.userData.paletteVectors = paletteVectors;
  material.userData.paletteName = palette.name ?? 'custom';
  return material;
}

export class VideoLayer {
  constructor(video, options = config.thermal) {
    this.video = video;
    this.options = options;

    this.texture = new THREE.VideoTexture(video);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.material = createThermalMaterial(this.texture, options);
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.position.z = 0;

    this.paletteVectors = this.material.uniforms.uPalette.value;
    this.paletteIndex = 0;
    this.palette = null;
    this.paletteName = this.material.userData.paletteName;
    this.mix = options.enabled ? 1 : 0;
    this.material.uniforms.uMix.value = this.mix;
    this.mesh.visible = this.mix > 0.001;

    this.lastCoverWidth = -1;
    this.lastCoverHeight = -1;
    this.lastViewportWidth = -1;
    this.lastViewportHeight = -1;

    this.setPalette(options.palettes?.[0] ?? config.thermal.palettes?.[0]);
  }

  setPalette(palette) {
    if (!palette) return this.paletteName;

    const paletteSize = fillPalette(palette, this.paletteVectors);
    this.material.uniforms.uPaletteSize.value = paletteSize;
    this.palette = palette;
    this.paletteName = palette.name ?? 'custom';
    return this.paletteName;
  }

  cyclePalette(palettes = this.options.palettes) {
    if (!palettes || palettes.length === 0) return this.paletteName;

    this.paletteIndex = (this.paletteIndex + 1) % palettes.length;
    return this.setPalette(palettes[this.paletteIndex]);
  }

  updateCover(transform, viewportWidth, viewportHeight) {
    const coverWidth = transform.videoWidth * transform.scale;
    const coverHeight = transform.videoHeight * transform.scale;
    if (
      coverWidth === this.lastCoverWidth &&
      coverHeight === this.lastCoverHeight &&
      viewportWidth === this.lastViewportWidth &&
      viewportHeight === this.lastViewportHeight
    ) {
      return;
    }

    this.lastCoverWidth = coverWidth;
    this.lastCoverHeight = coverHeight;
    this.lastViewportWidth = viewportWidth;
    this.lastViewportHeight = viewportHeight;

    this.mesh.scale.set(coverWidth, coverHeight, 1);
    this.mesh.position.set(viewportWidth * 0.5, viewportHeight * 0.5, 0);
  }

  update(dt, targetMix, now) {
    const target = targetMix ? 1 : 0;
    const delta = Math.min(Math.max(dt, 0), 0.1);
    const speed = this.options.transitionSpeed ?? 6;
    const factor = 1 - Math.exp(-speed * delta);
    this.mix += (target - this.mix) * factor;
    if (Math.abs(target - this.mix) < 0.001) this.mix = target;

    this.material.uniforms.uMix.value = this.mix;
    this.material.uniforms.uTime.value = now * 0.001;
    // Hiding the plane also stops Three.js from binding and uploading the
    // VideoTexture, so an inactive filter costs no per-frame texture upload.
    this.mesh.visible = this.mix > 0.001;
    return this.mix;
  }

  reset() {
    this.mix = 0;
    this.material.uniforms.uMix.value = 0;
    this.mesh.visible = false;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
