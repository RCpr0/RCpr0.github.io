// Mice Flow, playable in the browser. Rules ported from the shipped C#: BoxGridRules (a house moves only with an
// empty path to the top row), GridSystem (blocks are exposed by a 4-way flood fill from the picture's rim; each colour's
// mice take the first exposed block in spawn order; FindPathToBlock walks the exterior cells to the grid edge), AntBox
// (one mouse per BoxSpawnRate while its colour is exposed; an emptied house frees its tray slot), Ant (door -> rim loop
// -> grid path -> pick up -> back the same way -> away to the side, as the shipped MouseSideExit does) and LevelFlow
// (win when the picture is gone and no mouse is out). Mechanics port the production branch's MechanicFactory (Mystery, Wood,
// Tunnel, Wall) and MouseHouseSpawner's level-tail boost (MouseConfig.Boost = 5 once BoxGridRules.AnyPlayLeft is false).
// The shipped mice leave across the phone screen's left/right edge; the web board floats on the page with no screen edge
// beside it, so each side of the board has a burrow instead and the mouse dives into it (the shipped MousePresentation dive). Mice still pick their side the MouseSideExit way.
//
// Units: the web world is the shipped Unity world scaled by K = 0.1, so every shipped speed and size carries over
// (MouseMotion.asset: Speed 20, SplineSpeed 30, BaseMultiplier 1.3, WaitAtTarget .55, PickupDuration .36,
// BoxSpawnRate .75, BoxJumpDuration .25). The picture is centred on x = 0, its near edge on z = 0, rows going to -z.
export const K = 0.1, MULT = 1.3;
export const TRAY = 5;
export const SPAWN = 0.75 / MULT;           // one mouse every 0.58 s
export const WAIT = 0.55 / MULT;            // at the cheese: 0.42 s
export const PICKUP = 0.36 / MULT, PICKUP_DELAY = 0.06 / MULT;
export const JUMP = 0.25 / MULT;            // house hop to the tray: 0.19 s
export const SPEED = 20 * MULT * K;         // 2.6 web units/s on the grid, curves and doorway
export const RIM_SPEED = 30 * MULT * K;     // 3.9 web units/s along the rim loop (the shipped spline)
export const SLOT_GAP = 23.6 * K, TRAY_Z = 2.6, HOUSE_Z = TRAY_Z + 3.7, HOUSE_DX = 21.8 * K, HOUSE_DZ = 20.5 * K;
export const THROWN = 0.08 + 0.29 + 0.14; // TunnelView release: delay, slide, settle (unscaled DOTween seconds)
export const BOT_GAP = 0.45;                // the bot's pause between taps (a quick but human tap rhythm)
export const DOOR = 7.45 * K;               // the doorway sits this far in front of the house centre (toward the camera)

// Cell size: the mosaic is at most 89% of the 140.6-unit safe width and its projected height at most 81% of it
// (PantryAdaptiveLayout / art direction), in shipped units, then scaled into the web world.
export const cellOf = (w, h) => Math.min(125 / w, 114 / (h * Math.sin(Math.PI / 3))) * K;

// Small seeded random (mice pick their exit side like MouseSideExit, deterministically per level).
const rng = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

