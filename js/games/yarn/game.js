// Yarn Collect renderer. Everything is built in the shipped game's own units from its prefabs:
// - the road is the shipped SplineMeshDeformer port: the `Path 1` road segment (Path_tex) tiled along the level spline,
//   width x0.4, height x0.5, five tiles per source length, on a world-up frame (RoadSpline at y -1);
// - baskets are box_yarn_open (YarnBox, x1.15, turned so its mouth faces the EntryPoint), with the Road_Path_Prefab
//   connector, the eight CarSpots, and the BucketComplete swap + glass lid when a basket fills;
// - yarn balls use the ball shader's own colours (BaseColor = AO x lerp(Color_1, Color_2), emission per colour) and the
//   CarAnimationConfig moves: exit arc with stretch and landing squash, roll and sway on the road, enter arc + basket punch.
// Rules live in core.js.
import { YarnGame, CAPACITY } from './core.js';
import { loadModel, loadTexture, tweenList, easeOutBack, easeOutCubic, easeInOut, disposeScene, addRig, fitPerspective, hoverSprings } from '../common.js';

const LEVELS = [1, 2, 3, 4, 5];
// Per colour: the ball material's _Color_1 and _Emission (Art/Material/Ball/*), ColorConfig colour for effects.
const BALL = {
  0: ['#BE2129', 0.16, '#FD2833'], 1: ['#1B80EF', 0.61, '#248CFD'], 2: ['#DEBD17', 0.19, '#FFEB3A'], 3: ['#5EB823', 0.16, '#87FF33'],
  4: ['#D16D27', 0.16, '#F89A58'], 5: ['#A428D6', 0.16, '#B01FE9'], 6: ['#BC2CAB', 0.35, '#DA29C5'], 7: ['#6FC6DA', 0.16, '#94EBFF'],
  8: ['#4E57BB', 0.23, '#525ECA'], 9: ['#B05C01', 0.16, '#A15401'], 10: ['#088600', 0.17, '#09A400'], 11: ['#9C0000', 0.08, '#9B0000'],
  12: ['#00B279', 0.16, '#00C183'], 13: ['#BBBBBB', 0.39, '#F2F2F2'], 14: ['#3A3030', 0.1, '#413737'],
};
const PRAISE = ['praise-great.webp', 'praise-nice.webp', 'praise-perfect.webp', 'praise-awesome.webp'];
const SOUNDS = { tap: 'tap.mp3', error: 'tap-error.mp3', out: 'ball-out.mp3', fit: 'ball-fit.mp3', done: 'basket-done.mp3', last: 'last-sort.mp3',
  full: 'out-of-slots.mp3', fail: 'soft-fail.mp3', win: 'level-complete.mp3', confetti: 'confetti.mp3' };
// Shipped numbers (Unity units).
const ROAD_Y = -1, ROAD_WS = 0.4, ROAD_HS = 0.5, ROAD_RES = 5, ARROW_GAP = 4, BOX_S = 1.15;
const R_IN = 0.64, R_ROAD = 0.74; // balls: bigger than the prefab's 0.58 / 0.65 so they read at portfolio size
const SLOTS = [[-0.605, 1.441], [0.642, 1.441], [-0.605, 0.291], [0.642, 0.291], [-0.605, -0.853], [0.642, -0.853], [-0.605, -2.021], [0.642, -2.021]];

