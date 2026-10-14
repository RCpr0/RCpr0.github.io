// Toyland Go! rules, ported from the shipped Unity logic (GoodSort.Logic: ShelfState, ShootingState, VoxelGrid, GameSim,
// AutoDig, RescueShuffle, AnchorCheck; GoodSort.LevelDesign: Macro, Playtest's natural player, SpinSchedule's view
// search). Pure JS, no three.js: the renderer reads everything it draws from here, and node tests play it headless.
//
// Coordinates: voxel cells are the game's model space. The world is three.js-like (x right, y up, z toward the camera);
// a cell maps to the world through the object's orientation q after mirroring z (Unity is left-handed).

export const TICK = 0.06;               // ShooterConfig.FireInterval: one shot per shooter per tick
export const DEPLOY_DELAY = 16;          // ticks a fresh shooter waits (covers merge + flight), as the certifier plays
export const AUTO_DIG_TICKS = 33;        // AutoDig.WaitSeconds 2 s
export const BLIND_FIRE_TICKS = 100;     // ShootingState.BlindFireTicks: 6 s with nothing in sight, then fire anyway
const SIGHT_RECHECK = 3, SIGHT_CHECKS = 24, SPIN_DEG = 12, RESUME_RAMP = 0.5, TURN_TICKS = 8, ASSIST_TICKS = 25;

// ---- kinds: colour * 16 + shape; colour 0 = empty slot ----
export const EMPTY = 0;
export const kindOf = (c, s) => (c > 0 ? c * 16 + s : EMPTY);
export const colorOf = k => k >> 4, shapeOf = k => k & 15, isEmpty = k => k < 16;

// ---- small seeded RNG (the Unity tools use System.Random; any fixed stream keeps runs reproducible) ----
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.int = n => Math.floor(f() * n);
  return f;
}
function stableHash(text) { let h = 2166136261 | 0; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return h & 0x7fffffff; }

// =====================================================================================================================
// Voxel object: a voxel is exposed when any face-neighbour is empty or destroyed; shooters hit only what they can see.
// =====================================================================================================================
const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export class VoxelGrid {
  constructor(layers) {
    if (!layers) return;
    const cells = [], colors = [];
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    const seen = new Set();
    for (const [c, flat] of Object.entries(layers)) for (let i = 0; i < flat.length; i += 3) {
      const key = `${flat[i]},${flat[i + 1]},${flat[i + 2]}`; if (seen.has(key)) continue; seen.add(key);
      cells.push(flat[i], flat[i + 1], flat[i + 2]); colors.push(+c);
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], flat[i + a]); mx[a] = Math.max(mx[a], flat[i + a]); }
    }
    this.n = colors.length; this.cells = Int32Array.from(cells); this.colors = Int32Array.from(colors);
    this.min = mn; this.max = mx; this.dim = [mx[0] - mn[0] + 1, mx[1] - mn[1] + 1, mx[2] - mn[2] + 1];
    // dense lookup: cell -> voxel index + 1 (0 = no voxel)
    this.grid = new Int32Array(this.dim[0] * this.dim[1] * this.dim[2]);
    for (let i = 0; i < this.n; i++) this.grid[this.gi(this.cells[i * 3], this.cells[i * 3 + 1], this.cells[i * 3 + 2])] = i + 1;
    this.nbr = new Int32Array(this.n * 6);
    for (let i = 0; i < this.n; i++) for (let d = 0; d < 6; d++) this.nbr[i * 6 + d] = this.indexOf(this.cells[i * 3] + NB[d][0], this.cells[i * 3 + 1] + NB[d][1], this.cells[i * 3 + 2] + NB[d][2]);
    this.alive = new Uint8Array(this.n).fill(1); this.locked = new Uint8Array(this.n);
    this.remainingByColor = new Map(); this.exposed = new Map();
    for (let i = 0; i < this.n; i++) this.remainingByColor.set(this.colors[i], (this.remainingByColor.get(this.colors[i]) || 0) + 1);
    this.remaining = this.n;
    for (let i = 0; i < this.n; i++) if (this.hasFreeFace(i)) this.exp(this.colors[i]).add(i);
  }
  clone() {
    const g = Object.create(VoxelGrid.prototype);
    Object.assign(g, this); g.alive = this.alive.slice(); g.locked = this.locked.slice();
    g.remainingByColor = new Map(this.remainingByColor); g.exposed = new Map([...this.exposed].map(([k, s]) => [k, new Set(s)]));
    return g;
  }
  gi(x, y, z) { return (x - this.min[0]) + this.dim[0] * ((y - this.min[1]) + this.dim[1] * (z - this.min[2])); }
  indexOf(x, y, z) {
    if (x < this.min[0] || y < this.min[1] || z < this.min[2] || x > this.max[0] || y > this.max[1] || z > this.max[2]) return -1;
    return this.grid[this.gi(x, y, z)] - 1;
  }
  exp(c) { let s = this.exposed.get(c); if (!s) this.exposed.set(c, s = new Set()); return s; }
  cell(i) { return [this.cells[i * 3], this.cells[i * 3 + 1], this.cells[i * 3 + 2]]; }
  remainingOf(c) { return this.remainingByColor.get(c) || 0; }
  exposedCount(c) { return this.exposed.get(c)?.size || 0; }
  isExposed(i) { return !!this.alive[i] && !!this.exposed.get(this.colors[i])?.has(i); }
  hasFreeFace(i) { for (let d = 0; d < 6; d++) { const j = this.nbr[i * 6 + d]; if (j < 0 || !this.alive[j]) return true; } return false; }
  // Render-only: on the shell or touching it (bevelled cubes leave seams the layer below shows through).
  isNearSurface(i) {
    if (!this.alive[i]) return false; if (this.hasFreeFace(i)) return true;
    for (let d = 0; d < 6; d++) { const j = this.nbr[i * 6 + d]; if (j >= 0 && this.hasFreeFace(j)) return true; }
    return false;
  }
  d2(a, i) { const dx = a[0] - this.cells[i * 3], dy = a[1] - this.cells[i * 3 + 1], dz = a[2] - this.cells[i * 3 + 2]; return dx * dx + dy * dy + dz * dz; }
  // Nearest exposed voxel of the colour; ties go to the lowest index.
  findTarget(c, a) {
    const set = this.exposed.get(c); if (!set || !set.size) return -1;
    let best = -1, bd = Infinity;
    for (const i of set) { const d = this.d2(a, i); if (d < bd || (d === bd && i < best)) { best = i; bd = d; } }
    return best;
  }
  outside(p) { return p[0] < this.min[0] - .5 || p[0] > this.max[0] + .5 || p[1] < this.min[1] - .5 || p[1] > this.max[1] + .5 || p[2] < this.min[2] - .5 || p[2] > this.max[2] + .5; }
  // The nearest voxel of the colour the anchor can see (one of its open faces in a straight, unblocked line).
  findVisibleTarget(c, a) {
    if (!this.outside(a)) return this.findTarget(c, a);
    const set = this.exposed.get(c); if (!set || !set.size) return -1;
    const nd = [], ni = [];
    for (const i of set) {
      const d = this.d2(a, i), n = nd.length;
      if (n === SIGHT_CHECKS && (d > nd[n - 1] || (d === nd[n - 1] && i > ni[n - 1]))) continue;
      let k = n < SIGHT_CHECKS ? n : n - 1; if (n < SIGHT_CHECKS) { nd.push(0); ni.push(0); }
      while (k > 0 && (nd[k - 1] > d || (nd[k - 1] === d && ni[k - 1] > i))) { nd[k] = nd[k - 1]; ni[k] = ni[k - 1]; k--; }
      nd[k] = d; ni[k] = i;
    }
    for (const i of ni) if (this.inSight(a, i)) return i;
    return -1;
  }
  nearestOpenFaces(c, a, max) {
    const set = this.exposed.get(c), out = []; if (!set || !set.size) return out;
    const near = [...set].map(i => [this.d2(a, i), i]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    for (let k = 0; k < near.length && k < max; k++) {
      const i = near[k][1];
      for (let d = 0; d < 6; d++) { const j = this.nbr[i * 6 + d]; if (!(j >= 0 && this.alive[j])) out.push([i, NB[d]]); }
    }
    return out;
  }
  inSight(from, t) {
    const tx = this.cells[t * 3], ty = this.cells[t * 3 + 1], tz = this.cells[t * 3 + 2];
    for (let d = 0; d < 6; d++) {
      const j = this.nbr[t * 6 + d]; if (j >= 0 && this.alive[j]) continue;
      const [nx, ny, nz] = NB[d], fx = tx + nx * .51, fy = ty + ny * .51, fz = tz + nz * .51;
      if ((from[0] - fx) * nx + (from[1] - fy) * ny + (from[2] - fz) * nz <= 0) continue;
      if (this.clear(from, fx, fy, fz)) return true;
    }
    return false;
  }
  // Amanatides–Woo walk over unit cells centred on integers: no live voxel between a and b.
  clear(a, bx, by, bz) {
    const ox = a[0] + .5, oy = a[1] + .5, oz = a[2] + .5, dx = bx - a[0], dy = by - a[1], dz = bz - a[2];
    let cx = Math.floor(ox), cy = Math.floor(oy), cz = Math.floor(oz);
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz), BIG = Number.MAX_VALUE;
    const tdx = dx ? Math.abs(1 / dx) : BIG, tdy = dy ? Math.abs(1 / dy) : BIG, tdz = dz ? Math.abs(1 / dz) : BIG;
    let tmx = dx ? (sx > 0 ? cx + 1 - ox : ox - cx) * tdx : BIG, tmy = dy ? (sy > 0 ? cy + 1 - oy : oy - cy) * tdy : BIG, tmz = dz ? (sz > 0 ? cz + 1 - oz : oz - cz) * tdz : BIG;
    for (let g = 0; g < 4096; g++) {
      const j = this.indexOf(cx, cy, cz); if (j >= 0 && this.alive[j]) return false;
      if (tmx <= tmy && tmx <= tmz) { if (tmx > 1) return true; cx += sx; tmx += tdx; }
      else if (tmy <= tmz) { if (tmy > 1) return true; cy += sy; tmy += tdy; }
      else { if (tmz > 1) return true; cz += sz; tmz += tdz; }
    }
    return true;
  }
  destroy(i) {
    if (!this.alive[i]) return;
    this.alive[i] = 0; this.remaining--; const c = this.colors[i];
    this.remainingByColor.set(c, this.remainingByColor.get(c) - 1); this.exp(c).delete(i);
    for (let d = 0; d < 6; d++) { const j = this.nbr[i * 6 + d]; if (j >= 0 && this.alive[j] && !this.locked[j]) this.exp(this.colors[j]).add(j); }
  }
  setLocked(i, on) {
    if (!!this.locked[i] === on) return; this.locked[i] = on ? 1 : 0;
    if (on) this.exp(this.colors[i]).delete(i); else if (this.alive[i] && this.hasFreeFace(i)) this.exp(this.colors[i]).add(i);
  }
}

