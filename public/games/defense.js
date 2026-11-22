// Rendu de Défense coop.
import { fx, drawBlob, label, sound, roundRect } from '../lib/fx.js';

const COLS = 9, ROWS = 14;
const WAYPOINTS = [[1, -1], [1, 3], [7, 3], [7, 6], [1, 6], [1, 9], [7, 9], [7, 12], [4, 12], [4, 14.5]];
export const TOWERS = {
  arrow: { name: 'Archer', emoji: '🏹', cost: 50, range: 2.4 },
  cannon: { name: 'Canon', emoji: '💣', cost: 80, range: 2.1 },
  frost: { name: 'Glace', emoji: '❄️', cost: 60, range: 2.0 },
};
const ENEMY_LOOK = {
  slime: { color: '#4fd16b', r: 0.28 },
  runner: { color: '#ffd23f', r: 0.22 },
  tank: { color: '#8d93a8', r: 0.38 },
  boss: { color: '#b14dff', r: 0.48 },
};

let L = { cs: 40, ox: 0, oy: 0 };
let pathSet = null;
let sel = null;
let api = null;
let bar = null;
let shots = [];
let barKey = '';

function computePath() {
  const set = new Set();
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const [x1, y1] = WAYPOINTS[i], [x2, y2] = WAYPOINTS[i + 1];
    const l = Math.hypot(x2 - x1, y2 - y1), n = Math.ceil(l * 2);
    for (let k = 0; k <= n; k++) {
      const x = Math.round(x1 + (x2 - x1) * k / n), y = Math.round(y1 + (y2 - y1) * k / n);
      if (y >= 0 && y < ROWS) set.add(`${x},${y}`);
    }
  }
  return set;
}

export function layout(w, h, portrait) {
  const top = 54, bottom = portrait ? 156 : 8, side = portrait ? 0 : 236;
  const cs = Math.min((w - side - 8) / COLS, (h - top - bottom) / ROWS);
  L = { cs, ox: (w - side - cs * COLS) / 2, oy: top + (h - top - bottom - cs * ROWS) / 2 };
}
const S = (x, y) => [L.ox + (x + 0.5) * L.cs, L.oy + (y + 0.5) * L.cs];

export function mount(el, a) {
  api = a; bar = el; sel = null; shots = []; barKey = '';
  pathSet = pathSet || computePath();
  el.innerHTML = '<div class="def-bar"><div class="def-info"><span id="df-msg">Touche une case pour construire</span><span class="gold" id="df-gold">0 🪙</span></div><div class="build" id="df-build"></div></div>';
}

function renderBar(view) {
  const priv = view.priv;
  const s = view.cur;
  if (!priv || priv.gold === undefined || !s) return;
  const gold = priv.gold;
  bar.querySelector('#df-gold').textContent = `${gold} 🪙`;
  const tower = sel ? s.towers.find(t => t.c === sel.c && t.r === sel.r) : null;
  const key = JSON.stringify([sel, tower?.lvl, tower?.owner, gold >= 50, gold >= 60, gold >= 80, tower && gold >= (tower.up || 1e9)]);
  if (key === barKey) return;
  barKey = key;
  const build = bar.querySelector('#df-build');
  const msg = bar.querySelector('#df-msg');
  if (!sel) {
    msg.textContent = 'Touche une case pour construire';
    build.innerHTML = Object.entries(TOWERS).map(([k, t]) => `<button disabled><span class="e">${t.emoji}</span>${t.name}<small>${t.cost}</small></button>`).join('') + '<span></span>';
    return;
  }
  if (tower) {
    const owner = view.players[tower.owner]?.name || '?';
    if (tower.owner !== view.me) {
      msg.textContent = `Tour de ${owner} · niveau ${tower.lvl}`;
      build.innerHTML = '<span></span><span></span><span></span><button class="x" data-x>✕</button>';
    } else if (tower.up) {
      msg.textContent = `${TOWERS[tower.kind].name} niveau ${tower.lvl}`;
      build.innerHTML = `<button data-up ${gold < tower.up ? 'disabled' : ''} style="grid-column:span 3"><span class="e">⬆️</span>Améliorer<small>${tower.up}</small></button><button class="x" data-x>✕</button>`;
    } else {
      msg.textContent = `${TOWERS[tower.kind].name} au niveau max ⭐⭐⭐`;
      build.innerHTML = '<span></span><span></span><span></span><button class="x" data-x>✕</button>';
    }
  } else {
    msg.textContent = 'Quelle tour ici ?';
    build.innerHTML = Object.entries(TOWERS).map(([k, t]) => `<button data-k="${k}" ${gold < t.cost ? 'disabled' : ''}><span class="e">${t.emoji}</span>${t.name}<small>${t.cost}</small></button>`).join('') + '<button class="x" data-x>✕</button>';
  }
  build.querySelectorAll('button').forEach(b => b.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (b.disabled) return;
    if (b.dataset.k) api.act({ t: 'build', kind: b.dataset.k, c: sel.c, r: sel.r });
    else if ('up' in b.dataset) api.act({ t: 'up', c: sel.c, r: sel.r });
    sel = null; barKey = '';
    sound.play('tick');
  }));
}

