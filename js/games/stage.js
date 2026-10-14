// One fixed, transparent WebGL canvas for the whole page. Each game section has an empty stage element; every frame the
// game is drawn into that element's rectangle, so boards float straight on the section colour with no frame around
// them. Games load as their section nears the screen, only on-screen games update, and a bot plays each one until
// the visitor touches it.
import * as THREE from 'three';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { applyView } from './common.js';

const stages = [...document.querySelectorAll('[data-stage]')];
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
  const size = () => { renderer.setSize(innerWidth, innerHeight, false); };
  size(); addEventListener('resize', () => { size(); views.forEach(v => v.game?.resize()); });

  const views = stages.map(el => ({ el, id: el.dataset.stage, game: null, loading: false, auto: !reduce, yaw: 0, pitch: 0, vy: 0, vp: 0, px: 0, py: 0, hover: false, touched: 0 }));
  window.__arcade = { games: {}, current: null, use(id) { this.current = this.games[id] || null; return !!this.current; } };

  for (const v of views) {
    const ui = v.el.querySelector('.arcade-ui');
    const pill = el('div', 'arcade-pill'), prompt = el('button', 'arcade-prompt'), card = el('div', 'arcade-card');
    prompt.type = 'button'; prompt.innerHTML = '<b>▶ Tap to play</b><span>A bot is playing. Your turn?</span>';
    ui.append(pill, prompt, card); card.hidden = true; prompt.hidden = reduce;
    Object.assign(v, { ui, pill, prompt, card });
    const takeOver = () => { if (!v.auto || !v.game) return; v.auto = false; v.el.classList.remove('attract'); prompt.hidden = true; v.game.autoplay(false); v.game.restart(); };
    prompt.addEventListener('click', takeOver);
    v.el.addEventListener('pointerdown', e => { if (v.auto && !e.target.closest('button')) takeOver(); }, true);
    // Pointer tilt: the board leans toward the pointer while it is over the stage.
    v.el.addEventListener('pointermove', e => { const r = v.el.getBoundingClientRect(); v.px = ((e.clientX - r.left) / r.width) * 2 - 1; v.py = ((e.clientY - r.top) / r.height) * 2 - 1; v.hover = true; v.touched = performance.now(); });
    v.el.addEventListener('pointerleave', () => { v.hover = false; });
  }

  async function load(v) {
    v.loading = true; v.el.classList.add('loading');
    const mod = await import(`./${v.id}/game.js`);
    const api = {
      THREE, renderer, env, el: v.el, canvas: v.el, ui: v.ui, sound, reduce, base: `media/games/${v.id}/`,
      setLevel: t => { v.pill.textContent = t; },
      result({ win, title, sub, next, retry, last }) {
        v.card.className = 'arcade-card ' + (win ? 'win' : 'lose');
        v.card.innerHTML = `<b>${title}</b><p>${sub || ''}</p>`;
        if (next) v.card.append(button(win ? (last ? 'Play again' : 'Next level →') : 'Retry', next, 'btn'));
        if (retry && win && !last) v.card.append(button('Replay', retry, 'btn o'));
        v.card.hidden = false; if (!v.auto) sound(win ? 'clear' : 'lose');
        v.card.querySelector('button')?.focus({ preventScroll: true });
      },
      hideResult: () => { v.card.hidden = true; },
    };
    v.game = await mod.create(api); v.game.id = v.id;
    v.el.classList.remove('loading'); v.el.classList.toggle('attract', v.auto);
    v.game.autoplay(v.auto);
    window.__arcade.games[v.id] = v.game; if (!window.__arcade.current) window.__arcade.current = v.game;
  }

  let last = performance.now(), running = true;
  const frame = now => {
    if (!running) return;
    const dt = Math.min(1 / 20, (now - last) / 1000); last = now;
    renderer.setScissorTest(false); renderer.clear(); renderer.setScissorTest(true);
    const H = innerHeight, W = innerWidth;
    for (const v of views) {
      const r = v.el.getBoundingClientRect();
      const near = r.bottom > -H && r.top < 2 * H, on = r.bottom > -40 && r.top < H + 40 && r.width > 0;
      if (near && !v.game && !v.loading) load(v);
      if (!on || !v.game) continue;
      // Idle sway until touched; a spring toward the pointer while hovering (k 70, c 9, up to 6 degrees).
      const t = now / 1000, idle = !reduce && now - v.touched > 4000;
      const ty = (v.hover ? v.px * 0.1 : 0) + (idle ? Math.sin(t * 0.3) * 0.06 : 0), tp = v.hover ? v.py * 0.06 : 0;
      v.vy += ((ty - v.yaw) * 70 - v.vy * 9) * dt; v.yaw += v.vy * dt;
      v.vp += ((tp - v.pitch) * 70 - v.vp * 9) * dt; v.pitch += v.vp * dt;
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
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { last = performance.now(); requestAnimationFrame(frame); } });
}

function el(tag, cls) { const e = document.createElement(tag); e.className = cls; return e; }
function button(text, fn, cls) { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.addEventListener('click', fn); return b; }