// =====================================================================================================================
// Shelves: 3 column queues of cubbies; the top `visibleRows` of each column are on screen and interactable.
// =====================================================================================================================
export class ShelfState {
  constructor(level) {
    this.cols = []; this.byId = new Map(); if (!level) return;
    this.visibleRows = level.visibleRows || 3;
    let id = 0;
    for (const col of level.columns) {
      const list = [];
      for (const s of col) {
        const n = s.s.length, sh = { id: id++, slots: s.s.map(([c, k]) => kindOf(c, k)), sealed: Array.from({ length: n }, (_, i) => !!s.seal?.[i]), pair: Array.from({ length: n }, (_, i) => !!s.pair?.[i]), partner: s.chain ?? -1, blocked: false };
        list.push(sh); this.byId.set(sh.id, sh);
      }
      this.cols.push(list);
    }
  }
  clone() {
    const o = new ShelfState(); o.visibleRows = this.visibleRows;
    for (const col of this.cols) o.cols.push(col.map(s => { const c = { ...s, slots: s.slots.slice(), sealed: s.sealed.slice(), pair: s.pair.slice() }; o.byId.set(c.id, c); return c; }));
    return o;
  }
  get columnCount() { return this.cols.length; }
  columnIds(c) { return this.cols[c].map(s => s.id); }
  exists(id) { return this.byId.has(id); }
  locate(id) { for (let c = 0; c < this.cols.length; c++) { const r = this.cols[c].findIndex(s => s.id === id); if (r >= 0) return [c, r]; } return null; }
  isHead(id) { const l = this.locate(id); return !!l && l[1] === 0; }
  somethingBehind(c, r) { if (this.hasHidden(c)) return true; for (let k = r + 1; k < this.cols[c].length; k++) if (this.cols[c][k].blocked) return true; return false; }
  leavesWhenEmptied(id) { const l = this.locate(id); return !!l && this.somethingBehind(l[0], l[1]); }
  collapseEmptyAbove(id) {
    const out = [], l = this.locate(id); if (!l) return out;
    for (let r = l[1] - 1; r >= 0; r--) { const s = this.cols[l[0]][r]; if (s.blocked || !emptyShelf(s)) continue; out.unshift(s.id); this.cols[l[0]].splice(r, 1); this.byId.delete(s.id); }
    return out;
  }
  isVisible(id) { const l = this.locate(id); return !!l && l[1] < this.visibleRows; }
  isBlocked(id) { return !!this.byId.get(id)?.blocked; }
  slotCount(id) { return this.byId.get(id).slots.length; }
  get(id, i) { return this.byId.get(id).slots[i]; }
  interactable(id) { const s = this.byId.get(id); return !!s && !s.blocked && this.isVisible(id); }
  isSealed(id, i) { const s = this.byId.get(id); return !!s && i >= 0 && i < s.slots.length && s.sealed[i] && !isEmpty(s.slots[i]); }
  pairLeft(id, i) { const s = this.byId.get(id); if (!s || i < 0 || i >= s.slots.length) return -1; if (s.pair[i]) return i; if (i > 0 && s.pair[i - 1]) return i - 1; return -1; }
  // Owner 2026-10-12/13: a drop anywhere on a cubby lands where it completes the triple (the gap, or the odd one out to swap).
  completingSlot(fromId, fromSlot, id) {
    if (fromId === id || !this.interactable(id) || !this.exists(fromId)) return -1;
    const src = this.byId.get(fromId); if (fromSlot < 0 || fromSlot >= src.slots.length || this.pairLeft(fromId, fromSlot) >= 0) return -1;
    const k = src.slots[fromSlot]; if (isEmpty(k)) return -1;
    const dst = this.byId.get(id); let odd = -1;
    for (let i = 0; i < dst.slots.length; i++) { if (dst.slots[i] === k) continue; if (odd >= 0) return -1; odd = i; }
    if (odd < 0 || isEmpty(dst.slots[odd])) return odd;
    return dst.sealed[odd] || this.pairLeft(id, odd) >= 0 ? -1 : odd;
  }
  partnerOf(id) { return this.byId.get(id)?.partner ?? -1; }
  readiness(fid, tid) { if (!this.exists(fid) || !this.exists(tid)) return 'gone'; return this.interactable(fid) && this.interactable(tid) ? 'ready' : 'wait'; }
  hasHidden(c) { let standing = 0; for (const s of this.cols[c]) if (!s.blocked) standing++; return standing > this.visibleRows; }
  charactersOn(id) { return this.byId.get(id).slots.filter(k => !isEmpty(k)).length; }
  // Moves one character (or a hand-holding pair); a full cubby of one kind merges; a cubby the move empties leaves.
  tryMove(f, fs, t, ts) {
    const r = { result: 'refused', matched: EMPTY, emptied: -1 };
    if ((f === t && fs === ts) || !this.interactable(f) || !this.interactable(t)) return r;
    const src = this.byId.get(f), dst = this.byId.get(t);
    if (fs < 0 || fs >= src.slots.length || ts < 0 || ts >= dst.slots.length) return r;
    if (isEmpty(src.slots[fs]) || src.sealed[fs]) return r;
    const left = this.pairLeft(f, fs);
    if (left >= 0) {
      if (src === dst || ts + 1 >= dst.slots.length || !isEmpty(dst.slots[ts]) || !isEmpty(dst.slots[ts + 1])) return r;
      dst.slots[ts] = src.slots[left]; dst.slots[ts + 1] = src.slots[left + 1]; src.slots[left] = src.slots[left + 1] = EMPTY;
      src.pair[left] = false; dst.pair[ts] = true;
    } else {
      if (!isEmpty(dst.slots[ts])) return r;
      dst.slots[ts] = src.slots[fs]; src.slots[fs] = EMPTY;
    }
    r.result = 'moved';
    if (fullOfOne(dst)) { r.matched = dst.slots[0]; clearShelf(dst); r.result = 'matched'; }
    if (src !== dst && emptyShelf(src)) r.emptied = this.removeEmptied(src);
    return r;
  }
  removeEmptied(s) {
    if (s.partner >= 0) { const p = this.byId.get(s.partner); if (p) p.partner = -1; s.partner = -1; }
    const l = this.locate(s.id); if (!l) return -1;
    this.cols[l[0]].splice(l[1], 1); this.byId.delete(s.id); return s.id;
  }
  // Owner 2026-10-05: drop a character on another and they trade places (not sealed, not holding hands).
  trySwap(a, as, b, bs) {
    const merged = [];
    if ((a === b && as === bs) || !this.interactable(a) || !this.interactable(b)) return { result: 'refused', merged };
    const sa = this.byId.get(a), sb = this.byId.get(b);
    if (as < 0 || as >= sa.slots.length || bs < 0 || bs >= sb.slots.length) return { result: 'refused', merged };
    if (isEmpty(sa.slots[as]) || isEmpty(sb.slots[bs])) return { result: 'refused', merged };
    if (sa.sealed[as] || sb.sealed[bs] || this.pairLeft(a, as) >= 0 || this.pairLeft(b, bs) >= 0) return { result: 'refused', merged };
    [sa.slots[as], sb.slots[bs]] = [sb.slots[bs], sa.slots[as]];
    for (const s of sa === sb ? [sa] : [sa, sb]) if (fullOfOne(s)) { merged.push([s.id, s.slots[0]]); clearShelf(s); }
    return { result: merged.length ? 'matched' : 'moved', merged };
  }
  rearrange(columns) { for (let c = 0; c < this.cols.length; c++) this.cols[c] = columns[c].map(id => this.byId.get(id)); }
  removeShelf(id) { const l = this.locate(id); if (!l) throw new Error('shelf ' + id); this.cols[l[0]].splice(l[1], 1); this.byId.delete(id); }
  *interactableShelves() { for (const col of this.cols) for (let r = 0; r < col.length && r < this.visibleRows; r++) if (!col[r].blocked) yield col[r]; }
  freeVisibleSlots() { let n = 0; for (const s of this.interactableShelves()) for (const k of s.slots) if (isEmpty(k)) n++; return n; }
  // Spec 2026-10-04 §1.5: some kind can still be completed on some visible cubby.
  anyCompletionReachable() {
    const shelves = [...this.interactableShelves()], pairsCanMove = this.freeVisibleSlots() >= 2;
    const fixed = (s, i) => s.sealed[i] || (!pairsCanMove && (s.pair[i] || (i > 0 && s.pair[i - 1])));
    const movable = new Map();
    for (const s of shelves) for (let i = 0; i < s.slots.length; i++) if (!isEmpty(s.slots[i]) && !fixed(s, i)) movable.set(s.slots[i], (movable.get(s.slots[i]) || 0) + 1);
    for (const s of shelves) {
      let foreign = EMPTY, two = false;
      for (let i = 0; i < s.slots.length; i++) if (fixed(s, i) && !isEmpty(s.slots[i])) { if (!isEmpty(foreign) && foreign !== s.slots[i]) two = true; foreign = s.slots[i]; }
      if (two) continue;
      for (const [k, v] of movable) {
        if (!isEmpty(foreign) && foreign !== k) continue;
        let here = 0; for (let i = 0; i < s.slots.length; i++) if (fixed(s, i) && s.slots[i] === k) here++;
        if (here + v >= 3) return true;
      }
    }
    return false;
  }
  anyDigPossible() {
    for (let c = 0; c < this.cols.length; c++) {
      let behind = this.hasHidden(c); for (const x of this.cols[c]) if (x.blocked) behind = true;
      if (!behind) continue;
      for (let r = 0; r < this.cols[c].length && r < this.visibleRows; r++) {
        const s = this.cols[c][r]; if (s.blocked || !this.somethingBehind(c, r)) continue;
        if (!s.slots.some((k, i) => s.sealed[i] && !isEmpty(k))) return true;
      }
    }
    return false;
  }
  *visibleSlots() { for (const s of this.interactableShelves()) for (let i = 0; i < s.slots.length; i++) yield [s.id, i, s.slots[i]]; }
  clearEmptiedBoard() {
    const out = [];
    for (const col of this.cols) for (const s of col) if (s.blocked || !emptyShelf(s)) return out;
    for (const col of this.cols) { for (const s of col) { out.push(s.id); this.byId.delete(s.id); } col.length = 0; }
    return out;
  }
  characterCount() { let n = 0; for (const col of this.cols) for (const s of col) for (const k of s.slots) if (!isEmpty(k)) n++; return n; }
  key() { return this.cols.map(col => col.map(s => (s.blocked ? '#' : '[') + s.slots.map((k, i) => k + (s.sealed[i] ? 's' : '') + (s.pair[i] ? 'p' : '')).join(',')).join('')).join('|'); }
  hasSealed(id) { const s = this.byId.get(id); return s.slots.some((k, i) => s.sealed[i] && !isEmpty(k)); }
}
const emptyShelf = s => s.slots.every(isEmpty);
const fullOfOne = s => !isEmpty(s.slots[0]) && s.slots.every(k => k === s.slots[0]);
const clearShelf = s => { s.slots.fill(EMPTY); s.sealed.fill(false); s.pair.fill(false); s.blocked = true; };

