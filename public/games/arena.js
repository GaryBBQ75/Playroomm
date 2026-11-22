// Rendu des jeux d'arène : Sumo, Patate chaude, Bagarre.
import { fx, drawBlob, label, sound, roundRect } from '../lib/fx.js';

const WORLD = 1000;
let L = { s: 1, ox: 0, oy: 0 };

export function layout(w, h, portrait) {
  const top = 56;
  if (portrait) {
    const ctrl = h * 0.42;
    const side = Math.min(w - 12, h - ctrl - top - 6);
    L = { s: side / WORLD, ox: (w - side) / 2, oy: top + Math.max(0, (h - ctrl - top - side) / 2) };
  } else {
    const side = Math.min(h - top - 8, w * 0.62);
    L = { s: side / WORLD, ox: (w - side) / 2, oy: top };
  }
}

function lerpBodies(prev, cur, a) {
  if (!prev) return cur.bodies;
  const map = new Map(prev.bodies.map(b => [b.id, b]));
  return cur.bodies.map(b => {
    const p = map.get(b.id);
    if (!p || Math.hypot(p.x - b.x, p.y - b.y) > 200) return b;
    return { ...b, x: p.x + (b.x - p.x) * a, y: p.y + (b.y - p.y) * a };
  });
}

export function onEvent(ev, view) {
  const me = view.me;
  const pcol = id => view.players[id]?.color || '#fff';
  const body = id => view.cur?.bodies.find(b => b.id === id);
  switch (ev.t) {
    case 'dash': {
      const b = body(ev.id);
      if (b) fx.burst(b.x - b.fx * 30, b.y - b.fy * 30, pcol(ev.id), 8, 160, 0.35, 7);
      if (ev.id === me) sound.play('dash');
      break;
    }
    case 'bump':
      fx.burst(ev.x, ev.y, '#fff', 6 + Math.round(ev.f * 10), 240, 0.35, 5);
      fx.addShake(2 + ev.f * 6);
      sound.play('bump');
      break;
    case 'fall':
      fx.text(ev.x, ev.y - 40, ev.by ? `KO par ${view.players[ev.by]?.name || '?'} !` : 'Plouf !', '#ffbe0b', 1.2);
      sound.play('fall');
      if (ev.id === me)
      break;
    case 'boom':
      fx.burst(ev.x, ev.y, '#ffbe0b', 40, 520, 0.9, 12);
      fx.burst(ev.x, ev.y, '#ff4d6d', 30, 400, 0.8, 10);
      fx.ring(ev.x, ev.y, '#fff', 260, 0.5);
      fx.addShake(16);
      sound.play('boom');
      break;
    case 'pass':
      sound.play('pass');
      if (ev.to === me) { }
      break;
    case 'hit':
      fx.burst(ev.x, ev.y, ev.f > 0.6 ? '#ff4d6d' : '#fff', 10, 300, 0.35, 6);
      fx.addShake(3 + ev.f * 6);
      sound.play('hit');
      if (ev.id === me)
      break;
    default:
  }
}

