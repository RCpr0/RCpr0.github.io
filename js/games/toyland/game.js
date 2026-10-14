// Toyland Go! renderer: the shipped plush toys (Meshy models, recoloured per colour by the game's tint mask), trays,
// capsules, chain links and voxel cube, the live levels and the shipped sounds. Rules and bots live in core.js.
import { Game, Bot, TICK, colorOf, shapeOf, isEmpty } from './core.js';
import { loadModel, loadTexture, tweenList, easeOutBack, easeInOut, easeOutCubic, disposeScene, gloss, matte, addRig, fitPerspective, hoverSprings } from '../common.js';

const LEVELS = [3, 9, 10, 12, 25];
const MODELS = ['Bear.json', 'Bunny.json', 'Cat.json', 'Chick.json'];   // shape ids 0..3, as the game's CharacterFactory
const SKINS = ['bear.webp', 'bunny.webp', 'cat.webp', 'chick.webp'], MASKS = ['bearmask.webp', 'bunnymask.webp', 'catmask.webp', 'chickmask.webp'];
const SOUNDS = { shot1: 'shot1.mp3', shot2: 'shot2.mp3', shot3: 'shot3.mp3', hit1: 'voxelhit1.mp3', hit2: 'voxelhit2.mp3', hit3: 'voxelhit3.mp3', merge: 'merge1.mp3',
  pick1: 'pick1.mp3', pick2: 'pick2.mp3', drop1: 'drop1.mp3', drop2: 'drop2.mp3', swap: 'swap.mp3', refused: 'refused.mp3', rejected: 'rejected.mp3', deploy: 'deploy.mp3', land: 'land.mp3', done: 'done.mp3',
  trayRemoved: 'trayremoved.mp3', trayReady: 'trayready.mp3', levelUp: 'levelup.mp3', levelFail: 'levelfail.mp3', click: 'click.mp3' };
// Layout (world units): three columns of trays, the dock row above them, the voxel picture on top.
const COL_X = 3.6, ROW_Y = 2.74, SLOT_X = 1.008, OBJ_R = 3.1, OBJ_Y = 7.7, SHOOTER_S = 1.06, SWAP_R = 0.5, SNAP_R = 1.35;
// Per animal prefab scale (the models are normalised differently), then the layout's character scale 0.82 and height 1.12.
const PREFAB = [[1.5, 1.6, 1.5], [1.371, 1.371, 1.371], [1.3, 1.3, 1.3], [1.29, 1.29, 1.29]].map(([x, y, z]) => [x * 0.82, y * 0.82 * 1.12, z * 0.82]);

