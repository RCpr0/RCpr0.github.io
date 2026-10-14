// KittyDoku renderer: the shipped cat, dog and mouse models (posed, geometry only) with their real coats and face
// atlases, region tiles in the shipped palette with paw prints, the bush wall, a wooden tray and the cat tray below.
// Rules live in core.js (the level workbench's own code).
import { RoundedBoxGeometry } from '../../vendor/RoundedBoxGeometry.js';
import { KittyGame, LEVELS } from './core.js';
import { loadModel, loadTexture, tweenList, easeOutBack, easeInOut, disposeScene, gloss, matte, addRig, castShadows, fitPerspective } from '../common.js';
import { hoverSprings } from '../common.js';

const REGION = ['#ff5a63', '#42ecf5', '#f8f06f', '#518bff', '#8fff51', '#6c94b4', '#fb84e3', '#e0aa36', '#be9df9', '#8bf693', '#fbacfa', '#54beef', '#53f68e', '#aaf8b1', '#fd6e74', '#f779c0'];
const COATS = ['coat-snowcream.webp', 'coat-graytuxedo.webp', 'coat-chocolate.webp', 'coat-silvertabby.webp', 'coat-charcoalblack.webp'];
const VEC = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
const CELL = 1, GAP = 0.07, PITCH = 52 * Math.PI / 180;

