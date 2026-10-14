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
