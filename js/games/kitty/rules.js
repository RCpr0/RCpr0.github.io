// KittyDoku rules, solver and play state: the level workbench's own code (geometry, board, rules, solver, state),
// unchanged apart from being joined into one module with exports at the end.

// ---- geometry.js ----
'use strict';

// Screen coordinates: dx rightward, dy DOWNWARD. North is [0,-1].
// `var`, not `const`: these must become globals so sibling files and
// test/load.js can see them.
var DIRS = {
  N:  [ 0, -1], NE: [ 1, -1], E:  [ 1,  0], SE: [ 1,  1],
  S:  [ 0,  1], SW: [-1,  1], W:  [-1,  0], NW: [-1, -1],
};

var DIR_NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

var ARROWS = {
  N: '↑', NE: '↗', E: '→', SE: '↘',
  S: '↓', SW: '↙', W: '←', NW: '↖',
};

// Mirror axes: V is '|', H is '-', B is '\', F is '/'.
var AXES = ['V', 'H', 'B', 'F'];

function vecName(dx, dy) {
  for (const d of DIR_NAMES) {
    if (DIRS[d][0] === dx && DIRS[d][1] === dy) return d;
  }
  return null;
}

// Reflect a direction across a mirror's axis. Every case is an involution,
// which is what lets a mouse send a beam home along its own path.
function reflect(dir, axis) {
  const [dx, dy] = DIRS[dir];
  switch (axis) {
    case 'V': return vecName(-dx,  dy);
    case 'H': return vecName( dx, -dy);
    case 'B': return vecName( dy,  dx);
    case 'F': return vecName(-dy, -dx);
    default: throw new Error('unknown mirror axis: ' + axis);
  }
}

function opposite(dir) {
  const [dx, dy] = DIRS[dir];
  return vecName(-dx, -dy);
}

var TERMINUS = { EDGE: 'EDGE', WALL: 'WALL', LOOP: 'LOOP', CAT: 'CAT' };

// Walk a beam from `origin` heading `dir`. Returns the playable cells it covers
// and why it stopped. The single source of truth for beam coverage: the solver,
// the validator and the renderer all call this and never re-derive it.
function trace(board, origin, dir, cats, blockers) {
  const w = board.w;
  const h = board.h;
  let x = origin % w;
  let y = Math.floor(origin / w);
  let d = dir;
  const cells = new Set();
  const seen = new Set();

  for (;;) {
    const [dx, dy] = DIRS[d];
    x += dx; y += dy;
    if (x < 0 || y < 0 || x >= w || y >= h) return { cells, terminus: TERMINUS.EDGE };

    const i = y * w + x;
    const key = i * 8 + DIR_NAMES.indexOf(d);
    if (seen.has(key)) return { cells, terminus: TERMINUS.LOOP };
    seen.add(key);

    const cell = board.cells[i];
    // Cells that block this PARTICULAR trace, over and above the board's own
    // solid pieces. Only the view passes these, and only for kittens that have
    // not yet been freed: the solver and the confirm rule must always see the
    // board the ANSWER lives on, which is the one with every kitten gone. If
    // that ever stops being true, a kitten can make a wrong facing look clear
    // and the game will CONFIRM the cat -- and confirmed cats are fixed, so the
    // level becomes unwinnable with a tick beside the mistake.
    if (blockers && blockers.has(i)) return { cells, terminus: TERMINUS.WALL };
    // Animals are solid. A dog and a leash dog stop a gaze exactly as a wall
    // does, which is also what lets them shelter a cat standing behind them.
    if (cell.kind === 'wall' || cell.kind === 'dog' || cell.kind === 'leashDog') {
      return { cells, terminus: TERMINUS.WALL };
    }
    // A puddle is the one piece a gaze crosses. Stated here rather than left
    // to the fall-through at the bottom, because transparency is the whole
    // reason a puddle is not just a wall with a different picture.
    if (cell.kind === 'puddle') { cells.add(i); continue; }
    if (cell.kind === 'mouse') { d = opposite(d); continue; }
    // Invariant this relies on: `cats` never holds a dog/leashDog/puddle
    // index -- those kinds are handled above and return or continue before
    // this line runs, so a hazard's own cell never reaches the cats.has(i)
    // check at all. A caller that put one in `cats` anyway would have it
    // silently treated as solid or as passable water instead of as a cat.
    if (cats.has(i)) { cells.add(i); return { cells, terminus: TERMINUS.CAT, at: i }; }
    if (cell.kind === 'mirror') { cells.add(i); d = reflect(d, cell.axis); continue; }
    cells.add(i);
  }
}

// ---- board.js ----
'use strict';

function makeBoard(w, h) {
  const cells = [];
  for (let i = 0; i < w * h; i++) cells.push({ kind: 'play', axis: null, dir: null, region: null });
  return { w, h, regionCount: 0, cells, hasKitten: false };
}

function idx(board, x, y) { return y * board.w + x; }

// [kind, axis, dir]. `axis` is a mirror's orientation, `dir` is a dog's
// facing; every other cell has null for both.
//
// 'O' is the MOUSE, and is historical: it drew the reflector's ring, and the
// letter was kept when the piece was renamed rather than churn every board
// picture in the suite for a character no player sees. Do NOT read these
// glyphs as initials when adding a piece.
//
// A dog is written as the arrow it looks along -- the same eight glyphs as
// ARROWS in geometry.js -- so a fixture board is a picture, not a cipher.
var GLYPH_KIND = {
  '.': ['play', null, null],
  'C': ['play', null, null],
  '#': ['wall', null, null],
  '|': ['mirror', 'V', null],
  '-': ['mirror', 'H', null],
  '\\': ['mirror', 'B', null],
  '/': ['mirror', 'F', null],
  'O': ['mouse', null, null],
  '~': ['puddle', null, null],
  'L': ['leashDog', null, null],
  '↑': ['dog', null, 'N'],
  '↗': ['dog', null, 'NE'],
  '→': ['dog', null, 'E'],
  '↘': ['dog', null, 'SE'],
  '↓': ['dog', null, 'S'],
  '↙': ['dog', null, 'SW'],
  '←': ['dog', null, 'W'],
  '↖': ['dog', null, 'NW'],
  '⇑': ['kitten', null, 'N'],
  '⇗': ['kitten', null, 'NE'],
  '⇒': ['kitten', null, 'E'],
  '⇘': ['kitten', null, 'SE'],
  '⇓': ['kitten', null, 'S'],
  '⇙': ['kitten', null, 'SW'],
  '⇐': ['kitten', null, 'W'],
  '⇖': ['kitten', null, 'NW'],
};

