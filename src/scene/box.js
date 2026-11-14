import * as THREE from 'three';
import config from '../config.js';

const FINGER_COUNT = 5;
const VERTEX_COUNT = 12;
const HAND_VERTEX_COUNT = FINGER_COUNT * 2;
const HAND_POSITION_LENGTH = HAND_VERTEX_COUNT * 3;

// Placeholder look; the final materials land in the next task.
const SIDE_COLOR = '#9b6bff';
const SIDE_OPACITY = 0.35;
const CLOSING_COLOR = '#ff9a3d';
const CLOSING_OPACITY = 0.45;
const CAP_COLOR = '#3ad6ff';
const CAP_OPACITY = 0.25;
const EDGE_COLOR = '#ffffff';
const EDGE_OPACITY = 0.9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function buildMeshIndices() {
  const indices = [];

  // Sides 0..3: (Ai, A(i+1), B(i+1), Bi), two triangles each.
  for (let i = 0; i < 4; i += 1) {
    const a = i;
    const aNext = i + 1;
    const b = FINGER_COUNT + i;
    const bNext = FINGER_COUNT + i + 1;
    indices.push(a, aNext, bNext, a, bNext, b);
  }
  const sidesCount = indices.length;

  // Closing side i = 4 (pinky -> thumb): (A4, A0, B0, B4).
  indices.push(4, 0, FINGER_COUNT, 4, FINGER_COUNT, FINGER_COUNT + 4);
  const closingCount = indices.length - sidesCount;

  // Cap A fan from centroid index 10.
  for (let i = 0; i < FINGER_COUNT; i += 1) {
    indices.push(10, i, (i + 1) % FINGER_COUNT);
  }
  const capACount = indices.length - sidesCount - closingCount;

  // Cap B fan from centroid index 11.
  for (let i = 0; i < FINGER_COUNT; i += 1) {
    const start = FINGER_COUNT + i;
    const next = FINGER_COUNT + ((i + 1) % FINGER_COUNT);
    indices.push(11, start, next);
  }

  return {
    indices,
    sidesStart: 0,
    sidesCount,
    closingStart: sidesCount,
    closingCount,
    capAStart: sidesCount + closingCount,
    capACount,
    capBStart: sidesCount + closingCount + capACount,
    capBCount: indices.length - sidesCount - closingCount - capACount,
  };
}

function buildLineIndices() {
  const indices = [];

  // Two pentagon rings.
  for (let i = 0; i < FINGER_COUNT; i += 1) {
    indices.push(i, (i + 1) % FINGER_COUNT);
  }
  for (let i = 0; i < FINGER_COUNT; i += 1) {
    indices.push(
      FINGER_COUNT + i,
      FINGER_COUNT + ((i + 1) % FINGER_COUNT),
    );
  }

  // Five connecting edges.
  for (let i = 0; i < FINGER_COUNT; i += 1) {
    indices.push(i, FINGER_COUNT + i);
  }

  return indices;
}

/**
 * Pentagonal prism whose ten corners are the ten fingertips of two open hands.
 * Positions are written in world units already (CSS pixels on z = 0), so the
 * group has no transform.
 */