export class MiceGame {
  constructor(level) {
    this.level = level; this.w = level.w; this.h = level.h; this.rows = level.rows; this.cols = level.cols;
    this.c = cellOf(this.w, this.h);
    this.grid = Array.from({ length: this.w * this.h }, () => null);
    this.blocks = level.cells.map(([x, y, color], order) => { const b = { x, y, color, order, gone: false, reserved: false, lifted: false }; this.grid[y * this.w + x] = b; return b; });
    // Boxes: [row, col, colour, value, mechanic, mechanicValue, dir, tunnel] (tools/games/export_mice.py). Mechanics port
    // MechanicFactory: 1 Mystery (a "?" cover until the house first becomes movable), 2 Wood (crated until N other houses
    // have reached the tray), 3 Tunnel (a fixture that throws its next house into the cell it faces whenever that cell
    // is empty), 4 Wall (a permanent blocker).
    this.houses = level.boxes.map(b => this.makeHouse(...b));
    this.tray = Array(TRAY).fill(null); this.mice = []; this.time = 0; this.result = null; this.events = []; this.lastTap = -9; this.moves = 0;
    this.boost = 1; // MouseConfig.Boost: 5 (SuperFastScale) once the house grid has no play left, the shipped level tail
    this.rand = rng(level.w * 7919 + level.h * 104729 + level.cells.length);
    // Rim loop: a rounded rectangle just outside the picture (the shipped closed spline around the mosaic).
    const R = 0.8 * this.c + 0.5;
    this.rim = { x0: -this.w * this.c / 2 - R, x1: this.w * this.c / 2 + R, z0: -this.h * this.c - R, z1: R, r: Math.min(R * 1.4, 1.2) };
    // Burrows either side of the picture, level with its middle.
    this.burrowX = this.rim.x1 + 1.6; this.burrowZ = -this.h * this.c / 2;
    this.flood();
    this.boardChanged(true);
    this.events.length = 0; // the opening throws and reveals are the level's starting layout, not news
    this.plan = level.plan ? level.plan.slice() : null; this.planWait = 0;
  }
  makeHouse(row, col, color, value, mech = 0, mv = 0, dir = 0, tunnel = []) {
    return { row, col, color, value, mech, wall: mech === 4, mystery: mech === 1, wood: mech === 2 ? Math.max(0, mv) : 0,
      tunnel: mech === 3 ? { dir, list: tunnel, thrown: 0 } : null, slot: -1, timer: 0, ready: 0, landed: false, done: false, armed: 0 };
  }
  // Fixtures never leave their cell; a crated house can't be tapped. (MechanicFactory: CanPlay false.)
  fixed(h) { return h.wall || !!h.tunnel; }
  playable(h) { return !this.fixed(h) && h.wood <= 0; }
  // BoxGrid.Changed: tunnels refill the cell they face (TunnelMechanic.TryThrow); every house whose movability flipped
  // on reveals its "?" (MysteryMechanic.OnMovableChanged). A throw is itself a change, so loop until it settles.
  boardChanged(init = false) {
    for (let again = true; again;) {
      again = false;
      for (const t of this.houses) {
        const sp = t.tunnel; if (!sp || t.done || sp.thrown >= sp.list.length) continue;
        const r = t.row + (sp.dir === 0 ? -1 : sp.dir === 1 ? 1 : 0), c = t.col + (sp.dir === 2 ? -1 : sp.dir === 3 ? 1 : 0);
        if (r < 0 || c < 0 || r >= this.rows || c >= this.cols || this.occupied(r, c)) continue;
        const [color, value] = sp.list[sp.thrown++], h = this.makeHouse(r, c, color, value);
        // TunnelView: the house is in its cell at once but untappable while it slides out (.08 + .29 s) and settles (.14 s).
        if (!init) h.armed = this.time + THROWN;
        this.houses.push(h); again = true;
        this.events.push({ type: 'throw', tunnel: t, house: h, init });
      }
    }
    for (const h of this.houses) if (h.mystery && h.slot < 0 && !h.done && this.movable(h)) { h.mystery = false; this.events.push({ type: 'reveal', house: h, init }); }
  }
  // BoxGridRules.AnyPlayLeft: does the house grid still owe the player a tap? Walls and spent tunnels don't.
  anyPlayLeft() { return this.houses.some(h => h.slot < 0 && !h.done && !h.wall && (!h.tunnel || h.tunnel.thrown < h.tunnel.list.length)); }
  get over() { return this.result !== null; }
  cell(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? undefined : this.grid[y * this.w + x]; }
  // Empty cells reachable from the rim, 4-way, through empty cells.
  flood() {
    const ext = new Uint8Array(this.w * this.h), q = [];
    for (let x = 0; x < this.w; x++) for (let y = 0; y < this.h; y++) {
      const rim = x === 0 || y === 0 || x === this.w - 1 || y === this.h - 1;
      if (rim && !this.grid[y * this.w + x]) { ext[y * this.w + x] = 1; q.push([x, y]); }
    }
    while (q.length) { const [x, y] = q.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue; const i = ny * this.w + nx; if (ext[i] || this.grid[i]) continue; ext[i] = 1; q.push([nx, ny]); } }
    this.ext = ext;
  }
  neighbours(b) { return [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => { const x = b.x + dx, y = b.y + dy; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null; return { ext: !!this.ext[y * this.w + x] }; }); }
  exposed(b) { return !b.gone && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const x = b.x + dx, y = b.y + dy; return x < 0 || y < 0 || x >= this.w || y >= this.h || this.ext[y * this.w + x]; }); }
  outermost(color) { for (const b of this.blocks) if (b.color === color && !b.reserved && !b.gone && this.exposed(b)) return b; return null; }
  // GridSystem.FindPathToBlock: null when the block touches the grid edge (approach from the rim); otherwise the
  // shortest exterior path [edge cell, ..., cell next to the block].
  pathTo(b) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = b.x + dx, y = b.y + dy; if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null; }
    const from = new Map(), q = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = b.x + dx, y = b.y + dy; if (this.ext[y * this.w + x]) { from.set(y * this.w + x, -1); q.push([x, y]); } }
    for (let i = 0; i < q.length; i++) {
      const [x, y] = q[i];
      if (x === 0 || y === 0 || x === this.w - 1 || y === this.h - 1) { const path = []; let k = y * this.w + x; while (k !== -1) { path.push([k % this.w, Math.floor(k / this.w)]); k = from.get(k); } return path; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue; const k = ny * this.w + nx; if (from.has(k) || !this.ext[k]) continue; from.set(k, y * this.w + x); q.push([nx, ny]); }
    }
    return null;
  }

  // House grid: row 0 opens onto the tray. Distances from empty top-row cells through empty cells.
  occupied(r, c) { return this.houses.some(h => h.row === r && h.col === c && h.slot < 0 && !h.done); }
  movable(h) {
    if (!this.playable(h) || h.slot >= 0 || h.done) return false;
    if (h.row === 0) return true;
    const seen = new Set(), q = [];
    for (let c = 0; c < this.cols; c++) if (!this.occupied(0, c)) { seen.add(c); q.push([0, c]); }
    while (q.length) { const [r, c] = q.shift(); for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = r + dr, nc = c + dc; if (nr < 0 || nc < 0 || nr >= this.rows || nc >= this.cols || seen.has(nr * 64 + nc) || this.occupied(nr, nc)) continue; seen.add(nr * 64 + nc); q.push([nr, nc]); } }
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) => seen.has((h.row + dr) * 64 + (h.col + dc)) && h.row + dr >= 0 && h.col + dc >= 0 && h.col + dc < this.cols && h.row + dr < this.rows);
  }
  parked() { return this.tray.filter(Boolean); }
  tappable(h) { return this.movable(h) && this.time >= h.armed; }
  key(h) { return `${h.row},${h.col},${h.color}`; }
  tap(h) {
    if (this.over || !this.tappable(h)) return { ok: false, why: 'blocked' };
    const s = this.tray.indexOf(null); if (s < 0) return { ok: false, why: 'tray full' };
    if (this.plan) { if (this.plan[0] === this.key(h)) { this.plan.shift(); this.planWait = 0; } else this.plan = null; } // off script: greedy from here
    this.tray[s] = h; h.slot = s; h.timer = 0; h.ready = this.time + JUMP; this.lastTap = this.time; this.moves++; this.lastKey = this.key(h);
    this.events.push({ type: 'park', house: h, slot: s });
    this.boardChanged();
    return { ok: true, slot: s };
  }

  // ---- Layout (web world, x right, z toward the camera) ----
  cellPos(x, y) { return [(x + 0.5 - this.w / 2) * this.c, -(y + 0.5) * this.c]; }
  slotPos(s) { return [(s - (TRAY - 1) / 2) * SLOT_GAP, TRAY_Z]; }
  housePos(r, c) { return [(c - (this.cols - 1) / 2) * HOUSE_DX, HOUSE_Z + r * HOUSE_DZ]; }

  // ---- Rim loop (arc-length parametrised rounded rectangle, counter-clockwise from the near-left corner) ----
  rimLen() { const { x0, x1, z0, z1, r } = this.rim; return 2 * (x1 - x0 - 2 * r) + 2 * (z1 - z0 - 2 * r) + 2 * Math.PI * r; }
  rimAt(s) {
    const { x0, x1, z0, z1, r } = this.rim, a = x1 - x0 - 2 * r, b = z1 - z0 - 2 * r, q = Math.PI * r / 2, L = this.rimLen();
    s = ((s % L) + L) % L;
    const segs = [[a, t => [x0 + r + t, z1]], [q, t => { const g = t / r; return [x1 - r + r * Math.sin(g), z1 - r + r * Math.cos(g)]; }], [b, t => [x1, z1 - r - t]], [q, t => { const g = t / r; return [x1 - r + r * Math.cos(g), z0 + r - r * Math.sin(g)]; }],
      [a, t => [x1 - r - t, z0]], [q, t => { const g = t / r; return [x0 + r - r * Math.sin(g), z0 + r - r * Math.cos(g)]; }], [b, t => [x0, z0 + r + t]], [q, t => { const g = t / r; return [x0 + r - r * Math.cos(g), z1 - r + r * Math.sin(g)]; }]];
    for (const [len, f] of segs) { if (s <= len) return f(s); s -= len; }
    return [x0 + r, z1];
  }
  rimNearest(p) { const L = this.rimLen(); let best = 0, bd = Infinity; for (let s = 0; s < L; s += 0.05) { const q = this.rimAt(s), d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2; if (d < bd) { bd = d; best = s; } } return best; }
  rimWalk(s0, s1) { // points along the shorter way round
    const L = this.rimLen(); let d = ((s1 - s0) % L + L) % L; if (d > L / 2) d -= L;
    const n = Math.max(2, Math.ceil(Math.abs(d) / 0.12)), pts = [];
    for (let i = 0; i <= n; i++) pts.push(this.rimAt(s0 + d * i / n));
    return pts;
  }
  rimDelta(s0, s1) { const L = this.rimLen(); let d = ((s1 - s0) % L + L) % L; return d > L / 2 ? d - L : d; }
  rimSign(s0, s1) { const L = this.rimLen(), d = ((s1 - s0) % L + L) % L; return d > L / 2 ? -1 : 1; } // shorter way round
  rimDir(s, sign) { const a = this.rimAt(s - 0.03 * sign), b = this.rimAt(s + 0.03 * sign); return norm([b[0] - a[0], b[1] - a[1]]); }
  rimTangent(s, toward) { return this.rimDir(s, this.rimSign(s, toward)); }

  // A mouse's whole outing, as timed polylines. Built once when the house sends it, from the grid as it is then.
  route(h, b) {
    const legs = [], push = (pts, speed) => legs.push({ pts, speed });
    // Doorway: out of the door toward the camera, a U-turn to the side facing the stage centre, then up beside the house.
    const [sx, sz] = this.slotPos(h.slot), door = [sx, sz + DOOR], side = sx > 0.01 ? -1 : sx < -0.01 ? 1 : (this.rand() < 0.5 ? -1 : 1);
    const clear = 0.45, r = Math.min(0.5, SLOT_GAP * 0.25), lane = SLOT_GAP * 0.5;
    const straight = [[door[0], door[1] - 0.28], [door[0], door[1] + clear]], arc = [];
    for (let i = 1; i <= 10; i++) { const g = Math.PI * i / 10; arc.push([door[0] + side * r * (1 - Math.cos(g)), door[1] + clear + r * Math.sin(g)]); }
    push(straight.concat(arc), SPEED);
    const arcEnd = arc[arc.length - 1], join = [sx + side * lane, sz];
    const tgt = this.cellPos(b.x, b.y), path = this.pathTo(b), gridPts = path ? path.map(([x, y]) => this.cellPos(x, y)) : null;
    // Leave the rim a little before the point nearest the target (and rejoin it a little after on the way back), so
    // the swing between rim and grid has room to turn: the shipped spline runs further out than this rim does.
    const sEntry = this.rimNearest(join), entry = this.rimAt(sEntry), sNearT = this.rimNearest(gridPts ? gridPts[0] : tgt);
    // Rim exit a little before the nearest point; when the target is right by the entry, skip the rim altogether.
    const direct = Math.abs(this.rimDelta(sEntry, sNearT)) < 1.4;
    const sExit = sNearT - this.rimSign(sEntry, sNearT) * Math.min(0.7, Math.abs(this.rimDelta(sEntry, sNearT)));
    const exitPt = direct ? arcEnd : this.rimAt(sExit), tanOut = direct ? [0, -1] : this.rimDir(sExit, this.rimSign(sEntry, sNearT));
    if (!direct) { push(bezier(arcEnd, [0, -1], entry, this.rimTangent(sEntry, sExit)), SPEED); push(this.rimWalk(sEntry, sExit), RIM_SPEED); }
    let stop;
    if (gridPts) {
      const toEntry = gridPts.length > 1 ? norm(sub(gridPts[1], gridPts[0])) : norm(sub(gridPts[0], exitPt));
      push(bezier(exitPt, tanOut, gridPts[0], toEntry), SPEED);
      if (gridPts.length > 1) push(roundCorners(gridPts, this.c * 0.4), SPEED);
      stop = gridPts[gridPts.length - 1];
    } else {
      const toT = norm(sub(tgt, exitPt)); stop = [tgt[0] - toT[0] * this.c, tgt[1] - toT[1] * this.c];
      push(bezier(exitPt, tanOut, stop, toT), SPEED);
    }
    const out = timed(legs);
    // Return: the grid path backwards, back onto the rim, round toward the chosen side, then out to that burrow.
    const sideX = (stop[0] < 0 ? -1 : 1) * (this.rand() > 0.85 ? -1 : 1);
    const end = [sideX * (this.burrowX - 0.95), this.burrowZ], sNear = this.rimNearest([sideX * this.burrowX, this.burrowZ]);
    const way = this.rimSign(sNearT, sNear), span = Math.abs(this.rimDelta(sNearT, sNear));
    const sRet = sNearT + way * Math.min(0.7, span / 2), sEnd = sNear - way * Math.min(0.9, span / 2);
    const back = [];
    if (gridPts && gridPts.length > 1) back.push({ pts: roundCorners(gridPts.slice().reverse(), this.c * 0.4), speed: SPEED });
    const from = gridPts ? gridPts[0] : stop, fromDir = gridPts && gridPts.length > 1 ? norm(sub(gridPts[0], gridPts[1])) : norm(sub(stop, tgt));
    if (span < 2.2 && Math.sign(from[0]) === sideX) back.push({ pts: bezier(from, fromDir, end, [sideX, 0]), speed: SPEED }); // the burrow is right there
    else {
      back.push({ pts: bezier(from, fromDir, this.rimAt(sRet), this.rimDir(sRet, way)), speed: SPEED });
      back.push({ pts: this.rimWalk(sRet, sEnd), speed: RIM_SPEED });
      back.push({ pts: bezier(this.rimAt(sEnd), this.rimDir(sEnd, way), end, [sideX, 0]), speed: SPEED });
    }
    return { out, back: timed(back), stop, target: tgt, side: sideX, door };
  }

  step(dt) {
    if (this.over) return;
    this.time += dt; if (this.plan && this.tray.indexOf(null) >= 0) this.planWait += dt;
    // ReachedTray: every landing ticks the wood crates down (WoodMechanic); the last play left boosts the tail 5x.
    for (const h of this.parked()) if (!h.landed && this.time >= h.ready) {
      h.landed = true; let opened = false;
      for (const w of this.houses) if (w.wood > 0 && !w.done) { w.wood--; this.events.push({ type: 'wood', house: w, left: w.wood }); if (!w.wood) opened = true; }
      if (opened) this.boardChanged();
      if (!this.anyPlayLeft()) this.boost = 5;
    }
    for (const h of this.parked()) {
      if (h.value <= 0 || this.time < h.ready) continue;
      const b = this.outermost(h.color); if (!b) continue;
      h.timer -= dt; if (h.timer > 0) continue;
      h.timer = SPAWN; h.value--; b.reserved = true;
      const rt = this.route(h, b);
      const m = { house: h, slot: h.slot, block: b, t0: this.time, ...rt, side: rt.side, arrived: false, picked: false, home: false };
      m.tArrive = rt.out.T; m.tPick = rt.out.T + WAIT; m.tEnd = m.tPick + rt.back.T;
      this.mice.push(m); this.events.push({ type: 'spawn', mouse: m });
      if (h.value <= 0) { this.tray[h.slot] = null; h.done = true; this.events.push({ type: 'empty', house: h }); }
    }
    for (const m of this.mice) {
      const t = this.time - m.t0;
      if (!m.arrived && t >= m.tArrive) { m.arrived = true; m.block.lifted = true; this.events.push({ type: 'arrive', mouse: m }); }
      if (!m.picked && t >= m.tPick) { m.picked = true; m.block.gone = true; this.grid[m.block.y * this.w + m.block.x] = null; this.flood(); this.events.push({ type: 'pick', mouse: m }); }
      if (m.picked && t >= m.tEnd) { m.home = true; this.events.push({ type: 'home', mouse: m }); }
    }
    this.mice = this.mice.filter(m => !m.home);
    if (this.blocks.every(b => b.gone) && !this.mice.length) { this.result = 'win'; this.boost = 1; return; }
    if (this.tray.every(Boolean) && !this.mice.length && !this.parked().some(h => h.value > 0 && this.outermost(h.color))) { this.result = 'lose'; this.boost = 1; }
  }
  // Where a mouse is t seconds into its outing: { p:[x,z], dir:[dx,dz], phase: 'out'|'wait'|'back' }.
  mouseAt(m, t) {
    if (t < m.tArrive) return { ...sample(m.out, t), phase: 'out' };
    if (t < m.tPick) return { p: m.stop, dir: norm(sub(m.target, m.stop)), phase: 'wait' };
    return { ...sample(m.back, t - m.tPick), phase: 'back' };
  }

  // Bot for attract mode, nextMove() and tests. Each level ships a recorded tap order (tools/games/mice-plan.mjs searched
  // it offline against these same rules); while the game follows it the bot waits for the next house on the list. Once
  // anyone taps off the list (a visitor took over), or the list stalls, it plays greedily: a movable house whose colour
  // has the most exposed cheese per house of that colour already parked.
  // eager: never "wait" — the best legal tap right now (what a visitor jumping in mid-level is offered), no side effects.
  botChoice(eager = false) {
    if (this.over || this.tray.indexOf(null) < 0) return null;
    if (this.plan && this.plan.length) {
      const h = this.houses.find(h => this.key(h) === this.plan[0] && h.slot < 0 && !h.done);
      if (h && this.tappable(h)) return h;
      if (!eager) { if (h && this.planWait < 3) return null; this.plan = null; }
    }
    const exp = new Map(), par = new Map();
    for (const b of this.blocks) if (!b.gone && !b.reserved && this.exposed(b)) exp.set(b.color, (exp.get(b.color) || 0) + 1);
    for (const h of this.parked()) par.set(h.color, (par.get(h.color) || 0) + 1);
    const cand = this.houses.filter(h => this.tappable(h)); if (!cand.length) return null;
    const score = h => (exp.get(h.color) || 0) / (1 + 4 * (par.get(h.color) || 0)) + h.value / 1000 - h.row * 0.01;
    cand.sort((a, b) => score(b) - score(a));
    const best = cand[0];
    if (!eager && !exp.get(best.color) && this.parked().length >= TRAY - 1) return null; // don't fill the last slot with a dud
    return best;
  }
  // The bot's next tap if it would tap now (cadence BOT_GAP), else null. step() advances planWait.
  botReady() { return this.time - this.lastTap >= BOT_GAP ? this.botChoice() : null; }
  autoTap() { const h = this.botReady(); if (h) this.tap(h); return h; }
}

