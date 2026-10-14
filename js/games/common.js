// Shared helpers for the arcade games: geometry-only model JSON (see tools/games/fbx2json.mjs), textures, tweens.
import * as THREE from 'three';

const dec = (b64, T) => { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new T(u.buffer); };

// Returns { parts: [{ name, mat, geometry }], size: Vector3 }.
export async function loadModel(url) {
  const j = await (await fetch(url)).json();
  const parts = j.parts.filter(p => p.count > 0).map(p => {
    const g = new THREE.BufferGeometry();
    // Quantised parts: 16-bit positions/UVs over each part's own range, 8-bit normals (see tools/games/fbx2json.mjs).
    const unq = (b64, mn, sc, k) => Float32Array.from(dec(b64, Uint16Array), (v, i) => mn[i % k] + v * sc[i % k]);
    g.setAttribute('position', new THREE.BufferAttribute(p.q ? unq(p.pos, p.pmin, p.pscale, 3) : dec(p.pos, Float32Array), 3));
    if (p.nrm) g.setAttribute('normal', new THREE.BufferAttribute(p.q ? Float32Array.from(dec(p.nrm, Int8Array), v => v / 127) : dec(p.nrm, Float32Array), 3));
    if (p.uv) g.setAttribute('uv', new THREE.BufferAttribute(p.q ? unq(p.uv, p.umin, p.uscale, 2) : dec(p.uv, Float32Array), 2));
    g.setIndex(new THREE.BufferAttribute(dec(p.idx, p.i32 ? Uint32Array : Uint16Array), 1));
    if (!p.nrm) g.computeVertexNormals();
    return { name: p.name, mat: p.mat, geometry: g };
  });
  return { parts, min: new THREE.Vector3(...j.min), max: new THREE.Vector3(...j.max), size: new THREE.Vector3(...j.max).sub(new THREE.Vector3(...j.min)) };
}

const texLoader = new THREE.TextureLoader();
export function loadTexture(url, { repeat = false, srgb = true } = {}) {
  return new Promise((res, rej) => texLoader.load(url, t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    res(t);
  }, undefined, rej));
}

// Three-band toon ramp, shared by every toon material.
let ramp;
export function toonRamp() {
  if (ramp) return ramp;
  ramp = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]), 3, 1);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  return ramp;
}

