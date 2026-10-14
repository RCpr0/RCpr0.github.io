// Toyland Go! renderer: the shipped plush toys (Meshy models, recoloured per colour by the game's tint mask), trays,
// capsules, scarves, chain links, ice and the voxel picture, the live levels and the shipped sounds. Rules, bots and
// attract pacing live in core.js. Shot and hit effects follow the shipped ProjectilePool / ArtParticles / VoxelView /
// CharacterRig: muzzle flick, glowing orb with a soft trail, contact flick, the hit voxel swells and pops into a ring,
// droplets and chips, its neighbours ripple and the model punches; the shooter turns to face its target, aims the
// blaster at it and kicks back on every shot.
import { Game, Bot, Pilot, TICK, colorOf, shapeOf, isEmpty, endPhase } from './core.js';
import { loadModel, loadTexture, tweenList, easeOutBack, easeInOut, easeOutCubic, disposeScene, gloss, matte, addRig, fitPerspective, hoverSprings } from '../common.js';

// Shipped levels, one per board mechanic in the order the game unlocks them, then the level that combines them all.
const LEVELS = [4, 12, 15, 22, 30, 34];
const MECHANIC = ['Sort 3, shoot the picture', 'New: capsules', 'New: scarf pairs', 'New: chains', 'New: ice', 'Capsules + scarves + chains + ice'];
const MODELS = ['Bear.json', 'Bunny.json', 'Cat.json', 'Chick.json'];   // shape ids 0..3, as the game's CharacterFactory
const SKINS = ['bear.webp', 'bunny.webp', 'cat.webp', 'chick.webp'], MASKS = ['bearmask.webp', 'bunnymask.webp', 'catmask.webp', 'chickmask.webp'];
const SOUNDS = { shot1: 'shot1.mp3', shot2: 'shot2.mp3', shot3: 'shot3.mp3', hit1: 'voxelhit1.mp3', hit2: 'voxelhit2.mp3', hit3: 'voxelhit3.mp3', merge: 'merge1.mp3',
  pick1: 'pick1.mp3', pick2: 'pick2.mp3', drop1: 'drop1.mp3', drop2: 'drop2.mp3', swap: 'swap.mp3', refused: 'refused.mp3', rejected: 'rejected.mp3', deploy: 'deploy.mp3', land: 'land.mp3', done: 'done.mp3',
  trayRemoved: 'trayremoved.mp3', trayReady: 'trayready.mp3', levelUp: 'levelup.mp3', levelFail: 'levelfail.mp3', click: 'click.mp3' };
