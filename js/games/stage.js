// One transparent WebGL canvas for the whole page. Each game section has an empty stage element; every frame the
// game is drawn into that element's rectangle, so boards float straight on the section colour with no frame around
// them. The canvas sits in the document (not fixed) and is moved to the current scroll position each frame, so between
// frames it scrolls with the page and the boards never lag behind their sections. Games load as their section nears
// the screen, only on-screen games update, and a bot plays each one until the visitor touches it. A ghost hand shows
// the bot's moves and a Matrix-style "jump in" lens (matrix.js) invites the visitor to take over.
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { applyView } from './common.js';
import { makeLens, dissolve } from './matrix.js';

// ?only=<id> loads just that game (used to test one game in isolation).
const only = new URLSearchParams(location.search).get('only');
const stages = [...document.querySelectorAll('[data-stage]')].filter(el => !only || el.dataset.stage === only);
const HAND = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M24 6c3 0 5 2 5 5v17l2-1V22c0-3 2-5 5-5s5 2 5 5v6l2-1c3 0 5 2 5 5v3l1-1c3 0 5 2 5 5v8c0 9-7 16-16 16h-6c-6 0-10-3-13-8L9 41c-2-3-1-6 1-7 3-2 6-1 8 1l1 2V11c0-3 2-5 5-5z" fill="#03140a" fill-opacity=".86" stroke="#5dff8f" stroke-width="2.6" stroke-linejoin="round"/><path d="M29 28v9M36 28v9M43 33v5" stroke="#5dff8f" stroke-width="2.2" stroke-linecap="round" opacity=".8"/></svg>';

if (stages.length) init();