// =====================================================================================================================
// The dock: spots, merges waiting for a spot, per-colour ammo lists and the voxel object.
// =====================================================================================================================
export class ShootingState {
  constructor(level, voxels) {
    if (!level) return;
    this.voxels = voxels; this.spots = new Array(level.spots || 5).fill(null); this.anchors = this.spots.map(() => [0, 0, 0]);
    this.ammo = new Map(); for (const [c, a] of level.shooters) { if (!this.ammo.has(c)) this.ammo.set(c, []); this.ammo.get(c).push(a); }
    this.pending = []; this.nextId = 0; this.nextGroup = 1; this.tick = 0; this.allStalledSince = -1;
    this.frozen = (level.frozen || []).map(f => { const vox = []; for (let i = 0; i < f.cells.length; i += 3) { const j = voxels.indexOf(f.cells[i], f.cells[i + 1], f.cells[i + 2]); if (j >= 0) vox.push(j); } return { hp: f.hp, startHp: f.hp, voxels: vox }; });
    for (const f of this.frozen) if (f.hp > 0) for (const i of f.voxels) voxels.setLocked(i, true);
  }
  clone() {
    const o = Object.create(ShootingState.prototype); Object.assign(o, this);
    o.voxels = this.voxels.clone(); o.spots = this.spots.map(s => s && { ...s }); o.anchors = this.anchors.map(a => a.slice());
    o.ammo = new Map([...this.ammo].map(([k, v]) => [k, v.slice()])); o.pending = this.pending.map(p => ({ ...p })); o.frozen = this.frozen.map(f => ({ ...f }));
    return o;
  }
  get freeSpots() { return this.spots.filter(s => !s).length; }
  get anyFrozen() { return this.frozen.some(f => f.hp > 0); }
  onMerge(ev) {
    this.frozen.forEach((f, k) => {
      if (f.hp <= 0) return; f.hp--; ev?.push({ type: 'iceCracked', section: k, hp: f.hp });
      if (f.hp > 0) return; for (const i of f.voxels) this.voxels.setLocked(i, false); ev?.push({ type: 'iceShattered', section: k });
    });
  }
  takeAmmo(c) { const q = this.ammo.get(c); return q && q.length ? q.shift() : 0; }
  enqueue(shelf, kind, ammo) { this.pending.push({ shelf, kind, ammo, group: 0, size: 1 }); }
  enqueueGroup(members) { const g = this.nextGroup++; for (const m of members) this.pending.push({ ...m, group: g, size: members.length }); return g; }
  deploy(ev, onDeployed) {
    if (this.voxels.remaining === 0) return;
    while (this.pending.length) {
      const head = this.pending[0]; if (this.freeSpots < head.size) return;
      for (let k = 0; k < head.size; k++) {
        const p = this.pending.shift(), spot = this.spots.indexOf(null);
        const s = { id: this.nextId++, color: colorOf(p.kind), kind: p.kind, ammo: p.ammo, startAmmo: p.ammo, warmup: DEPLOY_DELAY, group: p.group, stalled: false, sightWait: 0, sightFrom: null };
        this.spots[spot] = s;
        ev?.push({ type: 'deployed', spot, shooter: s.id, shelf: p.shelf, kind: p.kind, ammo: p.ammo, group: p.group });
        onDeployed?.(p.shelf);
      }
    }
  }
  groupEmpty(g) { return !this.spots.some(s => s && s.group === g && s.ammo > 0); }
  release(i, ev) {
    const s = this.spots[i];
    if (!s.group) { this.spots[i] = null; ev?.push({ type: 'done', spot: i, shooter: s.id }); return; }
    if (!this.groupEmpty(s.group)) return;
    this.spots.forEach((m, j) => { if (m && m.group === s.group) { this.spots[j] = null; ev?.push({ type: 'done', spot: j, shooter: m.id }); } });
  }
  step(ev, onDeployed) {
    this.tick++;
    if (!this.allStalled()) this.allStalledSince = -1; else if (this.allStalledSince < 0) this.allStalledSince = this.tick;
    const blind = this.allStalledSince >= 0 && this.tick - this.allStalledSince >= BLIND_FIRE_TICKS;
    for (let i = 0; i < this.spots.length; i++) {
      const s = this.spots[i]; if (!s) continue;
      if (s.ammo <= 0) { this.release(i, ev); continue; }
      if (s.warmup > 0) { s.warmup--; continue; }
      if (!blind && s.stalled && s.sightWait > 0 && near(this.anchors[i], s.sightFrom)) { s.sightWait--; continue; }
      const t = blind ? this.voxels.findTarget(s.color, this.anchors[i]) : this.voxels.findVisibleTarget(s.color, this.anchors[i]);
      if (t < 0) { s.stalled = true; s.sightWait = SIGHT_RECHECK; s.sightFrom = this.anchors[i].slice(); continue; }
      s.stalled = false; this.voxels.destroy(t); s.ammo--;
      ev?.push({ type: 'shot', spot: i, shooter: s.id, voxel: t, color: s.color, ammo: s.ammo });
      if (s.ammo <= 0) this.release(i, ev);
      if (this.voxels.remaining === 0) break;
    }
    this.deploy(ev, onDeployed);
  }
  allStalled() { let n = 0; for (const s of this.spots) { if (!s || s.ammo <= 0) continue; if (s.warmup > 0 || !s.stalled) return false; n++; } return n > 0; }
  canProgress() {
    for (const s of this.spots) {
      if (!s) continue; if (s.warmup > 0) return true;
      if (s.ammo <= 0) { if (!s.group || this.groupEmpty(s.group)) return true; continue; }
      if (this.voxels.exposedCount(s.color) > 0) return true;
    }
    return this.pending.length > 0 && this.freeSpots >= this.pending[0].size;
  }
  topStuck() {
    if (this.anyFrozen) return false;
    let anyFree = false;
    for (const s of this.spots) {
      if (!s) { anyFree = true; continue; }
      if (s.warmup > 0 || (s.ammo <= 0 && (!s.group || this.groupEmpty(s.group))) || (s.ammo > 0 && this.voxels.exposedCount(s.color) > 0)) return false;
    }
    if (anyFree && (!this.pending.length || this.pending[0].size <= this.freeSpots)) return false;
    return true;
  }
  key() { return this.pending.length + '/' + this.frozen.map(f => 'i' + f.hp).join('') + this.spots.map(s => (s ? `${s.color}:${s.ammo}` : '-')).join(','); }
}
const near = (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2]; return dx * dx + dy * dy + dz * dz < 1; };

