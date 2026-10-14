// KittyDoku rule cards, in the shipped game's card language (the cream Rule cards with brown lettering, the
// UnlockMechanicView picture + name + description, the red OverrideLegendRow flash): each NEW rule deals in as a big
// card along the top of the stage, holds, then shrinks into its chip in the dock; rules already taught pop straight
// into the dock. The dock is a row of small illustrated chips across the top band (the camera keeps that band clear
// of the board). A chip flashes red and shakes when a drop breaks its rule; tapping a chip shows its card again.
const CSS = `
.kd-dock { position: absolute; top: 8px; left: 64px; right: 10px; height: 74px; display: flex; justify-content: center; align-items: flex-start; gap: 6px; pointer-events: none !important; z-index: 1; }
.kd-chip { position: relative; pointer-events: auto; flex: 0 1 84px; min-width: 0; height: 72px; padding: 5px 4px 5px; border: 0; border-radius: 15px; cursor: pointer;
  background: linear-gradient(#fffdf6, #fff3dc); box-shadow: inset 0 0 0 2px #ffffff, 0 3px 0 #e8c08c, 0 7px 14px rgba(90, 45, 10, .18);
  display: flex; flex-direction: column; align-items: center; justify-content: space-between; color: #7b3f1d; font: 400 10.5px/1.02 'Russo One', var(--display, sans-serif);
  text-align: center; letter-spacing: .01em; transform-origin: 50% 40%; -webkit-tap-highlight-color: transparent; }
.kd-chip img { height: 38px; flex: none; width: 100%; object-fit: contain; display: block; filter: drop-shadow(0 2px 1px rgba(90, 45, 10, .18)); pointer-events: none; }
.kd-chip span { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 2.04em; overflow: hidden; }
.kd-chip:hover { transform: translateY(-2px); }
.kd-chip:focus-visible { outline: 3px solid #ffb547; outline-offset: 2px; }
.kd-chip.kd-off { visibility: hidden; }
.kd-chip.kd-bad { animation: kd-shake .5s cubic-bezier(.36, .07, .19, .97) both, kd-red .25s ease-in-out 4 alternate; }
.kd-new { position: absolute; top: -8px; right: -9px; padding: 3px 6px 2px; border-radius: 8px; background: #ff4d6d; color: #fff; font: 400 9px/1 'Russo One', var(--display, sans-serif);
  letter-spacing: .06em; transform: rotate(12deg); box-shadow: 0 2px 0 #b8203f; pointer-events: none; }
.kd-show { position: absolute; top: 6px; left: 50%; width: min(460px, calc(100% - 128px)); height: 104px; margin-left: calc(min(460px, calc(100% - 128px)) / -2 + 27px);
  display: flex; align-items: stretch; gap: 10px; padding: 8px 12px 8px 8px; border-radius: 20px; pointer-events: none !important; z-index: 2;
  background: linear-gradient(#fffdf6, #fff1d6); box-shadow: inset 0 0 0 3px #ffffff, 0 5px 0 #e8c08c, 0 14px 28px rgba(90, 45, 10, .28); color: #7b3f1d; transform-origin: 50% 50%; }
.kd-show .kd-art { flex: 0 0 38%; border-radius: 14px; background: radial-gradient(circle at 50% 40%, #ffffff, #ffe6bf); display: grid; place-items: center; overflow: hidden; }
.kd-show .kd-art img { width: 92%; height: 92%; object-fit: contain; filter: drop-shadow(0 3px 2px rgba(90, 45, 10, .2)); }
.kd-show .kd-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 3px; }
.kd-show b { font: 400 18px/1.05 'Russo One', var(--display, sans-serif); color: #8a3d16; }
.kd-show p { margin: 0; font: 700 13.5px/1.25 var(--body, sans-serif); color: #7b4a2b; }
.kd-show .kd-new { top: -9px; right: -6px; font-size: 11px; padding: 4px 8px 3px; }
.kd-narrow .kd-show { width: calc(100% - 74px); margin-left: calc((100% - 74px) / -2 + 27px); }
.kd-narrow .kd-show b { font-size: 15px; } .kd-narrow .kd-show p { font-size: 11.5px; }
.kd-narrow .kd-chip { flex-basis: 64px; height: 66px; font-size: 9.5px; } .kd-narrow .kd-chip img { height: 32px; }
.kd-lives { top: auto !important; bottom: 10px; right: 10px; }
.kd-narrow .kd-lives { width: 64px; flex-wrap: wrap; justify-content: center; padding: 5px 6px; row-gap: 3px; }
.kd-narrow .kd-lives i { font-size: 14px; } .kd-narrow .kd-lives b { margin-left: 0; width: 100%; text-align: center; }
.kd-narrow .kd-show { height: 96px; }
@keyframes kd-shake { 10%, 90% { transform: translateX(-1px) rotate(-2deg); } 20%, 80% { transform: translateX(3px) rotate(3deg); } 30%, 50%, 70% { transform: translateX(-5px) rotate(-5deg) scale(1.08); } 40%, 60% { transform: translateX(5px) rotate(5deg) scale(1.08); } }
@keyframes kd-red { to { background: #ff4242; color: #fff; box-shadow: inset 0 0 0 2px #ffd0d0, 0 3px 0 #b3202c, 0 7px 14px rgba(150, 20, 30, .35); } }
@media (prefers-reduced-motion: reduce) { .kd-chip.kd-bad { animation: kd-red .25s ease-in-out 4 alternate; } }
`;

