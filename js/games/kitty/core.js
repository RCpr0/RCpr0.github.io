// KittyDoku game wrapper around the level workbench's own rules (rules.js): place, confirm, lives, hints, and the
// cells a confirmed cat books (BoardState.RecomputeMarks in the shipped game: the beam, the eight neighbours and the
// region of every cat that is on the board and not wrong). Booked cells show a paw and refuse a cat (CanPlace), at no
// cost; the shipped game never shows crosses on its own (they were a player-toggled note, not used here).
// Also here, so the node tests see exactly what the browser runs: the rule cards each level shows (the shipped
// RulesConfig and MechanicConfig text), which rule a drop broke (BoardState.EvaluateViolations, plus the dog and the
// mouse the shipped Board reacts to), and the attract bot's plan and pacing.
import { candidateDirs, createState, placeCell, eraseCell, isSolved, isConfirmed, isLocked, pickHint, hintDir, trace, neighbours8, STARTING_LIVES } from './rules.js';

// Shipped levels, one mechanic each, in the order the shipped game unlocks them (MechanicConfig.UnlockLevel):
// the three base rules, the mouse, the grass, the puddle, the dog, then a board with all of them.
export const LEVELS = [3, 6, 19, 25, 29, 41];

// Rule cards. Text is the shipped English: RulesConfig for the base rules, MechanicConfig names and descriptions for
// the mechanics. `label` is the short name on the docked chip; `icon` the chip art, `art` the card picture.
export const RULES = {
  colour: { label: 'One per colour', title: 'Colours', text: 'Every color holds exactly one cat', icon: 'rule-colour.webp', art: 'rule-colour.webp' },
  touch: { label: 'No touching', title: 'Personal space', text: "Cats can't sit next to each other", icon: 'rule-touch.webp', art: 'rule-touch.webp' },
  sight: { label: 'No staring', title: 'Line of sight', text: 'No cat may see another cat in its direction', icon: 'rule-sight.webp', art: 'rule-sight.webp' },
  mouse: { label: 'Mouse', title: 'Mouse', text: 'Make sure no cat looks at the mouse, or it will run off and start chasing it', icon: 'icon-mouse.webp', art: 'scene-mouse.webp' },
  grass: { label: 'Grass', title: 'Grass', text: "Grass blocks a cat's vision, allowing you to place more cats in another cat's direction", icon: 'icon-grass.webp', art: 'scene-grass.webp' },
  puddle: { label: 'Puddle', title: 'Puddle', text: "You can't place cats in puddles! However, cats can see through them", icon: 'icon-puddle.webp', art: 'scene-puddle.webp' },
  dog: { label: 'Dog', title: 'Dog', text: "Make sure you don't place a cat where the dog is looking, or the cat will get scared and run off", icon: 'icon-dog.webp', art: 'scene-dog.webp' },
};
export const BASE = ['colour', 'touch', 'sight'];
const PIECE = { mouse: 'mouse', wall: 'grass', puddle: 'puddle', dog: 'dog' }; // LevelMechanics.Find

// The cards a level shows: the base rules, then each mechanic on its board (shipped order), each flagged NEW on the
// first level of this run that has it. Once taught, the three base rules dock as one chip ('basics').
export function levelRules(levels, k) {
  const has = L => { const kinds = new Set(L.puzzle.board.cells.map(c => c.kind)); return Object.keys(PIECE).filter(p => kinds.has(p)).map(p => PIECE[p]); };
  const seen = new Set(); for (let j = 0; j < k; j++) for (const r of [...BASE, ...has(levels[j])]) seen.add(r);
  const ids = [...BASE, ...has(levels[k])];
  return ids.map(id => ({ id, ...RULES[id], base: BASE.includes(id), fresh: !seen.has(id) }));
}

