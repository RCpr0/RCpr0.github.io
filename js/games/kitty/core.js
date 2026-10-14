// KittyDoku game wrapper around the level workbench's own rules (rules.js): place, confirm, lives, hints, and the
// cells a confirmed cat rules out (shown as crosses, as the shipped game does).
import { createState, placeCell, eraseCell, isSolved, isConfirmed, isLocked, applyHint, pickHint, hintDir, trace, neighbours8, STARTING_LIVES } from './rules.js';

export const LEVELS = [3, 8, 19, 29, 43];

export class KittyGame {
  constructor(level) {
    this.level = level; this.puzzle = level.puzzle; this.board = level.puzzle.board;
    this.state = createState(this.puzzle); this.result = null;
  }
  get lives() { return this.state.lives; }
  get over() { return this.result !== null; }
  isGiven(i) { return isLocked(this.state, i); }
  catAt(i) { return this.state.placements.has(i) ? this.state.placements.get(i) : null; }
  cats() { return [...this.state.placements].map(([i, dir]) => ({ i, dir, confirmed: isConfirmed(this.state, i), given: isLocked(this.state, i) })); }
  // Place a cat facing `dir`. Right: it stays, confirmed. Wrong: a life is lost and the cat goes back to the tray.
  place(i, dir) {
    if (this.over) return { ok: false };
    if (this.state.placements.has(i) && isConfirmed(this.state, i)) return { ok: false };
    if (!placeCell(this.state, i, dir)) return { ok: false };
    const correct = isConfirmed(this.state, i);
    if (!correct) { if (this.state.failed) this.state.placements.delete(i); else eraseCell(this.state, i); }
    if (this.state.failed) this.result = 'lose';
    else if (isSolved(this.puzzle, this.state.placements)) this.result = 'win';
    return { ok: true, correct };
  }
  hint() {
    const r = pickHint(this.puzzle, this.state.placements, this.state.confirmed);
    return r ? { cell: r.cell, dir: hintDir(this.state, r.cell, r.dir) } : null;
  }
  // Cells no cat can go: next to a confirmed cat, in its region, or in its line of sight.
  ruledOut() {
    const out = new Set(), conf = this.cats().filter(c => c.confirmed), cats = new Set(conf.map(c => c.i));
    for (const c of conf) {
      for (const j of neighbours8(this.board, c.i)) out.add(j);
      const region = this.board.cells[c.i].region;
      this.board.cells.forEach((cell, k) => { if (cell.kind === 'play' && cell.region === region) out.add(k); });
      for (const k of trace(this.board, c.i, c.dir, cats).cells) out.add(k);
    }
    for (const c of conf) out.delete(c.i);
    return new Set([...out].filter(k => this.board.cells[k].kind === 'play' && !this.state.placements.has(k)));
  }
  gaze(i) { const d = this.catAt(i); return d ? trace(this.board, i, d, new Set(this.state.placements.keys())) : null; }
  // Bot for attract mode and tests: the next cat of the shipped answer, with its facing.
  botMove() {
    const s = this.puzzle.solution;
    for (const i of s.positions) if (!this.state.placements.has(i)) return { cell: i, dir: s.facings[i] };
    return null;
  }
}
export { STARTING_LIVES };