export async function create(ctx) {
  let dead = false;
  const { THREE, base } = ctx;
  const [catM, dogM, mouseM, faceTex, dogTex, dogEyes, mouseTex, mouseFace, pawTex, bushTex, coats, levels] = await Promise.all([
    loadModel(base + 'Cat.json'), loadModel(base + 'Husky.json'), loadModel(base + 'Mouse.json'),
    loadTexture(base + 'cat-face.webp'), loadTexture(base + 'dog.webp'), loadTexture(base + 'dog-eyes.webp'), loadTexture(base + 'mouse.webp'), loadTexture(base + 'mouse-face.webp'),
    loadTexture(base + 'paw.webp'), loadTexture(base + 'bush.webp'),
    Promise.all(COATS.map(c => loadTexture(base + c))),
    Promise.all(LEVELS.map(n => fetch(`${base}level${n}.json`).then(r => r.json()))),
  ]);
  // Transparent scene: the wooden tray floats on the section colour, anchored by a soft shadow.
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  addRig(scene, { size: 8, floorY: -0.44 });
  const tweens = tweenList();
  const toon = (color, map) => gloss(color, map);

  // Characters: one group per model, centred on its feet, scaled to a height in board units.
  const faceMat = (tex, cell) => { const t = tex.clone(); if (cell) { t.repeat.set(0.25, 0.25); t.offset.set(...cell); } t.needsUpdate = true;
    return new THREE.MeshLambertMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide }); };
  const catFace = { eye: faceMat(faceTex, [0, 0.75]), mouth: faceMat(faceTex, [0, 0.25]) };
  const catBody = coats.map(t => matte('#ffffff', t, { roughness: 0.8 }));
  function character(M, height, bodyMat, faceFor, nudge = 0) {
    const g = new THREE.Group(), inner = new THREE.Group(), s = height / M.size.y, c = M.min.clone().add(M.max).multiplyScalar(0.5);
    for (const p of M.parts) { const face = /Eye|Face|Mouth/i.test(p.name), m = new THREE.Mesh(p.geometry, face ? faceFor(p.name) : bodyMat); if (face) m.position.z = nudge; inner.add(m); }
    inner.children.forEach(m => m.position.add(new THREE.Vector3(-c.x, -M.min.y, -c.z))); inner.scale.setScalar(s); g.add(inner);
    castShadows(inner); // real shadows from the key light
    g.userData.inner = inner; return g;
  }
  const makeCat = coat => character(catM, 0.86, catBody[coat], n => /Mouth/.test(n) ? catFace.mouth : catFace.eye);
  const dogBody = matte('#ffffff', dogTex, { roughness: 0.8 }), dogFace = faceMat(dogEyes, null), mouseBody = matte('#ffffff', mouseTex, { roughness: 0.8 }), mouseFaceMat = faceMat(mouseFace, null);
  const makeDog = () => character(dogM, 0.95, dogBody, () => dogFace, 7);
  const makeMouse = () => character(mouseM, 0.55, mouseBody, () => mouseFaceMat);
  const face = (g, dir) => { const v = VEC[dir]; g.rotation.y = Math.atan2(v[0], v[1]); };

  const tileGeo = new RoundedBoxGeometry(CELL - GAP, 0.32, CELL - GAP, 3, 0.12);
  const pawGeo = new THREE.PlaneGeometry(0.46, 0.46).rotateX(-Math.PI / 2);
  const crossGeo = new THREE.BoxGeometry(0.42, 0.04, 0.08);
  const tileMats = new Map(), tileMat = c => { if (!tileMats.has(c)) tileMats.set(c, toon(c)); return tileMats.get(c); };
  const pawMats = new Map(), pawMat = c => { if (!pawMats.has(c)) pawMats.set(c, new THREE.MeshBasicMaterial({ map: pawTex, color: new THREE.Color(c).multiplyScalar(0.55), transparent: true, depthWrite: false })); return pawMats.get(c); };
  const woodMat = matte('#f3d3a2', null, { roughness: 0.6 }), woodDark = matte('#e2b77d', null, { roughness: 0.65 }), crossMat = new THREE.MeshBasicMaterial({ color: '#5b3b4a', transparent: true, opacity: 0.55 });

  let G, lvl = 0, root, tiles, pieces, trayCats, selected = 0, auto = false, speed = 1, endTimer = 0, crosses, beams, coatOf, hud, banner, hintBtn, botT = 0, busy = 0;

  function build() {
    hov.clear();
    if (root) scene.remove(root);
    tweens.clear(); endTimer = 0; busy = 0; ctx.hideResult();
    const L = levels[lvl]; G = new KittyGame(L); ctx.setLevel(`Level ${L.n}`);
    banner.textContent = L.teaches;
    root = new THREE.Group(); scene.add(root);
    const { w, h, cells } = L.puzzle.board;
    // Coats: each facing gets its own coat, as the shipped Board.AssignCatSkins does (seeded per level here).
    coatOf = {}; L.puzzle.facings.forEach((d, k) => { coatOf[d] = (L.n + k * 2) % COATS.length; });
    const tray = new THREE.Mesh(new RoundedBoxGeometry(w * CELL + 0.7, 0.4, h * CELL + 0.7, 3, 0.2), woodMat); tray.position.set(0, -0.22, 0); root.add(tray);
    const well = new THREE.Mesh(new RoundedBoxGeometry(w * CELL + 0.16, 0.2, h * CELL + 0.16, 2, 0.12), woodDark); well.position.y = -0.04; root.add(well);
    tiles = []; pieces = new Map(); crosses = new Map(); beams = new THREE.Group(); root.add(beams);
    cells.forEach((c, i) => {
      const p = cellPos(i), color = c.kind === 'play' ? REGION[c.region % REGION.length] : '#ffffff';
      const t = new THREE.Mesh(tileGeo, tileMat(color)); t.position.copy(p).setY(0.1); t.userData.cell = i; root.add(t); tiles.push(t);
      if (c.kind === 'play') { const paw = new THREE.Mesh(pawGeo, pawMat(color)); paw.position.copy(p).setY(0.27); root.add(paw); }
      if (c.kind === 'mouse') { const m = makeMouse(); m.position.copy(p).setY(0.26); m.rotation.y = 0.5 - (i % 3) * 0.4; root.add(m); }
      if (c.kind === 'dog') { const d = makeDog(); d.position.copy(p).setY(0.26); face(d, c.dir || 'S'); root.add(d); }
      if (c.kind === 'wall') { const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: bushTex })); b.scale.set(1.05, 1.05, 1); b.position.copy(p).setY(0.62); root.add(b); }
    });
    for (const c of G.cats()) addCat(c.i, c.dir, false);
    // Cat tray: one cat per allowed facing.
    const pool = L.puzzle.facings, bar = new THREE.Mesh(new RoundedBoxGeometry(pool.length * 1.25 + 0.6, 0.35, 1.3, 3, 0.16), woodMat);
    const ty = h * CELL / 2 + 1.35; bar.position.set(0, -0.1, ty); root.add(bar);
    trayCats = pool.map((d, k) => {
      const m = makeCat(coatOf[d]); m.position.set((k - (pool.length - 1) / 2) * 1.25, 0.08, ty); face(m, d); root.add(m);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.2, 1.2), new THREE.MeshBasicMaterial({ visible: false })); hit.position.copy(m.position).setY(0.5); hit.userData.tray = k; root.add(hit);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 })); ring.position.copy(m.position).setY(0.1); root.add(ring);
      return { m, hit, ring, dir: d, home: m.position.clone() };
    });
    castShadows(root); select(0); refresh(); fit();
  }
  function cellPos(i) { const { w, h } = levels[lvl].puzzle.board; return new THREE.Vector3((i % w - (w - 1) / 2) * CELL, 0, (Math.floor(i / w) - (h - 1) / 2) * CELL); }
  function select(k) { selected = k; trayCats.forEach((t, j) => { t.ring.visible = j === k; t.m.position.y = j === k ? 0.25 : 0.08; }); }
  function addCat(i, dir, animate) {
    const m = makeCat(coatOf[dir]); face(m, dir); m.position.copy(cellPos(i)).setY(0.26); root.add(m); pieces.set(i, m);
    if (animate) happy(m);
    return m;
  }
  function happy(m) { const y = m.position.y; tweens.add(0.45, k => { m.position.y = y + Math.sin(k * Math.PI) * 0.45; m.userData.inner.scale.y = m.userData.inner.scale.x * (1 + 0.08 * Math.sin(k * Math.PI * 2)); }, x => x); }

  // Crosses on squares a confirmed cat rules out; a short gaze line from each newly confirmed cat.
  function refresh() {
    const out = G.ruledOut();
    for (const [i, c] of crosses) if (!out.has(i)) { root.remove(c); crosses.delete(i); }
    for (const i of out) if (!crosses.has(i)) {
      const g = new THREE.Group(), a = new THREE.Mesh(crossGeo, crossMat), b = new THREE.Mesh(crossGeo, crossMat); a.rotation.y = Math.PI / 4; b.rotation.y = -Math.PI / 4; g.add(a, b);
      g.position.copy(cellPos(i)).setY(0.3); root.add(g); crosses.set(i, g); g.scale.setScalar(0.01); tweens.add(0.25, k => g.scale.setScalar(Math.max(0.01, k)), easeOutBack);
    }
    hud.innerHTML = '♥'.repeat(G.lives).padEnd(3, '♡').split('').map(c => `<i class="${c === '♥' ? 'on' : ''}">♥</i>`).join('') + `<b>${G.cats().filter(c => c.confirmed).length}/${levels[lvl].puzzle.board.regionCount}</b>`;
  }
  function showGaze(i) {
    const g = G.gaze(i); if (!g) return; const from = cellPos(i).setY(0.62);
    for (const k of g.cells) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true }));
      dot.position.copy(cellPos(k)).setY(0.5); beams.add(dot);
      tweens.add(1.4, t => { dot.material.opacity = t < 0.2 ? t * 5 : 1 - (t - 0.2) / 0.8; }, x => x, () => { beams.remove(dot); dot.geometry.dispose(); dot.material.dispose(); });
    }
  }

  // A 30-degree lens from 58 degrees up, fitted to the tray and the cat tray below it.
  function fit() {
    const aspect = (ctx.el.clientWidth || 1) / (ctx.el.clientHeight || 1), { w, h } = levels[lvl].puzzle.board;
    const pts = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => new THREE.Vector3(sx * (w / 2 + 0.6), 0, sz * (h / 2 + 0.6)));
    pts.push(new THREE.Vector3(-1.6, 1.0, h / 2 + 2.1), new THREE.Vector3(1.6, 1.0, h / 2 + 2.1), new THREE.Vector3(0, 1.0, -h / 2 - 0.3));
    const el = 58 * Math.PI / 180;
    fitPerspective(camera, pts, aspect, { dir: new THREE.Vector3(0, Math.sin(el), Math.cos(el)), top: 0.26, bottom: 0.2 });
  }


  // Input: tap a tray cat to pick its facing, tap a square to place it.
  const ray = new THREE.Raycaster();
  function onPointer(e) {
    if (auto || G.over || busy) return;
    const r = ctx.canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects([...trayCats.map(t => t.hit), ...tiles])[0]; if (!hit) return;
    if (hit.object.userData.tray !== undefined) { select(hit.object.userData.tray); ctx.sound('tap'); return; }
    place(hit.object.userData.cell, trayCats[selected].dir);
  }  // Hover: an open square or a tray cat springs up under the pointer.
  function onHover(e) {
    if (auto || G.over || busy) return hov.set(null);
    const r = ctx.el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const h = ray.intersectObjects([...trayCats.map(t => t.hit), ...tiles])[0]; if (!h) return hov.set(null);
    if (h.object.userData.tray !== undefined) return hov.set(trayCats[h.object.userData.tray].m);
    const i = h.object.userData.cell, c = levels[lvl].puzzle.board.cells[i];
    hov.set(c.kind === 'play' && !G.catAt(i) && !crosses.has(i) ? tiles[i] : null);
  }

  ctx.canvas.addEventListener('pointerdown', onPointer);
  const hov = hoverSprings(), leave = () => hov.set(null);
  ctx.el.addEventListener('pointermove', onHover); ctx.el.addEventListener('pointerleave', leave);

  function place(i, dir) {
    const before = G.lives, r = G.place(i, dir);
    if (!r.ok) { ctx.sound('nope'); const t = tiles[i]; tweens.add(0.3, k => { t.position.x = cellPos(i).x + Math.sin(k * Math.PI * 4) * 0.06 * (1 - k); }); return r; }
    busy = 1;
    const k = trayCats.findIndex(t => t.dir === dir), from = trayCats[k].home.clone().setY(0.3), to = cellPos(i).setY(0.26);
    const flyer = makeCat(coatOf[dir]); face(flyer, dir); root.add(flyer); ctx.sound('tap');
    tweens.add(0.42, t => { flyer.position.lerpVectors(from, to, t); flyer.position.y += Math.sin(t * Math.PI) * 1.6; }, easeInOut, () => {
      if (r.correct) {
        root.remove(flyer); addCat(i, dir, true); ctx.sound('full'); burst(to); showGaze(i); refresh(); busy = 0;
      } else {
        ctx.sound('nope');
        flyer.traverse(o => { if (o.material?.color && o.material !== crossMat) { o.material = o.material.clone(); o.material.color.set('#ff8a8a'); } });
        const x = flyer.position.x;
        tweens.add(0.45, t => { flyer.position.x = x + Math.sin(t * Math.PI * 6) * 0.08 * (1 - t); }, x => x, () => {
          tweens.add(0.35, t => { flyer.position.lerpVectors(to, from, t); flyer.position.y += Math.sin(t * Math.PI) * 1.2; flyer.scale.setScalar(1 - 0.6 * t); }, easeInOut, () => { root.remove(flyer); busy = 0; });
        });
        refresh();
      }
      if (G.over) end();
    });
    return r;
  }
  function burst(at) {
    for (let n = 0; n < 14; n++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshBasicMaterial({ color: ['#ffffff', '#ffe066', '#ffb3d1'][n % 3], transparent: true }));
      const a = n / 14 * Math.PI * 2, v = new THREE.Vector3(Math.cos(a) * 1.6, 2.4 + (n % 3) * 0.5, Math.sin(a) * 1.6); s.position.copy(at).setY(0.6); root.add(s);
      tweens.add(0.7, t => { s.position.set(at.x + v.x * t, 0.6 + v.y * t - 4 * t * t, at.z + v.z * t); s.material.opacity = 1 - t; s.rotation.y += 0.2; }, x => x, () => { root.remove(s); s.geometry.dispose(); s.material.dispose(); });
    }
  }
  function end() {
    if (endTimer || dead) return; endTimer = 1;
    if (G.result === 'win') for (const m of pieces.values()) setTimeout(() => happy(m), Math.random() * 300);
    const g0 = G; // a restart in between makes this timer stale
    setTimeout(() => {
      if (dead || G !== g0) return;
      if (auto) { lvl = G.result === 'win' ? (lvl + 1) % LEVELS.length : lvl; build(); return; }
      if (G.result === 'win') {
        const last = lvl === LEVELS.length - 1;
        ctx.result({ win: true, last, title: last ? 'All clear!' : 'Purr-fect!', sub: last ? 'Five shipped levels, from first rules to the dog. 45 more in the store.' : `KittyDoku · level ${levels[lvl].n}`, next: () => { lvl = (lvl + 1) % LEVELS.length; build(); }, retry: () => build() });
      } else ctx.result({ win: false, title: 'Out of lives', sub: 'Three wrong cats. Every square can be worked out without guessing.', next: () => build() });
    }, G.result === 'win' ? 1100 : 700);
  }

  function update(dt) {
    hov.update(dt);
    if (!G) return;
    if (auto && !busy && !G.over) { botT += dt * speed; if (botT > 0.9) { botT = 0; const mv = G.botMove(); if (mv) { select(trayCats.findIndex(t => t.dir === mv.dir)); place(mv.cell, mv.dir); } } }
    // Idle life: cats breathe.
    const t = performance.now() / 1000;
    for (const [i, m] of pieces) m.userData.inner.position.y = Math.sin(t * 2 + i) * 0.01;
    tweens.update(dt * speed);
  }

  hud = document.createElement('div'); hud.className = 'arcade-lives'; ctx.ui.append(hud);
  banner = document.createElement('div'); banner.className = 'arcade-teach'; ctx.ui.append(banner);
  hintBtn = document.createElement('button'); hintBtn.type = 'button'; hintBtn.className = 'arcade-hint'; hintBtn.textContent = '💡 Hint'; ctx.ui.append(hintBtn);
  hintBtn.addEventListener('click', () => { if (auto || G.over || busy) return; const h = G.hint(); if (!h) return; select(trayCats.findIndex(t => t.dir === h.dir)); const tile = tiles[h.cell]; tweens.add(1.2, k => { tile.position.y = 0.1 + Math.abs(Math.sin(k * Math.PI * 3)) * 0.18; }, x => x); });
  build();
  return {
    scene, camera, update, resize: () => fit(),
    autoplay(on) { auto = on; speed = 1; },
    restart() { auto = false; speed = 1; lvl = 0; build(); },
    test: {
      set speed(v) { speed = v; },
      get state() { return { total: LEVELS.length, level: lvl + 1, shipped: levels[lvl].n, over: G.over, result: G.result, progress: G.cats().filter(c => c.confirmed && !c.given).length, onBelt: 0, auto, lives: G.lives }; },
      // Next player tap toward the shipped answer: the right tray cat first if it isn't selected, then the square.
      nextMove() { if (busy || G.over) return null; const mv = G.botMove(); if (!mv) return null; const k = trayCats.findIndex(t => t.dir === mv.dir); return k !== selected ? this.screenOf(trayCats[k].hit.position) : this.screenOf(cellPos(mv.cell).setY(0.3)); },
      wrongCell() { const sol = new Set(levels[lvl].puzzle.solution.positions); const i = levels[lvl].puzzle.board.cells.findIndex((c, k) => c.kind === 'play' && !sol.has(k) && !G.catAt(k)); return this.screenOf(cellPos(i).setY(0.3)); },
      screenOf(p) { const v = p.clone().project(camera), r = ctx.canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
    },
    destroy() { dead = true; ctx.canvas.removeEventListener('pointerdown', onPointer); ctx.el.removeEventListener('pointermove', onHover); ctx.el.removeEventListener('pointerleave', leave); hud.remove(); banner.remove(); hintBtn.remove(); disposeScene(scene); },
  };
}
