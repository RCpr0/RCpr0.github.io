document.documentElement.classList.add('js');
// Prototype videos play on hover (desktop) or tap (touch); scroll reveals; sticky-nav border.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

document.querySelectorAll('[data-video]').forEach(el => {
  const v = el.querySelector('video');
  if (!v) return;
  const play = () => { el.classList.add('playing'); v.play().catch(() => {}); };
  const stop = () => { el.classList.remove('playing'); v.pause(); };
  // Hover only for real mice; a touch tap also emits compatibility mouse events, which would otherwise play-then-pause.
  if (!reduce) {
    el.addEventListener('pointerenter', e => e.pointerType === 'mouse' && play());
    el.addEventListener('pointerleave', e => e.pointerType === 'mouse' && stop());
  }
  el.addEventListener('click', () => (v.paused ? play() : stop()));
  // Keyboard access: the tile acts as a play/pause button.
  el.tabIndex = 0; el.setAttribute('role', 'button');
  if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Play or pause video: ' + (el.querySelector('img')?.alt || 'gameplay clip'));
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); v.paused ? play() : stop(); } });
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
