// KittyDoku renderer: the shipped, rigged cat, dog and mouse (skinned GLBs with their own clips, see
// tools/games/kitty/export_chars.mjs), their real coats and face atlases driven by the exported facial keys, region
// tiles in the shipped palette, the bush wall, a wooden tray and the cat tray below.
// Play is pick-and-drop, as shipped: press a tray cat and it lifts (Lift / Hanging_Loop) and sways from the scruff
// while carried (CatCarrySway: a body pendulum plus verlet tail and leg chains), drop it on a square. Right: Happy,
// sparkle and a meow, and the squares it books pop a paw. Wrong: Angry, the square flashes red, the screen shakes, a life
// goes, and the cat hops back to the tray (Landing -> Sit). A cat dropped in a dog's line of sight is scared off instead.
// Booked squares refuse a cat at no cost. There are no crosses. Rules live in core.js (the level workbench's own code).
import { RoundedBoxGeometry } from '../../vendor/RoundedBoxGeometry.js';
import { GLTFLoader } from '../../vendor/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from '../../vendor/utils/SkeletonUtils.js';
import { KittyGame, LEVELS } from './core.js';
import { loadTexture, tweenList, easeOutBack, easeInOut, easeOutCubic, linear, disposeScene, gloss, matte, addRig, castShadows, fitPerspective, hoverSprings } from '../common.js';

const REGION = ['#ff5a63', '#42ecf5', '#f8f06f', '#518bff', '#8fff51', '#6c94b4', '#fb84e3', '#e0aa36', '#be9df9', '#8bf693', '#fbacfa', '#54beef', '#53f68e', '#aaf8b1', '#fd6e74', '#f779c0'];
const COATS = ['coat-snowcream.webp', 'coat-graytuxedo.webp', 'coat-chocolate.webp', 'coat-silvertabby.webp', 'coat-charcoalblack.webp'];
const SOUNDS = { tap: 'tap.mp3', tapError: 'tap-error.mp3', wrong: 'wrong.mp3', angry: 'angry-meow.mp3', meow: 'meow.mp3', sparkle: 'sparkle.mp3', bark: 'bark.mp3', clear: 'level-complete.mp3', confetti: 'confetti.mp3', lose: 'lose.mp3', pop: 'pop.mp3' };
const VEC = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] };
const CELL = 1, GAP = 0.07, TOP = 0.26, TRAY_Y = 0.08;
// Shipped tuning (GameAnimationConfig.asset / CatAnimationConfig.asset).
const CFG = {
  carryScale: 1.3, trayGap: 1.25, dropScale: 0.18, cellPopStagger: 0.04, cellPop: 0.3, spawn: 0.25, spawnStagger: 0.06,
  markStagger: 0.025, markPop: 0.5, markFrom: 1.5, markFade: 0.4, markSpin: 0.5, markAlpha: 0.42,
  wrongColor: '#ff4242', wrongFade: 0.15, wrongReturn: 2, returnTime: 0.3, returnJump: 0.6, validLift: 0.2,
  sway: { response: 0.06, maxOffset: 0.35, stiffness: 120, damping: 14, perUnit: 90, maxAngle: 35, gravity: 2, travel: 0.6 },
  scareHold: 0.6, scareRun: 4, touchOffset: -0.9, hand: 1.55,
};
// CatCarrySway chains (Cat.prefab): bones from the body outward, then stiffness, damping, gravity scale.
const CHAINS = [
  [['tail_001', 'tail_002', 'tail_003', 'tail_004', 'tail_005'], 0.171, 0.32, 0.55],
  [['upper_arm_L', 'forearm_L', 'hand_L'], 0.146, 0.3, 1], [['upper_arm_R', 'forearm_R', 'hand_R'], 0.108, 0.32, 0.95],
  [['thigh_L', 'shin_L', 'foot_L'], 0.108, 0.36, 1.15], [['thigh_R', 'shin_R', 'foot_R'], 0.162, 0.34, 1.1],
];