// =====================================================================================================================
// Orientation: the object spins about world up (12°/s); when every shooter is stalled it turns to where most can see.
// Quaternions are [x, y, z, w] in world (three.js) space.
// =====================================================================================================================
export const Q = {
  axis(ax, deg) { const h = deg * Math.PI / 360, s = Math.sin(h); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(h)]; },
  mul(a, b) { return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]]; },
  inv(q) { return [-q[0], -q[1], -q[2], q[3]]; },
  rot(q, v) { const p = Q.mul(Q.mul(q, [v[0], v[1], v[2], 0]), Q.inv(q)); return [p[0], p[1], p[2]]; },
  norm(q) { const l = Math.hypot(...q) || 1; return q.map(x => x / l); },
  fromTo(a, b) {
    const la = Math.hypot(...a) || 1, lb = Math.hypot(...b) || 1, u = a.map(x => x / la), v = b.map(x => x / lb);
    const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    if (d < -1 + 1e-9) { const ax = Math.abs(u[0]) < .9 ? [1, 0, 0] : [0, 1, 0]; const c = [u[1] * ax[2] - u[2] * ax[1], u[2] * ax[0] - u[0] * ax[2], u[0] * ax[1] - u[1] * ax[0]]; return Q.norm([...c, 0]); }
    return Q.norm([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0], 1 + d]);
  },
  slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; if (d < 0) { b = b.map(x => -x); d = -d; }
    if (d > .9995) return Q.norm(a.map((x, i) => x + (b[i] - x) * t));
    const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return a.map((x, i) => x * wa + b[i] * wb);
  },
  // Unity's Quaternion.Euler (Z, then X, then Y) in Unity's left-handed space, carried over to world space (z mirrored).
  fromUnityEuler([x, y, z]) { return Q.mul(Q.mul(Q.axis([0, 1, 0], -y), Q.axis([1, 0, 0], -x)), Q.axis([0, 0, 1], z)); },
};
const mirror = v => [v[0], v[1], -v[2]];

export class View {
  constructor(level, voxels) {
    const mn = voxels.min, mx = voxels.max;
    this.centre = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
    let r = 0; for (let i = 0; i < voxels.n; i++) { const c = voxels.cell(i); r = Math.max(r, Math.hypot(c[0] - this.centre[0], c[1] - this.centre[1], c[2] - this.centre[2])); }
    this.radius = r + 0.87;
    this.q = Q.fromUnityEuler(level.euler || [0, 0, 0]);
    this.turn = null; this.released = 99; this.nextAuto = 0; this.dragging = false;
    // Where each dock spot's muzzle sits in the world (cell units, object centre at the origin): a row below and in front.
    const n = level.spots || 5, R = this.radius;
    this.spacing = R * 0.7; this.dockY = -R * 1.55;
    this.muzzles = Array.from({ length: n }, (_, i) => [(i - (n - 1) / 2) * this.spacing, this.dockY + R * 0.28, R * 0.45]);
  }
  clone() { const o = Object.create(View.prototype); Object.assign(o, this); o.q = this.q.slice(); o.turn = this.turn && { ...this.turn }; return o; }
  // Model (cell) space <-> world.
  toWorld(cell, q = this.q) { return Q.rot(q, mirror([cell[0] - this.centre[0], cell[1] - this.centre[1], cell[2] - this.centre[2]])); }
  toModel(world, q = this.q) { const m = mirror(Q.rot(Q.inv(q), world)); return [m[0] + this.centre[0], m[1] + this.centre[1], m[2] + this.centre[2]]; }
  anchorsInto(shooting) { for (let i = 0; i < shooting.spots.length; i++) shooting.anchors[i] = this.toModel(this.muzzles[Math.min(i, this.muzzles.length - 1)]); }
  // One tick of motion: an auto-turn in progress, else the steady spin (easing back in after a turn or drag).
  step(shooting) {
    if (this.dragging) return;
    if (this.turn) {
      this.turn.t++; this.q = Q.slerp(this.turn.from, this.turn.to, Math.min(1, this.turn.t / TURN_TICKS));
      if (this.turn.t >= TURN_TICKS) { this.turn = null; this.released = 0; }
      return;
    }
    this.released += TICK;
    const k = Math.min(1, this.released / RESUME_RAMP), speed = SPIN_DEG * (0.25 + 0.75 * k * k * (3 - 2 * k));
    this.q = Q.norm(Q.mul(Q.axis([0, 1, 0], -speed * TICK), this.q));
    this.autoTurn(shooting);
  }
  // Head rule §1.9: every shooter stalled -> turn to the orientation (8 yaws × 4 tilts, plus each stalled shooter's nearest
  // open faces aimed straight at it) where the most of them see a target; nothing helps -> look again in 1.5 s.
  autoTurn(sh) {
    if (sh.tick < this.nextAuto || !sh.allStalled()) return;
    const cands = [];
    for (let o = 0; o < 32; o++) cands.push(Q.norm(Q.mul(Q.mul(Q.axis([0, 1, 0], 45 * (o % 8)), Q.axis([1, 0, 0], 90 * Math.floor(o / 8))), this.q)));
    sh.spots.forEach((s, i) => {
      if (!s || s.ammo <= 0 || !s.stalled) return;
      const spot = this.muzzles[Math.min(i, this.muzzles.length - 1)];
      for (const [vox, n] of sh.voxels.nearestOpenFaces(s.color, sh.anchors[i], 4)) {
        const c = sh.voxels.cell(vox), face = [c[0] + n[0] * .5, c[1] + n[1] * .5, c[2] + n[2] * .5];
        let q = this.q;
        for (let k = 0; k < 5; k++) {
          const w = Q.rot(q, mirror(n)), p = this.toWorld(face, q);
          q = Q.norm(Q.mul(Q.fromTo(w, [spot[0] - p[0], spot[1] - p[1], spot[2] - p[2]]), q));
        }
        cands.push(q);
      }
    });
    let best = -1, bestSeen = 0;
    cands.forEach((q, o) => {
      let seen = 0;
      sh.spots.forEach((s, i) => { if (s && s.ammo > 0 && s.stalled && sh.voxels.findVisibleTarget(s.color, this.toModel(this.muzzles[Math.min(i, this.muzzles.length - 1)], q)) >= 0) seen++; });
      if (seen > bestSeen) { bestSeen = seen; best = o; }
    });
    if (best <= 0) { this.nextAuto = sh.tick + ASSIST_TICKS; return; }
    this.turn = { from: this.q, to: cands[best], t: 0 };
  }
  // The visitor drags the object: yaw about world up, pitch about world right (360° per stage width).
  drag(dyaw, dpitch) { this.turn = null; this.q = Q.norm(Q.mul(Q.mul(Q.axis([1, 0, 0], dpitch), Q.axis([0, 1, 0], dyaw)), this.q)); this.released = 0; }
}

