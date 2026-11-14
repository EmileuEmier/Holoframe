import config from '../config.js';
import { getCoverTransform } from '../core/screenMapping.js';

// Preferred recording containers/codecs, best first. The first one the browser
// reports as supported wins.
const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

const TARGET_BITRATE_WIDTH = 1280;

function pad2(value) {
  return String(value).padStart(2, '0');
}

// Local-time stamp used in file names: holoframe-YYYYMMDD-HHMMSS.
function timestampSuffix(date = new Date()) {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  );
}

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const type of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function extensionForMime(mimeType) {
  return mimeType && mimeType.includes('mp4') ? 'mp4' : 'webm';
}

function hasCaptureStream() {
  if (
    typeof OffscreenCanvas !== 'undefined' &&
    typeof OffscreenCanvas.prototype.captureStream === 'function'
  ) {
    return true;
  }
  return (
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

// Prefer a real OffscreenCanvas when it can be captured; otherwise fall back to
// a detached <canvas> element (broader captureStream support).
function createCompositorCanvas(width, height) {
  if (
    typeof OffscreenCanvas !== 'undefined' &&
    typeof OffscreenCanvas.prototype.captureStream === 'function'
  ) {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function canvasToBlob(canvas, type) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not create image'));
    }, type);
  });
}

/**
 * Composites the camera, the Three.js overlay and (optionally) the HUD into a
 * single offscreen canvas, then records it with MediaRecorder or snapshots a
 * PNG. The Three.js canvas is transparent where nothing is drawn, so shapes,
 * the thermal layer and the prism come through unchanged.
 *
 * IMPORTANT: captureFrame() must run in the same animation frame right after
 * renderer.render(); the WebGL canvas has no preserveDrawingBuffer, so reading
 * it in a later task returns an empty image.
 */
