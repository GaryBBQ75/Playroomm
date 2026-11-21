// Rendu de Mini Clash.
import { fx, label, sound, roundRect } from '../lib/fx.js';

const FW = 600, FH = 1000, RIVER = 500;
const BRIDGES = [140, 460];
const TEAM = ['#3a86ff', '#ff4d6d'];
export const CARDS = {
  knight: { name: 'Chevalier', emoji: '🛡️', cost: 3 },
  archers: { name: 'Archères', emoji: '🏹', cost: 3 },
  giant: { name: 'Géant', emoji: '🗿', cost: 5 },
  goblins: { name: 'Gobelins', emoji: '👺', cost: 2 },
  wizard: { name: 'Sorcier', emoji: '🧙', cost: 4 },
  fireball: { name: 'Feu', emoji: '☄️', cost: 4, spell: true },
};

let L = { s: 1, ox: 0, oy: 0, flip: false };
let selected = -1;
let lines = [];
let api = null;
let bar = null;
let lastHandKey = '';
let lastPriv = null;
let ghost = null;

export function layout(w, h, portrait) {
  const top = 54, bottom = portrait ? 150 : 8, side = portrait ? 0 : 236;
  const s = Math.min((w - side - 8) / FW, (h - top - bottom) / FH);
  L.s = s;
  L.ox = (w - side - FW * s) / 2;
  L.oy = top + (h - top - bottom - FH * s) / 2;
}

function P(x, y) {
  if (L.flip) { x = FW - x; y = FH - y; }
  return [L.ox + x * L.s, L.oy + y * L.s];
}
function inv(sx, sy) {
  let x = (sx - L.ox) / L.s, y = (sy - L.oy) / L.s;
  if (L.flip) { x = FW - x; y = FH - y; }
  return [x, y];
}

export function mount(el, a) {
  api = a;
  bar = el;
  selected = -1;
  lastHandKey = '';
  lines = [];
  el.innerHTML = `
    <div class="energy"><i id="cl-en"></i>${Array.from({ length: 9 }, (_, i) => `<span style="left:${(i + 1) * 10}%"></span>`).join('')}<b id="cl-en-n">0</b></div>
    <div class="hand" id="cl-hand"></div>`;
}

function renderHand(priv) {
  const key = priv.hand.join(',') + '|' + priv.next + '|' + selected;
  if (key === lastHandKey) return;
  lastHandKey = key;
  const hand = bar.querySelector('#cl-hand');
  hand.innerHTML = priv.hand.map((k, i) => {
    const c = CARDS[k];
    return `<button class="cardbtn ${i === selected ? 'sel' : ''}" data-i="${i}" data-cost="${c.cost}"><span class="c">${c.cost}</span><span class="e">${c.emoji}</span><span class="n">${c.name}</span></button>`;
  }).join('') + `<div class="nextcard">Suiv.<div>${CARDS[priv.next]?.emoji || ''}</div></div>`;
  hand.querySelectorAll('.cardbtn').forEach(b => {
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      const i = Number(b.dataset.i);
      selected = selected === i ? -1 : i;
      sound.play('tick');
      lastHandKey = '';
      renderHand(lastPriv);
    });
  });
}

export function update(view) {
  const priv = view.priv;
  if (!priv || !bar) return;
  lastPriv = priv;
  L.flip = priv.team === 1;
  renderHand(priv);
  const en = bar.querySelector('#cl-en');
  en.style.transform = `scaleX(${priv.energy / 10})`;
  bar.querySelector('#cl-en-n').textContent = Math.floor(priv.energy);
  bar.querySelectorAll('.cardbtn').forEach(b => b.classList.toggle('poor', Number(b.dataset.cost) > priv.energy));
}

export function tap(sx, sy, view) {
  if (selected < 0 || !view.priv) return;
  const [x, y] = inv(sx, sy);
  if (x < 0 || x > FW || y < 0 || y > FH) return;
  const key = view.priv.hand[selected];
  const c = CARDS[key];
  const own = view.priv.team === 0 ? y > RIVER + 30 : y < RIVER - 30;
  if (!c.spell && !own) {
    api.toast('Pose tes troupes dans ta moitié du terrain');
    return;
  }
  if (view.priv.energy < c.cost) { api.toast('Pas assez d\'énergie ⚡'); return; }
  api.act({ t: 'play', i: selected, x: Math.round(x), y: Math.round(y) });
  ghost = { x, y, t: performance.now(), emoji: c.emoji };
  selected = -1;
  lastHandKey = '';
}