// =====================================================================================================================
// The whole game: shelves (bottom) + dock and voxel object (top), with the head rule, chains, auto-dig and rescue.
// =====================================================================================================================
export class Game {
  constructor(level, { autoDig = true } = {}) {
    if (!level) return;
    this.level = level;
    this.shelves = new ShelfState(level);
    this.voxels = new VoxelGrid(level.voxels);
    this.shooting = new ShootingState(level, this.voxels);
    this.view = new View(level, this.voxels);
    this.view.anchorsInto(this.shooting);
    this.waiting = []; this.rescues = 0; this.autoDigs = 0; this.stuck = 0; this.autoDigTicks = autoDig ? AUTO_DIG_TICKS : 0;
    this.holdAutoDig = false; this.ticks = 0; this.moves = 0; this.events = [];
    this.seed = stableHash(this.shelves.key());
    this.total = this.voxels.n;
    this.outcome = this.voxels.remaining === 0 ? 'won' : 'playing';
  }
  clone() {
    const o = Object.create(Game.prototype); Object.assign(o, this);
    o.shelves = this.shelves.clone(); o.shooting = this.shooting.clone(); o.voxels = o.shooting.voxels; o.view = this.view.clone();
    o.waiting = this.waiting.map(w => ({ ...w })); o.events = [];
    return o;
  }
  get over() { return this.outcome !== 'playing'; }
  get pending() { return this.shooting.pending.length; }
  // ---- player actions ----
  move(f, fs, t, ts) {
    if (this.over) return 'refused';
    const ev = this.events, kind = this.shelves.exists(f) && fs >= 0 && fs < this.shelves.slotCount(f) ? this.shelves.get(f, fs) : EMPTY;
    const pl = this.shelves.exists(f) ? this.shelves.pairLeft(f, fs) : -1;
    const r = this.shelves.tryMove(f, fs, t, ts);
    if (r.result === 'refused') return 'refused';
    this.stuck = 0; this.moves++;
    ev.push({ type: 'moved', from: [f, pl >= 0 ? pl : fs], to: [t, ts], kind, pair: pl >= 0 });
    if (r.emptied >= 0) ev.push({ type: 'removed', shelf: r.emptied });
    if (r.result === 'matched') this.onMatched(t, r.matched); else this.release();
    this.updateOutcome();
    return r.result;
  }
  swap(a, as, b, bs) {
    if (this.over) return 'refused';
    const r = this.shelves.trySwap(a, as, b, bs);
    if (r.result === 'refused') return 'refused';
    this.stuck = 0; this.moves++;
    this.events.push({ type: 'swapped', a: [a, as], b: [b, bs] });
    for (const [id, k] of r.merged) this.onMatched(id, k);
    if (!r.merged.length) this.release();
    this.updateOutcome();
    return r.result;
  }
  // A triple merged: its shooter waits for the head of its column (and for its chained partner).
  onMatched(shelf, kind) {
    const ev = this.events, ammo = this.shooting.takeAmmo(colorOf(kind));
    ev.push({ type: 'matched', shelf, kind, ammo });
    this.shooting.onMerge(ev);
    for (const id of this.shelves.collapseEmptyAbove(shelf)) ev.push({ type: 'removed', shelf: id });
    const w = { shelf, kind, ammo, announced: false };
    this.waiting.push(w); this.release();
    if (this.waiting.includes(w)) { w.announced = true; ev.push({ type: this.shelves.isHead(shelf) ? 'chainHeld' : 'headWait', shelf, kind, ammo }); }
  }
  release() {
    const ev = this.events;
    for (let changed = true; changed;) {
      changed = false;
      for (let i = 0; i < this.waiting.length && !changed; i++) {
        const w = this.waiting[i]; if (!this.shelves.isHead(w.shelf)) continue;
        const p = this.shelves.partnerOf(w.shelf);
        if (p < 0) { this.waiting.splice(i, 1); this.announce(w); this.shooting.enqueue(w.shelf, w.kind, w.ammo); changed = true; continue; }
        const j = this.waiting.findIndex(x => x.shelf === p); if (j < 0 || !this.shelves.isHead(p)) continue;
        const a = this.waiting[Math.min(i, j)], b = this.waiting[Math.max(i, j)];
        this.waiting = this.waiting.filter(x => x !== a && x !== b); this.announce(a); this.announce(b);
        this.shooting.enqueueGroup([a, b].map(x => ({ shelf: x.shelf, kind: x.kind, ammo: x.ammo }))); changed = true;
      }
      if (changed) this.shooting.deploy(ev, id => this.removeDeployed(id));
    }
  }
  announce(w) { if (w.announced) this.events.push({ type: 'headReady', shelf: w.shelf, kind: w.kind, ammo: w.ammo }); }
  removeDeployed(id) { if (id < 0) return; this.shelves.removeShelf(id); this.events.push({ type: 'removed', shelf: id, deployed: true }); }
  // ---- time ----
  tick() {
    if (this.over) return;
    this.ticks++;
    this.view.step(this.shooting); this.view.anchorsInto(this.shooting);
    this.shooting.step(this.events, id => this.removeDeployed(id));
    this.release(); this.updateOutcome(); this.autoDigTick();
  }
  boardNeedsRepair() { return this.shelves.characterCount() > 0 && !this.shelves.anyCompletionReachable(); }
  // Owner 2026-10-13/14: a board where no triple can come together is repaired after 2 s: a dig if one fits, else a re-deal.
  autoDigTick() {
    if (this.autoDigTicks <= 0 || this.over || !this.boardNeedsRepair()) { this.stuck = 0; return; }
    if (++this.stuck < this.autoDigTicks || this.holdAutoDig) return;
    this.stuck = 0;
    const moves = planAutoDig(this.shelves);
    if (!moves) { this.rescue(); return; }
    this.autoDigs++; this.events.push({ type: 'autoDug', shelf: moves[0][0] });
    for (const [f, fs, t, ts] of moves) if (this.move(f, fs, t, ts) === 'refused' || this.over) break;
  }
  isDryStuck() { const free = this.shelves.freeVisibleSlots(); return this.pending === 0 && this.shelves.characterCount() > 0 && !this.shelves.anyCompletionReachable() && !(free >= 3 && this.shelves.anyDigPossible()); }
  rescue() {
    const plan = planRescue(this.shelves, (Math.imul(this.seed, 7919) + this.rescues) | 0); if (!plan) return false;
    this.shelves.rearrange(plan); this.rescues++; this.stuck = 0;
    this.events.push({ type: 'shuffled' }); this.release(); return true;
  }
  isDead() {
    if (this.voxels.remaining === 0) return false;
    if (this.shooting.topStuck()) return true;
    const free = this.shelves.freeVisibleSlots();
    const bottom = this.shelves.characterCount() === 0 || (!this.shelves.anyCompletionReachable() && !(free >= 3 && this.shelves.anyDigPossible()));
    return bottom && !this.shooting.canProgress();
  }
  updateOutcome() {
    if (this.over) return;
    if (!this.waiting.length) for (const id of this.shelves.clearEmptiedBoard()) this.events.push({ type: 'removed', shelf: id });
    if (this.voxels.remaining === 0) { this.outcome = 'won'; this.events.push({ type: 'won' }); return; }
    if (this.isDead()) {
      if (!this.shooting.topStuck() && this.isDryStuck() && this.rescue() && !this.isDead()) return;
      this.outcome = 'lost'; this.events.push({ type: 'lost' });
    }
  }
  progress() { return 1 - this.voxels.remaining / this.total; }
}

