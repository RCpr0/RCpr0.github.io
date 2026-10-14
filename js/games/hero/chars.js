// Hero cast: one character from each playable game, built from that game's shipped model files (same URLs as the
// games, so the browser cache is shared). Each loader resolves to { obj, height, tick(dt, t, s), poke() } where obj
// stands on y = 0, faces +z, and is `height` units tall. Nothing here is imported from the games' own modules.
import * as THREE from 'three';
import { loadModel, loadTexture, gloss, matte } from '../common.js';

const M = 'media/games/';
const b64 = (s, T) => { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };

// Re-centre a geometry on x/z, feet on y = 0, and scale it to `h` tall.
function stand(g, h) {
  g.computeBoundingBox(); const b = g.boundingBox, s = h / (b.max.y - b.min.y);
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2); g.scale(s, s, s); return g;
}

// ---- Yarn Collect: a yarn ball (shipped YarnBall mesh + yarn texture, the game's tex * colour * tex look) ----
export async function yarnBall(hex = '#ff5c8a', d = 1.35) {
  const [m, tex] = await Promise.all([loadModel(M + 'yarn/YarnBall.json'), loadTexture(M + 'yarn/yarn.webp')]);
  const g = m.parts[0].geometry; g.translate(...m.min.clone().add(m.max).multiplyScalar(-0.5).toArray());
  g.scale(d / m.size.x, d / m.size.y, d / m.size.z);
  const col = new THREE.Color(hex);
  const mat = new THREE.MeshStandardMaterial({ color: col, map: tex, roughness: 0.62, emissive: col.clone().multiplyScalar(0.3), emissiveMap: tex, envMapIntensity: 0.35 });
  mat.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= sampledDiffuseColor.rgb;').replace('#include <opaque_fragment>',
    `{ float f = 1.0 - saturate(dot(normal, geometryViewDir)); outgoingLight *= 1.0 - 0.42 * pow(f, 2.2); }
#include <opaque_fragment>`); };
  mat.customProgramCacheKey = () => 'hero-yarn';
  const ball = new THREE.Mesh(g, mat); ball.position.y = d / 2;
  const obj = new THREE.Group(); obj.add(ball);
  return { obj, height: d, ball, radius: d / 2, tick() {}, poke() {} };
}

// ---- Mice Flow: a mouse carrying a cheese block (shipped mesh with vertex colours + the game's scurry vertex motion) ----
async function miceMesh(file) {
  const p = (await (await fetch(M + 'mice/' + file)).json()).parts[0], g = new THREE.BufferGeometry();
  const unq = (s, mn, sc, k) => Float32Array.from(b64(s, Uint16Array), (v, i) => mn[i % k] + v * sc[i % k]);
  g.setAttribute('position', new THREE.BufferAttribute(unq(p.pos, p.pmin, p.pscale, 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(b64(p.nrm, Int8Array), v => v / 127), 3));
  if (p.uv1) g.setAttribute('flags', new THREE.BufferAttribute(unq(p.uv1, p.u1min, p.u1scale, 2), 2));
  if (p.col) g.setAttribute('color', new THREE.BufferAttribute(b64(p.col, Uint8Array), 4, true));
  g.setIndex(new THREE.BufferAttribute(b64(p.idx, p.i32 ? Uint32Array : Uint16Array), 1));
  return g;
}
export async function mouse(tint = '#8fa6ff', h = 1.25) {
  const [mg, cg] = await Promise.all([miceMesh('mouse.json'), miceMesh('cheese-smooth.json')]);
  const raw = 5.27; // mouse.json is ~5.27 units tall, nose toward +z
  const k = h / raw;
  const u = { uMotion: { value: 0 }, uPhase: { value: 0 }, uCarry: { value: 1 }, uTint: { value: new THREE.Color(tint) } };
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  mat.onBeforeCompile = s => {
    Object.assign(s.uniforms, u);
    s.vertexShader = `attribute vec2 flags; uniform float uMotion,uPhase,uCarry; varying float vFur;
      vec3 animateMouse(vec3 p,vec2 f){ float gait=uPhase, foot=abs(f.y), cycle=gait+max(0.,-f.y)*3.14159;
        p.y+=max(0.,sin(cycle))*.48*uMotion*foot; p.z+=cos(cycle)*.34*uMotion*foot;
        float front=foot*step(0.,p.z); p.y+=front*uCarry*1.45; p.z+=front*uCarry*2.6;
        if(p.z< -3.8) p.x+=sin(gait*.5+p.z*.6)*.40*(uMotion+.35)*clamp((-p.z-3.8)/3.,0.,1.);
        p.y+=sin(gait*2.)*.11*uMotion; return p; }\n` + s.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed=animateMouse(vec3(position),flags); vFur=flags.x;');
    s.fragmentShader = 'uniform vec3 uTint; varying float vFur;\n' + s.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*uTint*1.15,vFur);');
  };
  mat.customProgramCacheKey = () => 'hero-mouse';
  const body = new THREE.Mesh(mg, mat); body.scale.setScalar(k);
  const cheese = new THREE.Mesh(cg, gloss('#ffc53d', null, { roughness: 0.4, clearcoat: 0.6, vertexColors: !!cg.attributes.color }));
  cheese.scale.setScalar(h * 0.62); cheese.position.set(0, h * 0.7, h * 0.78); cheese.rotation.set(0.25, 0.4, 0);
  const obj = new THREE.Group(); obj.add(body, cheese);
  return {
    obj, height: h,
    tick(dt, t, s = 0) { u.uPhase.value += dt * (6 + s * 10); u.uMotion.value = 0.35 + 0.65 * s; cheese.position.y = h * 0.7 + Math.sin(u.uPhase.value * 2) * 0.03; },
    poke() {},
  };
}

