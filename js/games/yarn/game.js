// Yarn Collect renderer: the shipped basket, glass cap and yarn-ball models (geometry only), the stitched road texture
// on the game's own spline, and the shipped praise popups. Rules live in core.js.
import { YarnGame, BASKET, CAPACITY } from './core.js';
import { loadModel, loadTexture, toonRamp, tweenList, easeOutBack, easeInOut, disposeScene } from '../common.js';

const LEVELS = [1, 2, 3, 4, 5];
const HEX = { 0: '#FD2833', 1: '#248CFD', 2: '#FFEB3A', 3: '#87FF33', 4: '#F89A58', 5: '#B01FE9', 6: '#DA29C5', 7: '#94EBFF', 8: '#525ECA', 9: '#A15401', 10: '#09A400', 11: '#9B0000', 12: '#00C183', 13: '#F2F2F2', 14: '#413737' };
const BALL_R = 0.42, ROAD_W = 1.72, TILT = 22 * Math.PI / 180, PRAISE = ['praise-great.webp', 'praise-nice.webp', 'praise-perfect.webp', 'praise-awesome.webp'];

export async function create(ctx) {
  const { THREE, base } = ctx;
  const [ballM, boxM, doneM, tunnelM, tunnelTex, roadTex, basketTex, yarnTex, bgTex, glassTex, praiseTex, levels] = await Promise.all([
    loadModel(base + 'YarnBall.json'), loadModel(base + 'YarnBox.json'), loadModel(base + 'BucketComplete.json'), loadModel(base + 'Tunnel.json'), loadTexture(base + 'tunnel.webp'),
    loadTexture(base + 'road.webp'), loadTexture(base + 'basket.webp'), loadTexture(base + 'yarn.webp'), loadTexture(base + 'bg.webp', { repeat: true }), loadTexture(base + 'glass.webp'),
    Promise.all(PRAISE.map(p => loadTexture(base + p))),
    Promise.all(LEVELS.map(n => fetch(`${base}level${n}.json`).then(r => r.json()))),
  ]);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#d8c4e3');
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  scene.add(new THREE.HemisphereLight('#ffffff', '#b9a3c9', 1.9));
  const sun = new THREE.DirectionalLight('#ffffff', 1.4); sun.position.set(-4, 12, 6); scene.add(sun);
  const ramp = toonRamp(), tweens = tweenList();
  const toon = (color, map) => new THREE.MeshToonMaterial({ color, map: map || null, gradientMap: ramp });
  bgTex.repeat.set(14, 14);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshBasicMaterial({ color: '#e3d3ec', map: bgTex })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.6; scene.add(floor);

  // Game x/y (y = the game's z) -> three x/-z on the floor.
  const W = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
  const ballMats = new Map(), ballMat = c => { if (!ballMats.has(c)) ballMats.set(c, toon(HEX[c] || '#ccc', yarnTex)); return ballMats.get(c); };
  const ballScale = (BALL_R * 2) / ballM.size.x, ballGeo = ballM.parts[0].geometry;
  ballGeo.translate(...ballM.min.clone().add(ballM.max).multiplyScalar(-0.5).toArray());
  const shadowMat = new THREE.MeshBasicMaterial({ color: '#7d5f93', transparent: true, opacity: 0.25, depthWrite: false });
  const shadowGeo = new THREE.CircleGeometry(BALL_R * 0.95, 20).rotateX(-Math.PI / 2);
  function makeBall(c) {
    const g = new THREE.Group(), m = new THREE.Mesh(ballGeo, ballMat(c)); m.scale.setScalar(ballScale); m.position.y = BALL_R;
    const sh = new THREE.Mesh(shadowGeo, shadowMat); sh.position.y = 0.02; g.add(sh, m); g.userData = { m, sh, c };
    return g;
  }
  // Basket model: long axis is the model's X; it lies along the basket's local north-south, mouth to the south.
  const boxGeo = boxM.parts[0].geometry.clone(), center = boxM.min.clone().add(boxM.max).multiplyScalar(-0.5);
  boxGeo.translate(center.x, -boxM.min.y, center.z).rotateY(Math.PI / 2);
  const capGeo = doneM.parts.find(p => /Glass/i.test(p.name))?.geometry.clone();
  capGeo?.translate(center.x, -doneM.min.y, center.z).rotateY(Math.PI / 2);
  const tunnelGeo = tunnelM.parts[0].geometry.clone(), tc = tunnelM.min.clone().add(tunnelM.max).multiplyScalar(-0.5);
  tunnelGeo.translate(tc.x, -tunnelM.min.y, tc.z); const tunnelMat = toon('#ffffff', tunnelTex);
  const basketMat = toon('#ffffff', basketTex), stubMat = toon('#f5bfd8'), glassMat = new THREE.MeshMatcapMaterial({ matcap: glassTex, transparent: true, opacity: 0.55 });
  const S = { x: BASKET.w / 2 - 0.3 - 0.16, y: BASKET.h / 2 - 0.3 - 0.16 };
  const spx = (BASKET.w - 0.6 - 0.32) / 2, spy = (BASKET.h - 0.6 - 0.32) / 4;
  // Slot i (0 = deepest, at the closed north end) in basket-local x/z.
  const slotLocal = i => new THREE.Vector3((i % 2 - 0.5) * spx, 0.5, -((Math.floor(i / 2) - 1.5) * spy));

  let G, lvl = 0, root, baskets, balls, auto = false, endTimer = 0, speed = 1, acc = 0, hud;
  const roadGroup = new THREE.Group(); scene.add(roadGroup);

  function build() {
    if (root) scene.remove(root);
    roadGroup.clear(); tweens.clear(); endTimer = 0; acc = 0; ctx.hideResult();
    G = new YarnGame(levels[lvl]); ctx.setLevel(`Level ${LEVELS[lvl]}`);
    root = new THREE.Group(); scene.add(root);
    // Road: a ribbon along the spline; the texture's stitched band runs along both edges.
    const r = G.road, n = Math.ceil(r.length / 0.25), pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, p = r.at(u), d = r.dir(u), nx = -d[1], ny = d[0], v = (u * r.length) / 3;
      for (const [side, tu] of [[-1, 0.335], [0, 1], [1, 0.335]]) { const q = W(p[0] + nx * side * ROAD_W / 2, p[1] + ny * side * ROAD_W / 2, 0); pos.push(q.x, q.y, q.z); uv.push(tu * 0.99, v); }
      if (i < n) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
    }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); rg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); rg.setIndex(idx); rg.computeVertexNormals();
    roadTex.wrapS = THREE.ClampToEdgeWrapping; roadTex.wrapT = THREE.RepeatWrapping;
    const roadMat = new THREE.MeshBasicMaterial({ map: roadTex, side: THREE.DoubleSide });
    roadGroup.add(new THREE.Mesh(rg, roadMat));
    const edge = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(r.poly.filter((_, i) => i % 4 === 0).map(p => W(p[0], p[1], -0.12)), r.closed), Math.ceil(r.length * 2), ROAD_W / 2 + 0.08, 8, r.closed), toon('#a98be0'));
    edge.scale.y = 0.25; roadGroup.add(edge);
    // Open roads end in the shipped wool tunnels: yarn goes in one and comes out of the other.
    if (!r.closed) for (const u of [0, 1]) {
      const p = r.at(u), d = r.dir(u), t = new THREE.Mesh(tunnelGeo, tunnelMat);
      t.position.copy(W(p[0], p[1])); t.rotation.y = Math.atan2(d[0], d[1]) + (u ? 0 : Math.PI); roadGroup.add(t);
    }
    // Baskets.
    baskets = G.baskets.map((b, i) => {
      const g = new THREE.Group(); g.position.copy(W(b.x, b.y)); g.rotation.y = -b.rot * Math.PI / 180;
      const box = new THREE.Mesh(boxGeo, basketMat); box.scale.set(BASKET.w / boxM.size.z, 0.8, BASKET.h / boxM.size.x); g.add(box);
      const stub = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.35, BASKET.tip + 0.3), stubMat); stub.position.set(0, 0.18, BASKET.h / 2 + BASKET.tip / 2 - 0.15); g.add(stub);
      const hit = new THREE.Mesh(new THREE.BoxGeometry(BASKET.w + 0.6, 1.5, BASKET.h + 0.6), new THREE.MeshBasicMaterial({ visible: false })); hit.userData.basket = i; g.add(hit);
      const cap = capGeo ? new THREE.Mesh(capGeo, glassMat) : null; if (cap) { cap.scale.copy(box.scale); cap.visible = false; g.add(cap); }
      root.add(g);
      const inside = b.balls.map((c, k) => { const m = makeBall(c); m.position.copy(slotLocal(k)); g.add(m); return m; });
      return { g, box, cap, hit, inside, b };
    });
    balls = new Map(); // road ball -> mesh
    fit();
  }

  function fit() {
    const w = ctx.renderer.domElement.clientWidth || ctx.w, h = ctx.renderer.domElement.clientHeight || ctx.h, aspect = w / h;
    camera.position.set(0, Math.cos(TILT), Math.sin(TILT)).multiplyScalar(60); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const pts = []; for (let i = 0; i < 200; i++) { const p = G.road.at(i / 200); pts.push(W(p[0], p[1])); }
    for (const b of G.baskets) for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pts.push(W(b.x + dx * 3.2, b.y + dy * 3.2, 1));
    if (!G.road.closed) for (const u of [0, 1]) { const p = G.road.at(u); for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) pts.push(W(p[0] + dx, p[1] + dy, 1.5)); }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { const v = p.applyMatrix4(camera.matrixWorldInverse); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    const pad = 1.2; x0 -= pad; x1 += pad; y0 -= pad + 2.6; y1 += pad + 2.2;
    let hh = (y1 - y0) / 2, hw = (x1 - x0) / 2; if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    Object.assign(camera, { left: cx - hw, right: cx + hw, top: cy + hh, bottom: cy - hh }); camera.updateProjectionMatrix();
  }

  // Input.
  const ray = new THREE.Raycaster();
  function onPointer(e) {
    if (auto || G.over) return;
    const r = ctx.canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.intersectObjects(baskets.map(b => b.hit))[0];
    if (hit) tap(hit.object.userData.basket);
  }
  ctx.canvas.addEventListener('pointerdown', onPointer);
  function tap(i) {
    const before = G.events.length, r = G.tap(i), B = baskets[i];
    if (!r.ok) { ctx.sound('nope'); const z = B.g.position.x; tweens.add(0.3, k => { B.g.position.x = z + Math.sin(k * Math.PI * 5) * 0.18 * (1 - k); }); return r; }
    ctx.sound('tap');
    tweens.add(0.25, k => { B.box.scale.y = 0.8 * (1 + 0.12 * Math.sin(k * Math.PI)); });
    handle(G.events.splice(before));
    return r;
  }
  function handle(events) {
    for (const e of events) {
      const B = baskets.find(x => x.b === e.basket);
      if (e.type === 'send') e.balls.forEach((ball, j) => {
        const m = B.inside.pop(); const from = m.getWorldPosition(new THREE.Vector3()); B.g.remove(m); root.add(m); m.position.copy(from);
        balls.set(ball, m); m.userData.fly = { t: 0, d: ball.arrive - G.time, from };
      });
      if (e.type === 'land') {
        const m = balls.get(e.ball); balls.delete(e.ball); if (!m) continue;
        const k = B.inside.length, from = m.position.clone(); root.remove(m); B.g.add(m); B.inside.push(m);
        const local = B.g.worldToLocal(from.clone()), to = slotLocal(k);
        m.position.copy(local); ctx.sound('drop');
        tweens.add(0.32, t => { m.position.lerpVectors(local, to, t); m.position.y = local.y + (to.y - local.y) * t + Math.sin(t * Math.PI) * 1.4; }, easeInOut,
          () => tweens.add(0.16, t => m.userData.m.scale.set(ballScale * (1 + 0.25 * (1 - t)), ballScale * (1 - 0.25 * (1 - t)), ballScale * (1 + 0.25 * (1 - t))), easeOutBack));
      }
      if (e.type === 'complete') setTimeout(() => complete(B), 350);
    }
  }
  function complete(B) {
    ctx.sound('full');
    if (B.cap) { B.cap.visible = true; const y0 = 3; tweens.add(0.35, k => { B.cap.position.y = y0 * (1 - k); }, easeOutBack); }
    tweens.add(0.3, k => { const s = 1 + 0.1 * Math.sin(k * Math.PI); B.g.scale.set(s, 1, s); });
    // Shipped praise popup, floating up from the basket.
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: praiseTex[Math.floor(Math.random() * praiseTex.length)], transparent: true, depthTest: false }));
    sp.position.copy(B.g.position).add(new THREE.Vector3(0, 3, 0)); sp.scale.set(5, 5, 1); root.add(sp);
    tweens.add(1.1, k => { sp.position.y = 3 + k * 2; sp.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3; sp.scale.setScalar(5 * (k < 0.2 ? 0.6 + 2 * k : 1)); }, x => x, () => { sp.parent?.remove(sp); sp.material.dispose(); });
  }

  function update(dt) {
    if (!G) return;
    acc += dt * speed; let n = 0;
    while (acc >= 1 / 60 && n < 240) {
      if (auto) G.autoTap();
      G.step(1 / 60); acc -= 1 / 60; n++;
      handle(G.events.splice(0));
    }
    // Road balls follow their slots (after the hop out of the basket).
    for (const [ball, m] of balls) {
      const p = G.road.at(G.slotU(ball.slot)), target = W(p[0], p[1]);
      const f = m.userData.fly;
      if (f) {
        f.t += dt * speed; const k = Math.min(1, f.t / Math.max(0.05, f.d));
        m.position.lerpVectors(f.from, target, easeInOut(k)); m.position.y = Math.sin(k * Math.PI) * 1.6;
        if (k >= 1) m.userData.fly = null;
      } else { m.position.copy(target); m.userData.m.rotation.x += dt * speed * 6; }
    }
    hud && (hud.textContent = `${G.onRoad()}/${G.usable}`);
    tweens.update(dt * Math.min(speed, 3));
    if (G.over && !endTimer) { endTimer = 1; setTimeout(() => finish(G.result), G.result === 'win' ? 900 : 400); }
  }
  function finish(res) {
    if (auto) { lvl = res === 'win' ? (lvl + 1) % LEVELS.length : lvl; build(); return; }
    if (res === 'win') {
      const last = lvl === LEVELS.length - 1;
      ctx.result({ win: true, title: last ? 'All clear!' : 'Level complete', sub: last ? `${LEVELS.length} shipped levels. 145 more in the store.` : `Yarn Collect · level ${LEVELS[lvl]}`,
        next: () => { lvl = (lvl + 1) % LEVELS.length; build(); }, retry: () => build() });
    } else ctx.result({ win: false, title: 'Tangled!', sub: 'The road filled with yarn that had nowhere to go.', next: () => build() });
  }

  hud = document.createElement('div'); hud.className = 'arcade-count'; ctx.ui.append(hud);
  build();
  return {
    scene, camera, update, resize: () => fit(),
    autoplay(on) { auto = on; speed = on ? 1 : 1; },
    restart() { auto = false; speed = 1; lvl = 0; build(); },
    test: {
      set speed(v) { speed = v; },
      get state() { return { level: LEVELS[lvl], over: G.over, result: G.result, progress: G.baskets.filter(b => b.complete).length / G.baskets.length, onBelt: G.onRoad(), auto, time: G.time }; },
      baskets: () => G.baskets.map((b, i) => ({ i, n: b.balls.length, complete: b.complete })),
      nextMove() { const i = G.botChoice(); return i < 0 ? null : this.screenOfBasket(i); },
      screenOfBasket(i) { const v = baskets[i].g.position.clone().project(camera), r = ctx.canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
    },
    destroy() { ctx.canvas.removeEventListener('pointerdown', onPointer); hud.remove(); disposeScene(scene); },
  };
}
