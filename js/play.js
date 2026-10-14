// Playable hero level: a three-level sort puzzle (teach, test, twist) with a live solver readout.
// Rules: tap a tube, then another; the top run of one colour moves onto an empty tube or a matching top, as many balls as fit.
const SortCore = (() => {
  const canMove = (t, i, j, cap) => i !== j && t[i].length > 0 && t[j].length < cap && (t[j].length === 0 || t[j].at(-1) === t[i].at(-1));
  const move = (t, i, j, cap) => {
    const n = t.map(x => x.slice()), c = n[i].at(-1);
    while (n[i].length && n[i].at(-1) === c && n[j].length < cap) n[j].push(n[i].pop());
    return n;
  };
  const isWin = (t, cap) => t.every(x => x.length === 0 || (x.length === cap && x.every(b => b === x[0])));
  const key = t => t.map(x => x.join('')).join('|');
  // Breadth-first search: the shortest list of [from, to] moves to a win, or null when none exists.
  const solve = (t0, cap, limit = 200000) => {
    if (isWin(t0, cap)) return [];
    const seen = new Set([key(t0)]); let q = [[t0, []]];
    while (q.length && seen.size < limit) {
      const next = [];
      for (const [t, path] of q) for (let i = 0; i < t.length; i++) for (let j = 0; j < t.length; j++) {
        if (!canMove(t, i, j, cap)) continue;
        const n = move(t, i, j, cap), k = key(n);
        if (seen.has(k)) continue;
        const p = [...path, [i, j]];
        if (isWin(n, cap)) return p;
        seen.add(k); next.push([n, p]);
      }
      q = next;
    }
    return null;
  };
  const stars = (moves, par) => (moves <= par ? 3 : moves <= par + 2 ? 2 : 1);
  const LEVELS = [
    { name: 'Level 1', tag: 'Teach', cap: 3, tubes: [['a', 'a', 'b'], ['b', 'b'], ['a']],
      tip: 'Tap a tube, then tap where its top ball should go.' },
    { name: 'Level 2', tag: 'Test', cap: 3, tubes: [['a', 'b', 'b'], ['b', 'c', 'c'], ['c', 'a', 'a'], []],
      tip: 'Three colours, one spare tube.' },
    { name: 'Level 3', tag: 'Twist', cap: 3, tubes: [['c', 'd', 'b'], ['c', 'c', 'a'], ['a', 'b', 'd'], ['d', 'a', 'b'], []],
      tip: 'One opening move is a trap. Watch the solver line.' },
  ];
  return { canMove, move, isWin, solve, stars, LEVELS };
})();

if (typeof module !== 'undefined') module.exports = SortCore;