export function update(view) { renderBar(view); }

export function tap(sx, sy, view) {
  const c = Math.floor((sx - L.ox) / L.cs), r = Math.floor((sy - L.oy) / L.cs);
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) { sel = null; barKey = ''; return; }
  if (pathSet.has(`${c},${r}`)) { sel = null; barKey = ''; api.toast('On ne construit pas sur le chemin'); return; }
  sel = sel && sel.c === c && sel.r === r ? null : { c, r };
  barKey = '';
  sound.play('tick');
}

export function onEvent(ev, view) {
  switch (ev.t) {
    case 'shot': shots.push({ ...ev, life: 0.15 }); break;
    case 'kill': {
      const [x, y] = S(ev.x, ev.y);
      fx.burst(x, y, '#ffbe0b', 6, 120, 0.4, 3);
      fx.text(x, y - 10, '🪙', '#ffbe0b', 0.7);
      if (Math.random() < 0.4) sound.play('coin');
      break;
    }
    case 'leak':
      fx.addShake(6 + ev.n * 2);
      sound.play('hit');
      break;
    case 'build': case 'up': {
      const [x, y] = S(ev.c, ev.r);
      fx.ring(x, y, '#fff', L.cs, 0.35);
      sound.play('play');
      break;
    }
    default:
  }
}

export function step(dt) {
  for (const s of shots) s.life -= dt;
  shots = shots.filter(s => s.life > 0);
}

function lerpEnemies(prev, cur, a) {
  if (!prev) return cur.enemies;
  const m = new Map(prev.enemies.map(e => [e.id, e]));
  return cur.enemies.map(e => {
    const p = m.get(e.id);
    if (!p) return e;
    return { ...e, x: p.x + (e.x - p.x) * a, y: p.y + (e.y - p.y) * a, dx: e.x - p.x, dy: e.y - p.y };
  });
}