export function onEvent(ev, view) {
  const myTeam = view.priv?.team;
  switch (ev.t) {
    case 'shot':
      lines.push({ ...ev, life: 0.18 });
      if (Math.random() < 0.3) sound.play('shot');
      break;
    case 'melee': fx.burst(ev.x, ev.y, '#fff', 4, 120, 0.25, 4); break;
    case 'fireball':
      fx.burst(ev.x, ev.y, '#ffbe0b', 30, 300, 0.7, 10);
      fx.burst(ev.x, ev.y, '#ff4d6d', 20, 220, 0.6, 9);
      fx.ring(ev.x, ev.y, '#ffbe0b', ev.r * 1.3, 0.45);
      fx.addShake(8);
      sound.play('boom');
      break;
    case 'die':
      if (ev.k === 'tower') {
        fx.burst(ev.x, ev.y, TEAM[ev.team], 50, 400, 1, 12);
        fx.addShake(14);
        sound.play('boom');
        fx.text(ev.x, ev.y - 40, ev.team === myTeam ? 'Tour perdue !' : '👑 Tour détruite !', '#ffbe0b', 1.6);
        navigator.vibrate?.(150);
      } else fx.burst(ev.x, ev.y, TEAM[ev.team], 10, 180, 0.4, 6);
      break;
    case 'play':
      fx.ring(ev.x, ev.y, TEAM[ev.team], 50, 0.35);
      if (ev.team === myTeam) sound.play('play');
      break;
    default:
  }
}

function lerpEnts(prev, cur, a) {
  if (!prev) return cur.ents;
  const m = new Map(prev.ents.map(e => [e.id, e]));
  return cur.ents.map(e => {
    const p = m.get(e.id);
    if (!p) return e;
    return { ...e, x: p.x + (e.x - p.x) * a, y: p.y + (e.y - p.y) * a };
  });
}

function hpBar(x, y, w, k, color) {
  return ctx => {
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    roundRect(ctx, x - w / 2 - 2, y - 2, w + 4, 9, 4); ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, x - w / 2, y, w * Math.max(0, k), 5, 3); ctx.fill();
  };
}