export function createCards(ui, base, reduce) {
  if (!document.getElementById('kd-style')) { const s = document.createElement('style'); s.id = 'kd-style'; s.textContent = CSS; document.head.append(s); }
  const dock = document.createElement('div'); dock.className = 'kd-dock'; ui.append(dock);
  let chips = new Map(), shows = [], timers = [], gen = 0;
  const later = (ms, fn) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  const clear = () => { timers.forEach(clearTimeout); timers = []; shows.forEach(s => s.remove()); shows = []; };

  function chip(key, rule, fresh) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'kd-chip';
    b.setAttribute('aria-label', `${rule.title}: ${rule.text}`); b.title = rule.text;
    b.innerHTML = `<img src="${base}${rule.icon}" alt="" draggable="false"><span>${rule.label}</span>` + (fresh ? '<i class="kd-new">NEW</i>' : '');
    b.addEventListener('click', e => { e.stopPropagation(); replay(key); });
    return b;
  }
  function card(rule, fresh) {
    const s = document.createElement('div'); s.className = 'kd-show'; s.setAttribute('aria-hidden', 'true');
    s.innerHTML = `<div class="kd-art"><img src="${base}${rule.art}" alt="" draggable="false"></div><div class="kd-txt"><b>${rule.title}</b><p>${rule.text}</p></div>` + (fresh ? '<i class="kd-new">NEW</i>' : '');
    ui.append(s); shows.push(s); return s;
  }
  // Deal a big card in, hold it, then fly it into its chip (FLIP: scale and move onto the chip's rectangle).
  function deal(rule, fresh, into, at, hold) {
    later(at * 1000, () => {
      const s = card(rule, fresh);
      if (reduce) { later(hold * 1000, () => { s.remove(); into?.classList.remove('kd-off'); }); return; }
      s.animate([{ transform: 'translateY(-140%) rotate(-8deg) scale(.55)', opacity: 0 }, { transform: 'translateY(6%) rotate(1.5deg) scale(1.03)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }],
        { duration: 480, easing: 'cubic-bezier(.25,.9,.35,1)' });
      s.querySelector('.kd-new')?.animate([{ transform: 'rotate(40deg) scale(0)' }, { transform: 'rotate(4deg) scale(1.5)', offset: 0.6 }, { transform: 'rotate(12deg) scale(1)' }], { duration: 420, delay: 300, easing: 'ease-out', fill: 'backwards' });
      later(hold * 1000, () => {
        if (!into || !into.isConnected) { s.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(-30%) scale(.8)' }], { duration: 260, fill: 'forwards' }); later(270, () => s.remove()); return; }
        const a = s.getBoundingClientRect(), b = into.getBoundingClientRect();
        const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2), k = b.height / a.height;
        s.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(${k})`, opacity: 0.2 }], { duration: 380, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' });
        later(360, () => { s.remove(); into.classList.remove('kd-off'); pop(into); });
      });
    });
  }
  const pop = el => { if (!reduce) el.animate([{ transform: 'scale(.2)' }, { transform: 'scale(1.18)', offset: 0.6 }, { transform: 'scale(1)' }], { duration: 360, easing: 'ease-out' }); };
  let current = [];
  // Show a level's rules. Returns how long the deal-in takes (seconds), which the bot waits out.
  function show(rules, timing) {
    clear(); gen++; dock.replaceChildren(); chips = new Map(); current = rules;
    const anyBaseFresh = rules.some(r => r.base && r.fresh);
    const keys = [];
    for (const r of rules) {
      if (r.base && !anyBaseFresh) { if (!keys.includes('basics')) keys.push('basics'); continue; }
      keys.push(r.id);
    }
    const basics = { title: 'The three rules', label: 'Basics', icon: 'rule-basics.webp', text: rules.filter(r => r.base).map(r => r.text).join('. ') + '.' };
    let t = timing.boardIn;
    keys.forEach((key, n) => {
      const r = key === 'basics' ? basics : rules.find(x => x.id === key), fresh = key !== 'basics' && r.fresh;
      const c = chip(key, r, fresh); c.classList.add('kd-off'); dock.append(c); chips.set(key, c);
      if (fresh) { deal(r, true, c, t, timing.card - 0.4); t += timing.card; }
      else later((timing.boardIn * 0.5 + n * timing.cardOld) * 1000, () => { c.classList.remove('kd-off'); pop(c); });
    });
  }
  // Tap a docked chip: its card again (the three base rules in turn for the basics chip).
  function replay(key) {
    clear(); chips.forEach(c => c.classList.remove('kd-off'));
    const list = key === 'basics' ? current.filter(r => r.base) : current.filter(r => r.id === key);
    list.forEach((r, n) => deal(r, false, chips.get(key), n * 1.5, 1.3));
  }
  // A drop broke this rule: its chip (or the basics chip) flashes red and shakes, as OverrideLegendRow.Flash does.
  function flash(id) {
    const c = chips.get(id) || (['colour', 'touch', 'sight'].includes(id) ? chips.get('basics') : null); if (!c) return;
    c.classList.remove('kd-bad'); void c.offsetWidth; c.classList.add('kd-bad');
    later(1100, () => c.classList.remove('kd-bad'));
  }
  return {
    show, flash, dock,
    resize(w) { ui.classList.toggle('kd-narrow', w < 470); },
    destroy() { clear(); dock.remove(); ui.classList.remove('kd-narrow'); document.getElementById('kd-style')?.remove(); },
  };
}
