document.documentElement.classList.add('js');
// Videos autoplay (muted, looping) while on screen and pause off screen; tap/Enter toggles; scroll reveals; sticky-nav border.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

const seen = 'IntersectionObserver' in window && !reduce
  ? new IntersectionObserver(es => es.forEach(e => e.target._auto(e.isIntersecting)), { threshold: 0.35 })
  : null;
document.querySelectorAll('[data-video]').forEach(el => {
  const v = el.querySelector('video');
  if (!v) return;
  let held = false; // the viewer paused it, so scrolling back doesn't restart it
  const play = () => { el.classList.add('playing'); v.play().catch(() => {}); };
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