// ---- AutoDig: the cubby with the fewest characters moves them out (next to their own kind first) and leaves ----
export function planAutoDig(s) {
  const cands = [];
  for (let c = 0; c < s.columnCount; c++) {
    const ids = s.columnIds(c);
    for (let r = 0; r < ids.length && r < s.visibleRows; r++) {
      const id = ids[r]; if (!s.interactable(id) || !s.leavesWhenEmptied(id)) continue;
      const chars = s.charactersOn(id); if (!chars || s.hasSealed(id)) continue;
      cands.push({ id, chars, chained: s.partnerOf(id) >= 0, r, c });
    }
  }
  cands.sort((a, b) => a.chars - b.chars || a.chained - b.chained || a.r - b.r || a.c - b.c);
  for (const cand of cands) {
    const trial = s.clone(), moves = []; let ok = true;
    for (let g = 0; ok && trial.exists(cand.id) && g < 8; g++) {
      const from = firstCharacter(trial, cand.id), to = bestDestination(trial, from);
      if (!to || trial.tryMove(from[0], from[1], to[0], to[1]).result === 'refused') ok = false; else moves.push([from[0], from[1], to[0], to[1]]);
    }
    if (ok && !trial.exists(cand.id)) return moves;
  }
  return null;
}
function firstCharacter(s, id) { for (let i = 0; i < s.slotCount(id); i++) { if (isEmpty(s.get(id, i))) continue; const l = s.pairLeft(id, i); return [id, l >= 0 ? l : i]; } return [-1, -1]; }
function bestDestination(s, [fid, fs]) {
  const kind = s.get(fid, fs), pair = s.pairLeft(fid, fs) >= 0; let best = null, score = -1; const seen = new Set();
  for (const [id] of s.visibleSlots()) {
    if (id === fid || seen.has(id)) continue; seen.add(id);
    const n = s.slotCount(id); let same = 0, target = -1;
    for (let i = 0; i < n; i++) if (s.get(id, i) === kind) same++;
    for (let i = 0; i < n && target < 0; i++) { if (!isEmpty(s.get(id, i))) continue; if (!pair) target = i; else if (i + 1 < n && isEmpty(s.get(id, i + 1))) target = i; }
    if (target >= 0 && same > score) { score = same; best = [id, target]; }
  }
  return best;
}

// ---- Rescue shuffle (spec 2026-10-06): re-deal every cubby still in play, whole, until a triple is ready ----
const movableSlot = (s, id, i) => !s.isSealed(id, i) && s.pairLeft(id, i) < 0;
export function planRescue(s, seed) { return rescueDeal(s, seed, false) || rescueDeal(s, seed, true); }
function rescueDeal(s, seed, mergedFirst) {
  const R = rng(seed), cols = s.columnCount, fixedAt = new Map(), used = new Set(), K = (c, r) => c * 10000 + r;
  for (let c = 0; c < cols; c++) { const ids = s.columnIds(c); let front = 0; ids.forEach((id, r) => { if (s.isBlocked(id)) { fixedAt.set(K(c, mergedFirst ? front++ : r), id); used.add(id); } }); }
  const pinned = new Map();
  for (const [k, id] of fixedAt) { const p = s.partnerOf(id); if (p >= 0 && s.exists(p) && !s.isBlocked(p)) pinned.set(p, Math.floor(k / 10000)); }
  const units = [];
  for (let c = 0; c < cols; c++) for (const id of s.columnIds(c)) {
    if (used.has(id)) continue; used.add(id);
    const p = s.partnerOf(id);
    if (p >= 0 && s.exists(p) && !used.has(p) && !s.isBlocked(p)) { units.push([id, p]); used.add(p); } else units.push([id]);
  }
  if (!units.length) return null;
  let best = null, bestReady = -1;
  for (let t = 0; t < 200; t++) {
    for (let i = units.length - 1; i > 0; i--) { const j = R.int(i + 1); [units[i], units[j]] = [units[j], units[i]]; }
    const deal = dealUnits(units, fixedAt, pinned, cols, R, K), trial = s.clone();
    trial.rearrange(deal); if (mergedFirst) releaseHeads(trial);
    if (!trial.anyCompletionReachable()) continue;
    if (anchorCheck(trial) === null && playout(trial.clone())) return deal;
    const ready = readyKinds(trial); if (ready > bestReady) { bestReady = ready; best = deal; }
  }
  return best;
}
function dealUnits(units, fixedAt, pinned, cols, R, K) {
  const at = new Map(fixedAt), count = new Array(cols).fill(0);
  for (const k of fixedAt.keys()) count[Math.floor(k / 10000)]++;
  const nextRow = c => { let r = 0; while (at.has(K(c, r))) r++; return r; };
  const put = (c, id) => { at.set(K(c, nextRow(c)), id); count[c]++; };
  const emptiest = ok => { let b = -1; for (let c = 0; c < cols; c++) if (ok(c) && (b < 0 || count[c] < count[b] || (count[c] === count[b] && R.int(2) === 0))) b = c; return b; };
  for (const u of units) { if (u.length !== 1 || !pinned.has(u[0])) continue; const held = pinned.get(u[0]); let c = emptiest(x => Math.abs(x - held) === 1); if (c < 0) c = emptiest(x => x !== held); put(c < 0 ? held : c, u[0]); }
  for (const u of units) {
    if (u.length !== 2) continue;
    let pick = -1; for (let c = 0; c + 1 < cols; c++) if (nextRow(c) === nextRow(c + 1) && (pick < 0 || count[c] + count[c + 1] < count[pick] + count[pick + 1])) pick = c;
    if (pick >= 0) { const row = nextRow(pick); at.set(K(pick, row), u[0]); at.set(K(pick + 1, row), u[1]); count[pick]++; count[pick + 1]++; continue; }
    let a = -1; for (let c = 0; c + 1 < cols; c++) if (a < 0 || count[c] + count[c + 1] < count[a] + count[a + 1]) a = c;
    if (a >= 0) { put(a, u[0]); put(a + 1, u[1]); } else { put(0, u[0]); put(0, u[1]); }
  }
  for (const u of units) { if (u.length !== 1 || pinned.has(u[0])) continue; put(emptiest(() => true), u[0]); }
  const out = [];
  for (let c = 0; c < cols; c++) out.push([...at].filter(([k]) => Math.floor(k / 10000) === c).sort((x, y) => x[0] - y[0]).map(x => x[1]));
  return out;
}
function releaseHeads(s) {
  for (let changed = true; changed;) {
    changed = false;
    for (let c = 0; c < s.columnCount && !changed; c++) {
      const ids = s.columnIds(c); if (!ids.length || !s.isBlocked(ids[0])) continue;
      const p = s.partnerOf(ids[0]);
      if (p >= 0 && s.exists(p)) { if (!s.isBlocked(p) || !s.isHead(p)) continue; s.removeShelf(p); }
      s.removeShelf(ids[0]); changed = true;
    }
  }
}
function readyKinds(s) {
  const counts = new Map(); for (const [id, i, k] of s.visibleSlots()) if (!isEmpty(k) && !s.isSealed(id, i)) counts.set(k, (counts.get(k) || 0) + 1);
  let ready = 0; for (const v of counts.values()) if (v >= 3) ready++;
  return s.anyCompletionReachable() ? ready + 1 : ready;
}
export function playout(s) {
  for (let step = 0; step < 400; step++) {
    for (let c = 0; c < s.columnCount; c++) for (const id of s.columnIds(c)) if (s.isBlocked(id)) s.removeShelf(id);
    if (s.characterCount() === 0) return true;
    if (completeOne(s, true) || completeOne(s, false)) continue;
    if (!digOne(s)) return false;
  }
  return false;
}
function completeOne(s, headsOnly) {
  const slots = [...s.visibleSlots()], shelfIds = [...new Set(slots.map(x => x[0]))];
  let bestShelf = -1, bestHave = -1, bestCol = 1e9, bestKind = EMPTY;
  for (const h of shelfIds) {
    if (headsOnly && !s.isHead(h)) continue;
    const col = s.locate(h)[0]; let foreignSealed = false, sealedKind = EMPTY; const kinds = new Map();
    for (const [id, i, k] of slots) { if (id !== h || isEmpty(k)) continue; if (s.isSealed(id, i)) { if (!isEmpty(sealedKind) && sealedKind !== k) foreignSealed = true; sealedKind = k; } }
    if (foreignSealed) continue;
    for (const [id, i, k] of slots) { if (isEmpty(k)) continue; if (id !== h && !movableSlot(s, id, i)) continue; kinds.set(k, (kinds.get(k) || 0) + 1); }
    for (const [k, v] of kinds) {
      if (v < 3 || (!isEmpty(sealedKind) && sealedKind !== k)) continue;
      const have = slots.filter(x => x[0] === h && x[2] === k).length;
      const better = have > bestHave || (have === bestHave && (colorOf(k) < colorOf(bestKind) || (colorOf(k) === colorOf(bestKind) && shapeOf(k) < shapeOf(bestKind)))) || (have === bestHave && k === bestKind && col < bestCol);
      if (better) { bestShelf = h; bestHave = have; bestKind = k; bestCol = col; }
    }
  }
  if (bestShelf < 0) return false;
  for (let g = 0; g < 8; g++) {
    if (!s.exists(bestShelf) || s.isBlocked(bestShelf)) return true;
    let empty = -1, foreign = -1;
    for (let i = 0; i < s.slotCount(bestShelf); i++) { const k = s.get(bestShelf, i); if (isEmpty(k)) { if (empty < 0) empty = i; } else if (k !== bestKind && movableSlot(s, bestShelf, i) && foreign < 0) foreign = i; }
    let src = null, free = null;
    for (const [id, i, k] of s.visibleSlots()) { if (id === bestShelf) continue; if (!src && k === bestKind && movableSlot(s, id, i)) src = [id, i]; if (!free && isEmpty(k)) free = [id, i]; }
    if (!src) return false;
    if (empty >= 0) { if (s.tryMove(src[0], src[1], bestShelf, empty).result === 'refused') return false; continue; }
    if (foreign < 0) return false;
    const r = free ? s.tryMove(bestShelf, foreign, free[0], free[1]).result : s.trySwap(src[0], src[1], bestShelf, foreign).result;
    if (r === 'refused') return false;
  }
  return !s.exists(bestShelf) || s.isBlocked(bestShelf);
}
function digOne(s) {
  for (let c = 0; c < s.columnCount; c++) {
    if (!s.hasHidden(c)) continue;
    for (const id of s.columnIds(c)) {
      if (!s.isVisible(id) || s.isBlocked(id)) continue;
      let ok = true; for (let i = 0; i < s.slotCount(id); i++) if (!isEmpty(s.get(id, i)) && !movableSlot(s, id, i)) ok = false;
      let freeElse = 0; for (const [sid, , k] of s.visibleSlots()) if (sid !== id && isEmpty(k)) freeElse++;
      if (!ok || s.charactersOn(id) > freeElse) continue;
      for (let i = 0; s.exists(id) && i < s.slotCount(id); i++) {
        if (isEmpty(s.get(id, i))) continue;
        for (const [sid, si, k] of [...s.visibleSlots()]) { if (sid === id || !isEmpty(k)) continue; if (s.tryMove(id, i, sid, si).result !== 'refused') break; }
      }
      return !s.exists(id);
    }
  }
  return false;
}
// Spec 2026-10-06 never-dry §2: every hidden cubby brings up a triple whatever the order; a triple is ready; columns can be dug.
export function anchorCheck(s) {
  const onScreen = new Map(), holding = new Set(), sealedIn = new Map(), sealedKindsIn = new Map(), hiddenCols = new Map();
  for (let c = 0; c < s.columnCount; c++) for (const id of s.columnIds(c)) {
    const vis = s.isVisible(id);
    for (let i = 0; i < s.slotCount(id); i++) {
      const k = s.get(id, i); if (isEmpty(k)) continue;
      if (s.pairLeft(id, i) >= 0) holding.add(k);
      if (s.isSealed(id, i)) { (sealedIn.get(k) || sealedIn.set(k, new Set()).get(k)).add(id); (sealedKindsIn.get(id) || sealedKindsIn.set(id, new Set()).get(id)).add(k); }
      if (vis) onScreen.set(k, (onScreen.get(k) || 0) + 1); else (hiddenCols.get(k) || hiddenCols.set(k, new Set()).get(k)).add(c);
    }
  }
  const fixedKind = k => { if (holding.has(k)) return true; const at = sealedIn.get(k); if (!at) return false; if (at.size > 1) return true; for (const sh of at) if (sealedKindsIn.get(sh).size > 1) return true; return false; };
  if (!s.anyCompletionReachable()) return 'no triple ready';
  for (let c = 0; c < s.columnCount; c++) { if (!s.hasHidden(c)) continue; if (!s.columnIds(c).some(id => s.isVisible(id) && !s.isBlocked(id) && !s.hasSealed(id))) return `column ${c} cannot be dug`; }
  for (let c = 0; c < s.columnCount; c++) {
    const ids = s.columnIds(c), ahead = new Map();
    for (let r = 0; r < ids.length; r++) {
      if (s.isVisible(ids[r])) continue;
      const here = new Map(); for (let i = 0; i < s.slotCount(ids[r]); i++) { const k = s.get(ids[r], i); if (!isEmpty(k)) here.set(k, (here.get(k) || 0) + 1); }
      let anchored = false;
      for (const [k, v] of here) { if (fixedKind(k) || hiddenCols.get(k).size > 1) continue; if (((onScreen.get(k) || 0) + (ahead.get(k) || 0)) % 3 + v >= 3) { anchored = true; break; } }
      if (!anchored) return `column ${c} shelf ${r} not anchored`;
      for (const [k, v] of here) ahead.set(k, (ahead.get(k) || 0) + v);
    }
  }
  return null;
}

