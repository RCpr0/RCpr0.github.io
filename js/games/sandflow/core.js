// Sand Flow, playable in the browser. Sand physics, grid and capacity rules are the dashboard's verified ports of the
// shipped C# (./sim). The belt here adds what the shipped belt does on top of that sim: x4 speed while a cart is off
// the picture, x1.7 when the last carts are out, and carts that queue instead of overlapping.
import { SAND_CFG } from './sim/config.js';
import { SandSim, roundHalfToEven } from './sim/sandSim.js';
import { SimGridBasic } from './sim/grid.js';
import { makeBucket } from './sim/belt.js';
import { chooseEager } from './policy.js';

export const DT = 1 / 60;
export const GAME_CFG = { maxSpots: 5, spotSpeed: 0.12, levelFailTimeout: 6, boost: 4, fastFactor: 1.7, minGap: 0.1, entryT: 0.94, beltWidth: 256 };
const CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

export class SandFlowGame {
  constructor(level, cfg = GAME_CFG) {
    this.cfg = cfg; this.level = level;
    this.colorTypesGrid = [...level.grid].map(c => CHARS.indexOf(c));
    this.sand = new SandSim(SAND_CFG);
    this.sand.init(this.colorTypesGrid, level.textureWidth, level.textureHeight, level.suctionWidth, level.suctionHeight);
    this.sand.setSeed(1234);
    this.grid = new SimGridBasic(); this.grid.init(level);
    this.belt = new Belt(cfg, this.sand);
    this.ticks = 0; this.started = false; this.result = null; this.events = [];
  }
  get over() { return this.result !== null; }
  get progress() { return this.sand.sandRemovedPercentage / 100; } // sim reports a whole-number percent

  // Every cart cell on the grid, with what the renderer needs.
  carts() {
    const out = [], g = this.grid;
    for (let x = 0; x < g.width; x++) for (let y = 0; y < g.height; y++) {
      const c = g.getCell({ x, y });
      if (c.isBucket) out.push({ x, y, ct: c.colorType, mystery: c.isMystery && !c.isMysterySolved, available: c.isPickable(g.globalPickCount) && (!c.isSticky || c.isAvailable) });
    }
    return out;
  }
  walls() {
    const out = [], g = this.grid;
    for (let x = 0; x < g.width; x++) for (let y = 0; y < g.height; y++) if (g.getCell({ x, y }).isWall) out.push({ x, y });
    return out;
  }

