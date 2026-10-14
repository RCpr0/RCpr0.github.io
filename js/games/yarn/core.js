// Yarn Collect, playable in the browser. Rules ported from the shipped C#: Container.CanAccept / CanEventuallyAccept,
// DispenseCount, SplineSpot.CheckNearbyContainer and Game.IsBoardDeadlocked. The road is the game's open cubic Bezier
// through the waypoints (tangent = waypoint heading x 1.1), closed when the first and last waypoints meet.
// Bot pace: first tap once the baskets have dropped in, then at most one tap every 1.5 s; look-ahead horizon in seconds.
export const BOT_START = 1, BOT_GAP = 1.5, LOOK = 13;
const LAGS = [0, 12]; // look-ahead: tap now, or 0.4 s late
export const CAPACITY = 8, SLOT_SPACING = 1.95, DETECT = 3, LOOK_AHEAD = 0.5, BEHIND = 0.03, PREV_RESET = 2;
export const BASKET = { w: 2.95, h: 5.25, tip: 2.375 }; // mouth = the prefab's EntryPoint, 5.0 in front of the basket centre
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
    this.curveTab = Float32Array.from({ length: 257 }, (_, i) => this.curveFactor(i / 256));
    // Evenly spaced points along the road for the simulation's per-frame lookups (at() itself stays exact).
    this.fast = Float32Array.from({ length: 2 * 2049 }, (_, i) => this.at((i >> 1) / 2048)[i & 1]);
  }
  atFast(u) {
    u = this.closed ? ((u % 1) + 1) % 1 : Math.min(1, Math.max(0, u));
    const f = u * 2048, i = Math.min(2047, Math.floor(f)), t = f - i, a = this.fast;
    return [a[2 * i] + (a[2 * i + 2] - a[2 * i]) * t, a[2 * i + 1] + (a[2 * i + 3] - a[2 * i + 1]) * t];
  }
  curveAt(u) { u = ((u % 1) + 1) % 1; const f = u * 256, i = Math.floor(f); return this.curveTab[i] + (this.curveTab[i + 1] - this.curveTab[i]) * (f - i); }
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
    this.phase = 0; this.moves = 0; this.speedFactor = 1; this.time = 0; this.result = null; this.lastTap = -1; this.events = [];
    this.baskets = level.containers.map(c => {
      const a = c.rot * Math.PI / 180, d = BASKET.h / 2 + BASKET.tip;
      // Local south (0, -d) turned clockwise by Rotation, in world x/y (y = the game's z).
      const entry = [c.x - Math.sin(a) * d, c.y - Math.cos(a) * d];
      // Mechanics (ContainerData.MechanicType): 'lock' opens when a basket of colour `key` completes, 'count' after `key`
      // other baskets complete, 'color' only ever takes colour `key`. Mystery balls (CarData.IsMystery) stay hidden until
      // they come to the top.
      return { x: c.x, y: c.y, rot: c.rot, balls: c.balls.slice(), hidden: c.balls.map((_, i) => !!(c.hidden && c.hidden[i])), entry, entryU: 0, busyUntil: 0,
        complete: false, mech: c.mech || null, key: c.key ?? null, locked: c.mech === 'lock' || c.mech === 'count', remaining: c.mech === 'count' ? c.key : 0,
        need: c.mech === 'color' ? c.key : null };
    });
    for (const b of this.baskets) { b.entryU = this.road.nearest(b.entry).u; b.complete = this.isComplete(b); }
    this.total = this.baskets.reduce((s, b) => s + b.balls.length, 0);
  }
  get over() { return this.result !== null; }
  slotU(i) { return ((this.phase + i / this.slots.length) % 1 + 1) % 1; }
  onRoad() { let n = 0; for (const x of this.slots) if (x) n++; return n; }
  top(b) { return b.balls.length ? b.balls.at(-1) : null; }
  isComplete(b) { return b.balls.length >= CAPACITY && b.balls.every(c => c === b.balls[0]); }
  // Container.GetTopCars: the top run of one colour, stopping at a hidden mystery ball.
  topRun(b) { let n = 0; const t = this.top(b); for (let i = b.balls.length - 1; i >= 0 && b.balls[i] === t && !b.hidden[i]; i--) n++; return n; }
  hiddenTop(b) { return b.balls.length > 0 && b.hidden[b.balls.length - 1]; }
  accepts(b, color) { return b.need === null || b.need === color; }
  // Some unfinished colored basket keeps this colour for itself.
  reserved(color) { return this.baskets.some(x => x.need === color && !x.complete); }

  hasAvailable(color) {
    return this.baskets.some(x => !x.locked && x.balls.length < CAPACITY && this.accepts(x, color) &&
      ((x.balls.length > 0 && this.top(x) === color) || (x.balls.length === 0 && x.need === color)));
  }
  // A ball can't drop straight back into the basket it left; the shipped Car forgets that basket 2 s after leaving.
  isPrev(b, ball) { return b === ball.prev && !(ball.prevUntil <= this.time); }
  canAccept(b, ball) {
    if (b.locked || b.balls.length >= CAPACITY || this.isPrev(b, ball) || !this.accepts(b, ball.color)) return false;
    if (this.reserved(ball.color) && b.need !== ball.color) return false;
    const cleanHome = this.baskets.some(x => !x.locked && x.balls.length < CAPACITY && x.balls.length > 0 && this.accepts(x, ball.color) && x.balls.every(c => c === ball.color));
    if (cleanHome && b.balls.some(c => c !== ball.color)) return false;
    const match = this.top(b) === ball.color, coloredHome = b.need === ball.color && b.balls.length === 0;
    const noAlt = !this.hasAvailable(ball.color) && b.balls.length === 0;
    return match || coloredHome || noAlt;
  }
  canEventuallyAccept(b, ball) {
    if (b.locked || b.balls.length >= CAPACITY || this.isPrev(b, ball) || !this.accepts(b, ball.color)) return false;
    if (this.reserved(ball.color) && b.need !== ball.color) return false;
    return b.balls.length === 0 || this.top(b) === ball.color;
  }
  // Container.RevealTopCars: every ball of the top colour, counting down from the top, shows its colour.
  revealTop(b) {
    const t = this.top(b), shown = [];
    for (let i = b.balls.length - 1; i >= 0 && b.balls[i] === t; i--) if (b.hidden[i]) { b.hidden[i] = false; shown.push(i); }
    if (shown.length) this.events.push({ type: 'reveal', basket: b, slots: shown });
    return shown.length;
  }

  // Tap a basket (ContainerTapBuffer.Submit + Container.RemoveCars): a locked basket ignores it; a hidden top only
  // reveals; otherwise the top run of one colour goes onto free road slots behind the slot passing its mouth.
  tap(i) {
    const b = this.baskets[i];
    if (this.over || !b || b.complete || !b.balls.length || b.locked) return { ok: false, why: 'nothing' };
    if (this.onRoad() >= this.usable) return { ok: false, why: 'road full' };
    if (this.time < b.busyUntil) return { ok: false, why: 'busy' };
    if (this.hiddenTop(b)) { this.revealTop(b); this.lastTap = this.time; this.moves++; return { ok: true, sent: [], reveal: true }; }
    const k = Math.min(this.topRun(b), this.usable - this.onRoad());
    if (k <= 0) return { ok: false, why: 'road full' };
    const n = this.slots.length; let lead = 0, bd = Infinity;
    for (let s = 0; s < n; s++) { const d = Math.abs(((this.slotU(s) - b.entryU + 1.5) % 1) - 0.5); if (d < bd) { bd = d; lead = s; } }
    const sent = [];
    for (let s = lead, steps = 0; sent.length < k && steps < n; s = (s - 1 + n) % n, steps++) {
      if (this.slots[s]) continue;
      b.hidden.pop();
      const ball = { color: b.balls.pop(), prev: b, prevUntil: this.time + PREV_RESET, arrive: this.time + 0.2 + sent.length * 0.15, from: b, id: Math.random() };
      this.slots[s] = ball; ball.slot = s; sent.push(ball);
    }
    b.busyUntil = this.time + 0.2 + sent.length * 0.15;
    this.lastTap = this.time; this.moves++;
    this.events.push({ type: 'send', basket: b, balls: sent });
    this.revealTop(b);
    this.checkEnd();
    return { ok: true, sent };
  }
  // Game.OnContainerCompleted -> Container.NotifyContainerCompleted on every other basket.
  notifyComplete(done) {
    for (const b of this.baskets) {
      if (b === done || !b.locked) continue;
      if (b.mech === 'lock' && this.top(done) === b.key) { b.locked = false; this.events.push({ type: 'unlock', basket: b }); }
      if (b.mech === 'count') {
        b.remaining--;
        if (b.remaining <= 0) { b.locked = false; this.events.push({ type: 'unlock', basket: b }); } else this.events.push({ type: 'count', basket: b, left: b.remaining });
      }
    }
  }

  step(dt) {
    if (this.over) return;
    this.time += dt;
    // Shipped train speed: slots slow on curves (averaged over the train, min 0.6) and the road slows when over 80% full (to 0.85).
    // (the train's average depends only on where the phase sits between two slots: tabled once per game)
    const n0 = this.slots.length;
    if (!this.trainCurve) this.trainCurve = Float32Array.from({ length: 33 }, (_, j) => { let c = 0; for (let s = 0; s < n0; s++) c += this.road.curveAt(j / 32 / n0 + s / n0); return c / n0; });
    const ph = ((this.phase * n0) % 1) * 32, j = Math.floor(ph), curve = this.trainCurve[j] + (this.trainCurve[Math.min(32, j + 1)] - this.trainCurve[j]) * (ph - j);
    const fullK = Math.max(0, (this.onRoad() / this.usable - 0.8) / 0.2), target = curve * (1 - 0.15 * Math.min(1, fullK));
    this.speedFactor += (target - this.speedFactor) * Math.min(1, dt * 1.5);
    this.phase = (this.phase + this.level.speed * this.speedFactor * dt / this.road.length) % 1;
    const n = this.slots.length;
    for (let s = 0; s < n; s++) {
      const ball = this.slots[s]; if (!ball || this.time < ball.arrive) continue;
      const u = this.slotU(s), p = this.road.atFast(u); let target = null, td = Infinity;
      for (const b of this.baskets) {
        const d = Math.hypot(p[0] - b.entry[0], p[1] - b.entry[1]); if (d > DETECT || d >= td) continue;
        const ahead = ((b.entryU - u) % 1 + 1) % 1;
        if (!(ahead <= LOOK_AHEAD || ahead >= 1 - BEHIND)) continue;
        if (this.time < b.busyUntil && this.top(b) !== ball.color) continue;
        if (!this.canAccept(b, ball)) continue;
        td = d; target = b;
      }
      if (!target) continue;
      this.slots[s] = null; target.balls.push(ball.color); target.hidden.push(false); ball.prev = target;
      this.events.push({ type: 'land', basket: target, ball, from: p });
      const done = this.isComplete(target), fresh = done && !target.complete;
      target.complete = done;
      if (fresh) { this.events.push({ type: 'complete', basket: target }); this.notifyComplete(target); }
    }
    this.checkEnd();
  }
  checkEnd() {
    if (this.over) return;
    if (this.onRoad() === 0 && this.baskets.every(b => b.balls.length === 0 || b.complete)) { this.result = 'win'; return; }
    if (this.onRoad() < this.usable) return;
    if (this.baskets.some(b => b.balls.length === 0 && !b.locked && b.need === null)) return;
    for (const ball of this.slots) if (ball && this.baskets.some(b => this.canEventuallyAccept(b, ball))) return;
    this.result = 'lose';
  }

  // A copy for the bot's look-ahead: same road and level, its own baskets, road slots and clock.
  clone() {
    const g = Object.create(YarnGame.prototype); Object.assign(g, this);
    g.baskets = this.baskets.map(b => ({ ...b, balls: b.balls.slice(), hidden: b.hidden.slice() }));
    const map = new Map(this.baskets.map((b, i) => [b, g.baskets[i]]));
    g.slots = this.slots.map(x => x && { ...x, prev: map.get(x.prev) ?? x.prev, from: map.get(x.from) ?? x.from });
    g.events = []; return g;
  }

  // Bot for attract mode and tests: a short look-ahead over every useful tap (and over waiting), each played out by
  // the rule-of-thumb policy below at a human pace, keeping the one that ends best.
  autoTap() {
    if (this.over || this.time < BOT_START || this.time - this.lastTap < BOT_GAP) return;
    const i = this.botChoice(); if (i >= 0) this.tap(i);
  }
  // The basket the bot would tap now, or -1 (also drives the browser tests). The look-ahead runs once as a preview right
  // after a tap (where the ghost hand waits) and once more when the next tap is due; a plan to wait is looked at again
  // every second, and a planned tap is dropped as soon as it stops being legal.
  botChoice() { const p = this.plan(); while (!p.done) this.weigh(p); return p.i; }
  // The same look-ahead a few milliseconds at a time (attract mode spreads it over frames); returns the plan so far.
  think(ms) { const p = this.plan(), t0 = performance.now(); while (!p.done && performance.now() - t0 < ms) this.weigh(p); return p; }
  // The current plan: still good, or a fresh one with its options lined up and the rule of thumb as the stand-in answer.
  plan() {
    const due = this.time >= BOT_START && this.time - this.lastTap >= BOT_GAP, p = this._plan;
    if (p && p.moves === this.moves && p.due === due && (!p.done || (p.i >= 0 ? this.useful(p.i) : this.time - p.at < 1))) return p;
    const opts = [-1];
    this.baskets.forEach((b, i) => { if (this.useful(i)) opts.push(i); });
    const hint = this.ruleChoice();
    return this._plan = { moves: this.moves, due, at: this.time, opts, k: 0, hint, best: hint, score: -Infinity, i: hint, done: false };
  }
  // Play out one option. Each is judged on its worse outcome of acting now or a beat later (a visitor, or a slow frame,
  // lags), with a nudge toward the rule of thumb on ties.
  weigh(p) {
    if (p.opts.length > 1) {
      const i = p.opts[p.k]; let v = Infinity;
      for (const lag of LAGS) {
        const g = this.clone();
        for (let k = 0; k < lag && !g.over; k++) g.step(1 / 30);
        if (i >= 0) g.tap(i); else for (let k = 0; k < 30 && !g.over; k++) g.step(1 / 30);
        v = Math.min(v, g.rollout(LOOK));
      }
      v += i === p.hint ? 1 : 0;
      if (v > p.score) { p.score = v; p.best = i; }
    }
    if (++p.k < p.opts.length) return;
    let best = p.best;
    // Never sit still for good: after 6 s without a tap, take the rule of thumb's park (or any legal tap).
    if (best < 0 && this.time - Math.max(0, this.lastTap) > 6) { best = parkMove(this); if (best < 0) best = p.opts.find(i => i >= 0) ?? -1; }
    if (best >= 0 && !this.useful(best)) best = -1;
    p.i = best; p.done = true;
  }
  // A tap on basket i would do something right now (send yarn or reveal a mystery top).
  useful(i) { const b = this.baskets[i]; return tappable(this, b) && this.onRoad() < this.usable && (this.hiddenTop(b) || this.topRun(b) > 0); }
  rollout(secs) {
    const end = this.time + secs;
    while (!this.over && this.time < end) {
      if (this.time - this.lastTap >= BOT_GAP) { const i = this.ruleChoice(); if (i >= 0) this.tap(i); }
      this.step(1 / 30);
    }
    if (this.result === 'win') return 1e6 - this.time;
    if (this.result === 'lose') return -1e6 + this.time;
    let v = 0;
    for (const b of this.baskets) {
      if (b.complete) { v += 1000; continue; }
      if (!b.locked) v += 150;
      v += 10 * this.topRun(b) * (b.balls.every(c => c === b.balls[0]) ? 2 : 1);
    }
    return v - 25 * this.onRoad();
  }
  // Rule of thumb: first a run that lands somewhere now; then a mystery top; otherwise park a run on the road to uncover
  // a colour the road (or another basket) is waiting for, as long as the road has room for the whole run.
  ruleChoice() {
    const best = choose(this); if (best >= 0) return best;
    const peek = revealMove(this); if (peek >= 0) return peek;
    if (this.onRoad() > 0 && this.time - this.lastTap < 2.5) return -1; // let the road settle first
    return parkMove(this);
  }
}
const tappable = (g, b) => !b.complete && !b.locked && b.balls.length > 0 && g.time >= b.busyUntil;
function choose(g) {
  let best = -1, score = -Infinity;
  g.baskets.forEach((b, i) => {
    if (!tappable(g, b) || g.hiddenTop(b) || lastOpen(g, b)) return;
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
// A mystery top costs a tap but no road: look before parking anything.
function revealMove(g) {
  if (g.onRoad() >= g.usable) return -1;
  return g.baskets.findIndex(b => tappable(g, b) && g.hiddenTop(b));
}
// Never empty out the last unfinished basket: whatever it sends could only ever come back to it, and it can't.
function lastOpen(g, b) { return g.baskets.every(o => o === b || o.complete); }
function parkMove(g) {
  const wanted = new Set(g.slots.filter(Boolean).map(x => x.color));
  // Colours on the road with nowhere to go: an emptied basket would take them (Container.CanAccept's noAlternative).
  const orphans = [...wanted].some(c => !g.hasAvailable(c) && !g.baskets.some(b => b.balls.length === 0 && g.canEventuallyAccept(b, { color: c })));
  let best = -1, score = -Infinity;
  g.baskets.forEach((b, i) => {
    if (!tappable(g, b) || g.hiddenTop(b) || lastOpen(g, b)) return;
    const run = g.topRun(b); if (!run || g.usable - g.onRoad() < run) return;
    // A one-colour basket is a home, not something to clear, unless the road holds yarn with no home at all.
    const home = run === b.balls.length && (b.need === null || b.need === g.top(b));
    if (home && !orphans) return;
    const under = b.balls.length > run ? b.balls[b.balls.length - run - 1] : null;
    const s = home ? -20 - run : (under !== null && wanted.has(under) ? 10 : 0) + (under === null ? 3 : 0) - run;
    if (s > score) { score = s; best = i; }
  });
  return best;
}