// Layout (world units, about the shipped LayoutConfig's): three columns of trays, the dock row above, the voxel picture on top.
const COL_X = 3.6, ROW_Y = 2.74, SLOT_X = 1.008, OBJ_R = 3.1, OBJ_Y = 7.7, SHOOTER_S = 1.06, SWAP_R = 0.5, SNAP_R = 1.35;
// Per animal prefab scale (the models are normalised differently), then the layout's character scale 0.82 and height 1.12.
const PREFAB = [[1.5, 1.6, 1.5], [1.371, 1.371, 1.371], [1.3, 1.3, 1.3], [1.29, 1.29, 1.29]].map(([x, y, z]) => [x * 0.82, y * 0.82 * 1.12, z * 0.82]);
// Shipped ShooterConfig / HitEffects / CharacterRig values.
const SEAT_TILT = 16.25 * Math.PI / 180, FIRE_INTERVAL = 0.06, SHOT_SPEED = 40, FLIGHT = 0.35, TURN_RATE = 300 * Math.PI / 180, RECOIL = 0.10;
const BULLET = 0.34, ORB_R = 0.42, TRAIL_W = 0.81, TRAIL_LIFE = 0.1, WHITENESS = 0.196;
const POP_TIME = 0.12, POP_SCALE = 1.35, POP_FLASH = 0.45, RIPPLE_R = 3, RIPPLE_K = 0.15, RIPPLE_SWELL = 0.08, RIPPLE_T = 0.4, RIPPLE_WAVES = 1.5, PUNCH = 0.012;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
// Unity AnimationCurve stand-ins (keys from the shipped configs), piecewise smooth between keys.
const curve = keys => x => { if (x <= keys[0][0]) return keys[0][1]; for (let i = 1; i < keys.length; i++) if (x <= keys[i][0]) { const [x0, y0] = keys[i - 1], [x1, y1] = keys[i], t = (x - x0) / (x1 - x0); return y0 + (y1 - y0) * t * t * (3 - 2 * t); } return keys[keys.length - 1][1]; };
const CRACK_POP = curve([[0, 0], [.18, 1], [.45, .15], [.7, .35], [1, 0]]), CRACK_FLASH = curve([[0, 1], [.35, .25], [1, 0]]);
const COUNT_POP = curve([[0, 0], [.15, 1], [.4, -.15], [.65, .08], [1, 0]]), FREED_BOUNCE = curve([[0, 0], [.25, 1], [.55, -.3], [.8, .1], [1, 0]]);

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
  // The shipped feedbacks have cooldowns, so a volley is one sound, not twenty.
  const lastSfx = new Map();
  const sfx = (name, o, cool = 0) => { const now = performance.now(); if (cool && now - (lastSfx.get(name) || 0) < cool) return; lastSfx.set(name, now); play(name, o); };
  const pick = (...n) => n[Math.floor(Math.random() * n.length)];

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
  const fresnel = (m, edge, alpha) => { m.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `float fr = pow(1. - abs(dot(normalize(vNormal), normalize(vViewPosition))), 2.5);
    outgoingLight = mix(outgoingLight, vec3(${edge}), fr * .85); diffuseColor.a = mix(diffuseColor.a, ${alpha}, fr);
    #include <opaque_fragment>`); }; return m; };
  const glassMat = fresnel(new THREE.MeshPhysicalMaterial({ color: '#b2e0ff', transparent: true, opacity: 0.3, roughness: 0.04, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 2.5 }), '.92,.97,1.', '.9');
  const capBaseMat = gloss('#338cff', null, { roughness: 0.25 }), capFloorMat = gloss('#034be7', null, { roughness: 0.3 });
  const chainMat = gloss('#f2a51e', null, { metalness: 0.45, roughness: 0.28 });

  // ---- geometry helpers: centre models on their feet ----
  const footed = (m, part) => { const g = part.geometry.clone(); g.translate(-(m.min.x + m.max.x) / 2, -m.min.y, -(m.min.z + m.max.z) / 2); return g; };
  const toyGeo = toyModels.map(m => m.parts.map(p => ({ name: p.name, g: footed(m, p) })));
  const toyH = toyModels.map(m => m.size.y);
  const trayParts = trayM.parts.map(p => ({ mat: p.mat, g: footed(trayM, p) })), trayScale = 3.3 / trayM.size.x;
  const blasterParts = blasterM.parts.map(p => ({ mat: p.mat, g: p.geometry }));   // in the rig's Aim space: barrel along +z, muzzle at +0.37
  const capParts = capsuleM.parts.map(p => ({ name: p.name, g: footed(capsuleM, p) }));
  const linkGeo = linkM.parts[0].geometry;
  const voxelGeo = voxelM.parts[0].geometry;

  // A toy: g (placement) > yaw (turns to aim, as the rig's Yaw) > body (squash, recoil, hover), plus the aim pivot.
  function makeToy(kind, hex) {
    const shape = shapeOf(kind) % 4, g = new THREE.Group(), yaw = new THREE.Group(), body = new THREE.Group();
    for (const p of toyGeo[shape]) { const mesh = new THREE.Mesh(p.g, toyMat(shape, hex)); mesh.castShadow = true; body.add(mesh); }
    body.userData.base = new THREE.Vector3(...PREFAB[shape]); body.scale.copy(body.userData.base); yaw.add(body); g.add(yaw);
    g.userData = { body, yaw, kind, shape, hex, phase: Math.random() * 6.28 };
    return g;
  }
  // The rig's Aim pivot sits in front of the chest (shipped prefab: 0.88 up, 0.3 forward of a ~1.2 plush); the blaster
  // looks at the target from there and the shot leaves its Muzzle.
  function addBlaster(toy) {
    const shape = toy.userData.shape, h = toyH[shape] * PREFAB[shape][1] * SHOOTER_S;
    const aim = new THREE.Group(); aim.position.set(0, h * 0.5, 0.42 * PREFAB[shape][2] / 1.2); aim.userData.rest = aim.position.clone();
    const gun = new THREE.Group(); for (const p of blasterParts) { const m = new THREE.Mesh(p.g, blasterMats[p.mat] || blasterMats.teal); m.castShadow = true; gun.add(m); }
    gun.scale.setScalar(1.15); aim.add(gun);
    const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0, 0.37 * 1.15); aim.add(muzzle);
    toy.userData.yaw.add(aim); Object.assign(toy.userData, { aim, gun, muzzle });
  }
  // Small canvas labels: ammo numbers, the Waiting bubble and the ice count.
  function label(text, { w = 128, h = 64, size = 44, fill = '#ffffff', stroke = '#123c8c', bubble = false, depthTest = false } = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest }));
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
  let lvl = 0, G, bot, pilot, auto = false, speed = 1, acc = 0, endTimer = 0, sinceMove = 0, endGen = 0;
  let root, voxGroup, voxMesh, voxVis, voxRendered, voxBase, shelfViews, charAt, padViews, shooters, chains, objCentre, objScale, ices, lanes;
  let flights = [], dying = [], ripples = [], thaw = new Map(), touched = new Set(), punchAge = 10;
  const hud = document.createElement('div'); hud.className = 'arcade-count'; ctx.ui.append(hud);
  const tag = document.createElement('div');
  Object.assign(tag.style, { position: 'absolute', left: '50%', top: '76px', transform: 'translateX(-50%)', pointerEvents: 'none', whiteSpace: 'nowrap', font: "400 11px/1 'Russo One', system-ui, sans-serif",
    letterSpacing: '.06em', textTransform: 'uppercase', color: '#fff', background: '#3f5fd0cc', padding: '5px 10px', borderRadius: '999px' });
  ctx.ui.append(tag);

  // =================================================================================================================
  // Particles (ArtParticles): camera-facing sprites per texture, rounded voxel chips, glowing orbs and soft trails.
  // =================================================================================================================
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _c = new THREE.Color();
  const pxScale = () => (ctx.el.clientHeight || 1) * ctx.renderer.getPixelRatio() * camera.projectionMatrix.elements[5] / 2;
  const SPRITE_VS = `attribute vec4 acolor; attribute float asize; attribute float arot; uniform float uScale; varying vec4 vC; varying float vR;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; gl_PointSize = asize * uScale / max(.01, -mv.z); vC = acolor; vR = arot; }`;
  function spriteSystem(map, max, frag) {
    const geo = new THREE.BufferGeometry(), A = (n, k) => new THREE.BufferAttribute(new Float32Array(n * k), k).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', A(max, 3)); geo.setAttribute('acolor', A(max, 4)); geo.setAttribute('asize', A(max, 1)); geo.setAttribute('arot', A(max, 1));
    const mat = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, uScale: { value: 1 } }, transparent: true, depthWrite: false, toneMapped: false, vertexShader: SPRITE_VS,
      fragmentShader: frag || `uniform sampler2D map; varying vec4 vC; varying float vR;
        void main(){ vec2 q = gl_PointCoord - .5; float c = cos(vR), s = sin(vR); q = mat2(c, -s, s, c) * q + .5;
          vec4 t = texture2D(map, vec2(q.x, 1. - q.y)); vec4 o = t * vC; o.a *= max(t.r, max(t.g, t.b)); if (o.a < .004) discard; gl_FragColor = o;
          #include <colorspace_fragment>
        }` });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 30; scene.add(pts);
    const list = [];
    return { list, mat, emit(p) { if (list.length >= max) list.shift(); list.push(p); },
      update(dt) {
        const P = geo.attributes.position.array, C = geo.attributes.acolor.array, S = geo.attributes.asize.array, R = geo.attributes.arot.array; let n = 0;
        for (let k = list.length - 1; k >= 0; k--) {
          const p = list[k]; p.t += dt; if (p.t >= p.life) { list.splice(k, 1); continue; }
          if (p.grav) p.v.y -= p.grav * dt; p.p.addScaledVector(p.v, dt); p.r += p.rv * dt;
          const u = p.t / p.life, a = p.fade ? p.fade(u) : (u < .25 ? 1 : 1 - (u - .25) / .75);
          P[n * 3] = p.p.x; P[n * 3 + 1] = p.p.y; P[n * 3 + 2] = p.p.z; C[n * 4] = p.c.r; C[n * 4 + 1] = p.c.g; C[n * 4 + 2] = p.c.b; C[n * 4 + 3] = p.a * a;
          S[n] = p.size * (p.curve ? p.curve(u) : .55 + .75 * smooth(0, 1, u)); R[n] = p.r; n++;
        }
        geo.setDrawRange(0, n); for (const k of ['position', 'acolor', 'asize', 'arot']) geo.attributes[k].needsUpdate = true;
        mat.uniforms.uScale.value = pxScale();
      },
      clear() { list.length = 0; } };
  }
  const sparkFx = spriteSystem(sparkTex, 900), ringFx = spriteSystem(ringTex, 200), dustFx = spriteSystem(glowTex, 600), dropFx = spriteSystem(glowTex, 900);
  // The bullet head: GoodSort/Shot Orb drawn procedurally (core, colour body, bubble rim, glint, soft glow).
  const orbFx = spriteSystem(null, 300, `varying vec4 vC; varying float vR;
    void main(){ vec2 q = (gl_PointCoord - .5) * 2.; q.y = -q.y; float r = length(q); const float R = ${ORB_R.toFixed(2)};
      vec3 c = vC.rgb; float inside = 1. - smoothstep(R - .04, R, r); float t = clamp(r / R, 0., 1.);
      vec3 orb = mix(mix(c, vec3(1.), .55), c, smoothstep(0., .7, t)); orb = mix(orb, mix(c, vec3(1.), .6), smoothstep(.65, 1., t) * .45);
      float glint = 1. - smoothstep(.06, .16, length(q - vec2(-.35, .4) * R)); orb = mix(orb, vec3(1.), glint * .85);
      float glow = pow(clamp(1. - (r - R) / (1. - R), 0., 1.), 2.2) * .6 * step(R - .04, r);
      gl_FragColor = vec4(mix(mix(c, vec3(1.), .25), orb, inside), max(inside, glow) * vC.a); if (gl_FragColor.a < .004) discard;
      #include <colorspace_fragment>
    }`);
  // Chips: the game's own rounded voxel, lit, tumbling under gravity.
  const CHIPS = 500, chipMesh = new THREE.InstancedMesh(voxelGeo, new THREE.MeshStandardMaterial({ roughness: 0.45 }), CHIPS), chips = [];
  chipMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); chipMesh.frustumCulled = false; chipMesh.count = 0; scene.add(chipMesh);
  for (let i = 0; i < CHIPS; i++) chipMesh.setColorAt(i, _c.set('#fff'));
  const WHITE = new THREE.Color(1, 1, 1);
  const lit = (hex, k) => new THREE.Color(hex).lerp(new THREE.Color(1, 1, 1), k);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const inSphere = () => { let v; do v = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)); while (v.lengthSq() > 1); return v; };
  const onSphere = () => inSphere().normalize();
  const sparkle = p => { p.rv = rnd(-4, 4); return p; };
  // ArtParticles.Emit: a soft spray, nudged toward the camera (+z here) and up.
  function emit(sys, at, color, count, spd, size, life, { alpha = 1, grav = 0, curve: cv = null } = {}) {
    for (let i = 0; i < count; i++) { const d = inSphere(); d.z = Math.abs(d.z) * .6; d.y += .45;
      sys.emit(sparkle({ p: at.clone().add(inSphere().multiplyScalar(.035)), v: d.multiplyScalar(spd), c: color.clone ? color.clone() : color, a: alpha, size: size * rnd(.65, 1.2), life: life * rnd(.75, 1.2), t: 0, r: rnd(0, 6.28), grav, curve: cv })); }
  }
  // ArtParticles.Burst: all round, a little toward the camera.
  function burstFx(sys, at, color, count, spd, size, life, { grav = 0, curve: cv = null } = {}) {
    for (let i = 0; i < count; i++) { const d = onSphere(); d.z += .35; d.y += .25; d.normalize();
      sys.emit(sparkle({ p: at.clone().addScaledVector(d, size * .5), v: d.clone().multiplyScalar(spd * rnd(.7, 1.15)), c: color.clone(), a: 1, size: size * rnd(.7, 1.25), life: life * rnd(.8, 1.2), t: 0, r: rnd(0, 6.28), grav, curve: cv })); }
  }
  function chipBurst(at, hex, count, spd, size, life, { all = true, grav = 9.81 } = {}) {
    for (let i = 0; i < count; i++) {
      const d = all ? onSphere() : inSphere(); if (all) { d.z += .35; d.y += .25; d.normalize(); } else { d.z = Math.abs(d.z) * .6; d.y += .45; }
      if (chips.length >= CHIPS) chips.shift();
      chips.push({ p: at.clone().addScaledVector(d, all ? size * .5 : 0), v: d.multiplyScalar(spd * (all ? rnd(.7, 1.15) : 1)), c: new THREE.Color(hex), size: size * rnd(.7, 1.25), life: life * rnd(.8, 1.2), t: 0, rot: new THREE.Euler(rnd(0, 6), rnd(0, 6), rnd(0, 6)), grav });
    }
  }
  const DROP_CURVE = curve([[0, 1], [.6, .8], [1, 0]]), CHIP_CURVE = u => 1 - .75 * u;
  const FX = {
    // bullet contact: a quick bright flick (then the voxel swells and pops)
    impact(at, hex) { emit(sparkFx, at, lit(hex, .6), 2, 1.1, .2, .16); emit(dustFx, at, lit(hex, .8), 1, 0, .32, .06); },
    pop(at, hex, cell) {
      const c = new THREE.Color(hex);
      emit(ringFx, at, lit(hex, .35), 1, 0, cell * 2.4, .2, { alpha: .9 });
      emit(dustFx, at, lit(hex, .7), 1, 0, cell * 1.9, .08);
      burstFx(dropFx, at, lit(hex, .15), 8, cell * 9, cell * .34, .36, { grav: .55 * 9.81, curve: DROP_CURVE });
      chipBurst(at, c, 4, cell * 7, cell * .4, .45);
      emit(sparkFx, at, lit(hex, .75), 2, cell * 4, cell * .6, .2);
    },
    muzzle(at, dir, hex) { sparkFx.emit({ p: at.clone(), v: dir.clone().multiplyScalar(.9), c: lit(hex, .75), a: 1, size: .34, life: .075, t: 0, r: rnd(0, 6.28), rv: 0 }); },
    merge(at, hex) { emit(ringFx, at, lit(hex, .5), 1, 0, 1.25, .38); emit(sparkFx, at, new THREE.Color(hex), 16, 2.4, .2, .62); emit(dustFx, at, new THREE.Color(1, .92, .7), 4, .5, .35, .35, { alpha: .55 }); },
    land(at) { emit(ringFx, at, new THREE.Color(.45, .85, 1), 1, 0, .85, .3, { alpha: .5 }); emit(dustFx, at, new THREE.Color(.65, .82, .96), 6, .7, .28, .4, { alpha: .32 }); },
    exit(at) { emit(ringFx, at, new THREE.Color(.55, .85, 1), 1, 0, .95, .28, { alpha: .65 }); emit(sparkFx, at, new THREE.Color(.8, .94, 1), 5, 1.15, .18, .32); },
    sparkle(at, hex, n) { emit(sparkFx, at, lit(hex, .25), n, 1.6, .2, .55); },
    iceCrack(at, cell) { const c = new THREE.Color(.72, .95, 1); chipBurst(at, c, 8, cell * 6, cell * .3, .4); emit(dustFx, at, new THREE.Color(.85, .97, 1), 2, cell * 1.5, cell * 1.6, .3, { alpha: .45 }); emit(sparkFx, at, new THREE.Color(1, 1, 1), 6, cell * 5, cell * .5, .35); },
    iceShatter(at, size) { chipBurst(at, new THREE.Color(.72, .95, 1), Math.min(60, Math.max(18, Math.round(size * 6))), 4.2, .16, .55, { all: false }); emit(sparkFx, at, new THREE.Color(1, 1, 1), 12, 3, .22, .4); emit(dustFx, at, new THREE.Color(.8, .96, 1), 5, .8, .5, .5, { alpha: .5 }); },
    celebrate(center) { for (let i = 0; i < 7; i++) { const c = new THREE.Color().setHSL(i / 7, .85, .6); chipBurst(center.clone().add(new THREE.Vector3((i - 3) * .8, 0, 2)), c, 18, 4, .12, 2.8, { all: false }); emit(sparkFx, center, c, 4, 3, .2, 1.2); } },
  };
  function updateChips(dt) {
    let n = 0;
    for (let k = chips.length - 1; k >= 0; k--) {
      const p = chips[k]; p.t += dt; if (p.t >= p.life) { chips.splice(k, 1); continue; }
      p.v.y -= p.grav * dt; p.p.addScaledVector(p.v, dt); p.rot.x += 5.4 * dt; p.rot.y += 4 * dt; p.rot.z += 1.7 * dt;
      chipMesh.setMatrixAt(n, _m.compose(p.p, _q.setFromEuler(p.rot), _s.setScalar(p.size * CHIP_CURVE(p.t / p.life)))); chipMesh.setColorAt(n, p.c); n++;
    }
    chipMesh.count = n; chipMesh.instanceMatrix.needsUpdate = true; if (chipMesh.instanceColor) chipMesh.instanceColor.needsUpdate = true;
  }
  // Bullet trails (GoodSort/Shot): a camera-facing ribbon as wide as the orb at the head, tapering to the tail; soft
  // across, a bright core line, fading toward the tail. Eight samples per trail, back along the flight line.
  const TRAIL_N = 8, TRAILS = 300, trailGeo = new THREE.BufferGeometry();
  {
    const V = TRAILS * TRAIL_N * 2, idx = [];
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(V * 3), 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setAttribute('acolor', new THREE.BufferAttribute(new Float32Array(V * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(V * 2);
    for (let s = 0; s < TRAILS; s++) for (let i = 0; i < TRAIL_N; i++) { const b = (s * TRAIL_N + i) * 2; uv.set([i / (TRAIL_N - 1), 0, i / (TRAIL_N - 1), 1], b * 2); if (i < TRAIL_N - 1) idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    trailGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); trailGeo.setIndex(idx);
  }
  const trailMesh = new THREE.Mesh(trailGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    vertexShader: 'attribute vec4 acolor; varying vec4 vC; varying vec2 vUv; void main(){ vC = acolor; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: `varying vec4 vC; varying vec2 vUv;
      void main(){ float across = 1. - abs(vUv.y * 2. - 1.); float body = smoothstep(0., .7, across); float core = smoothstep(.7, 1., across) * .55;
        float along = pow(clamp(1. - vUv.x, 0., 1.), 1.6); gl_FragColor = vec4(mix(vC.rgb, vec3(1.), core), vC.a * body * along);
        #include <colorspace_fragment>
      }` }));
  trailMesh.frustumCulled = false; trailMesh.renderOrder = 29; scene.add(trailMesh);
  const trailWidth = u => { const u2 = u * u, u3 = u2 * u; return Math.max(0, (2 * u3 - 3 * u2 + 1) + (u3 - 2 * u2 + u) * -.6 + (u3 - u2) * -1.4); };
  const _side = new THREE.Vector3(), _dir = new THREE.Vector3(), _cam = new THREE.Vector3(), _tp = new THREE.Vector3();
  function drawTrails() {
    const P = trailGeo.attributes.position.array, C = trailGeo.attributes.acolor.array; let s = 0;
    camera.getWorldPosition(_cam);
    for (const f of flights) {
      if (s >= TRAILS) break;
      // the tail never reaches behind the muzzle; after the hit it closes up onto the voxel
      const len = Math.min(SHOT_SPEED * TRAIL_LIFE, f.travelled) * (f.done ? Math.max(0, 1 - f.after / .045) : 1);
      _dir.copy(f.p).sub(f.prev); if (_dir.lengthSq() < 1e-8) _dir.copy(f.dir); _dir.normalize(); f.dir.copy(_dir);
      _side.copy(_cam).sub(f.p).cross(_dir).normalize();
      for (let i = 0; i < TRAIL_N; i++) {
        const u = i / (TRAIL_N - 1), w = BULLET * TRAIL_W * .5 * trailWidth(u), b = (s * TRAIL_N + i) * 2;
        _tp.copy(f.p).addScaledVector(_dir, -len * u);
        P.set([_tp.x + _side.x * w, _tp.y + _side.y * w, _tp.z + _side.z * w, _tp.x - _side.x * w, _tp.y - _side.y * w, _tp.z - _side.z * w], b * 3);
        const a = 1 - u; C.set([f.col.r, f.col.g, f.col.b, a, f.col.r, f.col.g, f.col.b, a], b * 4);
      }
      s++;
    }
    trailGeo.setDrawRange(0, s * (TRAIL_N - 1) * 6); trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.acolor.needsUpdate = true;
  }
  const clearFx = () => { for (const f of [sparkFx, ringFx, dustFx, dropFx, orbFx]) f.clear(); chips.length = 0; flights = []; dying = []; ripples = []; thaw.clear(); touched.clear(); };

  // ---- building a level ----
  const colX = c => (c - 1) * COL_X, rowY = r => -r * ROW_Y;
  function build() {
    if (voxMesh) { voxMesh.material.dispose(); voxMesh.dispose(); }
    if (ices) for (const s of ices) { s.mesh?.geometry.dispose(); s.mat.dispose(); }
    if (root) world.remove(root);   // models, materials and textures are shared across levels
    tweens.clear(); hov.clear(); ctx.hideResult(); clearFx();
    acc = 0; endTimer = 0; sinceMove = 0; drag = null; held = null; endGen++;
    G = new Game(levels[lvl]); bot = new Bot(G); pilot = new Pilot(G, bot);
    root = new THREE.Group(); world.add(root);
    const L = G.level, R = G.view.radius;
    objScale = OBJ_R / R; objCentre = new THREE.Vector3(0, OBJ_Y, -G.view.muzzles[0][2] * objScale);
    // Lanes: one frosted glass panel per column with the queue's arrows on top.
    lanes = [];
    for (let c = 0; c < 3; c++) {
      const top = rowY(0) + 2.05, bottom = rowY(2) - 0.85, lane = new THREE.Mesh(nineSlice(3.5, top - bottom), laneMat);
      lane.position.set(colX(c) - 1.75, bottom, -1.05); lane.renderOrder = -1; root.add(lane);
      const ars = [0, 1].map(k => { const a = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.42), new THREE.MeshBasicMaterial({ map: arrowsTex, transparent: true, depthWrite: false, toneMapped: false })); a.position.set(colX(c), top - 0.5, -1.0); a.userData.k = k; root.add(a); return a; });
      lanes.push({ lane, ars, top });
    }
    // Dock pads, exactly where the rules aim from.
    padViews = G.view.muzzles.map((m, i) => {
      const g = new THREE.Group(); g.position.set(m[0] * objScale, objCentre.y + G.view.dockY * objScale, 0);
      const tilt = new THREE.Group(); tilt.rotation.x = 16.25 * Math.PI / 180;
      const rim = new THREE.Mesh(padCyl, padMat.rim); rim.scale.set(1.656, 0.151 * 2, 1.656);
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
    voxVis = V.clone(); voxRendered = new Uint8Array(V.n); voxBase = new Float32Array(V.n * 3);
    for (let i = 0; i < V.n; i++) { const c = V.cell(i), ctr = G.view.centre; voxBase.set([c[0] - ctr[0], c[1] - ctr[1], -(c[2] - ctr[2])], i * 3); }
    for (let i = 0; i < V.n; i++) voxMesh.setColorAt(i, _c.set(L.voxelColors[V.colors[i]] || '#ccc'));
    for (let i = 0; i < V.n; i++) refreshVoxel(i);
    voxGroup.add(voxMesh); voxGroup.quaternion.fromArray(G.view.q);
    buildIce();
    // Shelves.
    shelfViews = new Map(); charAt = new Map(); chains = [];
    for (let c = 0; c < 3; c++) G.shelves.cols[c].forEach((s, r) => {
      const v = makeShelf(s); v.g.position.set(colX(c), r < 3 ? rowY(r) : rowY(3) - 1, 0); v.g.visible = r < 3; shelfViews.set(s.id, v);
    });
    for (const s of G.shelves.byId.values()) if (s.partner > s.id) addChain(s.id, s.partner);
    root.traverse(o => { if (o.isMesh && o !== voxMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
    tag.textContent = MECHANIC[lvl] || '';
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
    const curve3 = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.52, 0.8, 0.42), new THREE.Vector3(-0.2, 0.52, 0.62), new THREE.Vector3(0.2, 0.52, 0.62), new THREE.Vector3(0.52, 0.8, 0.42)]);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve3, 24, 0.115, 10), scarfMat); m.castShadow = true;
    m.position.copy(slotLocal(left)).add(new THREE.Vector3(SLOT_X / 2, 0, 0)); v.g.add(m); v.scarf = { m, left };
  }
  // Chains link two cubbies; once both merge and deploy, the chain rides up with the pair and hooks their ankles on the
  // dock, then snaps when both have fired their last shot.
  function addChain(a, b) {
    const g = new THREE.Group(); for (let k = 0; k < 7; k++) { const l = new THREE.Mesh(linkGeo, chainMat); l.rotation.x = k % 2 ? Math.PI / 2 : 0; l.scale.setScalar(0.7); l.castShadow = true; g.add(l); }
    root.add(g); chains.push({ a, b, g, dock: null });
  }
  const _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
  function placeChains() {
    for (const ch of [...chains]) {
      if (ch.dock) {
        const A = shooters.get(ch.dock[0]), B = shooters.get(ch.dock[1]);
        if (!A || !B || A.leaving || B.leaving) { breakChain(ch); continue; }
        A.toy.getWorldPosition(_pa).add(_v.set(0, 0.28, 0.25)); B.toy.getWorldPosition(_pb).add(_v.set(0, 0.28, 0.25));
        const dx = Math.sign(_pb.x - _pa.x) || 1; _pa.x += dx * 0.32; _pb.x -= dx * 0.32;
        ch.g.visible = true; drawChain(ch, _pa, _pb, 0.35); continue;
      }
      const A = shelfViews.get(ch.a), B = shelfViews.get(ch.b);
      const alive = G.shelves.exists(ch.a) && G.shelves.exists(ch.b) && G.shelves.partnerOf(ch.a) === ch.b;
      if (!A || !B || !alive) { if (!ch.waiting) breakChain(ch); continue; }
      _pa.copy(A.g.position).add(_v.set(1.55, 0.2, 0.5)); _pb.copy(B.g.position).add(_v.set(-1.55, 0.2, 0.5));
      if (_pa.x > _pb.x) { _pa.x -= 3.1; _pb.x += 3.1; }
      ch.g.visible = A.g.visible && B.g.visible; drawChain(ch, _pa, _pb, 0.25);
    }
  }
  function drawChain(ch, pa, pb, sag) { ch.g.children.forEach((l, k) => { const t = (k + 0.5) / ch.g.children.length; l.position.lerpVectors(pa, pb, t); l.position.y -= Math.sin(t * Math.PI) * sag; }); }
  function breakChain(ch) {
    if (ch.gone) return; ch.gone = true; chains = chains.filter(x => x !== ch);
    ch.g.children.forEach(l => { const v = new THREE.Vector3((Math.random() - 0.5) * 3, 3 + Math.random() * 2, 2); const p0 = l.position.clone(); tweens.add(0.7, t => { l.position.copy(p0).addScaledVector(v, t); l.position.y -= 9 * t * t; l.rotation.z += 0.2; }, x => x); });
    tweens.add(0.75, () => {}, x => x, () => root.remove(ch.g)); sfx('trayRemoved', { rate: 1.3, volume: 0.4 });
  }

  // Shelves slide to their column places; ones coming up from the queue rise in from below.
  let layoutDirty = false;
  function layout(instant = false) {
    if (drag || held) { layoutDirty = true; return; }
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

  // =================================================================================================================
  // Voxels (VoxelView): instanced shell; a hit voxel swells and flashes, then pops; neighbours ripple; the model punches.
  // =================================================================================================================
  function setVoxelMatrix(i, scale, dx = 0, dy = 0, dz = 0) {
    _m.makeScale(scale, scale, scale); _m.setPosition(voxBase[i * 3] + dx, voxBase[i * 3 + 1] + dy, voxBase[i * 3 + 2] + dz);
    voxMesh.setMatrixAt(i, _m); voxMesh.instanceMatrix.needsUpdate = true;
  }
  function refreshVoxel(i) {
    const show = voxVis.alive[i] && (voxVis.hasFreeFace(i) || voxVis.isNearSurface(i));
    if (show === !!voxRendered[i]) return; voxRendered[i] = show ? 1 : 0;
    setVoxelMatrix(i, show ? 1 : 0);
  }
  function revealAround(i) {
    const c = voxVis.cell(i);
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const j = voxVis.indexOf(c[0] + dx, c[1] + dy, c[2] + dz); if (j >= 0) refreshVoxel(j); }
  }
  // The bullet arrived: the voxel leaves the visible model (what was behind it shows) and swells in place, then pops.
  function hitVoxel(i) {
    if (!voxVis.alive[i]) return;
    voxVis.destroy(i); voxRendered[i] = 0; revealAround(i);
    dying.push({ i, t: 0 }); punchAge = 0;
    for (const s of ices) if (s.hp > 0 && s.near(i)) s.dirty = true;
  }
  const voxelWorld = (i, out = new THREE.Vector3()) => voxGroup.localToWorld(out.set(voxBase[i * 3], voxBase[i * 3 + 1], voxBase[i * 3 + 2]));
  const voxelHex = i => G.level.voxelColors[G.voxels.colors[i]] || '#cccccc';
  function animateVoxels(dt) {
    const cell = objScale;
    for (let k = dying.length - 1; k >= 0; k--) {
      const d = dying[k]; d.t += dt; const t = Math.min(1, d.t / POP_TIME);
      if (t >= 1) {
        setVoxelMatrix(d.i, 0); voxMesh.setColorAt(d.i, _c.set(voxelHex(d.i))); voxMesh.instanceColor.needsUpdate = true;
        FX.pop(voxelWorld(d.i), voxelHex(d.i), cell * POP_SCALE);
        ripples.push({ c: voxBase.slice(d.i * 3, d.i * 3 + 3), t: 0 });
        dying.splice(k, 1); continue;
      }
      const swell = 1 + (POP_SCALE - 1) * (1 - (1 - t) * (1 - t));
      setVoxelMatrix(d.i, swell); voxMesh.setColorAt(d.i, _c.set(voxelHex(d.i)).lerp(WHITE, POP_FLASH * Math.sin(t * Math.PI / 2))); voxMesh.instanceColor.needsUpdate = true;
    }
    // ripple (render only): neighbours pushed out from each pop and swelling as the wave passes, then springing back
    for (let k = ripples.length - 1; k >= 0; k--) { ripples[k].t += dt; if (ripples[k].t >= RIPPLE_T) ripples.splice(k, 1); }
    for (const [i, a] of thaw) { if (a + dt >= .45) thaw.delete(i); else thaw.set(i, a + dt); }
    const now = new Map();
    if (ripples.length) {
      const R2 = RIPPLE_R * RIPPLE_R, ctr = G.view.centre;
      for (const r of ripples) {
        const t = r.t / RIPPLE_T, env = (1 - t) * (1 - t), cx = Math.round(r.c[0] + ctr[0]), cy = Math.round(r.c[1] + ctr[1]), cz = Math.round(-r.c[2] + ctr[2]);
        for (let z = -RIPPLE_R; z <= RIPPLE_R; z++) for (let y = -RIPPLE_R; y <= RIPPLE_R; y++) for (let x = -RIPPLE_R; x <= RIPPLE_R; x++) {
          const d2 = x * x + y * y + z * z; if (d2 < .01 || d2 > R2) continue;
          const j = voxVis.indexOf(cx + x, cy + y, cz + z); if (j < 0 || !voxRendered[j] || frozenVoxel[j]) continue;
          const dist = Math.sqrt(d2), fall = 1 - smooth(0, 1, (dist - 1) / (RIPPLE_R - 1)), amount = fall * env * Math.sin(t * Math.PI * 2 * RIPPLE_WAVES - (dist - 1) * .9);
          let o = now.get(j); if (!o) now.set(j, o = [0, 0, 0, 0]);
          // offsets in the voxel group's local frame (z mirrored like voxBase)
          o[0] += x / dist * RIPPLE_K * amount; o[1] += y / dist * RIPPLE_K * amount; o[2] -= z / dist * RIPPLE_K * amount; o[3] += RIPPLE_SWELL * amount;
        }
      }
    }
    for (const [i, a] of thaw) if (voxRendered[i]) { let o = now.get(i); if (!o) now.set(i, o = [0, 0, 0, 0]); o[4] = FREED_BOUNCE(a / .45) * .22; }
    for (const i of touched) if (!now.has(i) && voxRendered[i]) setVoxelMatrix(i, 1);
    const cap = RIPPLE_K * 1.5;
    for (const [i, o] of now) {
      const l = Math.hypot(o[0], o[1], o[2]), k = l > cap ? cap / l : 1, sw = Math.max(-RIPPLE_SWELL * 1.5, Math.min(RIPPLE_SWELL * 1.5, o[3]));
      setVoxelMatrix(i, (1 + sw) * (1 + (o[4] || 0)), o[0] * k, o[1] * k, o[2] * k);
    }
    touched = new Set(now.keys());
    punchAge += dt;
    voxGroup.scale.setScalar(objScale * (1 + PUNCH * Math.exp(-punchAge * 18) * Math.cos(punchAge * 38)));
  }

  // =================================================================================================================
  // Ice (IceSectionView): a soft-blue see-through coat over each frozen block, a big count; every merge cracks it
  // (pop, flash, chips, number pop); at 0 it shakes, shatters into shards and the freed voxels bounce.
  // =================================================================================================================
  let frozenVoxel = new Uint8Array(0);
  function buildIce() {
    ices = []; frozenVoxel = new Uint8Array(G.voxels.n);
    G.shooting.frozen.forEach((f, k) => {
      if (f.hp <= 0 || !f.voxels.length) return;
      const set = new Set(f.voxels); for (const i of f.voxels) frozenVoxel[i] = 1;
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const i of f.voxels) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], voxBase[i * 3 + a]); mx[a] = Math.max(mx[a], voxBase[i * 3 + a]); }
      const centre = new THREE.Vector3((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2), half = new THREE.Vector3((mx[0] - mn[0]) / 2 + .6, (mx[1] - mn[1]) / 2 + .6, (mx[2] - mn[2]) / 2 + .6);
      const mat = iceMaterial();
      const pivot = new THREE.Group(); pivot.position.copy(centre); voxGroup.add(pivot);
      const num = label(String(f.hp), { w: 160, h: 128, size: 92, stroke: '#0f2e7a' }); num.renderOrder = 40; root.add(num);
      const s = { k, set, mat, pivot, half, centre, num, hp: f.hp, start: f.hp, mesh: null, dirty: true, crack: 9, shake: -1, alpha: 1,
        near: i => { const b = i * 3; return voxBase[b] >= mn[0] - 1.5 && voxBase[b] <= mx[0] + 1.5 && voxBase[b + 1] >= mn[1] - 1.5 && voxBase[b + 1] <= mx[1] + 1.5 && voxBase[b + 2] >= mn[2] - 1.5 && voxBase[b + 2] <= mx[2] + 1.5; } };
      ices.push(s);
    });
  }
  // GoodSort/Ice Section, simplified: soft-blue see-through body, frosty white rims on every cell face, a fresnel edge,
  // a diagonal shine streak, lit from above; uFlash whitens it on a crack.
  function iceMaterial() {
    return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, uniforms: { uFlash: { value: 0 } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uFlash; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vec3 n = normalize(vN); float e = min(min(vUv.x, 1. - vUv.x), min(vUv.y, 1. - vUv.y));
          float rim = 1. - smoothstep(.0, .13, e); float fr = pow(1. - abs(dot(n, normalize(vV))), 2.);
          float streak = (1. - smoothstep(.0, .07, abs(vUv.x + vUv.y * .55 - .62))) * .55 + (1. - smoothstep(.0, .03, abs(vUv.x + vUv.y * .55 - .9))) * .35;
          vec3 col = vec3(.52, .82, 1.) * (.82 + .28 * max(n.y, 0.) + .1 * n.z);
          col = mix(col, vec3(.96, .99, 1.), clamp(rim * .75 + fr * .45 + streak, 0., 1.));
          col = mix(col, vec3(1.), uFlash);
          gl_FragColor = vec4(col, clamp(.5 + rim * .4 + fr * .25 + streak * .3 + uFlash * .3, 0., .95));
          #include <colorspace_fragment>
        }` });
  }
  // The coat: the frozen voxels' open faces pushed out by a tenth of a cell, so it follows their blocky outline.
  const ICE_T = 0.1, FACE = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function rebuildCoat(s) {
    s.dirty = false; const pos = [], nrm = [], uvs = [], faces = s.faces = [], ctr = G.view.centre, V = voxVis;
    const frozenAlive = (x, y, z) => { const j = V.indexOf(x, y, z); return j >= 0 && V.alive[j] && s.set.has(j); };
    for (const i of s.set) {
      if (!V.alive[i]) continue;
      const [cx, cy, cz] = V.cell(i);
      for (const [nx, ny, nz] of FACE) {
        const j = V.indexOf(cx + nx, cy + ny, cz + nz); if (j >= 0 && V.alive[j]) continue;   // covered by a voxel: the coat would never show
        // the face's two tangent axes; each edge reaches out over the coat thickness where no frozen neighbour continues it
        const n = [nx, ny, nz], ax = nx ? [1, 2] : ny ? [0, 2] : [0, 1], ext = [];
        for (const a of ax) for (const sgn of [-1, 1]) { const d = [0, 0, 0]; d[a] = sgn; ext.push(frozenAlive(cx + d[0], cy + d[1], cz + d[2]) ? .5 : .5 + ICE_T); }
        const o = [cx - ctr[0] + nx * (.5 + ICE_T), cy - ctr[1] + ny * (.5 + ICE_T), cz - ctr[2] + nz * (.5 + ICE_T)];
        const corner = (su, sv) => { const p = o.slice(); p[ax[0]] += su < 0 ? -ext[0] : ext[1]; p[ax[1]] += sv < 0 ? -ext[2] : ext[3]; return [p[0] - s.centre.x, p[1] - s.centre.y, -p[2] - s.centre.z]; };
        const q = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
        const QUV = [[0, 0], [1, 0], [1, 1], [0, 1]];
        for (const t of [0, 1, 2, 0, 2, 3]) { pos.push(...q[t]); nrm.push(n[0], n[1], -n[2]); uvs.push(...QUV[t]); }
        faces.push(n[0], n[1], -n[2]);
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (s.mesh) { s.mesh.geometry.dispose(); s.mesh.geometry = g; } else { s.mesh = new THREE.Mesh(g, s.mat); s.mesh.renderOrder = 6; s.pivot.add(s.mesh); }
  }
  function onIce(e) {
    const s = ices.find(x => x.k === e.section); if (!s) return;
    if (e.type === 'iceCracked') {
      s.hp = e.hp; s.crack = 0; if (s.hp > 0) s.num.userData.set(String(s.hp));
      FX.iceCrack(s.pivot.getWorldPosition(new THREE.Vector3()).addScaledVector(camDir(), s.half.length() * objScale * .5), objScale);
      sfx(pick('hit1', 'hit2', 'hit3'), { volume: 0.5, rate: 0.7 });
    } else { s.hp = 0; s.shake = 0; }
  }
  const camDir = () => _cam.copy(camera.position).sub(objCentre).normalize();
  function animateIce(dt) {
    for (const s of ices) {
      if (!s.mesh && s.shake < 0 && s.hp > 0) rebuildCoat(s);
      if (!s.pivot.parent) continue;
      if (s.dirty && s.shake < 0) rebuildCoat(s);
      let sc = 1, flash = 0;
      if (s.crack < 1) { s.crack = Math.min(1, s.crack + dt / .4); sc += CRACK_POP(s.crack) * .07; flash = CRACK_FLASH(s.crack) * .6; }
      s.pivot.position.copy(s.centre);
      if (s.shake >= 0) {
        s.shake += dt; const u = Math.min(1, s.shake / .2); flash = Math.max(flash, smooth(0, 1, u) * .7);
        s.pivot.position.add(_v.set(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(.08));
        if (u >= 1) {   // break: shards, sparkles, the freed voxels bounce
          const at = s.pivot.getWorldPosition(new THREE.Vector3()); voxGroup.remove(s.pivot); root.remove(s.num);
          FX.iceShatter(at, s.half.length() * objScale); sfx('trayRemoved', { volume: 0.7, rate: 0.85 }); ctx.shake(0.35);
          for (const i of s.set) if (voxVis.alive[i]) { thaw.set(i, 0); frozenVoxel[i] = 0; }
          continue;
        }
      }
      s.pivot.scale.setScalar(sc); s.mat.uniforms.uFlash.value = flash;
      // the count faces the camera just in front of the block, popping on each crack; it fades while the block is round the back
      const w = s.pivot.getWorldPosition(new THREE.Vector3()), dir = camDir();
      // shown while some of the coat faces us (IceSeen), faded while the block is all inside or round the back
      _w.copy(dir).applyQuaternion(_q.copy(voxGroup.quaternion).invert()); let seen = false;
      for (let f = 0; f < (s.faces?.length || 0) && !seen; f += 3) if (s.faces[f] * _w.x + s.faces[f + 1] * _w.y + s.faces[f + 2] * _w.z > .3) seen = true;
      s.alpha += ((seen ? 1 : 0) - s.alpha) * Math.min(1, dt * 6);
      const reach = Math.abs(dir.x) * s.half.x + Math.abs(dir.y) * s.half.y + Math.abs(dir.z) * s.half.z;
      s.num.position.copy(w).addScaledVector(dir, (reach + .15) * objScale);
      const pop = 1 + (s.crack < 1 ? COUNT_POP(s.crack) * .5 : 0), size = Math.max(1.1, 1.5 * objScale * 1.6) * pop;
      s.num.scale.set(size * 1.25, size, 1); s.num.material.opacity = s.alpha;
    }
  }

  // =================================================================================================================
  // Events from the rules
  // =================================================================================================================
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
      else if (e.type === 'iceCracked' || e.type === 'iceShattered') onIce(e);
      else if (e.type === 'shuffled') { layout(); sfx('swap'); }
      else if (e.type === 'won' || e.type === 'lost') onEnd(e.type === 'won');
    }
    if (events.some(e => ['removed', 'shuffled', 'matched', 'deployed'].includes(e.type))) layout();
  }
  const killTween = toy => { const tw = toy?.userData.tw; if (tw) { tw.fn = () => {}; tw.done = null; toy.userData.tw = null; } };
  function moveToy(toy, destShelf, slot, { hop = 0.9, dur = 0.24 } = {}) {
    const v = shelfViews.get(destShelf); if (!toy || !v) return;
    killTween(toy); v.g.attach(toy); const from = toy.position.clone(), to = slotLocal(slot);
    toy.userData.moving = true;
    toy.userData.tw = tweens.add(dur, t => { toy.position.lerpVectors(from, to, t); toy.position.y += Math.sin(t * Math.PI) * hop; }, easeInOut, () => {
      toy.userData.moving = false; toy.userData.tw = null; toy.position.copy(to); squash(toy);
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
    if (v.scarf) { const m = v.scarf.m; v.scarf = null; FX.sparkle(m.getWorldPosition(new THREE.Vector3()), '#ed2933', 8); tweens.add(0.25, t => m.scale.setScalar(1 - t), x => x, () => v.g.remove(m)); }
    const hex = G.level.toyColors[colorOf(e.kind)], keep = toys[1] || toys[0];
    keep?.userData.body.userData.base.multiplyScalar(SHOOTER_S);
    // The three hop together and become one bigger toy: the shooter, waiting on its tray with its ammo.
    toys.forEach(t => { killTween(t); const from = t.position.clone(); tweens.add(0.22, k => { t.position.lerpVectors(from, slotLocal(1), k); t.position.y = from.y + Math.sin(k * Math.PI) * 0.9; }, easeInOut); });
    tweens.add(0.24, () => {}, x => x, () => {
      for (const t of toys) if (t !== keep) v.g.remove(t);
      if (!keep || keep.userData.deployed) return;
      const B0 = keep.userData.body.userData.base.clone();
      // the shipped merge bounce: 1 -> 1.28 -> 0.93 -> 1
      tweens.add(0.42, k => keep.userData.body.scale.copy(B0).multiplyScalar(k < .4 ? 1 + .28 * Math.sin(k / .4 * Math.PI / 2) : k < .7 ? 1.28 - .35 * (k - .4) / .3 : .93 + .07 * (k - .7) / .3));
      FX.merge(keep.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.8, 0.5)), hex);
      const num = label(String(e.ammo), { size: 40 }); num.scale.set(1.1, 0.55, 1); num.position.set(0, -0.15, 0.7); keep.add(num); keep.userData.num = num;
    });
    v.shooter = keep; v.kind = e.kind; v.ammo = e.ammo;
    // the shipped combo: each merge within half a second plays the merge sound a little higher (up to 10 steps)
    combo = performance.now() - lastMerge < 500 / Math.min(speed, 4) ? Math.min(10, combo + 1) : 0; lastMerge = performance.now();
    sfx('merge', { volume: 0.9, rate: 1 + 0.05 * combo }); ctx.shake(0.25);
  }
  function shatterCapsule(v, c) {
    const p = c.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.8, 0));
    chipBurst(p, new THREE.Color('#dff4ff'), 8, 3.5, .14, .5); emit(sparkFx, p, new THREE.Color(1, .9, .5), 6, 2, .22, .45);
    tweens.add(0.2, t => c.scale.setScalar(0.88 * (1 + t * 0.3)), x => x, () => v.g.remove(c));
  }
  function showBubble(shelf, on) {
    const v = shelfViews.get(shelf); if (!v) return;
    const attach = () => {
      if (on && !v.bubble && v.shooter) { const b = label('Waiting', { w: 192, h: 96, size: 30, fill: '#2a2a3a', stroke: null, bubble: true }); b.scale.set(1.9, 0.95, 1); b.position.set(0.9, 2.0, 0.6); v.shooter.add(b); v.bubble = b; tweens.add(0.35, t => b.scale.set(1.9 * t, 0.95 * t, 1), easeOutBack); }
      if (!on && v.bubble) { const b = v.bubble; v.bubble = null; tweens.add(0.2, t => b.scale.set(1.9 * (1 - t), 0.95 * (1 - t), 1), x => x, () => b.parent?.remove(b)); sfx('trayReady', { volume: 0.6 }); }
    };
    if (v.shooter?.userData.num) attach(); else tweens.add(0.3, () => {}, x => x, attach);
  }
  // Deploy: the shooter grips its blaster and flies to its spot in an arc (no spin), lands with a squash, then turns
  // to face the picture and starts firing.
  function onDeployed(e) {
    const v = shelfViews.get(e.shelf), pad = padViews[e.spot]; if (!v || !pad) return;
    let toy = v.shooter;
    if (v.bubble) { v.bubble.parent?.remove(v.bubble); v.bubble = null; }
    if (!toy) { toy = makeToy(e.kind, G.level.toyColors[colorOf(e.kind)]); toy.userData.body.userData.base.multiplyScalar(SHOOTER_S); toy.userData.body.scale.copy(toy.userData.body.userData.base); v.g.add(toy); toy.position.copy(slotLocal(1)); }
    v.shooter = null; toy.userData.deployed = true; root.attach(toy);   // off the tray now: the tray leaves while the shooter flies
    const hex = G.level.toyColors[colorOf(e.kind)];
    const s = { id: e.shooter, toy, spot: e.spot, color: colorOf(e.kind), hex, ammo: e.ammo, start: e.ammo, queue: [], seated: false, leaving: false, yaw: 0, recoilAge: 1, reveal: 1, nextShot: 0, aimAt: null, group: e.group };
    shooters.set(e.shooter, s);
    pad.num.userData.set(''); setRing(pad, hex, 1);
    if (e.group) { const ch = chains.find(c => !c.dock && (c.a === e.shelf || c.b === e.shelf)); if (ch) { ch.waiting = true; (ch.ids ||= []).push(e.shooter); if (ch.ids.length === 2) ch.dock = ch.ids; } }
    const go = () => {
      if (!toy.userData.aim) addBlaster(toy);
      if (toy.userData.num) { toy.remove(toy.userData.num); toy.userData.num = null; }
      root.attach(toy); const from = toy.position.clone(), to = pad.g.position.clone().add(new THREE.Vector3(0, 0.36, 0));
      sfx('deploy', { volume: 0.7 });
      tweens.add(FLIGHT, t => { toy.position.lerpVectors(from, to, t); toy.position.y += Math.sin(t * Math.PI) * 0.8; toy.rotation.x = SEAT_TILT * t; }, easeInOut, () => {
        toy.position.copy(to); toy.rotation.x = SEAT_TILT; sfx('land', { volume: 0.6 }); FX.land(to.clone().add(new THREE.Vector3(0, 0.05, 0)));
        const b = toy.userData.body, B = b.userData.base.clone();
        tweens.add(0.16, k => b.scale.set(B.x * (1.13 - .13 * k), B.y * (.8 + .2 * k), B.z * (1.13 - .13 * k)), easeOutCubic, () => {
          b.scale.copy(B); s.seated = true; s.reveal = 0; s.nextShot = time; pad.num.userData.set(String(s.ammo));
        });
      });
    };
    // a spot still busy with the last shooter's final volley: wait for it to leave (ShootingArea.FlyToSpot)
    const tryGo = () => { if (dead || !shooters.has(s.id)) return; if ([...shooters.values()].some(o => o !== s && o.spot === s.spot && !o.gone)) tweens.add(0.05, () => {}, x => x, tryGo); else go(); };
    tweens.add(0.12, () => {}, x => x, tryGo);
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
  // The rules fired a shot: the shooter queues it and fires it when it is seated and facing (ShooterView.QueueShot).
  function onShot(e) { const s = shooters.get(e.shooter); if (s) s.queue.push({ voxel: e.voxel, ammo: e.ammo }); }
  function onDone(e) { const s = shooters.get(e.shooter); if (s) s.leaving = true; }
  function fire(s, shot) {
    const { muzzle } = s.toy.userData, from = muzzle.getWorldPosition(new THREE.Vector3()), to = voxelWorld(shot.voxel);
    const col = lit(voxelHex(shot.voxel), WHITENESS), dir = to.clone().sub(from).normalize();
    flights.push({ voxel: shot.voxel, p: from.clone(), prev: from.clone(), dir, travelled: 0, t: 0, col, hex: voxelHex(shot.voxel), done: false, after: 0 });
    FX.muzzle(from, dir, voxelHex(shot.voxel));
    s.ammo = shot.ammo; padViews[s.spot].num.userData.set(String(shot.ammo)); setRing(padViews[s.spot], null, shot.ammo / (s.start || 1));
    s.recoilAge = 0; sfx(pick('shot1', 'shot2', 'shot3'), { volume: 0.35, rate: 0.95 + Math.random() * 0.15 }, 70);
  }
  function leave(s) {
    shooters.delete(s.id); const pad = padViews[s.spot]; pad.num.userData.set(''); setRing(pad, null, 0);
    const toy = s.toy, p0 = toy.position.clone(); FX.exit(pad.g.position.clone().add(new THREE.Vector3(0, 0.4, 0))); sfx('done', { volume: 0.5 });
    tweens.add(0.3, t => { const k = smooth(0, 1, t); toy.scale.setScalar(Math.max(0.001, 1 - k)); toy.position.copy(p0); toy.position.y += Math.sin(t * Math.PI) * 0.22; }, x => x, () => root.remove(toy));
  }
  function onEnd(win) {
    if (win) {
      sfx('levelUp', { volume: 0.8 });
      const gen = endGen; setTimeout(() => { if (!dead && gen === endGen) FX.celebrate(objCentre.clone().add(new THREE.Vector3(0, -1, 0))); }, 300);
    } else {
      sfx('levelFail', { volume: 0.8 }); ctx.shake(1.6);
      // the stuck shooters slump and the picture blushes red
      for (const s of shooters.values()) { const b = s.toy.userData.body; tweens.add(0.6, t => { b.rotation.z = Math.sin(t * Math.PI * 3) * 0.4 * (1 - t); }, easeOutCubic); }
      const m = voxMesh.material; tweens.add(1.0, t => m.emissive.setRGB(0.55 * Math.sin(t * Math.PI), 0, 0.05 * Math.sin(t * Math.PI)), x => x);
    }
  }

  // =================================================================================================================
  // Shooters (CharacterRig): turn about the seat's up toward the target at 300°/s, the blaster looks straight at it,
  // each shot kicks the body back along the aim (25 ms attack, 150 ms recovery) with a small nod; the tool pops in.
  // =================================================================================================================
  const _t = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3();
  function animateShooters(dt) {
    for (const s of shooters.values()) {
      const u = s.toy.userData; if (!u.aim) continue;
      if (s.seated) {
        // what to aim at: the next queued shot, else the last one, else the nearest voxel of its colour it can see
        if (s.queue.length) s.aimAt = s.queue[0].voxel;
        else if (s.aimAt == null) { const t = G.voxels.findVisibleTarget(s.color, G.shooting.anchors[s.spot]); s.aimAt = t >= 0 ? t : G.voxels.findTarget(s.color, G.shooting.anchors[s.spot]); }
        if (s.aimAt != null && s.aimAt >= 0) voxelWorld(s.aimAt, _t); else _t.copy(objCentre);
        // turn about the seat's own up (the seat leans toward the camera like its pad), so the steep shot up at the
        // picture reads as the shooter turning its back to us to face it
        s.toy.worldToLocal(_w.copy(_t));
        const want = Math.atan2(_w.x, _w.z), d = wrapAngle(want - s.yaw), stepA = TURN_RATE * dt;
        s.yaw += Math.abs(d) <= stepA ? d : Math.sign(d) * stepA; u.yaw.rotation.y = s.yaw;
        // fire what is due once it faces its target (a backlog catches up two at a time)
        const facing = Math.abs(wrapAngle(want - s.yaw)) < 0.5;
        if (facing) { let n = 0; while (s.queue.length && time >= s.nextShot && n < 2) { u.aim.lookAt(voxelWorld(s.queue[0].voxel, _t)); fire(s, s.queue.shift()); s.nextShot = Math.max(s.nextShot + FIRE_INTERVAL, time - FIRE_INTERVAL); n++; } }
        if (s.leaving && !s.queue.length && !s.gone) { s.gone = true; leave(s); continue; }
      }
      // blaster aim + recoil (in the yaw frame)
      if (s.aimAt != null && s.aimAt >= 0) u.aim.lookAt(voxelWorld(s.aimAt, _t));
      s.recoilAge += dt;
      const sway = smooth(0, 1, s.recoilAge / .025) * (1 - smooth(0, 1, (s.recoilAge - .025) / .15)), kick = RECOIL * sway;
      _f.set(0, 0, 1).applyQuaternion(u.aim.quaternion);   // aim forward, in the yaw frame
      u.aim.position.copy(u.aim.userData.rest).addScaledVector(_f, -kick * .65);
      u.body.position.set(-_f.x * kick, -_f.y * kick, -_f.z * kick);
      u.body.rotation.x = sway * 7 * Math.PI / 180;
      if (s.reveal < 1) { s.reveal = Math.min(1, s.reveal + dt * 7); u.gun.scale.setScalar(1.15 * (1 + Math.sin(s.reveal * Math.PI) * .065)); }
    }
  }

  // ---- per-frame visuals ----
  let time = 0;
  function animate(dt) {
    time += dt;
    voxGroup.quaternion.slerp(_q.fromArray(G.view.q), Math.min(1, dt * 20));
    voxGroup.updateMatrixWorld();
    animateShooters(dt);
    // bullets fly straight at their voxel (the picture keeps turning under them) and pop it on arrival
    for (let k = flights.length - 1; k >= 0; k--) {
      const f = flights[k];
      if (f.done) { f.after += dt; if (f.after >= .045) flights.splice(k, 1); continue; }
      f.t += dt; f.prev.copy(f.p);
      const target = voxelWorld(f.voxel, new THREE.Vector3()), d = target.distanceTo(f.p), step = SHOT_SPEED * dt;
      if (d <= step || f.t >= 2) {
        f.p.copy(target); f.travelled += d; f.done = true;
        FX.impact(target, f.hex); hitVoxel(f.voxel);
        sfx(pick('hit1', 'hit2', 'hit3'), { volume: 0.3, rate: 0.9 + Math.random() * 0.25 }, 90);
        continue;
      }
      f.p.addScaledVector(target.sub(f.p).normalize(), step); f.travelled += step;
    }
    for (const f of flights) if (!f.done) orbFx.emit({ p: f.p.clone(), v: new THREE.Vector3(), c: f.col, a: 1, size: BULLET / ORB_R, life: 1e-4, t: 0, r: 0, rv: 0, curve: () => 1, fade: () => 1 });
    animateVoxels(dt);
    animateIce(dt);
    for (const fx of [sparkFx, ringFx, dustFx, dropFx]) fx.update(dt);
    orbFx.update(0); orbFx.clear();
    drawTrails(); updateChips(dt);
    for (const toy of charAt.values()) { if (!toy || toy.userData.moving || toy.userData.dragged) continue; const b = toy.userData.body; b.position.y = Math.max(0, Math.sin(time * 2.2 + toy.userData.phase)) * 0.03; }
    for (const L of lanes) for (const a of L.ars) { const u = (time * 0.39 + a.userData.k * 0.5) % 1; a.position.y = L.top - 0.75 + u * 0.77; a.material.opacity = 0.49 * Math.sin(u * Math.PI); }
    placeChains();
    animateCarry();
  }

  // =================================================================================================================
  // Input: drag a toy to another slot (or onto a toy to swap); drag the picture to turn it.
  // =================================================================================================================
  let drag = null, held = null;
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
  // The toy a press at this point would pick up (null over the picture, an empty slot or a sealed toy).
  function toyUnder(e) {
    if (!G || G.over) return null;
    const pt = boardPoint(e); if (!pt || pt.y > objCentre.y - OBJ_R * 1.05) return null;
    return nearest(pt, slotsNow(), 0.85, s => !isEmpty(s.k));
  }
  // Lift a toy (or a hand-holding pair) off its cubby: the visitor's drag and the bot's carry share this.
  function lift(id, i) {
    const left = G.shelves.pairLeft(id, i), toys = left >= 0 ? [charAt.get(key(id, left)), charAt.get(key(id, left + 1))] : [charAt.get(key(id, i))];
    if (!toys[0] || toys.some(t => !t)) return null;
    const p = shelfViews.get(id).g.position.clone().add(slotLocal(i)).add(new THREE.Vector3(0, 0.6, 0.5));
    const d = { from: [id, i], left, toys, offs: toys.map(t => t.getWorldPosition(new THREE.Vector3()).sub(p)), scarf: shelfViews.get(id)?.scarf };
    for (const t of toys) { killTween(t); root.attach(t); t.userData.dragged = true; t.userData.moving = false; t.scale.setScalar(1.15); }
    if (d.scarf && left >= 0) root.attach(d.scarf.m);
    hov.set(null); sfx(pick('pick1', 'pick2'), { volume: 0.6 }); G.holdAutoDig = true;
    return d;
  }
  function carryTo(d, pt) {
    d.toys.forEach((t, k) => t.position.copy(pt).add(d.offs[k]).add(new THREE.Vector3(0, -0.6, 0.6)));
    if (d.scarf && d.left >= 0) d.scarf.m.position.copy(d.toys[0].position).add(new THREE.Vector3(SLOT_X / 2, 0, 0));
  }
  // Back home with a little bounce (a refused drop), or at once (the bot's carry handed over).
  function putBack(d, instant = false) {
    const [fid, fsl] = d.from;
    d.toys.forEach((t, k) => {
      t.userData.dragged = false; t.scale.setScalar(1); const slot = (d.left >= 0 ? d.left : fsl) + (d.left >= 0 ? k : 0), v = shelfViews.get(fid);
      if (instant && v) { killTween(t); v.g.attach(t); t.position.copy(slotLocal(slot)); } else moveToy(t, fid, slot, { hop: 0.3, dur: 0.2 });
    });
    if (d.scarf && d.left >= 0) { const v = shelfViews.get(fid); v?.g.attach(d.scarf.m); d.scarf.m.position.copy(slotLocal(d.left)).add(new THREE.Vector3(SLOT_X / 2, 0, 0)); }
  }
  function onDown(e) {
    if (auto || G.over || drag || e.button > 0 || e.target.closest?.('button, .arcade-card')) return;   // the stage's own buttons keep their clicks
    const pt = boardPoint(e); if (!pt) return;
    if (pt.y > objCentre.y - OBJ_R * 1.05) { drag = { spin: true, x: e.clientX, y: e.clientY }; G.view.dragging = true; capture(e); return; }
    const s = nearest(pt, slotsNow(), 0.85, s => !isEmpty(s.k));
    if (!s) return;
    if (G.shelves.isSealed(s.id, s.i)) { const toy = charAt.get(key(s.id, s.i)); if (toy) wiggle(toy); sfx('refused', { volume: 0.6 }); return; }
    const d = lift(s.id, s.i); if (!d) return;
    drag = d; capture(e); onMove(e);
  }
  function capture(e) { try { ctx.el.setPointerCapture(e.pointerId); } catch (_) {} }
  function onMove(e) {
    if (!drag) return hover(e);
    if (drag.spin) { const r = ctx.el.getBoundingClientRect(); G.view.drag((e.clientX - drag.x) / r.width * 360, (e.clientY - drag.y) / r.height * 360); drag.x = e.clientX; drag.y = e.clientY; return; }
    const pt = boardPoint(e, 1.2); if (pt) carryTo(drag, pt);
  }
  function onUp(e) {
    if (!drag) return;
    const d = drag; drag = null; G.holdAutoDig = false;
    if (d.spin) { G.view.dragging = false; G.view.released = 0; return; }
    const pt = (e.type === 'pointercancel' ? null : boardPoint(e)) || new THREE.Vector3(1e3, 1e3, 0), [fid, fsl] = d.from;
    const slots = slotsNow(), sh = G.shelves;
    let r = 'refused';
    if (sh.exists(fid) && sh.interactable(fid)) {
      if (d.left >= 0) {
        const viewIsLeft = fsl === d.left;
        const tgt = nearest(pt, slots, SNAP_R, s => { const l = viewIsLeft ? s.i : s.i - 1; return s.id !== fid && l >= 0 && l + 1 < 3 && isEmpty(sh.get(s.id, l)) && isEmpty(sh.get(s.id, l + 1)); });
        if (tgt) r = G.move(fid, d.left, tgt.id, viewIsLeft ? tgt.i : tgt.i - 1);
      } else {
        const self = nearest(pt, slots, SWAP_R, () => true);
        if (!(self?.id === fid && self?.i === fsl)) {
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
    }
    const evs = G.events.splice(0);
    if (r !== 'refused') {
      const mv = evs.find(x => x.type === 'moved' || x.type === 'swapped');
      if (mv) bot.noteMove(d.from, mv.type === 'moved' ? mv.to : mv.b, mv.type === 'swapped');
      sinceMove = 0;
    }
    for (const t of d.toys) t.scale.setScalar(1);
    handle(evs);
    if (r === 'refused') { putBack(d); sfx('rejected', { volume: 0.6 }); }
    if (layoutDirty) layout();
  }
  function trayAt(pt) {
    for (const [id] of G.shelves.visibleSlots()) { const v = shelfViews.get(id); if (!v) continue; const p = v.g.position; if (Math.abs(pt.x - p.x) < 1.65 && pt.y > p.y - 0.5 && pt.y < p.y + 1.7) return id; }
    return -1;
  }
  function wiggle(toy) { const b = toy.userData.body; tweens.add(0.35, t => { b.rotation.z = Math.sin(t * Math.PI * 4) * 0.25 * (1 - t); }, x => x); }
  function hover(e) {
    if (auto || G.over || e.pointerType !== 'mouse') return hov.set(null);
    const s = toyUnder(e);
    hov.set(s ? charAt.get(key(s.id, s.i))?.userData.body || null : null);
  }
  const onLeave = () => hov.set(null);
  ctx.el.addEventListener('pointerdown', onDown); window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
  ctx.el.addEventListener('pointerleave', onLeave);

  // ---- the bot's moves, shown as the ghost hand's drag: pick up when it presses, follow it, land as it lets go ----
  // Screen points of a bot step: from the toy to where it goes (for a pair grabbed by its right member, its right slot).
  function stepScreens(st) {
    const left = G.shelves.exists(st.from[0]) ? G.shelves.pairLeft(st.from[0], st.from[1]) : -1;
    const toSlot = left >= 0 && st.from[1] !== left ? st.to[1] + 1 : st.to[1];
    const a = screenOf(st.from[0], st.from[1]), b = screenOf(st.to[0], toSlot);
    return a && b ? [a, b] : null;
  }
  function beginCarry(st) {
    const ab = stepScreens(st); if (!ab) { pilot.cancel(); return; }
    ctx.botMove({ drag: ab });
    held = { st, ab, d: null };
  }
  function animateCarry() {
    if (!held || !pilot.carry) return;
    const t = pilot.carry.t + acc;   // the hand presses at ~0.5 s, drags until ~0.8 s
    if (!held.d && t >= 0.5) { held.d = lift(held.st.from[0], held.st.from[1]); if (!held.d) return; }
    if (held.d) {
      const u = easeInOut(Math.min(1, Math.max(0, (t - 0.5) / 0.29))), [a, b] = held.ab;
      const pt = boardPoint({ clientX: a.x + (b.x - a.x) * u, clientY: a.y + (b.y - a.y) * u }, 1.2); if (pt) carryTo(held.d, pt);
    }
  }
  function landCarry(st) {
    const h = held; held = null;
    let r = 'refused';
    if (pilot.stillValid(st)) { if (!h?.d) h && (h.d = lift(st.from[0], st.from[1])); r = bot.play(st); }
    const evs = G.events.splice(0);
    if (h?.d) for (const t of h.d.toys) t.scale.setScalar(1);
    handle(evs);
    if (r === 'refused' && h?.d) putBack(h.d);
    sinceMove = 0; G.holdAutoDig = false;
    if (layoutDirty) layout();
  }
  function cancelCarry() {
    if (!held) { pilot?.cancel(); return; }
    const h = held; held = null; pilot.cancel(); G.holdAutoDig = false;
    if (h.d) putBack(h.d, true);
    if (layoutDirty) layout();
  }

  // ---- camera ----
  function fit() {
    const aspect = (ctx.el.clientWidth || 1) / (ctx.el.clientHeight || 1), pts = [];
    for (const x of [-COL_X - 1.8, COL_X + 1.8]) for (const y of [rowY(2) - 0.9, OBJ_Y + OBJ_R + 0.2]) for (const z of [-1, 1]) pts.push(new THREE.Vector3(x, y, z));
    const el = 8 * Math.PI / 180;
    fitPerspective(camera, pts, aspect, { dir: new THREE.Vector3(0, Math.sin(el), Math.cos(el)), top: 0.13, bottom: 0.03, side: 0.03 });
  }

  // ---- loop ----
  const shelvesMoving = () => [...shelfViews.values()].some(v => v.moving);
  function update(dt) {
    hov.update(dt);
    if (!G) return;
    // the shipped EndSpeedUp: once every character has merged and only shooting is left, the game runs twice as fast
    const sp = Math.min(speed, 8) * (endPhase(G) ? 2 : 1);
    acc += dt * sp; let n = 0;
    while (acc >= TICK && n < 400) {
      acc -= TICK; n++; sinceMove += TICK;
      if (!drag) G.holdAutoDig = (auto && bot.holdsAutoDig) || !!held?.d;
      if (auto && !drag) { const a = pilot.tick(shelvesMoving()); if (a?.start) beginCarry(a.start); else if (a?.land) landCarry(a.land); }
      G.tick();
      handle(G.events.splice(0));
    }
    tweens.update(dt * sp); animate(dt * sp);
    updateHud();
    const shooting = flights.length || dying.length || [...shooters.values()].some(s => s.queue.length);
    if (G.over && !endTimer && !shooting) {
      endTimer = 1; const g0 = G, won = G.outcome === 'won';
      setTimeout(() => { if (G === g0 && !dead) finish(won); }, (won ? 1300 : 900) / Math.min(speed, 4));
    }
  }
  // Something that would move the board under a dragging finger: a shelf sliding, or a merge about to take a spot.
  const busy = () => G.pending > 0 || shelvesMoving() || tweens.size > 40;
  function updateHud() { const left = G.voxels.remaining; hud.textContent = left ? `${left} blocks` : ''; }
  function finish(won) {
    if (auto) { if (won) lvl = (lvl + 1) % LEVELS.length; build(); return; }
    if (won) {
      const last = lvl === LEVELS.length - 1;
      ctx.result({ win: true, last, title: last ? 'All clear!' : 'Picture cleared!', sub: last ? 'Capsules, scarves, chains and ice: every shipped mechanic, cleared.' : `Toyland Go! · ${G.level.name}`,
        next: () => { lvl = (lvl + 1) % LEVELS.length; build(); }, retry: () => build() });
    } else ctx.result({ win: false, title: 'No more space!', sub: 'Every shooter on the dock is stuck and the next one has nowhere to stand. Merge in a better order.', next: () => build() });
  }
  function nextStep() {
    if (!G || G.over) return null;
    if (auto) return pilot.plan();
    if (drag || busy() || sinceMove < 0.6) return null;
    return pilot.plan();
  }

  build();
  return {
    scene, camera, update, resize: () => fit(),
    autoplay(on) { auto = on; if (!on) cancelCarry(); },
    restart() { auto = false; speed = 1; lvl = 0; build(); },
    takeover() { auto = false; cancelCarry(); if (G.over) { if (G.outcome === 'won') lvl = (lvl + 1) % LEVELS.length; build(); } },
    reloadLevel() { build(); },
    grabbable(x, y) { const s = toyUnder({ clientX: x, clientY: y }); return !!s && !G.shelves.isSealed(s.id, s.i); },
    test: {
      set speed(v) { speed = v; },
      get state() {
        const onBelt = G.shooting.spots.filter(Boolean).length + G.pending + G.waiting.length;
        return { total: LEVELS.length, level: lvl + 1, over: G.over, result: G.outcome === 'won' ? 'win' : G.outcome === 'lost' ? 'lose' : null,
          progress: G.moves > 0 || (G.ticks > 0 && G.voxels.remaining < G.total) ? Math.max(1e-3, G.progress()) : 0, onBelt, auto, moves: G.moves, blocks: G.voxels.remaining, onTrack: bot.onTrack };
      },
      reset() { auto = false; speed = 1; lvl = 0; cancelCarry(); build(); },
      goto(i) { lvl = i; build(); },   // show level i (0-based) with the bot still in charge
      lose() { if (!G.over) { G.outcome = 'lost'; G.events.push({ type: 'lost' }); } },   // debug: the fail screen (Unity's DebugEndLevel)
      // The bot's next move as a real drag on the page (from the toy to where it goes); also while the bot plays.
      nextMove() { const st = nextStep(); if (!st) return null; const ab = stepScreens(st); return ab ? { drag: ab } : null; },
    },
    destroy() {
      dead = true; ctx.el.removeEventListener('pointerdown', onDown); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
      ctx.el.removeEventListener('pointerleave', onLeave); hud.remove(); tag.remove(); disposeScene(scene);
    },
  };
  function screenOf(id, i) {
    const v = shelfViews.get(id); if (!v) return null;
    const p = v.g.position.clone().add(slotLocal(i)).add(new THREE.Vector3(0, 0.6, 0.6)).project(camera), r = ctx.el.getBoundingClientRect();
    return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height };
  }
}
