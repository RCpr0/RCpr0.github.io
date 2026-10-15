document.documentElement.classList.add('js');
// Videos autoplay (muted, looping) while on screen and pause off screen; tap/Enter toggles; scroll reveals; sticky-nav border.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Sound: off on every visit (browsers refuse unmuted autoplay without a tap), shared by the reel and the playable level.
// SFX are synthesized with Web Audio. The buttons always show whether the reel is actually muted.
window.sound = (() => {
  let on = false, ctx = null;
  const notes = { pick: [[660, .05]], drop: [[520, .04], [780, .07]], nope: [[180, .09]], clear: [[523, .08], [659, .08], [784, .08], [1047, .25]], star: [[1319, .18]],
    tap: [[740, .04], [990, .05]], full: [[880, .05], [1175, .1]], lose: [[392, .12], [330, .12], [262, .3]] };
  const play = name => {
    if (!on || !notes[name]) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      let t = ctx.currentTime;
      for (const [f, d] of notes[name]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = name === 'nope' || name === 'lose' ? 'sawtooth' : 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + d + .08);
        o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + d + .1); t += d;
      }
    } catch (e) {}
  };
  const sync = () => {
    document.querySelectorAll('[data-sound-toggle]').forEach(b => { b.setAttribute('aria-pressed', String(on)); b.querySelector('span').textContent = on ? 'Sound on' : 'Sound off'; });
    document.querySelectorAll('video[data-audio]').forEach(v => { v.muted = !on; });
  };
  const toggle = () => {
    on = !on; sync();
    // Unmuting the reel from the button: start it too, inside this user gesture so the browser allows sound.
    const v = document.querySelector('video[data-audio]');
    if (on && v && v.closest('[data-video]')?.classList.contains('playing')) v.play().catch(() => {});
    play('pick');
  };
  document.querySelectorAll('[data-sound-toggle]').forEach(b => b.addEventListener('click', toggle));
  sync();
  return { play, off: () => { on = false; sync(); }, get on() { return on; } };
})();

const seen = 'IntersectionObserver' in window && !reduce
  ? new IntersectionObserver(es => es.forEach(e => e.target._auto(e.isIntersecting)), { threshold: 0.35 })
  : null;
document.querySelectorAll('[data-video]').forEach(el => {
  const v = el.querySelector('video');
  if (!v) return;
  let held = false; // the viewer paused it, so scrolling back doesn't restart it
  const play = () => {
    el.classList.add('playing');
    v.play().catch(e => { if (e.name === 'AbortError') return; if (v.muted) return el.classList.remove('playing'); v.muted = true; if (v.hasAttribute('data-audio')) window.sound.off(); v.play().catch(() => el.classList.remove('playing')); });
  };
  const stop = () => { el.classList.remove('playing'); v.pause(); };
  const toggle = () => { if (v.paused) { held = false; play(); } else { held = true; stop(); } };
  el._auto = inView => (inView ? !held && play() : stop());
  el.addEventListener('click', toggle);
  // Keyboard access: the tile acts as a play/pause button.
  el.tabIndex = 0; el.setAttribute('role', 'button');
  if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Play or pause video: ' + (el.querySelector('img')?.alt || v.getAttribute('aria-label') || 'gameplay clip'));
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  if (seen) seen.observe(el);
});

const nav = document.querySelector('.nav');
if (nav) addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 8), { passive: true });

if (!reduce && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach(el => io.observe(el));
} else {
  document.querySelectorAll('.reveal').forEach(el => el.classList.add('in'));
}

const y = document.getElementById('year');
if (y) y.textContent = String(new Date().getFullYear());

// Level select: remember which case studies this visitor opened (this browser only) and star them on the home page.
(() => {
  let seen = [];
  try { seen = JSON.parse(localStorage.getItem('cleared') || '[]'); } catch (e) {}
  const here = location.pathname.match(/work\/([\w-]+\.html)$/);
  if (here && !seen.includes(here[1])) { seen.push(here[1]); try { localStorage.setItem('cleared', JSON.stringify(seen)); } catch (e) {} }
  document.querySelectorAll('a.case').forEach(a => {
    const f = (a.getAttribute('href') || '').split('/').pop();
    if (seen.includes(f)) a.classList.add('cleared');
  });
})();

// Store phones: cycle through the store screenshots every few seconds while the phone is on screen.
(() => {
  document.querySelectorAll('[data-cycle]').forEach(ph => {
    const imgs = [...ph.querySelectorAll('img')]; if (imgs.length < 2) return;
    let i = 0, timer = null; imgs[0].classList.add('on');
    const dot = document.createElement('i'); dot.className = 'dot'; ph.append(dot);
    const step = () => {
      const a = imgs[i]; i = (i + 1) % imgs.length; const b = imgs[i];
      imgs.forEach(im => im.classList.remove('out'));
      b.style.transition = 'none'; b.classList.remove('on'); void b.offsetWidth; b.style.transition = '';
      a.classList.remove('on'); a.classList.add('out'); b.classList.add('on');
      dot.style.transform = `translateX(${i * 14}px)`;
    };
    const run = on => { clearInterval(timer); timer = on ? setInterval(step, reduce ? 6000 : 3200) : null; };
    if ('IntersectionObserver' in window) new IntersectionObserver(es => es.forEach(e => run(e.isIntersecting)), { threshold: 0.3 }).observe(ph);
  });
})();

// Game dock + "Play my Games": a tap scrolls to that game with its board on screen (the whole section when it fits,
// otherwise the board centred). The dock shows while any game is on screen and raises the icon of the one in view.
(() => {
  const go = id => {
    const sec = document.getElementById('play-' + id), stage = sec && sec.querySelector('[data-stage]'); if (!sec) return;
    const navH = document.querySelector('.nav')?.offsetHeight || 0, fits = sec.offsetHeight <= innerHeight - navH;
    const el = fits ? sec : stage || sec, r = el.getBoundingClientRect();
    const y = scrollY + r.top - (fits ? navH : (innerHeight - r.height) / 2 + navH / 2);
    scrollTo({ top: Math.max(0, y), behavior: reduce ? 'auto' : 'smooth' });
    history.replaceState(null, '', '#play-' + id);
  };
  document.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', e => { e.preventDefault(); go(a.dataset.goto); }));
  const dock = document.querySelector('[data-dock]'); if (!dock) return;
  const secs = [...document.querySelectorAll('.game-sec')], links = [...dock.querySelectorAll('a')];
  let queued = false;
  const update = () => {
    queued = false;
    let best = null, bestD = Infinity, any = false;
    for (const s of secs) {
      const r = s.getBoundingClientRect();
      if (r.bottom > innerHeight * 0.25 && r.top < innerHeight * 0.75) any = true;
      const d = Math.abs(r.top + r.height / 2 - innerHeight / 2); if (d < bestD) { bestD = d; best = s; }
    }
    dock.classList.toggle('on', any);
    links.forEach(a => a.classList.toggle('cur', any && best && a.getAttribute('href') === '#' + best.id));
  };
  const q = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  addEventListener('scroll', q, { passive: true }); addEventListener('resize', q); update();
})();
