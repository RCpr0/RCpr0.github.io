// Home-page hero: giant glossy voxel letters P-L-A-Y slam in toward the camera one by one (squash, shake, debris,
// shockwave), a fat 3D arrow drops under them and keeps thumping downward, and a character from each playable game
// tumbles onto a letter (sand cart, yarn ball, mouse with cheese, the rigged cat, a plush bear riding the arrow).
// Scrolling pours the whole thing downward into the play band (scroll-linked, reversible); a tap on a letter or a
// character scrolls to that game, anywhere else to the play band. Own renderer and canvas (not the games' #gl), only
// rendering while the hero is on screen. Reduced motion: one settled still frame. No WebGL: the CSS fallback stays.
import * as THREE from 'three';
import { RoundedBoxGeometry } from '../../vendor/RoundedBoxGeometry.js';
import { RoomEnvironment } from '../../vendor/RoomEnvironment.js';
import { gloss, fitPerspective } from '../common.js';
import * as cast from './chars.js';

const box = document.querySelector('[data-hero]');
if (box) init(box);

function init(box) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas'); canvas.className = 'hero-gl'; canvas.setAttribute('aria-hidden', 'true');
  let renderer;
  // Probe first so a browser without WebGL keeps the CSS word quietly (no renderer error in the console).
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) { box.classList.add('no-gl'); return; }
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    if (!renderer.getContext()) throw new Error('no gl');
  } catch (e) { box.classList.add('no-gl'); return; }
  box.prepend(canvas);
  const coarse = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 2 : 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.6; pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 300);
  scene.add(new THREE.HemisphereLight('#fff6ee', '#3a2350', 0.7));
  const key = new THREE.DirectionalLight('#fff3e2', 2.2); key.position.set(6, 14, 12); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 4; key.shadow.bias = -6e-4; key.shadow.normalBias = 0.03;
  Object.assign(key.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 }); key.shadow.camera.updateProjectionMatrix();
  const rim = new THREE.DirectionalLight('#b9a4ff', 1.6); rim.position.set(-9, 5, -8);
  const lime = new THREE.DirectionalLight('#b6f36a', 0.5); lime.position.set(4, -8, 6);
  scene.add(key, rim, lime);

  // Everything lives in `world` (sways with the pointer); the word and its cast in `word`.
  const world = new THREE.Group(); scene.add(world);
  const word = new THREE.Group(); world.add(word);
  key.target = word;

  // ---------------- The letters: 5x7 voxel glyphs (fine enough to read as letters), one per game colour ----------------
  const GLYPH = {
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'], L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  };
  const VS = 0.68; // voxel pitch: the letters stay about as big as before, built from more, smaller blocks
  const GAMES = {
    sandflow: { id: 'play-sandflow', name: 'Sand Flow' }, yarn: { id: 'play-yarn', name: 'Yarn Collect' }, mice: { id: 'play-mice', name: 'Mice Flow' },
    kitty: { id: 'play-kitty', name: 'KittyDoku' }, toyland: { id: 'play-toyland', name: 'Toyland Go!' }, all: { id: 'play', name: 'all five games' },
  };
  const LETTERS = [['P', '#ff9a2e', 'sandflow'], ['L', '#a98cf5', 'yarn'], ['A', '#ffc93a', 'mice'], ['Y', '#ff8aa3', 'kitty']].map(([ch, hex, game], i) => ({
    ch, game, col: new THREE.Color(hex), cx: -6.15 + i * 4.1, slam: 0.06 + i * 0.2, landed: false,
    sq: { x: 0, v: 0 }, hop: { x: 0, v: 0 }, flash: 0, tilt: (i % 2 ? 1 : -1) * (0.5 + 0.2 * i),
  }));
  const voxels = [];
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (const L of LETTERS) GLYPH[L.ch].forEach((row, r) => [...row].forEach((c, gx) => {
    if (c !== '1') return;
    const lx = (gx - 2) * VS, ly = (6.5 - r) * VS;
    voxels.push({ L, lx, ly, col: L.col.clone().offsetHSL(0, 0, (rnd() - 0.5) * 0.06), pop: { x: 0, v: 0 }, delay: 0.04 + (L.cx + lx + 7.5) / 15 * 0.28 + rnd() * 0.12, spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(9) });
  }));
  const VOX = 0.94 * VS, DEPTH = 1.25;
  const voxGeo = new RoundedBoxGeometry(VOX, VOX, DEPTH, 3, 0.13);
  const voxMat = gloss('#ffffff', null, { roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12 });
  const vox = new THREE.InstancedMesh(voxGeo, voxMat, voxels.length); vox.castShadow = vox.receiveShadow = true; vox.frustumCulled = false;
  voxels.forEach((v, i) => vox.setColorAt(i, v.col));
  word.add(vox);

  // ---------------- The arrow: a fat, bevelled glossy arrow pointing at the games, plus falling ghost chevrons ----------------
  const arrowShape = new THREE.Shape();
  const sw = 0.85, sh = 2.1, hw = 2.25, hh = 2.6; // shaft half-width/height, head half-width/height
  arrowShape.moveTo(-sw, 0); arrowShape.lineTo(sw, 0); arrowShape.lineTo(sw, -sh); arrowShape.lineTo(hw, -sh); arrowShape.lineTo(0, -sh - hh); arrowShape.lineTo(-hw, -sh); arrowShape.lineTo(-sw, -sh); arrowShape.closePath();
  const arrowGeo = new THREE.ExtrudeGeometry(arrowShape, { depth: 0.9, bevelEnabled: true, bevelThickness: 0.3, bevelSize: 0.28, bevelSegments: 4, curveSegments: 1 });
  arrowGeo.translate(0, 0, -0.45);
  const arrowMat = gloss('#b6f36a', null, { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1, emissive: '#3c6b10', emissiveIntensity: 0.35 });
  const arrowPivot = new THREE.Group(), arrowBody = new THREE.Group(), arrowMesh = new THREE.Mesh(arrowGeo, arrowMat);
  arrowMesh.castShadow = arrowMesh.receiveShadow = true; arrowBody.add(arrowMesh); arrowPivot.add(arrowBody); word.add(arrowPivot);
  const ARROW = { top: -2.0, len: sh + hh + 0.3, s: 1 };
  const chevGeo = (() => {
    const s = new THREE.Shape(); s.moveTo(-1.6, 0); s.lineTo(-1.0, 0); s.lineTo(0, -0.95); s.lineTo(1.0, 0); s.lineTo(1.6, 0); s.lineTo(0, -1.5); s.closePath();
    return new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2 });
  })();
  const chevs = [0, 1, 2].map(i => { const m = new THREE.Mesh(chevGeo, new THREE.MeshBasicMaterial({ color: '#c8ff7a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })); m.userData.phase = i / 3; word.add(m); return m; });

  // ---------------- Juice: debris cubes, shockwave rings, camera shake ----------------
  const NP = 140, parts = [], pGeo = new RoundedBoxGeometry(1, 1, 1, 1, 0.15);
  const pMesh = new THREE.InstancedMesh(pGeo, gloss('#ffffff', null, { roughness: 0.35, clearcoat: 0.8 }), NP); pMesh.frustumCulled = false; pMesh.castShadow = true;
  for (let i = 0; i < NP; i++) { parts.push({ life: 0 }); pMesh.setColorAt(i, new THREE.Color()); }
  word.add(pMesh);
  let pNext = 0;
  function burst(x, y, z, col, n = 14, power = 1) {
    for (let k = 0; k < n; k++) {
      const idx = pNext, p = parts[idx]; pNext = (pNext + 1) % NP;
      const a = rnd() * Math.PI * 2, up = 0.4 + rnd();
      Object.assign(p, { life: 0.7 + rnd() * 0.5, max: 1.2, s: (0.14 + rnd() * 0.24) * Math.sqrt(power), p: new THREE.Vector3(x, y, z),
        v: new THREE.Vector3(Math.cos(a) * (2 + rnd() * 5), up * 7, Math.sin(a) * (2 + rnd() * 4) + 2).multiplyScalar(power), r: new THREE.Vector3(rnd() * 6, rnd() * 6, 0), w: new THREE.Vector3(rnd() * 12 - 6, rnd() * 12 - 6, rnd() * 12 - 6) });
      p.max = p.life; pMesh.setColorAt(idx, (rnd() < 0.25 ? new THREE.Color('#ffffff') : col.clone().offsetHSL(0, 0, (rnd() - 0.3) * 0.2)));
    }
    pMesh.instanceColor.needsUpdate = true;
  }
  const ringGeo = new THREE.RingGeometry(0.82, 1, 48).rotateX(-Math.PI / 2);
  const rings = [0, 1, 2, 3, 4, 5].map(() => { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, side: THREE.DoubleSide })); m.visible = false; m.userData.t = 1; word.add(m); return m; });
  let ringNext = 0;
  function ring(x, y, z, col, size = 4) { const m = rings[ringNext]; ringNext = (ringNext + 1) % rings.length; m.position.set(x, y + 0.05, z); m.material.color.copy(col); m.userData = { t: 0, size }; m.visible = true; }
  let shake = 0;
  const kick = a => { shake = Math.min(1.4, shake + a); };

  // ---------------- The cast: one shipped character per game, each on its letter ----------------
  // spot(): where it stands in `word` space when settled; game: where a tap on it takes you.
  const CAST = [
    { game: 'yarn', make: () => cast.yarnBall('#ff5c8a', 1.6), spot: () => new THREE.Vector3(LETTERS[1].cx + 0.35, VS, 0.15), order: 0 },
    { game: 'mice', make: () => cast.mouse('#7f9bff', 1.8), spot: () => new THREE.Vector3(LETTERS[2].cx + 1.5 * VS, 7 * VS, 0), yaw: 0.85, order: 1 },
    { game: 'toyland', make: () => cast.plush('#4fb2ff', 2.1), spot: () => new THREE.Vector3(1.6, -sh + 0.28, 0.55), yaw: -0.35, order: 2, onArrow: true },
    { game: 'sandflow', make: () => cast.cart('#4f7dff', 1.45), spot: () => new THREE.Vector3(LETTERS[0].cx - VS, 7 * VS, 0), yaw: 0.35, order: 3 },
    { game: 'kitty', make: () => cast.cat(2.2), spot: () => new THREE.Vector3(LETTERS[3].cx + 2 * VS, 7 * VS, 0.2), yaw: -0.25, order: 4 },
  ].map(c => ({ ...c, ready: null, dropAt: Infinity, landed: false, sq: { x: 0, v: 0 }, hop: { x: 0, v: 0 }, delay: 0, root: new THREE.Group() }));
  for (const c of CAST) {
    c.root.visible = false; (c.onArrow ? arrowBody : word).add(c.root);
    c.delay = 0.1 + (c.spot().x + 7.5) / 15 * 0.3;
    // An invisible hit box so taps on a character are cheap and generous.
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.2, 1.8).translate(0, 1.1, 0), new THREE.MeshBasicMaterial({ visible: false }));
    hit.userData.game = c.game; c.hit = hit; c.root.add(hit);
  }

  // ---------------- Layout: the canvas bleeds past the box (right edge of the page, down into the play band) ----------------
  const BASE = { x: 0.1, y: -0.2 }; // turned only slightly, so the word reads face-on
  let SHRINK = [0.65, 1];
  let W = 1, H = 1, bw = 1, bh = 1, phone = false, fall = 22, offL = 0, offT = 0;
  function layout() {
    const vw = document.documentElement.clientWidth, vh = innerHeight, b = box.getBoundingClientRect();
    phone = vw < 761; bw = b.width; bh = b.height; SHRINK = phone ? [0.45, 0.9] : [0.65, 1];
    offL = phone ? -b.left : -Math.min(30, b.left); offT = phone ? -10 : -50;
    const right = vw - b.right, below = phone ? 30 : Math.round(vh * 0.62);
    W = Math.round(bw - offL + right); H = Math.round(bh - offT + below);
    Object.assign(canvas.style, { left: offL + 'px', top: offT + 'px', width: W + 'px', height: H + 'px' });
    renderer.setSize(W, H, false);
    // Frame the content in the box (the word turned so its right end swings toward the viewer), then widen the
    // frustum to the whole canvas so overflowing motion (slams, the pour) still draws.
    ARROW.s = phone ? 0.62 : 1; ARROW.top = phone ? -1.4 : -2.0; arrowPivot.scale.setScalar(ARROW.s);
    const fr = phone ? { l: 0, t: 0, w: bw, h: bh } : { l: 0, t: -40, w: bw + Math.max(0, Math.min(right - 24, bw * 0.2)), h: bh + 40 };
    const aspect = fr.w / fr.h, fov = 42, top = phone ? 6.6 : 6.9, bottom = phone ? -5.2 : -6.9;
    world.rotation.set(BASE.x, BASE.y, 0); world.updateMatrixWorld(true);
    const pts = [];
    for (const x of [-7.9, 7.9]) for (const y of [bottom, top]) for (const z of [-0.8, 0.8]) pts.push(new THREE.Vector3(x, y, z).applyMatrix4(world.matrixWorld));
    camera.clearViewOffset();
    fitPerspective(camera, pts, aspect, { dir: new THREE.Vector3(0, 0.2, 1), fov, top: 0.02, bottom: 0.1, side: phone ? 0.02 : -0.04 });
    camera.near = 1; camera.far = 300;
    camera.setViewOffset(fr.w, fr.h, offL - fr.l, offT - fr.t, W, H);
    const perPx = 2 * camera.userData.view.dist * Math.tan(fov * Math.PI / 360) / fr.h;
    fall = perPx * (phone ? bh * 0.9 : bh * 0.75 + vh * 0.5);
    word.scale.setScalar(1);
  }

  // ---------------- Input: hover tilts and pops; a tap scrolls to the game under it ----------------
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const tip = box.querySelector('.hero-tip');
  let pointer = { x: 0, y: 0, in: false }, hovered = null, tiltX = 0, tiltY = 0;
  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    vox.computeBoundingSphere(); // the renderer caches it on the first frame, when every voxel is still scaled to 0
    const hits = ray.intersectObjects([vox, arrowMesh, ...CAST.filter(c => c.root.visible).map(c => c.hit)], false);
    if (!hits.length) return null;
    const h = hits[0];
    if (h.object === vox) { const v = voxels[h.instanceId]; return { kind: 'voxel', v, game: v.L.game, point: h.point }; }
    if (h.object === arrowMesh) return { kind: 'arrow', game: 'all', point: h.point };
    return { kind: 'cast', c: CAST.find(c => c.hit === h.object), game: h.object.userData.game, point: h.point };
  }
  function go(game) {
    const el = document.getElementById(GAMES[game].id); if (!el) return;
    setTimeout(() => el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }), reduce ? 0 : 220);
  }
  let down = null;
  box.addEventListener('pointermove', e => {
    const r = box.getBoundingClientRect(); pointer = { x: (e.clientX - r.left) / r.width * 2 - 1, y: (e.clientY - r.top) / r.height * 2 - 1, in: true };
    if (e.pointerType !== 'mouse' || e.target.closest('a')) return;
    const h = pick(e.clientX, e.clientY), key = h && (h.kind === 'voxel' ? h.v.L : h.kind === 'cast' ? h.c : 'arrow');
    if (key !== hovered) {
      hovered = key;
      if (h?.kind === 'voxel') { h.v.L.hop.v += 9; h.v.L.sq.v -= 4; }
      if (h?.kind === 'cast') { h.c.hop.v += 9; h.c.ready?.poke(); }
      if (reduce) requestRender();
    }
    if (h?.kind === 'voxel') h.v.pop.v += 1.2;
    box.style.cursor = h ? 'pointer' : '';
    if (tip) {
      tip.hidden = !h; if (h) { tip.textContent = h.game === 'all' ? 'Play my games ↓' : 'Play ' + GAMES[h.game].name + ' ↓'; tip.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top + 18}px)`; }
    }
  });
  box.addEventListener('pointerleave', () => { pointer.in = false; hovered = null; if (tip) tip.hidden = true; box.style.cursor = ''; });
  box.addEventListener('pointerdown', e => { down = e.target.closest('a') ? null : { x: e.clientX, y: e.clientY }; });
  box.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return; down = null;
    const h = pick(e.clientX, e.clientY), game = h ? h.game : 'all';
    if (h) {
      const col = h.kind === 'voxel' ? h.v.L.col : h.kind === 'arrow' ? new THREE.Color('#b6f36a') : new THREE.Color('#ffffff');
      const p = word.worldToLocal(h.point.clone()); burst(p.x, p.y, p.z, col, 22, 1.1); kick(0.5);
      if (h.kind === 'voxel') { h.v.L.sq.v += 10; h.v.L.flash = 1; } else if (h.kind === 'cast') { h.c.hop.v += 14; h.c.ready?.poke(); } else arrowKick = 1;
    }
    go(game);
  });
  box.addEventListener('pointercancel', () => { down = null; });

  // ---------------- Animation ----------------
  const ease = { in: x => x * x * x, outBack: x => { const c = 2.2; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; } };
  const clamp01 = x => Math.max(0, Math.min(1, x)), smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  function spring(s, dt, k = 190, c = 12) { const n = 3, h = dt / n; for (let i = 0; i < n; i++) { s.v += (-k * s.x - c * s.v) * h; s.x += s.v * h; } }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), tmpC = new THREE.Color(), WHITE = new THREE.Color('#ffffff');
  let t = reduce ? 99 : 0, arrowKick = 0, arrowLanded = reduce, wave = 3.4, tease = 6.6, teased = 0, pour = 0, lastScroll = scrollY, jiggle = 0;
  const pourOf = d => smooth(d * 0.55, d * 0.55 + 0.5, pour);

  // Characters drop in as soon as they're loaded (after the letters are in), one after another.
  let dropSlot = 1.75;
  async function arrive(c, ch) {
    c.root.add(ch.obj); ch.obj.traverse(o => { if (o.isMesh && o !== c.hit) { o.castShadow = true; o.receiveShadow = true; } });
    c.root.rotation.y = c.yaw || 0;
    // Compile its shaders before it appears, so the first draw doesn't hitch right at the landing.
    try { await renderer.compileAsync(c.root, camera, scene); } catch (e) { /* compiles on first draw instead */ }
    c.ready = ch;
    if (reduce) { c.landed = true; c.root.visible = true; c.dropAt = 0; requestRender(); return; }
    c.dropAt = Math.max(t + 0.05, dropSlot); dropSlot = c.dropAt + 0.32;
  }
  // Smallest files first, and only once the letters have slammed in, so first paint stays light.
  const loadCast = () => {
    let chain = Promise.resolve();
    for (const c of [...CAST].sort((a, b) => a.order - b.order)) {
      const p = c.make().catch(() => null); // a missing character never blocks the hero
      chain = chain.then(() => p).then(ch => ch && arrive(c, ch));
    }
  };
  // Fetch only after the page has loaded and the letters are in, when the browser is idle.
  const idle = fn => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));
  const startCast = () => setTimeout(() => idle(loadCast), reduce ? 0 : 900);
  if (document.readyState === 'complete') startCast(); else addEventListener('load', startCast, { once: true });

  function place(c, dt) {
    const s = c.spot();
    let y = s.y, sq = c.sq.x;
    if (!c.landed) {
      const u = (t - c.dropAt) / 0.42;
      if (u >= 1) {
        c.landed = true; c.sq.v -= 9; c.hop.v = 0; kick(0.35);
        const L = LETTERS.find(L => L.game === c.game);
        if (L) { L.sq.v += 6; L.flash = 0.6; }
        if (c.onArrow) arrowKick = 0.6;
        const wp = c.onArrow ? new THREE.Vector3(s.x * ARROW.s, s.y * ARROW.s + arrowPivot.position.y, s.z) : s;
        burst(wp.x, wp.y + 0.1, wp.z, L ? L.col : new THREE.Color('#b6f36a'), 10, 0.7); ring(wp.x, wp.y, wp.z, WHITE, 2.4);
        c.ready.play?.('land');
      } else { y = s.y + 11 * (1 - u * u); sq = -0.18; c.root.rotation.z = (1 - u) * (c.order % 2 ? 0.9 : -0.9); }
      c.root.visible = u >= 0;
    }
    if (c.landed) c.root.rotation.z *= Math.pow(0.001, dt);
    if (dt) { spring(c.sq, dt, 260, 13); spring(c.hop, dt, 120, 9); }
    // The yarn ball rolls back and forth in the crook of the L.
    let x = s.x;
    if (c.game === 'yarn' && c.landed && !reduce) { const k = Math.sin(t * 1.3) * 0.2; x += k; c.ready.ball.rotation.z = -k / c.ready.radius; }
    const tz = teaseAt(x), hop = Math.max(0, c.hop.x) * 0.12 + waveAt(x) * 0.9 - tz * 2.2;
    x -= x * tz * 0.16;
    // Scroll pour: dive toward the arrow's line and fall away.
    const pq = pourOf(c.delay);
    const px = x + (0 - x) * pq * 0.55, py = y + hop - pq * pq * fall;
    c.root.position.set(px, py, s.z + pq * 2 + waveAt(x) * 1.4);
    const ps = 1 - smooth(SHRINK[0] - 0.05, SHRINK[1], pq);
    c.root.scale.set((1 + sq * 0.6) * ps, (1 - sq) * ps, (1 + sq * 0.6) * ps);
    if (pq > 0) c.root.rotation.z = pq * (c.order % 2 ? 4 : -4);
    c.ready.tick(dt, t, c.game === 'mice' ? clamp01(Math.abs(c.hop.v) / 10) : 0);
  }
  // A ripple that runs across the word every few seconds: voxels and characters hop in turn.
  // The tease: 0 -> 1 (pulled down toward the arrow) -> overshoot back -> 0. Letters nearest the arrow go first.
  function teaseAt(x) {
    if (reduce) return 0;
    const u = (t - tease - Math.abs(x) / 7.5 * 0.12) / 1.1;
    if (u <= 0 || u >= 1) return 0;
    if (u < 0.4) { const k = u / 0.4; return k * k * (3 - 2 * k); }
    const w = (u - 0.4) / 0.6; return Math.exp(-w * 6) * Math.cos(w * 14);
  }
  function waveAt(x) {
    if (reduce) return 0;
    const u = (t - wave - (x + 7.5) / 15 * 0.7) / 0.34;
    return u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
  }

  function update(dt) {
    t += dt;
    // Alternate a hop-wave and a 'tease' (the word gets sucked toward the arrow, then snaps back), unless scrolled away.
    if (!reduce && t > wave + 1.4 && wave < tease) wave = tease + 3.4;
    if (!reduce && t > tease + 1.3) { tease = wave + 3.2; teased = 0; }
    if (!reduce && !teased && t > tease) {
      teased = 1; if (pour < 0.05) { CAST.find(c => c.game === 'kitty')?.ready?.play?.('scared'); }
    }
    if (!reduce && teased === 1 && t > tease + 0.42) { teased = 2; arrowKick = 1; kick(0.45); ring(0, ARROW.top - ARROW.len * ARROW.s, 0.2, new THREE.Color('#b6f36a'), 6); }
    // Scroll: pour progress + a jiggle from scroll speed.
    if (!reduce) {
      const r = box.getBoundingClientRect(), start = r.top + scrollY;
      // The collapse starts on the first pixel of scroll and is over while most of the hero is still on screen.
      pour = clamp01(scrollY / Math.max(160, (start + bh) * (phone ? 0.62 : 0.5)));
      jiggle += Math.min(1.5, Math.abs(scrollY - lastScroll) / 120); lastScroll = scrollY; jiggle *= Math.pow(0.02, dt);
    }
    // Letters.
    for (const L of LETTERS) {
      const u = (t - L.slam) / 0.3;
      L.u = u;
      if (u >= 1 && !L.landed) {
        L.landed = true;
        if (!reduce) {
          L.sq.v += 13; L.flash = 1; const last = L === LETTERS[3]; kick(last ? 1.0 : 0.55);
          burst(L.cx, 0.2, 0.6, L.col, last ? 26 : 16, 1); ring(L.cx, 0, 0, L.col, last ? 7 : 4.5);
          if (last) { LETTERS.forEach(o => { o.hop.v += 8; }); box.classList.remove('bang'); void box.offsetWidth; box.classList.add('bang'); }
        }
      }
      spring(L.sq, dt, 230, 11); spring(L.hop, dt, 150, 10); L.flash *= Math.pow(0.004, dt);
      if (jiggle > 0.05) L.sq.v += (Math.random() - 0.5) * jiggle * 2;
    }
    // Voxels: each letter's slam path, squash about its base, the wave, hover pops, and the scroll pour.
    voxels.forEach((v, i) => {
      const L = v.L, u = L.u;
      spring(v.pop, dt, 160, 10);
      if (u < 0) { m4.makeScale(0, 0, 0); vox.setMatrixAt(i, m4); return; }
      const k = u < 1 ? ease.in(u) : 1, far = 1 - k;
      const sq = L.sq.x * 0.055, sy = 1 - sq, sxz = 1 + sq * 0.55;
      const tz = teaseAt(L.cx + v.lx), hop = Math.max(0, L.hop.x) * 0.1 + waveAt(L.cx + v.lx) * 0.85 + Math.max(0, v.pop.x) * 0.06 - tz * (1.3 + v.ly * 0.22);
      pos.set((L.cx + v.lx * sxz) * (1 - tz * 0.16), v.ly * sy + hop + far * 2.5, far * 30 + waveAt(L.cx + v.lx) * 1.4);
      e3.set(far * -0.9, far * L.tilt * 0.5, far * L.tilt);
      const pq = pourOf(v.delay);
      if (pq > 0) {
        pos.x += (0 - pos.x) * pq * 0.6; pos.y -= pq * pq * fall; pos.z += pq * 3;
        e3.x += v.spin.x * pq; e3.y += v.spin.y * pq; e3.z += v.spin.z * pq;
      }
      // Rotate the voxel's offset from the letter's base with the slam tilt, so the letter tumbles as one piece.
      if (far > 0) { const off = new THREE.Vector3(v.lx, v.ly, 0).applyEuler(e3); pos.x = L.cx + off.x; pos.y = off.y + far * 2.5; }
      const ps = 1 - smooth(SHRINK[0], SHRINK[1], pq);
      q.setFromEuler(e3); scl.set(sxz * ps, sy * ps, sxz * ps);
      m4.compose(pos, q, scl); vox.setMatrixAt(i, m4);
      tmpC.copy(v.col).lerp(WHITE, Math.min(1, L.flash * 0.75)); vox.setColorAt(i, tmpC);
    });
    vox.instanceMatrix.needsUpdate = true; vox.instanceColor.needsUpdate = true;

    // Arrow: drops in after the letters, then thumps downward on a beat (anticipation, thrust, recoil).
    const at = t - 1.15;
    let ay = ARROW.top, asx = 1, asy = 1;
    if (at < 0) { arrowPivot.visible = false; } else {
      arrowPivot.visible = true;
      if (at < 0.38) { const u = at / 0.38; ay += 12 * (1 - u * u); asy = 1.25; asx = 0.85; }
      else {
        if (!arrowLanded) { arrowLanded = true; kick(0.6); ring(0, ARROW.top - ARROW.len * ARROW.s, 0.2, new THREE.Color('#b6f36a'), 5); burst(0, ARROW.top - ARROW.len * ARROW.s, 0.4, new THREE.Color('#b6f36a'), 14, 0.8); arrowKick = 1; }
        const b = reduce ? 0.7 : ((t - 1.53) % 1.1) / 1.1;
        if (b < 0.4) { const s = Math.sin(b / 0.4 * Math.PI / 2); ay += 0.35 * s; asy = 1 - 0.12 * s; asx = 1 + 0.08 * s; }
        else if (b < 0.52) { const s = (b - 0.4) / 0.12; ay += 0.35 - 1.6 * s; asy = 0.88 + 0.4 * s; asx = 1.08 - 0.16 * s; }
        else { const s = (b - 0.52) / 0.48, d = Math.exp(-s * 5); ay += -1.25 * d * Math.cos(s * 9); asy = 1 + 0.28 * d * Math.cos(s * 11); asx = 1 - 0.1 * d * Math.cos(s * 11); }
        if (arrowKick > 0) { asy += arrowKick * 0.25 * Math.sin(arrowKick * 20); arrowKick = Math.max(0, arrowKick - dt * 2.5); }
      }
    }
    const apq = pourOf(0);
    arrowPivot.position.set(0, ay - apq * apq * fall * 1.1, apq * 2);
    const as = 1 - smooth(SHRINK[0] - 0.05, SHRINK[1], apq); arrowBody.scale.set(asx * as, asy * (1 + apq * 0.6) * as, asx * as);
    arrowBody.rotation.y = reduce ? 0.3 : Math.sin(t * 1.7) * 0.35;
    // Ghost chevrons stream down out of the arrow's tip, like it's pouring the visitor into the games.
    chevs.forEach(c => {
      const ph = reduce ? c.userData.phase : (t * 0.9 + c.userData.phase) % 1;
      c.visible = at > 0.5;
      c.position.set(0, ay - (ARROW.len + 0.6 + ph * 3.6) * ARROW.s - apq * fall * 0.9, 0.2);
      c.scale.setScalar((1.1 - ph * 0.4) * ARROW.s);
      c.material.opacity = Math.sin(ph * Math.PI) * 0.85 * (1 - apq);
    });

    // Characters.
    for (const c of CAST) if (c.ready && t >= c.dropAt) place(c, dt);

    // Debris + rings.
    parts.forEach((p, i) => {
      if (p.life <= 0) { m4.makeScale(0, 0, 0); pMesh.setMatrixAt(i, m4); return; }
      p.life -= dt; p.v.y -= 26 * dt; p.p.addScaledVector(p.v, dt); p.r.addScaledVector(p.w, dt);
      const s = p.s * Math.min(1, p.life / p.max * 2.2);
      m4.compose(p.p, q.setFromEuler(e3.set(p.r.x, p.r.y, p.r.z)), scl.setScalar(Math.max(0, s))); pMesh.setMatrixAt(i, m4);
    });
    pMesh.instanceMatrix.needsUpdate = true;
    for (const r of rings) {
      if (!r.visible) continue;
      r.userData.t += dt / 0.5; const u = r.userData.t;
      if (u >= 1) { r.visible = false; continue; }
      r.scale.setScalar(0.5 + (1 - (1 - u) ** 3) * r.userData.size); r.material.opacity = (1 - u) * 0.9;
    }

    // Camera: framed on the box, swayed by the pointer, shaken by impacts.
    const tx = pointer.in ? pointer.x : Math.sin(t * 0.4) * 0.35, ty = pointer.in ? pointer.y : 0;
    tiltX += (tx - tiltX) * Math.min(1, dt * 4); tiltY += (ty - tiltY) * Math.min(1, dt * 4);
    world.rotation.y = BASE.y + tiltX * 0.2; world.rotation.x = BASE.x + tiltY * 0.07;
    shake *= Math.pow(0.0025, dt);
    const V = camera.userData.view, sk = reduce ? 0 : shake, j = () => (Math.random() - 0.5) * sk;
    camera.position.copy(V.target).addScaledVector(V.dir, V.dist).add(pos.set(j() * 0.9, j() * 0.9, 0));
    camera.lookAt(V.target.x + j() * 0.3, V.target.y + j() * 0.3, V.target.z);
    camera.rotation.z += (Math.random() - 0.5) * sk * 0.03;
  }

  // ---------------- Loop: only while the hero is on screen and the tab is visible ----------------
  let running = false, last = 0, visible = true, painted = false, raf = 0;
  const stats = window.__hero = { frames: 0, cpu: 0, upd: 0, reduce, get t() { return t; }, get pour() { return pour; } };
  function frame(now) {
    raf = 0; if (!running) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    const c0 = performance.now(); update(dt); const c1 = performance.now(); renderer.render(scene, camera); stats.upd += c1 - c0; stats.cpu += performance.now() - c0; stats.frames++;
    if (!painted) { painted = true; box.classList.add('live'); }
    raf = requestAnimationFrame(frame);
  }
  function setRunning(on) {
    on = on && visible && !document.hidden && !reduce;
    canvas.style.visibility = visible ? '' : 'hidden';
    if (on === running) return; running = on;
    if (on) { last = 0; raf = requestAnimationFrame(frame); } else if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }
  // Test hook: stop the loop and step the animation to an exact time (deterministic frames for screenshots).
  stats.seek = target => { setRunning(false); visible = false; canvas.style.visibility = ''; while (t < target - 1e-6) update(Math.min(1 / 60, target - t)); renderer.render(scene, camera); };
  let pending = false;
  function requestRender() {
    if (!reduce || pending) return; pending = true;
    requestAnimationFrame(() => { pending = false; update(0); renderer.render(scene, camera); if (!painted) { painted = true; box.classList.add('live'); } });
  }
  layout();
  addEventListener('resize', () => { layout(); requestRender(); });
  document.addEventListener('visibilitychange', () => setRunning(true));
  if ('IntersectionObserver' in window) new IntersectionObserver(es => { visible = es[es.length - 1].isIntersecting; setRunning(true); }, { rootMargin: '0px 0px 0px 0px' }).observe(box);
  if (reduce) { LETTERS.forEach(L => { L.landed = true; }); requestRender(); } else setRunning(true);
}
