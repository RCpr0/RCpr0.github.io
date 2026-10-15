// The "jump in" lens, Matrix style: a black glass lens with green code raining inside it, a red pill at its heart, a label that keeps decoding itself out of scrambled glyphs
// and a typed terminal prompt under it. When the visitor takes over, the bot "dissolves": code rains down the whole
// stage for a moment and YOU'RE IN decodes over the board.
const GLYPHS = 'アカサタナハマヤラワイキシチニヒミリウクスツヌフムユルエケセテネヘメレオコソトノホモヨロ0123456789Z:.=*+<>';
const glyph = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];

export function makeLens(mobile) {
  const ring = document.createElement('div'); ring.className = 'arcade-ring';
  ring.innerHTML = '<canvas class="mx-rain"></canvas>' +
    '<i class="mx-pill"></i><b class="mx-label">JUMP IN</b><em class="mx-cap"></em>';
  const cv = ring.querySelector('canvas'), S = 104, dpr = 2;
  cv.width = cv.height = S * dpr;
  const c = cv.getContext('2d'); c.scale(dpr, dpr);
  const cols = Math.floor(S / 9), drops = Array.from({ length: cols }, () => -Math.random() * 14);
  const label = ring.querySelector('.mx-label'), cap = ring.querySelector('.mx-cap');
  const prompt = (mobile ? '> tap to take over' : '> click to take over');
  return {
    el: ring,
    last: 0, decodeAt: 0, decodeT0: -1, typeT0: -1, shown: '', typed: -1,
    // Called every frame while the bot is playing and the stage is on screen.
    tick(now, reduce) {
      if (this.typeT0 < 0) this.typeT0 = now + 400;
      if (reduce) { if (this.typed !== prompt.length) { this.typed = prompt.length; cap.textContent = prompt; this.rain(); } return; }
      // Rain at ~22 fps; trails fade towards the lens' black.
      if (now - this.last > 45) { this.last = now; this.rain(); }
      // The label scrambles and decodes left to right every few seconds.
      if (now > this.decodeAt) { this.decodeT0 = now; this.decodeAt = now + 3600; ring.classList.remove('glitch'); void ring.offsetWidth; ring.classList.add('glitch'); }
      const text = decoded('JUMP IN', (now - this.decodeT0) / 650);
      if (text !== this.shown) { this.shown = text; label.textContent = text; }
      const n = Math.max(0, Math.min(prompt.length, Math.floor((now - this.typeT0) / 42)));
      if (n !== this.typed) { this.typed = n; cap.textContent = prompt.slice(0, n); }
    },
    rain() {
      c.fillStyle = 'rgba(1,10,4,0.24)'; c.fillRect(0, 0, S, S);
      c.font = '700 10px ui-monospace, Menlo, monospace'; c.textBaseline = 'top';
      for (let i = 0; i < cols; i++) {
        const y = drops[i] * 10, x = i * 9 + 1;
        c.fillStyle = '#21d957'; c.fillText(glyph(), x, y - 10);
        c.fillStyle = '#e4ffec'; c.fillText(glyph(), x, y);
        drops[i] += 1;
        if (y > S && Math.random() > 0.85) drops[i] = -Math.random() * 4;
      }
    },
  };
}

// text with the first `k` (0..1 of its length) characters resolved and the rest scrambled. Spaces stay spaces.
export function decoded(text, k) {
  if (k >= 1) return text;
  const n = Math.max(0, Math.floor(k * text.length));
  let out = text.slice(0, n);
  for (let i = n; i < text.length; i++) out += text[i] === ' ' ? ' ' : glyph();
  return out;
}

// Takeover: a short burst of code rain over the whole stage, fading out; YOU'RE IN decodes in the middle.
export function dissolve(ui, yay, reduce) {
  yay.classList.remove('go'); void yay.offsetWidth; yay.classList.add('go');
  if (reduce) { yay.textContent = "YOU'RE IN"; return; }
  const t0 = performance.now(), word = "YOU'RE IN";
  const r = ui.getBoundingClientRect(), cv = document.createElement('canvas'); cv.className = 'mx-burst';
  const dpr = Math.min(2, devicePixelRatio || 1), W = Math.max(1, r.width), H = Math.max(1, r.height);
  cv.width = W * dpr; cv.height = H * dpr; ui.append(cv);
  const c = cv.getContext('2d'); c.scale(dpr, dpr);
  const cw = 15, cols = Math.ceil(W / cw), drops = Array.from({ length: cols }, () => -Math.random() * 8), speed = Array.from({ length: cols }, () => 0.7 + Math.random() * 0.9);
  let last = 0;
  const step = now => {
    const age = now - t0;
    yay.textContent = decoded(word, (age - 120) / 520);
    if (now - last > 33) {
      last = now;
      c.globalCompositeOperation = 'destination-out'; c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(0, 0, W, H);
      c.globalCompositeOperation = 'source-over'; c.font = '700 14px ui-monospace, Menlo, monospace'; c.textBaseline = 'top';
      for (let i = 0; i < cols; i++) {
        const y = drops[i] * 16;
        if (age < 650) { c.fillStyle = '#04150a'; c.fillText(glyph(), i * cw, y); c.fillStyle = '#0fbf45'; c.fillText(glyph(), i * cw, y - 16); }
        drops[i] += speed[i] * 1.6;
      }
    }
    if (age < 1300) requestAnimationFrame(step); else { cv.remove(); yay.textContent = word; }
  };
  requestAnimationFrame(step);
}