  // Tap a cart: if it has a clear path and the belt has room, it leaves the grid. Returns the path (cells from the cart to row 0).
  tap(x, y) {
    if (this.over) return { ok: false, why: 'over' };
    const cell = this.grid.getCell({ x, y });
    if (!cell || !cell.isBucket) return { ok: false, why: 'empty' };
    if (!cell.isPickable(this.grid.globalPickCount)) return { ok: false, why: 'blocked' };
    if (!this.belt.hasFreeSpot) return { ok: false, why: 'full' };
    const path = this.pathToBelt(x, y);
    const bucket = makeBucket({ x, y }, cell.colorType, cell.capacity);
    this.belt.add(bucket);
    this.grid.pick(cell);
    this.started = true;
    return { ok: true, bucket, path };
  }
  // Breadth-first path through empty cells to row 0 (the row against the belt).
  pathToBelt(sx, sy) {
    const g = this.grid, prev = new Map(), key = (x, y) => x * 64 + y, q = [[sx, sy]];
    prev.set(key(sx, sy), null);
    while (q.length) {
      const [x, y] = q.shift();
      if (x === 0) { const p = []; for (let k = key(x, y); k !== null; k = prev.get(k)) p.push({ x: Math.floor(k / 64), y: k % 64 }); return p.reverse(); }
      for (const [dx, dy] of [[-1, 0], [0, -1], [0, 1], [1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height || prev.has(key(nx, ny)) || g.getCell({ x: nx, y: ny }).isBlocking) continue;
        prev.set(key(nx, ny), key(x, y)); q.push([nx, ny]);
      }
    }
    return [{ x: sx, y: sy }];
  }
  // The greedy bot (same choice rule as the dashboard's eager player): used for attract mode and tests.
  autoTap() {
    while (this.belt.hasFreeSpot && !this.over) {
      const c = chooseEager(this.grid.getAvailableBuckets(), this.sand);
      if (!c) return;
      this.tap(c.index.x, c.index.y);
    }
  }

  // One fixed 60 Hz tick. Fast-forward calls this more often per frame; it never stretches DT.
  step() {
    if (this.over) return null;
    const fast = this.grid.getTotalBucketCount() + this.belt.occupiedSpots <= this.cfg.maxSpots;
    const r = this.belt.tick(DT, fast ? this.cfg.fastFactor : 1);
    if (this.started) this.sand.simulate();
    this.ticks++;
    if (r.failed) this.result = 'lose';
    else if (this.sand.isAllSandRemoved && this.belt.occupiedSpots === 0) this.result = 'win';
    else if (this.belt.occupiedSpots === 0 && this.grid.getTotalBucketCount() > 0 && this.grid.getAvailableBuckets().length === 0) this.result = 'lose';
    return r;
  }
}

class Belt {
  constructor(cfg, sand) { this.cfg = cfg; this.sand = sand; this.spots = []; this.idle = 0; }
  get activeBuckets() { return this.spots; }
  get occupiedSpots() { return this.spots.length; }
  get hasFreeSpot() { return this.spots.length < this.cfg.maxSpots; }
  // A new cart joins just before the picture; if that place is taken it waits behind the cart there.
  add(b) {
    let t = this.cfg.entryT;
    for (let k = 0; k < this.spots.length + 1; k++) {
      const clash = this.spots.find(s => Math.abs(((s.pathT - t + 1.5) % 1) - 0.5) < this.cfg.minGap);
      if (!clash) break;
      t = (clash.pathT - this.cfg.minGap + 1) % 1;
    }
    b.pathT = t; b.gridXPosition = roundHalfToEven(t * this.cfg.beltWidth);
    this.spots.push(b); this.idle = 0;
  }
  tick(dt, factor) {
    const { spotSpeed, boost, beltWidth, minGap, maxSpots, levelFailTimeout } = this.cfg;
    const n = this.spots.length, half = beltWidth / 2;
    // Advance, boosting carts that are off the picture (belt x beyond the 128-px image), then keep the gap to the cart ahead.
    const order = [...this.spots].sort((a, b) => a.pathT - b.pathT);
    const next = order.map(b => (b.pathT + spotSpeed * factor * (b.gridXPosition >= half ? boost : 1) * dt) % 1);
    for (let pass = 0; pass < 2 && n > 1; pass++) for (let i = n - 1; i >= 0; i--) {
      const ahead = next[(i + 1) % n], d = (ahead - next[i] + 1) % 1;
      if (d < minGap) next[i] = (ahead - minGap + 1) % 1;
    }
    order.forEach((b, i) => { b.pathT = next[i]; b.gridXPosition = roundHalfToEven(b.pathT * beltWidth); });
    // Suction, then full carts leave.
    let removedAny = false; const filled = [], collected = [];
    for (const b of this.spots) {
      if (b.isFull) continue;
      const got = this.sand.removeSandForBucket(b.gridXPosition, b.colorType, b.totalCapacity - b.capacity);
      if (got > 0) { removedAny = true; b.collectSand(got); collected.push([b, got]); }
      if (b.isFull) filled.push(b);
    }
    this.spots = this.spots.filter(b => !filled.includes(b));
    this.idle = removedAny ? 0 : this.idle + dt;
    const failed = this.spots.length >= maxSpots && this.idle >= levelFailTimeout;
    return { filled, collected, failed, warn: this.spots.length >= maxSpots && this.idle > 1 };
  }
}
