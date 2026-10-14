// Yarn Collect, playable in the browser. Rules ported from the shipped C#: Container.CanAccept / CanEventuallyAccept,
// DispenseCount, SplineSpot.CheckNearbyContainer and Game.IsBoardDeadlocked. The road is the game's open cubic Bezier
// through the waypoints (tangent = waypoint heading x 1.1), closed when the first and last waypoints meet.
export const CAPACITY = 8, SLOT_SPACING = 1.95, DETECT = 3, LOOK_AHEAD = 0.5, BEHIND = 0.03;
export const BASKET = { w: 2.95, h: 5.25, tip: 1.5 };
const TAN = 1.1;

export class Road {
  constructor(wps) {
    const pts = wps.map(w => [w[0], w[1]]);
    this.closed = pts.length > 2 && Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]) < 0.5;
    const tan = tangents(pts, this.closed), poly = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p3 = pts[i + 1], p1 = [p0[0] + TAN * tan[i][0], p0[1] + TAN * tan[i][1]], p2 = [p3[0] - TAN * tan[i + 1][0], p3[1] - TAN * tan[i + 1][1]];
      for (let k = 0; k < 40; k++) { const t = k / 40, u = 1 - t; poly.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); }
    }
    poly.push(pts.at(-1).slice());
    this.poly = poly; this.cum = [0];
    for (let i = 1; i < poly.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]));
    this.length = this.cum.at(-1);
  }
  // Point at normalised distance u (wraps on a closed road).
  at(u) {
    u = this.closed ? ((u % 1) + 1) % 1 : Math.min(1, Math.max(0, u));
    const d = u * this.length; let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= d) lo = m; else hi = m; }
    const f = (d - this.cum[lo]) / (this.cum[hi] - this.cum[lo] || 1), a = this.poly[lo], b = this.poly[hi];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }
  dir(u) { const a = this.at(u - 0.002), b = this.at(u + 0.002), m = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / m, (b[1] - a[1]) / m]; }
  nearest(p) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < this.poly.length; i++) { const d = Math.hypot(this.poly[i][0] - p[0], this.poly[i][1] - p[1]); if (d < bd) { bd = d; best = i; } }
    return { u: this.cum[best] / this.length, d: bd };
  }
  distanceTo(p) { return this.nearest(p).d; }
  // 1 on straights, down to 0.6 in tight bends (turn of the heading across ~1.5 units of road).
  curveFactor(u) {
    const k = 0.75 / this.length, a = this.dir(u - k), b = this.dir(u + k), turn = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])));
    return 1 - 0.4 * Math.min(1, turn / 0.6);
  }
}
function tangents(pts, closed) {
  const n = pts.length, dir = (a, b) => { const x = b[0] - a[0], y = b[1] - a[1], m = Math.hypot(x, y) || 1; return [x / m, y / m]; };
  const nrm = v => { const m = Math.hypot(v[0], v[1]) || 1; return [v[0] / m, v[1] / m]; };
  if (closed) {
    const core = pts.slice(0, -1), m = core.length;
    const t = core.map((_, i) => { const a = dir(core[(i - 1 + m) % m], core[i]), b = dir(core[i], core[(i + 1) % m]); return nrm([a[0] + b[0], a[1] + b[1]]); });
    return [...t, t[0]];
  }
  return pts.map((_, i) => i === 0 ? dir(pts[0], pts[1]) : i === n - 1 ? dir(pts[n - 2], pts[n - 1]) : (() => { const a = dir(pts[i - 1], pts[i]), b = dir(pts[i], pts[i + 1]); return nrm([a[0] + b[0], a[1] + b[1]]); })());
}

