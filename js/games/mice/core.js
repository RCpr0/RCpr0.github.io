// Mice Flow, playable in the browser. Rules ported from the shipped C#: BoxGridRules (a house moves only with an
// empty path to the top row), GridSystem (blocks are exposed by a 4-way flood fill from the picture's rim; each colour's
// mice take the first exposed block in spawn order), AntBox (one mouse per 0.75 s while its colour is exposed; an
// emptied house frees its tray slot) and LevelFlow (win when the picture is gone and no mouse is out).
export const TRAY = 5, SPAWN = 0.75, SPEED = 10, PICKUP = 0.36;

export class MiceGame {
  constructor(level) {
    this.level = level; this.w = level.w; this.h = level.h; this.rows = level.rows; this.cols = level.cols;
    this.grid = Array.from({ length: this.w * this.h }, () => null);
    this.blocks = level.cells.map(([x, y, color], order) => { const b = { x, y, color, order, gone: false, reserved: false }; this.grid[y * this.w + x] = b; return b; });
    this.houses = level.boxes.map(([row, col, color, value, mech]) => ({ row, col, color, value, wall: mech === 4, slot: -1, timer: 0, done: false }));
    this.tray = Array(TRAY).fill(null); this.mice = []; this.time = 0; this.result = null; this.events = []; this.lastTap = -9;
    this.flood();
  }
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

  // House grid: row 0 opens onto the tray. Distances from empty top-row cells through empty cells.
  occupied(r, c) { return this.houses.some(h => h.row === r && h.col === c && h.slot < 0 && !h.done); }
  movable(h) {
    if (h.wall || h.slot >= 0 || h.done) return false;
    if (h.row === 0) return true;
    const seen = new Set(), q = [];
    for (let c = 0; c < this.cols; c++) if (!this.occupied(0, c)) { seen.add(c); q.push([0, c]); }
    while (q.length) { const [r, c] = q.shift(); for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nr = r + dr, nc = c + dc; if (nr < 0 || nc < 0 || nr >= this.rows || nc >= this.cols || seen.has(nr * 64 + nc) || this.occupied(nr, nc)) continue; seen.add(nr * 64 + nc); q.push([nr, nc]); } }
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dr, dc]) => seen.has((h.row + dr) * 64 + (h.col + dc)) && h.row + dr >= 0 && h.col + dc >= 0 && h.col + dc < this.cols && h.row + dr < this.rows);
  }
  parked() { return this.tray.filter(Boolean); }
  tap(h) {
    if (this.over || !this.movable(h)) return { ok: false, why: 'blocked' };
    const s = this.tray.indexOf(null); if (s < 0) return { ok: false, why: 'tray full' };
    this.tray[s] = h; h.slot = s; h.timer = 0; this.lastTap = this.time;
    this.events.push({ type: 'park', house: h, slot: s });
    return { ok: true, slot: s };
  }

  // Positions in picture units: picture x 0..w, y 0..h (y up); the tray sits below it.
  slotPos(s) { return [this.w / 2 + (s - (TRAY - 1) / 2) * 2.4, -3]; }
  step(dt) {
    if (this.over) return;
    this.time += dt;
    for (const h of this.parked()) {
      if (h.value <= 0) continue;
      const b = this.outermost(h.color); if (!b) continue;
      h.timer -= dt; if (h.timer > 0) continue;
      h.timer = SPAWN; h.value--; b.reserved = true;
      const [sx, sy] = this.slotPos(h.slot), d = Math.hypot(b.x + 0.5 - sx, b.y + 0.5 - sy);
      const m = { house: h, block: b, from: [sx, sy], t0: this.time, out: d / SPEED, back: d / SPEED, picked: false, home: false };
      this.mice.push(m); this.events.push({ type: 'spawn', mouse: m });
      if (h.value <= 0) { this.tray[h.slot] = null; h.done = true; this.events.push({ type: 'empty', house: h }); }
    }
    for (const m of this.mice) {
      const t = this.time - m.t0;
      if (!m.picked && t >= m.out + PICKUP) { m.picked = true; m.block.gone = true; this.grid[m.block.y * this.w + m.block.x] = null; this.flood(); this.events.push({ type: 'pick', mouse: m }); }
      if (m.picked && t >= m.out + PICKUP + m.back) { m.home = true; this.events.push({ type: 'home', mouse: m }); }
    }
    this.mice = this.mice.filter(m => !m.home);
    if (this.blocks.every(b => b.gone) && !this.mice.length) { this.result = 'win'; return; }
    if (this.tray.every(Boolean) && !this.mice.length && !this.parked().some(h => h.value > 0 && this.outermost(h.color))) this.result = 'lose';
  }

  // Bot for attract mode and tests: park a movable house whose colour is exposed now; prefer bigger houses.
  botChoice() {
    if (this.tray.indexOf(null) < 0) return null;
    const exposedColors = new Set(this.blocks.filter(b => !b.gone && !b.reserved && this.exposed(b)).map(b => b.color));
    const parkedColors = new Set(this.parked().map(h => h.color));
    const cand = this.houses.filter(h => this.movable(h));
    const score = h => (exposedColors.has(h.color) ? 100 : 0) - (parkedColors.has(h.color) ? 50 : 0) + h.value / 100 - h.row;
    cand.sort((a, b) => score(b) - score(a));
    const best = cand[0]; if (!best) return null;
    if (!exposedColors.has(best.color) && this.tray.filter(Boolean).length >= TRAY - 1) return null; // don't fill the last slot with a dud
    return best;
  }
  autoTap() { if (this.over || this.time - this.lastTap < 0.6) return; const h = this.botChoice(); if (h) this.tap(h); }
}
