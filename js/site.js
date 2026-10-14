document.documentElement.classList.add('js');
// Videos autoplay (muted, looping) while on screen and pause off screen; tap/Enter toggles; scroll reveals; sticky-nav border.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Sound: off by default, one preference for the reel and the playable level. SFX are synthesized with Web Audio.
window.sound = (() => {
  let on = false, ctx = null;
  try { on = localStorage.getItem('sound') === 'on'; } catch (e) {}
  const notes = { pick: [[660, .05]], drop: [[520, .04], [780, .07]], nope: [[180, .09]], clear: [[523, .08], [659, .08], [784, .08], [1047, .25]], star: [[1319, .18]] };
  const play = name => {
    if (!on || !notes[name]) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      let t = ctx.currentTime;
      for (const [f, d] of notes[name]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = name === 'nope' ? 'sawtooth' : 'triangle'; o.frequency.value = f;
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
    on = !on; try { localStorage.setItem('sound', on ? 'on' : 'off'); } catch (e) {}
    sync();
    // Unmuting the reel from the button: start it too, inside this user gesture so the browser allows sound.
    const v = document.querySelector('video[data-audio]');
    if (on && v && v.closest('[data-video]')?.classList.contains('playing')) v.play().catch(() => {});
    play('pick');
  };
  document.querySelectorAll('[data-sound-toggle]').forEach(b => b.addEventListener('click', toggle));
  sync();
  return { play, get on() { return on; } };
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
    v.play().catch(e => { if (e.name === 'AbortError') return; if (v.muted) return el.classList.remove('playing'); v.muted = true; v.play().catch(() => el.classList.remove('playing')); });
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
