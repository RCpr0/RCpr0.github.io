// Mice Flow renderer, in the shipped "Mouse Pantry" art. The meshes are the shipped procedural ones (Mouse, the baked
// cheese tiles, the cottage foundation/roof/trim, the burrow well), read straight out of the Unity mesh assets by
// tools/games/mice-unitymesh.mjs; the looks port the pantry shaders: glazed cheese with the baked normal/cavity atlas
// and golden-yellow finish, vertex-palette mice whose gait and carry pose run in the vertex shader (AnimateMouse), and
// colour-matched glossy houses. Motion follows the shipped presentation scripts: HousePresentation (launch stretch,
// landing bounce, spawn puff, dormant settle, completion pop), MousePresentation (doorway emergence clipped at the
// door, pickup pulse, carry pose, burrow dive clipped at the rim) and MouseTraffic (crowd separation). Rules and
// timing live in core.js. Everything is in shipped Unity units inside groups scaled by K.
import { MiceGame, TRAY, K, MULT, PICKUP, PICKUP_DELAY, JUMP, SLOT_GAP, HOUSE_DX, HOUSE_DZ } from './core.js';
import { RoundedBoxGeometry } from '../../vendor/RoundedBoxGeometry.js';
import { tweenList, easeOutCubic, disposeScene, gloss, addRig, castShadows, fitPerspective, hoverSprings } from '../common.js';

const LEVELS = [1, 2, 3];
const PALETTE = ['#EB3B3B', '#458CF2', '#22B14C', '#FFF200', '#6F3198', '#FF7E00', '#FFA3B1', '#2EBFB8', '#9C5A3C', '#A6A6A6', '#FFFFFF', '#000000', '#FFF9BD', '#00B7EF', '#69D8FA', '#2F3699', '#990030', '#FF61DF', '#ED7EED', '#FFC20E', '#FFF459'];
const BITES = ['cheese-bite0.json', 'cheese-bite1.json', 'cheese-bite2.json', 'cheese-bite3.json', 'cheese-bite4.json', 'cheese-bite5.json', 'cheese-bite6.json', 'cheese-bite7.json'];
const DENSE = ['cheese-dense0.json', 'cheese-dense1.json', 'cheese-dense2.json', 'cheese-dense3.json', 'cheese-dense4.json', 'cheese-dense5.json', 'cheese-dense6.json', 'cheese-dense7.json'];
const PITCH = 60 * Math.PI / 180; // the shipped camera looks down at 60 degrees
const DIVE = Math.max(0.2, 0.75 / MULT); // Ant JumpDuration / multiplier
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const toward = (v, to, d) => v < to ? Math.min(to, v + d) : Math.max(to, v - d);