export async function create(ctx) {
  let dead = false;
  const { THREE, base } = ctx;
  const V3 = THREE.Vector3, gltfLoader = new GLTFLoader();
  const [catG, dogG, mouseG, FACES, faceTex, dogTex, dogEyes, mouseTex, mouseFace, pawTex, bushTex, starTex, ringTex, coats, levels] = await Promise.all([
    gltfLoader.loadAsync(base + 'cat.glb'), gltfLoader.loadAsync(base + 'dog.glb'), gltfLoader.loadAsync(base + 'mouse.glb'),
    fetch(base + 'faces.json').then(r => r.json()),
    loadTexture(base + 'cat-face.webp'), loadTexture(base + 'dog.webp'), loadTexture(base + 'dog-eyes.webp'), loadTexture(base + 'mouse.webp'), loadTexture(base + 'mouse-face.webp'),
    loadTexture(base + 'paw.webp'), loadTexture(base + 'bush.webp'), loadTexture(base + 'sparkle-star.webp'), loadTexture(base + 'sparkle-ring.webp'),
    Promise.all(COATS.map(c => loadTexture(base + c))),
    Promise.all(LEVELS.map(n => fetch(`${base}level${n}.json`).then(r => r.json()))),
  ]);
  let sfx = () => {};
  ctx.loadSounds(SOUNDS).then(p => { sfx = p; });
  const play = (name, o = {}) => sfx(name, { ...o, volume: (o.volume ?? 0.7) * (auto ? 0.5 : 1) });

  // Transparent scene: the wooden tray floats on the section colour, anchored by a soft shadow.
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  addRig(scene, { size: 8, floorY: -0.44 });
  const tweens = tweenList();
  const after = (s, fn) => tweens.add(s, () => {}, linear, fn);

  // ---- Characters: one skinned clone per piece, its own mixer and its own face materials. ----
  const faceMat = (tex, cell, side = THREE.FrontSide) => {
    const t = tex.clone(); t.repeat.set(cell[2], cell[3]); t.offset.set(cell[0], cell[1]);
    return new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.3, side });
  };
  const catBody = coats.map(t => matte('#ffffff', t, { roughness: 0.8 }));
  const dogBody = matte('#ffffff', dogTex, { roughness: 0.8 }), mouseBody = matte('#ffffff', mouseTex, { roughness: 0.8 });
  // Size each type from its resting pose. The carry pivot is the bone the shipped CatCarrySway holds the cat by (Chest,
  // Cat.prefab), in the hanging pose: it stays under the pointer and the body swings around it.
  function type(g, height, rest, faces) {
    const o = cloneSkinned(g.scene), mx = new THREE.AnimationMixer(o), clip = n => g.animations.find(a => a.name === n);
    mx.clipAction(clip(rest)).play(); mx.update(0); o.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(o, true), s = height / (box.max.y - box.min.y);
    let pivot = new V3(0, box.max.y * 0.8, 0);
    if (clip('lift')) { mx.stopAllAction(); mx.clipAction(clip('lift')).play(); mx.update(0); o.updateMatrixWorld(true); let b = null; o.traverse(x => { if (x.isBone && x.name === 'Chest') b = x; }); if (b) pivot = b.getWorldPosition(new V3()); }
    return { g, s, pivot, rest, faces };
  }
  const TYPES = {
    cat: type(catG, 0.86, 'sit', { eyeL: [0, 0.75, 0.25, 0.25], eyeR: [0, 0.75, 0.25, 0.25], mouth: [0, 0.25, 0.25, 0.25] }),
    dog: type(dogG, 0.95, 'idle', { eyeL: [0, 0, 1, 1], eyeR: [0, 0, 1, 1] }),
    mouse: type(mouseG, 0.55, 'idle', { eyeL: [0, 0, 1, 1], eyeR: [0, 0, 1, 1], mouth: [0, 0, 1, 1] }),
  };
  const chars = new Set();
  function makeChar(kind, coat = 0) {
    const T = TYPES[kind], obj = cloneSkinned(T.g.scene);
    const root = new THREE.Group(), swing = new THREE.Group(), yaw = new THREE.Group(), inner = new THREE.Group();
    root.add(swing); swing.add(yaw); yaw.add(inner); inner.add(obj); inner.scale.setScalar(T.s);
    const faces = {}, bones = {};
    obj.traverse(o => {
      if (o.isBone) bones[o.name] = o;
      if (!o.isMesh) return;
      o.frustumCulled = false; o.castShadow = true; o.receiveShadow = o.name === 'body';
      if (o.name === 'body') o.material = kind === 'cat' ? catBody[coat] : kind === 'dog' ? dogBody : mouseBody;
      else { const tex = kind === 'cat' ? faceTex : kind === 'dog' ? dogEyes : mouseFace; o.material = faces[o.name] = faceMat(tex, T.faces[o.name] || [0, 0, 1, 1], kind === 'dog' ? THREE.DoubleSide : THREE.FrontSide); }
    });
    const mixer = new THREE.AnimationMixer(obj);
    const acts = Object.fromEntries(T.g.animations.map(c => [c.name, mixer.clipAction(c)]));
    const ch = { kind, T, root, swing, yaw, inner, obj, mixer, acts, faces, bones, cur: null, curName: '', mul: 1, pivotK: 0, next: null };
    anim(ch, T.rest, { fade: 0, at: Math.random() * acts[T.rest].getClip().duration }); // SitRandom / IdleRandom
    chars.add(ch); return ch;
  }
  // Play a clip: loops by default; `once` holds the last frame; `then` cross-fades to another clip after `exit` of it.
  function anim(ch, name, { fade = 0.18, once = false, at = 0, exit = 1, then = null } = {}) {
    const a = ch.acts[name]; if (!a) return;
    ch.next = null;
    if (ch.cur === a && !once && !then) return;
    const prev = ch.cur;
    a.reset(); a.setLoop(once || then ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = true; a.time = at; a.play();
    if (prev && prev !== a && fade > 0) { a.fadeIn(fade); prev.fadeOut(fade); } else if (prev && prev !== a) prev.stop();
    ch.cur = a; ch.curName = name;
    if (then) ch.next = { at: a.getClip().duration * exit, name: then };
  }
  function faceUpdate(ch) {
    const F = FACES[ch.kind]?.[ch.curName]; if (!F || !ch.cur) return;
    const t = ch.cur.time;
    for (const part in F) {
      const m = ch.faces[part], keys = F[part]; if (!m) continue;
      let k = keys[0]; for (const x of keys) { if (x[0] <= t + 1e-4) k = x; else break; }
      m.map.offset.set(k[1], k[2]); m.map.repeat.set(k[3], k[4]);
    }
  }
  function dropChar(ch) {
    chars.delete(ch); ch.root.parent?.remove(ch.root); ch.mixer.stopAllAction();
    for (const m of Object.values(ch.faces)) { m.map.dispose(); m.dispose(); }
  }
  const faceDir = (ch, dir) => { const v = VEC[dir]; ch.yaw.rotation.y = Math.atan2(v[0], v[1]); };
  // The inner model: its scale (carry), and its offset so the scruff sits at the root while carried.
  function placeInner(ch) {
    const s = ch.T.s * ch.mul; ch.inner.scale.setScalar(s);
    ch.inner.position.copy(ch.T.pivot).multiplyScalar(-s * ch.pivotK);
  }
  const pivotWorld = ch => ch.T.pivot.clone().multiplyScalar(ch.T.s * ch.mul).applyAxisAngle(new V3(0, 1, 0), ch.yaw.rotation.y);

  // ---- Board pieces ----
  const tileGeo = new RoundedBoxGeometry(CELL - GAP, 0.32, CELL - GAP, 3, 0.12);
  const pawGeo = new THREE.PlaneGeometry(0.5, 0.5).rotateX(-Math.PI / 2);
  const woodMat = matte('#f3d3a2', null, { roughness: 0.6 }), woodDark = matte('#e2b77d', null, { roughness: 0.65 });
  const red = new THREE.Color(CFG.wrongColor); const refuse = new THREE.Color('#9e1b2a');
  // CharacterShadow for the carried cat: a soft round shadow straight below it, so the target square reads at a glance.
  const blobTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(0,0,0,1)'); r.addColorStop(0.55, 'rgba(0,0,0,.55)'); r.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: blobTex, color: '#3d2a1e', transparent: true, opacity: 0, depthWrite: false }));
  blob.renderOrder = 2; scene.add(blob);

  let G, lvl = 0, root, tiles, paws, boardCats, wrongCats, slots, auto = false, speed = 1, ended = false, hud, banner, hintBtn, carry = null, botT = 0, fx;
  let lastLives = 3, dogs, mice;

  function build() {
    hov.clear(); tweens.clear(); ctx.hideResult(); ended = false; carry = null; botT = 0;
    for (const ch of [...chars]) dropChar(ch);
    if (root) { scene.remove(root); root.traverse(o => { if (o.userData.ownMat) o.material.dispose(); }); }
    const L = levels[lvl]; G = new KittyGame(L); ctx.setLevel(`Level ${L.n}`); banner.textContent = L.teaches; lastLives = G.lives;
    root = new THREE.Group(); scene.add(root); fx = new THREE.Group(); root.add(fx);
    const { w, h, cells } = L.puzzle.board;
    // Coats: each facing gets its own coat, as the shipped Board.AssignCatSkins does (seeded per level here).
    const coatOf = {}; L.puzzle.facings.forEach((d, k) => { coatOf[d] = (L.n + k * 2) % COATS.length; }); root.userData.coatOf = coatOf;
    const tray = new THREE.Mesh(new RoundedBoxGeometry(w * CELL + 0.7, 0.4, h * CELL + 0.7, 3, 0.2), woodMat); tray.position.set(0, -0.22, 0); root.add(tray);
    const well = new THREE.Mesh(new RoundedBoxGeometry(w * CELL + 0.16, 0.2, h * CELL + 0.16, 2, 0.12), woodDark); well.position.y = -0.04; root.add(well);
    tiles = []; paws = []; boardCats = new Map(); wrongCats = new Map(); dogs = new Map(); mice = new Map();
    cells.forEach((c, i) => {
      const p = cellPos(i), color = c.kind === 'play' ? REGION[c.region % REGION.length] : '#ffffff';
      const mat = gloss(color); mat.userData.base = new THREE.Color(color);
      const t = new THREE.Mesh(tileGeo, mat); t.userData = { cell: i, ownMat: true, lift: 0, liftTo: 0, liftV: 0, red: 0 }; t.position.copy(p).setY(0.1);
      // Cell pop-in, staggered along the diagonals (CellPopStagger .04, .3s).
      t.scale.setScalar(0.001); const d = (i % w + Math.floor(i / w)) * CFG.cellPopStagger;
      after(d, () => tweens.add(CFG.cellPop, k => t.scale.setScalar(Math.max(0.001, k)), easeOutCubic));
      root.add(t); tiles.push(t);
      // A paw per playable square, shown only once the square is booked.
      if (c.kind === 'play') { const pm = new THREE.MeshBasicMaterial({ map: pawTex, color: '#000000', transparent: true, opacity: 0, depthWrite: false }); const paw = new THREE.Mesh(pawGeo, pm); paw.userData.ownMat = true; paw.position.set(0, 0.165, 0); paw.visible = false; t.add(paw); paws[i] = paw; }
      if (c.kind === 'mouse') { const m = makeChar('mouse'); m.root.position.copy(p).setY(TOP); m.yaw.rotation.y = 0.5 - (i % 3) * 0.4; root.add(m.root); mice.set(i, m); popIn(m, d + 0.15); }
      if (c.kind === 'dog') { const dg = makeChar('dog'); dg.root.position.copy(p).setY(TOP); faceDir(dg, c.dir || 'S'); root.add(dg.root); dogs.set(i, dg); popIn(dg, d + 0.15); }
      if (c.kind === 'wall') { const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: bushTex })); b.userData.ownMat = true; b.scale.set(1.05, 1.05, 1); b.position.set(0, 0.52, 0); t.add(b); }
    });
    // Givens sit on their squares from the start; their paws show without the pop (BoardState.SeedGivens).
    for (const c of G.cats()) { const cat = catPiece(c.dir); seat(cat, c.i); boardCats.set(c.i, cat); popIn(cat.ch, ((c.i % w) + Math.floor(c.i / w)) * CFG.cellPopStagger + 0.15); }
    refreshMarks(null);
    // Cat tray: one slot per allowed facing.
    const pool = L.puzzle.facings, bar = new THREE.Mesh(new RoundedBoxGeometry(pool.length * CFG.trayGap + 0.6, 0.35, 1.3, 3, 0.16), woodMat);
    const tz = h * CELL / 2 + 1.35; bar.position.set(0, -0.1, tz); root.add(bar);
    slots = pool.map((d, k) => {
      const pos = new V3((k - (pool.length - 1) / 2) * CFG.trayGap, TRAY_Y, tz);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.3, 1.25), new THREE.MeshBasicMaterial({ visible: false })); hit.position.copy(pos).setY(0.55); hit.userData = { slot: k, ownMat: true }; root.add(hit);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9 })); ring.userData.ownMat = true; ring.position.copy(pos).setY(0.1); ring.visible = false; root.add(ring);
      return { k, dir: d, pos, hit, ring, cat: null };
    });
    slots.forEach((s, k) => refill(s, 0.35 + k * CFG.spawnStagger));
    castShadows(tray); castShadows(well); castShadows(bar); tiles.forEach(t => { t.castShadow = t.receiveShadow = true; });
    refreshHud(); fit();
  }
  function cellPos(i) { const { w, h } = levels[lvl].puzzle.board; return new V3((i % w - (w - 1) / 2) * CELL, 0, (Math.floor(i / w) - (h - 1) / 2) * CELL); }
  function catPiece(dir) { const ch = makeChar('cat', root.userData.coatOf[dir]); faceDir(ch, dir); root.add(ch.root); return { ch, dir }; }
  function seat(cat, i) { cat.ch.root.position.copy(cellPos(i)).setY(TOP); cat.cell = i; }
  function popIn(ch, delay) { ch.yaw.scale.setScalar(0.001); after(delay, () => tweens.add(CFG.spawn, k => ch.yaw.scale.setScalar(Math.max(0.001, k)), easeOutBack)); }
  // Tray.Refill: a fresh cat pops into an empty slot while cats remain to be placed.
  function refill(s, delay = 0.1) {
    if (s.cat || remaining() <= 0) return;
    const cat = catPiece(s.dir); cat.slot = s; cat.ch.root.position.copy(s.pos); s.cat = cat; popIn(cat.ch, delay);
  }
  const remaining = () => levels[lvl].puzzle.board.regionCount - G.cats().filter(c => c.confirmed).length;

  // Paws on booked squares (BoardState marks), popped in order of distance from the placed cat:
  // stagger .025, scale 1.5 -> 1 over .5, fade over .4, one full spin over .5 (OutQuad).
  function refreshMarks(origin) {
    const booked = G.ruledOut(), fresh = [];
    paws.forEach((p, i) => {
      if (!p) return;
      const show = booked.has(i) && !boardCats.has(i) && !wrongCats.has(i);
      if (!show) { p.visible = false; p.userData.on = false; return; }
      if (p.userData.on) return;
      p.userData.on = true;
      if (origin === null) { p.visible = true; p.material.opacity = CFG.markAlpha; p.scale.setScalar(1); p.rotation.y = 0; } else fresh.push(i);
    });
    if (origin === null) return;
    const o = cellPos(origin); fresh.sort((a, b) => cellPos(a).distanceToSquared(o) - cellPos(b).distanceToSquared(o));
    fresh.forEach((i, n) => {
      const p = paws[i]; p.visible = false;
      after(n * CFG.markStagger, () => {
        if (!p.userData.on) return; p.visible = true;
        tweens.add(CFG.markPop, k => p.scale.setScalar(CFG.markFrom + (1 - CFG.markFrom) * k), linear);
        tweens.add(CFG.markFade, k => { p.material.opacity = CFG.markAlpha * k; }, linear);
        tweens.add(CFG.markSpin, k => { p.rotation.y = Math.PI * 2 * k; }, x => 1 - (1 - x) * (1 - x));
      });
    });
  }
  function refreshHud() {
    const lost = G.lives < lastLives; lastLives = G.lives;
    hud.innerHTML = '♥'.repeat(G.lives).padEnd(3, '♡').split('').map(c => `<i class="${c === '♥' ? 'on' : ''}">♥</i>`).join('') + `<b>${G.cats().filter(c => c.confirmed).length}/${levels[lvl].puzzle.board.regionCount}</b>`;
    if (lost && !ctx.reduce) { const heart = hud.querySelectorAll('i')[G.lives]; heart?.animate([{ transform: 'scale(1.9)', color: '#ff4d6d' }, { transform: 'scale(1)' }], { duration: 450, easing: 'cubic-bezier(.34,1.56,.64,1)' }); }
  }

  // A 30-degree lens from 58 degrees up, fitted to the tray and the cat tray below it.
  function fit() {
    const aspect = (ctx.el.clientWidth || 1) / (ctx.el.clientHeight || 1), { w, h } = levels[lvl].puzzle.board;
    const pts = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => new V3(sx * (w / 2 + 0.6), 0, sz * (h / 2 + 0.6)));
    pts.push(new V3(-1.6, 1.0, h / 2 + 2.1), new V3(1.6, 1.0, h / 2 + 2.1), new V3(0, 1.0, -h / 2 - 0.3));
    const el = 58 * Math.PI / 180;
    fitPerspective(camera, pts, aspect, { dir: new V3(0, Math.sin(el), Math.cos(el)), top: 0.26, bottom: 0.2 });
  }

  // ---- Carrying: lift a tray cat, follow a hand point, sway, drop. ----
  // carry = { cat, slot, mode: 'drag'|'held'|'fly', hand, target, prev, sway, swayV, sim, over }
  // Every new motion of a piece gets a token; older tweens on the same piece check it and stop touching it.
  const motion = ch => (ch.token = {});
  function pick(s, mode, bot = false) {
    const cat = s.cat; if (!cat || carry) return null;
    s.cat = null; s.ring.visible = false; hov.set(null);
    const ch = cat.ch; ch.yaw.scale.setScalar(1);
    anim(ch, 'lift', { fade: 0.12 });
    ch.pivotK = 1; placeInner(ch);
    const hand = s.pos.clone().add(pivotWorld(ch)); ch.root.position.copy(hand);
    const tok = motion(ch); tweens.add(0.2, k => { if (ch.token === tok) ch.mul = 1 + (CFG.carryScale - 1) * k; }, easeOutBack);
    carry = { cat, slot: s, mode, bot, hand, target: hand.clone().setY(TOP + CFG.hand), prev: hand.clone(), sway: new V3(), swayV: new V3(), sim: null, over: -1 };
    if (mode === 'held') carry.target.copy(s.pos).setY(TOP + 1.05);
    play('tap'); return carry;
  }
  function hoverCell(i) {
    if (!carry) return;
    carry.over = i;
    const ok = i >= 0 && canDrop(i, carry.cat.dir);
    tiles.forEach((t, k) => { t.userData.liftTo = k === i && ok ? CFG.validLift : 0; t.userData.bad = k === i && i >= 0 && !ok && levels[lvl].puzzle.board.cells[k].kind === 'play'; });
  }
  const canDrop = (i, dir) => G.canPlace(i, dir) && !wrongCats.has(i);
  function release() { const c = carry; carry = null; tiles.forEach(t => { t.userData.liftTo = 0; t.userData.bad = false; }); return c; }
  // Off the board, onto a booked square, or picked and put back: the cat hops home (Lift -> Landing -> Sit).
  function sendHome(cat, from, { sound = null, run = false } = {}) {
    const s = cat.slot, ch = cat.ch; if (sound) play(sound);
    const start = from.clone(), end = s.pos.clone(), mul0 = ch.mul, k0 = ch.pivotK, q0 = ch.swing.quaternion.clone(), tok = motion(ch);
    const yaw0 = ch.yaw.rotation.y, done = () => { if (ch.token !== tok) return; s.cat = cat; cat.cell = undefined; faceDir(ch, cat.dir); if (run) anim(ch, 'land', { fade: 0.1, then: 'sit', exit: 0.95 }); };
    if (run) { // DogScare: bolt back along the ground with the run cycle
      const d = end.clone().sub(start), dist = d.length(); ch.yaw.rotation.y = Math.atan2(d.x, d.z);
      anim(ch, 'run', { fade: 0.15 });
      tweens.add(Math.max(0.3, dist / CFG.scareRun), k => { if (ch.token !== tok) return; ch.root.position.lerpVectors(start, end, k); ch.root.position.y += Math.abs(Math.sin(k * Math.PI * 3)) * 0.08; }, linear, done);
      return;
    }
    anim(ch, 'land', { fade: 0.1, then: 'sit', exit: 0.95 });
    tweens.add(CFG.returnTime + 0.1, k => {
      if (ch.token !== tok) return;
      ch.mul = mul0 + (1 - mul0) * k; ch.pivotK = k0 * (1 - k); ch.swing.quaternion.slerpQuaternions(q0, new THREE.Quaternion(), k); ch.yaw.rotation.y = yaw0;
      ch.root.position.lerpVectors(start, end, k).add(pivotWorld(ch).multiplyScalar(ch.pivotK)); ch.root.position.y += Math.sin(k * Math.PI) * CFG.returnJump;
    }, easeInOut, done);
  }
  function drop(i) {
    const c = release(); if (!c) return;
    const { cat } = c, ch = cat.ch, from = ch.root.position.clone().sub(pivotWorld(ch));
    if (i < 0 || !canDrop(i, cat.dir)) { sendHome(cat, from, { sound: i < 0 ? null : 'tapError' }); return; }
    const r = G.place(i, cat.dir);
    if (!r.ok) { sendHome(cat, from, { sound: 'tapError' }); return; }
    // Into the square: the carried scale eases down (CatDropScale .18 OutBack) as it drops onto the seat.
    const seatAt = cellPos(i).setY(TOP), start = from.clone(), mul0 = ch.mul, q0 = ch.swing.quaternion.clone(), tok = motion(ch);
    cat.cell = i; cat.slot = c.slot;
    tweens.add(CFG.dropScale, k => {
      if (ch.token !== tok) return; const u = Math.min(1, k);
      ch.mul = mul0 + (1 - mul0) * k; ch.pivotK = 1 - u; ch.swing.quaternion.slerpQuaternions(q0, new THREE.Quaternion(), u);
      ch.root.position.lerpVectors(start, seatAt, u).add(pivotWorld(ch).multiplyScalar(ch.pivotK));
    }, easeOutBack, () => { if (ch.token !== tok) return; ch.pivotK = 0; ch.mul = 1; ch.root.position.copy(seatAt); });
    if (r.correct) {
      boardCats.set(i, cat); anim(ch, 'happy', { fade: 0.1, then: 'sit', exit: 0.3 });
      play('sparkle'); after(0.08, () => play('meow', { rate: 0.95 + Math.random() * 0.15 })); sparkle(seatAt);
      refreshMarks(i); refreshHud(); after(0.25, () => refill(c.slot, 0));
      if (G.over) end();
      return;
    }
    // Wrong: the cat sits there annoyed, the square goes red, a life goes; then it hops back to the tray.
    wrongCats.set(i, cat); refreshHud(); play('wrong', { volume: 0.5 });
    const dog = G.watchedBy(i), tile = tiles[i];
    tweens.add(CFG.wrongFade, k => { tile.userData.red = k; }, linear);
    if (dog >= 0 && dogs.has(dog)) { // DogScare: the cat flinches and bolts, the dog barks
      anim(ch, 'scared', { fade: 0.1 }); const dg = dogs.get(dog); anim(dg, 'bark', { fade: 0.1, then: 'idle', exit: 0.95 }); play('bark'); after(0.5, () => play('bark', { rate: 1.05 }));
    } else { anim(ch, 'angry', { fade: 0.1, then: 'sit', exit: 0.3 }); after(0.05, () => play('angry')); }
    ctx.shake(1);
    if (G.over) { end(); return; }
    const scared = dog >= 0 && dogs.has(dog);
    after(scared ? CFG.scareHold + 0.2 : CFG.wrongReturn, () => {
      if (wrongCats.get(i) !== cat) return;
      wrongCats.delete(i); tweens.add(CFG.wrongFade, k => { tile.userData.red = 1 - k; }, linear);
      sendHome(cat, ch.root.position.clone(), { run: scared });
    });
  }
  // Bot / hint / tap-to-place: carry the lifted cat over to square i along an arc, then drop it.
  function flyTo(i, time = 0.75) {
    if (!carry) return; carry.mode = 'fly';
    const c = carry, from = c.hand.clone(), to = cellPos(i).setY(TOP + CFG.hand);
    tweens.add(time, k => { if (carry !== c) return; c.hand.lerpVectors(from, to, k); c.hand.y += Math.sin(k * Math.PI) * 0.6; c.target.copy(c.hand); if (k > 0.55) hoverCell(i); }, easeInOut, () => { if (carry === c) drop(i); });
  }

  // CatCarrySway: the whole body leans from the scruff against the drag, and each limb and the tail run their own
  // verlet particles (own momentum, gravity and stiffness back toward the animated pose), bounded in travel.
  function swayStep(c, dt) {
    const ch = c.cat.ch, S = CFG.sway;
    const vel = c.hand.clone().sub(c.prev).divideScalar(Math.max(dt, 1e-4)); c.prev.copy(c.hand);
    const target = vel.multiplyScalar(-S.response).setY(0); if (target.length() > S.maxOffset) target.setLength(S.maxOffset);
    c.swayV.addScaledVector(target.sub(c.sway).multiplyScalar(S.stiffness).addScaledVector(c.swayV, -S.damping), dt); c.sway.addScaledVector(c.swayV, dt);
    const m = c.sway.length();
    if (m > 1e-4) { const dir = c.sway.clone().divideScalar(m); ch.swing.quaternion.setFromAxisAngle(new V3(-dir.z, 0, dir.x), Math.min(m * S.perUnit, S.maxAngle) * Math.PI / 180); }
    else ch.swing.quaternion.identity();
    ch.root.updateMatrixWorld(true);
    if (!c.sim) c.sim = CHAINS.map(([names, st, dp, gs]) => { const bones = names.map(n => ch.bones[n]).filter(Boolean); const P = bones.map(b => b.getWorldPosition(new V3())); return { bones, st, dp, gs, P, Q: P.map(p => p.clone()), L: P.map((p, i) => (i ? p.distanceTo(P[i - 1]) : 0)) }; });
    const grav = new V3(0, -S.gravity * dt * dt, 0), tmp = new V3(), qa = new THREE.Quaternion(), qp = new THREE.Quaternion(), qf = new THREE.Quaternion();
    for (const k of c.sim) {
      const A = k.bones.map(b => b.getWorldPosition(new V3())); k.P[0].copy(A[0]); k.Q[0].copy(A[0]);
      for (let i = 1; i < k.bones.length; i++) {
        const p = k.P[i].clone(), mom = p.clone().sub(k.Q[i]).multiplyScalar(1 - k.dp); k.Q[i].copy(k.P[i]);
        p.add(mom).addScaledVector(grav, k.gs); p.addScaledVector(tmp.copy(A[i]).sub(p), k.st);
        const off = p.clone().sub(k.P[i - 1]), d = off.length(); if (d > 1e-5) p.copy(k.P[i - 1]).addScaledVector(off, k.L[i] / d);
        const stray = p.clone().sub(A[i]), lim = k.L[i] * S.travel; if (stray.length() > lim) { p.copy(A[i]).addScaledVector(stray, lim / stray.length()); k.Q[i].copy(p); }
        k.P[i].copy(p);
      }
      for (let i = 0; i < k.bones.length - 1; i++) { // aim each bone at its child's particle, root first
        const b = k.bones[i], bp = b.getWorldPosition(new V3()), cur = k.bones[i + 1].getWorldPosition(new V3()).sub(bp), want = k.P[i + 1].clone().sub(bp);
        if (cur.lengthSq() < 1e-10 || want.lengthSq() < 1e-10) continue;
        qf.setFromUnitVectors(cur.normalize(), want.normalize()); b.getWorldQuaternion(qa); b.parent.getWorldQuaternion(qp);
        b.quaternion.copy(qp.invert().multiply(qf.multiply(qa))); b.updateMatrixWorld(true);
      }
    }
  }

  // ---- Effects ----
  function sparkle(at) {
    const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: '#fff6c8', transparent: true, depthWrite: false }));
    ring.position.copy(at).setY(TOP + 0.45); fx.add(ring);
    tweens.add(0.45, k => { ring.scale.setScalar(0.3 + k * 1.6); ring.material.opacity = 1 - k; }, easeOutCubic, () => { fx.remove(ring); ring.material.dispose(); });
    for (let n = 0; n < 9; n++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, color: ['#ffffff', '#ffe066', '#ffd1ec'][n % 3], transparent: true, depthWrite: false }));
      const a = n / 9 * Math.PI * 2 + Math.random() * 0.4, v = new V3(Math.cos(a) * (1.3 + Math.random()), 2.2 + Math.random() * 1.4, Math.sin(a) * (1.3 + Math.random()));
      fx.add(s); const sz = 0.22 + Math.random() * 0.18;
      tweens.add(0.65, t => { s.position.set(at.x + v.x * t * 0.6, TOP + 0.4 + v.y * t - 3 * t * t, at.z + v.z * t * 0.6); s.scale.setScalar(sz * (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8)); s.material.rotation += 0.15; }, linear, () => { fx.remove(s); s.material.dispose(); });
    }
  }
  const confettiGeo = new THREE.PlaneGeometry(0.12, 0.2);
  function confetti() {
    const { w, h } = levels[lvl].puzzle.board;
    for (let n = 0; n < 70; n++) {
      const m = new THREE.Mesh(confettiGeo, new THREE.MeshBasicMaterial({ color: REGION[n % REGION.length], side: THREE.DoubleSide, transparent: true }));
      const p0 = new V3((Math.random() - 0.5) * w * 0.6, 3 + Math.random(), (Math.random() - 0.5) * h * 0.6), v = new V3((Math.random() - 0.5) * 7, 3 + Math.random() * 4, (Math.random() - 0.5) * 5), spin = new V3(Math.random() * 9, Math.random() * 9, Math.random() * 9);
      fx.add(m);
      tweens.add(1.7 + Math.random() * 0.5, t => { const s = t * 1.9; m.position.set(p0.x + v.x * s * 0.6, p0.y + v.y * s - 4.2 * s * s, p0.z + v.z * s * 0.6); m.rotation.set(spin.x * s, spin.y * s, spin.z * s); m.material.opacity = t > 0.75 ? (1 - t) / 0.25 : 1; }, linear, () => { fx.remove(m); m.material.dispose(); });
    }
  }

  function end() {
    if (ended || dead) return; ended = true;
    const g0 = G, win = G.result === 'win';
    if (win) { [...boardCats.values()].forEach((c, n) => after(0.1 + n * 0.08, () => anim(c.ch, 'happy', { fade: 0.15 }))); after(0.3, () => { confetti(); play('confetti'); play('clear'); }); }
    else { play('lose'); for (const c of boardCats.values()) anim(c.ch, 'angry', { fade: 0.2 }); }
    after(win ? 1.6 : 1.1, () => {
      if (dead || G !== g0) return;
      if (auto) { lvl = win ? (lvl + 1) % LEVELS.length : lvl; build(); return; }
      if (win) {
        const last = lvl === LEVELS.length - 1;
        ctx.result({ win: true, last, title: last ? 'All clear!' : 'Purr-fect!', sub: last ? 'Five shipped levels, from first rules to the dog. 45 more in the store.' : `KittyDoku · level ${levels[lvl].n}`, next: () => { lvl = (lvl + 1) % LEVELS.length; build(); }, retry: () => build() });
      } else ctx.result({ win: false, title: 'Out of lives', sub: 'Three wrong cats. Every square can be worked out without guessing.', next: () => build() });
    });
  }

  // ---- Input: press a tray cat to lift it, drag, release over a square. A tap without a drag keeps it lifted in its
  // slot; then a tap on a square carries it there (the fallback for anyone who would rather not drag). ----
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new V3(0, 1, 0), -TOP);
  function rayAt(e) { const r = ctx.el.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera); }
  function boardCellAt(e, dragging = false) {
    rayAt(e); const p = ray.ray.intersectPlane(plane, new V3()); if (!p) return { i: -1, p: null };
    if (dragging && e.pointerType === 'touch') p.z += CFG.touchOffset; // a dragged cat targets the square above the finger
    const { w, h } = levels[lvl].puzzle.board, col = Math.round(p.x / CELL + (w - 1) / 2), row = Math.round(p.z / CELL + (h - 1) / 2);
    return { i: col >= 0 && row >= 0 && col < w && row < h ? row * w + col : -1, p };
  }
  function slotAt(e) { rayAt(e); const hit = ray.intersectObjects(slots.map(s => s.hit))[0]; return hit ? slots[hit.object.userData.slot] : null; }
  let press = null;
  function onDown(e) {
    if (auto || G.over || e.button > 0 || carry?.bot) return;
    const s = slotAt(e), { i, p } = boardCellAt(e);
    if (carry && carry.mode === 'held') {
      if (s === carry.slot) { carry.mode = 'drag'; startPress(e); return; }
      if (i >= 0 && !s) { flyTo(i, 0.45); return; }
      const c = release(); sendHome(c.cat, c.cat.ch.root.position.clone().sub(pivotWorld(c.cat.ch)));
      if (!s?.cat) return;
    }
    if (carry) return;
    if (s?.cat) { pick(s, 'drag'); startPress(e); return; }
    if (i >= 0) tapOccupant(i);
  }
  function startPress(e) { e.preventDefault(); /* no text selection or page autoscroll while dragging */ press = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; addEventListener('pointermove', onMove); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp); }
  function onMove(e) {
    if (!press || e.pointerId !== press.id || !carry || carry.mode !== 'drag') return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) press.moved = true;
    const { i, p } = boardCellAt(e, true); if (p) carry.target.set(p.x, TOP + CFG.hand, p.z);
    hoverCell(i);
  }
  function onUp(e) {
    if (press && e.pointerId !== press.id) return;
    removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
    const pr = press; press = null; if (!carry || carry.mode !== 'drag') return;
    if (!pr.moved && e.type === 'pointerup') { carry.mode = 'held'; carry.target.copy(carry.slot.pos).setY(TOP + 1.05); carry.slot.ring.visible = true; hoverCell(-1); return; }
    drop(e.type === 'pointerup' ? boardCellAt(e, true).i : -1);
  }
  // Taps on the board's other residents (Board.TryPlayOccupantTap) and on a placed cat (Celebrate).
  function tapOccupant(i) {
    if (dogs.has(i)) { const d = dogs.get(i); anim(d, 'bark', { fade: 0.1, then: 'idle', exit: 0.95 }); play('bark'); return; }
    if (mice.has(i)) { const m = mice.get(i).root, y = m.position.y; tweens.add(0.35, k => { m.position.y = y + Math.sin(k * Math.PI) * 0.25; }, linear); play('pop'); return; }
    if (boardCats.has(i)) { anim(boardCats.get(i).ch, 'happy', { fade: 0.1, then: 'sit', exit: 0.3 }); play('meow', { rate: 1.1 }); }
  }
  function onHover(e) {
    if (auto || G.over || carry) return hov.set(null);
    const s = slotAt(e); hov.set(s?.cat ? s.cat.ch.root : null);
  }
  ctx.el.addEventListener('pointerdown', onDown);
  const hov = hoverSprings(), leave = () => hov.set(null);
  ctx.el.addEventListener('pointermove', onHover); ctx.el.addEventListener('pointerleave', leave);

  // ---- Frame ----
  const _q = new THREE.Quaternion();
  function update(dt) {
    hov.update(dt);
    if (!G) return;
    const d = dt * speed;
    // Attract bot: lift the next cat of the shipped answer, carry it over and drop it, the same path a player takes.
    if (auto && !carry && !G.over && !ended) {
      botT += d;
      const mv = G.botMove(), s = mv && slots.find(x => x.dir === mv.dir);
      if (botT > 0.55 && s?.cat && s.cat.ch.yaw.scale.x > 0.99) { botT = 0; const c = pick(s, 'held', true); if (c) after(0.3, () => { if (carry === c) flyTo(mv.cell); }); }
    }
    tweens.update(d);
    if (carry) {
      const ch = carry.cat.ch;
      if (carry.mode === 'drag' || carry.mode === 'held') carry.hand.lerp(carry.target, 1 - Math.exp(-22 * d));
      ch.root.position.copy(carry.hand);
    }
    // The carried cat's shadow sits on whatever is below it (a lifted square too).
    if (carry) { const h = carry.hand, t = carry.over >= 0 ? tiles[carry.over] : null; blob.position.set(h.x, (t ? t.position.y + 0.17 : TOP) + 0.01, h.z); blob.material.opacity += (0.3 - blob.material.opacity) * Math.min(1, dt * 12); blob.scale.setScalar(0.85); }
    else blob.material.opacity = Math.max(0, blob.material.opacity - dt * 4);
    for (const ch of chars) {
      ch.mixer.update(d);
      if (ch.next && ch.cur && ch.cur.time >= ch.next.at - 1e-3) { const n = ch.next.name; ch.next = null; anim(ch, n, { fade: 0.25 }); }
      placeInner(ch); faceUpdate(ch);
    }
    if (carry) swayStep(carry, Math.min(d, 0.05));
    // Square highlight under a carried cat: a valid square lifts (.2), a refused one tints red; wrong squares stay red.
    for (const t of tiles) {
      const u = t.userData; u.liftV += ((u.liftTo - u.lift) * 260 - u.liftV * 20) * dt; u.lift += u.liftV * dt; t.position.y = 0.1 + u.lift;
      u.badK = (u.badK || 0) + ((u.bad ? 1 : 0) - (u.badK || 0)) * Math.min(1, dt * 14);
      t.material.color.copy(t.material.userData.base).lerp(red, u.red).lerp(refuse, u.badK * 0.75);
    }
  }

  hud = document.createElement('div'); hud.className = 'arcade-lives'; ctx.ui.append(hud);
  banner = document.createElement('div'); banner.className = 'arcade-teach'; ctx.ui.append(banner);
  hintBtn = document.createElement('button'); hintBtn.type = 'button'; hintBtn.className = 'arcade-hint'; hintBtn.textContent = '💡 Hint'; ctx.ui.append(hintBtn);
  // Hint, as shipped: the right cat lifts out of the tray and flies to its square.
  hintBtn.addEventListener('click', () => {
    if (auto || G.over || carry) return; const h = G.hint(); if (!h) return;
    const s = slots.find(x => x.dir === h.dir), c = s?.cat && pick(s, 'held', true); if (c) after(0.2, () => { if (carry === c) flyTo(h.cell, 0.6); });
  });
  // Stop the bot without leaving a cat in mid-air: one it is carrying goes back to the tray.
  function stopBot() { auto = false; speed = 1; if (carry?.bot) { const c = release(); sendHome(c.cat, c.cat.ch.root.position.clone().sub(pivotWorld(c.cat.ch))); } }
  build();
  const api = {
    scene, camera, update, resize: () => fit(),
    autoplay(on) { if (on) { auto = true; speed = 1; } else stopBot(); },
    restart() { stopBot(); lvl = 0; build(); },
    takeover() { stopBot(); if (G.over) { if (G.result === 'win') lvl = (lvl + 1) % LEVELS.length; build(); } },
    reloadLevel() { stopBot(); build(); },
    test: {
      set speed(v) { speed = v; },
      get state() { return { total: LEVELS.length, level: lvl + 1, shipped: levels[lvl].n, over: G.over, result: G.result, progress: G.cats().filter(c => c.confirmed && !c.given).length, onBelt: carry ? 1 : 0, auto, lives: G.lives, booked: G.ruledOut().size }; },
      reset() { stopBot(); lvl = 0; build(); },
      goto(n) { stopBot(); lvl = n - 1; build(); },
      // The next move toward the shipped answer as a real drag: from the right tray cat to its square.
      nextMove() {
        if (carry || G.over || ended) return null; const mv = G.botMove(); if (!mv) return null;
        const s = slots.find(x => x.dir === mv.dir); if (!s?.cat) return null;
        return { drag: [this.screenOf(s.pos.clone().setY(0.45)), this.screenOf(cellPos(mv.cell).setY(TOP))] };
      },
      // A drag that should cost a life: an open, unbooked square that is not in the answer.
      wrongCell() {
        const sol = new Set(levels[lvl].puzzle.solution.positions), cells = levels[lvl].puzzle.board.cells;
        for (const s of slots) { if (!s.cat) continue; const i = cells.findIndex((c, k) => c.kind === 'play' && !sol.has(k) && canDrop(k, s.dir)); if (i >= 0) return { drag: [this.screenOf(s.pos.clone().setY(0.45)), this.screenOf(cellPos(i).setY(TOP))] }; }
        return null;
      },
      // A drag into a dog's line of sight: wrong, and the cat is scared off (DogScare).
      scareCell() {
        const cells = levels[lvl].puzzle.board.cells;
        for (const s of slots) { if (!s.cat) continue; const i = cells.findIndex((c, k) => c.kind === 'play' && G.watchedBy(k) >= 0 && canDrop(k, s.dir)); if (i >= 0) return { drag: [this.screenOf(s.pos.clone().setY(0.45)), this.screenOf(cellPos(i).setY(TOP))] }; }
        return null;
      },
      // A drag onto a booked square: refused, no life lost.
      bookedCell() { const b = [...G.ruledOut()][0], s = slots.find(x => x.cat); return b === undefined || !s ? null : { drag: [this.screenOf(s.pos.clone().setY(0.45)), this.screenOf(cellPos(b).setY(TOP))] }; },
      screenOf(p) { const v = p.clone().project(camera), r = ctx.el.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
    },
    destroy() {
      dead = true; ctx.el.removeEventListener('pointerdown', onDown); ctx.el.removeEventListener('pointermove', onHover); ctx.el.removeEventListener('pointerleave', leave);
      removeEventListener('pointermove', onMove); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
      hud.remove(); banner.remove(); hintBtn.remove(); disposeScene(scene);
    },
  };
  return api;
}