// Fixture helper: read a picture of a board into { board, cats }.
function parseBoard(lines) {
  const w = lines[0].length;
  const h = lines.length;
  const board = makeBoard(w, h);
  const cats = new Set();
  lines.forEach((line, y) => {
    if (line.length !== w) throw new Error(`row ${y} is not ${w} wide`);
    [...line].forEach((ch, x) => {
      const spec = GLYPH_KIND[ch];
      if (!spec) throw new Error(`unknown board glyph: ${ch}`);
      const cell = board.cells[idx(board, x, y)];
      cell.kind = spec[0];
      cell.axis = spec[1];
      cell.dir = spec[2];
      if (cell.kind === 'kitten') board.hasKitten = true;
      if (ch === 'C') cats.add(idx(board, x, y));
    });
  });
  return { board, cats };
}

// Read a picture of region letters. 'a' is region 0, 'b' region 1, and so on.
// '.' repeats the letter directly above; '#' or ' ' marks a cell with no region.
function assignRegions(board, lines) {
  const w = board.w;
  if (lines.length !== board.h) {
    throw new Error(`region picture is ${lines.length} rows, board is ${board.h}`);
  }
  const letters = [];
  lines.forEach((line, y) => {
    if (line.length !== w) throw new Error(`region row ${y} is not ${w} wide`);
    [...line].forEach((ch, x) => {
      const i = idx(board, x, y);
      if (board.cells[i].kind !== 'play') { board.cells[i].region = null; return; }
      let c = ch;
      if (c === '.') {
        if (y === 0) throw new Error(`region row 0 cannot use '.'`);
        c = letters[idx(board, x, y - 1)];
        // The cell above is furniture, or otherwise never got a letter, so
        // there is nothing to inherit. Fail here rather than leaving a
        // playable cell with a null region: that board looks fine until the
        // solver does cand[null].push(i) and dies a long way from the cause.
        if (c === undefined) {
          throw new Error(`region row ${y} at ${x}: '.' inherits from a cell with no region`);
        }
      }
      if (c === '#' || c === ' ') throw new Error(`playable cell at ${x},${y} has no region`);
      letters[i] = c;
      board.cells[i].region = c.charCodeAt(0) - 97;
    });
  });
  let max = -1;
  for (const cell of board.cells) if (cell.region !== null && cell.region > max) max = cell.region;
  board.regionCount = max + 1;
  return board;
}

// Orthogonal neighbours. Region contiguity is 4-connected: two cells touching
// only at a corner do not make a region contiguous.
function neighbours4(board, i) {
  const w = board.w;
  const x = i % w;
  const y = Math.floor(i / w);
  const out = [];
  if (y > 0) out.push(i - w);
  if (x > 0) out.push(i - 1);
  if (x < w - 1) out.push(i + 1);
  if (y < board.h - 1) out.push(i + w);
  return out;
}

// All eight neighbours, for the no-touching rule. Cats are forbidden from
// touching at the corners as well as edge to edge.
function neighbours8(board, i) {
  const w = board.w;
  const h = board.h;
  const x = i % w;
  const y = Math.floor(i / w);
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      out.push(ny * w + nx);
    }
  }
  return out;
}

// The cells a kitten's rule reaches: its eight neighbours, clipped at the
// board edge, and only the ones a cat could actually stand on. A kitten in a
// corner has a ring of three. Named separately from neighbours8 because the
// filtering is part of the rule, not an optimisation -- a wall in the ring is
// not a cell that merely happens to be unusable, it is not in the ring at all.
function ring(board, cellIdx) {
  return neighbours8(board, cellIdx).filter((j) => board.cells[j].kind === 'play');
}

function touchesCat(board, cellIdx, cats) {
  for (const j of neighbours8(board, cellIdx)) if (cats.has(j)) return true;
  return false;
}

// ---- rules.js ----
'use strict';

function allowedDirs(puzzle, region) {
  const override = puzzle.overrides && puzzle.overrides[region];
  return override && override.length ? override : puzzle.facings;
}

// What this cell's cat may face. A locked cat's facing is a given, not a choice.
function candidateDirs(puzzle, cellIdx) {
  const lock = puzzle.locked.find((l) => l.idx === cellIdx);
  if (lock) return [lock.dir];
  return allowedDirs(puzzle, puzzle.board.cells[cellIdx].region);
}

// A kitten leaves when a cat beside it faces its way -- not merely when a cat
// stands beside it. A cat that steps into the ring facing the wrong way has
// made an illegal move, and must not be rewarded by the kitten going.
//
// Decided by the placements alone: adjacency is positional and the direction is
// printed on the board. So this never depends on a facing anyone is still free
// to choose, which is what lets forcedMoves consult it without searching.
function kittenFreed(puzzle, placements, kittenIdx) {
  const cell = puzzle.board.cells[kittenIdx];
  return ring(puzzle.board, kittenIdx).some((j) => placements.get(j) === cell.dir);
}

// The kittens that still block sight: every kitten cell for which
// kittenFreed is false. Built three times over three files before this --
// view.js's viewModel, view.js's previewCells, and generator.js's
// kittensNeverShelter all wanted exactly this set as a trace() blocker set --
// so the rule about what "unfreed" means now lives in one place instead of
// three copies that could drift apart.
function unfreedKittens(puzzle, placements) {
  const board = puzzle.board;
  const out = new Set();
  for (let i = 0; i < board.cells.length; i++) {
    if (board.cells[i].kind !== 'kitten') continue;
    if (!kittenFreed(puzzle, placements, i)) out.add(i);
  }
  return out;
}

// A facing is clear when its beam reaches no cat. A beam turned back by a
// mouse -- or by a mirror square-on to it -- returns to its own cat and
// terminates as CAT, so "aiming into a mouse kills you" needs no special
// case here; it falls out of the ordinary rule.
function clearDirs(puzzle, cats, cellIdx) {
  const out = [];
  // A cell in a kitten's ring has exactly one legal facing: the kitten's. This
  // is the only place in the game where a piece REQUIRES a direction rather
  // than forbidding one, and it is what makes a kitten's ring readable on an
  // empty board.
  const board = puzzle.board;
  let demanded = null;
  let conflicted = false;
  if (board.hasKitten) {
    for (const j of neighbours8(board, cellIdx)) {
      const n = board.cells[j];
      if (n.kind !== 'kitten') continue;
      // Two kittens can demand different directions of the same square, and no
      // cat can face two ways. Taking the last one seen would silently pick a
      // winner and let an impossible cell look usable.
      if (demanded !== null && demanded !== n.dir) conflicted = true;
      demanded = n.dir;
    }
  }
  if (conflicted) return out;
  for (const d of candidateDirs(puzzle, cellIdx)) {
    if (demanded !== null && d !== demanded) continue;
    if (trace(puzzle.board, cellIdx, d, cats).terminus !== TERMINUS.CAT) out.push(d);
  }
  return out;
}