export async function create(ctx) {
  let dead = false;
  const { THREE } = ctx;
  const base = ctx.base;
  // ---- Assets: shipped meshes (with vertex colour + flag channels), the baked cheese atlas, count digits, sounds ----
  const b64 = (s, T) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
  async function mesh(file) {
    const p = (await (await fetch(base + file)).json()).parts[0], g = new THREE.BufferGeometry();
    const unq = (s, mn, sc, k) => Float32Array.from(b64(s, Uint16Array), (v, i) => mn[i % k] + v * sc[i % k]);
    g.setAttribute('position', new THREE.BufferAttribute(unq(p.pos, p.pmin, p.pscale, 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(b64(p.nrm, Int8Array), v => v / 127), 3));
    if (p.uv) g.setAttribute('uv', new THREE.BufferAttribute(unq(p.uv, p.umin, p.uscale, 2), 2));
    if (p.uv1) g.setAttribute('flags', new THREE.BufferAttribute(unq(p.uv1, p.u1min, p.u1scale, 2), 2));
    if (p.col) g.setAttribute('color', new THREE.BufferAttribute(b64(p.col, Uint8Array), 4, true));
    g.setIndex(new THREE.BufferAttribute(b64(p.idx, p.i32 ? Uint32Array : Uint16Array), 1));
    return g;
  }
  const tex = (file, srgb) => new Promise(res => new THREE.TextureLoader().load(base + file, t => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; res(t); }));
  const [levels, geo, detail, digits, play] = await Promise.all([
    Promise.all(LEVELS.map(n => fetch(`${base}level${n}.json`).then(r => r.json()))),
    (async () => {
      const [mouse, smooth0, bites, dense, hBase, hRoof, hTrim, well] = await Promise.all([mesh('mouse.json'), mesh('cheese-smooth.json'), Promise.all(BITES.map(mesh)), Promise.all(DENSE.map(mesh)),
        mesh('house-base.json'), mesh('house-roof.json'), mesh('house-trim.json'), mesh('burrow-well.json')]);
      return { mouse, smooth: smooth0, bites, dense, hBase, hRoof, hTrim, well };
    })(),
    tex('cheese-detail.webp', false), tex('digits.webp', true),
    ctx.loadSounds({ tap: 'tap.mp3', nope: 'nope.mp3', pop: 'pop.mp3', done: 'house-done.mp3', fail: 'fail.mp3', win: 'win.mp3' }),
  ]);
  if (dead) return;
  const sfx = (name, o) => { if (play) play(name, o); else ctx.sound(name === 'done' ? 'full' : name === 'fail' ? 'lose' : name); };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  const rig = addRig(scene, { size: 16, floorY: -0.62, center: new THREE.Vector3(0, 0, -2) });
  const tweens = tweenList();
  // Shipped tint: palette with saturation capped at 0.75 (ColorConfig.GetTintColor).
  const tint = i => { const c = new THREE.Color(PALETTE[i] || '#ccc'), hsl = {}; c.getHSL(hsl); return new THREE.Color().setHSL(hsl.h, Math.min(hsl.s, 0.75), hsl.l); };

  // ---- Materials (pantry glazed surface ports) ----
  // Golden rather than lemon yellow, and +18% perceptual saturation on puzzle colours (PantryGlazedSurface).
  const GOLD = `vec3 pantryGold(vec3 b){ float y=clamp((b.r+b.g-b.b-1.)*2.,0.,1.); b=mix(b,vec3(b.r,b.g*.88,b.b*.65),y); return mix(b,vec3(b.r,b.g*.97,max(b.b,.025)),y); }\n`;
  const SAT = k => `{ float l=dot(outgoingLight,vec3(.2126,.7152,.0722)); outgoingLight=max(vec3(0.),mix(vec3(l),outgoingLight,${k})); }\n#include <opaque_fragment>`;
  const CLIPV = `varying vec3 vWp;\n`, CLIPF = `uniform vec4 uClip; varying vec3 vWp;\n`;
  const clipWorld = `vec4 wp4=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nwp4=instanceMatrix*wp4;\n#endif\nvWp=(modelMatrix*wp4).xyz;`;
  function cheeseMaterial(color) {
    const m = new THREE.MeshPhysicalMaterial({ color: color || 0xffffff, roughness: 0.4, clearcoat: 0.45, clearcoatRoughness: 0.3, normalMap: detail, normalMapType: THREE.ObjectSpaceNormalMap });
    m.userData.clip = { value: new THREE.Vector4(0, 1, 0, 1e4) };
    m.onBeforeCompile = s => {
      s.uniforms.uClip = m.userData.clip;
      s.vertexShader = CLIPV + s.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + clipWorld);
      s.fragmentShader = CLIPF + GOLD + s.fragmentShader
        .replace('#include <clipping_planes_fragment>', 'if(dot(vec4(vWp,1.),uClip)<0.) discard;\n#include <clipping_planes_fragment>')
        .replace('#include <color_fragment>', `#include <color_fragment>
          { vec4 cd=texture2D(normalMap,vNormalMapUv); vec3 t=mix(vec3(1.),vec3(.92,.72,.40),cd.a);
            vec3 b=diffuseColor.rgb; float pk=max(b.r,max(b.g,b.b)); if(pk-min(b.r,min(b.g,b.b))<.08) t=vec3(dot(t,vec3(.2126,.7152,.0722)));
            diffuseColor.rgb=pantryGold(b*t*1.06); }`)
        .replace('#include <opaque_fragment>', SAT('1.2'));
    };
    m.customProgramCacheKey = () => 'mice-cheese';
    return m;
  }
  const mouseMats = [];
  function mouseMaterial() {
    const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4 });
    const u = m.userData.u = { uMotion: { value: 0 }, uPhase: { value: 0 }, uCarry: { value: 0 }, uTint: { value: new THREE.Color() }, uClip: { value: new THREE.Vector4(0, 1, 0, 1e4) } };
    m.onBeforeCompile = s => {
      Object.assign(s.uniforms, u);
      // AnimateMouse from PantrySurface.shader: scurrying feet, forepaws lifted toward the food, tail sway, body bob.
      s.vertexShader = `attribute vec2 flags; uniform float uMotion,uPhase,uCarry; varying float vFur; ${CLIPV}
        vec3 animateMouse(vec3 p,vec2 f){ float gait=uPhase, foot=abs(f.y), cycle=gait+max(0.,-f.y)*3.14159;
          p.y+=max(0.,sin(cycle))*.48*uMotion*foot; p.z+=cos(cycle)*.34*uMotion*foot;
          float front=foot*step(0.,p.z); p.y+=front*uCarry*1.45; p.z+=front*uCarry*2.6;
          if(p.z< -3.8) p.x+=sin(gait*.5+p.z*.6)*.40*uMotion*clamp((-p.z-3.8)/3.,0.,1.);
          p.y+=sin(gait*2.)*.11*uMotion; return p; }\n` + s.vertexShader
        .replace('#include <begin_vertex>', 'vec3 transformed=animateMouse(vec3(position),flags); vFur=flags.x;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n' + clipWorld);
      s.fragmentShader = `uniform vec3 uTint; varying float vFur; ${CLIPF} ${GOLD}\n` + s.fragmentShader
        .replace('#include <clipping_planes_fragment>', 'if(dot(vec4(vWp,1.),uClip)<0.) discard;\n#include <clipping_planes_fragment>')
        .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb=mix(diffuseColor.rgb,pantryGold(diffuseColor.rgb*uTint),vFur);')
        .replace('#include <opaque_fragment>', SAT('1.15'));
    };
    m.customProgramCacheKey = () => 'mice-mouse';
    return m;
  }
  const trimMat = gloss('#ffffff', null, { vertexColors: true, roughness: 0.48, clearcoat: 0.35 });
  const nookMat = gloss('#f6e2c0', null, { roughness: 0.55, clearcoat: 0.25 }), honey = gloss('#e2b071', null, { roughness: 0.5, clearcoat: 0.3 });
  const padMat = gloss('#ffd2ad', null, { roughness: 0.55, clearcoat: 0.2 }), padRim = gloss('#fff1de', null, { roughness: 0.5, clearcoat: 0.3 });
  const wellMat = gloss('#a88a6e', null, { roughness: 0.75, clearcoat: 0 }), holeMat = new THREE.MeshBasicMaterial({ color: '#2a1a12' });
  const shared = new Set([trimMat, nookMat, honey, padMat, padRim, wellMat, holeMat]);
  const cheeseShared = cheeseMaterial(null); shared.add(cheeseShared);
  const carryMats = new Map(); // colour -> material for carried cheese (clip plane set per dive, so one per mouse)

  // Count label: digits drawn from the shipped label style atlas.
  function label(n) {
    const c = document.createElement('canvas'); c.width = 192; c.height = 128; const x = c.getContext('2d'), s = String(n), w = Math.min(96 * 0.8, 176 / s.length);
    s.split('').forEach((d, i) => x.drawImage(digits.image, +d * 96, 0, 96, 128, 96 - (s.length * w) / 2 + i * w - (96 - w) / 2, 0, 96, 128));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  let G, lvl = 0, root, auto = false, speed = 1, fast = false, gen = 0, acc = 0, ending = null, popAt = 0;
  let cheeseMeshes = [], blockSlot = new Map(), houses = new Map(), mice = new Map(), pads = [];
  const dummy = new THREE.Object3D();
  // CheeseLook.Pick: a stable hash of the cell picks plain (49%) or one of eight sculpts; dense sculpts under 6 units.
  function pick(x, y, cellU) {
    let h = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(0, 83492791)) >>> 0;
    h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0; h = (h ^ (h >>> 16)) >>> 0;
    if (h % 1000 >= 510) return 0;
    return 1 + Math.floor(h / 1000) % 8 + (cellU < 6 ? 8 : 0);
  }
  const cheeseGeo = i => i === 0 ? geo.smooth : i <= 8 ? geo.bites[i - 1] : geo.dense[i - 9];

  function build() {
    gen++; hov.clear(); acc = 0; ending = null;
    if (root) { root.traverse(o => { if (o.isMesh || o.isSprite) { if (o.material && !shared.has(o.material) && !o.material.userData.keep) { o.material.map?.dispose(); o.material.dispose(); } if (o.userData.ownGeo) o.geometry.dispose(); } }); scene.remove(root); }
    tweens.clear(); ctx.hideResult();
    G = new MiceGame(levels[lvl]); ctx.setLevel(`Level ${LEVELS[lvl]}`);
    root = new THREE.Group(); scene.add(root);
    const c = G.c, cellU = c / K, rim = G.rim;
    // Pantry worktop under the picture, rim path and tray: a cream board with honey edging and two burrow holes.
    const bx = G.burrowX + 1.3, z0 = rim.z0 - 0.7, z1 = SLOT_GAP * 0 + 2.6 + 1.5;
    const shape = new THREE.Shape(), rr = 1.1;
    shape.moveTo(-bx + rr, z0); shape.lineTo(bx - rr, z0); shape.quadraticCurveTo(bx, z0, bx, z0 + rr); shape.lineTo(bx, z1 - rr); shape.quadraticCurveTo(bx, z1, bx - rr, z1);
    shape.lineTo(-bx + rr, z1); shape.quadraticCurveTo(-bx, z1, -bx, z1 - rr); shape.lineTo(-bx, z0 + rr); shape.quadraticCurveTo(-bx, z0, -bx + rr, z0);
    for (const sx of [-1, 1]) { const hole = new THREE.Path(); hole.absellipse(sx * G.burrowX, G.burrowZ, 0.62, 0.44, 0, Math.PI * 2, true); shape.holes.push(hole); }
    const boardGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3, curveSegments: 24 });
    boardGeo.rotateX(Math.PI / 2); // shape y -> world z, extrusion goes down
    const board = new THREE.Mesh(boardGeo, nookMat); board.position.y = -0.1; board.userData.ownGeo = true; root.add(board);
    const edge = new THREE.Mesh(new RoundedBoxGeometry(bx * 2 + 0.1, 0.3, z1 - z0 + 0.1, 3, 0.15), honey); edge.position.set(0, -0.5, (z0 + z1) / 2); edge.userData.ownGeo = true; root.add(edge);
    // Burrows: the shipped recessed well, a dark floor deep inside.
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(geo.well, wellMat); w.scale.set(0.066, 0.1, 0.066); w.position.set(sx * G.burrowX, 0.0, G.burrowZ); w.userData.noShadowCast = true; root.add(w);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(1, 32), holeMat); hole.rotation.x = -Math.PI / 2; hole.scale.set(0.5, 0.36, 1); hole.position.set(sx * G.burrowX, -0.36, G.burrowZ); hole.userData.ownGeo = true; root.add(hole);
    }
    // Picture: one instanced mesh per shipped cheese mesh, coloured per cell.
    const groups = new Map();
    G.blocks.forEach(b => { const i = pick(b.x, b.y, cellU); if (!groups.has(i)) groups.set(i, []); groups.get(i).push(b); });
    cheeseMeshes = []; blockSlot = new Map();
    for (const [i, list] of groups) {
      const im = new THREE.InstancedMesh(cheeseGeo(i), cheeseShared, list.length);
      list.forEach((b, k) => { const [x, z] = G.cellPos(b.x, b.y); dummy.position.set(x, c * 0.5, z); dummy.scale.setScalar(c); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); im.setMatrixAt(k, dummy.matrix); im.setColorAt(k, tint(b.color)); blockSlot.set(b, [im, k, i]); });
      im.castShadow = im.receiveShadow = true; root.add(im); cheeseMeshes.push(im);
    }
    // Tray saucers.
    pads = [];
    for (let s = 0; s < TRAY; s++) {
      const [x, z] = G.slotPos(s), g = new THREE.Group(); g.position.set(x, 0, z);
      const r1 = new THREE.Mesh(new RoundedBoxGeometry(1.86, 0.12, 1.86, 2, 0.3), padRim); r1.position.y = 0.0; r1.userData.ownGeo = true;
      const r2 = new THREE.Mesh(new RoundedBoxGeometry(1.62, 0.1, 1.62, 2, 0.26), padMat.clone()); r2.position.y = 0.04; r2.userData.ownGeo = true;
      g.add(r1, r2); root.add(g); pads.push(r2);
    }
    // House nook: a cream drawer with honey lining and a pocket per cell.
    const [hx0] = G.housePos(0, 0), [, hz0] = G.housePos(0, 0), nw = G.cols * HOUSE_DX + 0.7, nd = G.rows * HOUSE_DZ + 0.7;
    const nook = new THREE.Mesh(new RoundedBoxGeometry(nw, 0.36, nd, 3, 0.3), nookMat); nook.position.set(0, -0.28, hz0 - HOUSE_DZ / 2 + nd / 2 - 0.35); nook.userData.ownGeo = true; root.add(nook);
    const lip = new THREE.Mesh(new RoundedBoxGeometry(nw + 0.3, 0.3, nd + 0.3, 3, 0.3), honey); lip.position.set(0, -0.4, nook.position.z); lip.userData.ownGeo = true; root.add(lip);
    for (let r = 0; r < G.rows; r++) for (let cc = 0; cc < G.cols; cc++) { const [x, z] = G.housePos(r, cc), p = new THREE.Mesh(new RoundedBoxGeometry(HOUSE_DX - 0.2, 0.06, HOUSE_DZ - 0.2, 2, 0.22), padMat); p.position.set(x, -0.08, z); p.userData.ownGeo = true; root.add(p); }
    void hx0;
    houses = new Map();
    for (const hs of G.houses) houses.set(hs, makeHouse(hs));
    mice = new Map();
    castShadows(root); board.receiveShadow = true;
    refreshHouses(true); fit();
  }

  // ---- Houses: foundation + roof in the house colour, the porcelain/wood/doorway trim, a count label ----
  function makeHouse(hs) {
    const g = new THREE.Group(), [x, z] = G.housePos(hs.row, hs.col); g.position.set(x, 0, z);
    const body = new THREE.Group(); body.scale.setScalar(K); body.rotation.y = Math.PI; g.add(body); // door toward the camera
    const rigG = new THREE.Group(); body.add(rigG);
    const col = hs.wall ? new THREE.Color('#c9b9a6') : tint(hs.color), mat = gloss(col.clone(), null, { roughness: 0.42, clearcoat: 0.6 });
    const foundation = new THREE.Mesh(geo.hBase, mat); foundation.position.y = 4.1; foundation.scale.set(16.3, 7.3, 13.6);
    const roof = new THREE.Mesh(geo.hRoof, mat); roof.position.y = 10.5; roof.scale.set(18, 6.1, 15.5);
    rigG.add(foundation, roof);
    if (!hs.wall) rigG.add(new THREE.Mesh(geo.hTrim, trimMat));
    let sp = null;
    if (!hs.wall) { sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(hs.value), depthTest: false })); sp.scale.set(15, 10, 1); sp.position.set(0, 17.6, -2.1); sp.renderOrder = 5; rigG.add(sp); }
    const hit = new THREE.Mesh(new THREE.BoxGeometry(HOUSE_DX, 1.6, HOUSE_DZ), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.8; hit.userData.house = hs; hit.userData.ownGeo = true; hit.userData.noShadowCast = true; g.add(hit);
    g.userData = { hs, body, rig: rigG, roof, sp, mat, col, hit, value: hs.value, landing: 0, puff: 0, ready: 0, dormant: hs.wall ? 0 : 1, flying: false, flight: 0, empty: false, emptyT: 0, prevMov: null, from: null, to: null, wob: 0 };
    root.add(g); return g;
  }
  function refreshHouses(first) {
    for (const [hs, g] of houses) {
      const u = g.userData, mov = G.movable(hs);
      if (u.prevMov !== null && mov !== u.prevMov && !first) u.ready = 1;
      u.prevMov = mov;
    }
  }
  function setLabel(g, n) { const sp = g.userData.sp; if (!sp) return; sp.material.map.dispose(); sp.material.map = label(n); sp.material.needsUpdate = true; }

  // A 30-degree lens from 60 degrees up, fitted to the worktop and the house nook.
  function fit() {
    const aspect = (ctx.el.clientWidth || 1) / (ctx.el.clientHeight || 1), rim = G.rim, bx = G.burrowX + 1.3;
    const [, hzLast] = G.housePos(G.rows - 1, 0), nw = G.cols * HOUSE_DX / 2 + 0.4;
    const pts = [new THREE.Vector3(-bx, 0, rim.z0 - 0.7), new THREE.Vector3(bx, 0, rim.z0 - 0.7), new THREE.Vector3(-bx, 0, 4.1), new THREE.Vector3(bx, 0, 4.1),
      new THREE.Vector3(-nw, 0, hzLast + HOUSE_DZ / 2 + 0.4), new THREE.Vector3(nw, 0, hzLast + HOUSE_DZ / 2 + 0.4), new THREE.Vector3(0, 2.0, G.housePos(0, 0)[1])];
    fitPerspective(camera, pts, aspect, { dir: new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH)), top: 0.19, bottom: 0.05, side: 0.03 });
  }

  // ---- Input ----
  const ray = new THREE.Raycaster();
  const hitAt = e => { const r = ctx.el.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera); return ray.intersectObjects([...houses.values()].map(g => g.userData.hit)); };
  function onPointer(e) {
    if (auto || !G || G.over) return;
    const hits = hitAt(e), p = hits.find(h => G.movable(h.object.userData.house)) || hits[0]; // a tilted view can graze the house in front too
    if (p) tap(p.object.userData.house);
  }
  const hov = hoverSprings(), leave = () => hov.set(null);
  function onHover(e) { if (auto || !G || G.over) return hov.set(null); const p = hitAt(e).find(h => G.movable(h.object.userData.house)); hov.set(p ? houses.get(p.object.userData.house).userData.body : null); }
  ctx.el.addEventListener('pointerdown', onPointer); ctx.el.addEventListener('pointermove', onHover); ctx.el.addEventListener('pointerleave', leave);
  function tap(hs) {
    const before = G.events.length, r = G.tap(hs);
    if (!r.ok) { sfx('nope', { volume: 0.6 }); const g = houses.get(hs); if (g) g.userData.wob = 1; return r; }
    handle(G.events.splice(before)); return r;
  }

  // ---- Events from the rules ----
  function handle(events) {
    for (const e of events) {
      if (e.type === 'park') {
        const g = houses.get(e.house), u = g.userData; sfx('tap', { volume: 0.7 });
        u.flying = true; u.flight = 0; u.from = g.position.clone(); const [x, z] = G.slotPos(e.slot); u.to = new THREE.Vector3(x, 0.08, z); hov.set(null);
        refreshHouses();
      }
      if (e.type === 'spawn') {
        const g = houses.get(e.mouse.house); g.userData.puff = 1; setLabel(g, e.mouse.house.value);
        mice.set(e.mouse, makeMouse(e.mouse));
      }
      if (e.type === 'arrive') liftCheese(e.mouse);
      if (e.type === 'pick') refreshHouses();
      if (e.type === 'home') { const vm = mice.get(e.mouse); if (vm) { vm.dive = 0; vm.diveFrom = vm.g.position.clone(); } }
      if (e.type === 'empty') { refreshHouses(); const g = houses.get(e.house); g.userData.empty = true; g.userData.emptyT = 0; setTimeout(() => { if (!dead) sfx('done', { volume: 0.55 }); }, 150); }
    }
  }

  // ---- Mice ----
  function makeMouse(m) {
    const g = new THREE.Group(), pose = new THREE.Group(); g.scale.setScalar(K); g.add(pose);
    const mat = mouseMaterial(); mat.userData.u.uTint.value.copy(tint(m.house.color));
    const body = new THREE.Mesh(geo.mouse, mat); body.scale.setScalar(1.496); body.position.y = 0.35; body.castShadow = true; pose.add(body);
    const p = G.mouseAt(m, 0); g.position.set(p.p[0], 0.008, p.p[1]); g.rotation.y = 0;
    root.add(g);
    return { m, g, pose, body, mat, motion: 0, stride: Math.random() * 16, carry: 0, pulse: 0, food: null, heading: 0, last: g.position.clone(), off: new THREE.Vector2(), dive: -1 };
  }
  function liftCheese(m) {
    const vm = mice.get(m), slot = blockSlot.get(m.block); if (!slot) return;
    const [im, k, gi] = slot; vm?.g.updateMatrixWorld(true); dummy.position.set(0, -50, 0); dummy.scale.setScalar(1e-4); dummy.updateMatrix(); im.setMatrixAt(k, dummy.matrix); im.instanceMatrix.needsUpdate = true;
    if (!vm) return;
    const mat = cheeseMaterial(tint(m.block.color)); const food = new THREE.Mesh(cheeseGeo(gi), mat); food.castShadow = true;
    // From the cell into the carry anchor in front of the face, in the mouse's own frame (Ant pickup tween).
    const cellU = G.c / K, half = 0.795 * cellU * 0.58, to = new THREE.Vector3(-0.7, Math.max(3.2, half + 0.8), 6.2 + half);
    const [bx, bz] = G.cellPos(m.block.x, m.block.y), from = vm.pose.worldToLocal(new THREE.Vector3(bx, G.c * 0.5, bz));
    food.scale.setScalar(cellU); food.position.copy(from); vm.pose.add(food); vm.food = food; vm.pulse = 1;
    const zr = (m.block.x % 2 === 0 ? -1 : 1) * 5 * Math.PI / 180;
    tweens.add(PICKUP + PICKUP_DELAY, k => { const t = easeOutCubic(Math.max(0, (k * (PICKUP + PICKUP_DELAY) - PICKUP_DELAY) / PICKUP)); food.position.lerpVectors(from, to, t); food.rotation.set(-8 * Math.PI / 180 * t, 0, zr * t); }, x => x);
    const now = performance.now(); if (now - popAt > 120) { popAt = now; sfx('pop', { rate: 0.9 + Math.random() * 0.35, volume: 0.32 }); }
  }
  function updateMice(dt) {
    const list = [...mice.values()], pad = G.c * 0.5, hw = G.w * G.c / 2, ph = G.h * G.c;
    // Desired positions from the rules' routes; separate bodies that are off the picture (MouseTraffic).
    for (const vm of list) {
      if (vm.dive >= 0) continue;
      const t = G.time - vm.m.t0, s = G.mouseAt(vm.m, t); vm.want = s; vm.desired = new THREE.Vector2(s.p[0], s.p[1]);
      vm.onBoard = s.p[0] > -hw - pad && s.p[0] < hw + pad && s.p[1] > -ph - pad && s.p[1] < pad; // in the picture's one-cell lanes nobody yields
      vm.emerging = s.phase === 'out' && t * 2.6 < 0.73;
      vm.p = vm.desired.clone().add(vm.off);
    }
    const live = list.filter(v => v.dive < 0);
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i], b = live[j]; if (a.onBoard || b.onBoard || a.emerging || b.emerging) continue;
      const d = a.p.clone().sub(b.p), l = d.length(), need = 0.9; if (l >= need || l < 1e-5) continue;
      d.multiplyScalar((need - l) / l / 2); a.p.add(d); b.p.sub(d);
    }
    for (const vm of list) {
      const { g, mat } = vm, u = mat.userData.u;
      if (vm.dive >= 0) { // the burrow dive: arc in, nose down, shrink, clipped at the rim
        vm.dive += dt * 1; const t = Math.min(1, vm.dive / DIVE), travel = smooth(0, 1, t / 0.65), hole = new THREE.Vector3(vm.m.side * G.burrowX, -0.9, G.burrowZ);
        g.position.lerpVectors(vm.diveFrom, hole, travel); g.position.y += Math.sin(t * Math.PI) * 0.5;
        vm.pose.rotation.x = 55 * Math.PI / 180 * t; g.scale.setScalar(K * (1 - 0.58 * smooth(0, 1, t)));
        u.uClip.value.set(0, 1, 0, 0.005); if (vm.food) vm.food.material.userData.clip.value.set(0, 1, 0, 0.005);
        u.uMotion.value = 1; vm.stride += dt * 9; u.uPhase.value = vm.stride;
        if (t >= 1) { root.remove(g); vm.food?.material.dispose(); mat.dispose(); mice.delete(vm.m); }
        continue;
      }
      const drift = vm.p.clone().sub(vm.desired); if (drift.length() > 0.46) drift.setLength(0.46);
      const step = drift.clone().sub(vm.off), lim = 2.4 * dt; if (step.length() > lim) step.setLength(lim); vm.off.add(step);
      const pos = vm.desired.clone().add(vm.off), prev = vm.last, dx = pos.x - prev.x, dz = pos.y - prev.z, dist = Math.hypot(dx, dz);
      g.position.set(pos.x, 0.008, pos.y);
      // Heading turns toward the visible motion at 540 deg/s x multiplier; while waiting it faces its cheese.
      const want = vm.want.phase === 'wait' ? Math.atan2(vm.want.dir[0], vm.want.dir[1]) : dist > 1e-4 ? Math.atan2(dx, dz) : vm.heading;
      let dh = want - vm.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); const mx = 540 * MULT * Math.PI / 180 * dt;
      vm.heading += Math.max(-mx, Math.min(mx, dh)); if (vm.want.phase === 'out' && G.time - vm.m.t0 < 0.02) vm.heading = want;
      g.rotation.y = vm.heading;
      const speedU = dist / Math.max(dt, 1e-4) / K;
      vm.motion = toward(vm.motion, Math.min(1, speedU * 0.12), dt * 8); vm.stride += dist / K * 1.4;
      vm.carry = toward(vm.carry, vm.food ? 1 : 0, dt * 6); vm.pulse = toward(vm.pulse, 0, dt * 3.2);
      const comp = Math.sin(vm.pulse * Math.PI);
      // Emerging through the doorway: clipped at the door plane, growing from 65% as it clears it.
      let ps = 1;
      if (vm.emerging) { const t = G.time - vm.m.t0; ps = 0.65 + 0.35 * smooth(0, 1, t * 2.6 / 0.73); u.uClip.value.set(0, 0, 1, -vm.m.door[1]); }
      else u.uClip.value.set(0, 1, 0, 1e4);
      vm.pose.scale.set((1 + comp * 0.045) * ps, (1 - comp * 0.09) * ps, (1 + comp * 0.025) * ps);
      u.uMotion.value = vm.motion; u.uPhase.value = vm.stride; u.uCarry.value = vm.carry;
      vm.last = g.position.clone();
    }
  }

  // ---- Houses (HousePresentation) ----
  function updateHouses(dt) {
    const d = dt * MULT;
    for (const [hs, g] of houses) {
      const u = g.userData, rigG = u.rig;
      u.landing = toward(u.landing, 0, d * 2.4); u.puff = toward(u.puff, 0, d * 3.2); u.ready = toward(u.ready, 0, d * 2.1); u.wob = toward(u.wob, 0, dt * 2.5); u.alarm = toward(u.alarm || 0, 0, dt / 1.2);
      let sx = 1, sy = 1, sz = 1, py = 0, ax = 0, ay = 0, az = 0;
      if (u.flying) {
        u.flight += dt; const t = Math.min(1, u.flight / JUMP), launch = Math.sin(Math.min(1, t / 0.26) * Math.PI), stretch = Math.sin(t * Math.PI);
        g.position.lerpVectors(u.from, u.to, t); g.position.y = u.from.y + Math.sin(t * Math.PI) * 30 * K; // BoxArcHeight
        sx = 1 - launch * 0.16; sy = 1 + launch * 0.24; sz = 1 - launch * 0.13; ax = -stretch * 13; ay = Math.sin(t * Math.PI * 2) * 9; az = Math.sin(t * Math.PI * 2) * 12;
        if (t >= 1) { u.flying = false; u.landing = 1; g.position.copy(u.to); }
      }
      const land = Math.sin(u.landing * Math.PI * 2) * u.landing, puff = Math.sin(u.puff * Math.PI), ready = Math.sin(u.ready * Math.PI * 2) * u.ready;
      u.dormant = toward(u.dormant, hs.wall || G.movable(hs) || hs.slot >= 0 ? 0 : 1, d * 3);
      const settle = smooth(0, 1, u.dormant);
      sx *= (1 + land * 0.14 + puff * 0.045) * (1 - settle * 0.05); sy *= (1 - land * 0.21 - puff * 0.065) * (1 - settle * 0.09); sz *= (1 + land * 0.11 + puff * 0.04) * (1 - settle * 0.05);
      py += Math.max(0, -land) * 1.4 + Math.max(0, ready) * 1.2; az += ready * 5 + Math.sin(u.wob * Math.PI * 6) * 8 * u.wob + Math.sin(u.alarm * Math.PI * 9) * 14 * u.alarm; py += Math.abs(Math.sin(u.alarm * Math.PI * 3)) * 2.2 * u.alarm;
      let vis = 1;
      if (u.empty) {
        u.emptyT += d; const t = Math.min(1, u.emptyT / 0.6), vanish = smooth(0.32, 0.9, t), pop = 1 + Math.sin(t * Math.PI) * 0.16;
        vis = pop * (1 - vanish); py += Math.sin(t * Math.PI) * 3.3; az += Math.sin(t * Math.PI) * 13;
        if (t >= 1 && g.parent) { root.remove(g); houses.delete(hs); u.mat.dispose(); u.sp?.material.map.dispose(); u.sp?.material.dispose(); continue; }
      }
      rigG.scale.set(sx * vis, sy * vis, sz * vis); rigG.position.y = py; rigG.rotation.set(ax * Math.PI / 180, ay * Math.PI / 180, az * Math.PI / 180);
      u.roof.position.y = 10.5 + puff * 1.2; u.roof.scale.set(18 * (1 + puff * 0.055), 6.1 * (1 - puff * 0.11), 15.5 * (1 + puff * 0.055));
      // A sleeping house drains toward a quieter colour and hides its number (glazed shader _Fade).
      if (!hs.wall) {
        const luma = u.col.r * 0.2126 + u.col.g * 0.7152 + u.col.b * 0.0722, quiet = u.col.clone().lerp(new THREE.Color(luma, luma, luma), 0.28).multiplyScalar(0.8);
        u.mat.color.copy(u.col).lerp(quiet, settle); if (u.alarm) u.mat.color.lerp(new THREE.Color('#ff3b30'), 0.45 * Math.sin(u.alarm * Math.PI * 0.5));
        if (u.sp) { u.sp.position.y = 17.6 + puff * 1.8 + Math.max(0, land) * 0.9; u.sp.material.rotation = puff * 7 * Math.PI / 180; const s = 1 - settle; u.sp.scale.set(15 * s, 10 * s, 1); u.sp.visible = s > 0.02; }
      }
    }
  }

  function update(dt) {
    hov.update(dt);
    if (!G) return;
    const k = speed * (fast ? 2 : 1), h = 1 / 60;
    acc = Math.min(acc + dt * k, 0.5 * Math.max(1, k));
    while (acc >= h) { acc -= h; if (G.over) break; if (auto) G.autoTap(); G.step(h); handle(G.events.splice(0)); }
    const pdt = dt * k;
    updateMice(pdt); updateHouses(pdt); tweens.update(pdt);
    if (G.over && !ending) end();
    if (ending && ending.left > 0 && (ending.left -= pdt) <= 0) finish(ending.res);
  }
  // Level over: a pop for the win, a juicy fail (shake, tray flash, houses wobble), then the card.
  // Level over: a pop for the win; a juicy fail: screen shake, the tray saucers flash red, the parked houses blush and
  // wobble. The card follows on the presentation clock (so the 2x button and test speed carry it too).
  function end() {
    const res = G.result; ending = { res, left: res === 'win' ? 0.9 : 1.4 };
    if (res === 'win') sfx('win', { volume: 0.6 });
    else {
      sfx('fail', { volume: 0.7 }); ctx.shake(1.6);
      for (const p of pads) { const c0 = p.material.color.clone(); tweens.add(1.2, k => p.material.color.copy(c0).lerp(new THREE.Color('#ff4a3d'), (0.5 + 0.5 * Math.cos(k * Math.PI * 6)) * (1 - k) * 0.85), x => x, () => p.material.color.copy(c0)); }
      for (const g of houses.values()) if (g.userData.hs.slot >= 0) g.userData.alarm = 1;
    }
  }
  function finish(res) {
    if (dead) return;
    if (auto) { lvl = res === 'win' ? (lvl + 1) % LEVELS.length : lvl; build(); return; }
    if (res === 'win') {
      const last = lvl === LEVELS.length - 1;
      ctx.result({ win: true, last, title: last ? 'All clear!' : 'Level complete', sub: last ? 'Three shipped levels. 47 more in the store, all built solo.' : `Mice Flow · level ${LEVELS[lvl]}`, next: () => { lvl = (lvl + 1) % LEVELS.length; build(); }, retry: () => build() });
    } else ctx.result({ win: false, title: 'Out of space', sub: 'The tray filled with houses whose colours were still buried.', next: () => build() });
  }

  const speedBtn = document.createElement('button'); speedBtn.type = 'button'; speedBtn.className = 'arcade-speed'; speedBtn.textContent = '2×'; speedBtn.setAttribute('aria-pressed', 'false'); ctx.ui.append(speedBtn);
  const setFast = on => { fast = on; speedBtn.classList.toggle('on', on); speedBtn.setAttribute('aria-pressed', String(on)); };
  speedBtn.addEventListener('click', () => setFast(!fast));
  build();
  return {
    scene, camera, update, resize: () => G && fit(),
    autoplay(on) { auto = on; },
    takeover() { auto = false; if (G.over) { lvl = (lvl + 1) % LEVELS.length; build(); } },
    reloadLevel() { build(); },
    restart() { auto = false; speed = 1; setFast(false); lvl = 0; build(); },
    test: {
      set speed(v) { speed = v; },
      get state() { return { total: LEVELS.length, level: lvl + 1, over: G.over, result: G.result, progress: G.blocks.filter(b => b.gone).length / G.blocks.length, onBelt: G.parked().length + G.mice.length, auto, mice: mice.size, time: G.time }; },
      get game() { return G; },
      get info() { const r = ctx.renderer.info.render; return { calls: r.calls, triangles: r.triangles }; },
      tapHouse(hs) { return tap(hs); },
      goto(n, bot = false) { auto = bot; lvl = Math.max(0, Math.min(LEVELS.length - 1, n - 1)); build(); },
      reset() { auto = false; speed = 1; setFast(false); lvl = 0; build(); },
      nextMove() {
        if (G.over) return null;
        const h = G.botChoice(); if (!h || G.time - G.lastTap < 0.4) return null;
        const g = houses.get(h); if (!g) return null;
        const v = g.position.clone().setY(0.7).project(camera), r = ctx.el.getBoundingClientRect();
        return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
      },
    },
    destroy() { dead = true; ctx.el.removeEventListener('pointerdown', onPointer); ctx.el.removeEventListener('pointermove', onHover); ctx.el.removeEventListener('pointerleave', leave); speedBtn.remove(); disposeScene(scene); void rig; },
  };
}