// =====================================================================================================================
// Players. The bot replays the level's certified witness (the shipped QA autoplay does the same, with the auto-dig held);
// once the board leaves the witness (a visitor played, or the game repaired the board) it plays like the shipped
// "natural" simulated player: head cubbies first, the merge needing the fewest characters, exposed colours first.
// =====================================================================================================================
export function macroCandidates(g) {
  const sh = g.shelves, slots = [...sh.visibleSlots()], free = slots.filter(x => isEmpty(x[2])).length;
  const counts = new Map(), ids = [];
  for (const [id, , k] of slots) { if (!ids.includes(id)) ids.push(id); if (!isEmpty(k)) counts.set(k, (counts.get(k) || 0) + 1); }
  const scored = [];
  for (const [k, v] of counts) {
    if (v < 3) continue;
    const exposed = g.voxels.exposedCount(colorOf(k)) > 0 ? 100 : 0;
    for (const id of ids) {
      let foreign = false; for (let i = 0; i < sh.slotCount(id); i++) if (sh.isSealed(id, i) && sh.get(id, i) !== k) foreign = true;
      if (foreign) continue;
      let have = 0, empty = 0, movable = 0;
      for (const [sid, si, sk] of slots) { if (sid !== id) { if (sk === k && !sh.isSealed(sid, si)) movable++; continue; } if (sk === k) have++; else if (isEmpty(sk)) empty++; }
      if (have + movable < 3) continue;
      scored.push({ a: { kind: 'complete', shelf: id, ch: k }, score: 600 + (sh.isHead(id) ? 400 : 0) + exposed + have * 10 + empty });
    }
  }
  if (free >= 3) for (let c = 0; c < sh.columnCount; c++) for (const id of sh.columnIds(c)) {
    if (!sh.leavesWhenEmptied(id) || !sh.interactable(id) || sh.hasSealed(id)) continue;
    const n = sh.charactersOn(id); if (n > 0) scored.push({ a: { kind: 'empty', shelf: id, ch: EMPTY }, score: 500 - n });
  }
  scored.sort((x, y) => y.score - x.score || x.a.shelf - y.a.shelf || x.a.ch - y.a.ch);
  return scored.map(x => x.a).filter(a => macroStep(g, a));
}
// The next concrete move toward an intention: { from, to, swap } or null (done or stuck).
export function macroStep(g, a) {
  const sh = g.shelves; if (!sh.exists(a.shelf) || sh.isBlocked(a.shelf)) return null;
  const slots = [...sh.visibleSlots()], n = sh.slotCount(a.shelf);
  if (a.kind === 'empty') {
    for (let i = 0; i < n; i++) {
      if (isEmpty(sh.get(a.shelf, i))) continue; if (sh.isSealed(a.shelf, i)) return null;
      const l = sh.pairLeft(a.shelf, i), from = [a.shelf, l >= 0 ? l : i], to = destination(g, slots, from, a.shelf);
      return to ? { from, to, swap: false } : null;
    }
    return null;
  }
  let emptyIn = -1, foreignIn = -1;
  for (let i = 0; i < n; i++) { const k = sh.get(a.shelf, i); if (isEmpty(k)) { if (emptyIn < 0) emptyIn = i; } else if (k !== a.ch && foreignIn < 0) foreignIn = i; }
  if (emptyIn >= 0) for (const [sid, si, k] of slots) {
    if (sid === a.shelf || k !== a.ch || sh.isSealed(sid, si)) continue;
    const l = sh.pairLeft(sid, si);
    if (l >= 0) { for (let i = 0; i + 1 < n; i++) if (isEmpty(sh.get(a.shelf, i)) && isEmpty(sh.get(a.shelf, i + 1))) return { from: [sid, l], to: [a.shelf, i], swap: false }; continue; }
    return { from: [sid, si], to: [a.shelf, emptyIn], swap: false };
  }
  if (foreignIn >= 0) {
    if (!sh.isSealed(a.shelf, foreignIn)) { const l = sh.pairLeft(a.shelf, foreignIn), from = [a.shelf, l >= 0 ? l : foreignIn], to = destination(g, slots, from, a.shelf); if (to) return { from, to, swap: false }; }
  }
  // no free slot to work with: swap a copy in for a character that does not belong (owner 2026-10-05)
  let foreign = -1;
  for (let i = 0; i < n && foreign < 0; i++) { const k = sh.get(a.shelf, i); if (!isEmpty(k) && k !== a.ch && !sh.isSealed(a.shelf, i) && sh.pairLeft(a.shelf, i) < 0) foreign = i; }
  if (foreign < 0) return null;
  for (const [sid, si, k] of slots) { if (sid === a.shelf || k !== a.ch || sh.isSealed(sid, si) || sh.pairLeft(sid, si) >= 0) continue; return { from: [sid, si], to: [a.shelf, foreign], swap: true }; }
  return null;
}
function destination(g, slots, from, notShelf) {
  const sh = g.shelves, pair = sh.pairLeft(from[0], from[1]) >= 0, k = sh.get(from[0], from[1]), map = new Map();
  for (const [id, i, kk] of slots) { if (!map.has(id)) map.set(id, new Array(sh.slotCount(id))); map.get(id)[i] = kk; }
  let best = -1, to = null;
  for (const [id, arr] of map) {
    if (id === notShelf || id === from[0]) continue;
    const same = arr.filter(x => !isEmpty(x) && x === k).length;
    for (let i = 0; i < arr.length; i++) { const fits = pair ? i + 1 < arr.length && isEmpty(arr[i]) && isEmpty(arr[i + 1]) : isEmpty(arr[i]); if (!fits) continue; const sc = 1 + same * 10; if (sc > best) { best = sc; to = [id, i]; } }
  }
  return to;
}
function chooseNatural(g, options, R) {
  const comps = options.filter(o => o.kind === 'complete'); if (!comps.length) return options[0];
  const heads = comps.filter(o => g.shelves.isHead(o.shelf)), pool = heads.length ? heads : comps;
  const have = o => { let n = 0; for (let i = 0; i < g.shelves.slotCount(o.shelf); i++) if (g.shelves.get(o.shelf, i) === o.ch) n++; return n; };
  const exposed = o => g.voxels.exposedCount(colorOf(o.ch)) > 0;
  const useful = pool.filter(o => have(o) > 0);
  if (!useful.length) { const ex = pool.filter(exposed), any = ex.length ? ex : pool; return any[R.int(any.length)]; }
  const ex = useful.filter(exposed), choice = ex.length ? ex : useful, most = Math.max(...choice.map(have)), best = choice.filter(o => have(o) === most);
  return best[R.int(best.length)];
}
export class Bot {
  constructor(g) { this.g = g; this.k = 0; this.onTrack = !!g.level.witness?.length; this.plan = null; this.R = rng(g.seed + 17); this.moveCount = g.moves; this.repairs = 0; }
  // The game moved on without the bot (a visitor's move, an auto-dig or a re-deal): the witness no longer applies.
  sync() {
    const g = this.g;
    if (g.moves !== this.moveCount || g.autoDigs + g.rescues !== this.repairs) this.onTrack = false;
    this.moveCount = g.moves; this.repairs = g.autoDigs + g.rescues;
  }
  // The bot's next action: { from:[shelf,slot], to:[shelf,slot], swap } or null (nothing to do right now).
  next() {
    const g = this.g; this.sync(); if (g.over) return null;
    if (this.onTrack) {
      const w = g.level.witness[this.k];
      if (!w) this.onTrack = false;
      else {
        const r = g.shelves.readiness(w[0], w[2]);
        if (r === 'wait') return null;
        if (r === 'ready') return { from: [w[0], w[1]], to: [w[2], w[3]], swap: !!w[4], witness: true };
        this.onTrack = false;
      }
    }
    for (let tries = 0; tries < 3; tries++) {
      if (this.plan) { const st = macroStep(g, this.plan); if (st) return st; this.plan = null; }
      const opts = macroCandidates(g); if (!opts.length) return null;
      this.plan = chooseNatural(g, opts, this.R);
    }
    return null;
  }
  // Apply a step returned by next() (the browser applies it through the pointer instead, then calls sync()).
  play(st) {
    const g = this.g, r = st.swap ? g.swap(st.from[0], st.from[1], st.to[0], st.to[1]) : g.move(st.from[0], st.from[1], st.to[0], st.to[1]);
    if (st.witness && r !== 'refused') this.k++;
    if (r === 'refused' && st.witness) this.onTrack = false;
    this.moveCount = g.moves; this.repairs = g.autoDigs + g.rescues;
    return r;
  }
  // A visitor's move that happens to be the witness's next step keeps the bot on its certified line.
  noteMove(from, to, swap) {
    const w = this.onTrack && this.g.level.witness[this.k];
    if (w && w[0] === from[0] && w[1] === from[1] && w[2] === to[0] && w[3] === to[1] && !!w[4] === !!swap) { this.k++; this.moveCount = this.g.moves; }
  }
  // While the bot replays the witness the game must not dig for it (Unity holds the auto-dig during QA autoplay).
  get holdsAutoDig() { return this.onTrack; }
}