export class FingerPrism {
  constructor(options = config.box) {
    this.options = options;

    this.group = new THREE.Group();
    this.group.visible = false;

    // Smoothed world positions: [A0..A4, B0..B4] each xyz.
    this.target = new Float32Array(HAND_POSITION_LENGTH);
    this.current = new Float32Array(HAND_POSITION_LENGTH);

    // 10 fingertips + 2 cap centroids.
    this.positions = new Float32Array(VERTEX_COUNT * 3);
    this.uvs = new Float32Array(VERTEX_COUNT * 2);
    this.linePositions = new Float32Array(HAND_POSITION_LENGTH);

    const meshLayout = buildMeshIndices();
    this.geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(
      this.positions,
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    this.uvAttribute = new THREE.BufferAttribute(this.uvs, 2).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('uv', this.uvAttribute);
    this.geometry.setIndex(meshLayout.indices);
    this.geometry.addGroup(
      meshLayout.sidesStart,
      meshLayout.sidesCount,
      0,
    );
    this.geometry.addGroup(
      meshLayout.closingStart,
      meshLayout.closingCount,
      1,
    );
    this.geometry.addGroup(meshLayout.capAStart, meshLayout.capACount, 2);
    this.geometry.addGroup(meshLayout.capBStart, meshLayout.capBCount, 3);

    this.materials = [
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(SIDE_COLOR),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(CLOSING_COLOR),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(CAP_COLOR),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(CAP_COLOR),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ];

    this.mesh = new THREE.Mesh(this.geometry, this.materials);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;

    this.lineGeometry = new THREE.BufferGeometry();
    this.lineAttribute = new THREE.BufferAttribute(
      this.linePositions,
      3,
    ).setUsage(THREE.DynamicDrawUsage);
    this.lineGeometry.setAttribute('position', this.lineAttribute);
    this.lineGeometry.setIndex(buildLineIndices());
    this.lineMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(EDGE_COLOR),
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    this.edges = new THREE.LineSegments(
      this.lineGeometry,
      this.lineMaterial,
    );
    this.edges.frustumCulled = false;
    this.edges.renderOrder = 2;

    this.group.add(this.mesh, this.edges);

    this.initialized = false;
    this.wasActive = false;

    // Pop-in / hide animation state.
    this.pop = 0;
    this.popFrom = 0;
    this.popTarget = 0;
    this.popStart = 0;
    this.popAnimating = false;
  }

  writeHandTarget(hand, offset, viewWidth, viewHeight, cameraDistance) {
    const points = hand.points;
    const target = this.target;
    const invDistance = 1 / Math.max(cameraDistance, 1e-6);

    for (let i = 0; i < FINGER_COUNT; i += 1) {
      const point = points[i];
      // Inverse perspective: scale the offset from the screen center by
      // (D - z) / D so the vertex still projects onto its exact pixel.
      const projection = (cameraDistance - point.z) * invDistance;
      const index = (offset + i) * 3;
      target[index] = (point.x - viewWidth * 0.5) * projection;
      target[index + 1] = (viewHeight * 0.5 - point.y) * projection;
      target[index + 2] = point.z;
    }
  }

  writeCapUvs(hand, offset) {
    // Positions are shared by side and cap triangles, so each vertex can carry
    // only one UV. The cap bounding-box mapping is used for the placeholder
    // pass; the final materials can split vertices later if they need side UVs.
    const points = hand.points;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < FINGER_COUNT; i += 1) {
      const point = points[i];
      if (point.x < minX) minX = point.x;
      if (point.x > maxX) maxX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.y > maxY) maxY = point.y;
    }

    const spanX = maxX - minX;
    const spanY = maxY - minY;
    const invX = spanX > 1e-6 ? 1 / spanX : 0;
    const invY = spanY > 1e-6 ? 1 / spanY : 0;

