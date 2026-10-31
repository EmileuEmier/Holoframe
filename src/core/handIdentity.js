/**
 * Assigns persistent ids to hands by matching wrists to the previous frame.
 * Matching happens in aspect-corrected normalized space so horizontal and
 * vertical movement have comparable distance. Ids survive brief dropouts for
 * ttlMs, which lets smoothing and gesture state stay with the same hand.
 */
export class HandIdentityMatcher {
  constructor({ maxDistance = 0.25, ttlMs = 500 } = {}) {
    this.maxDistance = maxDistance;
    this.ttlMs = ttlMs;
    this.identities = [];
    this.nextId = 1;

    this.used = [];
    this.assigned = [];
    this.handX = [];
    this.handY = [];
    this.valid = [];
  }

  reset() {
    this.identities.length = 0;
    this.nextId = 1;
  }

  assign(hands, timestamp = performance.now(), aspectRatio = 1) {
    const cutoff = timestamp - this.ttlMs;
    let writeIndex = 0;
    for (let i = 0; i < this.identities.length; i += 1) {
      const identity = this.identities[i];
      if (identity.lastSeen >= cutoff) {
        this.identities[writeIndex] = identity;
        writeIndex += 1;
      }
    }
    this.identities.length = writeIndex;

    const count = hands.length;
    if (count === 0) return hands;

    const used = this.used;
    used.length = this.identities.length;
    for (let i = 0; i < used.length; i += 1) used[i] = false;

    const assigned = this.assigned;
    assigned.length = count;
    for (let i = 0; i < count; i += 1) assigned[i] = null;

    // Respect ids that an upstream tracker already assigned.
    for (let i = 0; i < count; i += 1) {
      const hand = hands[i];
      if (hand.id == null) continue;

      let identity = null;
      for (let j = 0; j < this.identities.length; j += 1) {
        if (this.identities[j].id === hand.id) {
          identity = this.identities[j];
          used[j] = true;
          break;
        }
      }

      if (!identity) {
        identity = { id: hand.id, x: 0, y: 0, lastSeen: timestamp };
        this.identities.push(identity);
        used.push(true);
        if (typeof hand.id === 'number' && hand.id >= this.nextId) {
          this.nextId = hand.id + 1;
        }
      }

      assigned[i] = identity;
    }

    const handX = this.handX;
    const handY = this.handY;
    const valid = this.valid;
    handX.length = count;
    handY.length = count;
    valid.length = count;

    for (let i = 0; i < count; i += 1) {
      const wrist = hands[i].landmarks?.[0];
      if (wrist) {
        handX[i] = wrist.x * aspectRatio;
        handY[i] = wrist.y;
        valid[i] = true;
      } else {
        handX[i] = 0;
        handY[i] = 0;
        valid[i] = false;
      }
    }

    // Greedily take the closest remaining hand/identity pair. With at most two
    // hands this is cheap and avoids depending on MediaPipe's array order.
    while (true) {
      let bestHand = -1;
      let bestIdentity = -1;
      let bestDistance = Infinity;

      for (let i = 0; i < count; i += 1) {
        if (assigned[i] || !valid[i]) continue;
        for (let j = 0; j < this.identities.length; j += 1) {
          if (used[j]) continue;
          const dx = handX[i] - this.identities[j].x;
          const dy = handY[i] - this.identities[j].y;
          const distance = Math.hypot(dx, dy);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestHand = i;
            bestIdentity = j;
          }
        }
      }

      if (bestHand === -1 || bestDistance > this.maxDistance) break;

      assigned[bestHand] = this.identities[bestIdentity];
      used[bestIdentity] = true;
    }

    for (let i = 0; i < count; i += 1) {
      if (!assigned[i]) {
        assigned[i] = {
          id: this.nextId,
          x: handX[i],
          y: handY[i],
          lastSeen: timestamp,
        };
        this.nextId += 1;
        this.identities.push(assigned[i]);
        used.push(true);
      }

      hands[i].id = assigned[i].id;
      assigned[i].x = handX[i];
      assigned[i].y = handY[i];
      assigned[i].lastSeen = timestamp;
    }

    return hands;
  }
}
