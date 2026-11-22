// Effets visuels et sonores partagés.

export const fx = {
  parts: [],
  floats: [],
  shake: 0,
  burst(x, y, color, n = 14, speed = 260, life = 0.6, size = 6) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, size: size * (0.5 + Math.random()) });
    }
  },
  ring(x, y, color, r = 80, life = 0.4) { this.parts.push({ ring: true, x, y, r, life, max: life, color }); },
  text(x, y, txt, color = '#fff', life = 1) { this.floats.push({ x, y, txt, color, life, max: life }); },
  addShake(v) { this.shake = Math.min(18, this.shake + v); },
  reset() { this.parts = []; this.floats = []; this.shake = 0; },
  update(dt) {
    for (const p of this.parts) {
      p.life -= dt;
      if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; }
    }
    this.parts = this.parts.filter(p => p.life > 0);
    for (const f of this.floats) { f.life -= dt; f.y -= 40 * dt; }
    this.floats = this.floats.filter(f => f.life > 0);
    this.shake = Math.max(0, this.shake - dt * 40);
  },
  // À dessiner dans le repère du monde.
  draw(ctx, scale = 1, textPx = 30) {
    for (const p of this.parts) {
      const k = p.life / p.max;
      ctx.globalAlpha = Math.min(1, k * 1.5);
      if (p.ring) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 8 * k / scale + 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1.2 - k), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.4 + k), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const f of this.floats) {
      ctx.globalAlpha = Math.min(1, f.life / f.max * 2);
      label(ctx, f.txt, f.x, f.y, textPx / scale, f.color);
    }
    ctx.globalAlpha = 1;
  },
};

export function label(ctx, txt, x, y, size, color = '#fff') {
  ctx.font = `800 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size / 4;
  ctx.strokeStyle = 'rgba(10,8,25,.85)';
  ctx.strokeText(txt, x, y);
  ctx.fillStyle = color;
  ctx.fillText(txt, x, y);
}

export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${g},${b})`;
}

// Petit bonhomme rond avec des yeux qui regardent dans la direction (fx, fy).
export function drawBlob(ctx, x, y, r, color, fx = 0, fy = 1, opt = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (opt.scale) ctx.scale(opt.scale, opt.scale);
  // ombre
  ctx.fillStyle = 'rgba(0,0,0,.28)';
  ctx.beginPath(); ctx.ellipse(0, r * 0.75, r * 0.95, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  // corps
  const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  g.addColorStop(0, shade(color, 60));
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = r * 0.12;
  ctx.strokeStyle = shade(color, -70);
  ctx.stroke();
  if (opt.me) {
    ctx.lineWidth = r * 0.14;
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, r + r * 0.22, 0, Math.PI * 2); ctx.stroke();
  }
  // yeux
  const ex = fx * r * 0.28, ey = fy * r * 0.28;
  for (const s of [-1, 1]) {
    const px = -fy * s * r * 0.36 + ex, py = fx * s * r * 0.36 + ey;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    if (opt.dizzy) ctx.arc(px, py - r * 0.1, r * 0.2, 0, Math.PI * 2);
    else ctx.ellipse(px, py - r * 0.1, r * 0.2, r * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14112b';
    if (opt.dizzy) {
      ctx.font = `800 ${r * 0.35}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('×', px, py - r * 0.1);
    } else {
      ctx.beginPath(); ctx.arc(px + fx * r * 0.08, py - r * 0.1 + fy * r * 0.08, r * 0.1, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Sons synthétisés (aucun fichier audio).
let actx = null;
let muted = false;
try { muted = localStorage.getItem('pr_muted') === '1'; } catch { /* rien */ }
export const sound = {
  get muted() { return muted; },
  toggle() { muted = !muted; try { localStorage.setItem('pr_muted', muted ? '1' : '0'); } catch { /* rien */ } return muted; },
  unlock() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
    if (actx.state === 'suspended') actx.resume();
  },
  play(kind) {
    if (muted || !actx || actx.state !== 'running') return;
    const t = actx.currentTime;
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.connect(g); g.connect(actx.destination);
    const set = (type, f1, f2, dur, vol = 0.12) => {
      o.type = type;
      o.frequency.setValueAtTime(f1, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur + 0.02);
    };
    switch (kind) {
      case 'dash': set('sawtooth', 220, 600, 0.12, 0.05); break;
      case 'bump': set('square', 160, 60, 0.12, 0.07); break;
      case 'hit': set('square', 320, 90, 0.1, 0.09); break;
      case 'fall': set('sine', 600, 80, 0.6, 0.12); break;
      case 'boom': set('sawtooth', 120, 30, 0.6, 0.2); break;
      case 'pass': set('triangle', 500, 900, 0.08, 0.08); break;
      case 'tick': set('sine', 900, 900, 0.05, 0.05); break;
      case 'play': set('triangle', 400, 700, 0.1, 0.07); break;
      case 'coin': set('square', 900, 1400, 0.08, 0.04); break;
      case 'win': set('triangle', 500, 1200, 0.5, 0.12); break;
      case 'shot': set('triangle', 700, 300, 0.05, 0.025); break;
      case 'skid': set('sawtooth', 1250, 820, 0.16, 0.022); break;
      case 'cash': // "ka-ching" : deux notes aiguës
        o.type = 'square';
        o.frequency.setValueAtTime(1250, t);
        o.frequency.setValueAtTime(1870, t + 0.07);
        g.gain.setValueAtTime(0.05, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
        o.start(t); o.stop(t + 0.28);
        break;
      case 'siren': // deux tons qui alternent
        o.type = 'square';
        for (let k = 0; k < 6; k++) o.frequency.setValueAtTime(k % 2 ? 620 : 830, t + k * 0.13);
        g.gain.setValueAtTime(0.045, t);
        g.gain.setValueAtTime(0.045, t + 0.6);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
        o.start(t); o.stop(t + 0.82);
        break;
      default: set('sine', 440, 440, 0.05, 0.03);
    }
  },
};