    for (let i = 0; i < FINGER_COUNT; i += 1) {
      const point = points[i];
      const uv = (offset + i) * 2;
      this.uvs[uv] = invX > 0 ? (point.x - minX) * invX : 0.5;
      this.uvs[uv + 1] = invY > 0 ? (point.y - minY) * invY : 0.5;
    }
  }

  writeCapCentroidUvs() {
    // Cap A centroid (index 10) and cap B centroid (index 11).
    this.uvs[20] = 0.5;
    this.uvs[21] = 0.5;
    this.uvs[22] = 0.5;
    this.uvs[23] = 0.5;
  }

  writeGeometry() {
    const current = this.current;
    const positions = this.positions;
    const lines = this.linePositions;
    const t = this.pop;

    let centroidAx = 0;
    let centroidAy = 0;
    let centroidAz = 0;
    let centroidBx = 0;
    let centroidBy = 0;
    let centroidBz = 0;

    for (let i = 0; i < FINGER_COUNT; i += 1) {
      const aIndex = i * 3;
      const bIndex = (FINGER_COUNT + i) * 3;

      const ax = current[aIndex];
      const ay = current[aIndex + 1];
      const az = current[aIndex + 2];
      const bx = current[bIndex];
      const by = current[bIndex + 1];
      const bz = current[bIndex + 2];

      // B extrudes out of A during the pop animation.
      const poppedBx = ax + (bx - ax) * t;
      const poppedBy = ay + (by - ay) * t;
      const poppedBz = az + (bz - az) * t;

      positions[aIndex] = ax;
      positions[aIndex + 1] = ay;
      positions[aIndex + 2] = az;
      positions[bIndex] = poppedBx;
      positions[bIndex + 1] = poppedBy;
      positions[bIndex + 2] = poppedBz;

      lines[aIndex] = ax;
      lines[aIndex + 1] = ay;
      lines[aIndex + 2] = az;
      lines[bIndex] = poppedBx;
      lines[bIndex + 1] = poppedBy;
      lines[bIndex + 2] = poppedBz;

      centroidAx += ax;
      centroidAy += ay;
      centroidAz += az;
      centroidBx += poppedBx;
      centroidBy += poppedBy;
      centroidBz += poppedBz;
    }

    const centroidAIndex = HAND_VERTEX_COUNT * 3;
    const centroidBIndex = centroidAIndex + 3;
    const inverseCount = 1 / FINGER_COUNT;
    positions[centroidAIndex] = centroidAx * inverseCount;
    positions[centroidAIndex + 1] = centroidAy * inverseCount;
    positions[centroidAIndex + 2] = centroidAz * inverseCount;
    positions[centroidBIndex] = centroidBx * inverseCount;
    positions[centroidBIndex + 1] = centroidBy * inverseCount;
    positions[centroidBIndex + 2] = centroidBz * inverseCount;

    this.positionAttribute.needsUpdate = true;
    this.lineAttribute.needsUpdate = true;

    this.materials[0].opacity = SIDE_OPACITY * t;
    this.materials[1].opacity = CLOSING_OPACITY * t;
    this.materials[2].opacity = CAP_OPACITY * t;
    this.materials[3].opacity = CAP_OPACITY * t;
    this.lineMaterial.opacity = EDGE_OPACITY * t;
  }

  update(active, hands, viewWidth, viewHeight, cameraDistance, dt, now) {
    const options = this.options;
    const hasPose = Boolean(active && hands?.a?.valid && hands?.b?.valid);
    const delta = Math.min(dt, 0.1);

    if (active && !this.wasActive) {
      this.initialized = false;
    }

    if (hasPose) {
      this.writeHandTarget(
        hands.a,
        0,
        viewWidth,
        viewHeight,
        cameraDistance,
      );
      this.writeHandTarget(
        hands.b,
        FINGER_COUNT,
        viewWidth,
        viewHeight,
        cameraDistance,
      );
      this.writeCapUvs(hands.a, 0);
      this.writeCapUvs(hands.b, FINGER_COUNT);
      this.writeCapCentroidUvs();

      if (!this.initialized) {
        this.current.set(this.target);
        this.initialized = true;
      } else if (options.motionSmoothing > 0) {
        const motion = 1 - Math.exp(-options.motionSmoothing * delta);
        for (let i = 0; i < this.current.length; i += 1) {
          this.current[i] += (this.target[i] - this.current[i]) * motion;
        }
      } else {
        this.current.set(this.target);
      }

      this.uvAttribute.needsUpdate = true;
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
    this.writeGeometry();
  }

  dispose() {
    this.geometry.dispose();
    for (const material of this.materials) {
      material.dispose();
    }
    this.lineGeometry.dispose();
    this.lineMaterial.dispose();
  }
}