// The cells no cat may ever stand on, over and above the ordinary rules: the
// line every dog is looking along, and the ring around every leash dog.
//
// Position-independent, and deliberately so. Whether a dog sees THROUGH a cat
// does not matter -- a valid board has no cat anywhere in its line, so the set
// is the same under either reading -- which is what keeps this out of the
// solver's hot path and lets forcedMoves consult it without choosing anyone's
// facing.
//
// NEVER cache this on the puzzle. wallShields and opticMatters (generator.js)
// temporarily mutate cell.kind to run their counterfactuals, so a cached set
// would go stale under exactly the gates that decide whether a board ships.
// Boards are at most 49 cells; recomputing costs nothing worth having.
function forbiddenCells(puzzle) {
  const board = puzzle.board;
  const out = new Set();
  const add = (i) => { if (board.cells[i].kind === 'play') out.add(i); };
  for (let i = 0; i < board.cells.length; i++) {
    const cell = board.cells[i];
    if (cell.kind === 'dog') {
      for (const c of trace(board, i, cell.dir, new Set()).cells) add(c);
    } else if (cell.kind === 'leashDog') {
      for (const j of neighbours8(board, i)) add(j);
    }
  }
  return out;
}

// The multiset of facings a finished board must use -- the slots its cats
// have to fill between them.
//
// QUOTAS ("at least `min` cats facing `dir`") are the only source, and they
// never reach a player: they exist inside makePuzzle as one of the levers
// that tightens a board toward a single answer, and generator.js clears them
// off the puzzle before it is ever handed out. A puzzle in a player's hands
// has no quota, so this returns nothing for it and the facings are rationed
// by nothing at all -- every cat may face any way its region allows and its
// own beam survives.
//
// A TALLY used to live here too: one entry per facing, summing to the cat
// count, stating exactly how many cats faced each way and refusing a cat
// aimed a way that was full. It is gone -- see src/levels.js for why.
function facingSlots(puzzle) {
  const slots = [];
  for (const q of puzzle.quotas || []) {
    for (let k = 0; k < q.min; k++) slots.push({ dir: q.dir, cells: null });
  }
  // A kitten demands a mother: some cat in its ring, facing its way. Unlike a
  // quota -- which lives only inside makePuzzle and is cleared before the board
  // is handed over -- this one is drawn on the board and DOES reach the player.
  const board = puzzle.board;
  for (let i = 0; i < board.cells.length; i++) {
    const cell = board.cells[i];
    if (cell.kind === 'kitten') slots.push({ dir: cell.dir, cells: ring(board, i) });
  }
  return slots;
}

// Maximum matching between quota slots and the cats that can fill them, by
// Kuhn's augmenting path. The graph is at most 9 by 9, so this is instant and
// Hopcroft-Karp would be ceremony. Quotas couple the cats together, which is
// why this cannot be answered one cat at a time.
function quotaMatchSize(slots, catIdxs, clearMap) {
  const slotCat = new Array(slots.length).fill(-1);

  function augment(s, seen) {
    for (let c = 0; c < catIdxs.length; c++) {
      if (seen.has(c)) continue;
      if (!clearMap.get(catIdxs[c]).includes(slots[s].dir)) continue;
      // A slot may also restrict WHICH cats can fill it -- a kitten's slot is
      // satisfiable only by a cat standing in its ring. A quota slot sets no
      // restriction and behaves exactly as it always has.
      if (slots[s].cells && !slots[s].cells.includes(catIdxs[c])) continue;
      seen.add(c);
      const held = slotCat.indexOf(c);
      if (held === -1 || augment(held, seen)) { slotCat[s] = c; return true; }
    }
    return false;
  }

  let size = 0;
  for (let s = 0; s < slots.length; s++) if (augment(s, new Set())) size++;
  return size;
}

// The SOLVER's notion: does some facing assignment satisfy everything?
function isSolvable(puzzle, positions) {
  const board = puzzle.board;
  if (positions.length !== board.regionCount) return false;
  const cats = new Set(positions);
  if (cats.size !== positions.length) return false;

  const regions = new Set();
  for (const i of positions) {
    const cell = board.cells[i];
    if (cell.kind !== 'play') return false;
    regions.add(cell.region);
  }
  if (regions.size !== board.regionCount) return false;

  // The no-touching rule. Cheapest test here and the one that rejects most,
  // so it comes before any beam is traced.
  for (const i of positions) if (touchesCat(board, i, cats)) return false;

  const forbidden = forbiddenCells(puzzle);
  for (const i of positions) if (forbidden.has(i)) return false;

  for (const l of puzzle.locked) if (!cats.has(l.idx)) return false;

  const clearMap = new Map();
  for (const i of positions) {
    const cd = clearDirs(puzzle, cats, i);
    if (cd.length === 0) return false;
    clearMap.set(i, cd);
  }

  const slots = facingSlots(puzzle);
  return quotaMatchSize(slots, positions, clearMap) === slots.length;
}

// The PLAYER's notion: is the board the player has actually built a win?
// Deliberately not expressed through isSolvable -- satisfiability asks whether
// SOME facing works, and this asks about the one the player actually chose.
function isSolved(puzzle, placements) {
  const board = puzzle.board;
  const positions = [...placements.keys()];
  if (positions.length !== board.regionCount) return false;
  const cats = new Set(positions);

  const regions = new Set();
  for (const i of positions) {
    const cell = board.cells[i];
    if (cell.kind !== 'play') return false;
    regions.add(cell.region);
  }
  if (regions.size !== board.regionCount) return false;
  for (const i of positions) if (touchesCat(board, i, cats)) return false;

  const forbidden = forbiddenCells(puzzle);
  for (const i of positions) if (forbidden.has(i)) return false;

  // Locked cats are givens: their own cell must hold a cat. isSolvable gets
  // this from its bijection plus its cats.has(l.idx) check; isSolved needs it
  // stated, or a board that moved a locked cat elsewhere in its own region is
  // validated against that cell's UNRESTRICTED facings -- candidateDirs only
  // collapses to the lock's direction at the locked index -- and reports a
  // false win. The state layer refuses to move a locked cat, so this is
  // defence in depth; but the predicate has to be sound alone, because hints
  // and any later caller reach it directly.
  for (const l of puzzle.locked) if (!placements.has(l.idx)) return false;

  // A single check, not candidateDirs plus a separate gaze trace: clearDirs
  // is candidateDirs + beam-clear + the kitten's ring demand, so anything
  // less lets a SECOND cat in a kitten's ring face any direction its region
  // allows, so long as some OTHER ring cat mothers the kitten. isSolved must
  // refuse every placement the player could not actually have made, not just
  // the one the kitten cares about.
  for (const [i, d] of placements) {
    if (!clearDirs(puzzle, cats, i).includes(d)) return false;
  }

  for (const q of puzzle.quotas || []) {
    let n = 0;
    for (const d of placements.values()) if (d === q.dir) n++;
    if (n < q.min) return false;
  }

  // The kitten's own rule, checked directly because isSolved has the player's
  // actual facings in hand. The slot matching in isSolvable answers the weaker
  // question of whether SOME assignment would do.
  const board2 = puzzle.board;
  for (let i = 0; i < board2.cells.length; i++) {
    const cell = board2.cells[i];
    if (cell.kind !== 'kitten') continue;
    const mothered = ring(board2, i).some((j) => placements.get(j) === cell.dir);
    if (!mothered) return false;
  }

  return true;
}

