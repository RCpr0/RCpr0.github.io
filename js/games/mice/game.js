// Mice Flow renderer. The shipped art is procedural (built in code with Claude and Codex), so it is rebuilt the same
// way here: rounded colour blocks for the picture, numbered houses, a five-slot tray and mice in their house's colour.
// Colours are the shipped ColorConfig palette with its 0.75 saturation cap. Rules live in core.js.
import { RoundedBoxGeometry } from '../../vendor/RoundedBoxGeometry.js';
import { MiceGame, TRAY, PICKUP } from './core.js';
import { toonRamp, tweenList, easeOutBack, easeInOut, disposeScene } from '../common.js';

const LEVELS = [1, 2, 3];
const PALETTE = ['#EB3B3B', '#458CF2', '#22B14C', '#FFF200', '#6F3198', '#FF7E00', '#FFA3B1', '#2EBFB8', '#9C5A3C', '#A6A6A6', '#FFFFFF', '#000000', '#FFF9BD', '#00B7EF', '#69D8FA', '#2F3699', '#990030', '#FF61DF', '#ED7EED', '#FFC20E', '#FFF459'];
const PW = 9.6, PITCH = 56 * Math.PI / 180, SLOT_GAP = 1.9, HCELL = 1.75;

export async function create(ctx) {
  let dead = false;
  const { THREE } = ctx;
  const levels = await Promise.all(LEVELS.map(n => fetch(`${ctx.base}level${n}.json`).then(r => r.json())));
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#f6e7cf');
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  scene.add(new THREE.HemisphereLight('#ffffff', '#d9b98f', 2.0));
  const sun = new THREE.DirectionalLight('#fff3df', 1.3); sun.position.set(-4, 10, 5); scene.add(sun);
  const ramp = toonRamp(), tweens = tweenList();
  const toon = c => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp });
  // Shipped tint: saturation capped at 0.75.
  const tint = i => { const c = new THREE.Color(PALETTE[i] || '#ccc'), hsl = {}; c.getHSL(hsl); return new THREE.Color().setHSL(hsl.h, Math.min(hsl.s, 0.75), hsl.l); };

  let G, lvl = 0, root, blockMesh, cp, houses, mice, auto = false, speed = 1, endTimer = 0, speedBtn, fast = false;
  const dummy = new THREE.Object3D();

  // A mouse: body, head, ears, tail and a nose, in its house's colour (built once per colour, cloned per mouse).
  const mouseCache = new Map();
  function mouseFor(color) {
    if (!mouseCache.has(color)) {
      const g = new THREE.Group(), fur = toon(tint(color).lerp(new THREE.Color('#ffffff'), 0.15)), pink = toon('#ffb3c1'), dark = toon('#3a2a2a');
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), fur); body.scale.set(1, 0.85, 1.25); body.position.y = 0.26; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), fur); head.position.set(0, 0.42, 0.3); g.add(head);
      for (const s of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), pink); ear.scale.set(1, 1, 0.35); ear.position.set(s * 0.14, 0.6, 0.26); g.add(ear);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), dark); eye.position.set(s * 0.08, 0.47, 0.47); g.add(eye);
      }
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), pink); nose.position.set(0, 0.41, 0.5); g.add(nose);
      const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.2, -0.3), new THREE.Vector3(0.1, 0.25, -0.55), new THREE.Vector3(-0.05, 0.4, -0.7)]), 10, 0.03, 5), pink); g.add(tail);
      mouseCache.set(color, g);
    }
    const m = mouseCache.get(color).clone(); m.scale.setScalar(1.25); return m;
  }
  const label = (n, faded) => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
    x.font = '700 70px "Russo One", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 12; x.strokeStyle = '#3b2a1a'; x.fillStyle = '#fff';
    x.strokeText(String(n), 64, 68); x.fillText(String(n), 64, 68);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };

  function build() {
    if (root) scene.remove(root);
    tweens.clear(); endTimer = 0; ctx.hideResult();
    G = new MiceGame(levels[lvl]); ctx.setLevel(`Level ${LEVELS[lvl]}`);
    root = new THREE.Group(); scene.add(root);
    const { w, h } = G; cp = PW / Math.max(w, h * 0.85);
    // Picture board and its dotted frame.
    const frame = new THREE.Mesh(new RoundedBoxGeometry(w * cp + 0.8, 0.12, h * cp + 0.8, 2, 0.3), toon('#f1d9b4')); frame.position.copy(picPos(w / 2 - 0.5, h / 2 - 0.5)).setY(-0.1); root.add(frame);
    const geo = new RoundedBoxGeometry(cp * 0.9, cp * 0.7, cp * 0.9, 2, cp * 0.16);
    blockMesh = new THREE.InstancedMesh(geo, toon('#ffffff'), G.blocks.length);
    G.blocks.forEach((b, i) => { dummy.position.copy(picPos(b.x, b.y)).setY(cp * 0.35); dummy.scale.setScalar(1); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); blockMesh.setMatrixAt(i, dummy.matrix); blockMesh.setColorAt(i, tint(b.color)); });
    root.add(blockMesh);
    // Tray: five pads.
    for (let s = 0; s < TRAY; s++) { const pad = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.14, 1.5, 2, 0.25), toon('#f7c99a')); pad.position.copy(slotPos(s)).setY(-0.05); root.add(pad); }
    // House grid.
    const gw = G.cols * HCELL, gz0 = gridTop();
    const base = new THREE.Mesh(new RoundedBoxGeometry(gw + 0.5, 0.2, G.rows * HCELL + 0.5, 2, 0.3), toon('#eed2ad')); base.position.set(0, -0.15, gz0 + G.rows * HCELL / 2 - HCELL / 2); root.add(base);
    for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) { const pad = new THREE.Mesh(new RoundedBoxGeometry(HCELL - 0.12, 0.08, HCELL - 0.12, 2, 0.2), toon('#f8e6cb')); pad.position.copy(housePos(r, c)).setY(-0.02); root.add(pad); }
    houses = new Map();
    for (const hs of G.houses) {
      const g = new THREE.Group(), color = hs.wall ? '#b9ab9a' : tint(hs.color);
      const box = new THREE.Mesh(new RoundedBoxGeometry(HCELL - 0.3, hs.wall ? 0.7 : 1.0, HCELL - 0.3, 3, 0.22), toon(color)); box.position.y = hs.wall ? 0.35 : 0.5; g.add(box);
      if (!hs.wall) {
        const roof = new THREE.Mesh(new THREE.ConeGeometry(0.95, 0.5, 4), toon(new THREE.Color(color).multiplyScalar(0.8))); roof.rotation.y = Math.PI / 4; roof.position.y = 1.25; g.add(roof);
        const door = new THREE.Mesh(new THREE.CircleGeometry(0.22, 16, 0, Math.PI), toon('#4a3020')); door.position.set(0, 0.02 + 0.01, 0.73); g.add(door);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(hs.value), depthTest: false })); sp.scale.set(1.1, 1.1, 1); sp.position.y = 1.9; sp.renderOrder = 5; g.add(sp); g.userData.label = sp;
      }
      g.position.copy(housePos(hs.row, hs.col)); g.userData = { ...g.userData, box, hs, value: hs.value };
      const hit = new THREE.Mesh(new THREE.BoxGeometry(HCELL, 1.1, HCELL), new THREE.MeshBasicMaterial({ visible: false })); hit.position.y = 0.55; hit.userData.house = hs; g.add(hit);
      root.add(g); houses.set(hs, g);
    }
    mice = new Map();
    refreshHouses(); fit();
  }
  const picPos = (x, y) => new THREE.Vector3((x + 0.5 - G.w / 2) * cp, 0, -((y + 0.5) * cp) - 1.2);
  const slotPos = s => new THREE.Vector3((s - (TRAY - 1) / 2) * SLOT_GAP, 0, 0.9);
  const gridTop = () => 2.9;
  const housePos = (r, c) => new THREE.Vector3((c - (G.cols - 1) / 2) * HCELL, 0, gridTop() + r * HCELL);

  // Blocked houses are washed out with their number hidden, as in the shipped game.
  function refreshHouses() {
    for (const [hs, g] of houses) {
      if (hs.wall || hs.slot >= 0 || hs.done) continue;
      const on = G.movable(hs), m = g.userData.box.material; m.color.copy(tint(hs.color)); if (!on) m.color.lerp(new THREE.Color('#f8e6cb'), 0.55);
      if (g.userData.label) g.userData.label.visible = on;
    }
  }
  function setLabel(g, n) { const sp = g.userData.label; if (!sp) return; sp.material.map.dispose(); sp.material.map = label(n); sp.material.needsUpdate = true; tweens.add(0.2, k => sp.scale.setScalar(1.1 * (1 + 0.3 * Math.sin(k * Math.PI)))); }

  function fit() {
    const wpx = ctx.renderer.domElement.clientWidth || ctx.w, hpx = ctx.renderer.domElement.clientHeight || ctx.h, aspect = wpx / hpx;
    camera.position.set(0, Math.sin(PITCH), Math.cos(PITCH)).multiplyScalar(40); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const top = -(G.h * cp) - 1.6, bottom = gridTop() + G.rows * HCELL, half = Math.max(G.w * cp / 2 + 0.6, G.cols * HCELL / 2 + 0.4, (TRAY / 2) * SLOT_GAP);
    const pts = [new THREE.Vector3(-half, 0, top), new THREE.Vector3(half, 0, top), new THREE.Vector3(-half, 0, bottom), new THREE.Vector3(half, 2, bottom)];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { const v = p.applyMatrix4(camera.matrixWorldInverse); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    y1 += 1.6; y0 -= 2.4;
    let hh = (y1 - y0) / 2, hw = (x1 - x0) / 2; if (hw / hh > aspect) hh = hw / aspect; else hw = hh * aspect;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    Object.assign(camera, { left: cx - hw, right: cx + hw, top: cy + hh, bottom: cy - hh }); camera.updateProjectionMatrix();
  }

  const ray = new THREE.Raycaster();
  function onPointer(e) {
    if (auto || G.over) return;
    const r = ctx.canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hits = ray.intersectObjects([...houses.values()].map(g => g.children.at(-1)));
    // Tilted camera: a tap can graze the house in front too. Prefer the one that can actually move.
    const pick = hits.find(h => G.movable(h.object.userData.house)) || hits[0];
    if (pick) tap(pick.object.userData.house);
  }
  ctx.canvas.addEventListener('pointerdown', onPointer);
  function tap(hs) {
    const before = G.events.length, r = G.tap(hs);
    if (!r.ok) { ctx.sound('nope'); const g = houses.get(hs), x = g.position.x; tweens.add(0.3, k => { g.position.x = x + Math.sin(k * Math.PI * 4) * 0.08 * (1 - k); }); return r; }
    handle(G.events.splice(before)); return r;
  }
  function handle(events) {
    for (const e of events) {
      if (e.type === 'park') {
        const g = houses.get(e.house), from = g.position.clone(), to = slotPos(e.slot); ctx.sound('tap');
        tweens.add(0.3, k => { g.position.lerpVectors(from, to, k); g.position.y = Math.sin(k * Math.PI) * 1.4; g.scale.set(1 + 0.12 * Math.sin(k * Math.PI), 1 - 0.1 * Math.sin(k * Math.PI), 1); }, easeInOut,
          () => tweens.add(0.18, k => g.scale.set(1 + 0.15 * (1 - k), 1 - 0.2 * (1 - k), 1 + 0.15 * (1 - k)), easeOutBack));
        refreshHouses();
      }
      if (e.type === 'spawn') { const m = mouseFor(e.mouse.house.color); root.add(m); mice.set(e.mouse, m); setLabel(houses.get(e.mouse.house), e.mouse.house.value); }
      if (e.type === 'pick') {
        const b = e.mouse.block, i = G.blocks.indexOf(b); dummy.position.set(0, -50, 0); dummy.scale.setScalar(0.0001); dummy.updateMatrix(); blockMesh.setMatrixAt(i, dummy.matrix); blockMesh.instanceMatrix.needsUpdate = true;
        const m = mice.get(e.mouse); if (m) { const carry = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.26, 0.34, 1, 0.06), toon(tint(b.color))); carry.position.set(0, 0.85, 0.05); m.add(carry); }
        if (Math.random() < 0.25) ctx.sound('drop');
      }
      if (e.type === 'home') { const m = mice.get(e.mouse); if (m) { root.remove(m); mice.delete(e.mouse); } }
      if (e.type === 'empty') {
        const g = houses.get(e.house); ctx.sound('full'); const y0 = g.position.y;
        setTimeout(() => tweens.add(0.5, k => { g.position.y = y0 + k * 1.2; g.scale.setScalar(k < 0.5 ? 1 + k : Math.max(0.001, 1.5 * (1 - (k - 0.5) * 2))); }, x => x, () => { root.remove(g); refreshHouses(); }), 300);
      }
    }
  }

  function update(dt) {
    if (!G) return;
    const k = speed * (fast ? 2 : 1); let n = Math.max(1, Math.round(dt * 60 * k));
    for (let i = 0; i < n && !G.over; i++) { if (auto) G.autoTap(); G.step(1 / 60); handle(G.events.splice(0)); }
    // Mice walk out, pause to pick up, walk home with their block; a little waddle.
    for (const [mo, m] of mice) {
      const t = G.time - mo.t0, from = slotPos(mo.house.slot >= 0 ? mo.house.slot : 0), blockP = picPos(mo.block.x, mo.block.y);
      let p;
      if (t < mo.out) p = from.clone().lerp(blockP, t / mo.out);
      else if (t < mo.out + PICKUP) p = blockP.clone();
      else p = blockP.clone().lerp(from, Math.min(1, (t - mo.out - PICKUP) / mo.back));
      const dir = t < mo.out ? blockP.clone().sub(from) : from.clone().sub(blockP);
      m.position.copy(p); m.position.y = Math.abs(Math.sin(t * 18)) * 0.06; m.rotation.y = Math.atan2(dir.x, dir.z);
    }
    tweens.update(dt * k);
    if (G.over && !endTimer) { endTimer = 1; const g0 = G; setTimeout(() => { if (G === g0) finish(g0.result); }, G.result === 'win' ? 700 : 400); } // a restart in between makes this timer stale
  }
  function finish(res) {
    if (dead) return;
    if (auto) { lvl = res === 'win' ? (lvl + 1) % LEVELS.length : lvl; build(); return; }
    if (res === 'win') {
      const last = lvl === LEVELS.length - 1;
      ctx.result({ win: true, last, title: last ? 'All clear!' : 'Level complete', sub: last ? 'Three shipped levels. 47 more in the store, all built solo.' : `Mice Flow · level ${LEVELS[lvl]}`, next: () => { lvl = (lvl + 1) % LEVELS.length; build(); }, retry: () => build() });
    } else ctx.result({ win: false, title: 'Out of space', sub: 'The tray filled with houses whose colours were still buried.', next: () => build() });
  }

  speedBtn = document.createElement('button'); speedBtn.type = 'button'; speedBtn.className = 'arcade-speed'; speedBtn.textContent = '2×'; ctx.ui.append(speedBtn);
  speedBtn.addEventListener('click', () => { fast = !fast; speedBtn.classList.toggle('on', fast); speedBtn.setAttribute('aria-pressed', String(fast)); });
  build();
  return {
    scene, camera, update, resize: () => fit(),
    autoplay(on) { auto = on; fast = on; speed = 1; speedBtn.classList.toggle('on', on); },
    restart() { auto = false; fast = false; speed = 1; speedBtn.classList.remove('on'); lvl = 0; build(); },
    test: {
      set speed(v) { speed = v; },
      get state() { return { total: LEVELS.length, level: lvl + 1, over: G.over, result: G.result, progress: G.blocks.filter(b => b.gone).length / G.blocks.length, onBelt: G.parked().length + G.mice.length, auto }; },
      nextMove() { const h = G.botChoice(); if (!h || G.time - G.lastTap < 0.4) return null; const v = houses.get(h).position.clone().setY(0.6).project(camera), r = ctx.canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
    },
    destroy() { dead = true; ctx.canvas.removeEventListener('pointerdown', onPointer); speedBtn.remove(); disposeScene(scene); },
  };
}