// ---- Browser UI ----
if (typeof document !== 'undefined') (() => {
  const root = document.getElementById('play');
  if (!root) return;
  const S = SortCore, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NAMES = { a: 'lime', b: 'pink', c: 'blue', d: 'gold' };
  const $ = s => root.querySelector(s);
  const board = $('.tubes'), hud = $('.play-lvl'), movesEl = $('.play-moves'), tip = $('.play-tip'), solver = $('.play-solver'), clear = $('.play-clear');
  const sfx = n => window.sound && window.sound.play(n);
  let L = 0, tubes, hist, sel = null, moves, par, hinted = null;

  const load = i => {
    L = i; const lv = S.LEVELS[L];
    tubes = lv.tubes.map(t => t.slice()); hist = []; sel = null; moves = 0; hinted = null;
    const sol = S.solve(tubes, lv.cap); par = sol.length;
    if (L === 0) hinted = sol[0]; // FTUE: level 1 points at its first move, then lets go
    hud.textContent = `${lv.name} · ${lv.tag}`; tip.textContent = lv.tip;
    clear.hidden = true; root.classList.remove('won');
    render();
  };
  const runLen = t => { let n = 0; while (n < t.length && t[t.length - 1 - n] === t.at(-1)) n++; return n; };
  const render = (dropTo = -1, dropN = 0) => {
    const lv = S.LEVELS[L];
    board.style.setProperty('--cap', lv.cap);
    board.innerHTML = '';
    tubes.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 'tube'; b.type = 'button';
      const done = t.length === lv.cap && t.every(x => x === t[0]);
      if (done) b.classList.add('done');
      if (sel === i) b.classList.add('sel');
      if (hinted && hinted[0] === i && sel === null) b.classList.add('hint');
      if (hinted && hinted[1] === i && sel === hinted[0]) b.classList.add('hint');
      b.setAttribute('aria-label', `Tube ${i + 1}: ${t.length ? t.map(x => NAMES[x]).join(', ') + ' (top)' : 'empty'}${sel === i ? ', selected' : ''}`);
      t.forEach((c, k) => {
        const ball = document.createElement('span');
        ball.className = 'ball'; ball.dataset.c = c;
        if (sel === i && k >= t.length - runLen(t)) ball.classList.add('lift');
        if (i === dropTo && k >= t.length - dropN && !reduce) { ball.classList.add('drop'); ball.style.animationDelay = `${(k - (t.length - dropN)) * 50}ms`; }
        b.appendChild(ball);
      });
      b.addEventListener('click', () => tap(i));
      board.appendChild(b);
    });
    movesEl.textContent = `Moves ${moves} · Par ${par}`;
    const sol = S.solve(tubes, lv.cap);
    solver.classList.toggle('dead', !sol);
    solver.textContent = S.isWin(tubes, lv.cap) ? 'Solver: cleared' : sol ? `Solver: solvable · ${sol.length} move${sol.length === 1 ? '' : 's'} to clear` : 'Solver: dead end · undo to recover';
    $('.undo').disabled = !hist.length;
  };
  const nope = i => { sfx('nope'); const el = board.children[i]; if (!el || reduce) return; el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); };
  const tap = i => {
    const cap = S.LEVELS[L].cap;
    if (root.classList.contains('won')) return;
    if (sel === null) {
      if (!tubes[i].length) return nope(i);
      sel = i; sfx('pick'); render(); board.children[i].focus(); return;
    }
    if (sel === i) { sel = null; render(); board.children[i].focus(); return; }
    if (!S.canMove(tubes, sel, i, cap)) {
      if (tubes[i].length) { sel = i; sfx('pick'); render(); board.children[i].focus(); return; }
      return nope(i);
    }
    const before = tubes[i].length;
    hist.push(tubes); tubes = S.move(tubes, sel, i, cap); moves++; sel = null; hinted = null;
    sfx('drop'); render(i, tubes[i].length - before); board.children[i].focus();
    if (S.isWin(tubes, cap)) win();
  };
  const win = () => {
    root.classList.add('won');
    const st = S.stars(moves, par), last = L === S.LEVELS.length - 1;
    clear.querySelectorAll('.star').forEach((s, k) => { s.classList.toggle('on', k < st); s.style.animationDelay = `${350 + k * 180}ms`; });
    clear.querySelector('.clear-title').textContent = last ? 'All clear!' : 'Level clear';
    clear.querySelector('.clear-sub').textContent = last
      ? `Three levels: teach, test, twist. I've shipped 1,300+ more.`
      : `${moves} moves · par ${par}`;
    clear.querySelector('.play-next').hidden = last;
    clear.querySelector('.play-again').hidden = !last;
    clear.querySelector('.play-see').hidden = !last;
    setTimeout(() => { clear.hidden = false; sfx('clear'); confetti(); for (let k = 0; k < st; k++) setTimeout(() => sfx('star'), 350 + k * 180); (last ? clear.querySelector('.play-see') : clear.querySelector('.play-next')).focus({ preventScroll: true }); }, reduce ? 0 : 380);
  };
  const confetti = () => {
    if (reduce || !root.animate) return;
    const cols = ['#b6f36a', '#ff6b9a', '#5cc8ff', '#ffd34d', '#ffffff'];
    for (let k = 0; k < 36; k++) {
      const p = document.createElement('i'); p.className = 'confetti'; p.style.background = cols[k % cols.length];
      root.appendChild(p);
      const a = Math.random() * Math.PI * 2, d = 90 + Math.random() * 140;
      p.animate([{ transform: 'translate(-50%,-50%) rotate(0)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d + 80}px)) rotate(${Math.random() * 720}deg)`, opacity: 0 }],
        { duration: 900 + Math.random() * 500, easing: 'cubic-bezier(.2,.7,.4,1)' }).onfinish = () => p.remove();
    }
  };
  $('.undo').addEventListener('click', () => { if (!hist.length) return; tubes = hist.pop(); moves = Math.max(0, moves - 1); sel = null; hinted = null; sfx('pick'); render(); });
  $('.restart').addEventListener('click', () => load(L));
  $('.hint-btn').addEventListener('click', () => {
    const sol = S.solve(tubes, S.LEVELS[L].cap);
    if (!sol || !sol.length) return nope(sel ?? 0);
    hinted = sol[0]; sel = null; sfx('pick'); render();
  });
  clear.querySelector('.play-next').addEventListener('click', () => load(L + 1));
  clear.querySelector('.play-again').addEventListener('click', () => load(0));
  load(0);
})();
