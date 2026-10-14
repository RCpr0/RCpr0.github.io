// Sand Flow renderer: the shipped models, textures and sounds (converted), a sand picture drawn from the live sim every
// frame with the shipped per-colour sand gradients, a U-shaped belt that wraps the picture, and the cart grid with every
// mechanic the chosen levels use (mystery carts, generators, wooden crates, keys and padlocks). Rules live in core.js.
import { SandFlowGame, DT } from './core.js';
import { PALETTE } from './sim/palette.js';
import { COLORS } from './colors.js';
import { chooseEager } from './policy.js';
import { loadModel, loadTexture, tweenList, easeOutBack, easeInOut, easeOutCubic, disposeScene, gloss, matte, addRig, castShadows, fitPerspective, hoverSprings } from '../common.js';
import { RoundedBoxGeometry } from '../../vendor/RoundedBoxGeometry.js';

// Shipped levels: mystery carts, generators, wooden crates, keys + locks (with crates), and all of them together.
const LEVELS = [106, 139, 140, 47, 146];
const CELL = 0.7, PIC = 3.6, BELT_Z = -0.95, R = 0.42, BACK = 2.5, CAM_PITCH = 59.5 * Math.PI / 180, GRID_Z0 = BELT_Z + 0.95;
const CART_S = 1.12, BLOCKED_S = 0.9, TAP_Y = 0.2; // shipped GridScale 1 / BlockedScale 0.9
const PAL = new Map(PALETTE.map(p => [p.ct, [p.r / 255, p.g / 255, p.b / 255]]));
const cartRGB = ct => COLORS[ct]?.cart || PAL.get(ct) || [0.8, 0.8, 0.8];
const sandKeys = ct => COLORS[ct]?.sand?.length === 2 ? COLORS[ct].sand : [PAL.get(ct) || [1, 1, 1], (PAL.get(ct) || [1, 1, 1]).map(v => v * 0.85)];
const KEY_CT = [3, 2, 8, 11]; // LockKeyColorConfig: index 0 yellow, 1 red, 2 blue (3 is unconfigured in the asset: green)
const PRAISE = ['Nice!', 'Great!', 'Awesome!', 'Amazing!', 'Sand-tastic!'];