// How far the board falls to the one move a player can make by looking:
// "this colour has a single square left, so the cat goes there". Returns the
// placements in the order they become forced, which is also how far a player
// gets before the board stops talking to them.
//
// Deliberately weaker than the solver. countSolutions will find the answer to
// anything with an answer, by searching; this will not, because searching is
// the thing being measured. A cat that only follows from "if it went there,
// the yellow region would be stranded" is look-ahead, and look-ahead is what
// a player experiences as guessing -- so it is not counted here.
//
// A square is available when a cat could stand on it: nothing it touches
// holds a cat, and every cat on the board -- the new one included -- still
// has some facing whose beam reaches no cat. Beam clearance depends only on
// where the cats are, never on which way the others look, so this can be
// decided without choosing anyone's facing.
function forcedMoves(puzzle) {
  const board = puzzle.board;
  const byRegion = new Map();
  for (let i = 0; i < board.cells.length; i++) {
    const cell = board.cells[i];
    if (cell.kind !== 'play') continue;
    if (!byRegion.has(cell.region)) byRegion.set(cell.region, []);
    byRegion.get(cell.region).push(i);
  }

  // Givens are already on the board, so they start placed rather than forced.
  const placed = new Map();
  for (const l of puzzle.locked) {
    const cell = board.cells[l.idx];
    if (cell && cell.kind === 'play') placed.set(cell.region, l.idx);
  }

  // Hoisted out of `available`, which runs once per candidate cell per round.
  // Safe: forcedMoves mutates nothing on the board.
  const forbidden = forbiddenCells(puzzle);

  function available(idx) {
    if (forbidden.has(idx)) return false;
    const cats = new Set(placed.values());
    if (cats.has(idx)) return false;
    cats.add(idx);
    for (const i of cats) if (touchesCat(board, i, cats)) return false;
    for (const i of cats) if (clearDirs(puzzle, cats, i).length === 0) return false;
    return true;
  }

  const out = [];
  for (;;) {
    if (placed.size === board.regionCount) break;
    let move = null;
    for (const [region, cells] of byRegion) {
      if (placed.has(region)) continue;
      const open = cells.filter(available);
      if (open.length === 1) { move = [region, open[0]]; break; }
    }
    if (!move) break;
    placed.set(move[0], move[1]);
    out.push({ region: move[0], idx: move[1] });
  }
  return out;
}

// Can the whole board be read off without ever guessing? The gate the
// teaching tier is generated against; see forcedOnly in src/generator.js.
//
// Givens count as already standing, not as forced: forcedMoves lists only the
// cats the player works out, so a board with a given finishes one move short
// of its region count and comparing the two directly would call every
// given-bearing board unsolvable.
function solvableByForcedMoves(puzzle) {
  const regions = new Set();
  for (const l of puzzle.locked) {
    const cell = puzzle.board.cells[l.idx];
    if (cell && cell.kind === 'play') regions.add(cell.region);
  }
  return forcedMoves(puzzle).length + regions.size === puzzle.board.regionCount;
}

// Forcing the square is only half of a fair board. Once a level offers a
// choice of direction, a player can land on exactly the right square, aim the
// cat a way no answer accepts, and lose a life with nothing on the board to
// have warned them. That is the one mistake a puzzle must never charge for:
// not "you were wrong" but "you were wrong and could not have known".
//
// A wrong facing is FAIR when its beam ends in a cat the player can already
// see -- a given, or a cat an earlier forced move has already put down. Then
// the board has said no, and reading it is the lesson. A wrong facing whose
// beam hits nothing yet is a coin flip wearing a deduction's clothes.
//
// Takes the answer's squares rather than deriving them: this lives below the
// solver, and the generator has the answer in hand when it calls this.
//
// Note what is NOT required -- that every available facing be correct. A board
// where nothing can be aimed wrongly is a board where the direction never
// mattered, which is the opposite of what the two-direction levels exist to
// teach. The wrong facing should be there, and should be visible.
function facingsAreFair(puzzle, answerPositions) {
  const answer = new Set(answerPositions);
  const known = new Set();
  for (const l of puzzle.locked) known.add(l.idx);

  for (const mv of forcedMoves(puzzle)) {
    const correct = new Set(clearDirs(puzzle, answer, mv.idx));
    const region = puzzle.board.cells[mv.idx].region;
    for (const d of allowedDirs(puzzle, region)) {
      if (correct.has(d)) continue;
      const seen = new Set(known);
      seen.add(mv.idx);
      if (trace(puzzle.board, mv.idx, d, seen).terminus !== TERMINUS.CAT) return false;
    }
    known.add(mv.idx);
  }
  return true;
}

// Does the board actually make the case for having a choice of direction?
//
// A level that first hands the player two directions should contain the reason
// for them, visibly: two cats standing as close as the rules allow -- two
// squares apart, since one step nearer and they would be touching -- where one
// sits squarely in the other's line of fire. Both survive only because they
// look different ways, which is the entire lesson in a single pair of cats.
//
// Traced against just those two, so the pair has to face each other down on
// its own rather than lean on a third cat happening to stand in between.
function showsWhyFacingsMatter(puzzle, answerPositions) {
  const board = puzzle.board;
  const w = board.w;
  for (const a of answerPositions) {
    const ax = a % w, ay = (a - ax) / w;
    for (const b of answerPositions) {
      if (a === b) continue;
      const bx = b % w, by = (b - bx) / w;
      if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) !== 2) continue;
      for (const d of allowedDirs(puzzle, board.cells[a].region)) {
        const hit = trace(board, a, d, new Set([a, b]));
        if (hit.terminus === TERMINUS.CAT && hit.at === b) return true;
      }
    }
  }
  return false;
}