// The bot playing a level on the page's clock, exactly as game.js steps it at 1x: 60 fixed steps per real second, each
// real second worth MouseConfig.Multiplier's boost (5x for the shipped level tail). Returns real seconds taken.
export function runBot(level, maxReal = 300, onStep) {
  const g = new MiceGame(level); let real = 0, acc = 0; const h = 1 / 60;
  while (!g.over && real < maxReal) {
    real += h; acc += h * g.boost;
    while (acc >= h - 1e-9 && !g.over) { acc -= h; g.autoTap(); g.step(h); if (onStep) onStep(g, real); }
  }
  return { g, real, result: g.result, moves: g.moves };
}

// ---- Path helpers ----
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
function norm(v) { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; }
// Cubic Bezier from p0 leaving along d0 to p3 arriving along d3 (Ant.SetCurve), handles a third of the gap.
function bezier(p0, d0, p3, d3) {
  const k = Math.max(0.3, Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) / 2.6), p1 = [p0[0] + d0[0] * k, p0[1] + d0[1] * k], p2 = [p3[0] - d3[0] * k, p3[1] - d3[1] * k], pts = [];
  const n = Math.max(4, Math.ceil(k * 3 / 0.12));
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; pts.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); }
  return pts;
}
// Grid corners rounded with the shipped GridTurnRadius (0.4 cell).
function roundCorners(pts, rad) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1], d1 = norm(sub(b, a)), d2 = norm(sub(c, b));
    if (Math.abs(d1[0] * d2[1] - d1[1] * d2[0]) < 1e-3) { out.push(b); continue; }
    const p0 = [b[0] - d1[0] * rad, b[1] - d1[1] * rad], p2 = [b[0] + d2[0] * rad, b[1] + d2[1] * rad];
    for (let k = 0; k <= 6; k++) { const t = k / 6, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * b[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * b[1] + t * t * p2[1]]); }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
