import { HandLandmarker } from '@mediapipe/tasks-vision';
import config from '../config.js';
import { getCoverTransform, landmarkToScreen } from '../core/screenMapping.js';

const LANDMARK_COUNT = 21;

export class HudOverlay {
  constructor(canvas, options = config.hud) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options;
    this.enabled = options.enabled;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.fps = 0;
    this.lastFrameTime = performance.now();
    this.coverTransform = {};
    this.screenPoints = Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0 }));

    this.handleResize = this.handleResize.bind(this);
    window.addEventListener('resize', this.handleResize);
    this.handleResize();
    this.setEnabled(this.enabled);
  }

  handleResize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, this.options.maxDevicePixelRatio);
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    // Draw in CSS pixels; the transform scales the backing store for sharp HUD
    // lines on high-DPI displays.
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this.canvas.hidden = !enabled;
    if (!enabled) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  toggle() {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  updateFps(now) {
    const delta = now - this.lastFrameTime;
    this.lastFrameTime = now;
    if (delta <= 0) return;

    const instantFps = 1000 / delta;
    this.fps = this.fps === 0 ? instantFps : this.fps * 0.9 + instantFps * 0.1;
  }

  drawBracket(ctx, x, y) {
    const size = this.options.bracketSize;
    const arm = this.options.bracketArm;
    const left = x - size;
    const right = x + size;
    const top = y - size;
    const bottom = y + size;

    ctx.beginPath();
    ctx.moveTo(left, top + arm);
    ctx.lineTo(left, top);
    ctx.lineTo(left + arm, top);

    ctx.moveTo(right - arm, top);
    ctx.lineTo(right, top);
    ctx.lineTo(right, top + arm);

    ctx.moveTo(right, bottom - arm);
    ctx.lineTo(right, bottom);
    ctx.lineTo(right - arm, bottom);

    ctx.moveTo(left + arm, bottom);
    ctx.lineTo(left, bottom);
    ctx.lineTo(left, bottom - arm);
    ctx.stroke();
  }

  drawLabel(ctx, point) {
    const label = `x:${Math.round(point.x)} y:${Math.round(point.y)}`;
    const labelWidth = ctx.measureText(label).width;
    const offset = this.options.labelOffset;

    const x = Math.min(
      Math.max(point.x + offset.x, 4),
      Math.max(4, this.width - labelWidth - 4),
    );
    const y = Math.min(Math.max(point.y + offset.y, 14), this.height - 4);

    ctx.fillText(label, x, y);
  }

  drawHand(ctx, hand, transform) {
    const points = this.screenPoints;
    for (let i = 0; i < hand.landmarks.length && i < points.length; i += 1) {
      landmarkToScreen(hand.landmarks[i], transform, points[i]);
    }

    ctx.save();
    ctx.strokeStyle = this.options.color;
    ctx.lineWidth = this.options.lineWidth;

    ctx.setLineDash(this.options.dash);
    ctx.beginPath();
    for (const connection of HandLandmarker.HAND_CONNECTIONS) {
      const start = points[connection.start];
      const end = points[connection.end];
      if (!start || !end) continue;

      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = this.options.color;
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, this.options.dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = this.options.bracketColor;
    for (const index of this.options.boxLandmarks) {
      const point = points[index];
      if (point) this.drawBracket(ctx, point.x, point.y);
    }

    ctx.fillStyle = this.options.labelColor;
    ctx.font = this.options.font;
    ctx.textBaseline = 'bottom';
    ctx.textAlign = 'left';
    for (const index of this.options.labelLandmarks) {
      const point = points[index];
      if (point) this.drawLabel(ctx, point);
    }

    ctx.restore();
  }

  drawFps(ctx) {
    if (!this.options.fps.enabled) return;

    const padding = this.options.fps.padding;
    const top = padding;
    const text = `FPS ${Math.round(this.fps)}`;

    ctx.save();
    ctx.fillStyle = this.options.labelColor;
    ctx.font = this.options.font;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    if (this.options.fps.corner === 'top-right') {
      ctx.textAlign = 'right';
      ctx.fillText(text, this.width - padding, top);
    } else {
      ctx.fillText(text, padding, top);
    }

    ctx.restore();
  }

  getGestureState(hand) {
    if (hand.lShape) return 'L';
    if (hand.victory) return 'victory';
    if (hand.fist) return 'fist';
    if (hand.openPalm) return 'open';
    return 'idle';
  }

  drawDebug(ctx, debugState) {
    const debug = this.options.debug;
    if (!debug.enabled || !debugState) return;

    const padding = this.options.fps.padding;
    const lineHeight = debug.lineHeight;
    const minCutoff = Number(debugState.minCutoff ?? config.smoothing.minCutoff);
    const beta = Number(debugState.beta ?? config.smoothing.beta);
    const detectionRate = Number(debugState.detectionRate ?? 0);
    let y = padding + debug.offsetY;

    ctx.save();
    ctx.fillStyle = debug.color;
    ctx.font = this.options.font;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    ctx.fillText(
      `det ${detectionRate.toFixed(1)}/s  minCutoff ${minCutoff.toFixed(2)}  beta ${beta.toFixed(3)}`,
      padding,
      y,
    );
    y += lineHeight;
    ctx.fillText(debug.tuningHint, padding, y);
    y += lineHeight;

    const gestureState = debugState.gestureState;
    const gestureHands = gestureState?.hands ?? [];

    if (gestureHands.length === 0) {
      ctx.fillText('no hands', padding, y);
      y += lineHeight;
    } else {
      for (const hand of gestureHands) {
        const state = this.getGestureState(hand);
        const score = Number(hand.lShapeScore ?? 0);
        const angle = Number(hand.angleDegrees ?? 0);
        const facingValue = Number(hand.facingValue ?? 0);
        const fingers = hand.fingerScores ?? [];

        ctx.fillText(
          `${hand.handedness} ${state}  L ${score.toFixed(2)}  ang ${angle.toFixed(0)}deg  fv ${facingValue.toFixed(2)}`,
          padding,
          y,
        );
        y += lineHeight;

        const extensionText = fingers
          .map((value) => Number(value).toFixed(2))
          .join(' ');
        ctx.fillText(`  ext T I M R P ${extensionText}`, padding, y);
        y += lineHeight;
      }
    }

    const frame = gestureState?.twoHands;
    const frameScore = Number(frame?.score ?? 0);
    const frameIdA = frame?.idA ?? '-';
    const frameIdB = frame?.idB ?? '-';
    const facingA = Number(frame?.facing?.[0] ?? 0);
    const facingB = Number(frame?.facing?.[1] ?? 0);
    const folded = Boolean(frame?.folded);
    const twist = Number(frame?.twist ?? 0);
    const frameText = frame?.active
      ? `${frame.orientation ?? 'frame'} ${frameScore.toFixed(2)}`
      : `idle ${frameScore.toFixed(2)}`;

    ctx.fillText(
      `frame: A:${frameIdA} B:${frameIdB} facing ${facingA}/${facingB} fold ${folded ? 'yes' : 'no'} twist ${twist.toFixed(2)}`,
      padding,
      y,
    );
    y += lineHeight;
    ctx.fillText(`  ${frameText}`, padding, y);

    ctx.restore();
  }

  render(hands, video, debugState = null) {
    if (!this.enabled) return;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    // Shared with SceneManager so HUD points and Three.js objects align.
    const transform = getCoverTransform(
      video,
      this.width,
      this.height,
      config.camera.width,
      config.camera.height,
      this.coverTransform,
    );

    for (const hand of hands) {
      this.drawHand(ctx, hand, transform);
    }

    this.updateFps(performance.now());
    this.drawFps(ctx);
    this.drawDebug(ctx, debugState);
  }

  destroy() {
    window.removeEventListener('resize', this.handleResize);
  }
}