// Is every direction the player picks a real decision?
//
// A board can satisfy facingsAreFair the lazy way -- by offering no wrong
// direction at all. Then nothing is ever a trap, and nothing is ever a choice
// either: the player aims the cat, is right whatever they picked, and learns
// that direction does not matter. On the levels that exist to teach the
// opposite that is the worst outcome available, and it is what the whole tier
// was quietly doing: every one of levels 7-12 opened on a move where both
// directions worked, and on two of them the first three moves did.
//
// So every forced move must have something to get wrong. Only two things on a
// board can make a direction wrong: another cat standing on the line, or a
// MOUSE, which throws the beam back into the cat that cast it. At the
// opening no cat has been placed yet, so without a mouse the first move can
// never be a real choice -- which is why the two-direction levels carry them.
//
// Pairs with facingsAreFair and is meaningless without it: this asks that a
// wrong direction EXIST at every move, that one asks that every wrong direction
// be visible when it does.
function everyDirectionMatters(puzzle, answerPositions) {
  const moves = forcedMoves(puzzle);
  if (!moves.length) return false;
  const answer = new Set(answerPositions);
  for (const mv of moves) {
    const correct = new Set(clearDirs(puzzle, answer, mv.idx));
    const allowed = allowedDirs(puzzle, puzzle.board.cells[mv.idx].region);
    if (!allowed.some((d) => !correct.has(d))) return false;
  }
  return true;
}

// ---- solver.js ----
'use strict';

// Count solutions, abandoning the search once `limit` have been found.
// Backtracks region by region over candidate cells.
function countSolutions(puzzle, limit) {
  if (limit === undefined) limit = 2;
  const board = puzzle.board;
  const R = board.regionCount;

  const cand = [];
  for (let r = 0; r < R; r++) cand.push([]);
  // Computed once at entry: nothing mutates the board during a search, so
  // this is safe here even though it must never be cached on the puzzle
  // itself (see forbiddenCells in rules.js).
  const forbidden = forbiddenCells(puzzle);
  for (let i = 0; i < board.cells.length; i++) {
    const cell = board.cells[i];
    if (cell.kind === 'play' && !forbidden.has(i)) cand[cell.region].push(i);
  }
  // A locked cat is a given: its region has exactly one candidate.
  for (const l of puzzle.locked) cand[board.cells[l.idx].region] = [l.idx];

  // Smallest regions first: fewest candidates branch least.
  const order = cand.map((_, r) => r).sort((a, b) => cand[a].length - cand[b].length);
  const slots = facingSlots(puzzle);

  const chosen = [];
  const cats = new Set();
  let count = 0;

  // Every prune leans on the same monotonicity: adding a cat can only REMOVE
  // options from the cats already placed, never restore one. So a branch that
  // has already failed can never recover.
  function stillPossible(remaining) {
    // No-touching first: one array lookup per neighbour, and it kills the most
    // branches. Only the cat just placed can have introduced contact.
    const latest = chosen[chosen.length - 1];
    if (touchesCat(board, latest, cats)) return false;

    const clearMap = new Map();
    for (const i of chosen) {
      const cd = clearDirs(puzzle, cats, i);
      if (cd.length === 0) return false;
      clearMap.set(i, cd);
    }
    if (slots.length === 0) return true;
    // Optimistic: every region not yet placed is treated as a cat that could
    // fill any slot. At the leaf `remaining` is 0 and this check is exact.
    return quotaMatchSize(slots, chosen, clearMap) + remaining >= slots.length;
  }

  function rec(k) {
    if (k === order.length) { count++; return; }
    for (const i of cand[order[k]]) {
      chosen.push(i);
      cats.add(i);
      if (stillPossible(order.length - k - 1)) rec(k + 1);
      chosen.pop();
      cats.delete(i);
      if (count >= limit) return;
    }
  }

  rec(0);
  return count;
}

// Same augmenting-path search as quotaMatchSize (see rules.js), but returns
// the actual slot -> chosen-index pairing rather than just its size.
// quotaMatchSize already proves a perfect matching exists before a leaf is
// accepted as a solution; this walks the same search again to name it, so a
// concrete solution can record one real facing per cat rather than just a
// count.
function quotaAssignment(slots, catIdxs, clearMap) {
  const slotCat = new Array(slots.length).fill(-1);

  function augment(s, seen) {
    for (let c = 0; c < catIdxs.length; c++) {
      if (seen.has(c)) continue;
      if (!clearMap.get(catIdxs[c]).includes(slots[s].dir)) continue;
      if (slots[s].cells && !slots[s].cells.includes(catIdxs[c])) continue;
      seen.add(c);
      const held = slotCat.indexOf(c);
      if (held === -1 || augment(held, seen)) { slotCat[s] = c; return true; }
    }
    return false;
  }

  for (let s = 0; s < slots.length; s++) augment(s, new Set());
  return slotCat;
}

// Enumerate up to `limit` full solutions -- not just count them. Each result
// is the same { positions, facings } shape as puzzle.solution: a concrete
// cell and facing for every region, not merely a set of cells. Used where a
// board's solution is not unique (see maxSolutions in generator.js) and
// something downstream -- a hint -- needs to know what every solution
// actually looks like, not just how many there are.
//
// Mirrors countSolutions' search exactly (see above) so the two agree on
// what counts as "a solution"; the only difference is recording a result
// instead of a count, and naming one concrete facing per cat at each leaf
// via quotaAssignment rather than leaving the facing merely known-possible.
function allSolutions(puzzle, limit) {
  if (limit === undefined) limit = Infinity;
  const board = puzzle.board;
  const R = board.regionCount;

  const cand = [];
  for (let r = 0; r < R; r++) cand.push([]);
  // Computed once at entry: nothing mutates the board during a search, so
  // this is safe here even though it must never be cached on the puzzle
  // itself (see forbiddenCells in rules.js).
  const forbidden = forbiddenCells(puzzle);
  for (let i = 0; i < board.cells.length; i++) {
    const cell = board.cells[i];
    if (cell.kind === 'play' && !forbidden.has(i)) cand[cell.region].push(i);
  }
  for (const l of puzzle.locked) cand[board.cells[l.idx].region] = [l.idx];

  const order = cand.map((_, r) => r).sort((a, b) => cand[a].length - cand[b].length);
  const slots = facingSlots(puzzle);

  const chosen = [];
  const cats = new Set();
  const results = [];

  function stillPossible(remaining) {
    const latest = chosen[chosen.length - 1];
    if (touchesCat(board, latest, cats)) return false;

    const clearMap = new Map();
    for (const i of chosen) {
      const cd = clearDirs(puzzle, cats, i);
      if (cd.length === 0) return false;
      clearMap.set(i, cd);
    }
    if (slots.length === 0) return true;
    return quotaMatchSize(slots, chosen, clearMap) + remaining >= slots.length;
  }

  function recordSolution() {
    const clearMap = new Map();
    for (const i of chosen) clearMap.set(i, clearDirs(puzzle, cats, i));

    const facings = {};
    const used = new Set();
    if (slots.length) {
      const slotCat = quotaAssignment(slots, chosen, clearMap);
      slotCat.forEach((c, s) => {
        if (c === -1) return;
        facings[chosen[c]] = slots[s].dir;
        used.add(chosen[c]);
      });
    }
    for (const i of chosen) {
      if (used.has(i)) continue;
      facings[i] = clearMap.get(i)[0];
    }
    results.push({ positions: chosen.slice(), facings });
  }

  function rec(k) {
    if (k === order.length) { recordSolution(); return; }
    for (const i of cand[order[k]]) {
      chosen.push(i);
      cats.add(i);
      if (stillPossible(order.length - k - 1)) rec(k + 1);
      chosen.pop();
      cats.delete(i);
      if (results.length >= limit) return;
    }
  }

  rec(0);
  return results;
}