export class YarnGame {
  constructor(level) {
    this.level = level; this.road = new Road(level.waypoints);
    const n = Math.max(1, Math.round(this.road.length / SLOT_SPACING));
    this.slots = Array.from({ length: n }, () => null);
    this.usable = Math.min(level.spots, n);
    this.phase = 0; this.speedFactor = 1; this.time = 0; this.result = null; this.lastTap = -1; this.events = [];
    this.baskets = level.containers.map(c => {
      const a = c.rot * Math.PI / 180, d = BASKET.h / 2 + BASKET.tip;
      // Local south (0, -d) turned clockwise by Rotation, in world x/y (y = the game's z).
      const entry = [c.x - Math.sin(a) * d, c.y - Math.cos(a) * d];
      return { x: c.x, y: c.y, rot: c.rot, balls: c.balls.slice(), entry, entryU: 0, busyUntil: 0, complete: false };
    });
    for (const b of this.baskets) { b.entryU = this.road.nearest(b.entry).u; b.complete = this.isComplete(b); }
    this.total = this.baskets.reduce((s, b) => s + b.balls.length, 0);
  }
  get over() { return this.result !== null; }
  slotU(i) { return ((this.phase + i / this.slots.length) % 1 + 1) % 1; }
  onRoad() { return this.slots.filter(Boolean).length; }
  top(b) { return b.balls.length ? b.balls.at(-1) : null; }
  isComplete(b) { return b.balls.length >= CAPACITY && b.balls.every(c => c === b.balls[0]); }
  topRun(b) { let n = 0; const t = this.top(b); for (let i = b.balls.length - 1; i >= 0 && b.balls[i] === t; i--) n++; return n; }

  hasAvailable(color) { return this.baskets.some(x => x.balls.length < CAPACITY && x.balls.length > 0 && this.top(x) === color); }
  canAccept(b, ball) {
    if (b.balls.length >= CAPACITY || b === ball.prev) return false;
    const cleanHome = this.baskets.some(x => x.balls.length < CAPACITY && x.balls.length > 0 && x.balls.every(c => c === ball.color));
    if (cleanHome && b.balls.some(c => c !== ball.color)) return false;
    const match = this.top(b) === ball.color, noAlt = !this.hasAvailable(ball.color) && b.balls.length === 0;
    return match || noAlt;
  }
  canEventuallyAccept(b, ball) { return b.balls.length < CAPACITY && b !== ball.prev && (b.balls.length === 0 || this.top(b) === ball.color); }

  // Tap a basket: its top run of one colour goes onto free road slots behind the slot passing its mouth.
  tap(i) {
    const b = this.baskets[i];
    if (this.over || !b || b.complete || !b.balls.length) return { ok: false, why: 'nothing' };
    if (this.time < b.busyUntil) return { ok: false, why: 'busy' };
    const k = Math.min(this.topRun(b), this.usable - this.onRoad());
    if (k <= 0) return { ok: false, why: 'road full' };
    const n = this.slots.length; let lead = 0, bd = Infinity;
    for (let s = 0; s < n; s++) { const d = Math.abs(((this.slotU(s) - b.entryU + 1.5) % 1) - 0.5); if (d < bd) { bd = d; lead = s; } }
    const sent = [];
    for (let s = lead, steps = 0; sent.length < k && steps < n; s = (s - 1 + n) % n, steps++) {
      if (this.slots[s]) continue;
      const ball = { color: b.balls.pop(), prev: b, arrive: this.time + 0.2 + sent.length * 0.15, from: b, id: Math.random() };
      this.slots[s] = ball; ball.slot = s; sent.push(ball);
    }
    b.busyUntil = this.time + 0.2 + sent.length * 0.15;
    this.lastTap = this.time;
    this.events.push({ type: 'send', basket: b, balls: sent });
    this.checkEnd();
    return { ok: true, sent };
  }

