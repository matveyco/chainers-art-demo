// Minimal kinematic collision for a voxel range: axis-aligned boxes + ground plane.
const pc = window.pc;

export function overlapBox(aMin, aMax, bMin, bMax) {
  return aMin.x < bMax.x && aMax.x > bMin.x && aMin.y < bMax.y && aMax.y > bMin.y && aMin.z < bMax.z && aMax.z > bMin.z;
}

// Ray vs AABB (slab). Returns distance or -1.
export function rayBox(o, d, min, max, maxDist = 1e9) {
  let tmin = 0, tmax = maxDist;
  for (const a of ['x', 'y', 'z']) {
    const inv = 1 / (d[a] || 1e-12);
    let t0 = (min[a] - o[a]) * inv, t1 = (max[a] - o[a]) * inv;
    if (t0 > t1) { const t = t0; t0 = t1; t1 = t; }
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
    if (tmax < tmin) return -1;
  }
  return tmin;
}

// normal of the box face hit at point p
export function boxNormal(p, min, max) {
  const eps = 1e-3;
  if (Math.abs(p.x - min.x) < eps) return new pc.Vec3(-1, 0, 0);
  if (Math.abs(p.x - max.x) < eps) return new pc.Vec3(1, 0, 0);
  if (Math.abs(p.y - min.y) < eps) return new pc.Vec3(0, -1, 0);
  if (Math.abs(p.y - max.y) < eps) return new pc.Vec3(0, 1, 0);
  if (Math.abs(p.z - min.z) < eps) return new pc.Vec3(0, 0, -1);
  return new pc.Vec3(0, 0, 1);
}

export class Mover {
  constructor(colliders, radius = 0.3, height = 1.9) {
    this.colliders = colliders;   // array of {min,max,kind,active?}
    this.r = radius;
    this.h = height;
    this.stepUp = 0.42;
    this._min = new pc.Vec3();
    this._max = new pc.Vec3();
  }

  _bounds(p) {
    this._min.set(p.x - this.r, p.y + 0.001, p.z - this.r);
    this._max.set(p.x + this.r, p.y + this.h, p.z + this.r);
  }

  _hits(p) {
    this._bounds(p);
    const out = [];
    for (const c of this.colliders) {
      if (c.active === false) continue;
      if (overlapBox(this._min, this._max, c.min, c.max)) out.push(c);
    }
    return out;
  }

  // ground height under position (floor = 0, or top of a box we stand over)
  groundAt(p, reach = 0.05) {
    let g = 0;
    for (const c of this.colliders) {
      if (c.active === false) continue;
      if (p.x + this.r * 0.8 > c.min.x && p.x - this.r * 0.8 < c.max.x && p.z + this.r * 0.8 > c.min.z && p.z - this.r * 0.8 < c.max.z) {
        if (c.max.y <= p.y + reach && c.max.y > g) g = c.max.y;
      }
    }
    return g;
  }

  // move position p (Vec3, feet) by delta; resolves horizontal collisions with step-up.
  move(p, dx, dz) {
    for (const [axis, d] of [['x', dx], ['z', dz]]) {
      if (!d) continue;
      p[axis] += d;
      const hits = this._hits(p);
      if (!hits.length) continue;
      // try step up
      let top = 0;
      for (const c of hits) top = Math.max(top, c.max.y);
      if (top - p.y <= this.stepUp) {
        const oy = p.y;
        p.y = top + 0.001;
        if (!this._hits(p).length) continue;
        p.y = oy;
      }
      for (const c of hits) {
        if (d > 0) p[axis] = Math.min(p[axis], c.min[axis] - this.r - 1e-4);
        else p[axis] = Math.max(p[axis], c.max[axis] + this.r + 1e-4);
      }
    }
  }

  // vertical: returns {grounded, ceiling}
  moveY(p, dy) {
    p.y += dy;
    if (dy > 0) {
      const hits = this._hits(p);
      if (hits.length) {
        let low = 1e9;
        for (const c of hits) low = Math.min(low, c.min.y);
        p.y = low - this.h - 1e-3;
        return { grounded: false, ceiling: true };
      }
      return { grounded: false, ceiling: false };
    }
    const g = this.groundAt(p, 0.6 - dy);
    if (p.y <= g) { p.y = g; return { grounded: true, ceiling: false }; }
    return { grounded: false, ceiling: false };
  }
}