// ---- Toyland Go!: a plush bear, recoloured by the game's tint-mask idea (grey plush texture x colour, mask keeps eyes/muzzle) ----
export async function plush(hex = '#4fb2ff', h = 1.5) {
  const [m, skin, mask] = await Promise.all([loadModel(M + 'toyland/Bear.json'), loadTexture(M + 'toyland/bear.webp'), loadTexture(M + 'toyland/bearmask.webp', { srgb: false })]);
  const u = { map: { value: skin }, maskMap: { value: mask }, uColor: { value: new THREE.Color(hex) }, uLight: { value: new THREE.Vector3(-0.65, 0.8, 0.85).normalize() }, uH: { value: m.size.y } };
  const body = new THREE.ShaderMaterial({ uniforms: u, toneMapped: false,
    vertexShader: `varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vH;
      void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; vH = position.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D map, maskMap; uniform vec3 uColor, uLight; uniform float uH; varying vec3 vN; varying vec3 vW; varying vec2 vUv; varying float vH;
      vec3 sat(vec3 c, float a){ float l = dot(c, vec3(.299,.587,.114)); return max(vec3(0.), mix(vec3(l), c, a)); }
      void main(){
        vec3 tex = texture2D(map, vUv).rgb; float keep = texture2D(maskMap, vUv).r; float luma = dot(tex, vec3(.299,.587,.114));
        vec3 body = sat(uColor * clamp(luma / .547, 0., 1.), 1.6) * 1.35;
        keep = max(keep, smoothstep(.83, .88, luma));
        vec3 albedo = mix(body, tex, keep);
        vec3 n = normalize(vN) * (gl_FrontFacing ? 1. : -1.);
        float ramp = smoothstep(.18, .82, dot(n, uLight) * .5 + .5);
        vec3 shade = albedo * mix(vec3(1.), albedo, .9) * .65;
        vec3 col = mix(shade, albedo, ramp) + albedo * .45 * clamp(n.y, 0., 1.);
        col = mix(col, shade * .85, (1. - smoothstep(0., .8, vH / uH)) * .5);
        col = min(col, vec3(1.25)); gl_FragColor = vec4(col, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const eye = gloss('#16121c', null, { roughness: 0.15, clearcoat: 1 });
  const k = h / m.size.y, obj = new THREE.Group(), inner = new THREE.Group(); inner.scale.setScalar(k); obj.add(inner);
  for (const p of m.parts) inner.add(new THREE.Mesh(p.geometry, /eye/i.test(p.name) ? eye : body));
  inner.position.y = -m.min.y * k;
  return { obj, height: h, tick() {}, poke() {} };
}

// ---- Sand Flow: a sand cart (shipped Cart mesh, glossy tint + the shipped spec highlight map) heaped with sand ----
export async function cart(hex = '#4f7dff', h = 1.15) {
  const [m, spec] = await Promise.all([loadModel(M + 'sandflow/Cart.json'), loadTexture(M + 'sandflow/cartspec.webp', { srgb: false })]);
  const k = h / m.size.y, c = m.min.clone().add(m.max).multiplyScalar(0.5);
  const body = gloss(hex, null, { roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15, emissiveMap: spec, emissive: '#ffffff', emissiveIntensity: 0.22, side: THREE.DoubleSide });
  const tyre = gloss('#2c2342', null, { roughness: 0.5, clearcoat: 0.4 });
  const obj = new THREE.Group(), inner = new THREE.Group(); obj.add(inner); inner.scale.setScalar(k); inner.position.y = h / 2;
  for (const p of m.parts) { const mesh = new THREE.Mesh(p.geometry.clone().translate(-c.x, -c.y, -c.z), /Wheel|Tyre/i.test(p.name) ? tyre : body); inner.add(mesh); }
  // A heap of sand cubes poking out of the top, as a full cart leaves the picture.
  const sand = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), matte('#ffd27a', null, { roughness: 1 }), 9), mm = new THREE.Matrix4();
  const w = m.size.x * k, d = m.size.z * k;
  for (let i = 0; i < 9; i++) {
    const x = ((i % 3) - 1) * w * 0.26, z = (Math.floor(i / 3) - 1) * d * 0.26, top = h * (0.92 + 0.12 * (i === 4) + 0.05 * ((i * 7) % 3 === 0));
    mm.makeScale(w * 0.26, w * 0.26, d * 0.26).setPosition(x, top, z); sand.setMatrixAt(i, mm);
    sand.setColorAt(i, new THREE.Color().setHSL(0.11 + 0.02 * ((i * 5) % 3), 0.95, 0.62 + 0.06 * ((i * 3) % 2)));
  }
  inner.add(sand); sand.scale.setScalar(1 / k); sand.position.y = -h / 2 / k * 1; inner.rotation.x = 0.4;
  return { obj, height: h * 1.1, tick() {}, poke() {} };
}

// ---- KittyDoku: the rigged cat (shipped cat.glb with its clips, a shipped coat and the face atlas; blinks) ----
export async function cat(h = 2.0) {
  const { GLTFLoader } = await import('../../vendor/loaders/GLTFLoader.js');
  const [g, coat, face] = await Promise.all([new GLTFLoader().loadAsync(M + 'kitty/cat.glb'), loadTexture(M + 'kitty/coat-graytuxedo.webp'), loadTexture(M + 'kitty/cat-face.webp')]);
  const o = g.scene, cells = { eyeL: [0, 0.75], eyeR: [0, 0.75], mouth: [0, 0.25] }, faces = [];
  const bodyMat = matte('#ffffff', coat, { roughness: 0.8 });
  o.traverse(x => {
    if (!x.isMesh) return; x.frustumCulled = false;
    if (x.name === 'body') { x.material = bodyMat; return; }
    const t = face.clone(); t.repeat.set(0.25, 0.25); const c = cells[x.name] || [0, 0.75]; t.offset.set(c[0], c[1]);
    x.material = new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.3 }); if (x.name !== 'mouth') faces.push(t);
  });
  const mixer = new THREE.AnimationMixer(o), acts = Object.fromEntries(g.animations.map(c => [c.name, mixer.clipAction(c)]));
  acts.sit.play(); mixer.update(0); o.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(o, true), s = h / (box.max.y - box.min.y);
  const obj = new THREE.Group(); o.scale.setScalar(s); o.position.y = -box.min.y * s; obj.add(o);
  let cur = acts.sit, blink = 2.5;
  const play = (name, back = 'sit') => {
    const a = acts[name]; if (!a || a === cur) return;
    a.reset(); a.setLoop(back ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = true; a.play(); a.crossFadeFrom(cur, 0.15, false); cur = a; cur.userData = { back };
  };
  mixer.addEventListener('finished', e => { const b = e.action.userData?.back; if (b && e.action === cur) { const a = acts[b]; a.reset(); a.setLoop(THREE.LoopRepeat, Infinity); a.play(); a.crossFadeFrom(cur, 0.25, false); cur = a; } });
  return {
    obj, height: h, play,
    tick(dt) {
      mixer.update(dt);
      blink -= dt; const f = blink < 0.24 && blink > 0 ? [0.25, 0.5, 0.25][Math.min(2, Math.floor((0.24 - blink) / 0.08))] : 0;
      for (const t of faces) t.offset.x = f;
      if (blink <= 0) blink = 2 + Math.random() * 3;
    },
    poke() { play('happy'); },
  };
}