// ---- state.js ----
'use strict';

// How many wrong cats a level allows before it is lost. The third one ends
// it, so this is a count of chances rather than of forgiven mistakes.
var STARTING_LIVES = 3;

function createState(puzzle) {
  const placements = new Map();
  const confirmed = new Set();
  // A given is a correct cat by construction, so the board says so from the
  // first frame. Without this it is still immovable -- isLocked sees to that
  // -- but the header counts it as outstanding, and a level that opens with a
  // cat could be finished and still read "5 of 6 confirmed".
  for (const l of puzzle.locked) {
    placements.set(l.idx, l.dir);
    confirmed.add(l.idx);
  }
  return {
    puzzle,
    placements,
    marks: new Set(),
    confirmed,
    // Lives and the failure they lead to sit OUTSIDE history on purpose --
    // snapshot does not carry them and undo does not restore them. A life is
    // the record of something the player tried, not a piece of board state:
    // if undo refunded it, three lives would cost nothing at all and the
    // whole system would be decoration. Only createState and restart reset
    // them, which is to say only a fresh attempt does.
    lives: STARTING_LIVES,
    failed: false,
    history: [],
  };
}

function isLocked(state, cellIdx) {
  return state.puzzle.locked.some((l) => l.idx === cellIdx);
}

// A cat the game has told the player is right (see isCorrectChoice below).
// Confirmed cats are fixed: they cannot be moved, erased, turned or
// double-clicked away. Undo and Restart still reach them, being deliberate
// requests to go back rather than accidents.
function isConfirmed(state, cellIdx) {
  return state.confirmed.has(cellIdx);
}

function snapshot(state) {
  return {
    placements: new Map(state.placements),
    marks: new Set(state.marks),
    confirmed: new Set(state.confirmed),
  };
}

function playableAndFree(state, cellIdx) {
  const cell = state.puzzle.board.cells[cellIdx];
  return cell && cell.kind === 'play'
    && !isLocked(state, cellIdx) && !isConfirmed(state, cellIdx);
}

// Places a cat facing `dir`, replacing whatever was there before. The tool
// palette in the UI picks `dir` up front; this just applies it.
//
// A placement the game can prove right is confirmed on the spot and becomes
// fixed -- that is what tells the player their choice was correct. The check
// runs against the board as it will be once the placement is in, which is
// why it happens after the set rather than before.
function placeCell(state, cellIdx, dir) {
  if (state.failed) return false;
  if (!playableAndFree(state, cellIdx)) return false;
  const region = state.puzzle.board.cells[cellIdx].region;
  if (!allowedDirs(state.puzzle, region).includes(dir)) return false;

  state.history.push(snapshot(state));
  state.placements.set(cellIdx, dir);
  state.marks.delete(cellIdx);
  if (isCorrectChoice(state, cellIdx, dir)) state.confirmed.add(cellIdx);
  else loseLife(state);
  return true;
}

// A placement the game could have confirmed and did not is a wrong cat, and
// costs a life. Every wrong placement is charged, including a second one on
// a square already got wrong: "three wrong cats" counts cats put down, not
// distinct squares, which is both the plainer rule and the one a player
// carries in their head.
//
// A board the game cannot judge -- one with more than one solution, where
// settledCells is empty and nothing is ever confirmed -- costs nothing. The
// same guard that keeps the game from claiming a cat is right keeps it from
// claiming one is wrong.
function loseLife(state) {
  if (settledCells(state.puzzle).size === 0) return false;
  state.lives -= 1;
  if (state.lives <= 0) {
    state.lives = 0;
    state.failed = true;
  }
  return true;
}

// Removes a cat. The erase tool's action: the mirror image of placeCell.
function eraseCell(state, cellIdx) {
  if (state.failed) return false;
  if (!playableAndFree(state, cellIdx)) return false;
  if (!state.placements.has(cellIdx)) return false;

  state.history.push(snapshot(state));
  state.placements.delete(cellIdx);
  return true;
}

// A double-click (or double-tap) removes a cat as a shortcut for the eraser
// tool. The subtlety is undo: a double-click is preceded by two single
// clicks, each of which may already have pushed a history entry (and, with
// a facing tool selected, changed the cat's facing to a value the player
// never intended to keep). app.js detects the double click itself, by
// timing (isDoubleClick, below), and skips the second click's own
// placeCell/eraseCell/toggleMark entirely -- calling this instead.
//
// `pushedByFirstClick` says whether click 1 actually changed state (and so
// left a history entry that needs collapsing) or was a no-op -- e.g. the
// mark tool refusing a cell that already holds a cat. Undoing unconditionally
// would, in the no-op case, revert an earlier, unrelated action instead of a
// click that never happened.
function removeCatFromDoubleClick(state, cellIdx, pushedByFirstClick) {
  if (pushedByFirstClick) undo(state);
  return eraseCell(state, cellIdx);
}

// How long a second click may lag the first and still count as one
// double-click, in milliseconds. The window is exclusive (a gap of exactly
// this long does not count) so the two ends of the comparison in
// isDoubleClick agree on where the boundary itself falls.
var DOUBLE_CLICK_MS = 400;

// Pure and time-injected, so the detection itself is testable without
// faking the clock. `prevClick` is whatever app.js recorded for the click
// before this one -- null if there wasn't one, or a stale one no longer
// worth pairing with -- shaped { idx, time }.
function isDoubleClick(prevClick, cellIdx, now) {
  return !!prevClick && prevClick.idx === cellIdx && (now - prevClick.time) < DOUBLE_CLICK_MS;
}