// Concatenate legs into one polyline with cumulative times. Like Ant.Tick, the speed eases toward each leg's target
// (Speed off the rim, SplineSpeed on it) at the shipped Acceleration (40 x 1.3 units/s^2), starting at Speed.
export const ACCEL = 40 * MULT * K;
function timed(legs) {
  const P = [], T = []; let v = SPEED;
  for (const { pts, speed } of legs) for (const p of pts) {
    if (!P.length) { P.push(p); T.push(0); continue; }
    const q = P[P.length - 1], d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < 1e-6) continue;
    const guess = d / v, v1 = v < speed ? Math.min(speed, v + ACCEL * guess) : Math.max(speed, v - ACCEL * guess);
    P.push(p); T.push(T[T.length - 1] + 2 * d / (v + v1)); v = v1;
  }
  return { P, times: T, T: T[T.length - 1] };
}
function sample(path, t) {
  const { P, times } = path; if (P.length < 2) return { p: P[0], dir: [0, -1] };
  if (t >= path.T) { const n = P.length; return { p: P[n - 1], dir: norm(sub(P[n - 1], P[n - 2])) }; }
  let lo = 0, hi = times.length - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid; else hi = mid; }
  const k = (t - times[lo]) / ((times[hi] - times[lo]) || 1), a = P[lo], b = P[hi];
  return { p: [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], dir: norm(sub(b, a)) };
}