export async function create(ctx) {
  let dead = false;
  const { THREE, base } = ctx;
  const [cartM, outlineM, cellM, wallM, crateM, padM, keyM, genM, beltTex, specTex, atlasTex, genTex, glowTex, levels, play] = await Promise.all([
    loadModel(base + 'Cart.json'), loadModel(base + 'Cart_Outline.json'), loadModel(base + 'Cell.json'), loadModel(base + 'WallEdgy.json'),
    loadModel(base + 'crate.json'), loadModel(base + 'padlock.json'), loadModel(base + 'key.json'), loadModel(base + 'generator.json'),
    loadTexture(base + 'belt.webp', { repeat: true }), loadTexture(base + 'cartspec.webp', { srgb: false }),
    loadTexture(base + 'atlas.webp'), loadTexture(base + 'generator.webp'), loadTexture(base + 'glow.webp'),
    Promise.all(LEVELS.map(n => fetch(`${base}level${n}.json`).then(r => r.json()))),
    ctx.loadSounds({ tap: 'tap.mp3', error: 'error.mp3', pour: 'pour.mp3', pop: 'pop.mp3', vanish: 'vanish.mp3', win: 'win.mp3', lose: 'lose.mp3',
      unlock: 'unlock.mp3', sparkle: 'sparkle.mp3', confetti: 'confetti.mp3', nospace: 'nospace.mp3', roll: 'roll.mp3' }),
  ]);
  const sfx = (n, o) => { if (!dead) play(n, o); };

  // Transparent scene: the board floats on the section colour, anchored by a soft shadow.
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  addRig(scene, { size: 8, floorY: -0.32, center: new THREE.Vector3(0, 0, 0.8) });
  const tweens = tweenList(), fxTweens = tweenList();

  // ---- Picture: a sand texture on a billboard standing behind the belt, inside a pale frame ----
  const sandData = new Uint8Array(128 * 128 * 4), sandTex = new THREE.DataTexture(sandData, 128, 128);
  sandTex.magFilter = THREE.NearestFilter; sandTex.colorSpace = THREE.SRGBColorSpace;
  const picture = new THREE.Group(); scene.add(picture);
  const frameMat = new THREE.MeshBasicMaterial({ color: '#f1edff', toneMapped: false });
  const frame = new THREE.Mesh(roundedRect(THREE, PIC + 0.4, PIC + 0.4, 0.24), frameMat);
  const frameIn = new THREE.Mesh(roundedRect(THREE, PIC + 0.12, PIC + 0.12, 0.1), new THREE.MeshBasicMaterial({ color: '#8f86b8', toneMapped: false })); frameIn.position.z = 0.005;
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(PIC, PIC), new THREE.MeshBasicMaterial({ map: sandTex, toneMapped: false })); pic.position.z = 0.01;
  const frameBack = new THREE.Mesh(new RoundedBoxGeometry(PIC + 0.4, PIC + 0.4, 0.16, 3, 0.08), gloss('#cfc6f5')); frameBack.position.z = -0.09;
  picture.add(frameBack, frame, frameIn, pic); castShadows(frameBack);

  // ---- Belt: a rounded-rectangle loop. pathT 0..0.5 runs left to right under the picture (sand x 0..127) ----
  const belt = beltPath(THREE);
  const beltMat = gloss('#ffffff', beltTex, { clearcoat: 0.3 }); beltMat.side = THREE.DoubleSide;
  const ribbon = new THREE.Mesh(ribbonGeometry(THREE, belt, 0.66), beltMat); ribbon.position.y = 0.02; ribbon.receiveShadow = true; scene.add(ribbon);
  const railBase = new THREE.Color('#e4ddff'), railWarn = new THREE.Color('#ff4d5e'), railMat = gloss('#e4ddff', null, { clearcoat: 1 });
  for (const off of [-0.38, 0.38]) {
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(belt.sample(160, off), true), 240, 0.07, 8, true), railMat);
    m.position.y = 0.08; m.castShadow = true; scene.add(m);
  }

  // ---- Shared geometry and materials ----
  // The cart is re-centred so it can flip about its middle (shipped Bucket.SetRotation turns it 180 degrees on X).
  const cH = cartM.max.y - cartM.min.y, cC = cartM.min.clone().add(cartM.max).multiplyScalar(0.5);
  const centre = g => g.clone().translate(-cC.x, -cC.y, -cC.z);
  const cartParts = cartM.parts.map(p => ({ wheel: /Wheel|Tyre/i.test(p.name), geometry: centre(p.geometry) }));
  const outlineGeo = outlineM.parts.map(p => centre(p.geometry));
  const tyreMat = gloss('#2c2342', null, { roughness: 0.5, clearcoat: 0.4 });
  const outlineMat = new THREE.MeshBasicMaterial({ color: '#1f1733', side: THREE.BackSide });
  const cartMats = new Map();
  // Glossy toy plastic in the shipped per-colour cart tint; the shipped Cart_Spec highlight map adds the painted shine.
  const cartMat = ct => {
    if (!cartMats.has(ct)) {
      const [r, g, b] = cartRGB(ct), m = gloss(new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace), null, { roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, emissiveMap: specTex, emissive: '#ffffff', emissiveIntensity: 0.22 });
      m.side = THREE.DoubleSide; cartMats.set(ct, m);
    }
    return cartMats.get(ct);
  };
  const mysteryMat = gloss('#4a4560', null, { roughness: 0.35, clearcoat: 1, emissiveMap: specTex, emissive: '#ffffff', emissiveIntensity: 0.18 }); mysteryMat.side = THREE.DoubleSide;
  const sandMats = new Map(), sandMat = ct => { if (!sandMats.has(ct)) { const [k0] = sandKeys(ct); sandMats.set(ct, matte(new THREE.Color().setRGB(k0[0], k0[1], k0[2], THREE.SRGBColorSpace), null, { roughness: 1 })); } return sandMats.get(ct); };
  const sandGeo = new RoundedBoxGeometry(0.43, 1, 0.36, 2, 0.03), sandFloor = -0.12 - cC.y, sandTop = 0.215 - cC.y;
  const shadowTex = blobTexture(THREE), shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 });
  const cellMat = gloss('#a69ff0', null, { clearcoat: 0.5, roughness: 0.45 }), wallMat = gloss('#7d6bc4', null, { roughness: 0.6, clearcoat: 0.2 }), slabMat = matte('#4a3b78');
  const wellMat = matte('#3a2d63'), plateMat = matte('#5b4a8f');
  const crateMat = matte('#ffffff', atlasTex, { roughness: 0.7 }), genMat = matte('#ffffff', genTex, { roughness: 0.75 });
  const keyMats = KEY_CT.map(ct => { const [r, g, b] = cartRGB(ct); return gloss(new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace), null, { metalness: 0.35, roughness: 0.25, clearcoat: 1 }); });

  const fx = effects(THREE, glowTex); scene.add(fx.group);
  const hud = makeHud(ctx.ui);

  let G, lvl = 0, gridRoot, views = new Map(), onBelt = new Map(), mechViews = [], auto = false, speed = 1, acc = 0;
  let ending = 0, endShown = false, danger = 0, pourT = 0, combo = 0, comboT = 0, startT = 0;

  // ---- A cart: g (position, hover scale) > lift (hops, squash, blocked scale) > body (flip) ----
  function makeCart(ct, { mystery = false } = {}) {
    const g = new THREE.Group(), lift = new THREE.Group(), body = new THREE.Group();
    g.add(lift); lift.add(body); body.position.y = (cH / 2) * CART_S; body.scale.setScalar(CART_S);
    const meshes = [];
    for (const p of cartParts) { const m = new THREE.Mesh(p.geometry, p.wheel ? tyreMat : (mystery ? mysteryMat : cartMat(ct))); m.userData.wheel = p.wheel; if (p.wheel) m.scale.set(1.12, 1.12, 1.12); body.add(m); meshes.push(m); }
    const outline = new THREE.Group(); for (const geo of outlineGeo) outline.add(new THREE.Mesh(geo, outlineMat)); body.add(outline);
    const sand = new THREE.Mesh(sandGeo, sandMat(ct)); sand.visible = false; body.add(sand);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat); shadow.scale.set(0.78, 1, 0.7); shadow.position.y = 0.012; shadow.renderOrder = 1; g.add(shadow);
    castShadows(body);
    return { g, lift, body, meshes, outline, sand, shadow, ct, up: true, fill: 0 };
  }
  function setCartColour(v, ct, mystery) {
    v.ct = ct; for (const m of v.meshes) if (!m.userData.wheel) m.material = mystery ? mysteryMat : cartMat(ct);
    v.sand.material = sandMat(ct);
  }
  // Blocked carts sit upside down and smaller, without wheels or outline; they flip up with a hop when a path opens.
  function setFacing(v, up, animate) {
    if (v.up === up) return; v.up = up;
    for (const m of v.meshes) if (m.userData.wheel) m.visible = up;
    v.outline.visible = up;
    const to = up ? 0 : Math.PI, s1 = up ? 1 : BLOCKED_S;
    if (!animate || ctx.reduce) { v.body.rotation.x = to; v.lift.scale.setScalar(s1); return; }
    const from = v.body.rotation.x, s0 = v.lift.scale.y;
    tweens.add(0.36, k => { v.body.rotation.x = from + (to - from) * k; v.lift.scale.setScalar(s0 + (s1 - s0) * k); v.lift.position.y = Math.sin(k * Math.PI) * 0.45; }, easeInOut, () => squash(v, 0.16));
  }
  function squash(v, a = 0.14, d = 0.24) {
    if (ctx.reduce) return;
    const s = v.up ? 1 : BLOCKED_S;
    tweens.add(d, k => { const w = Math.sin(k * Math.PI * 2.2) * (1 - k) * a; v.lift.scale.set(s * (1 + w), s * (1 - w), s * (1 + w)); }, x => x, () => v.lift.scale.setScalar(s));
  }
  function dropLabel(l) { l.sprite.removeFromParent(); l.sprite.material.map.dispose(); l.sprite.material.dispose(); }
  // Everything a level made for itself (the shared geometry and materials stay).
  function disposeLevel(root) { root.traverse(o => { if (o.userData.own) o.geometry?.dispose(); if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); } }); }
  function label(w = 128, h = 72) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, toneMapped: false })); sp.renderOrder = 10;
    let last = null;
    return { sprite: sp, set(text, { bg = '#2a2142', fg = '#ffffff', size = 46 } = {}) {
      const key = text + bg + fg; if (key === last) return; last = key;
      const c = cv.getContext('2d'); c.clearRect(0, 0, w, h);
      if (bg) { c.fillStyle = 'rgba(20,10,40,.35)'; rr(c, 6, 10, w - 12, h - 14, 18); c.fill(); c.fillStyle = bg; rr(c, 6, 6, w - 12, h - 14, 18); c.fill(); }
      c.font = `900 ${size}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 8; c.strokeStyle = 'rgba(30,18,60,.9)'; c.strokeText(text, w / 2, h / 2); c.fillStyle = fg; c.fillText(text, w / 2, h / 2);
      tex.needsUpdate = true;
    } };
  }

  // ---- Level build ----
  function build() {
    hov.clear(); tweens.clear(); fxTweens.clear(); fx.clear(); hud.clearPops();
    if (gridRoot) { scene.remove(gridRoot); disposeLevel(gridRoot); }
    for (const v of onBelt.values()) { scene.remove(v.g); disposeLevel(v.g); }
    G = new SandFlowGame(levels[lvl]); ctx.setLevel(`Level ${LEVELS[lvl]}`); ctx.hideResult();
    gridRoot = new THREE.Group(); scene.add(gridRoot);
    views = new Map(); onBelt = new Map(); mechViews = []; acc = 0; ending = 0; endShown = false; danger = 0; combo = 0; comboT = 0; startT = 0;
    railMat.color.copy(railBase); railMat.emissive.setRGB(0, 0, 0); picture.scale.setScalar(1);
    const { gridWidth: rows, gridHeight: cols } = levels[lvl];
    { // slab under the belt and grid
      const z0 = BELT_Z - BACK - 0.75, z1 = GRID_Z0 + (rows - 0.5) * CELL + 0.5, w = Math.max(PIC + 2 * R + 1.3, cols * CELL + 0.9);
      const slab = new THREE.Mesh(new RoundedBoxGeometry(w, 0.34, z1 - z0, 4, 0.16), slabMat); slab.position.set(0, -0.19, (z0 + z1) / 2); slab.receiveShadow = true; slab.userData.own = true; gridRoot.add(slab);
      const well = new THREE.Mesh(new RoundedBoxGeometry(cols * CELL + 0.22, 0.06, rows * CELL + 0.22, 3, 0.03), wellMat); well.position.set(0, -0.02, GRID_Z0 + (rows - 1) / 2 * CELL); well.receiveShadow = true; well.userData.own = true; gridRoot.add(well);
    }
    for (const w of G.walls()) {
      const g = new THREE.Group(); for (const p of wallM.parts) g.add(new THREE.Mesh(p.geometry, wallMat));
      g.position.copy(cellPos(w.x, w.y)); g.position.y += 0.2; g.scale.setScalar(CELL / 0.72); castShadows(g); gridRoot.add(g);
    }
    for (let x = 0; x < rows; x++) for (let y = 0; y < cols; y++) {
      if (G.grid.getCell({ x, y }).isWall) continue;
      const cm = new THREE.Mesh(cellM.parts[0].geometry, cellMat); cm.position.copy(cellPos(x, y)); cm.scale.setScalar(CELL / 0.64 * 0.97); cm.receiveShadow = true; gridRoot.add(cm);
    }
    for (const m of G.mechanics()) mechViews.push(makeMechanic(m));
    sync(false);
    if (!ctx.reduce) { // the board pops in
      let i = 0; for (const v of views.values()) { const d = 0.012 * i++, s = v.lift.scale.x; v.lift.scale.setScalar(0.001); tweens.add(0.32 + d, k => v.lift.scale.setScalar(Math.max(0.001, s * easeOutBack(Math.max(0, (k * (0.32 + d) - d) / 0.32)))), x => x); }
    }
    fit(); drawSand(); hud.belt(0, false);
  }
  const cols = () => levels[lvl].gridHeight;
  function cellPos(x, y) { return new THREE.Vector3((y - (cols() - 1) / 2) * CELL, 0.03, GRID_Z0 + x * CELL); }

  // Generators (shipped Generator.fbx, track facing the spawn cell), padlocks and keys.
  function makeMechanic(m) {
    const g = new THREE.Group(); g.position.copy(cellPos(m.x, m.y)); gridRoot.add(g);
    const v = { ...m, g };
    if (m.kind === 'stack') {
      for (const p of genM.parts) g.add(new THREE.Mesh(p.geometry, genMat));
      g.rotation.y = [Math.PI, 0, -Math.PI / 2, Math.PI / 2][m.direction] ?? 0; g.scale.setScalar(CELL / 0.62);
      v.label = label(); v.label.sprite.scale.set(0.5, 0.29, 1); v.label.sprite.position.set(0, 0.9, 0); g.add(v.label.sprite);
    } else if (m.kind === 'lock') {
      const mat = keyMats[m.keyColorIndex] || keyMats[3];
      const plate = new THREE.Mesh(new RoundedBoxGeometry(CELL * 0.86, 0.16, CELL * 0.86, 3, 0.06), plateMat); plate.position.y = 0.08; plate.userData.own = true; g.add(plate);
      const lock = new THREE.Group(); for (const p of padM.parts) lock.add(new THREE.Mesh(p.geometry, mat));
      lock.rotation.x = 1.15; lock.position.set(0, 0.42, 0.02); lock.scale.setScalar(1.45); g.add(lock); v.lock = lock;
    } else if (m.kind === 'key') {
      const key = new THREE.Group(); for (const p of keyM.parts) key.add(new THREE.Mesh(p.geometry, keyMats[m.keyColorIndex] || keyMats[3]));
      key.rotation.set(-0.7, 0, 0.5); key.position.y = 0.4; key.scale.setScalar(1.9); g.add(key); v.key = key;
      const sh = new THREE.Mesh(shadowGeo, shadowMat); sh.scale.setScalar(0.5); sh.position.y = 0.04; g.add(sh);
    }
    castShadows(g);
    return v;
  }

  // Make the 3D board match the grid: new carts appear (from a generator if one feeds that cell), flips, mystery
  // reveals, crates counting down and breaking, keys flying to their locks.
  function sync(animate) {
    const live = G.carts(), seen = new Set();
    for (const c of live) {
      seen.add(c.id);
      let v = views.get(c.id);
      if (!v) {
        v = makeCart(c.ct, { mystery: c.mystery }); v.id = c.id; v.mystery = c.mystery; v.ice = 0; views.set(c.id, v); gridRoot.add(v.g);
        v.g.position.copy(cellPos(c.x, c.y)); setFacing(v, c.hasPath, false);
        const gen = mechViews.find(m => m.kind === 'stack' && cellIs(m, c));
        if (animate && gen && !ctx.reduce) { // rolls out of the generator
          const from = gen.g.position.clone(), to = v.g.position.clone(); v.lift.scale.setScalar(0.3);
          tweens.add(0.3, k => { v.g.position.lerpVectors(from, to, k); v.lift.position.y = Math.sin(k * Math.PI) * 0.3; v.lift.scale.setScalar(0.3 + 0.7 * k); }, easeOutCubic, () => squash(v));
        } else if (animate && !ctx.reduce) { v.lift.scale.setScalar(0.01); tweens.add(0.3, k => v.lift.scale.setScalar(Math.max(0.01, easeOutBack(k) * (v.up ? 1 : BLOCKED_S))), x => x); }
      }
      v.x = c.x; v.y = c.y; v.available = c.available;
      if (c.ice > 0 && !v.crate) addCrate(v, c.ice);
      if (v.crate) {
        if (c.ice > 0) { v.crateLabel.set(String(c.ice), { bg: null, size: 54 }); if (animate && c.ice !== v.ice && !ctx.reduce) { const cr = v.crate; tweens.add(0.22, k => cr.scale.set(1 + 0.1 * Math.sin(k * Math.PI), 1 - 0.08 * Math.sin(k * Math.PI), 1 + 0.1 * Math.sin(k * Math.PI))); } }
        else breakCrate(v, animate);
      }
      v.ice = c.ice;
      v.body.visible = !v.crate;
      if (v.mystery && !c.mystery) revealMystery(v, c.ct, animate);
      if (v.mystery) placeTag(v);
      setFacing(v, c.hasPath, animate);
    }
    for (const [id, v] of views) if (!seen.has(id)) { gridRoot.remove(v.g); views.delete(id); }
    const mech = G.mechanics();
    for (const mv of mechViews) {
      const now = mech.find(m => m.kind === mv.kind && m.x === mv.x && m.y === mv.y);
      if (mv.kind === 'stack') { const n = now ? now.remaining : 0; mv.label.set(n > 0 ? String(n) : '0', { bg: n > 0 ? '#ff8a3d' : '#8d86a8', size: 42 }); }
      else if (!now && !mv.gone) { mv.gone = true; if (mv.kind === 'key') flyKey(mv, animate); }
    }
  }
  const cellIs = (gen, c) => { const s = [[-1, 0], [1, 0], [0, -1], [0, 1]][gen.direction]; return gen.x + s[0] === c.x && gen.y + s[1] === c.y; };
  function placeTag(v) {
    if (!v.tag) { v.tag = label(96, 96); v.tag.set('?', { bg: null, size: 72 }); v.tag.sprite.scale.set(0.34, 0.34, 1); v.lift.add(v.tag.sprite); }
    v.tag.sprite.position.set(0, cH * CART_S + 0.12, 0);
  }
  function revealMystery(v, ct, animate) {
    v.mystery = false; setCartColour(v, ct, false);
    if (v.tag) { dropLabel(v.tag); v.tag = null; }
    if (animate && !ctx.reduce) { fx.glow(v.g.position.clone().setY(0.4), cartRGB(ct), 0.9); fx.confetti(v.g.position.clone().setY(0.4), [cartRGB(ct)], 10, 0.6); sfx('sparkle', { volume: 0.4, rate: 1.1 }); squash(v, 0.22); }
  }
  function addCrate(v, n) {
    const cr = new THREE.Group(); for (const p of crateM.parts) if (p.name === 'Wood_Box') cr.add(new THREE.Mesh(p.geometry, crateMat));
    cr.scale.setScalar(CELL / 0.56); castShadows(cr); v.crate = cr; v.g.add(cr);
    v.crateLabel = label(); v.crateLabel.sprite.scale.set(0.5, 0.28, 1); v.crateLabel.sprite.position.set(0, 0.62, 0.05); v.g.add(v.crateLabel.sprite);
    v.crateLabel.set(String(n), { bg: null, size: 54 });
  }
  function breakCrate(v, animate) {
    const cr = v.crate, lab = v.crateLabel; v.crate = null; v.crateLabel = null; v.body.visible = true; dropLabel(lab);
    if (!animate || ctx.reduce) { v.g.remove(cr); return; }
    const p = v.g.position.clone().setY(0.35), fadeMat = crateMat.clone(); fadeMat.transparent = true;
    fx.confetti(p, [[0.75, 0.45, 0.2], [0.55, 0.3, 0.12], [0.95, 0.7, 0.4]], 26, 1.2, 0.07); fx.glow(p, [1, 0.85, 0.6], 1.1);
    sfx('pop', { rate: 0.8 }); sfx('sparkle', { volume: 0.5 }); ctx.shake(0.35);
    tweens.add(0.25, k => { cr.scale.setScalar(CELL / 0.56 * (1 + 0.35 * k)); cr.traverse(o => { if (o.material) { o.material = o.material === crateMat ? fadeMat : o.material; } }); fadeMat.opacity = 1 - k; }, x => x, () => { v.g.remove(cr); fadeMat.dispose(); });
    squash(v, 0.25);
  }
  function flyKey(mv, animate) {
    const lock = mechViews.find(l => l.kind === 'lock' && l.keyColorIndex === mv.keyColorIndex && !l.opened);
    const done = () => { gridRoot.remove(mv.g); if (lock) { lock.opened = true; gridRoot.remove(lock.g); } };
    if (!animate || ctx.reduce || !lock) { done(); return; }
    const from = mv.g.position.clone(), to = lock.g.position.clone(), rgb = cartRGB(KEY_CT[mv.keyColorIndex] ?? 11);
    sfx('unlock');
    tweens.add(0.55, k => { mv.g.position.lerpVectors(from, to, k); mv.g.position.y = from.y + Math.sin(k * Math.PI) * 1.1; mv.key.rotation.y = k * Math.PI * 4; }, easeInOut, () => {
      lock.opened = true; const lp = lock.g.position.clone().setY(0.45);
      tweens.add(0.3, k => { lock.lock.position.y = 0.42 + k * 0.5; lock.lock.rotation.z = k * 1.2; lock.g.scale.setScalar(1 - k * 0.999); }, easeOutCubic, () => gridRoot.remove(lock.g));
      gridRoot.remove(mv.g); fx.glow(lp, rgb, 1.4); fx.confetti(lp, [rgb, [1, 1, 1]], 30, 1.4); ctx.shake(0.5); sfx('sparkle');
    });
  }

  // ---- Camera: the shipped 59.5-degree pitch, a 30-degree perspective lens fitted to the picture, belt and grid ----
  function fit() {
    const aspect = (ctx.el.clientWidth || 1) / (ctx.el.clientHeight || 1);
    const rows = levels[lvl].gridWidth, gridBottom = GRID_Z0 + (rows - 0.5) * CELL, dir = new THREE.Vector3(0, Math.sin(CAM_PITCH), Math.cos(CAM_PITCH));
    const look = new THREE.Object3D(); look.position.copy(dir); look.lookAt(0, 0, 0); look.rotateY(Math.PI);
    picture.quaternion.copy(look.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(look.quaternion);
    picture.position.set(0, 0.05, BELT_Z - 0.85).addScaledVector(up, PIC / 2 + 0.28); picture.updateMatrixWorld();
    const half = PIC / 2 + 0.2, pts = [new THREE.Vector3(-half, half, 0), new THREE.Vector3(half, half, 0)].map(p => picture.localToWorld(p));
    const gw = (cols() / 2) * CELL + 0.2;
    pts.push(new THREE.Vector3(-PIC / 2 - R - 0.45, 0, BELT_Z + 0.4), new THREE.Vector3(PIC / 2 + R + 0.45, 0, BELT_Z + 0.4), new THREE.Vector3(-gw, 0, gridBottom + 0.45), new THREE.Vector3(gw, 0, gridBottom + 0.45));
    fitPerspective(camera, pts, aspect, { dir, top: 0.15, bottom: 0.16 });
  }

  // ---- Input: tap a cell (raycast at cart mid-height) ----
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TAP_Y), hit = new THREE.Vector3();
  function cellAt(e) {
    const r = ctx.el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return { x: Math.round((hit.z - GRID_Z0) / CELL), y: Math.round(hit.x / CELL + (cols() - 1) / 2) };
  }
  function onPointer(e) { if (auto || G.over) return; const c = cellAt(e); if (c) tap(c.x, c.y); }
  function onHover(e) {
    if (auto || G.over) return hov.set(null);
    const c = cellAt(e), v = c && [...views.values()].find(v => v.x === c.x && v.y === c.y && v.available);
    hov.set(v ? v.g : null);
  }
  ctx.canvas.addEventListener('pointerdown', onPointer);
  const hov = hoverSprings(), leave = () => hov.set(null);
  ctx.el.addEventListener('pointermove', onHover); ctx.el.addEventListener('pointerleave', leave);
  ctx.canvas.style.touchAction = 'none';

  function tap(x, y) {
    const v = [...views.values()].find(v => v.x === x && v.y === y);
    const r = G.tap(x, y);
    if (!r.ok) {
      if (v && r.why !== 'over') { // shipped Bucket shake + Tap Error
        sfx('error', { volume: 0.5 }); const p0 = v.g.position.x;
        tweens.add(0.3, k => { v.g.position.x = p0 + Math.sin(k * Math.PI * 5) * 0.07 * (1 - k); }, x => x, () => { v.g.position.x = p0; });
        if (r.why === 'full') hud.flashBelt();
      }
      return r;
    }
    sfx('tap', { rate: 0.95 + Math.random() * 0.1 }); sfx('roll', { volume: 0.25, rate: 1.2 });
    views.delete(v.id); hov.set(null);
    const b = r.bucket; onBelt.set(b, Object.assign(v, { arriving: true, bucket: b }));
    v.sand.visible = true; v.sand.scale.y = 0.001;
    // Drive along the path to the belt edge (shipped MoveAlongPath, speed 15), then jump onto the belt (power 2, 0.2 s) with a squash punch.
    const pts = r.path.map(c => cellPos(c.x, c.y)); pts.push(cellPos(-1, r.path.at(-1).y).setZ(BELT_Z + 0.55));
    const dur = ctx.reduce ? 0.01 : Math.max(0.12, (pts.length - 1) * 0.065);
    squash(v, 0.12, 0.16);
    tweens.add(dur, k => { const f = k * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), t = f - i; v.g.position.lerpVectors(pts[i], pts[i + 1], t); }, easeInOut, () => {
      const wp = v.g.getWorldPosition(new THREE.Vector3()); gridRoot.remove(v.g); scene.add(v.g); v.g.position.copy(wp);
      const from = wp.clone(), yaw0 = v.g.rotation.y;
      tweens.add(ctx.reduce ? 0.01 : 0.2, k => {
        const to = belt.at(b.pathT), d = belt.dir(b.pathT); v.g.position.lerpVectors(from, to, k); v.g.position.y = to.y + Math.sin(k * Math.PI) * 0.55;
        v.g.rotation.y = yaw0 + (Math.atan2(d.x, d.z) - yaw0) * k;
      }, x => x, () => {
        v.arriving = false; squash(v, 0.2, 0.22); fx.dust(v.g.position.clone(), 6);
        sfx('pop', { volume: 0.35, rate: 1.3 });
      });
    });
    sync(true);
    return r;
  }

  // ---- Sand: each grain shaded between the colour's two shipped gradient keys; empty cells show the frame's back ----
  const noise = new Float32Array(128 * 128).map((_, i) => { const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); });
  const ramp = new Map(); for (const ct of new Set([...PAL.keys(), ...Object.keys(COLORS).map(Number)])) { const [a, b] = sandKeys(ct); ramp.set(ct, [a.map(v => v * 255), b.map(v => v * 255)]); }
  function drawSand() {
    const s = G.sand, grid = s._grid, ct = s._colorTypes;
    for (let i = 0; i < 128 * 128; i++) {
      const o = i * 4;
      if (!grid[i]) { const k = 0.94 + noise[i] * 0.06; sandData[o] = 205 * k; sandData[o + 1] = 199 * k; sandData[o + 2] = 232 * k; sandData[o + 3] = 255; continue; }
      const rp = ramp.get(ct[i]); if (!rp) { sandData[o] = sandData[o + 1] = sandData[o + 2] = 255; sandData[o + 3] = 255; continue; }
      const t = noise[i], a = rp[0], b = rp[1];
      sandData[o] = a[0] + (b[0] - a[0]) * t; sandData[o + 1] = a[1] + (b[1] - a[1]) * t; sandData[o + 2] = a[2] + (b[2] - a[2]) * t; sandData[o + 3] = 255;
    }
    sandTex.needsUpdate = true;
  }
  const picBottom = new THREE.Vector3();
  function sandSource(b) { // world point on the picture's bottom edge above the cart's suction column
    const sx = Math.min(127, Math.max(0, b.gridXPosition)); picBottom.set((sx / 128 - 0.5) * PIC, -PIC / 2 + 0.25, 0.05); return picture.localToWorld(picBottom.clone());
  }

  function update(dt) {
    hov.update(dt);
    if (!G) return;
    startT += dt;
    let n = 0, collecting = false; acc += dt * speed;
    while (acc >= DT && n < 240) {
      if (auto) autoStep();
      const r = G.step(); acc -= DT; n++;
      if (!r) { acc = 0; break; }
      for (const [b, got] of r.collected) { collecting = true; const v = onBelt.get(b); if (v && !v.arriving && Math.random() < Math.min(1, got / 25)) fx.grain(sandSource(b), v, sandKeys(b.colorType)); }
      for (const b of r.filled) bucketFull(b);
      danger = r.danger;
    }
    if (!G.over) hud.belt(G.belt.occupiedSpots, danger > 0.15);
    pourT -= dt; if (collecting && pourT <= 0) { sfx('pour', { volume: 0.22, rate: 0.95 + Math.random() * 0.1 }); pourT = 1.6; }
    comboT -= dt; if (comboT <= 0) combo = 0;
    drawSand();
    beltTex.offset.y = (beltTex.offset.y - dt * (G.over ? 0 : 0.7) * speed) % 1;
    // Danger: the belt is full and nothing is being collected. Rails pulse red faster and faster, carts tremble.
    const pulse = danger > 0.15 ? (0.5 + 0.5 * Math.sin(startT * (8 + danger * 22))) * Math.min(1, danger * 1.6) : 0;
    if (!G.over) { railMat.color.copy(railBase).lerp(railWarn, pulse); railMat.emissive.setRGB(pulse * 0.5, 0, pulse * 0.08); }
    for (const [b, v] of onBelt) {
      if (v.arriving || v.leaving) continue;
      const p = belt.at(b.pathT), d = belt.dir(b.pathT);
      v.g.position.copy(p); v.g.rotation.y = Math.atan2(d.x, d.z);
      if (danger > 0.3 && !ctx.reduce && !G.over) { v.g.position.x += (Math.random() - 0.5) * 0.05 * danger; v.g.rotation.z = (Math.random() - 0.5) * 0.12 * danger; } else if (!G.over) v.g.rotation.z = 0;
      v.g.visible = !belt.behind(b.pathT);
      const f = b.capacity / b.totalCapacity; v.fill += (f - v.fill) * Math.min(1, dt * 10);
      const h = Math.max(0.001, (sandTop - sandFloor) * v.fill); v.sand.scale.y = h; v.sand.position.y = sandFloor + h / 2;
      if (!v.pct) { v.pct = label(); v.pct.sprite.scale.set(0.56, 0.32, 1); v.pct.sprite.position.set(0, 1.0, 0); v.g.add(v.pct.sprite); }
      v.pct.set(`${Math.floor(f * 100)}%`, { bg: '#ffffff', fg: '#3a2d63', size: 38 });
    }
    fx.update(dt * Math.min(speed, 3), dt);
    tweens.update(dt * Math.min(speed, 3));
    hud.update(dt, camera, ctx.el);
    if (G.over) { if (!ending) gameOver(); ending += dt; const wait = G.result === 'win' ? 0.9 : 1.5; if (!endShown && ending >= wait) { endShown = true; finish(G.result); } }
  }
  // Attract-mode bot: the dashboard's eager rule (colour with most sand in reach, then nearest the belt), a cart every third of a second.
  function autoStep() { if (!G.belt.hasFreeSpot || G.ticks % 20 !== 0) return; const c = chooseEager(G.grid.getAvailableBuckets(), G.sand); if (c) tap(c.index.x, c.index.y); }

  // A full cart rises, pops into confetti (shipped: rise 0.5, scale to 0, BucketConfetti) and the praise climbs with the combo.
  function bucketFull(b) {
    const v = onBelt.get(b); if (!v) return; v.leaving = true;
    const g = v.g, y0 = g.position.y, rgb = cartRGB(b.colorType);
    if (v.pct) { dropLabel(v.pct); v.pct = null; }
    combo = comboT > 0 ? combo + 1 : 1; comboT = 0.9;
    sfx('vanish', { volume: 0.6, rate: 1 + Math.min(combo - 1, 5) * 0.06 });
    const done = () => { scene.remove(g); disposeLevel(g); onBelt.delete(b); };
    if (ctx.reduce) { done(); return; }
    tweens.add(0.2, k => { g.position.y = y0 + k * 0.5; g.rotation.y += 0.25; }, easeOutCubic, () => {
      const p = g.position.clone().setY(y0 + 0.75);
      fx.glow(p, rgb, 1.2); fx.confetti(p, [rgb, sandKeys(b.colorType)[0], [1, 1, 1]], 34, 1.6);
      sfx('confetti', { volume: 0.35, rate: 1.1 }); ctx.shake(0.25 + Math.min(combo, 4) * 0.1);
      if (combo >= 2) { hud.pop(PRAISE[Math.min(combo - 2, PRAISE.length - 1)] + (combo >= 3 ? ` x${combo}` : ''), p, '#ffe14d'); sfx('sparkle', { volume: 0.45, rate: 1 + combo * 0.05 }); }
      tweens.add(0.22, k => g.scale.setScalar(Math.max(0.001, 1 - easeBackIn(k))), x => x, done);
    });
  }
  function gameOver() {
    ending = 0.0001; hov.set(null);
    if (G.result === 'win') {
      sfx('win'); sfx('confetti', { volume: 0.6 }); ctx.shake(0.6);
      if (!ctx.reduce) {
        const c = picture.localToWorld(new THREE.Vector3(0, 0, 0.3));
        const g0 = G;
        for (let i = 0; i < 3; i++) setTimeout(() => { if (dead || G !== g0) return; const p = c.clone().add(new THREE.Vector3((i - 1) * 1.3, 0.4 * (i % 2), 0)); fx.confetti(p, [[1, 0.85, 0.2], [1, 0.4, 0.6], [0.4, 0.8, 1], [0.6, 1, 0.5], [1, 1, 1]], 60, 2.4); fx.glow(p, [1, 0.9, 0.6], 2); }, i * 120);
        fxTweens.add(0.5, k => picture.scale.setScalar(1 + Math.sin(k * Math.PI) * 0.06), x => x);
      }
      hud.pop('Picture clear!', picture.localToWorld(new THREE.Vector3(0, -0.3, 0.3)), '#7dff8a', 1.4);
    } else {
      // The fail moment: belt goes red, carts on it shake loose and slump, OutOfSpace + Lose, a hard shake.
      const g0 = G; sfx('nospace', { volume: 0.7 }); setTimeout(() => { if (G === g0) sfx('lose', { volume: 0.6 }); }, 350); ctx.shake(2);
      railMat.color.copy(railWarn); railMat.emissive.setRGB(0.6, 0, 0.1);
      if (!ctx.reduce) for (const v of onBelt.values()) { const g = v.g, r0 = Math.random() - 0.5; tweens.add(0.7, k => { g.rotation.z = r0 * 0.9 * k + Math.sin(k * 40) * 0.12 * (1 - k); g.position.y = Math.sin(k * 30) * 0.05 * (1 - k); }, x => x); }
      hud.pop(G.belt.occupiedSpots ? 'Out of space!' : 'Stuck!', picture.localToWorld(new THREE.Vector3(0, -0.3, 0.3)), '#ff5d6c', 1.6);
      hud.belt(G.belt.occupiedSpots, true);
    }
  }
  function finish(res) {
    if (dead) return;
    if (auto) { lvl = res === 'win' ? (lvl + 1) % LEVELS.length : lvl; build(); return; }
    if (res === 'win') {
      const last = lvl === LEVELS.length - 1;
      ctx.result({ win: true, last, title: last ? 'All clear!' : 'Level complete', sub: last ? `${LEVELS.length} shipped levels cleared. Hundreds more in the store.` : `Sand Flow · level ${LEVELS[lvl]}`,
        next: () => { lvl = (lvl + 1) % LEVELS.length; build(); }, retry: () => build() });
    } else {
      ctx.result({ win: false, title: G.belt.occupiedSpots ? 'Out of space' : 'Stuck', sub: G.belt.occupiedSpots ? 'The belt filled up with carts that had nothing to collect.' : 'No cart left can reach the belt.', next: () => build() });
    }
  }

  build();
  return {
    scene, camera, update,
    resize: () => fit(),
    autoplay(on) { auto = on; speed = on ? 1.5 : 1; },
    // The visitor jumps in: the bot stops and they carry on this board. A finished board moves straight on (no card).
    takeover() { auto = false; speed = 1; if (G.over) { lvl = (lvl + 1) % LEVELS.length; build(); } },
    reloadLevel() { build(); },
    restart() { auto = false; speed = 1; lvl = 0; build(); },
    // Test hooks: speed, state, the bot's next tap as page coordinates, and where a grid cell is on screen.
    test: {
      set speed(v) { speed = v; },
      get state() { return { total: LEVELS.length, level: lvl + 1, levelId: LEVELS[lvl], over: G.over, result: G.result, progress: G.progress, onBelt: G.belt.occupiedSpots, auto }; },
      reset() { auto = false; speed = 1; lvl = 0; build(); },
      goto(i) { lvl = ((i % LEVELS.length) + LEVELS.length) % LEVELS.length; build(); },
      carts: () => G.carts(),
      mechanics: () => G.mechanics(),
      get memory() { return { ...ctx.renderer.info.memory, programs: ctx.renderer.info.programs?.length }; },
      jam() { G.sand.removeSandForBucket = () => 0; }, // nothing can be collected: shows the fail sequence
      nextMove() { if (G.over || !G.belt.hasFreeSpot) return null; const c = chooseEager(G.grid.getAvailableBuckets(), G.sand); return c ? this.screenOf(c.index.x, c.index.y) : null; },
      screenOf(x, y) { const v = cellPos(x, y).setY(TAP_Y).project(camera), r = ctx.el.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
    },
    destroy() { dead = true; ctx.canvas.removeEventListener('pointerdown', onPointer); ctx.el.removeEventListener('pointermove', onHover); ctx.el.removeEventListener('pointerleave', leave); hud.destroy(); disposeScene(scene); },
  };
}

const easeBackIn = x => 2.70158 * x * x * x - 1.70158 * x * x;
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function blobTexture(THREE) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64; const c = cv.getContext('2d');
  const g = c.createRadialGradient(32, 32, 4, 32, 32, 31); g.addColorStop(0, 'rgba(20,8,40,.75)'); g.addColorStop(0.6, 'rgba(20,8,40,.35)'); g.addColorStop(1, 'rgba(20,8,40,0)');
  c.fillStyle = g; c.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv);
}

// HUD (DOM, in the stage's overlay): belt slots top-right like the shipped "0/5" sign, and praise / fail popups.
function makeHud(ui) {
  const box = document.createElement('div');
  box.style.cssText = 'position:absolute;top:12px;right:12px;display:flex;align-items:center;gap:5px;padding:7px 10px;border-radius:14px;background:rgba(32,22,60,.82);box-shadow:0 4px 0 rgba(0,0,0,.25);font:800 13px system-ui,sans-serif;color:#fff;pointer-events:none;transition:background .2s';
  const txt = document.createElement('span'); txt.style.cssText = 'margin-right:3px;min-width:26px;text-align:center'; box.append(txt);
  const pips = Array.from({ length: 5 }, () => { const p = document.createElement('i'); p.style.cssText = 'display:block;width:9px;height:14px;border-radius:3px;background:rgba(255,255,255,.25);transition:background .15s'; box.append(p); return p; });
  ui.append(box);
  const pops = [];
  let last = -1, warn = null;
  return {
    belt(n, red) {
      const key = n + ':' + red; if (key === last) return; last = key;
      txt.textContent = `${n}/5`; pips.forEach((p, i) => { p.style.background = i < n ? (red ? '#ff5d6c' : '#ffd84d') : 'rgba(255,255,255,.25)'; });
      box.style.background = red ? 'rgba(170,30,60,.9)' : 'rgba(32,22,60,.82)';
    },
    flashBelt() { box.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.18)', background: 'rgba(200,40,70,.95)' }, { transform: 'scale(1)' }], { duration: 300 }); },
    pop(text, world, color, scale = 1) {
      for (const p of pops) p.el.remove(); pops.length = 0; // one at a time: the newest praise replaces the last
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = `position:absolute;left:0;top:0;transform:translate(-50%,-50%);font:900 ${Math.round(26 * scale)}px system-ui,sans-serif;color:${color};-webkit-text-stroke:2px #2a1650;text-shadow:0 4px 0 #2a1650,0 8px 18px rgba(0,0,0,.35);white-space:nowrap;pointer-events:none;letter-spacing:.5px`;
      ui.append(el); const p = { el, world: world.clone(), t: 0, d: 1.1 }; pops.push(p);
      el.animate?.([{ opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1.25, offset: 0.2 }, { opacity: 1, scale: 1, offset: 0.4 }, { opacity: 0, scale: 0.9 }], { duration: 1100, easing: 'ease-out' });
    },
    update(dt, camera, stage) {
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i]; p.t += dt;
        if (p.t >= p.d) { p.el.remove(); pops.splice(i, 1); continue; }
        const v = p.world.clone(); v.y += p.t * 0.6; v.project(camera);
        p.el.style.left = `${(v.x + 1) / 2 * stage.clientWidth}px`; p.el.style.top = `${(1 - v.y) / 2 * stage.clientHeight}px`;
      }
    },
    clearPops() { for (const p of pops) p.el.remove(); pops.length = 0; },
    destroy() { box.remove(); this.clearPops(); },
  };
}

