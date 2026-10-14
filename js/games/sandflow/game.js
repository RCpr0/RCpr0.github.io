// Sand Flow renderer: the shipped models and textures (converted geometry-only), a sand picture drawn from the live
// sim every frame, a U-shaped belt that wraps the picture, and the cart grid. Rules live in core.js.
import { SandFlowGame, DT, GAME_CFG } from './core.js';
import { PALETTE } from './sim/palette.js';
import { loadModel, loadTexture, toonRamp, tweenList, easeOutBack, easeInOut, disposeScene } from '../common.js';

const LEVELS = [1, 2, 3, 4];
const CELL = 0.7, PIC = 3.6, BELT_Z = -0.95, R = 0.42, BACK = 2.5, CAM_PITCH = 59.5 * Math.PI / 180;
const RGB = new Map(PALETTE.map(p => [p.ct, [p.r, p.g, p.b]]));

export async function create(ctx) {
  const { THREE, base } = ctx;
  const [cartM, outlineM, cellM, wallM, cartTex, wallTex, beltTex, levels] = await Promise.all([
    loadModel(base + 'Cart.json'), loadModel(base + 'Cart_Outline.json'), loadModel(base + 'Cell.json'), loadModel(base + 'WallEdgy.json'),
    loadTexture(base + 'cart.webp'), loadTexture(base + 'wall.webp', { repeat: true }), loadTexture(base + 'belt.webp', { repeat: true }),
    Promise.all(LEVELS.map(n => fetch(`${base}level${n}.json`).then(r => r.json()))),
  ]);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#2b2340');
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  scene.add(new THREE.HemisphereLight('#ffffff', '#5a4a7a', 1.6));
  const sun = new THREE.DirectionalLight('#ffffff', 1.5); sun.position.set(-2, 6, 4); scene.add(sun);
  const tweens = tweenList(), ramp = toonRamp();
  const toon = (color, map) => new THREE.MeshToonMaterial({ color, map: map || null, gradientMap: ramp });

  // Ground: the purple stone around the grid.
  wallTex.repeat.set(6, 8);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(14, 18), toon('#8f80b8', wallTex)); ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, 2); scene.add(ground);

  // Picture: a sand texture on a billboard standing on the belt, inside a pale frame.
  const sandData = new Uint8Array(128 * 128 * 4), sandTex = new THREE.DataTexture(sandData, 128, 128);
  sandTex.magFilter = THREE.NearestFilter; sandTex.colorSpace = THREE.SRGBColorSpace;
  const picture = new THREE.Group(); scene.add(picture);
  const frame = new THREE.Mesh(roundedRect(THREE, PIC + 0.36, PIC + 0.36, 0.22), new THREE.MeshBasicMaterial({ color: '#efeaff' }));
  const frameIn = new THREE.Mesh(roundedRect(THREE, PIC + 0.1, PIC + 0.1, 0.1), new THREE.MeshBasicMaterial({ color: '#3a2f58' })); frameIn.position.z = 0.005;
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(PIC, PIC), new THREE.MeshBasicMaterial({ map: sandTex })); pic.position.z = 0.01;
  picture.add(frame, frameIn, pic);

  // Belt: a rounded-rectangle loop. pathT 0..0.5 runs left to right under the picture (sand x 0..127); the rest is the return.
  const belt = beltPath(THREE);
  const beltMat = toon('#ffffff', beltTex); beltMat.side = THREE.DoubleSide;
  const ribbon = new THREE.Mesh(ribbonGeometry(THREE, belt, 0.62), beltMat); ribbon.position.y = 0.02; scene.add(ribbon);
  beltTex.wrapS = beltTex.wrapT = THREE.RepeatWrapping;
  const railMat = toon('#d9d2ff'), railWarn = new THREE.Color('#ff6d6d'), railBase = new THREE.Color('#d9d2ff');
  for (const off of [-0.36, 0.36]) {
    const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(belt.sample(160, off), true), 240, 0.06, 6, true), railMat);
    m.position.y = 0.08; scene.add(m);
  }

  // Models.
  const geo = (m, filter) => m.parts.filter(filter || (() => true));
  const cartBody = toon('#ffffff', cartTex), outlineMat = new THREE.MeshBasicMaterial({ color: '#2a1f45', side: THREE.BackSide });
  const tyreMat = toon('#3a2f58');
  function makeCart(ct) {
    const g = new THREE.Group(), body = new THREE.Group(), [r, gg, b] = RGB.get(ct) || [200, 200, 200];
    const mat = cartBody.clone(); mat.color.setRGB(r / 255, gg / 255, b / 255, THREE.SRGBColorSpace);
    for (const p of geo(cartM)) {
      const wheel = /Wheel|Tyre/i.test(p.name), mesh = new THREE.Mesh(p.geometry, wheel ? tyreMat : mat);
      mesh.userData.wheel = wheel; body.add(mesh);
    }
    for (const p of geo(outlineM)) body.add(new THREE.Mesh(p.geometry, outlineMat));
    const sand = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.02, 0.28), toon(mat.color.clone().multiplyScalar(0.9)));
    sand.position.y = cartM.max.y - 0.06; sand.visible = false; body.add(sand);
    const c = cartM.min.clone().add(cartM.max).multiplyScalar(0.5);
    body.children.forEach(m => m.position.sub(new THREE.Vector3(c.x, cartM.min.y, c.z)));
    sand.position.y = (cartM.max.y - cartM.min.y) * 0.72;
    g.add(body); g.userData = { body, sand, mat, ct };
    return g;
  }
  const cellMat = toon('#94a3df'), wallMat = toon('#c9c0e6', wallTex);

  let G, lvl = 0, gridRoot, cartsOnGrid, onBelt, particles, auto = false, warnT = 0, endTimer = 0, speed = 1;
  const pc = particleSystem(THREE); scene.add(pc.points);

  function build() {
    if (gridRoot) { scene.remove(gridRoot); }
    if (onBelt) for (const v of onBelt.values()) scene.remove(v.m); // carts the last run left on the belt
    tweens.clear(); pc.clear(); endTimer = 0;
    G = new SandFlowGame(levels[lvl]); ctx.setLevel(`Level ${LEVELS[lvl]}`); ctx.hideResult();
    gridRoot = new THREE.Group(); scene.add(gridRoot);
    cartsOnGrid = new Map(); onBelt = new Map();
    const { gridWidth: rows, gridHeight: cols } = levels[lvl];
    for (let x = 0; x < rows; x++) for (let y = 0; y < cols; y++) {
      const p = cellPos(x, y), cm = new THREE.Mesh(cellM.parts[0].geometry, cellMat); cm.position.copy(p); cm.scale.setScalar(CELL / 0.64 * 0.96); gridRoot.add(cm);
    }
    for (const w of G.walls()) {
      const g = new THREE.Group(); for (const p of geo(wallM)) g.add(new THREE.Mesh(p.geometry, wallMat));
      g.position.copy(cellPos(w.x, w.y)); g.scale.setScalar(CELL / 0.7); gridRoot.add(g);
    }
    for (const c of G.carts()) {
      const m = makeCart(c.ct); m.position.copy(cellPos(c.x, c.y)); setFacing(m, c.available, false);
      gridRoot.add(m); cartsOnGrid.set(c.x * 64 + c.y, m);
    }
    fit();
  }
  const cols = () => levels[lvl].gridHeight;
  function cellPos(x, y) { return new THREE.Vector3((y - (cols() - 1) / 2) * CELL, 0.03, BELT_Z + 0.95 + x * CELL); }

  // Blocked carts sit upside down and smaller, without wheels; they flip upright when a path opens.
  function setFacing(m, up, animate) {
    if (m.userData.up === up) return; m.userData.up = up;
    const body = m.userData.body; body.children.forEach(c => { if (c.userData.wheel) c.visible = up; });
    const to = up ? 0 : Math.PI, s0 = m.scale.x, s1 = up ? 1 : 0.82;
    if (!animate || ctx.reduce) { body.rotation.x = to; m.scale.setScalar(s1); body.position.y = up ? 0 : 0.36; return; }
    const from = body.rotation.x;
    tweens.add(0.35, k => { body.rotation.x = from + (to - from) * k; m.scale.setScalar(s0 + (s1 - s0) * k); body.position.y = (up ? 0 : 0.36) + Math.sin(k * Math.PI) * 0.35; }, easeInOut);
  }

  // Camera: shipped pitch (59.5 degrees, orthographic). Bounds come from projecting the picture, belt and grid corners,
  // so every level fills the screen whatever its grid size.
  function fit() {
    const w = ctx.renderer.domElement.clientWidth || ctx.w, h = ctx.renderer.domElement.clientHeight || ctx.h, aspect = w / h;
    const rows = levels[lvl].gridWidth, gridBottom = BELT_Z + 0.95 + (rows - 0.5) * CELL;
    const target = new THREE.Vector3(0, 0, 0);
    camera.position.set(0, Math.sin(CAM_PITCH), Math.cos(CAM_PITCH)).multiplyScalar(30); camera.lookAt(target);
    camera.updateMatrixWorld();
    picture.quaternion.copy(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    picture.position.set(0, 0.05, BELT_Z - 0.55).addScaledVector(up, PIC / 2 + 0.25); picture.updateMatrixWorld();
    const half = PIC / 2 + 0.2, pts = [new THREE.Vector3(-half, half, 0), new THREE.Vector3(half, half, 0)].map(p => picture.localToWorld(p));
    const gw = (cols() / 2) * CELL + 0.2;
    pts.push(new THREE.Vector3(-PIC / 2 - R - 0.4, 0, BELT_Z + 0.4), new THREE.Vector3(PIC / 2 + R + 0.4, 0, BELT_Z + 0.4), new THREE.Vector3(-gw, 0, gridBottom + 0.4), new THREE.Vector3(gw, 0, gridBottom + 0.4));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { const v = p.clone().applyMatrix4(camera.matrixWorldInverse); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    y1 += 0.35; y0 -= 1.5; // room for the level pill on top and the prompt at the bottom
    let hh = (y1 - y0) / 2, hw = (x1 - x0) / 2; if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    camera.left = cx - hw; camera.right = cx + hw; camera.top = cy + hh; camera.bottom = cy - hh; camera.updateProjectionMatrix();
  }

  // Input: tap a cell.
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  function onPointer(e) {
    if (auto || G.over) return;
    const r = ctx.canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    if (!ray.ray.intersectPlane(plane, hit)) return;
    const y = Math.round(hit.x / CELL + (cols() - 1) / 2), x = Math.round((hit.z - BELT_Z - 0.95) / CELL);
    tap(x, y);
  }
  ctx.canvas.addEventListener('pointerdown', onPointer);
  ctx.canvas.style.touchAction = 'none';

  function tap(x, y) {
    const m = cartsOnGrid.get(x * 64 + y);
    const r = G.tap(x, y);
    if (!r.ok) {
      if (m) { ctx.sound('nope'); const p0 = m.position.x; tweens.add(0.3, k => { m.position.x = p0 + Math.sin(k * Math.PI * 4) * 0.06 * (1 - k); }); }
      return r;
    }
    ctx.sound('tap');
    cartsOnGrid.delete(x * 64 + y);
    // Drive along the path to the belt edge, then hop onto the belt where the logic placed it.
    const pts = r.path.map(c => cellPos(c.x, c.y)); pts.push(cellPos(-1, r.path.at(-1).y).setY(0.03));
    const dur = Math.max(0.18, pts.length * 0.07);
    const b = r.bucket; onBelt.set(b, { m, arriving: true });
    m.userData.sand.visible = true; m.userData.sand.scale.y = 0.01;
    tweens.add(dur, k => { const f = k * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), t = f - i; m.position.lerpVectors(pts[i], pts[i + 1], t); }, easeInOut, () => {
      gridRoot.remove(m); scene.add(m); const from = m.position.clone();
      tweens.add(0.22, k => { const to = belt.at(b.pathT); m.position.lerpVectors(from, to, k); m.position.y = to.y + Math.sin(k * Math.PI) * 0.5; m.scale.set(1 + 0.15 * Math.sin(k * Math.PI), 1 - 0.1 * Math.sin(k * Math.PI), 1); }, x => x, () => {
        onBelt.get(b) && (onBelt.get(b).arriving = false);
        tweens.add(0.18, k => m.scale.set(1 + 0.12 * (1 - k), 1 - 0.18 * (1 - k), 1), easeOutBack);
      });
    });
    refreshFacing();
    return r;
  }
  function refreshFacing() { for (const c of G.carts()) { const m = cartsOnGrid.get(c.x * 64 + c.y); if (m) setFacing(m, c.available, true); } }

  // Draw the sand: palette colour with a fixed per-grain shade; empty cells show the frame's dark inside.
  const shade = new Float32Array(128 * 128).map((_, i) => 0.9 + 0.14 * ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1);
  function drawSand() {
    const s = G.sand, grid = s._grid, ct = s._colorTypes;
    for (let i = 0; i < 128 * 128; i++) {
      const o = i * 4;
      if (!grid[i]) { sandData[o] = 58; sandData[o + 1] = 47; sandData[o + 2] = 88; sandData[o + 3] = 255; continue; }
      const c = RGB.get(ct[i]) || [255, 255, 255], k = shade[i];
      sandData[o] = Math.min(255, c[0] * k); sandData[o + 1] = Math.min(255, c[1] * k); sandData[o + 2] = Math.min(255, c[2] * k); sandData[o + 3] = 255;
    }
    sandTex.needsUpdate = true;
  }

  function update(dt) {
    if (!G) return;
    // Fixed 60 Hz ticks; fast-forward runs more of them, never a longer tick.
    let acc = (update.acc || 0) + dt * speed, n = 0;
    while (acc >= DT && n < 240) {
      if (auto) autoStep();
      const r = G.step(); acc -= DT; n++;
      if (!r) break;
      for (const [b, got] of r.collected) if (Math.random() < Math.min(1, got / 6)) emitGrain(b);
      for (const b of r.filled) bucketFull(b);
      warnT = r.warn ? warnT + DT : 0;
    }
    update.acc = acc;
    drawSand();
    beltTex.offset.y = (beltTex.offset.y - dt * 0.6 * speed) % 1;
    railMat.color.copy(warnT > 0 && Math.floor(warnT * 4) % 2 === 0 ? railWarn : railBase);
    for (const [b, v] of onBelt) {
      if (v.arriving || v.leaving) continue;
      const p = belt.at(b.pathT), d = belt.dir(b.pathT);
      v.m.position.copy(p); v.m.rotation.y = Math.atan2(d.x, d.z);
      // Shrink while hidden behind the picture, like the shipped belt's scale zone.
      const hidden = belt.behind(b.pathT); v.m.visible = !hidden;
      v.m.userData.sand.scale.y = Math.max(0.01, (b.capacity / b.totalCapacity) * 10);
    }
    pc.update(dt * speed);
    tweens.update(dt * Math.min(speed, 3));
    if (G.over && !endTimer) { endTimer = 1; setTimeout(() => finish(G.result), G.result === 'win' ? 500 : 300); }
  }
  // Attract-mode bot: the dashboard's eager rule (colour with most sand in reach, then nearest the belt), one cart every third of a second.
  function autoStep() {
    if (!G.belt.hasFreeSpot || G.ticks % 20 !== 0) return;
    const pick = chooseFor(G.carts().filter(c => c.available));
    if (pick) tap(pick.x, pick.y);
  }
  function chooseFor(free) {
    const pr = G.sand.getSortedColorPriorityList(), rank = new Map(pr.map((c, i) => [c, i]));
    return free.sort((a, b) => (rank.get(a.ct) ?? 99) - (rank.get(b.ct) ?? 99) || a.x - b.x || a.y - b.y)[0];
  }
  function emitGrain(b) {
    const v = onBelt.get(b); if (!v || v.arriving) return;
    const from = belt.at(b.pathT).clone(); from.z -= 0.45; from.y += 0.5;
    pc.emit(from, v.m.position, RGB.get(b.colorType));
  }
  function bucketFull(b) {
    const v = onBelt.get(b); if (!v) return; v.leaving = true; ctx.sound('full');
    const m = v.m, y0 = m.position.y;
    pc.burst(m.position, RGB.get(b.colorType));
    tweens.add(0.45, k => { m.position.y = y0 + k * 0.6; m.scale.setScalar(Math.max(0.001, 1.15 - k * 1.15)); }, easeInOut, () => { scene.remove(m); onBelt.delete(b); });
  }
  function finish(res) {
    if (auto) { // attract mode loops through the levels
      lvl = res === 'win' ? (lvl + 1) % LEVELS.length : lvl; build(); return;
    }
    if (res === 'win') {
      const last = lvl === LEVELS.length - 1;
      ctx.result({ win: true, title: last ? 'All clear!' : 'Level complete', sub: last ? `${LEVELS.length} shipped levels. 496 more in the store.` : `Sand Flow · level ${LEVELS[lvl]}`,
        next: () => { lvl = (lvl + 1) % LEVELS.length; build(); }, retry: () => build() });
    } else {
      ctx.result({ win: false, title: 'Out of space', sub: 'The belt filled up with carts that had nothing to collect.', next: () => build() });
    }
  }

  build();
  return {
    scene, camera, update,
    resize: () => fit(),
    autoplay(on) { auto = on; speed = on ? 1.5 : 1; },
    restart() { auto = false; speed = 1; lvl = 0; build(); },
    // Test hooks: speed, state, and where a grid cell is on screen (so tests click the canvas like a player).
    test: {
      set speed(v) { speed = v; },
      get state() { return { level: LEVELS[lvl], over: G.over, result: G.result, progress: G.progress, onBelt: G.belt.occupiedSpots, auto }; },
      carts: () => G.carts(),
      nextMove() { if (!G.belt.hasFreeSpot) return null; const c = chooseFor(G.carts().filter(c => c.available)); return c ? this.screenOf(c.x, c.y) : null; },
      screenOf(x, y) { const v = cellPos(x, y).project(camera), r = ctx.canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
    },
    destroy() { ctx.canvas.removeEventListener('pointerdown', onPointer); disposeScene(scene); },
  };
}

// Belt geometry: a rounded rectangle around the picture's base, parameterised so pathT matches the sim.
function beltPath(THREE) {
  const L = -PIC / 2, Rt = PIC / 2, zb = BELT_Z, zt = BELT_Z - BACK;
  // Return half (pathT 0.5..1): right corner, right side up, back run, left side down, left corner.
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
    behind: t => { const [, z] = xz(t); return z < zb - R * 1.3 && Math.abs(xz(t)[0]) < Rt + R * 0.2; },
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
// Sand grains flying from the picture into a cart, plus bursts when a cart fills.
function particleSystem(THREE) {
  const N = 600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3), live = [];
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, sizeAttenuation: true }));
  points.frustumCulled = false;
  const add = p => { if (live.length < N) live.push(p); };
  return {
    points,
    emit(from, to, rgb = [255, 255, 255]) { add({ a: from.clone(), b: to, t: 0, d: 0.28, rgb, kind: 'fly' }); },
    burst(at, rgb = [255, 255, 255]) { for (let i = 0; i < 26; i++) { const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 2; add({ a: at.clone(), v: new THREE.Vector3(Math.cos(a) * s, 2 + Math.random() * 2, Math.sin(a) * s), t: 0, d: 0.7, rgb: i % 3 ? rgb : [255, 255, 255], kind: 'burst' }); } },
    update(dt) {
      for (const p of live) p.t += dt;
      for (let i = live.length - 1; i >= 0; i--) if (live[i].t >= live[i].d) live.splice(i, 1);
      live.forEach((p, i) => {
        const k = p.t / p.d; let x, y, z;
        if (p.kind === 'fly') { x = p.a.x + (p.b.x - p.a.x) * k; z = p.a.z + (p.b.z - p.a.z) * k; y = p.a.y + (p.b.y + 0.3 - p.a.y) * k + Math.sin(k * Math.PI) * 0.2; }
        else { x = p.a.x + p.v.x * p.t; z = p.a.z + p.v.z * p.t; y = p.a.y + p.v.y * p.t - 6 * p.t * p.t; }
        pos.set([x, y, z], i * 3); col.set([p.rgb[0] / 255, p.rgb[1] / 255, p.rgb[2] / 255], i * 3);
      });
      g.setDrawRange(0, live.length); g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    },
    clear() { live.length = 0; },
  };
}