export function draw(ctx, view, now) {
  const { cur, prev, alpha } = view;
  if (!cur || !pathSet) return;
  const cs = L.cs;
  ctx.save();
  ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const x = L.ox + c * cs, y = L.oy + r * cs;
      const path = pathSet.has(`${c},${r}`);
      ctx.fillStyle = path ? '#c9a46a' : (c + r) % 2 ? '#3f8f4c' : '#46994f';
      ctx.fillRect(x, y, cs + 0.5, cs + 0.5);
      if (path) { ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(x + cs * 0.2, y + cs * 0.3, cs * 0.12, cs * 0.12); }
    }
  }
  // Base
  const [bx, by] = S(4, 13);
  ctx.font = `${cs * 1.1}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('🏰', bx, by);
  const [sx0, sy0] = S(1, 0);
  ctx.font = `${cs * 0.7}px serif`;
  ctx.fillText('🕳️', sx0, sy0 - cs * 0.2);

  // Sélection + portée
  if (sel) {
    const t = cur.towers.find(tt => tt.c === sel.c && tt.r === sel.r);
    const [x, y] = S(sel.c, sel.r);
    ctx.strokeStyle = '#ffbe0b'; ctx.lineWidth = 3;
    roundRect(ctx, x - cs / 2 + 2, y - cs / 2 + 2, cs - 4, cs - 4, 6); ctx.stroke();
    const range = t ? TOWERS[t.kind].range + 0.3 * (t.lvl - 1) : 2.2;
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.arc(x, y, range * cs, 0, Math.PI * 2); ctx.fill();
  }

  // Tours
  for (const t of cur.towers) {
    const [x, y] = S(t.c, t.r);
    const col = cur.colors[t.owner] || '#fff';
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    roundRect(ctx, x - cs * 0.42, y - cs * 0.32, cs * 0.84, cs * 0.84, cs * 0.18); ctx.fill();
    ctx.fillStyle = '#e8e2d4';
    roundRect(ctx, x - cs * 0.42, y - cs * 0.42, cs * 0.84, cs * 0.84, cs * 0.18); ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, cs * 0.08);
    roundRect(ctx, x - cs * 0.42, y - cs * 0.42, cs * 0.84, cs * 0.84, cs * 0.18); ctx.stroke();
    ctx.save(); ctx.translate(x, y);
    ctx.font = `${cs * 0.55}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(TOWERS[t.kind].emoji, 0, 0);
    ctx.restore();
    if (t.lvl > 1) label(ctx, '★'.repeat(t.lvl - 1), x, y + cs * 0.38, cs * 0.3, '#ffbe0b');
  }

  // Monstres
  const enemies = lerpEnemies(prev, cur, alpha);
  for (const e of enemies) {
    const look = ENEMY_LOOK[e.type];
    const [x, y] = S(e.x, e.y);
    const l = Math.hypot(e.dx || 0, e.dy || 0) || 1;
    const r = look.r * cs;
    drawBlob(ctx, x, y + Math.sin(now / 90 + e.id) * cs * 0.04, r, e.slow ? '#7fd8ff' : look.color, (e.dx || 0) / l, (e.dy || 1) / l);
    if (e.type === 'boss') { ctx.font = `${r}px serif`; ctx.textAlign = 'center'; ctx.fillText('👑', x, y - r * 1.2); }
    if (e.hp < 1) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(x - r, y - r - 8, r * 2, 5);
      ctx.fillStyle = e.hp > 0.5 ? '#06d6a0' : e.hp > 0.25 ? '#ffbe0b' : '#ff4d6d';
      ctx.fillRect(x - r, y - r - 8, r * 2 * e.hp, 5);
    }
  }

  // Projectiles
  for (const s of shots) {
    const k = 1 - s.life / 0.15;
    const [x1, y1] = S(s.x1, s.y1), [x2, y2] = S(s.x2, s.y2);
    const x = x1 + (x2 - x1) * k, y = y1 + (y2 - y1) * k;
    ctx.fillStyle = s.kind === 'cannon' ? '#222' : s.kind === 'frost' ? '#9be7ff' : '#fff1b8';
    ctx.beginPath(); ctx.arc(x, y, s.kind === 'cannon' ? cs * 0.12 : cs * 0.07, 0, Math.PI * 2); ctx.fill();
    if (s.kind !== 'arrow' && k > 0.9) fx.burst(x2, y2, s.kind === 'frost' ? '#9be7ff' : '#ff8c42', 4, 80, 0.25, 3);
  }

  fx.draw(ctx, 1, 18);
  ctx.restore();
}

export function hud(view) {
  const s = view.cur;
  if (!s) return { center: '' };
  const hearts = `❤️ ${s.baseHp}/${s.baseMax}`;
  return {
    center: s.next != null ? `Vague ${s.wave + 1} · ${s.next}s` : `Vague ${s.wave}/${s.waves}`,
    left: `<span class="chip" style="padding:3px 10px">${hearts}</span>`,
  };
}