// Effects: sand grains flying from the picture into a cart, confetti (shipped BucketConfetti look: lit flakes plus the
// Polygon Arsenal glow sprite), dust puffs on landing.
function effects(THREE, glowTex) {
  const group = new THREE.Group();
  // Grains
  const GN = 900, gpos = new Float32Array(GN * 3), gcol = new Float32Array(GN * 3), grains = [];
  const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.BufferAttribute(gpos, 3)); gg.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  const gpts = new THREE.Points(gg, new THREE.PointsMaterial({ size: 0.075, vertexColors: true, sizeAttenuation: true, toneMapped: false })); gpts.frustumCulled = false; group.add(gpts);
  // Confetti flakes
  const CN = 500, flake = new THREE.PlaneGeometry(0.09, 0.055), fmat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.4, metalness: 0.1 });
  const flakes = new THREE.InstancedMesh(flake, fmat, CN); flakes.instanceMatrix.setUsage(THREE.DynamicDrawUsage); flakes.frustumCulled = false; flakes.count = 0; group.add(flakes);
  flakes.setColorAt(0, new THREE.Color());
  const conf = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3(), c3 = new THREE.Color();
  // Glow sprites
  const glows = [], gmat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
  const tmp = new THREE.Vector3();
  return {
    group,
    grain(from, view, keys) {
      if (grains.length >= GN) return; const t = Math.random(), a = keys[0], b = keys[1];
      grains.push({ a: from.clone().add(tmp.set((Math.random() - 0.5) * 0.25, 0, 0)), v: view, t: 0, d: 0.32 + Math.random() * 0.1, c: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] });
    },
    confetti(at, cols, n = 30, power = 1.5, size = 1) {
      for (let i = 0; i < n && conf.length < CN; i++) {
        const ang = Math.random() * Math.PI * 2, sp = (0.6 + Math.random()) * power;
        conf.push({ p: at.clone(), v: new THREE.Vector3(Math.cos(ang) * sp * 0.7, 2.2 + Math.random() * 2.2 * power * 0.6, Math.sin(ang) * sp * 0.7), r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16), t: 0, d: 1 + Math.random() * 0.5, c: cols[i % cols.length], s: size === 1 ? 0.8 + Math.random() * 0.6 : size / 0.07 * (0.8 + Math.random() * 0.6) });
      }
    },
    glow(at, rgb, size = 1) {
      const sp = new THREE.Sprite(gmat.clone()); sp.material.color.setRGB(rgb[0], rgb[1], rgb[2]); sp.position.copy(at); sp.renderOrder = 5; group.add(sp);
      glows.push({ sp, t: 0, d: 0.45, s: size });
    },
    dust(at, n) { this.confetti(at.clone().setY(0.08), [[0.85, 0.82, 0.95], [1, 1, 1]], n, 0.5, 0.05); },
    update(dt, rdt) {
      // grains
      for (let i = grains.length - 1; i >= 0; i--) { const p = grains[i]; p.t += dt; if (p.t >= p.d || p.v.leaving) grains.splice(i, 1); }
      grains.forEach((p, i) => {
        const k = p.t / p.d, to = p.v.g.position, ty = to.y + 0.42;
        gpos[i * 3] = p.a.x + (to.x - p.a.x) * k; gpos[i * 3 + 2] = p.a.z + (to.z - p.a.z) * k; gpos[i * 3 + 1] = p.a.y + (ty - p.a.y) * k * k + Math.sin(k * Math.PI) * 0.12;
        gcol[i * 3] = p.c[0]; gcol[i * 3 + 1] = p.c[1]; gcol[i * 3 + 2] = p.c[2];
      });
      gg.setDrawRange(0, grains.length); gg.attributes.position.needsUpdate = true; gg.attributes.color.needsUpdate = true;
      // confetti
      for (let i = conf.length - 1; i >= 0; i--) { const p = conf[i]; p.t += dt; if (p.t >= p.d) conf.splice(i, 1); }
      conf.forEach((p, i) => {
        p.v.y -= 7 * dt; p.v.multiplyScalar(1 - 1.6 * dt); p.p.addScaledVector(p.v, dt); p.r.addScaledVector(p.w, dt);
        const k = p.t / p.d, sc = p.s * (k > 0.7 ? (1 - k) / 0.3 : 1);
        m4.compose(p.p, q.setFromEuler(e.set(p.r.x, p.r.y, p.r.z)), s3.set(sc, sc, sc)); flakes.setMatrixAt(i, m4);
        flakes.setColorAt(i, c3.setRGB(p.c[0], p.c[1], p.c[2], THREE.SRGBColorSpace));
      });
      flakes.count = conf.length; flakes.instanceMatrix.needsUpdate = true; if (flakes.instanceColor) flakes.instanceColor.needsUpdate = true;
      // glows
      for (let i = glows.length - 1; i >= 0; i--) {
        const g = glows[i]; g.t += rdt; const k = g.t / g.d;
        if (k >= 1) { group.remove(g.sp); g.sp.material.dispose(); glows.splice(i, 1); continue; }
        g.sp.scale.setScalar(g.s * (0.4 + easeOut(k) * 1.4)); g.sp.material.opacity = 1 - k;
      }
    },
    clear() { grains.length = 0; conf.length = 0; for (const g of glows) group.remove(g.sp); glows.length = 0; flakes.count = 0; gg.setDrawRange(0, 0); },
  };
}
const easeOut = x => 1 - (1 - x) ** 3;