export async function create(ctx) {
  const { THREE, base } = ctx;
  let dead = false;
  const [toyModels, trayM, blasterM, capsuleM, linkM, voxelM, skins, masks, glowTex, sparkTex, ringTex, bubbleTex, arrowsTex, laneTex, levels, play] = await Promise.all([
    Promise.all(MODELS.map(f => loadModel(base + f))), loadModel(base + 'Tray.json'), loadModel(base + 'Blaster.json'), loadModel(base + 'Capsule.json'),
    loadModel(base + 'ChainLink.json'), loadModel(base + 'Voxel.json'),
    Promise.all(SKINS.map(f => loadTexture(base + f))), Promise.all(MASKS.map(f => loadTexture(base + f, { srgb: false }))),
    loadTexture(base + 'glow.webp'), loadTexture(base + 'sparkle.webp'), loadTexture(base + 'ring.webp'), loadTexture(base + 'waitbubble.webp'), loadTexture(base + 'lanearrows.webp'), loadTexture(base + 'lanepanel.webp'),
    Promise.all(LEVELS.map(n => fetch(`${base}level${n}.json`).then(r => r.json()))),
    ctx.loadSounds(SOUNDS),
  ]);
  const sfx = (name, o) => play(name, o), pick = (...n) => n[Math.floor(Math.random() * n.length)];

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, 1, 0.5, 400);
  const rig = addRig(scene, { size: 14, center: new THREE.Vector3(0, 2, 0) });
  // The rig's floor stands up behind the board as a wall, so everything casts a soft shadow onto the section colour.
  rig.floor.rotation.set(0, 0, 0); rig.floor.position.set(0, 2, -2.4); rig.floor.material.opacity = 0.16;
  rig.key.position.set(3.5, 9, 15); rig.key.target.position.set(0, 2, 0);
  const tweens = tweenList(), hov = hoverSprings();
  const world = new THREE.Group(); scene.add(world);

  // ---- materials ----
  // The game's Character Tint (CharacterTint.shader): one grey plush texture per animal is recoloured from the palette;
  // the mask (and near-white texels) keep their own colour (muzzle, eyes). Toon ramp, top light, foot occlusion, a soft
  // highlight knee. Values per animal from the shipped *_Tint materials.
  const PRESETS = [
    { baseLuma: .547, saturation: 1.948, brightness: 1.5, headroom: .933, keepLuma: .528, keepWhites: .879, keepTint: [1, 1, 1, 0], shadow: .648, shadowRichness: .909, rampSmoothing: .644, rimStrength: .006, rimWidth: 8, aoStrength: .729, footAO: .806, undersideAO: 1, topLight: .5, softKnee: 1, maxBrightness: 1.5 },
    { baseLuma: .598, saturation: 1.2, brightness: 1.402, headroom: .995, keepLuma: .1, keepWhites: 1.1, keepTint: [.283, .283, .283, 0], shadow: .873, shadowRichness: .69, rampSmoothing: 1, rimStrength: .172, rimWidth: 7.74, aoStrength: .299, footAO: .55, undersideAO: .664, topLight: .464, softKnee: 1, maxBrightness: 1.5 },
    { baseLuma: .788, saturation: 2, brightness: 1.5, headroom: .85, keepLuma: .1, keepWhites: 1.1, keepTint: [1, 1, 1, 0], shadow: .433, shadowRichness: .772, rampSmoothing: .5, rimStrength: 0, rimWidth: .5, aoStrength: .409, footAO: 1, undersideAO: .566, topLight: .5, softKnee: .82, maxBrightness: 1.314 },
    { baseLuma: .57, saturation: 2, brightness: 1.5, headroom: .933, keepLuma: .479, keepWhites: .879, keepTint: [1, 1, 1, 0], shadow: .534, shadowRichness: .966, rampSmoothing: .756, rimStrength: .116, rimWidth: 8, aoStrength: .455, footAO: .757, undersideAO: .674, topLight: .5, softKnee: .962, maxBrightness: 1.5 },
  ];
  const LIGHT = new THREE.Vector3(-.65, .8, .85).normalize();
  const toyMats = new Map();
  function toyMat(shape, hex) {
    const k = shape + hex; if (toyMats.has(k)) return toyMats.get(k);
    const p = PRESETS[shape], u = { map: { value: skins[shape] }, maskMap: { value: masks[shape] }, uColor: { value: new THREE.Color(hex) }, uLight: { value: LIGHT }, uHeight: { value: toyModels[shape].size.y }, uKeepTint: { value: new THREE.Vector4(...p.keepTint) }, uFlash: { value: 0 } };
    for (const n of Object.keys(p)) if (n !== 'keepTint') u['u_' + n] = { value: p[n] };
    const m = new THREE.ShaderMaterial({ uniforms: u, toneMapped: false,
      vertexShader: `varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vH;
        void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; vH = position.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform sampler2D map, maskMap; uniform vec3 uColor, uLight; uniform vec4 uKeepTint; uniform float uHeight, uFlash;
        uniform float u_baseLuma,u_saturation,u_brightness,u_headroom,u_keepLuma,u_keepWhites,u_shadow,u_shadowRichness,u_rampSmoothing,u_rimStrength,u_rimWidth,u_aoStrength,u_footAO,u_undersideAO,u_topLight,u_softKnee,u_maxBrightness;
        varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vH;
        vec3 sat(vec3 c, float a){ float l = dot(c, vec3(.299,.587,.114)); return max(vec3(0.), mix(vec3(l), c, a)); }
        vec3 boost(vec3 c){ float mx = max(c.r,max(c.g,c.b)), mn = min(c.r,min(c.g,c.b)); float s = (mx-mn)/max(mx,1e-3);
          c = sat(c, 1. + (u_saturation-1.)*(1.-s)); float pk = max(c.r,max(c.g,c.b)); return c * min(u_brightness, u_headroom/max(pk,1e-3)); }
        void main(){
          vec3 tex = texture2D(map, vUv).rgb; float keep = texture2D(maskMap, vUv).r;
          float luma = dot(tex, vec3(.299,.587,.114));
          vec3 body = boost(uColor * clamp(luma/u_baseLuma, 0., 1.));
          vec3 accent = sat(uKeepTint.rgb * clamp(luma/u_keepLuma, 0., 1.), u_saturation) * u_brightness;
          vec3 kept = mix(tex, accent, uKeepTint.a * (1. - smoothstep(.75,.95,luma)));
          keep = max(keep, smoothstep(u_keepWhites-.05, u_keepWhites, luma));
          vec3 albedo = mix(body, kept, keep);
          vec3 n = normalize(vN) * (gl_FrontFacing ? 1. : -1.); vec3 v = normalize(cameraPosition - vW);
          float wrap = dot(n, uLight)*.5 + .5; float ramp = smoothstep(.5-u_rampSmoothing*.5, .5+u_rampSmoothing*.5, wrap);
          vec3 shadowCol = albedo * mix(vec3(1.), albedo, u_shadowRichness) * u_shadow;
          vec3 col = mix(shadowCol, albedo, ramp);
          float under = clamp(-n.y,0.,1.) * u_undersideAO; float h = vH/max(uHeight,.001);
          float ground = (1. - smoothstep(0., u_footAO+.001, h)) * .8; float occ = clamp(max(under, ground),0.,1.) * u_aoStrength;
          col = mix(col, shadowCol*.85, occ); col += albedo * u_topLight * clamp(n.y,0.,1.);
          float rim = pow(1. - clamp(dot(n,v),0.,1.), u_rimWidth) * u_rimStrength * (.35 + .65*ramp); col += mix(albedo, vec3(1.), .45) * rim;
          float pk = max(col.r,max(col.g,col.b)); float range = max(u_maxBrightness-u_softKnee, 1e-3);
          float rolled = pk <= u_softKnee ? pk : u_softKnee + range*(1. - exp(-(pk-u_softKnee)/range)); col *= rolled/max(pk,1e-4);
          col = mix(col, vec3(1.), uFlash);
          gl_FragColor = vec4(col, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
    toyMats.set(k, m); return m;
  }
  const eyeMat = gloss('#16121c', null, { roughness: 0.15, clearcoat: 1 });
  const trayMat = { white: gloss('#eeeeee', null, { roughness: 0.35 }), cream: gloss('#f9f4e9', null, { roughness: 0.45 }) };
  const laneMat = new THREE.MeshBasicMaterial({ map: laneTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.9 });
  // The lane sprite is 9-sliced (borders L48 B58 R48 T59 px of 128, 100 px per unit), as the Unity sprite renderer does.
  function nineSlice(w, h, [l, b, r, t] = [48, 58, 48, 59], px = 128, ppu = 100) {
    const xs = [0, l / ppu, w - r / ppu, w], ys = [0, b / ppu, h - t / ppu, h], us = [0, l / px, 1 - r / px, 1], vs = [0, b / px, 1 - t / px, 1], pos = [], uv = [], idx = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { pos.push(xs[i], ys[j], 0); uv.push(us[i], vs[j]); }
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const a = j * 4 + i; idx.push(a, a + 1, a + 5, a, a + 5, a + 4); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g;
  }
  const padMat = { rim: gloss('#2777d1', null, { roughness: 0.25, emissive: '#00144e' }), inner: gloss('#268fb9', null, { roughness: 0.2, emissive: '#3a657c', emissiveIntensity: 0.6 }) };
  const padCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 48);
  const blasterMats = { teal: gloss('#58b7c9'), gold: gloss('#ffbc47', null, { metalness: 0.2 }), rim: gloss('#6288ac'), dark: gloss('#15253c'), navy: gloss('#2d4667') };
  // Seal capsule glass: pale blue tint, bright fresnel edge (the shipped outline #EBF7FF over a #B2E0FF body).
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#b2e0ff', transparent: true, opacity: 0.3, roughness: 0.04, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2.5 });
  glassMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `float fr = pow(1. - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.5);
    outgoingLight = mix(outgoingLight, vec3(.92,.97,1.), fr * .85); diffuseColor.a = mix(diffuseColor.a, .9, fr);
    #include <opaque_fragment>`); };
  const capBaseMat = gloss('#338cff', null, { roughness: 0.25 }), capFloorMat = gloss('#034be7', null, { roughness: 0.3 });
  const chainMat = gloss('#f2a51e', null, { metalness: 0.45, roughness: 0.28 });

  // ---- geometry helpers: centre models on their feet ----
  const footed = (m, part) => { const g = part.geometry.clone(); g.translate(-(m.min.x + m.max.x) / 2, -m.min.y, -(m.min.z + m.max.z) / 2); return g; };
  const toyGeo = toyModels.map(m => m.parts.map(p => ({ name: p.name, g: footed(m, p) })));
  const toyH = toyModels.map(m => m.size.y);
  const trayParts = trayM.parts.map(p => ({ mat: p.mat, g: footed(trayM, p) })), trayScale = 3.3 / trayM.size.x;
  const blasterParts = blasterM.parts.map(p => ({ mat: p.mat, g: p.geometry }));
  const capParts = capsuleM.parts.map(p => ({ name: p.name, g: footed(capsuleM, p) }));
  const linkGeo = linkM.parts[0].geometry;
  const voxelGeo = voxelM.parts[0].geometry;

  function makeToy(kind, hex) {
    const shape = shapeOf(kind) % 4, g = new THREE.Group(), body = new THREE.Group();
    for (const p of toyGeo[shape]) { const mesh = new THREE.Mesh(p.g, toyMat(shape, hex)); mesh.castShadow = true; body.add(mesh); }
    body.userData.base = new THREE.Vector3(...PREFAB[shape]); body.scale.copy(body.userData.base); g.add(body);
    g.userData = { body, kind, shape, hex, phase: Math.random() * 6.28 };
    return g;
  }
  function addBlaster(toy) {
    const b = new THREE.Group(); for (const p of blasterParts) { const m = new THREE.Mesh(p.g, blasterMats[p.mat] || blasterMats.teal); m.castShadow = true; b.add(m); }
    b.position.set(0.2, 0.62, 0.36); b.rotation.set(0, -0.35, 0); toy.add(b); toy.userData.blaster = b;
  }
  // Small canvas labels: ammo numbers and the Waiting bubble.
  function label(text, { w = 128, h = 64, size = 44, fill = '#ffffff', stroke = '#123c8c', bubble = false } = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.renderOrder = 20; sp.userData.set = t => {
      x.clearRect(0, 0, w, h);
      if (bubble) { x.drawImage(bubbleTex.image, 0, 0, w, h); }
      x.font = `900 ${size}px "Russo One", "Arial Rounded MT Bold", system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.lineJoin = 'round'; x.lineWidth = size * 0.22; x.strokeStyle = stroke; x.fillStyle = fill;
      const ty = bubble ? h * 0.44 : h / 2; if (stroke) x.strokeText(t, w / 2, ty); x.fillText(t, w / 2, ty); tex.needsUpdate = true;
    };
    sp.userData.set(text); return sp;
  }

  // ---- state ----
  let combo = 0, lastMerge = 0;
  let lvl = 0, G, bot, auto = false, speed = 1, acc = 0, endTimer = 0, sinceMove = 0, ended = false;
  let root, voxGroup, voxMesh, voxVis, voxRendered, shelfViews, charAt, padViews, shooters, chains, objCentre, objScale, flights = [], lanes;
  const hud = document.createElement('div'); hud.className = 'arcade-count'; ctx.ui.append(hud);

  // Instanced FX: cube debris + confetti, and glowing bullets with ghost trails.
  const DEBRIS = 700, debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5 }), DEBRIS);
  debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage); debris.frustumCulled = false; scene.add(debris);
  const parts = []; const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Color();
  for (let i = 0; i < DEBRIS; i++) { debris.setMatrixAt(i, _m.makeScale(0, 0, 0)); debris.setColorAt(i, _c.set('#fff')); }
  function burst(pos, hex, n, { speed: sp = 4, size = 0.22, life = 0.7, up = 2, grav = 14 } = {}) {
    for (let k = 0; k < n; k++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.2 + 0.2, (Math.random() - 0.5) * 2).normalize().multiplyScalar(sp * (0.5 + Math.random()));
      v.y += up; parts.push({ p: pos.clone(), v, life, t: 0, size: size * (0.6 + Math.random() * 0.6), hex: Array.isArray(hex) ? pick(...hex) : hex, rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), grav });
    }
    if (parts.length > DEBRIS) parts.splice(0, parts.length - DEBRIS);
  }
  const BUL = 260, bullets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicMaterial({ toneMapped: false }), BUL);
  bullets.frustumCulled = false; bullets.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(bullets);
  for (let i = 0; i < BUL; i++) { bullets.setMatrixAt(i, _m.makeScale(0, 0, 0)); bullets.setColorAt(i, _c.set('#fff')); }
  const ghosts = [];
  const sprites = [];
  function flash(tex, pos, { size = 2, life = 0.4, color = '#ffffff', grow = 1.8 } = {}) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.position.copy(pos); sp.scale.setScalar(size); scene.add(sp); sprites.push({ sp, t: 0, life, size, grow });
  }

  // ---- building a level ----
  const colX = c => (c - 1) * COL_X, rowY = r => -r * ROW_Y;
  function build() {
    if (voxMesh) { voxMesh.material.dispose(); voxMesh.dispose(); }
    if (root) world.remove(root);   // models, materials and textures are shared across levels
    tweens.clear(); hov.clear(); ctx.hideResult(); parts.length = 0; ghosts.length = 0; flights = []; for (const s of sprites) scene.remove(s.sp); sprites.length = 0;
    acc = 0; endTimer = 0; sinceMove = 0; ended = false; drag = null;
    G = new Game(levels[lvl]); bot = new Bot(G);
    ctx.setLevel(`Level ${LEVELS[lvl]}`);
    root = new THREE.Group(); world.add(root);
    const L = G.level, R = G.view.radius;
    objScale = OBJ_R / R; objCentre = new THREE.Vector3(0, OBJ_Y, -G.view.muzzles[0][2] * objScale);
    // Lanes: one frosted glass panel per column with the queue's arrows on top.
    lanes = [];
    for (let c = 0; c < 3; c++) {
      const top = rowY(0) + 2.05, bottom = rowY(2) - 0.85, lane = new THREE.Mesh(nineSlice(3.5, top - bottom), laneMat);
      lane.position.set(colX(c) - 1.75, bottom, -1.05); lane.renderOrder = -1; root.add(lane);
      // the queue's chevrons drift up the top of each lane
      const ars = [0, 1].map(k => { const a = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42), new THREE.MeshBasicMaterial({ map: arrowsTex, transparent: true, depthWrite: false, toneMapped: false })); a.position.set(colX(c), top - 0.5, -1.0); a.userData.k = k; root.add(a); return a; });
      lanes.push({ lane, ars, top });
    }
    // Dock pads, exactly where the rules aim from.
    padViews = G.view.muzzles.map((m, i) => {
      const g = new THREE.Group(); g.position.set(m[0] * objScale, objCentre.y + G.view.dockY * objScale, 0);
      const tilt = new THREE.Group(); tilt.rotation.x = 16.25 * Math.PI / 180;
      const rim = new THREE.Mesh(padCyl, padMat.rim); rim.scale.set(1.656, 0.151 * 2, 1.656); rim.position.set(0, 0.0, 0);
      const top = new THREE.Mesh(padCyl, padMat.inner); top.scale.set(1.12, 0.102 * 2, 1.12); top.position.set(0, 0.11, 0);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.52, 48, 1, Math.PI / 2, Math.PI * 2), new THREE.MeshBasicMaterial({ color: '#1f4ca8', toneMapped: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.217; tilt.add(rim, top, ring); g.add(tilt);
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const num = label('', { size: 40 }); num.scale.set(1.2, 0.6, 1); num.position.set(0, -0.32, 0.95); g.add(num);
      root.add(g); return { g, num, top, ring, tilt };
    });
    shooters = new Map();
    // The voxel picture: one instanced rounded cube per voxel; only the shell (and the layer under it) is drawn.
    voxGroup = new THREE.Group(); voxGroup.position.copy(objCentre); voxGroup.scale.setScalar(objScale); root.add(voxGroup);
    const V = G.voxels, mat = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0 });
    voxMesh = new THREE.InstancedMesh(voxelGeo, mat, V.n); voxMesh.castShadow = true; voxMesh.receiveShadow = true;
    voxVis = V.clone(); voxRendered = new Uint8Array(V.n);
    for (let i = 0; i < V.n; i++) voxMesh.setColorAt(i, _c.set(L.voxelColors[V.colors[i]] || '#ccc'));
    for (let i = 0; i < V.n; i++) refreshVoxel(i);
    voxGroup.add(voxMesh); voxGroup.quaternion.fromArray(G.view.q);
    // Shelves.
    shelfViews = new Map(); charAt = new Map(); chains = [];
    for (let c = 0; c < 3; c++) G.shelves.cols[c].forEach((s, r) => {
      const v = makeShelf(s); v.g.position.set(colX(c), r < 3 ? rowY(r) : rowY(3) - 1, 0); v.g.visible = r < 3; shelfViews.set(s.id, v);
    });
    for (const s of G.shelves.byId.values()) if (s.partner > s.id) addChain(s.id, s.partner);
    root.traverse(o => { if (o.isMesh && o !== voxMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
    fit(); layout(true); updateHud();
  }
  function makeShelf(s) {
    const g = new THREE.Group(), tray = new THREE.Group();
    for (const p of trayParts) { const m = new THREE.Mesh(p.g, trayMat[p.mat] || trayMat.white); m.receiveShadow = m.castShadow = true; tray.add(m); }
    tray.scale.setScalar(trayScale); tray.rotation.x = 18.8 * Math.PI / 180; tray.position.set(0, -0.12, -0.25); g.add(tray); root.add(g);
    const v = { id: s.id, g, tray, caps: [], scarf: null, shooter: null, bubble: null };
    s.slots.forEach((k, i) => {
      if (isEmpty(k)) return;
      const toy = makeToy(k, G.level.toyColors[colorOf(k)]); toy.position.copy(slotLocal(i)); g.add(toy); charAt.set(key(s.id, i), toy);
      if (s.sealed[i]) addCapsule(v, i, toy);
    });
    s.pair.forEach((p, i) => { if (p) addScarf(v, i); });
    return v;
  }
  const key = (id, i) => id * 8 + i;
  const slotLocal = i => new THREE.Vector3((i - 1) * SLOT_X, 0, 0.1);
  function addCapsule(v, i, toy) {
    const c = new THREE.Group();
    for (const p of capParts) { const m = new THREE.Mesh(p.g, p.name === 'dome' ? glassMat : p.name === 'floor' ? capFloorMat : capBaseMat); m.renderOrder = p.name === 'dome' ? 5 : 0; c.add(m); }
    c.scale.setScalar(0.88); c.position.copy(slotLocal(i)); v.g.add(c); v.caps[i] = c; toy.userData.capsule = c;
  }
  // A hand-holding pair shares one striped scarf.
  const scarfTex = (() => { const c = document.createElement('canvas'); c.width = 64; c.height = 16; const x = c.getContext('2d'); for (let i = 0; i < 8; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#ed2933'; x.fillRect(i * 8, 0, 8, 16); } const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); return t; })();
  const scarfMat = matte('#ffffff', scarfTex, { roughness: 0.8 });
  function addScarf(v, left) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.52, 0.8, 0.42), new THREE.Vector3(-0.2, 0.52, 0.62), new THREE.Vector3(0.2, 0.52, 0.62), new THREE.Vector3(0.52, 0.8, 0.42)]);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.115, 10), scarfMat); m.castShadow = true;
    m.position.copy(slotLocal(left)).add(new THREE.Vector3(SLOT_X / 2, 0, 0)); v.g.add(m); v.scarf = { m, left };
  }
  function addChain(a, b) {
    const g = new THREE.Group(); for (let k = 0; k < 7; k++) { const l = new THREE.Mesh(linkGeo, chainMat); l.rotation.x = k % 2 ? Math.PI / 2 : 0; l.scale.setScalar(0.7); l.castShadow = true; g.add(l); }
    root.add(g); chains.push({ a, b, g });
  }
  function placeChains() {
    for (const ch of chains) {
      const A = shelfViews.get(ch.a), B = shelfViews.get(ch.b);
      if (!A || !B || !G.shelves.exists(ch.a) || !G.shelves.exists(ch.b) || G.shelves.partnerOf(ch.a) !== ch.b) { if (!ch.gone) breakChain(ch); continue; }
      const pa = A.g.position.clone().add(new THREE.Vector3(1.55, 0.2, 0.5)), pb = B.g.position.clone().add(new THREE.Vector3(-1.55, 0.2, 0.5));
      if (pa.x > pb.x) { pa.x -= 3.1; pb.x += 3.1; }
      ch.g.visible = A.g.visible && B.g.visible;
      ch.g.children.forEach((l, k) => { const t = (k + 0.5) / ch.g.children.length; l.position.lerpVectors(pa, pb, t); l.position.y -= Math.sin(t * Math.PI) * 0.25; });
    }
  }
  function breakChain(ch) {
    ch.gone = true; chains = chains.filter(x => x !== ch);
    ch.g.children.forEach(l => { const v = new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, 2); const p0 = l.position.clone(); tweens.add(0.7, t => { l.position.copy(p0).addScaledVector(v, t); l.position.y -= 9 * t * t; l.rotation.z += 0.2; }, x => x, () => {}); });
    tweens.add(0.75, () => {}, x => x, () => root.remove(ch.g)); sfx('trayRemoved', { rate: 1.3, volume: 0.4 });
  }

  // Shelves slide to their column places; ones coming up from the queue rise in from below.
  function layout(instant = false) {
    if (drag) { layoutDirty = true; return; }
    layoutDirty = false;
    for (let c = 0; c < 3; c++) G.shelves.cols[c].forEach((s, r) => {
      const v = shelfViews.get(s.id); if (!v) return;
      const to = new THREE.Vector3(colX(c), r < 3 ? rowY(r) : rowY(3) - 1, 0);
      if (r >= 3) { v.g.visible = false; v.g.position.copy(to); return; }
      if (!v.g.visible) { v.g.visible = true; v.g.position.copy(to).add(new THREE.Vector3(0, -2.2, 0)); v.g.scale.setScalar(0.6); }
      if (instant) { v.g.position.copy(to); v.g.scale.setScalar(1); return; }
      if (v.g.position.distanceTo(to) < 1e-3 && v.g.scale.x === 1) return;
      const from = v.g.position.clone(), s0 = v.g.scale.x; v.moving = true;
      tweens.add(0.32, t => { v.g.position.lerpVectors(from, to, t); v.g.scale.setScalar(s0 + (1 - s0) * t); }, easeOutBack, () => { v.moving = false; });
    });
  }
  let layoutDirty = false;

  // ---- voxels ----
  function refreshVoxel(i) {
    const show = voxVis.alive[i] && (voxVis.hasFreeFace(i) || voxVis.isNearSurface(i));
    if (show === !!voxRendered[i]) return; voxRendered[i] = show ? 1 : 0;
    const c = voxVis.cell(i), ctr = G.view.centre;
    _m.compose(_v.set(c[0] - ctr[0], c[1] - ctr[1], -(c[2] - ctr[2])), _q.identity(), _s.setScalar(show ? 1 : 0));
    voxMesh.setMatrixAt(i, _m); voxMesh.instanceMatrix.needsUpdate = true;
  }
  function hideVoxel(i) {
    if (!voxVis.alive[i]) return;
    voxVis.destroy(i); voxRendered[i] = 1; refreshVoxel(i);
    for (let d = 0; d < 6; d++) { const j = voxVis.nbr[i * 6 + d]; if (j >= 0) refreshVoxel(j); }
    const c = voxVis.cell(i);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = voxVis.indexOf(c[0] + dx, c[1] + dy, c[2] + dz); if (j >= 0) refreshVoxel(j); }
  }
  const voxelWorld = (i, out = new THREE.Vector3()) => { const c = G.voxels.cell(i), ctr = G.view.centre; return voxGroup.localToWorld(out.set(c[0] - ctr[0], c[1] - ctr[1], -(c[2] - ctr[2]))); };

  // ---- events from the rules ----
  function handle(events) {
    for (const e of events) {
      if (e.type === 'moved') onMoved(e);
      else if (e.type === 'swapped') onSwapped(e);
      else if (e.type === 'matched') onMatched(e);
      else if (e.type === 'headWait' || e.type === 'chainHeld') showBubble(e.shelf, true);
      else if (e.type === 'headReady') showBubble(e.shelf, false);
      else if (e.type === 'deployed') onDeployed(e);
      else if (e.type === 'removed') onRemoved(e);
      else if (e.type === 'shot') onShot(e);
      else if (e.type === 'done') onDone(e);
      else if (e.type === 'shuffled') { layout(); sfx('swap'); }
      else if (e.type === 'won' || e.type === 'lost') onEnd(e.type === 'won');
    }
    if (events.some(e => ['removed', 'shuffled', 'matched', 'deployed'].includes(e.type))) layout();
  }
  function moveToy(toy, destShelf, slot, { hop = 0.9, dur = 0.24 } = {}) {
    const v = shelfViews.get(destShelf); if (!toy || !v) return;
    v.g.attach(toy); const from = toy.position.clone(), to = slotLocal(slot);
    toy.userData.moving = true;
    tweens.add(dur, t => { toy.position.lerpVectors(from, to, t); toy.position.y += Math.sin(t * Math.PI) * hop; }, easeInOut, () => {
      toy.userData.moving = false; toy.position.copy(to); squash(toy);
    });
    toy.scale.setScalar(1);
  }
  function squash(toy, k = 0.18) { const b = toy.userData.body, B = b.userData.base; tweens.add(0.22, t => { const s = Math.sin(t * Math.PI) * k * (1 - t); b.scale.set(B.x * (1 + s), B.y * (1 - s), B.z * (1 + s)); }, x => x, () => b.scale.copy(B)); }
  function onMoved(e) {
    const [f, fs] = e.from, [t, ts] = e.to, n = e.pair ? 2 : 1, src = shelfViews.get(f), dst = shelfViews.get(t);
    const toys = []; for (let k = 0; k < n; k++) { toys.push(charAt.get(key(f, fs + k))); charAt.delete(key(f, fs + k)); }
    toys.forEach((toy, k) => { charAt.set(key(t, ts + k), toy); moveToy(toy, t, ts + k, { hop: dragging(toy) ? 0.2 : 0.9 }); if (toy) toy.userData.dragged = false; });
    if (e.pair && src?.scarf && dst) { const sc = src.scarf; src.scarf = null; dst.g.attach(sc.m); const from = sc.m.position.clone(), to = slotLocal(ts).add(new THREE.Vector3(SLOT_X / 2, 0, 0)); tweens.add(0.24, k => sc.m.position.lerpVectors(from, to, k), easeInOut); dst.scarf = { m: sc.m, left: ts }; }
    sfx(pick('drop1', 'drop2'), { volume: 0.6 });
  }
  const dragging = toy => !!toy?.userData.dragged;
  function onSwapped(e) {
    const [a, as] = e.a, [b, bs] = e.b, A = charAt.get(key(a, as)), B = charAt.get(key(b, bs));
    charAt.set(key(a, as), B); charAt.set(key(b, bs), A);
    moveToy(A, b, bs, { hop: dragging(A) ? 0.2 : 0.9 }); moveToy(B, a, as, { hop: 0.9 }); if (A) A.userData.dragged = false;
    sfx('swap', { volume: 0.6 });
  }
  function onMatched(e) {
    const v = shelfViews.get(e.shelf); if (!v) return;
    const toys = [0, 1, 2].map(i => { const t = charAt.get(key(e.shelf, i)); charAt.delete(key(e.shelf, i)); return t; }).filter(Boolean);
    for (const c of v.caps) if (c) shatterCapsule(v, c);
    v.caps = [];
    if (v.scarf) { const m = v.scarf.m; v.scarf = null; tweens.add(0.25, t => m.scale.setScalar(1 - t), x => x, () => v.g.remove(m)); }
    const hex = G.level.toyColors[colorOf(e.kind)], keep = toys[1] || toys[0];
    // The three hop together and become one bigger toy with a blaster: the shooter, waiting on its tray.
    setTimeout(() => {}, 0);
    toys.forEach(t => { const from = t.position.clone(); tweens.add(0.22, k => { t.position.lerpVectors(from, slotLocal(1), k); t.position.y = from.y + Math.sin(k * Math.PI) * 0.9; }, easeInOut); });
    tweens.add(0.24, () => {}, x => x, () => {
      for (const t of toys) if (t !== keep) v.g.remove(t);
      if (!keep) return;
      const B = keep.userData.body.userData.base.multiplyScalar(SHOOTER_S), B0 = B.clone(); addBlaster(keep);
      // the shipped merge bounce: 1 -> 1.28 -> 0.93 -> 1
      tweens.add(0.42, k => keep.userData.body.scale.copy(B0).multiplyScalar(k < .4 ? 1 + .28 * Math.sin(k / .4 * Math.PI / 2) : k < .7 ? 1.28 - .35 * (k - .4) / .3 : .93 + .07 * (k - .7) / .3));
      const p = keep.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.8, 0.5));
      burst(p, [hex, '#ffffff', '#fff6a8'], 18, { speed: 4, size: 0.16, life: 0.6, up: 2 }); flash(sparkTex, p, { size: 2.6, life: 0.45 });
      const num = label(String(e.ammo), { size: 40 }); num.scale.set(1.1, 0.55, 1); num.position.set(0, -0.15, 0.7); keep.add(num); keep.userData.num = num;
    });
    v.shooter = keep; v.kind = e.kind; v.ammo = e.ammo;
    // the shipped combo: each merge within half a second plays the merge sound a little higher (up to 10 steps)
    combo = performance.now() - lastMerge < 500 / Math.min(speed, 4) ? Math.min(10, combo + 1) : 0; lastMerge = performance.now();
    sfx('merge', { volume: 0.9, rate: 1 + 0.05 * combo }); ctx.shake(0.25);
  }
  function shatterCapsule(v, c) {
    const p = c.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.8, 0));
    burst(p, ['#dff4ff', '#ffffff', '#ffc531'], 14, { speed: 3.5, size: 0.14, life: 0.55 });
    tweens.add(0.2, t => c.scale.setScalar(0.88 * (1 + t * 0.3)), x => x, () => v.g.remove(c));
  }
  function showBubble(shelf, on) {
    const v = shelfViews.get(shelf); if (!v) return;
    const attach = () => {
      if (on && !v.bubble && v.shooter) { const b = label('Waiting', { w: 192, h: 96, size: 30, fill: '#2a2a3a', stroke: null, bubble: true }); b.scale.set(1.9, 0.95, 1); b.position.set(0.9, 2.0, 0.6); v.shooter.add(b); v.bubble = b; tweens.add(0.35, t => b.scale.set(1.9 * t, 0.95 * t, 1), easeOutBack); }
      if (!on && v.bubble) { const b = v.bubble; v.bubble = null; tweens.add(0.2, t => b.scale.set(1.9 * (1 - t), 0.95 * (1 - t), 1), x => x, () => b.parent?.remove(b)); sfx('trayReady', { volume: 0.6 }); }
    };
    if (v.shooter?.userData.blaster) attach(); else tweens.add(0.3, () => {}, x => x, attach);
  }
  function onDeployed(e) {
    const v = shelfViews.get(e.shelf), pad = padViews[e.spot]; if (!v || !pad) return;
    let toy = v.shooter;
    if (v.bubble) { v.bubble.parent?.remove(v.bubble); v.bubble = null; }
    if (!toy) { toy = makeToy(e.kind, G.level.toyColors[colorOf(e.kind)]); v.g.add(toy); toy.position.copy(slotLocal(1)); }
    v.shooter = null; root.attach(toy);   // off the tray now: the tray leaves while the shooter gets ready to fly
    shooters.set(e.shooter, { toy, spot: e.spot, ammo: e.ammo, start: e.ammo, recoil: 0 });
    pad.num.userData.set(String(e.ammo)); setRing(pad, G.level.toyColors[colorOf(e.kind)], 1);
    const go = () => {
      if (!toy.userData.blaster) { toy.userData.body.userData.base.multiplyScalar(SHOOTER_S); toy.userData.body.scale.copy(toy.userData.body.userData.base); addBlaster(toy); }
      if (toy.userData.num) { toy.remove(toy.userData.num); toy.userData.num = null; }
      root.attach(toy); const from = toy.position.clone(), to = pad.g.position.clone().add(new THREE.Vector3(0, 0.36, 0));
      sfx('deploy', { volume: 0.7 });
      tweens.add(0.38, t => { toy.position.lerpVectors(from, to, t); toy.position.y += Math.sin(t * Math.PI) * 2.2; toy.rotation.y = t * Math.PI * 2; }, easeInOut, () => {
        toy.position.copy(to); toy.rotation.y = 0; squash(toy, 0.25); sfx('land', { volume: 0.6 });
        flash(ringTex, to.clone().add(new THREE.Vector3(0, 0.1, 0)), { size: 2.2, life: 0.4, color: G.level.toyColors[colorOf(e.kind)] });
        burst(to.clone().add(new THREE.Vector3(0, 0.3, 0)), ['#ffffff', '#bfe9ff'], 8, { speed: 2.5, size: 0.12, life: 0.4, up: 1 });
      });
    };
    if (toy.userData.blaster) go(); else tweens.add(0.3, () => {}, x => x, go);
  }
  // The dock's ammo ring fills in the shooter's colour and drains as it fires.
  function setRing(pad, hex, f) {
    if (hex) { if (!pad.fill) { pad.fill = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ toneMapped: false })); pad.fill.rotation.x = -Math.PI / 2; pad.fill.position.y = 0.222; pad.tilt.add(pad.fill); } pad.fill.material.color.set(hex).multiplyScalar(1.2); }
    if (!pad.fill) return;
    const step = Math.round(f * 60); if (step === pad.step) return; pad.step = step;
    pad.fill.geometry.dispose(); pad.fill.geometry = new THREE.RingGeometry(0.36, 0.52, 48, 1, Math.PI / 2, Math.PI * 2 * step / 60); pad.fill.visible = step > 0;
  }
  function onRemoved(e) {
    const v = shelfViews.get(e.shelf); if (!v) return; shelfViews.delete(e.shelf);
    for (let i = 0; i < 3; i++) charAt.delete(key(e.shelf, i));
    const g = v.g; g.userData.leaving = true;
    tweens.add(0.28, t => { g.scale.setScalar(Math.max(0.001, 1 - t)); g.position.z = t * 1.5; }, easeInOut, () => root.remove(g));
    if (!e.deployed) sfx('trayRemoved', { volume: 0.5 });
  }
  function onShot(e) {
    const s = shooters.get(e.shooter); if (!s) return;
    const pad = padViews[s.spot]; s.ammo = e.ammo; pad.num.userData.set(String(e.ammo)); s.recoil = 1; setRing(pad, null, e.ammo / (s.start || 1));
    const hex = G.level.toyColors[e.color] || '#fff', from = s.toy.position.clone().add(new THREE.Vector3(0.3, 1.0, 0.4));
    flights.push({ voxel: e.voxel, from, p: from.clone(), t: 0, hex: G.level.voxelColors[e.color] || hex });
    s.target = e.voxel;
    if (Math.random() < 0.35) sfx(pick('shot1', 'shot2', 'shot3'), { volume: 0.35, rate: 0.95 + Math.random() * 0.15 });
  }
  function onDone(e) {
    const s = shooters.get(e.shooter); if (!s) return; shooters.delete(e.shooter);
    padViews[e.spot].num.userData.set(''); setRing(padViews[e.spot], null, 0);
    const toy = s.toy, p0 = toy.position.clone();
    tweens.add(0.45, t => { toy.position.copy(p0); toy.position.y += Math.sin(t * Math.PI * 0.8) * 1.5; toy.scale.setScalar(Math.max(0.001, 1 - t * t)); toy.rotation.y = t * 5; }, x => x, () => {
      root.remove(toy); flash(sparkTex, p0.clone().add(new THREE.Vector3(0, 1.2, 0)), { size: 2, life: 0.35 });
    });
    sfx('done', { volume: 0.5 });
  }
  function onEnd(win) {
    ended = true;
    if (win) {
      sfx('levelUp', { volume: 0.8 });
      const at = objCentre.clone();
      setTimeout(() => { if (dead) return; for (let k = 0; k < 4; k++) setTimeout(() => !dead && burst(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 1 + Math.random() * 2, 1)), ['#ff4d6d', '#ffc531', '#29c3c9', '#7d5cff', '#5cff8a', '#ffffff'], 40, { speed: 7, size: 0.2, life: 1.4, up: 5, grav: 9 }), k * 160); }, 300);
    } else {
      sfx('levelFail', { volume: 0.8 }); ctx.shake(1.6);
      // the stuck shooters slump and the picture blushes red
      for (const s of shooters.values()) { const b = s.toy.userData.body; tweens.add(0.6, t => { b.rotation.z = Math.sin(t * Math.PI * 3) * 0.4 * (1 - t); b.rotation.x = 0.35 * t; }, easeOutCubic); }
      const m = voxMesh.material; tweens.add(1.0, t => m.emissive.setRGB(0.55 * Math.sin(t * Math.PI), 0, 0.05 * Math.sin(t * Math.PI)), x => x);
    }
  }

  // ---- per-frame visuals ----
  let time = 0;
  function animate(dt) {
    time += dt;
    voxGroup.quaternion.slerp(new THREE.Quaternion().fromArray(G.view.q), Math.min(1, dt * 20));
    // bullets home in on their voxel (the picture keeps turning) and pop it on arrival
    let bi = 0;
    flights = flights.filter(f => {
      const target = voxelWorld(f.voxel, _v.set(0, 0, 0)), d = target.distanceTo(f.p), step = 32 * dt;
      if (d <= step || f.t > 1.2) {
        hideVoxel(f.voxel);
        burst(target.clone(), [f.hex, f.hex, '#ffffff'], 4, { speed: 3, size: 0.12 * objScale * 2.4, life: 0.4, up: 1.5, grav: 18 });
        if (Math.random() < 0.22) sfx(pick('hit1', 'hit2', 'hit3'), { volume: 0.3, rate: 0.9 + Math.random() * 0.25 });
        voxGroup.scale.setScalar(objScale * 1.012);
        return false;
      }
      f.t += dt; f.p.addScaledVector(target.sub(f.p).normalize(), step);
      // a little arc early in the flight
      ghosts.push({ p: f.p.clone(), hex: f.hex, t: 0 });
      return true;
    });
    voxGroup.scale.lerp(_s.setScalar(objScale), Math.min(1, dt * 10));
    for (const f of flights) if (bi < BUL) { bullets.setMatrixAt(bi, _m.compose(f.p, _q.identity(), _s.setScalar(1.15))); bullets.setColorAt(bi, _c.set(f.hex).multiplyScalar(1.6)); bi++; }
    for (const g of ghosts) g.t += dt;
    while (ghosts.length && ghosts[0].t > 0.16) ghosts.shift();
    for (let k = ghosts.length - 1; k >= 0 && bi < BUL; k--) { const g = ghosts[k], s = 0.9 * (1 - g.t / 0.16); bullets.setMatrixAt(bi, _m.compose(g.p, _q.identity(), _s.setScalar(s))); bullets.setColorAt(bi, _c.set(g.hex).multiplyScalar(1.25)); bi++; }
    for (let i = bi; i < BUL; i++) bullets.setMatrixAt(i, _m.makeScale(0, 0, 0));
    bullets.count = BUL; bullets.instanceMatrix.needsUpdate = true; if (bullets.instanceColor) bullets.instanceColor.needsUpdate = true;
    // debris
    let di = 0;
    for (let k = parts.length - 1; k >= 0; k--) {
      const p = parts[k]; p.t += dt; if (p.t > p.life) { parts.splice(k, 1); continue; }
      p.v.y -= p.grav * dt; p.p.addScaledVector(p.v, dt); p.rot.x += dt * 6; p.rot.y += dt * 4;
      const s = p.size * Math.min(1, (p.life - p.t) / 0.25);
      if (di < DEBRIS) { debris.setMatrixAt(di, _m.compose(p.p, _q.setFromEuler(p.rot), _s.setScalar(s))); debris.setColorAt(di, _c.set(p.hex)); di++; }
    }
    for (let i = di; i < DEBRIS; i++) debris.setMatrixAt(i, _m.makeScale(0, 0, 0));
    debris.instanceMatrix.needsUpdate = true; if (debris.instanceColor) debris.instanceColor.needsUpdate = true;
    for (let k = sprites.length - 1; k >= 0; k--) { const s = sprites[k]; s.t += dt; const u = s.t / s.life; if (u >= 1) { scene.remove(s.sp); s.sp.material.dispose(); sprites.splice(k, 1); continue; } s.sp.scale.setScalar(s.size * (1 + (s.grow - 1) * u)); s.sp.material.opacity = 1 - u; }
    // shooters aim at what they shoot and kick back; idle toys breathe
    for (const s of shooters.values()) {
      s.recoil = Math.max(0, s.recoil - dt * 8);
      const b = s.toy.userData.body; b.position.z = -0.12 * s.recoil;
      if (s.target != null && G.voxels) { const t = voxelWorld(s.target, _v); const want = Math.atan2(t.x - s.toy.position.x, 3) * 0.6; s.toy.rotation.y += (want - s.toy.rotation.y) * Math.min(1, dt * 10); }
    }
    for (const toy of charAt.values()) { if (!toy || toy.userData.moving || toy.userData.dragged) continue; const b = toy.userData.body; b.position.y = Math.max(0, Math.sin(time * 2.2 + toy.userData.phase)) * 0.03; }
    for (const L of lanes) for (const a of L.ars) { const u = (time * 0.39 + a.userData.k * 0.5) % 1; a.position.y = L.top - 0.75 + u * 0.77; a.material.opacity = 0.49 * Math.sin(u * Math.PI); }
    placeChains();
  }

  // ---- input: drag a toy to another slot (or onto a toy to swap); drag the picture to turn it ----
  let drag = null;
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), _hit = new THREE.Vector3();
  function boardPoint(e, z = 0.6) {
    const r = ctx.el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    plane.constant = -z; return ray.ray.intersectPlane(plane, _hit) ? _hit.clone() : null;
  }
  // Every interactable slot with its world centre (toy height), as laid out now.
  function slotsNow() {
    const out = [];
    for (const [id, i, k] of G.shelves.visibleSlots()) { const v = shelfViews.get(id); if (!v) continue; out.push({ id, i, k, p: v.g.position.clone().add(slotLocal(i)).add(new THREE.Vector3(0, 0.6, 0.5)) }); }
    return out;
  }
  const nearest = (pt, list, r, ok) => { let b = null, bd = r; for (const s of list) { if (!ok(s)) continue; const d = Math.hypot(s.p.x - pt.x, s.p.y - pt.y); if (d < bd) { bd = d; b = s; } } return b; };
  function onDown(e) {
    if (auto || G.over || drag || e.button > 0 || e.target.closest?.('button, .arcade-card')) return;   // the stage's own buttons keep their clicks
    const pt = boardPoint(e); if (!pt) return;
    if (pt.y > objCentre.y - OBJ_R * 1.05) { drag = { spin: true, x: e.clientX, y: e.clientY }; G.view.dragging = true; capture(e); return; }
    const s = nearest(pt, slotsNow(), 0.85, s => !isEmpty(s.k));
    if (!s) return;
    if (G.shelves.isSealed(s.id, s.i)) { const toy = charAt.get(key(s.id, s.i)); if (toy) wiggle(toy); sfx('refused', { volume: 0.6 }); return; }
    const left = G.shelves.pairLeft(s.id, s.i), toys = left >= 0 ? [charAt.get(key(s.id, left)), charAt.get(key(s.id, left + 1))] : [charAt.get(key(s.id, s.i))];
    if (!toys[0]) return;
    drag = { from: [s.id, s.i], left, toys, offs: toys.map(t => t.getWorldPosition(new THREE.Vector3()).sub(s.p)), scarf: shelfViews.get(s.id)?.scarf, layoutDirty: false };
    for (const t of toys) { root.attach(t); t.userData.dragged = true; t.scale.setScalar(1.15); }
    if (drag.scarf && left >= 0) root.attach(drag.scarf.m);
    hov.set(null); sfx(pick('pick1', 'pick2'), { volume: 0.6 }); G.holdAutoDig = true;
    capture(e); onMove(e);
  }
  function capture(e) { try { ctx.el.setPointerCapture(e.pointerId); } catch (_) {} }
  function onMove(e) {
    if (!drag) return hover(e);
    if (drag.spin) { const r = ctx.el.getBoundingClientRect(); G.view.drag((e.clientX - drag.x) / r.width * 360, (e.clientY - drag.y) / r.height * 360); drag.x = e.clientX; drag.y = e.clientY; return; }
    const pt = boardPoint(e, 1.2); if (!pt) return;
    drag.toys.forEach((t, k) => t.position.copy(pt).add(drag.offs[k]).add(new THREE.Vector3(0, -0.6, 0.6)));
    if (drag.scarf && drag.left >= 0) drag.scarf.m.position.copy(drag.toys[0].position).add(new THREE.Vector3(SLOT_X / 2, 0, 0));
  }
  function onUp(e) {
    if (!drag) return;
    const d = drag; drag = null; G.holdAutoDig = false;
    if (d.spin) { G.view.dragging = false; G.view.released = 0; return; }
    const pt = boardPoint(e) || new THREE.Vector3(1e3, 1e3, 0), [fid, fsl] = d.from;
    const slots = slotsNow(), sh = G.shelves;
    let r = 'refused';
    if (sh.exists(fid) && sh.interactable(fid)) {
      if (d.left >= 0) {
        const viewIsLeft = fsl === d.left;
        const tgt = nearest(pt, slots, SNAP_R, s => { const l = viewIsLeft ? s.i : s.i - 1; return s.id !== fid && l >= 0 && l + 1 < 3 && isEmpty(sh.get(s.id, l)) && isEmpty(sh.get(s.id, l + 1)); });
        if (tgt) r = G.move(fid, d.left, tgt.id, viewIsLeft ? tgt.i : tgt.i - 1);
      } else if (nearest(pt, slots, SWAP_R, () => true)?.id === fid && nearest(pt, slots, SWAP_R, () => true)?.i === fsl) r = 'refused';
      else {
        const over = nearest(pt, slots, SWAP_R, s => !isEmpty(s.k) && !(s.id === fid && s.i === fsl));
        const tray = over ? over.id : trayAt(pt);
        const done = tray >= 0 ? sh.completingSlot(fid, fsl, tray) : -1;
        if (done >= 0 && isEmpty(sh.get(tray, done))) r = G.move(fid, fsl, tray, done);
        else if (done >= 0) r = G.swap(fid, fsl, tray, done);
        else if (over) r = G.swap(fid, fsl, over.id, over.i);
        else if (tray >= 0) {
          const t = nearest(pt, slots, 1e9, s => s.id === tray && isEmpty(s.k) && !(s.id === fid && s.i === fsl)) || nearest(pt, slots, 1e9, s => s.id === tray);
          if (t && !(t.id === fid && t.i === fsl)) r = isEmpty(t.k) ? G.move(fid, fsl, t.id, t.i) : G.swap(fid, fsl, t.id, t.i);
        } else { const t = nearest(pt, slots, SNAP_R, s => isEmpty(s.k) && !(s.id === fid && s.i === fsl)); if (t) r = G.move(fid, fsl, t.id, t.i); }
      }
    }
    const evs = G.events.splice(0);
    if (r !== 'refused') {
      const mv = evs.find(x => x.type === 'moved' || x.type === 'swapped');
      if (mv) bot.noteMove(d.from, mv.type === 'moved' ? mv.to : mv.b, mv.type === 'swapped');
      sinceMove = 0;
    }
    for (const t of d.toys) t.scale.setScalar(1);
    handle(evs);
    if (r === 'refused') {
      // back home with a little bounce
      d.toys.forEach((t, k) => { t.userData.dragged = false; moveToy(t, fid, (d.left >= 0 ? d.left : fsl) + (d.left >= 0 ? k : 0), { hop: 0.3, dur: 0.2 }); });
      if (d.scarf && d.left >= 0) { const v = shelfViews.get(fid); v.g.attach(d.scarf.m); d.scarf.m.position.copy(slotLocal(d.left)).add(new THREE.Vector3(SLOT_X / 2, 0, 0)); }
      sfx('rejected', { volume: 0.6 });
    }
    if (layoutDirty) layout();
  }
  function trayAt(pt) {
    for (const [id] of G.shelves.visibleSlots()) { const v = shelfViews.get(id); if (!v) continue; const p = v.g.position; if (Math.abs(pt.x - p.x) < 1.65 && pt.y > p.y - 0.5 && pt.y < p.y + 1.7) return id; }
    return -1;
  }
  function wiggle(toy) { const b = toy.userData.body; tweens.add(0.35, t => { b.rotation.z = Math.sin(t * Math.PI * 4) * 0.25 * (1 - t); }, x => x); }
  function hover(e) {
    if (auto || G.over) return hov.set(null);
    const pt = boardPoint(e); if (!pt) return hov.set(null);
    const s = nearest(pt, slotsNow(), 0.85, s => !isEmpty(s.k));
    hov.set(s ? charAt.get(key(s.id, s.i))?.userData.body || null : null);
  }
  const onLeave = () => hov.set(null);
  ctx.el.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
  ctx.el.addEventListener('pointerleave', onLeave);

  // ---- camera ----
  function fit() {
    const aspect = (ctx.el.clientWidth || 1) / (ctx.el.clientHeight || 1), pts = [];
    for (const x of [-COL_X - 1.8, COL_X + 1.8]) for (const y of [rowY(2) - 0.9, OBJ_Y + OBJ_R + 0.2]) for (const z of [-1, 1]) pts.push(new THREE.Vector3(x, y, z));
    const el = 8 * Math.PI / 180;
    fitPerspective(camera, pts, aspect, { dir: new THREE.Vector3(0, Math.sin(el), Math.cos(el)), top: 0.13, bottom: 0.03, side: 0.03 });
  }

  // ---- loop ----
  function update(dt) {
    hov.update(dt);
    if (!G) return;
    const sp = Math.min(speed, 8);
    acc += dt * sp; let n = 0;
    while (acc >= TICK && n < 400) {
      acc -= TICK; n++; sinceMove += TICK;
      if (!drag) G.holdAutoDig = auto && bot.holdsAutoDig;
      if (auto && !G.over && !busy() && sinceMove > 1.0) { const st = bot.next(); if (st) { bot.play(st); sinceMove = 0; } }
      G.tick();
      handle(G.events.splice(0));
    }
    tweens.update(dt * sp); animate(dt * Math.min(sp, 4));
    updateHud();
    if (G.over && !endTimer && !flights.length) {
      endTimer = 1; const g0 = G, won = G.outcome === 'won';
      setTimeout(() => { if (G === g0 && !dead) finish(won); }, (won ? 1300 : 900) / Math.min(speed, 4));
    }
  }
  // Something that would move the board under a dragging finger: a shelf sliding, or a merge about to take a spot.
  const busy = () => G.pending > 0 || [...shelfViews.values()].some(v => v.moving) || tweens.size > 40;
  function updateHud() { const left = G.voxels.remaining; hud.textContent = left ? `${left} blocks` : ''; }
  function finish(won) {
    if (auto) { if (won) lvl = (lvl + 1) % LEVELS.length; build(); return; }
    if (won) {
      const last = lvl === LEVELS.length - 1;
      ctx.result({ win: true, last, title: last ? 'All clear!' : 'Level complete', sub: last ? `${LEVELS.length} shipped levels cleared. 45 more in the store.` : `Toyland Go! · level ${LEVELS[lvl]} · ${G.level.name}`,
        next: () => { lvl = (lvl + 1) % LEVELS.length; build(); }, retry: () => build() });
    } else ctx.result({ win: false, title: 'No more space!', sub: 'Every shooter on the dock is stuck and the next one has nowhere to stand. Merge in a better order.', next: () => build() });
  }

  build();
  return {
    scene, camera, update, resize: () => fit(),
    autoplay(on) { auto = on; },
    restart() { auto = false; speed = 1; lvl = 0; build(); },
    takeover() { auto = false; if (G.over) { if (G.outcome === 'won') lvl = (lvl + 1) % LEVELS.length; build(); } },
    reloadLevel() { build(); },
    test: {
      set speed(v) { speed = v; },
      get state() {
        const onBelt = G.shooting.spots.filter(Boolean).length + G.pending + G.waiting.length;
        return { total: LEVELS.length, level: lvl + 1, over: G.over, result: G.outcome === 'won' ? 'win' : G.outcome === 'lost' ? 'lose' : null,
          progress: G.moves > 0 || G.ticks > 0 && G.voxels.remaining < G.total ? Math.max(1e-3, G.progress()) : 0, onBelt, auto, blocks: G.voxels.remaining, onTrack: bot.onTrack };
      },
      reset() { auto = false; speed = 1; lvl = 0; build(); },
      goto(i) { lvl = i; build(); },
      lose() { if (!G.over) { G.outcome = 'lost'; G.events.push({ type: 'lost' }); } },   // debug: the fail screen (Unity's DebugEndLevel)   // show level i (0-based) with the bot still in charge
      // The bot's next move as a real drag on the page (from the toy to where it goes).
      nextMove() {
        if (auto || G.over || drag || busy() || sinceMove < 0.6) return null;
        const st = bot.next(); if (!st) return null;
        const sh = G.shelves, fromSlot = st.from[1], left = sh.pairLeft(st.from[0], fromSlot);
        const toSlot = left >= 0 && fromSlot !== left ? st.to[1] + 1 : st.to[1];
        const a = screenOf(st.from[0], fromSlot), b = screenOf(st.to[0], toSlot);
        return a && b ? { drag: [a, b] } : null;
      },
    },
    destroy() {
      dead = true; ctx.el.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
      ctx.el.removeEventListener('pointerleave', onLeave); hud.remove(); disposeScene(scene);
    },
  };
  function screenOf(id, i) {
    const v = shelfViews.get(id); if (!v) return null;
    const p = v.g.position.clone().add(slotLocal(i)).add(new THREE.Vector3(0, 0.6, 0.6)).project(camera), r = ctx.el.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }
}