export function draw(ctx, view, now) {
  const { cur, prev, alpha } = view;
  if (!cur) return;
  const s = L.s;
  ctx.save();
  ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);

  // Terrain
  const [fx0, fy0] = [L.ox, L.oy];
  for (let i = 0; i < 20; i++) {
    ctx.fillStyle = i % 2 ? '#3e8f4a' : '#45a052';
    ctx.fillRect(fx0, fy0 + i * 50 * s, FW * s, 50 * s + 1);
  }
  // Zone de pose
  if (selected >= 0 && view.priv) {
    const c = CARDS[view.priv.hand[selected]];
    if (!c.spell) {
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      ctx.fillRect(fx0, fy0 + (RIVER + 30) * s, FW * s, (FH - RIVER - 30) * s);
      ctx.fillStyle = 'rgba(255,40,60,.15)';
      ctx.fillRect(fx0, fy0, FW * s, (RIVER - 30) * s);
    } else {
      ctx.fillStyle = 'rgba(255,190,11,.08)';
      ctx.fillRect(fx0, fy0, FW * s, FH * s);
    }
  }
  // Rivière et ponts
  ctx.fillStyle = '#2a8fd6';
  ctx.fillRect(fx0, fy0 + (RIVER - 30) * s, FW * s, 60 * s);
  ctx.fillStyle = 'rgba(255,255,255,.18)';
  for (let x = 0; x < FW; x += 40) ctx.fillRect(fx0 + (x + (now / 40) % 40) * s, fy0 + (RIVER - 4) * s, 18 * s, 3 * s);
  for (const bx of BRIDGES) {
    const [x, y] = P(bx - 38, RIVER - 40);
    const [x2, y2] = P(bx + 38, RIVER + 40);
    ctx.fillStyle = '#9b6b3d';
    ctx.fillRect(Math.min(x, x2), Math.min(y, y2), Math.abs(x2 - x), Math.abs(y2 - y));
    ctx.fillStyle = '#7a5230';
    for (let k = 0; k < 5; k++) ctx.fillRect(Math.min(x, x2), Math.min(y, y2) + k * 16 * s + 6 * s, Math.abs(x2 - x), 3 * s);
  }
  ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 3;
  ctx.strokeRect(fx0, fy0, FW * s, FH * s);

  const ents = lerpEnts(prev, cur, alpha).slice();
  ents.sort((a, b) => P(a.x, a.y)[1] - P(b.x, b.y)[1]);
  for (const e of ents) {
    const [x, y] = P(e.x, e.y);
    const col = TEAM[e.team];
    if (e.k === 'tower') {
      const r = e.r * s;
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.8, r * 1.1, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9c3b5';
      roundRect(ctx, x - r, y - r, r * 2, r * 2, r * 0.3); ctx.fill();
      ctx.fillStyle = col;
      roundRect(ctx, x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5, r * 0.25); ctx.fill();
      ctx.font = `${r * 1.1}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(e.type === 'king' ? (e.active ? '👑' : '😴') : '🏹', x, y + 2);
      hpBar(x, y - r - 12, r * 2, e.hp / e.max, col)(ctx);
    } else {
      const r = e.r * s * 1.15;
      ctx.globalAlpha = e.dep ? 0.5 : 1;
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(x, y + r * 0.7, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      const emo = CARDS[e.type]?.emoji || '•';
      ctx.font = `${r * 1.25}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const bob = e.atk ? -3 : Math.sin(now / 120 + e.id) * 1.2;
      ctx.fillText(emo, x, y + bob + 1);
      ctx.globalAlpha = 1;
      if (e.hp < e.max) hpBar(x, y - r - 9, Math.max(22, r * 2), e.hp / e.max, col)(ctx);
    }
  }

  // Tirs
  for (const l of lines) {
    const [x1, y1] = P(l.x1, l.y1), [x2, y2] = P(l.x2, l.y2);
    const k = 1 - l.life / 0.18;
    const px = x1 + (x2 - x1) * k, py = y1 + (y2 - y1) * k;
    ctx.fillStyle = l.k === 'wizard' ? '#ff8c42' : l.k === 'tower' ? '#fff' : '#ffe08a';
    ctx.beginPath(); ctx.arc(px, py, (l.k === 'wizard' ? 6 : 4) * s * 1.6, 0, Math.PI * 2); ctx.fill();
  }

  // Effets dans le repère monde (conversion via P)
  ctx.save();
  if (L.flip) { ctx.translate(L.ox + FW * s, L.oy + FH * s); ctx.scale(-s, -s); }
  else { ctx.translate(L.ox, L.oy); ctx.scale(s, s); }
  // Les textes flottants seraient à l'envers une fois retournés : on les gère à part.
  const floats = fx.floats; fx.floats = [];
  fx.draw(ctx, s);
  fx.floats = floats;
  ctx.restore();
  for (const f of fx.floats) {
    const [x, y] = P(f.x, f.y);
    ctx.globalAlpha = Math.min(1, f.life / f.max * 2);
    label(ctx, f.txt, x, y, 20, f.color);
  }
  ctx.globalAlpha = 1;

  if (ghost && now - ghost.t < 400) {
    const [x, y] = P(ghost.x, ghost.y);
    ctx.globalAlpha = 1 - (now - ghost.t) / 400;
    ctx.font = '34px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ghost.emoji, x, y - (now - ghost.t) / 20);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

export function step(dt) {
  for (const l of lines) l.life -= dt;
  lines = lines.filter(l => l.life > 0);
}

export function hud(view) {
  const s = view.cur;
  if (!s) return { center: '' };
  const m = Math.floor(s.t / 60), sec = String(s.t % 60).padStart(2, '0');
  const me = view.priv?.team;
  return {
    center: `${s.overtime ? '⏱ ' : ''}${m}:${sec}${s.double ? ' ⚡x2' : ''}`,
    left: `<span class="chip" style="padding:3px 10px">🔵 ${s.crowns[0]} - ${s.crowns[1]} 🔴</span>${me !== undefined ? `<span class="chip" style="padding:3px 10px">Tu es ${me === 0 ? '🔵' : '🔴'}</span>` : ''}`,
  };
}
