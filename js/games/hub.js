// Arcade in the hero: playable versions of shipped games. One shared WebGL renderer; each game is a module loaded
// when its tab is picked. Games run in attract mode (a bot plays) until the visitor taps, then restart for them.
import * as THREE from 'three';

const GAMES = [
  { id: 'sandflow', name: 'Sand Flow', icon: 'media/store/icon-sandflow.webp', how: 'Tap a cart with a clear path. It rides the belt and collects its colour.' },
  { id: 'yarn', name: 'Yarn Collect', icon: 'media/store/icon-yarncollect.webp', how: 'Tap a basket to send its top yarn onto the road. Yarn drops into a basket showing its colour.' },
  { id: 'mice', name: 'Mice Flow', icon: 'media/store/icon-miceflow.webp', how: 'Tap a house with a clear path up. Its mice carry away blocks of their colour from the edge of the picture.' },
  { id: 'kitty', name: 'KittyDoku', icon: 'media/store/icon-kittydoku.webp', how: 'Pick a cat in the tray, then tap a square. One cat per colour, no two touching, and no cat may see another.' },
];

const root = document.getElementById('arcade');
if (root) init();

function init() {
  const screen = root.querySelector('.arcade-screen'), tabs = root.querySelector('.arcade-tabs'), how = root.querySelector('.arcade-how');
  const ui = root.querySelector('.arcade-ui'), canvas = document.createElement('canvas');
  canvas.className = 'arcade-canvas'; screen.prepend(canvas);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' }); }
  catch (e) { root.classList.add('no-webgl'); return; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  let game = null, current = null, running = false, visible = true, last = 0, token = 0;
  const sound = name => window.sound && window.sound.play(name);
  const size = () => ({ w: screen.clientWidth, h: screen.clientHeight });
  const resize = () => { const { w, h } = size(); renderer.setSize(w, h, false); game?.resize(w, h); };

  // Shared overlay: level pill, attract prompt, result card.
  const pill = el('div', 'arcade-pill'), prompt = el('button', 'arcade-prompt'), card = el('div', 'arcade-card');
  prompt.type = 'button'; prompt.innerHTML = '<b>▶ Tap to play</b><span>A bot is playing. Your turn?</span>';
  ui.append(pill, prompt, card); card.hidden = true;
  const api = {
    THREE, renderer, canvas, ui, sound, reduce,
    setLevel: t => { pill.textContent = t; },
    result({ win, title, sub, next, retry }) {
      card.className = 'arcade-card ' + (win ? 'win' : 'lose');
      card.innerHTML = `<b>${title}</b><p>${sub || ''}</p>`;
      if (next) card.append(button(win ? 'Next level →' : 'Retry', next, 'btn'));
      if (retry && win) card.append(button('Replay', retry, 'btn o'));
      card.hidden = false; sound(win ? 'clear' : 'lose');
      card.querySelector('button')?.focus({ preventScroll: true });
    },
    hideResult: () => { card.hidden = true; },
  };

  const select = async id => {
    const my = ++token, meta = GAMES.find(g => g.id === id);
    tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.id === id)));
    how.textContent = meta.how; root.classList.add('loading'); card.hidden = true;
    game?.destroy(); game = null; renderer.clear();
    const mod = await import(`./${id}/game.js`);
    if (my !== token) return;
    const { w, h } = size();
    game = await mod.create({ ...api, base: `media/games/${id}/`, w, h }); game.id = id;
    if (my !== token) { game.destroy(); return; }
    current = id; root.classList.remove('loading'); resize();
    attract(!reduce);
    window.__arcade.current = game;
  };
  // Attract mode: the bot plays until the first tap, then the level restarts for the visitor.
  const attract = on => { root.classList.toggle('attract', on); prompt.hidden = !on; game?.autoplay(on); };
  prompt.addEventListener('click', () => { attract(false); game.restart(); canvas.focus?.(); });
  canvas.addEventListener('pointerdown', () => { if (root.classList.contains('attract')) { attract(false); game.restart(); } }, true);

  GAMES.forEach(g => {
    const b = button('', () => select(g.id), 'arcade-tab');
    b.dataset.id = g.id; b.setAttribute('role', 'tab'); b.setAttribute('aria-label', g.name);
    b.innerHTML = `<img src="${g.icon}" alt=""><span>${g.name}</span>`;
    tabs.append(b);
  });

  // Run only while the arcade is on screen and the tab is visible.
  const loop = t => {
    if (!running) return;
    const dt = Math.min(0.1, (t - last) / 1000 || 0); last = t;
    if (game) { game.update(dt); renderer.render(game.scene, game.camera); }
    requestAnimationFrame(loop);
  };
  const setRunning = () => {
    const on = visible && !document.hidden;
    if (on && !running) { running = true; last = performance.now(); requestAnimationFrame(loop); }
    running = on;
  };
  new IntersectionObserver(es => { visible = es[0].isIntersecting; setRunning(); }, { threshold: 0.05 }).observe(screen);
  document.addEventListener('visibilitychange', setRunning);
  new ResizeObserver(resize).observe(screen);

  window.__arcade = { select, current: null, attract };
  select(GAMES[0].id);
}

function el(tag, cls) { const e = document.createElement(tag); e.className = cls; return e; }
function button(text, fn, cls) { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = text; b.addEventListener('click', fn); return b; }