// Attract-bot pacing (seconds at 1x). The bot waits for the cards to deal in, then for each cat: thinks, lifts the cat
// (with the ghost hand pressing), carries it over and lets the board settle. Think time stretches small boards so
// every level runs about 20-60 s.
export const PACE = { boardIn: 0.9, card: 1.9, cardOld: 0.12, lift: 0.35, fly: 0.5, settle: 0.6, refusedBack: 0.5, wrongBack: 2.3, scareBack: 1.8, chaseBack: 2.8, target: 27 };
export function introTime(rules) { const fresh = rules.filter(r => r.fresh).length; return PACE.boardIn + fresh * PACE.card + (rules.length - fresh) * PACE.cardOld; }
export function thinkTime(n, intro, extra = 0) { return Math.min(5, Math.max(0.9, (PACE.target - intro - extra) / n - (PACE.lift + PACE.fly + PACE.settle))); }

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
  confirmedCount() { return this.state.confirmed.size; }
  // BoardState.CanPlace: a playable, empty, unbooked cell and a facing its region allows.
  canPlace(i, dir) {
    const c = this.board.cells[i];
    return !this.over && !!c && c.kind === 'play' && !this.state.placements.has(i) && !this.ruledOut().has(i) && (!dir || candidateDirs(this.puzzle, i).includes(dir));
  }
  // The dog whose line of sight covers cell i (a cat dropped there is wrong and gets scared off), or -1.
  watchedBy(i) {
    return this.board.cells.findIndex((c, k) => c.kind === 'dog' && trace(this.board, k, c.dir, new Set()).cells.has(i));
  }
  // The mouse a cat at i facing dir would look at (its gaze runs into the mouse), or -1 (Board.TryFindReflectorInBeam).
  mouseInSight(i, dir) {
    const cats = new Set(this.state.confirmed); cats.add(i);
    const { w, h, cells } = this.board, V = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] }[dir];
    let x = i % w + V[0], y = Math.floor(i / w) + V[1];
    for (; x >= 0 && y >= 0 && x < w && y < h; x += V[0], y += V[1]) {
      const k = y * w + x, c = cells[k];
      if (c.kind === 'mouse') return k;
      if (c.kind === 'wall' || c.kind === 'dog' || c.kind === 'leashDog' || cats.has(k)) return -1;
    }
    return -1;
  }
  // Why a drop of a cat facing `dir` on cell i breaks a rule, as the card to flash: 'dog', 'mouse', 'touch', 'sight',
  // 'colour', 'puddle', or null when the cat is wrong only because the answer lies elsewhere (no rule card flashes).
  // Booked cells answer with the rule that booked them.
  why(i, dir) {
    const c = this.board.cells[i]; if (!c) return null;
    if (c.kind === 'puddle') return 'puddle';
    if (c.kind !== 'play') return null;
    const conf = [...this.state.confirmed].filter(k => k !== i);
    if (dir && this.watchedBy(i) >= 0) return 'dog';
    if (dir && this.mouseInSight(i, dir) >= 0) return 'mouse';
    if (neighbours8(this.board, i).some(k => conf.includes(k))) return 'touch';
    const cats = new Set([...conf, i]);
    if (dir) { const t = trace(this.board, i, dir, cats); if (t.terminus === 'CAT' && t.at !== i) return 'sight'; }
    if (conf.some(k => trace(this.board, k, this.state.placements.get(k), cats).cells.has(i))) return 'sight';
    if (conf.some(k => this.board.cells[k].region === c.region)) return 'colour';
    return null;
  }
  // Place a cat facing `dir`. Right: it stays, confirmed. Wrong: a life is lost and the cat goes back to the tray.
  // A booked or occupied cell refuses the cat outright (no life lost), as the shipped CanPlace does.
  place(i, dir) {
    if (this.over) return { ok: false };
    const rule = this.why(i, dir);
    if (this.ruledOut().has(i)) return { ok: false, booked: true, rule };
    if (this.state.placements.has(i) && isConfirmed(this.state, i)) return { ok: false };
    if (!placeCell(this.state, i, dir)) return { ok: false, rule: rule === 'puddle' ? rule : null };
    const correct = isConfirmed(this.state, i);
    if (!correct) { if (this.state.failed) this.state.placements.delete(i); else eraseCell(this.state, i); }
    if (this.state.failed) this.result = 'lose';
    else if (isSolved(this.puzzle, this.state.placements)) this.result = 'win';
    return { ok: true, correct, rule: correct ? null : rule };
  }
  hint() {
    const r = pickHint(this.puzzle, this.state.placements, this.state.confirmed);
    return r ? { cell: r.cell, dir: hintDir(this.state, r.cell, r.dir) } : null;
  }
  // Booked cells: next to a confirmed cat, in its region, or in its line of sight (and not holding a cat).
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
  // The attract bot's one deliberate slip on a level, to show what the level's new rule does: a drop the new rule
  // refuses or punishes. null when the rule has no slip worth showing (the grass only ever helps).
  demoMove(rule) {
    const cells = this.board.cells, sol = new Set(this.puzzle.solution.positions), dirs = this.puzzle.facings;
    const play = cells.map((c, k) => k).filter(k => cells[k].kind === 'play' && !this.state.placements.has(k));
    if (rule === 'puddle') { const k = cells.findIndex(c => c.kind === 'puddle'); return k >= 0 ? { cell: k, dir: dirs[0], slip: 'puddle' } : null; }
    if (rule === 'touch') {
      const booked = this.ruledOut();
      for (const k of play) if (booked.has(k) && this.why(k, dirs[0]) === 'touch') return { cell: k, dir: dirs[0], slip: 'touch' };
      return null;
    }
    if (rule === 'mouse' || rule === 'dog') {
      for (const k of play) for (const d of dirs) {
        if (!this.canPlace(k, d) || (sol.has(k) && this.puzzle.solution.facings[k] === d)) continue;
        if (this.why(k, d) === rule) return { cell: k, dir: d, slip: rule };
      }
    }
    return null;
  }
}
export { STARTING_LIVES };

// The bot's slip per new rule, and what it costs in time on top of a right cat.
export const DEMO = { touch: 'refusedBack', puddle: 'refusedBack', mouse: 'chaseBack', dog: 'scareBack' };
export function demoRule(rules) { const r = rules.find(r => r.fresh && DEMO[r.id]); return r ? r.id : null; }
// Simulated attract run of level k, in seconds at 1x: the deal-in, every cat, and the slip. Mirrors game.js's bot.
export function botSchedule(levels, k) {
  const L = levels[k], rules = levelRules(levels, k), g = new KittyGame(L), intro = introTime(rules), demo = demoRule(rules);
  const extra = demo ? PACE[DEMO[demo]] + PACE.lift + PACE.fly : 0, n = L.puzzle.solution.positions.length - L.puzzle.locked.length;
  const think = thinkTime(n, intro, extra);
  let t = intro, moves = 0, slipped = !demo;
  for (let mv = g.botMove(); mv && !g.over; mv = g.botMove()) {
    if (!slipped && moves === 1) {
      slipped = true; const d = g.demoMove(demo);
      if (d) { const r = g.place(d.cell, d.dir); if (r.ok && r.correct) throw new Error('demo slip was a right cat'); t += think + PACE.lift + PACE.fly + PACE[DEMO[demo]]; }
    }
    const r = g.place(mv.cell, mv.dir); if (!r.correct) throw new Error('bot move was wrong');
    t += (moves ? think : 0) + PACE.lift + PACE.fly + PACE.settle; moves++; // the first cat is lifted during the deal-in
  }
  return { time: t, think, intro, result: g.result, lives: g.lives, demo };
}