// =====================================================================================================================
// Attract-mode pacing, shared by the browser and the pacing test so the test measures what ships. Each bot move is
// announced (the ghost hand flies in, presses and drags) and lands BOT_CARRY seconds later; BOT_GAP seconds of quiet
// separate one landing from the next announcement. Nothing starts while a merge waits for a dock spot (a column may
// shift under the hand).
// =====================================================================================================================
export const BOT_GAP = 0.15, BOT_CARRY = 0.8;
export class Pilot {
  constructor(g, bot) { this.g = g; this.bot = bot; this.since = 0; this.carry = null; this.key = null; this.step = null; }
  // The bot's next move for this board (cached, so the hand's pre-aim and the move it then plays are the same one).
  plan() {
    const g = this.g, key = `${g.moves}|${g.autoDigs}|${g.rescues}|${g.shooting.pending.length}|${g.shelves.key()}`;
    if (key !== this.key) { this.key = key; this.step = g.over ? null : this.bot.next(); }
    return this.step;
  }
  // One tick of attract play: { start } when a move should be announced, { land } when the carried move lands.
  tick(busy) {
    this.since += TICK;
    if (this.carry) {
      this.carry.t += TICK;
      if (this.carry.t + 1e-9 < BOT_CARRY) return null;
      const st = this.carry.st; this.carry = null; this.since = 0; return { land: st };
    }
    if (this.g.over || busy || this.since < BOT_GAP) return null;
    const st = this.plan(); if (!st) return null;
    this.carry = { st, t: 0 }; return { start: st };
  }
  cancel() { this.carry = null; this.since = 0; }
  // The move is still the bot's plan for the board as it is now (the board can change under a carried toy).
  stillValid(st) { this.key = null; const now = this.plan(); return !!now && now.from[0] === st.from[0] && now.from[1] === st.from[1] && now.to[0] === st.to[0] && now.to[1] === st.to[1] && !!now.swap === !!st.swap; }
}
// The shipped EndSpeedUp (ShooterConfig 2x): every character has merged and only shooting is left.
export const END_SPEEDUP = 2;
export const endPhase = g => !g.over && g.waiting.length === 0 && g.shelves.characterCount() === 0;