function init() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas'); canvas.id = 'gl'; canvas.setAttribute('aria-hidden', 'true'); document.body.append(canvas);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
  catch (e) { document.documentElement.classList.add('no-webgl'); return; }
  const mobile = matchMedia('(pointer: coarse)').matches;
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 2 : 1.75));
  renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const pmrem = new THREE.PMREMGenerator(renderer), env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sound = name => window.sound && window.sound.play(name);
  // The canvas is the size of the visible viewport (innerHeight, so mobile address bars are accounted for).
  let W = 0, H = 0;
  const size = () => { W = document.documentElement.clientWidth; H = innerHeight; renderer.setSize(W, H, false); canvas.style.width = W + 'px'; canvas.style.height = H + 'px'; };
  size(); addEventListener('resize', () => { size(); views.forEach(v => v.game?.resize()); });
  let scrolledAt = -1e9; addEventListener('scroll', () => { scrolledAt = performance.now(); }, { passive: true });

  const views = stages.map(el => ({ el, id: el.dataset.stage, game: null, loading: false, auto: !reduce, yaw: 0, pitch: 0, vy: 0, vp: 0, cx: 0, cy: 0, hover: false, down: false, touched: 0, idleW: 0, hoverW: 0 }));
  window.__arcade = { games: {}, current: null, use(id) { this.current = this.games[id] || null; return !!this.current; } };

  for (const v of views) {
    const ui = v.el.querySelector('.arcade-ui');
    const card = el('div', 'arcade-card'), reload = el('button', 'arcade-reload');
    const ghost = el('div', 'arcade-ghost'), lens = makeLens(mobile), ring = lens.el, yay = el('div', 'arcade-yay');
    ghost.innerHTML = HAND + '<i>BOT</i>'; yay.textContent = "YOU'RE IN";
    reload.type = 'button'; reload.setAttribute('aria-label', 'Restart this level'); reload.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M17.7 6.3A8 8 0 1 0 20 12h-2.5a5.5 5.5 0 1 1-1.6-3.9L13 11h7V4z" fill="currentColor"/></svg>';
    ui.append(card, reload, ghost, ring, yay); card.hidden = true;
    Object.assign(v, { ui, card, reload, ghost, ring, lens, yay, hand: { x: 0, y: 0, placed: false, busy: 0 } });
    // Jumping in keeps the level the bot was playing: the visitor carries on from there.
    const takeOver = () => {
      if (!v.auto || !v.game) return;
      v.auto = false; v.el.classList.remove('attract'); v.game.autoplay(false); v.game.takeover ? v.game.takeover() : v.game.restart();
      dissolve(ui, yay, reduce);
    };
    v.takeOver = takeOver;
    reload.addEventListener('click', () => { if (!v.game) return; takeOver(); v.card.hidden = true; v.game.reloadLevel ? v.game.reloadLevel() : v.game.restart(); sound('tap'); });
    // Taking over never fights scrolling on touch screens: a mouse press takes over at once; a finger takes over on a
    // tap, or at once when it lands on a piece the game lets you drag (and only then is the page kept from scrolling).
    let tdown = null;
    v.el.addEventListener('pointerdown', e => {
      v.down = true; v.touched = performance.now();
      if (!v.auto || e.target.closest('button')) return;
      if (e.pointerType === 'mouse' || v.game?.grabbable?.(e.clientX, e.clientY)) takeOver();
      else tdown = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }, true);
    v.el.addEventListener('pointerup', e => {
      v.down = false; const d = tdown; tdown = null;
      if (d && d.id === e.pointerId && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) takeOver();
    }, true);
    v.el.addEventListener('pointercancel', () => { v.down = false; tdown = null; }, true);
    v.el.addEventListener('touchstart', e => { const t = e.touches[0]; if (t && e.touches.length === 1 && v.game?.grabbable?.(t.clientX, t.clientY)) e.preventDefault(); }, { passive: false });
    // Pointer tilt: remember where the pointer is on screen; the lean is worked out against the stage every frame, so it
    // stays right while the page scrolls under a still pointer.
    v.el.addEventListener('pointermove', e => { if (e.pointerType !== 'mouse') return; v.cx = e.clientX; v.cy = e.clientY; v.hover = true; v.touched = performance.now(); });
    v.el.addEventListener('pointerleave', () => { v.hover = false; v.down = false; });
  }

  async function load(v) {
    v.loading = true; v.el.classList.add('loading');
    const mod = await import(`./${v.id}/game.js`);
    const api = {
      THREE, renderer, env, el: v.el, canvas: v.el, ui: v.ui, sound, reduce, base: `media/games/${v.id}/`,
      loadSounds: map => { v.ownSounds = true; return loadSounds(`media/games/${v.id}/`, map); }, // then the stage's synth stays quiet
      shake: (amt = 1) => shakeStage(v.el, amt),
      setLevel: () => {}, // level numbers are not shown
      botMove: move => botMove(v, move),
      result({ win, title, sub, next, retry, last }) {
        v.card.className = 'arcade-card ' + (win ? 'win' : 'lose');
        v.card.innerHTML = `<b>${title}</b><p>${sub || ''}</p>`;
        if (next) v.card.append(button(win ? (last ? 'Play again' : 'Next level →') : 'Retry', next, 'btn'));
        if (retry && win && !last) v.card.append(button('Replay', retry, 'btn o'));
        v.card.hidden = false; if (!v.auto && !v.ownSounds) sound(win ? 'clear' : 'lose');
        v.card.querySelector('button')?.focus({ preventScroll: true });
      },
      hideResult: () => { v.card.hidden = true; },
    };
    v.game = await mod.create(api); v.game.id = v.id;
    v.el.classList.remove('loading'); v.el.classList.toggle('attract', v.auto);
    v.game.autoplay(v.auto);
    window.__arcade.games[v.id] = v.game; if (!window.__arcade.current) window.__arcade.current = v.game;
  }

  // Ghost hand. Between moves it hovers over the bot's next move (test.nextMove()); botMove() makes it press there, or
  // press, drag and let go. The "jump in" lens trails the hand, or follows the mouse while it is over the stage.
  function local(v, p) { const r = v.el.getBoundingClientRect(); return { x: p.x - r.left, y: p.y - r.top }; }
  function botMove(v, move) {
    if (!v.auto || reduce || !move) return;
    const h = v.hand, g = v.ghost;
    const a = local(v, move.drag ? move.drag[0] : move), b = move.drag ? local(v, move.drag[1]) : null;
    const from = h.placed ? { x: h.x, y: h.y } : { x: a.x + 60, y: a.y + 90 };
    const at = (p, s = 1, r = -14) => ({ transform: `translate(${p.x}px,${p.y}px) rotate(${r}deg) scale(${s})` });
    const frames = [at(from), { ...at(a), offset: 0.45 }, { ...at(a, 0.82, -8), offset: 0.6 }];
    if (b) frames.push({ ...at(b, 0.82, -4), offset: 0.88 }, at(b, 1));
    else frames.push(at(a, 1));
    g.animate(frames, { duration: b ? 900 : 480, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' });
    h.busy = performance.now() + (b ? 900 : 480); Object.assign(h, b || a, { placed: true });
    const rip = el('span', 'arcade-ripple'); const p = b || a; rip.style.left = p.x + 'px'; rip.style.top = p.y + 'px';
    setTimeout(() => { v.ui.append(rip); setTimeout(() => rip.remove(), 600); }, b ? 790 : 290);
  }
  function aimHand(v, now) {
    const h = v.hand; if (reduce || now < h.busy) return;
    const m = v.game.test?.nextMove?.(); if (!m) return;
    const p = local(v, m.drag ? m.drag[0] : m);
    if (h.placed && Math.hypot(p.x - h.x, p.y - h.y) < 4) return;
    const from = h.placed ? h : { x: p.x + 60, y: p.y + 90 };
    v.ghost.animate([{ transform: `translate(${from.x}px,${from.y}px) rotate(-14deg)` }, { transform: `translate(${p.x}px,${p.y}px) rotate(-14deg)` }], { duration: 650, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' });
    h.busy = now + 650; Object.assign(h, { x: p.x, y: p.y, placed: true });
  }
  function placeRing(v, r) {
    const st = v.ring.style;
    if (v.hover && !mobile) { st.transform = `translate(${v.cx - r.left}px,${v.cy - r.top}px) scale(1)`; v.ring.classList.add('cursor'); }
    else {
      v.ring.classList.remove('cursor');
      const h = v.hand, x = h.placed ? Math.min(r.width - 90, Math.max(90, h.x + 80)) : r.width / 2, y = h.placed ? Math.min(r.height - 90, Math.max(70, h.y - 80)) : r.height - 100;
      st.transform = `translate(${x}px,${y}px) scale(.9)`;
    }
  }

  // Board motion. Three gentle, critically damped influences, blended in and out so nothing ever snaps:
  // a slow idle sway, a lean toward the mouse while it hovers (not while pressing or scrolling), and a scroll-linked
  // pitch that settles to level as the board reaches the middle of the screen.
  const spring = (pos, vel, to, dt) => { const k = 36, c = 2 * Math.sqrt(k); let v2 = vel + ((to - pos) * k - vel * c) * dt; v2 = Math.max(-2, Math.min(2, v2)); return [pos + v2 * dt, v2]; };
  let lastT = performance.now(), running = true;
  const frame = now => {
    if (!running) return;
    const dt = Math.min(1 / 20, (now - lastT) / 1000); lastT = now;
    canvas.style.transform = `translate3d(0,${scrollY}px,0)`;
    renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
    const scrolling = now - scrolledAt < 180;
    for (const v of views) {
      const r = v.el.getBoundingClientRect();
      const near = r.bottom > -H && r.top < 2 * H, on = r.bottom > -40 && r.top < H + 40 && r.width > 0;
      if (near && !v.game && !v.loading) load(v);
      if (!on || !v.game) continue;
      if (!reduce) {
        const t = now / 1000, blend = (w, to, rate) => w + (to - w) * Math.min(1, dt * rate);
        const hovering = v.hover && !v.down && !scrolling && v.cx >= r.left && v.cx <= r.right && v.cy >= r.top && v.cy <= r.bottom;
        v.hoverW = blend(v.hoverW, hovering ? 1 : 0, hovering ? 2.5 : 4);
        v.idleW = blend(v.idleW, now - v.touched > 5000 && !v.down ? 1 : 0, 0.6);
        const px = Math.max(-1, Math.min(1, ((v.cx - r.left) / r.width) * 2 - 1)), py = Math.max(-1, Math.min(1, ((v.cy - r.top) / r.height) * 2 - 1));
        const off = Math.max(-1, Math.min(1, (r.top + r.height / 2 - H / 2) / H));
        const ty = v.hoverW * px * 0.08 + v.idleW * Math.sin(t * 0.25) * 0.045;
        const tp = v.hoverW * py * 0.05 + off * 0.07;
        [v.yaw, v.vy] = spring(v.yaw, v.vy, ty, dt); [v.pitch, v.vp] = spring(v.pitch, v.vp, tp, dt);
        if (v.auto) { aimHand(v, now); placeRing(v, r); }
      }
      if (v.auto) v.lens.tick(now, reduce);
      v.game.update(dt);
      if (!reduce) applyView(v.game.camera, v.yaw, v.pitch);
      const x = r.left, y = H - r.bottom;
      renderer.setViewport(x, y, r.width, r.height); renderer.setScissor(x, y, r.width, r.height);
      v.game.scene.background = null; v.game.scene.environment = env; v.game.scene.environmentIntensity = 0.55; // backgrounds would paint past the scissor
      renderer.render(v.game.scene, v.game.camera);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { lastT = performance.now(); requestAnimationFrame(frame); } });
}

// Shipped sound effects: decoded once with Web Audio, played only while the visitor has sound on.
// play(name, { rate, volume }) — a little pitch variety keeps repeats from sounding mechanical.
let actx = null;
async function loadSounds(base, map) {
  const bufs = {};
  const ctx = () => (actx = actx || new (window.AudioContext || window.webkitAudioContext)());
  await Promise.all(Object.entries(map).map(async ([k, f]) => {
    try { const ab = await (await fetch(base + f)).arrayBuffer(); bufs[k] = await ctx().decodeAudioData(ab); } catch (e) {}
  }));
  return (name, { rate = 1, volume = 0.7 } = {}) => {
    if (!window.sound?.on || !bufs[name]) return;
    const c = ctx(); if (c.state === 'suspended') c.resume();
    const src = c.createBufferSource(), g = c.createGain(); src.buffer = bufs[name]; src.playbackRate.value = rate; g.gain.value = volume;
    src.connect(g).connect(c.destination); src.start();
  };
}
// Screen shake for the DOM stage (the 3D view follows it because it draws into the stage's rectangle).
function shakeStage(el, amt) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !el.animate) return;
  const a = 6 * amt; el.animate([{ transform: 'translate(0,0)' }, { transform: `translate(${a}px,${-a / 2}px)` }, { transform: `translate(${-a}px,${a / 3}px)` }, { transform: `translate(${a / 2}px,${a / 2}px)` }, { transform: 'translate(0,0)' }], { duration: 260, easing: 'ease-out' });
}
function el(tag, cls) { const e = document.createElement(tag); e.className = cls; return e; }
function button(text, fn, cls) { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.addEventListener('click', fn); return b; }