  step(dt) {
    if (this.over) return;
    this.time += dt;
    // Shipped train speed: slots slow on curves (averaged over the train, min 0.6) and the road slows when over 80% full (to 0.85).
    let curve = 0; const n0 = this.slots.length;
    for (let s = 0; s < n0; s++) curve += this.road.curveFactor(this.slotU(s));
    const fullK = Math.max(0, (this.onRoad() / this.usable - 0.8) / 0.2), target = (curve / n0) * (1 - 0.15 * Math.min(1, fullK));
    this.speedFactor += (target - this.speedFactor) * Math.min(1, dt * 1.5);
    this.phase = (this.phase + this.level.speed * this.speedFactor * dt / this.road.length) % 1;
    const n = this.slots.length;
    for (let s = 0; s < n; s++) {
      const ball = this.slots[s]; if (!ball || this.time < ball.arrive) continue;
      const u = this.slotU(s), p = this.road.at(u); let target = null, td = Infinity;
      for (const b of this.baskets) {
        if (this.time < b.busyUntil && this.top(b) !== ball.color) continue;
        if (!this.canAccept(b, ball)) continue;
        const d = Math.hypot(p[0] - b.entry[0], p[1] - b.entry[1]); if (d > DETECT) continue;
        const ahead = ((b.entryU - u) % 1 + 1) % 1;
        if (!(ahead <= LOOK_AHEAD || ahead >= 1 - BEHIND)) continue;
        if (d < td) { td = d; target = b; }
      }
      if (!target) continue;
      this.slots[s] = null; target.balls.push(ball.color); ball.prev = target;
      const done = this.isComplete(target); if (done && !target.complete) this.events.push({ type: 'complete', basket: target });
      target.complete = done;
      this.events.push({ type: 'land', basket: target, ball, from: p });
    }
    this.checkEnd();
  }
  checkEnd() {
    if (this.over) return;
    if (this.onRoad() === 0 && this.baskets.every(b => b.balls.length === 0 || b.complete)) { this.result = 'win'; return; }
    // Stuck: nothing on the road can ever land, and no basket has anything left to send.
    const tappable = this.baskets.some(b => !b.complete && b.balls.length);
    if (!tappable && this.slots.some(Boolean) && !this.slots.some(ball => ball && this.baskets.some(b => this.canEventuallyAccept(b, ball)))) { this.result = 'lose'; return; }
    if (this.onRoad() < this.usable) return;
    if (this.baskets.some(b => b.balls.length === 0)) return;
    for (const ball of this.slots) if (ball && this.baskets.some(b => this.canEventuallyAccept(b, ball))) return;
    this.result = 'lose';
  }

  // Bot for attract mode and tests. First choice: a run that lands somewhere now. Otherwise it parks a run on the road
  // to uncover a colour the road (or another basket) is waiting for, as long as the road has room for the whole run.
  autoTap() {
    if (this.over || this.time - this.lastTap < 0.45) return;
    const i = this.botChoice(); if (i >= 0) this.tap(i);
  }
  // The basket the bot would tap now, or -1 (also drives the browser tests).
  botChoice() {
    const best = choose(this); if (best >= 0) return best;
    if (this.onRoad() > 0 && this.time - this.lastTap < 2.5) return -1; // let the road settle first
    return parkMove(this);
  }
}
function choose(g) {
  let best = -1, score = -Infinity;
  g.baskets.forEach((b, i) => {
    if (b.complete || !b.balls.length || g.time < b.busyUntil) return;
    const c = g.top(b), run = g.topRun(b), probe = { color: c, prev: b };
    if (g.usable - g.onRoad() < run) return;
    for (const d of g.baskets) {
      if (d === b || !g.canAccept(d, probe)) continue;
      const room = CAPACITY - d.balls.length;
      if (run > room) continue;
      const s = (d.balls.length ? 10 : 2) + run + (b.balls.length > run ? 1 : 0) + (d.balls.length + run === CAPACITY ? 5 : 0);
      if (s > score) { score = s; best = i; }
    }
  });
  return best;
}
function parkMove(g) {
  const wanted = new Set(g.slots.filter(Boolean).map(x => x.color));
  let best = -1, score = -Infinity;
  g.baskets.forEach((b, i) => {
    if (b.complete || !b.balls.length || g.time < b.busyUntil) return;
    const run = g.topRun(b); if (g.usable - g.onRoad() < run) return;
    if (run === b.balls.length) return; // a one-colour basket is a home, not something to clear
    const under = b.balls.length > run ? b.balls[b.balls.length - run - 1] : null;
    const s = (under !== null && wanted.has(under) ? 10 : 0) + (under === null ? 3 : 0) - run;
    if (s > score) { score = s; best = i; }
  });
  return best;
}