// Marks are the player's scratch paper. They are never validated.
function toggleMark(state, cellIdx) {
  if (state.failed) return false;
  if (!playableAndFree(state, cellIdx)) return false;
  if (state.placements.has(cellIdx)) return false;
  state.history.push(snapshot(state));
  if (state.marks.has(cellIdx)) state.marks.delete(cellIdx);
  else state.marks.add(cellIdx);
  return true;
}

function undo(state) {
  const previous = state.history.pop();
  if (!previous) return false;
  state.placements = previous.placements;
  state.marks = previous.marks;
  state.confirmed = previous.confirmed;
  return true;
}

// Is the board already exactly as it was dealt -- only the givens, no marks?
//
// Confirmations need no check of their own: a cat is only ever confirmed by
// being placed, and a placement beyond the givens already fails the count
// below. A line testing state.confirmed here could never fire (mutation
// tested -- deleting it broke nothing).
//
// Lives are the opposite case, and do need one. A player who places a wrong
// cat and then erases it is back to a board indistinguishable from the dealt
// one, but is down a life -- and without this, restart would call that
// pristine, decline to do anything, and strand them at two lives with no way
// back short of leaving the level.
function isPristine(state) {
  if (state.lives !== STARTING_LIVES || state.failed) return false;
  if (state.marks.size) return false;
  if (state.placements.size !== state.puzzle.locked.length) return false;
  for (const l of state.puzzle.locked) {
    if (state.placements.get(l.idx) !== l.dir) return false;
  }
  return true;
}

function restart(state) {
  // Same no-op discipline as placeCell, eraseCell and toggleMark: restarting a board that
  // is already pristine changes nothing, so it must not push history. Without
  // this, a second restart leaves an entry whose undo visibly does nothing.
  if (isPristine(state)) return false;

  state.history.push(snapshot(state));
  state.placements = new Map();
  for (const l of state.puzzle.locked) state.placements.set(l.idx, l.dir);
  state.marks = new Set();
  state.confirmed = new Set();
  state.lives = STARTING_LIVES;
  state.failed = false;
  return true;
}

// ---- telling the player their choice was right ------------------------------

// The cells the puzzle's one solution puts a cat on -- and nothing at all
// when the puzzle has more than one solution, because on such a board there
// is no fact of the matter about where a cat belongs and the game must not
// pretend otherwise. Every catalog level has a single solution, where this
// costs nothing (solutionsFor's fast path is the stored solution itself).
// Cached on the puzzle, like solutionsFor, so a click is never a search.
function settledCells(puzzle) {
  if (puzzle._settledCells) return puzzle._settledCells;
  const sols = solutionsFor(puzzle);
  puzzle._settledCells = sols.length === 1
    ? new Set(sols[0].positions)
    : new Set();
  return puzzle._settledCells;
}

// Can the game tell the player this placement is right? Two separate
// questions, and both have to hold.
//
// The square: is it one the solution puts a cat on.
//
// The aim: whether a beam is clear depends only on the SET of cat positions
// and the beam's own direction -- never on which way the other cats look --
// so once the final positions are known, a facing is legal exactly when
// clearDirs says so against those positions. Comparing against the stored
// solution's own facing would be the wrong test: 55 of the catalog's 318
// cats have more than one legal facing, and a player who picks a
// different-but-equally-legal one has made no mistake and must not be told
// they have.
//
// On a puzzle as handed out, those two questions are the whole rule: nothing
// rations the facings between the cats, so a facing legal in isolation is
// legal full stop, and the matching below finds no slots to fill.
//
// The matching is kept for the one thing that can still carry a quota -- a
// hand-built fixture, or a board mid-generation, where "at least two cats
// facing north" ties the facings to each other. There, with every
// already-confirmed cat pinned to the facing it was confirmed with and this
// one pinned to `dir`, the quota must still be reachable by whatever the
// remaining cats do: the same matching quotaMatchSize answers for the
// solver. A choice that would strand a slot cannot finish the puzzle and is
// not confirmed, however legal it looks on its own.
function isCorrectChoice(state, cellIdx, dir) {
  const puzzle = state.puzzle;
  const positions = settledCells(puzzle);
  if (!positions.has(cellIdx)) return false;
  if (!clearDirs(puzzle, positions, cellIdx).includes(dir)) return false;

  const slots = facingSlots(puzzle);
  if (!slots.length) return true;

  const cats = [...positions];
  const clearMap = new Map();
  for (const i of cats) {
    if (i === cellIdx) clearMap.set(i, [dir]);
    else if (state.confirmed.has(i)) clearMap.set(i, [state.placements.get(i)]);
    else clearMap.set(i, clearDirs(puzzle, positions, i));
  }
  return quotaMatchSize(slots, cats, clearMap) === slots.length;
}

// Every full solution to `puzzle`, cached on the puzzle object itself so a
// board is only ever searched once per load. maxSolutions defaults to 1 --
// the fast path below, the single solution makePuzzle already computed, with
// no extra search at all -- and every level in the shipped catalog now sets
// it to exactly 1 (see src/levels.js), so in practice the fast path is the
// only one a player reaches. The real allSolutions search is left for a
// fixture or TIERS board that allows more than one answer.
function solutionsFor(puzzle) {
  if (puzzle._hintSolutions) return puzzle._hintSolutions;
  const cap = (puzzle.config && puzzle.config.maxSolutions) || 1;
  // The fast path needs a stored solution to hand back. A board built by
  // hand -- a test fixture, anything not from makePuzzle -- has none, so it
  // gets searched like any multi-solution board rather than yielding a list
  // with one undefined in it.
  puzzle._hintSolutions = cap <= 1 && puzzle.solution
    ? [puzzle.solution]
    : allSolutions(puzzle, cap + 1);
  return puzzle._hintSolutions;
}

// What one solution assigns to `region` -- or null if, somehow, it does not
// cover that region (every real solution does; this is just defensive).
function regionAssignment(sol, board, region) {
  const cell = sol.positions.find((i) => board.cells[i].region === region);
  return cell === undefined ? null : { cell, dir: sol.facings[cell] };
}