export async function create(ctx) {
  let dead = false;
  const { THREE, base, env } = ctx;
  const T = n => loadTexture(base + n);
  const [ballM, boxM, doneM, pathM, tunnelM, bridgeM, roadTex, basketTex, yarnTex, glassTex, tunnelTex, bridgeTex, arrowTex, ringTex, sparkTex, dotTex, cellTex, praiseTex, levels, play] = await Promise.all([
    loadModel(base + 'YarnBall.json'), loadModel(base + 'YarnBox.json'), loadModel(base + 'BucketComplete.json'), loadModel(base + 'Path.json'), loadModel(base + 'Tunnel.json'), loadModel(base + 'Bridge.json'),
    T('road.webp'), T('basket.webp'), T('yarn.webp'), T('glass.webp'), T('tunnel.webp'), T('bridge.webp'), T('arrow.webp'), T('ring.webp'), T('sparkle.webp'), T('dot.webp'), T('cell.webp'),
    Promise.all(PRAISE.map(T)), Promise.all(LEVELS.map(n => fetch(`${base}level${n}.json`).then(r => r.json()))),
    ctx.loadSounds(SOUNDS),
  ]);
  const sfx = (n, o) => play(n, o);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  const rig = addRig(scene, { size: 18, floorY: -1.25 });
  // Neutral white light (the shipped scene has one white directional light): the warm portfolio rig greys the lilac road.
  rig.key.intensity = 1.5; rig.key.color.set('#ffffff'); rig.floor.material.opacity = 0.16;
  scene.traverse(o => { if (o.isHemisphereLight) { o.color.set('#ffffff'); o.groundColor.set('#8f7fb8'); o.intensity = 0.6; } });
  const tweens = tweenList();
  const W = (x, y, h = 0) => new THREE.Vector3(x, h, -y); // game x/y (y = Unity z) -> three

  // ---------- materials ----------
  for (const t of [roadTex, basketTex, yarnTex, tunnelTex]) t.anisotropy = 4;
  roadTex.wrapS = roadTex.wrapT = THREE.RepeatWrapping;
  const roadBase = new THREE.Color('#f4f0ff'), roadEmis = new THREE.Color('#a4a4a4'), warn = new THREE.Color('#ff2000');
  const roadMat = new THREE.MeshStandardMaterial({ color: roadBase.clone(), map: roadTex, roughness: 0.85, emissive: roadEmis.clone(), emissiveMap: roadTex, envMap: env, envMapIntensity: 0.25 });
  // Basket: pink plastic with a metallic sheen and a hard clear coat (reads like the store art's glossy boxes).
  const basketMat = new THREE.MeshPhysicalMaterial({ color: '#f2e0ee', map: basketTex, metalness: 0.6, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.04,
    emissive: '#101010', emissiveMap: basketTex, envMap: env, envMapIntensity: 1.4 });
  // CarSpots cells: the shipped RoundedSquare sprite, white at 15%, under each slot.
  const cellMat = new THREE.MeshBasicMaterial({ map: cellTex, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false });
  const cellGeo = new THREE.PlaneGeometry(1.29, 1.21).rotateX(-Math.PI / 2);
  // Top-run outline (Container.UpdateCarOutlines): a white shell on the balls the next tap would send.
  const outlineMat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.BackSide, toneMapped: false });
  const glassMat = new THREE.MeshMatcapMaterial({ matcap: glassTex, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const bridgeMat = new THREE.MeshStandardMaterial({ color: '#f4f0ff', map: bridgeTex, roughness: 0.85, emissive: '#a4a4a4', emissiveMap: bridgeTex, envMap: env, envMapIntensity: 0.25 });
  const bridgeShadowMat = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.3, depthWrite: false });
  const tunnelMat = new THREE.MeshStandardMaterial({ map: tunnelTex, roughness: 0.85, envMap: env, envMapIntensity: 0.6 });
  // Yarn: the shader graph's BaseColor = tex * lerp(Color_1, Color_2, tex), Emission = BaseColor * _Emission. A soft
  // fresnel darkening stands in for the outline shell, and the env light is kept low so colours stay saturated.
  const ballMats = new Map();
  const ballMat = c => {
    if (ballMats.has(c)) return ballMats.get(c);
    const [hex, em] = BALL[c] || BALL[13], col = new THREE.Color(hex);
    const m = new THREE.MeshStandardMaterial({ color: col, map: yarnTex, roughness: 0.62, metalness: 0, emissive: col.clone().multiplyScalar(em * 0.9 + 0.08), emissiveMap: yarnTex,
      envMap: env, envMapIntensity: 0.32 });
    m.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= sampledDiffuseColor.rgb;').replace('#include <opaque_fragment>',
      `{ float f = 1.0 - saturate(dot(normal, geometryViewDir)); outgoingLight *= 1.0 - 0.42 * pow(f, 2.2);
         float l = dot(outgoingLight, vec3(.2126,.7152,.0722)); outgoingLight = max(vec3(0.0), mix(vec3(l), outgoingLight, 1.12)); }
#include <opaque_fragment>`); };
    m.customProgramCacheKey = () => 'yarnball';
    ballMats.set(c, m); return m;
  };

  // ---------- geometry ----------
  const ballGeo = ballM.parts[0].geometry; ballGeo.translate(...ballM.min.clone().add(ballM.max).multiplyScalar(-0.5).toArray());
  ballGeo.scale(1 / ballM.size.x, 1 / ballM.size.y, 1 / ballM.size.z); // unit diameter
  // box_yarn_open: YarnBox under YarnBox_pivot_Back, yawed -90 in Unity => in three the model's +X end (its mouth) points
  // at local +z, the side the EntryPoint and the road are on.
  const prepBox = g => g.clone().rotateY(-Math.PI / 2).scale(BOX_S, BOX_S, BOX_S).translate(0, -1.23, 0.27);
  const boxGeo = prepBox(boxM.parts[0].geometry);
  const doneGeo = prepBox(doneM.parts.find(p => /Complete/i.test(p.name)).geometry);
  const lidGeo = prepBox(doneM.parts.find(p => /Glass/i.test(p.name)).geometry);
  // The road segment: all five parts of Path 1 (surface + borders) share one texture.
  const seg = (() => {
    const pos = [], nrm = [], uv = [], idx = []; let off = 0;
    for (const p of pathM.parts) {
      const g = p.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
      for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nrm.push(N.getX(i), N.getY(i), N.getZ(i)); uv.push(U.getX(i), U.getY(i)); }
      for (const v of g.index.array) idx.push(v + off); off += P.count;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    // Lane height: the highest surface point near the middle of the cross-section.
    let lane = -Infinity; for (let i = 0; i < pos.length; i += 3) if (Math.abs(pos[i]) < 1.2) lane = Math.max(lane, pos[i + 1]);
    return { pos, nrm, uv, idx, geo, zmax: pathM.max.z, len: pathM.size.z, lane };
  })();
  const LANE_Y = ROAD_Y + seg.lane * ROAD_HS; // top of the lane, Unity y
  // Connector: Road_Path_Prefab, a narrow piece of the road (width x0.2416) from the basket's mouth wall to the lane.
  const bridgeGeo = seg.geo.clone().scale(0.2416, 0.5, 1.75 / seg.len).translate(0, LANE_Y - 0.2, 3.85);
  const tunnelGeo = tunnelM.parts[0].geometry.clone(); tunnelGeo.translate(-(tunnelM.min.x + tunnelM.max.x) / 2, -tunnelM.min.y, -(tunnelM.min.z + tunnelM.max.z) / 2);
  // Slot k (CarSpots order: 0 = deepest, far from the mouth) in basket-local three coordinates.
  const slotLocal = k => new THREE.Vector3(BOX_S * SLOTS[k][0], -1.23 + 0.14 + R_IN, -(BOX_S * SLOTS[k][1] + 0.04));

  // Raised knots (waypoint height, e.g. a road crossing over itself): the spline's y between knots with the knots' flat
  // tangents is y0 + (y1 - y0) * smoothstep(t). core.Road samples 40 points per knot span.
  function heightFn(r, wps) {
    const ys = wps.map(w => w[3] || 0); if (!ys.some(Boolean)) return () => 0;
    const spans = ys.length - 1;
    return u => {
      u = r.closed ? ((u % 1) + 1) % 1 : Math.min(1, Math.max(0, u));
      const d = u * r.length; let lo = 0, hi = r.cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= d) lo = m; else hi = m; }
      const j = lo + (d - r.cum[lo]) / (r.cum[hi] - r.cum[lo] || 1), sp = Math.min(spans - 1, Math.floor(j / 40)), t = Math.min(1, j / 40 - sp);
      return ys[sp] + (ys[sp + 1] - ys[sp]) * t * t * (3 - 2 * t);
    };
  }
  let H = () => 0;
  // SplineMeshDeformer.Build (ForwardAxis Z; Unity's mesh z is this JSON's -z): tile the segment a whole number of times along the road, each source vertex placed at
  // its share of the tile length, offset by (right * x * 0.4 + up * y * 0.5) on a world-up frame.
  function buildRoad(r) {
    const tiles = Math.max(1, Math.round(r.length / seg.len)) * ROAD_RES, tileLen = r.length / tiles, n = seg.pos.length / 3;
    const pos = new Float32Array(tiles * n * 3), nrm = new Float32Array(tiles * n * 3), uv = new Float32Array(tiles * n * 2), idx = new Uint32Array(tiles * seg.idx.length);
    for (let k = 0; k < tiles; k++) {
      for (let i = 0; i < n; i++) {
        const x = seg.pos[i * 3], y = seg.pos[i * 3 + 1], z = seg.pos[i * 3 + 2];
        let u = (k + (seg.zmax - z) / seg.len) * tileLen / r.length; if (r.closed) u = Math.min(u, 0.99999); // keep the seam on the same point
        const p = r.at(u), d = r.dir(u), fx = d[0], fz = -d[1]; // forward in three (x, -y)
        const rx = -fz, rz = fx;                                 // right = forward x up, turned into three's handedness
        const o = (k * n + i) * 3;
        pos[o] = p[0] + rx * x * ROAD_WS; pos[o + 1] = ROAD_Y + H(u) + y * ROAD_HS; pos[o + 2] = -p[1] + rz * x * ROAD_WS;
        const nx = seg.nrm[i * 3], ny = seg.nrm[i * 3 + 1], nz = seg.nrm[i * 3 + 2];
        const wx = rx * nx - fx * nz, wz = rz * nx - fz * nz, m = Math.hypot(wx, ny, wz) || 1;
        nrm[o] = wx / m; nrm[o + 1] = ny / m; nrm[o + 2] = wz / m;
        uv[(k * n + i) * 2] = seg.uv[i * 2]; uv[(k * n + i) * 2 + 1] = seg.uv[i * 2 + 1];
      }
      for (let j = 0; j < seg.idx.length; j++) idx[k * seg.idx.length + j] = seg.idx[j] + k * n;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
    return g;
  }
  // TrackArrow: a 1.2 x 0.45 arrow bent along the lane every 4 units, pointing the way the yarn travels.
  const arrowMat = new THREE.MeshBasicMaterial({ map: arrowTex, color: '#f1ebfa', transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  function buildArrows(r) {
    const count = Math.floor(r.length / ARROW_GAP), pos = [], uv = [], idx = [], S = 10, Lh = 0.6, Wd = 0.45 / 2;
    for (let a = 0; a < count; a++) {
      const dc = (r.closed ? a / count : (count === 1 ? 0.5 : a / (count - 1)) * 0.9 + 0.05) * r.length, b = pos.length / 3;
      for (let s = 0; s <= S; s++) {
        const u = (dc - Lh + 2 * Lh * s / S) / r.length, p = r.at(u), d = r.dir(u), rx = d[1], rz = d[0];
        for (const side of [-1, 1]) { pos.push(p[0] + rx * Wd * side, LANE_Y + H(u) + 0.03, -p[1] + rz * Wd * side); uv.push(s / S, side > 0 ? 1 : 0); }
        if (s < S) { const q = b + s * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(g, arrowMat); m.material.side = THREE.DoubleSide; m.renderOrder = 1; return m;
  }

  // ---------- effects ----------
  const fx = new THREE.Group(); scene.add(fx);
  // Confetti: one instanced mesh of little paper squares with gravity, drag and tumble.
  const CONF = 260, confGeo = new THREE.PlaneGeometry(0.22, 0.13), confMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false });
  const conf = new THREE.InstancedMesh(confGeo, confMat, CONF); conf.frustumCulled = false; conf.count = 0; fx.add(conf);
  const parts = []; const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpS = new THREE.Vector3(), tmpC = new THREE.Color();
  function confetti(at, colors, n = 50, power = 1) {
    for (let i = 0; i < n; i++) {
      if (parts.length >= CONF) parts.shift();
      const a = Math.random() * Math.PI * 2, up = 7 + Math.random() * 6;
      parts.push({ p: at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5)),
        v: new THREE.Vector3(Math.cos(a) * (2 + Math.random() * 5) * power, up * power, Math.sin(a) * (2 + Math.random() * 5) * power),
        r: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), w: new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16),
        c: new THREE.Color(colors[i % colors.length]).offsetHSL(0, 0, (Math.random() - 0.5) * 0.12), life: 1.6 + Math.random() * 0.8, t: 0 });
    }
  }
  function updateConfetti(dt) {
    for (const q of parts) {
      q.t += dt; q.v.y -= 22 * dt; q.v.multiplyScalar(Math.exp(-2.4 * dt)); if (q.v.y < -3.5) q.v.y = -3.5;
      q.p.addScaledVector(q.v, dt); q.r.addScaledVector(q.w, dt);
    }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].t > parts[i].life) parts.splice(i, 1);
    parts.forEach((q, i) => {
      const s = Math.min(1, (q.life - q.t) * 3);
      tmpM.compose(q.p, tmpQ.setFromEuler(tmpE.set(q.r.x, q.r.y, q.r.z)), tmpS.set(s, s, s)); conf.setMatrixAt(i, tmpM); conf.setColorAt(i, tmpC.copy(q.c));
    });
    conf.count = parts.length; conf.instanceMatrix.needsUpdate = true; if (conf.instanceColor) conf.instanceColor.needsUpdate = true;
  }
  // Sprites: the shipped ring, sparkle and soft dot textures.
  function burst(tex, at, { size = 2, to = 4, life = 0.4, color = '#ffffff', rise = 0, spin = 0, opacity = 1 } = {}) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, opacity, toneMapped: false }));
    sp.position.copy(at); fx.add(sp);
    simTweens.add(life, k => { const s = size + (to - size) * k; sp.scale.set(s, s, 1); sp.material.opacity = opacity * (1 - k) ** 1.5; sp.position.y = at.y + rise * k; sp.material.rotation = spin * k; },
      easeOutCubic, () => { fx.remove(sp); sp.material.dispose(); });
  }

  // ---------- level ----------
  let G, lvl = 0, root, baskets, views, auto = false, speed = 1, acc = 0, ended = false, clock = 0, warnT = 0, lastFull = -9;
  const simTweens = tweenList(); // advanced in simulation time (follows the test speed)
  let later = [];
  const after = (d, fn) => later.push({ at: clock + d, fn, g: G });
  const hov = hoverSprings();

  function build() {
    hov.clear(); tweens.clear(); simTweens.clear(); later = []; parts.length = 0; conf.count = 0; fx.clear(); fx.add(conf);
    if (root) { scene.remove(root); root.traverse(o => { if (o.userData.own) o.geometry.dispose(); }); } // only per-level geometry; models are shared
    acc = 0; ended = false; warnT = 0; lastFull = -9; ctx.hideResult();
    G = new YarnGame(levels[lvl]); ctx.setLevel(`Level ${LEVELS[lvl]}`);
    root = new THREE.Group(); scene.add(root);
    const r = G.road; H = heightFn(r, levels[lvl].waypoints);
    const road = new THREE.Mesh(buildRoad(r), roadMat); road.castShadow = road.receiveShadow = true; road.userData.own = true; root.add(road);
    const arrows = buildArrows(r); arrows.userData.own = true; root.add(arrows);
    // Open roads end in the shipped wool tunnels (TunnelOffset -0.3: pulled 0.3 back over the road), opening to the road.
    if (!r.closed) for (const u of [0, 1]) {
      const p = r.at(u), d = r.dir(u), s = u ? -1 : 1, t = new THREE.Mesh(tunnelGeo, tunnelMat);
      t.position.copy(W(p[0] + d[0] * 0.3 * s, p[1] + d[1] * 0.3 * s, -1.61)); t.rotation.y = Math.atan2(d[0] * s, -d[1] * s) + Math.PI;
      t.scale.set(0.912, 1.318, 1.208); t.castShadow = true; t.receiveShadow = true; root.add(t);
    }
    // Bridge.prefab under every raised knot (Bridge.fbx at y -1.11, x1.1), along the road.
    levels[lvl].waypoints.forEach((w, i) => {
      if (!(w[3] > 0)) return;
      const j = Math.min(r.poly.length - 1, i * 40), u = r.cum[j] / r.length, d = r.dir(u), br = new THREE.Group();
      for (const p of bridgeM.parts) { const m = new THREE.Mesh(p.geometry, /Material004/.test(p.mat) ? bridgeShadowMat : bridgeMat); m.castShadow = m.receiveShadow = !/Material004/.test(p.mat); br.add(m); }
      br.position.copy(W(r.poly[j][0], r.poly[j][1], -1.11)); br.rotation.y = Math.atan2(d[0], -d[1]); br.scale.x = 1.1; root.add(br);
    });
    baskets = G.baskets.map((b, i) => {
      const g = new THREE.Group(); g.position.copy(W(b.x, b.y)); g.rotation.y = -b.rot * Math.PI / 180;
      const hover = new THREE.Group(), body = new THREE.Group(); g.add(hover); hover.add(body);
      const box = new THREE.Mesh(boxGeo, basketMat), lid = new THREE.Mesh(lidGeo, glassMat), bridge = new THREE.Mesh(bridgeGeo, roadMat);
      box.castShadow = box.receiveShadow = true; bridge.castShadow = bridge.receiveShadow = true; lid.visible = false; lid.renderOrder = 3;
      body.add(box, lid); g.add(bridge);
      for (let k = 0; k < CAPACITY; k++) { const c = new THREE.Mesh(cellGeo, cellMat); c.position.copy(slotLocal(k)); c.position.y = -1.23 + 0.13; c.renderOrder = 1; body.add(c); }
      const hit = new THREE.Mesh(new THREE.BoxGeometry(4.3, 2.4, 6.8), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(0, -0.5, 0.4); hit.userData.basket = i; hit.userData.own = true; g.add(hit);
      root.add(g);
      const B = { g, hover, body, box, lid, bridge, hit, b, inside: [], shot: 0 };
      b.balls.forEach((c, k) => { const v = makeBall(c); v.state = 'basket'; v.B = B; body.add(v.g); v.g.position.copy(slotLocal(k)); v.k = k; B.inside.push(v); });
      // Level start: baskets drop in, then their yarn pops in.
      body.scale.setScalar(0.001);
      tweens.add(0.45, k => body.scale.setScalar(Math.max(0.001, k)), easeOutBack);
      return B;
    });
    views = new Map();
    root.updateMatrixWorld(true); fit();
  }
  function makeBall(c) {
    const g = new THREE.Group(), m = new THREE.Mesh(ballGeo, ballMat(c));
    m.castShadow = true; m.scale.setScalar(R_IN * 2); m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6); g.add(m);
    const o = new THREE.Mesh(ballGeo, outlineMat); o.scale.setScalar(R_IN * 2 * 1.13); o.visible = false; g.add(o);
    return { g, m, o, c, R: R_IN, sq: 0, sv: 0, seed: Math.random() * 100, lat: 0 };
  }

  // A 30-degree lens from ~58 degrees up (the shipped camera looks down at 55), fitted to the road, baskets and tunnels.
  function fit() {
    const aspect = (ctx.el.clientWidth || 1) / (ctx.el.clientHeight || 1), pts = [];
    for (let i = 0; i < 160; i++) { const p = G.road.at(i / 160), d = G.road.dir(i / 160); for (const s of [-1.2, 1.2]) pts.push(W(p[0] + d[1] * s, p[1] - d[0] * s, -0.7 + H(i / 160))); }
    for (const B of baskets) for (const [x, z] of [[-2, -2.9], [2, -2.9], [-2, 3.4], [2, 3.4]]) pts.push(B.g.localToWorld(new THREE.Vector3(x, 0.2, z)));
    if (!G.road.closed) for (const u of [0, 1]) { const p = G.road.at(u); for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) pts.push(W(p[0] + dx, p[1] + dy, 1.5)); }
    const el = 58 * Math.PI / 180;
    fitPerspective(camera, pts, aspect, { dir: new THREE.Vector3(0, Math.sin(el), Math.cos(el)), top: 0.2, bottom: 0.16 });
  }

  // ---------- input ----------
  const ray = new THREE.Raycaster();
  const pick = e => {
    const r = ctx.el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const h = ray.intersectObjects(baskets.map(b => b.hit))[0]; return h ? h.object.userData.basket : -1;
  };
  function onPointer(e) { if (auto || G.over) return; const i = pick(e); if (i >= 0) tap(i); }
  function onHover(e) {
    if (auto || G.over) return hov.set(null);
    const i = pick(e), B = baskets[i]; hov.set(B && !B.b.complete && B.b.balls.length ? B.hover : null);
  }
  const leave = () => hov.set(null);
  ctx.el.addEventListener('pointerdown', onPointer); ctx.el.addEventListener('pointermove', onHover); ctx.el.addEventListener('pointerleave', leave);

  function tap(i) {
    const before = G.events.length, r = G.tap(i), B = baskets[i];
    if (!r.ok) {
      sfx(r.why === 'road full' ? 'full' : 'error'); if (r.why === 'road full') { warnT = Math.max(warnT, 0.8); ctx.shake(0.25); }
      // Reject: a quick head-shake of the basket.
      simTweens.add(0.35, k => { B.body.rotation.y = Math.sin(k * Math.PI * 6) * 0.07 * (1 - k); });
      return r;
    }
    sfx('tap');
    handle(G.events.splice(before));
    return r;
  }
  function handle(events) {
    for (const e of events) {
      const B = baskets.find(x => x.b === e.basket);
      if (e.type === 'send') send(B, e.balls);
      if (e.type === 'land') land(B, e.ball);
      if (e.type === 'complete') after(0.3, () => complete(B));
    }
  }
  // Tap: the basket lifts and tips its mouth toward the road (BucketFront_LiftUp) while the run hops out one by one.
  function send(B, list) {
    const dur = list.length ? list.at(-1).arrive - G.time + 0.15 : 0.3;
    simTweens.add(dur + 0.35, k => {
      const a = Math.min(1, k * (dur + 0.35) / 0.12), r = Math.max(0, (k * (dur + 0.35) - dur) / 0.35), w = a * (1 - easeOutBack(r));
      B.body.position.y = 0.32 * w; B.body.rotation.x = 0.11 * w;
    }, x => x);
    list.forEach((ball, j) => {
      const v = B.inside.pop(); if (!v) return;
      const from = v.g.getWorldPosition(new THREE.Vector3()); B.body.remove(v.g); root.add(v.g); v.g.position.copy(from);
      v.state = 'exit'; v.ball = ball; v.t = 0; v.wait = Math.max(0, ball.arrive - G.time - 0.2); v.d = 0.2; v.from = from; v.B = null;
      views.set(ball, v);
      after(v.wait, () => { sfx('out', { rate: 1 + 0.07 * j, volume: 0.6 }); v.sv += 7; // crouch, then launch
        // Each ball out: the basket kicks the other way (Left/RightShot).
        const s = (B.shot++ % 2 ? 1 : -1) * 0.05; simTweens.add(0.18, k => { B.body.rotation.z = s * Math.sin(k * Math.PI); }); });
    });
  }
  // Road -> basket: an arc into the next slot, landing squash, the basket's CarFit punch.
  function land(B, ball) {
    const v = views.get(ball); views.delete(ball); if (!v) return;
    const k = B.inside.length; B.inside.push(v);
    v.state = 'enter'; v.t = 0; v.d = 0.36; v.from = v.g.position.clone(); v.B = B; v.k = k;
  }
  function settle(v) {
    const B = v.B; root.remove(v.g); B.body.add(v.g); v.g.position.copy(slotLocal(v.k)); v.state = 'basket'; v.sv -= 9;
    sfx('fit', { rate: 0.95 + 0.05 * v.k, volume: 0.7 });
    burst(ringTex, v.g.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.4, 0)), { size: 0.6, to: 2.4, life: 0.35, color: BALL[v.c][2], opacity: 0.8 });
    simTweens.add(0.3, k => { const s = Math.sin(k * Math.PI * 2) * (1 - k); B.body.scale.set(1 - 0.035 * s, 1 + 0.1 * s, 1 - 0.035 * s); }, x => x);
  }
  // BucketComplete: the bridge retracts, the box swaps to the finished model, the glass lid pops on, confetti, praise.
  function complete(B) {
    const last = G.baskets.every(b => b.complete || !b.balls.length);
    sfx(last ? 'last' : 'done'); sfx('confetti', { volume: 0.45 });
    const z0 = B.bridge.scale.z;
    simTweens.add(0.17, k => { B.bridge.scale.z = z0 * Math.max(0.001, 1 - k); }, x => x, () => { B.bridge.visible = false; });
    B.box.geometry = doneGeo; B.lid.visible = true;
    simTweens.add(0.45, k => { B.lid.scale.setScalar(Math.max(0.001, k)); B.lid.position.y = 1.4 * (1 - k); }, easeOutBack);
    simTweens.add(0.5, k => { const s = Math.sin(k * Math.PI * 3) * (1 - k); B.body.scale.set(1 + 0.06 * s, 1 - 0.12 * s, 1 + 0.06 * s); }, x => x);
    // the yarn inside does a little wave
    B.inside.forEach((v, j) => after(0.03 * j, () => { v.sv += 6; }));
    const top = B.g.localToWorld(new THREE.Vector3(0, 0.6, 0.27)), col = BALL[B.b.balls[0]]?.[2] || '#ffffff';
    confetti(top, [col, '#ffffff', '#ffd84a', '#ff7ac8', '#7ad7ff'], 46, 0.85);
    burst(sparkTex, top.clone().add(new THREE.Vector3(1.4, 0.6, 0)), { size: 0.3, to: 1.6, life: 0.5, spin: 2 });
    burst(sparkTex, top.clone().add(new THREE.Vector3(-1.2, 0.9, 0.5)), { size: 0.2, to: 1.2, life: 0.45, spin: -2 });
    burst(dotTex, top, { size: 2, to: 7, life: 0.35, color: col, opacity: 0.7 });
    after(0.5, () => praise(B));
  }
  function praise(B) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: praiseTex[Math.floor(Math.random() * praiseTex.length)], transparent: true, depthTest: false, toneMapped: false }));
    const at = B.g.position.clone().add(new THREE.Vector3(0, 2.5, 0)); sp.position.copy(at); sp.renderOrder = 10; fx.add(sp);
    simTweens.add(1.3, k => {
      const pop = k < 0.18 ? easeOutBack(k / 0.18) : 1; sp.scale.set(5.5 * pop, 5.5 * pop, 1);
      sp.position.y = at.y + k * 1.6; sp.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }, x => x, () => { fx.remove(sp); sp.material.dispose(); });
  }

  // ---------- per-frame ----------
  const up = new THREE.Vector3(0, 1, 0), tmpV = new THREE.Vector3(), axis = new THREE.Vector3(), q = new THREE.Quaternion();
  function roadPos(ball, v, out) {
    const u = G.slotU(ball.slot), p = G.road.at(u), d = G.road.dir(u);
    // Lateral wander (LateralWanderAmplitude, scaled to the lane left by the bigger ball) and a little longitudinal jitter.
    const t = clock * 1.5 + v.seed, lat = (Math.sin(t) * 0.6 + Math.sin(t * 2.3 + 1.7) * 0.4) * 0.2, lon = Math.sin(t * 1.3 + 0.4) * 0.08;
    return out.set(p[0] + d[1] * lat + d[0] * lon, LANE_Y + H(u) + R_ROAD - 0.06, -(p[1] - d[0] * lat + d[1] * lon));
  }
  function stepBall(v, dt) {
    // squash spring (k 260, c 13): positive = tall & thin, negative = squashed
    v.sv += (-v.sq * 260 - v.sv * 13) * dt; v.sq += v.sv * dt;
    const s = Math.max(-0.35, Math.min(0.35, v.sq * 0.6)); v.g.scale.set(1 - s * 0.5, 1 + s, 1 - s * 0.5);
    if (v.state === 'exit') {
      if (v.wait > 0) { v.wait -= dt; return; }
      v.t += dt; const k = Math.min(1, v.t / v.d), to = roadPos(v.ball, v, tmpV);
      const e = easeInOut(k); v.g.position.lerpVectors(v.from, to, e); v.g.position.y += Math.sin(k * Math.PI) * 1.5;
      v.R = R_IN + (R_ROAD - R_IN) * k; v.m.scale.setScalar(v.R * 2);
      if (k >= 1) { v.state = 'road'; v.sv -= 8; v.prev = to.clone(); }
    } else if (v.state === 'road') {
      const to = roadPos(v.ball, v, tmpV), mv = to.clone().sub(v.prev ?? to), dist = mv.length();
      v.g.position.copy(to);
      if (dist > 1e-5 && dist < 3) { axis.crossVectors(up, mv).normalize(); q.setFromAxisAngle(axis, dist / R_ROAD); v.m.quaternion.premultiply(q); }
      v.prev = to.clone();
    } else if (v.state === 'enter') {
      v.t += dt; const k = Math.min(1, v.t / v.d), to = v.B.body.localToWorld(slotLocal(v.k));
      const e = 1 - (1 - k) ** 2; v.g.position.lerpVectors(v.from, to, e); v.g.position.y += Math.sin(k * Math.PI) * 1.8;
      v.R = R_ROAD + (R_IN - R_ROAD) * k; v.m.scale.setScalar(v.R * 2);
      if (k >= 1) settle(v);
    }
  }
  function update(dt) {
    hov.update(dt);
    if (!G) return;
    const sdt = dt * speed;
    acc += sdt; let n = 0;
    while (acc >= 1 / 60 && n < 600) {
      if (auto && !G.over && G.time - G.lastTap >= 0.45) { const i = G.botChoice(); if (i >= 0) tap(i); }
      G.step(1 / 60); acc -= 1 / 60; n++; clock += 1 / 60;
      handle(G.events.splice(0));
      for (let j = 0; j < later.length; j++) { const l = later[j]; if (clock >= l.at) { later.splice(j--, 1); if (l.g === G) l.fn(); } }
    }
    simTweens.update(sdt);
    for (const B of baskets) for (const v of B.inside) if (v.state !== 'enter') stepBall(v, sdt);
    for (const v of views.values()) stepBall(v, sdt);
    for (const B of baskets) for (const v of B.inside) if (v.state === 'enter') stepBall(v, sdt);
    tweens.update(dt);
    updateConfetti(sdt);
    for (const B of baskets) { const run = B.b.complete ? 0 : G.topRun(B.b); B.inside.forEach((v, k) => { v.o.visible = v.state === 'basket' && k >= B.inside.length - run; }); }
    // Near fail (NearFailSpotThreshold 2): the road flashes red while it is almost full.
    const free = G.usable - G.onRoad(), danger = !G.over && G.onRoad() > 0 && free <= 2;
    if (danger) warnT = Math.max(warnT, 0.25);
    warnT = Math.max(0, warnT - sdt);
    const flash = warnT > 0 ? (Math.sin(clock * Math.PI * 2 / 0.4) * 0.5 + 0.5) * 0.55 : 0;
    roadMat.color.copy(roadBase).lerp(warn, flash); roadMat.emissive.copy(roadEmis).lerp(warn, flash * 0.35);
    hud.textContent = `${G.onRoad()}/${G.usable}`;
    if (G.over && !ended) {
      ended = true;
      if (G.result === 'win') { after(0.55, () => { sfx('win'); confetti(camera.userData.view.target.clone().add(new THREE.Vector3(0, 1, 0)), ['#ff4d6d', '#ffd84a', '#7ad7ff', '#8cff6a', '#c77dff', '#ffffff'], 120, 1.3); }); after(1.9, () => finish('win')); }
      else { sfx('fail'); ctx.shake(1); warnT = 1.2; after(1.1, () => finish('lose')); }
    }
  }
  function finish(res) {
    if (dead) return;
    if (auto) { lvl = res === 'win' ? (lvl + 1) % LEVELS.length : lvl; build(); return; }
    if (res === 'win') {
      const last = lvl === LEVELS.length - 1;
      ctx.result({ win: true, last, title: last ? 'All clear!' : 'Level complete', sub: last ? `${LEVELS.length} shipped levels. 145 more in the store.` : `Yarn Collect · level ${LEVELS[lvl]}`,
        next: () => { lvl = (lvl + 1) % LEVELS.length; build(); }, retry: () => build() });
    } else ctx.result({ win: false, title: 'Tangled!', sub: 'The road filled with yarn that had nowhere to go.', next: () => build() });
  }

  const hud = document.createElement('div'); hud.className = 'arcade-count'; ctx.ui.append(hud);
  build();
  return {
    scene, camera, update, resize: () => fit(),
    autoplay(on) { auto = on; },
    restart() { auto = false; speed = 1; lvl = 0; build(); },
    // The visitor jumps in: the bot stops and the level carries on; a level that already ended moves on to the next.
    takeover() { auto = false; if (G.over) { lvl = G.result === 'win' ? (lvl + 1) % LEVELS.length : lvl; build(); } },
    reloadLevel() { build(); },
    test: {
      set speed(v) { speed = v; },
      get state() { return { total: LEVELS.length, level: LEVELS[lvl], over: G.over, result: G.result, progress: G.baskets.filter(b => b.complete).length / G.baskets.length, onBelt: G.onRoad(), auto, time: G.time }; },
      reset() { auto = false; lvl = 0; build(); },
      goto(n, bot = true) { lvl = n - 1; auto = bot; build(); },
      baskets: () => G.baskets.map((b, i) => ({ i, n: b.balls.length, complete: b.complete })),
      nextMove() { if (G.over || G.time - G.lastTap < 0.45) return null; const i = G.botChoice(); return i < 0 ? null : this.screenOfBasket(i); },
      screenOfBasket(i) { baskets[i].g.updateWorldMatrix(true, false); const v = baskets[i].g.localToWorld(new THREE.Vector3(0, -0.2, 0)).project(camera), r = ctx.el.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
    },
    destroy() { dead = true; ctx.el.removeEventListener('pointerdown', onPointer); ctx.el.removeEventListener('pointermove', onHover); ctx.el.removeEventListener('pointerleave', leave); hud.remove(); disposeScene(scene); },
  };
}
