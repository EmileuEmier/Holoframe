import * as THREE from 'three';
import config from '../config.js';

const MIN_SIZE = 1e-3;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Big 3D slab posed between two open palms. Lives in the perspective scene and
 * uses CSS pixel sized dimensions, so 1 world unit === 1 CSS pixel on z = 0.
 */
export class BoxSlab {
  constructor(options = config.box) {
    this.options = options;

    this.group = new THREE.Group();
    this.group.visible = false;

    // Outer group carries the roll; the inner group carries yaw/pitch in the
    // box's local frame plus the pixel size and pop-in scale.
    this.tiltGroup = new THREE.Group();
    this.group.add(this.tiltGroup);

    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(options.baseColor),
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;

    this.edgeGeometry = new THREE.EdgesGeometry(this.geometry);
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(options.lineColor),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.edges = new THREE.LineSegments(this.edgeGeometry, this.lineMaterial);
    this.edges.frustumCulled = false;
    this.edges.renderOrder = 2;

    this.tiltGroup.add(this.mesh, this.edges);

    // Smoothed pose in screen pixels / radians.
    this.centerX = 0;
    this.centerY = 0;
    this.width = 0;
    this.height = 0;
    this.depth = 0;
    this.roll = 0;
    this.yaw = 0;
    this.pitch = (options.basePitchDeg * Math.PI) / 180;
    this.initialized = false;
    this.wasActive = false;

    // Pop-in / hide animation state.
    this.pop = 0;
    this.popFrom = 0;
    this.popTarget = 0;
    this.popStart = 0;
    this.popAnimating = false;
  }

  update(active, hands, viewWidth, viewHeight, dt, now) {
    const options = this.options;
    const hasPose = Boolean(active && hands?.a?.valid && hands?.b?.valid);
    const delta = Math.min(dt, 0.1);

    if (active && !this.wasActive) {
      // Snap to the current hands on activation instead of flying in from the
      // previous box pose.
      this.initialized = false;
    }

    if (hasPose) {
      const a = hands.a;
      const b = hands.b;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const span = Math.hypot(dx, dy);

      const targetWidth = Math.max(1, span * options.widthScale);
      const targetHeight = clamp(
        targetWidth * options.heightRatio,
        options.minHeightPx,
        options.maxHeightPx,
      );
      const targetDepth = clamp(
        targetWidth * options.depthRatio,
        options.minDepthPx,
        options.maxDepthPx,
      );
      const targetCenterX = (a.x + b.x) * 0.5;
      const targetCenterY = (a.y + b.y) * 0.5;
      // Screen y points down, world y points up, so the A->B screen angle is
      // negated to become a world roll.
      const targetRoll = Math.atan2(-dy, dx);

      let targetYaw = 0;
      if (a.size > MIN_SIZE) {
        targetYaw = clamp(
          (b.size / a.size - 1) * options.yawGain,
          -options.maxYaw,
          options.maxYaw,
        );
      }
      const targetPitch = (options.basePitchDeg * Math.PI) / 180;

      if (!this.initialized) {
        this.centerX = targetCenterX;
        this.centerY = targetCenterY;
        this.width = targetWidth;
        this.height = targetHeight;
        this.depth = targetDepth;
        this.roll = targetRoll;
        this.yaw = targetYaw;
        this.pitch = targetPitch;
        this.initialized = true;
      } else {
        const motion =
          options.motionSmoothing > 0
            ? 1 - Math.exp(-options.motionSmoothing * delta)
            : 1;
        this.centerX += (targetCenterX - this.centerX) * motion;
        this.centerY += (targetCenterY - this.centerY) * motion;
        this.width += (targetWidth - this.width) * motion;
        this.height += (targetHeight - this.height) * motion;
        this.depth += (targetDepth - this.depth) * motion;

        // Shortest-path smoothing across the +-PI wrap.
        const rollDelta = Math.atan2(
          Math.sin(targetRoll - this.roll),
          Math.cos(targetRoll - this.roll),
        );
        this.roll += rollDelta * motion;
        this.roll = Math.atan2(Math.sin(this.roll), Math.cos(this.roll));

        this.yaw += (targetYaw - this.yaw) * motion;
        this.pitch += (targetPitch - this.pitch) * motion;
      }
    }

    this.wasActive = Boolean(active);

    const canShow = Boolean(active && this.initialized);
    const nextPopTarget = canShow ? 1 : 0;
    if (nextPopTarget !== this.popTarget) {
      this.popTarget = nextPopTarget;
      this.popFrom = this.pop;
      this.popStart = now;
      this.popAnimating = true;
    }

    if (this.popAnimating) {
      const duration = Math.max(1, options.popMs);
      const progress = clamp((now - this.popStart) / duration, 0, 1);
      // Ease-out cubic.
      const eased = 1 - (1 - progress) ** 3;
      this.pop = this.popFrom + (this.popTarget - this.popFrom) * eased;
      if (progress >= 1) {
        this.pop = this.popTarget;
        this.popAnimating = false;
      }
    }

    if (this.popTarget === 0 && this.pop <= 0.0001) {
      this.pop = 0;
      this.group.visible = false;
      return;
    }

    this.group.visible = true;

    // Screen pixel (px, py) -> world (px - W/2, H/2 - py, 0).
    this.group.position.set(
      this.centerX - viewWidth * 0.5,
      viewHeight * 0.5 - this.centerY,
      0,
    );
    this.group.rotation.z = this.roll;

    this.tiltGroup.rotation.x = this.pitch;
    this.tiltGroup.rotation.y = this.yaw;
    // The x scale carries the pop-in so the slab grows out of its own center.
    this.tiltGroup.scale.set(
      Math.max(MIN_SIZE, this.width * this.pop),
      Math.max(MIN_SIZE, this.height),
      Math.max(MIN_SIZE, this.depth),
    );

    this.material.opacity = options.baseOpacity * this.pop;
    this.lineMaterial.opacity = options.lineOpacity * this.pop;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.edgeGeometry.dispose();
    this.lineMaterial.dispose();
  }
}