// Which region a hint should reveal next, and what to put there -- or null
// once every region already matches some valid solution.
//
// On a level with more than one solution, "matches the stored solution" is
// too strict a test for "already right": a player who has correctly filled
// a region according to a DIFFERENT valid solution must not have that
// placement judged wrong and overwritten -- that would tell a correct
// player they are wrong. So a region counts as already right when its
// current placement matches ANY of the puzzle's solutions, not only the one
// makePuzzle happened to store.
//
// The reveal itself is drawn from the solutions still consistent with
// everything the player has already gotten right elsewhere on the board, so
// an uninterrupted run of hints reconstructs one coherent solution rather
// than stitching cells together from different ones; a region where every
// surviving solution agrees is exactly the "common to all solutions" case,
// and this reduces to that automatically.
function pickHint(puzzle, placements, confirmed) {
  const board = puzzle.board;
  const sols = solutionsFor(puzzle);
  const held = confirmed || new Set();

  const placementsIn = (region) => [...placements.keys()]
    .filter((p) => board.cells[p].region === region);

  const matches = (sol, region, inRegion) => {
    if (inRegion.length !== 1) return false;
    const a = regionAssignment(sol, board, region);
    return !!a && a.cell === inRegion[0] && placements.get(inRegion[0]) === a.dir;
  };

  let live = sols;
  for (let region = 0; region < board.regionCount; region++) {
    const inRegion = placementsIn(region);
    const narrowed = live.filter((s) => matches(s, region, inRegion));
    if (narrowed.length) live = narrowed;
  }

  for (let region = 0; region < board.regionCount; region++) {
    const inRegion = placementsIn(region);
    if (live.some((s) => matches(s, region, inRegion))) continue;
    // A confirmed cat is fixed, and the caller clears a region before it
    // re-places the reveal -- so revealing such a region would quietly
    // unfix it. It is also already right by definition, and right in a way
    // `matches` above can miss: the player may have picked a legal facing
    // that differs from the one this solution happens to record.
    if (inRegion.some((p) => held.has(p))) continue;
    const reveal = regionAssignment(live[0], board, region);
    if (reveal) return reveal;
  }
  return null;
}

// Which facing a hint should actually reveal at `cell`: the solution's own
// if the game can confirm it, and otherwise whichever of the cell's facings
// it can.
//
// pickHint chooses the CELL by comparing the board against whole solutions.
// That is the right way to pick a region to help with and the wrong way to
// pick a facing, because `matches` compares the player's facing to the one
// each solution stored: a cat the player got right facing a legal
// ALTERNATIVE (143 of the catalog's 424 cats have one) matches no stored
// solution, so it never narrows the field.
//
// On a board with one answer that is now the whole story -- the stored
// facing is clear against the answer's own positions, so the confirm rule
// takes it and the loop below never runs. It is kept for the boards where
// that argument does not hold: a fixture carrying a quota, where a facing
// legal on the beams can still strand a slot, and a multi-solution board,
// where nothing is confirmable and `preferred` comes straight back rather
// than undefined. It used to run in play as well, when the facing tally
// could leave the stored facing with no room, and what it prevented then is
// what it prevents now: handing over an unconfirmed, unexplained, silently
// wrong cat, on the one button a stuck player is meant to trust.
function hintDir(state, cell, preferred) {
  if (isCorrectChoice(state, cell, preferred)) return preferred;
  const region = state.puzzle.board.cells[cell].region;
  for (const d of allowedDirs(state.puzzle, region)) {
    if (isCorrectChoice(state, cell, d)) return d;
  }
  return preferred;
}

// Reveal one cat: the whole of what the Hint button does, kept here rather
// than in app.js so the entire path is testable without a DOM. Returns the
// { cell, dir } it revealed, or null if there was nothing to reveal.
//
// The reveal is written straight into placements rather than through
// placeCell, and deliberately: a hint is the game showing its own answer, so
// it must never be charged a life, which is what placeCell would do to a cat
// that lands where wrong ones already sit. It clears the whole region first
// so a hint cannot leave two cats in one colour -- safe for a locked cat
// too, since a locked region's only candidate cell is the lock itself and
// `reveal` always names it.
function applyHint(state) {
  if (state.failed) return null;
  const reveal = pickHint(state.puzzle, state.placements, state.confirmed);
  if (!reveal) return null;

  const board = state.puzzle.board;
  const region = board.cells[reveal.cell].region;
  const dir = hintDir(state, reveal.cell, reveal.dir);

  state.history.push(snapshot(state));
  for (const i of [...state.placements.keys()]) {
    if (board.cells[i].region === region) state.placements.delete(i);
  }
  state.placements.set(reveal.cell, dir);
  state.marks.delete(reveal.cell);
  // Right by construction, and routed through the predicate anyway: a hint
  // hands over a settled cat, not one the player must re-verify.
  if (isCorrectChoice(state, reveal.cell, dir)) state.confirmed.add(reveal.cell);
  return { cell: reveal.cell, dir };
}

// Clamp a level index into [0, total-1], never wrapping. Shared by the
// prev/next buttons and by the stored-index fallback below, so "one past
// the last level" and "one before the first" both hold still rather than
// wrapping around to the other end.
function clampLevelIndex(index, total) {
  if (total <= 0) return 0;
  if (index < 0) return 0;
  if (index > total - 1) return total - 1;
  return index;
}

// Turn whatever localStorage handed back into a usable level index. `raw` is
// the string localStorage.getItem returns (or null/undefined if there was
// nothing stored, or storage itself is unavailable) -- anything that is not
// a clean integer falls back to level 1, same as a browser with no stored
// value at all.
function parseStoredLevelIndex(raw, total) {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (!/^-?\d+$/.test(raw)) return 0;
  return clampLevelIndex(Number(raw), total);
}

// Sentinel for the level-jump select's value while a random board (from New
// puzzle) is on screen -- deliberately not a bare integer string, so it can
// never collide with a real level's own value (levelOptionsHTML, in
// render.js, uses this same constant for the hidden placeholder option it
// appends after the real per-level ones).
//
// The bug this exists for: a random board shows at the SAME levelIndex as
// whatever curated level was on screen before New puzzle was pressed, so the
// select's value never actually changes when a random board loads. A player
// who then re-picks that same level from the dropdown asks the select to
// move to the value it is already sitting on -- and a native <select> fires
// no `change` event for that, so there was no way back to the curated board
// through the dropdown. Routing the select's value through this sentinel
// whenever usingRandom is true guarantees the select's *current* value is
// never any real level's value, so picking ANY level afterwards -- including
// the one already showing underneath -- is a genuine change and does fire.
var RANDOM_LEVEL_VALUE = 'random';

// What app.js should set the level-jump select's .value to for the given
// (levelIndex, usingRandom) pair -- see RANDOM_LEVEL_VALUE above.
function levelJumpValue(levelIndex, usingRandom) {
  return usingRandom ? RANDOM_LEVEL_VALUE : String(levelIndex);
}

export { trace, DIRS, DIR_NAMES, idx, neighbours8, isSolved, createState, placeCell, eraseCell, isLocked, isConfirmed, isCorrectChoice, pickHint, hintDir, applyHint, restart, undo, countSolutions, clearDirs, candidateDirs, forbiddenCells, settledCells, STARTING_LIVES };