// Minimal tween list: tweens.add(duration, t => {...}, ease, done) and tweens.update(dt) once per frame.
export function tweenList() {
  let list = [];
  return {
    add(d, fn, ease = easeOutCubic, done) { const tw = { t: 0, d, fn, ease, done }; list.push(tw); fn(0); return tw; },
    update(dt) {
      for (const tw of list) { tw.t = Math.min(tw.d, tw.t + dt); tw.fn(tw.ease(tw.t / tw.d)); }
      const fin = list.filter(tw => tw.t >= tw.d); list = list.filter(tw => tw.t < tw.d); fin.forEach(tw => tw.done?.());
    },
    clear() { list = []; },
    get size() { return list.length; },
  };
}
export const easeOutCubic = x => 1 - (1 - x) ** 3;
export const easeInOut = x => (x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
export const easeOutBack = x => { const c = 1.70158; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
export const linear = x => x;

export function disposeScene(scene) {
  scene.traverse(o => {
    o.geometry?.dispose();
    for (const m of [].concat(o.material || [])) { for (const k in m) if (m[k]?.isTexture) m[k].dispose(); m.dispose(); }
  });
}

// ---- Look: glossy materials, a light rig with a shadow floor, and a fitted perspective camera ----
// Colours are pushed 1.22x away from grey after lighting, so pieces stay vivid under tone mapping.
function saturate(m, k = 1.22) {
  m.onBeforeCompile = s => { s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', `outgoingLight = mix(vec3(dot(outgoingLight, vec3(.2126,.7152,.0722))), outgoingLight, ${k.toFixed(2)});\n#include <opaque_fragment>`); };
  m.customProgramCacheKey = () => 'sat' + k;
  return m;
}
// Plastic with a clear top coat (pieces, carts, baskets, houses).
export function gloss(color, map, o = {}) {
  return saturate(new THREE.MeshPhysicalMaterial({ color, map: map || null, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.25, ...o }));
}
// Soft surfaces (fur, felt, wood, stone).
export function matte(color, map, o = {}) {
  return saturate(new THREE.MeshStandardMaterial({ color, map: map || null, roughness: 0.85, ...o }));
}
// Warm key light with a soft shadow, warm sky / plum ground fill, lilac rim; an invisible floor that only shows the shadow.
export function addRig(scene, { size = 12, floorY = 0, center = new THREE.Vector3() } = {}) {
  scene.add(new THREE.HemisphereLight('#fff6ee', '#3a2350', 0.45));
  const key = new THREE.DirectionalLight('#fff3e2', 1.9); key.position.copy(center).add(new THREE.Vector3(5, 10, 6)); key.target.position.copy(center);
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 6; key.shadow.bias = -8e-4; key.shadow.normalBias = 0.02;
  const c = key.shadow.camera; c.left = c.bottom = -size; c.right = c.top = size; c.near = 0.5; c.far = 60; c.updateProjectionMatrix();
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight('#b9a4ff', 0.9); rim.position.copy(center).add(new THREE.Vector3(-6, 4, -6)); scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.ShadowMaterial({ opacity: 0.2 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(center.x, floorY, center.z); floor.receiveShadow = true; floor.userData.noShadowCast = true; scene.add(floor);
  return { key, rim, floor };
}
export function castShadows(obj) { obj.traverse(o => { if (o.isMesh && !o.userData.noShadowCast) { o.castShadow = true; o.receiveShadow = true; } }); }

// Perspective camera looking along `dir` (from the board toward the camera), placed so every point fits inside the view
// with the given NDC margins. Stores the view so the stage can sway it around the same target.
export function fitPerspective(camera, pts, aspect, { dir, fov = 30, top = 0.12, bottom = 0.12, side = 0.06 } = {}) {
  camera.fov = fov; camera.aspect = aspect; camera.near = 0.5; camera.far = 400; camera.updateProjectionMatrix();
  const box = new THREE.Box3().setFromPoints(pts), target = box.getCenter(new THREE.Vector3());
  let dist = box.getSize(new THREE.Vector3()).length() * 2 / Math.tan(fov * Math.PI / 360);
  const d = dir.clone().normalize(), v = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  for (let it = 0; it < 12; it++) {
    camera.position.copy(target).addScaledVector(d, dist); camera.lookAt(target); camera.updateMatrixWorld();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { v.copy(p).project(camera); x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    // Re-centre inside the allowed window, then scale the distance to fill it.
    const wantCx = 0, wantCy = (bottom - top) / 2, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
    const halfH = Math.tan(fov * Math.PI / 360) * dist, halfW = halfH * aspect;
    target.addScaledVector(right, (cx - wantCx) * halfW).addScaledVector(up, (cy - wantCy) * halfH);
    const sx = (x1 - x0) / (2 - 2 * side), sy = (y1 - y0) / (2 - top - bottom);
    dist *= Math.max(sx, sy) * 0.85 + 0.15;
  }
  camera.position.copy(target).addScaledVector(d, dist); camera.lookAt(target); camera.updateMatrixWorld();
  camera.userData.view = { target: target.clone(), dir: d.clone(), dist };
}
// Turn the fitted view by a small yaw/pitch around its target (idle sway, pointer tilt).
export function applyView(camera, yaw, pitch) {
  const v = camera.userData.view; if (!v) return;
  const d = v.dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), d).normalize();
  d.applyAxisAngle(side, pitch);
  camera.position.copy(v.target).addScaledVector(d, v.dist); camera.lookAt(v.target); camera.updateMatrixWorld();
}

// Hover response: the piece under the pointer springs up a little (scale), and settles back when the pointer leaves.
// Damped spring (k 180, c 16) so it pops slightly past its target before settling.
export function hoverSprings() {
  const live = new Map(); let current = null;
  return {
    set(obj) {
      if (obj === current) return;
      if (current) live.set(current, { ...(live.get(current) || { s: 1, v: 0 }), to: 1 });
      if (obj) { if (!obj.userData.baseScale) obj.userData.baseScale = obj.scale.clone(); live.set(obj, { ...(live.get(obj) || { s: 1, v: 0 }), to: 1.1 }); }
      current = obj;
    },
    update(dt) {
      for (const [o, st] of live) {
        st.v += ((st.to - st.s) * 180 - st.v * 16) * dt; st.s += st.v * dt;
        if (o.userData.baseScale) o.scale.copy(o.userData.baseScale).multiplyScalar(st.s);
        if (st.to === 1 && Math.abs(st.s - 1) < 1e-3 && Math.abs(st.v) < 1e-3) { o.scale.copy(o.userData.baseScale); live.delete(o); }
      }
    },
    clear() { for (const o of live.keys()) if (o.userData.baseScale) o.scale.copy(o.userData.baseScale); live.clear(); current = null; },
  };
}

// Taps that never fight page scrolling: fn(e) runs on pointerup when the pointer moved less than 10 px and the
// browser didn't take the gesture for a scroll (pointercancel). Mouse clicks behave the same way.
export function onTap(el, fn) {
  let down = null;
  el.addEventListener('pointerdown', e => { if (e.button > 0) return; down = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointercancel', () => { down = null; });
  el.addEventListener('pointerup', e => {
    const d = down; down = null;
    if (!d || d.id !== e.pointerId || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return;
    if (e.target.closest?.('button, .arcade-card')) return; // the stage's own buttons keep their clicks
    fn(e);
  });
}