export class Recorder {
  constructor({ video, sceneCanvas, hudCanvas }) {
    this.video = video;
    this.sceneCanvas = sceneCanvas;
    this.hudCanvas = hudCanvas;

    this.canvas = null;
    this.ctx = null;
    this.outputWidth = 0;
    this.outputHeight = 0;
    this.coverTransform = {};

    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.recordStartTime = 0;
    this.active = false;
    this.cancelled = false;
    this.stopResolve = null;
    this.autoStopTimer = null;
    this.hiddenTimer = null;

    this.photoRequested = false;
    this.photoResolve = null;

    this.mimeType = pickMimeType();
    this.supported = hasCaptureStream() && this.mimeType !== '';

    // Set by the UI: called with the result whenever a recording finalizes for
    // any reason other than a cancel.
    this.onStop = null;

    // Cancel a recording that stays hidden too long (no result card shown).
    this.onVisibilityChange = () => {
      if (!this.active) return;
      if (document.visibilityState === 'hidden') {
        this.hiddenTimer = window.setTimeout(() => {
          if (this.active && document.visibilityState === 'hidden') {
            this.cancel();
          }
        }, config.recording.hiddenCancelMs);
      } else if (this.hiddenTimer) {
        window.clearTimeout(this.hiddenTimer);
        this.hiddenTimer = null;
      }
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  isSupported() {
    return this.supported;
  }

  get isRecording() {
    return this.active;
  }

  get elapsedMs() {
    return this.active ? performance.now() - this.recordStartTime : 0;
  }

  // --- Compositor ------------------------------------------------------------

  // Output size follows the viewport aspect ratio, width capped at maxWidth,
  // and both dimensions are forced even (required by many video encoders).
  computeOutputSize() {
    const viewWidth = window.innerWidth || TARGET_BITRATE_WIDTH;
    const viewHeight = window.innerHeight || 720;
    const aspect = viewWidth / viewHeight;

    let width = Math.min(config.recording.maxWidth, Math.round(viewWidth));
    width = Math.max(2, Math.floor(width / 2) * 2);
    let height = Math.max(2, Math.floor(width / aspect / 2) * 2);
    return { width, height };
  }

  // The canvas is created lazily and its size is locked while recording so the
  // capture stream keeps a constant resolution.
  ensureCanvas() {
    const { width, height } = this.computeOutputSize();

    if (!this.canvas) {
      this.canvas = createCompositorCanvas(width, height);
      this.ctx = this.canvas.getContext('2d', { alpha: false });
      this.outputWidth = width;
      this.outputHeight = height;
      return;
    }

    if (!this.active && (width !== this.outputWidth || height !== this.outputHeight)) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.outputWidth = width;
      this.outputHeight = height;
    }
  }

  // Draw the composited frame. Reuses this.coverTransform and draws with plain
  // numbers so there are no per-frame allocations.
  drawComposite() {
    const ctx = this.ctx;
    const outWidth = this.outputWidth;
    const outHeight = this.outputHeight;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, outWidth, outHeight);

    // (a) Camera video, with the same cover transform as the on-screen view and
    // mirrored for the selfie look. drawImage ignores the CSS mirror, so flip
    // it here when config.camera.mirror is on.
    if (this.video && this.video.videoWidth > 0 && this.video.videoHeight > 0) {
      const transform = getCoverTransform(
        this.video,
        outWidth,
        outHeight,
        config.camera.width,
        config.camera.height,
        this.coverTransform,
      );
      const dx = transform.offsetX;
      const dy = transform.offsetY;
      const dw = transform.videoWidth * transform.scale;
      const dh = transform.videoHeight * transform.scale;

      ctx.save();
      if (config.camera.mirror) {
        ctx.translate(outWidth, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(this.video, dx, dy, dw, dh);
      ctx.restore();
    }

    // (b) Three.js overlay, already drawn in mirrored screen space. Transparent
    // where nothing was rendered, so the video shows through.
    if (this.sceneCanvas) {
      ctx.drawImage(this.sceneCanvas, 0, 0, outWidth, outHeight);
    }

    // (c) HUD canvas, only when explicitly requested.
    if (config.recording.includeHud && this.hudCanvas && !this.hudCanvas.hidden) {
      ctx.drawImage(this.hudCanvas, 0, 0, outWidth, outHeight);
    }
  }

  // Called every frame from the render loop. Does nothing (and costs nothing)
  // when neither recording nor a photo is pending.
  captureFrame() {
    if (!this.active && !this.photoRequested) return;

    // Keep the stream resolution fixed while recording; let photos follow the
    // current viewport size.
    if (!this.active || !this.canvas) this.ensureCanvas();

    this.drawComposite();

    if (this.photoRequested) this.fulfillPhoto();
  }

  // --- Recording -------------------------------------------------------------

  async start() {
    if (this.active) return;
    if (!this.supported) throw new Error('unsupported');

    this.ensureCanvas();
    this.cancelled = false;
    this.chunks = [];

    const stream = this.canvas.captureStream(config.recording.fps);
    this.stream = stream;

    const options = { mimeType: this.mimeType };
    if (config.recording.bitrate) {
      // Scale the target bitrate down for narrower output.
      const scale = this.outputWidth / TARGET_BITRATE_WIDTH;
      options.videoBitsPerSecond = Math.max(
        500000,
        Math.round(config.recording.bitrate * Math.min(1, scale)),
      );
    }

    let recorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      this.stream = null;
      throw error;
    }

    this.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onstop = () => this.finalize();
    recorder.onerror = () => this.cancel();

    this.recordStartTime = performance.now();
    recorder.start(1000);
    this.active = true;

    this.autoStopTimer = window.setTimeout(() => {
      this.autoStopTimer = null;
      if (this.active) this.stop();
    }, config.recording.maxSeconds * 1000);
  }

  // Stops recording and resolves with the finished clip, or null if it was
  // cancelled before any data was produced.
  stop() {
    if (!this.active || !this.recorder) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.stopResolve = resolve;
      try {
        this.recorder.stop();
      } catch {
        this.finalize();
      }
    });
  }

  // Discards the current recording without producing a result.
  cancel() {
    if (!this.active || !this.recorder) return;
    this.cancelled = true;
    try {
      this.recorder.stop();
    } catch {
      this.finalize();
    }
  }

  // Builds the result and resets state. Runs from MediaRecorder.onstop.
  finalize() {
    const cancelled = this.cancelled;
    const resolve = this.stopResolve;
    const durationMs = performance.now() - this.recordStartTime;
    const chunks = this.chunks;
    const mimeType = this.mimeType;
    this.stopResolve = null;

    this.cleanupRecording();

    if (cancelled || chunks.length === 0) {
      if (resolve) resolve(null);
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    const filename = `holoframe-${timestampSuffix()}.${extensionForMime(mimeType)}`;
    const result = { blob, filename, mimeType, durationMs };

    if (resolve) resolve(result);
    this.onStop?.(result);
  }

  cleanupRecording() {
    this.active = false;
    this.cancelled = false;
    this.chunks = [];

    if (this.autoStopTimer) {
      window.clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
    if (this.hiddenTimer) {
      window.clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.recorder = null;
  }

  // --- Photo -----------------------------------------------------------------

  takePhoto() {
    return new Promise((resolve) => {
      this.photoResolve = resolve;
      this.photoRequested = true;
    });
  }

  fulfillPhoto() {
    this.photoRequested = false;
    const resolve = this.photoResolve;
    this.photoResolve = null;
    if (!resolve) return;

    const filename = `holoframe-${timestampSuffix()}.png`;
    canvasToBlob(this.canvas, 'image/png')
      .then((blob) => resolve({ blob, filename }))
      .catch(() => resolve(null));
  }

  // Drops the offscreen canvas so it can be garbage collected between sessions.
  releaseCanvas() {
    this.canvas = null;
    this.ctx = null;
    this.outputWidth = 0;
    this.outputHeight = 0;
  }

  destroy() {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.cleanupRecording();
    this.releaseCanvas();
  }
}