// Belt geometry: a rounded rectangle around the picture's base, parameterised so pathT matches the sim.
function beltPath(THREE) {
  const L = -PIC / 2, Rt = PIC / 2, zb = BELT_Z, zt = BELT_Z - BACK;
  const ret = [];
  const arc = (cx, cz, a0, a1, n) => { for (let i = 1; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; ret.push([cx + R * Math.cos(a), cz + R * Math.sin(a)]); } };
  ret.push([Rt, zb]);
  arc(Rt, zb - R, Math.PI / 2, 0, 8);
  ret.push([Rt + R, zt + R]);
  arc(Rt, zt + R, 0, -Math.PI / 2, 8);
  ret.push([L, zt]);
  arc(L, zt + R, -Math.PI / 2, -Math.PI, 8);
  ret.push([L - R, zb - R]);
  arc(L, zb - R, Math.PI, Math.PI / 2, 8);
  const cum = [0]; for (let i = 1; i < ret.length; i++) cum.push(cum[i - 1] + Math.hypot(ret[i][0] - ret[i - 1][0], ret[i][1] - ret[i - 1][1]));
  const total = cum.at(-1);
  const xz = t => {
    t = ((t % 1) + 1) % 1;
    if (t < 0.5) return [L + (Rt - L) * (t / 0.5), zb];
    const d = ((t - 0.5) / 0.5) * total; let i = 1; while (i < cum.length - 1 && cum[i] < d) i++;
    const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1); return [ret[i - 1][0] + (ret[i][0] - ret[i - 1][0]) * f, ret[i - 1][1] + (ret[i][1] - ret[i - 1][1]) * f];
  };
  const at = t => { const [x, z] = xz(t); return new THREE.Vector3(x, 0.06, z); };
  return {
    at,
    dir: t => at(t + 0.002).sub(at(t - 0.002)).normalize(),
    behind: t => { const [x, z] = xz(t); return z < zb - R * 1.3 && Math.abs(x) < Rt + R * 0.2; },
    sample(n, off) { const pts = []; for (let i = 0; i < n; i++) { const t = i / n, p = at(t), d = at(t + 0.002).sub(at(t - 0.002)).normalize(); pts.push(new THREE.Vector3(p.x - d.z * off, 0, p.z + d.x * off)); } return pts; },
  };
}
function ribbonGeometry(THREE, belt, width) {
  const n = 240, pos = [], uv = [], idx = []; let len = 0, prev = belt.at(0);
  for (let i = 0; i <= n; i++) {
    const t = i / n, p = belt.at(t), d = belt.dir(t); len += p.distanceTo(prev); prev = p;
    pos.push(p.x - d.z * width / 2, 0, p.z + d.x * width / 2, p.x + d.z * width / 2, 0, p.z - d.x * width / 2);
    uv.push(0, len / width, 1, len / width);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function roundedRect(THREE, w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return new THREE.ShapeGeometry(s);
}