function drawSumoFloor(ctx, s) {
  const c = WORLD / 2;
  // Vide étoilé
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  for (let i = 0; i < 40; i++) {
    const x = (i * 263) % WORLD, y = (i * 571) % WORLD;
    ctx.fillRect(x, y, 3, 3);
  }
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.setLineDash([10, 14]); ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(c, c, 440, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  const g = ctx.createRadialGradient(c, c, 0, c, c, s.arenaR);
  g.addColorStop(0, '#3b3190'); g.addColorStop(0.85, '#2b2470'); g.addColorStop(1, '#ff4d6d');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(c, c, s.arenaR, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 10; ctx.strokeStyle = '#fff';
  ctx.beginPath(); ctx.arc(c, c, s.arenaR, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.beginPath(); ctx.arc(c, c, s.arenaR * 0.35, 0, Math.PI * 2); ctx.stroke();
}

function drawPotatoFloor(ctx, s) {
  ctx.fillStyle = '#26205a';
  roundRect(ctx, 0, 0, WORLD, WORLD, 30); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 2;
  for (let i = 100; i < WORLD; i += 100) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, WORLD); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(WORLD, i); ctx.stroke();
  }
  ctx.lineWidth = 10; ctx.strokeStyle = '#8b5cff';
  roundRect(ctx, 0, 0, WORLD, WORLD, 30); ctx.stroke();
  for (const p of s.pillars) {
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + p.r * 0.5, p.r, p.r * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(p.x - p.r * 0.3, p.y - p.r * 0.3, 4, p.x, p.y, p.r);
    g.addColorStop(0, '#6c63b5'); g.addColorStop(1, '#3d357f');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
  }
}

function drawBrawlFloor(ctx, s, now) {
  const T = WORLD / 10;
  for (let i = 0; i < 100; i++) {
    const v = s.tiles[i];
    if (v === -1) continue;
    let x = (i % 10) * T, y = Math.floor(i / 10) * T;
    if (v === 1) { x += Math.sin(now / 30 + i) * 4; y += Math.cos(now / 25 + i) * 4; }
    const odd = ((i % 10) + Math.floor(i / 10)) % 2;
    ctx.fillStyle = v === 1 ? '#a8324f' : odd ? '#352c84' : '#3d3394';
    roundRect(ctx, x + 3, y + 3, T - 6, T - 6, 12); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(x + 6, y + T - 12, T - 12, 6);
  }
}

export function draw(ctx, view, now) {
  const { cur, prev, alpha, me, players, gameId } = view;
  if (!cur) return;
  ctx.save();
  const sx = (Math.random() - 0.5) * fx.shake, sy = (Math.random() - 0.5) * fx.shake;
  ctx.translate(L.ox + sx, L.oy + sy);
  ctx.scale(L.s, L.s);

  if (gameId === 'sumo') drawSumoFloor(ctx, cur);
  else if (gameId === 'potato') drawPotatoFloor(ctx, cur);
  else drawBrawlFloor(ctx, cur, now);

  const bodies = lerpBodies(prev, cur, alpha).slice().sort((a, b) => a.y - b.y);
  for (const b of bodies) {
    if (!b.alive) continue;
    const p = players[b.id] || { color: '#999', name: '?' };
    const scale = b.falling ? Math.max(0.05, 1 - b.falling) : 1;
    if (gameId === 'brawl' && b.punch) {
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.beginPath();
      const a = Math.atan2(b.fy, b.fx);
      ctx.moveTo(b.x, b.y);
      ctx.arc(b.x, b.y, b.r + 60, a - 0.8, a + 0.8);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = b.falling ? Math.max(0, 1 - b.falling) : 1;
    drawBlob(ctx, b.x, b.y, b.r, p.color, b.fx, b.fy, { me: b.id === me, scale, dizzy: !!b.stun });
    ctx.globalAlpha = 1;
    if (!b.falling) {
      label(ctx, p.name, b.x, b.y - b.r - 9 / L.s, 13 / L.s, b.id === me ? '#ffbe0b' : '#fff');
      if (gameId === 'brawl') {
        const d = b.dmg;
        const col = d < 40 ? '#fff' : d < 90 ? '#ffbe0b' : '#ff4d6d';
        label(ctx, `${d}%`, b.x, b.y + b.r + 9 / L.s, 13 / L.s, col);
      }
    }
    const em = view.emotes[b.id];
    if (em && now - em.t < 2000) {
      ctx.font = `${28 / L.s}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(em.e, b.x + b.r, b.y - b.r - 30 / L.s - (now - em.t) / 30);
    }
  }

  // Bombe
  if (gameId === 'potato' && cur.holder) {
    const h = bodies.find(b => b.id === cur.holder);
    if (h) {
      const pulse = 1 + Math.sin(now / (40 + cur.fuse * 160)) * 0.12;
      const bx = h.x + 26, by = h.y - 34;
      ctx.strokeStyle = cur.fuse < 0.3 ? '#ff4d6d' : '#ffbe0b';
      ctx.lineWidth = 8;
      ctx.beginPath(); ctx.arc(h.x, h.y, h.r + 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * cur.fuse); ctx.stroke();
      ctx.save(); ctx.translate(bx, by); ctx.scale(pulse, pulse);
      ctx.fillStyle = '#1b1b2b';
      ctx.beginPath(); ctx.arc(0, 0, 24, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.3)';
      ctx.beginPath(); ctx.arc(-8, -8, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#c9a36b'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(10, -18); ctx.quadraticCurveTo(22, -34, 30, -30); ctx.stroke();
      ctx.fillStyle = Math.random() > 0.5 ? '#ffbe0b' : '#ff4d6d';
      ctx.beginPath(); ctx.arc(30, -30, 6 + Math.random() * 5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      if (Math.random() < 0.4) fx.burst(bx + 30, by - 30, '#ffbe0b', 1, 80, 0.3, 4);
    }
  }

  fx.draw(ctx, L.s, 18);
  ctx.restore();
}

export function hud(view) {
  const s = view.cur;
  if (!s) return { center: '' };
  if (view.gameId === 'potato') return { center: `${s.left} 🧍` };
  return { center: `${s.timer}s`, sub: `Manche ${s.round}/${s.rounds}` };
}

export function cooldowns(view) {
  const b = view.cur?.bodies.find(x => x.id === view.me);
  if (!b) return [0, 0];
  const max = view.gameId === 'sumo' ? [1.6, 1] : view.gameId === 'potato' ? [2.2, 1] : [0.42, 1.3];
  return [Math.min(1, b.cdA / max[0]), Math.min(1, b.cdB / max[1])];
}
