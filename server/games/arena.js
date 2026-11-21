// Outils partagés par les jeux d'arène (Sumo, Patate chaude, Bagarre).
// Monde de 1000 x 1000 unités, les joueurs sont des disques.

export const W = 1000;
export const H = 1000;

export function rand(a, b) { return a + Math.random() * (b - a); }
export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function len(x, y) { return Math.hypot(x, y); }
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function makeBody(p, x, y, r = 30) {
  return {
    id: p.id, name: p.name, color: p.color,
    x, y, vx: 0, vy: 0, r,
    alive: true, falling: 0,
    fx: 0, fy: -1, // direction du regard
    inp: { mx: 0, my: 0, a: false, b: false },
    prevA: false, prevB: false,
    cdA: 0, cdB: 0, stun: 0,
  };
}

// Normalise une entrée joystick reçue du client.
export function sanitizeInput(inp) {
  if (!inp || typeof inp !== 'object') return { mx: 0, my: 0, a: false, b: false };
  let mx = Number(inp.mx) || 0;
  let my = Number(inp.my) || 0;
  const l = Math.hypot(mx, my);
  if (l > 1) { mx /= l; my /= l; }
  return { mx, my, a: !!inp.a, b: !!inp.b };
}

// Applique l'accélération du joystick et la friction.
export function moveBodies(bodies, dt, { accel = 2000, maxSpeed = 380, friction = 3.2, speedMul = () => 1 } = {}) {
  for (const b of bodies) {
    if (!b.alive || b.falling) continue;
    const { mx, my } = b.inp;
    if (b.stun <= 0 && (mx || my)) {
      const m = speedMul(b);
      b.vx += mx * accel * m * dt;
      b.vy += my * accel * m * dt;
      const l = Math.hypot(mx, my);
      b.fx = mx / l; b.fy = my / l;
      const sp = Math.hypot(b.vx, b.vy);
      const cap = maxSpeed * m;
      // On ne bride que la vitesse "volontaire", les projections restent libres.
      if (sp > cap && b.stun <= 0) {
        const k = Math.max(cap / sp, 1 - 4 * dt);
        b.vx *= k; b.vy *= k;
      }
    }
    const f = Math.exp(-friction * dt);
    b.vx *= f; b.vy *= f;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.cdA = Math.max(0, b.cdA - dt);
    b.cdB = Math.max(0, b.cdB - dt);
    b.stun = Math.max(0, b.stun - dt);
  }
}

// Collisions élastiques entre disques. Appelle onHit(a, b, force) à chaque contact.
export function collideBodies(bodies, { bounce = 1.0, onHit } = {}) {
  const list = bodies.filter(b => b.alive && !b.falling);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const min = a.r + b.r;
      if (d >= min) continue;
      const nx = dx / d, ny = dy / d;
      const overlap = (min - d) / 2;
      a.x -= nx * overlap; a.y -= ny * overlap;
      b.x += nx * overlap; b.y += ny * overlap;
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const imp = -(1 + bounce) * rv / 2;
        a.vx -= imp * nx; a.vy -= imp * ny;
        b.vx += imp * nx; b.vy += imp * ny;
      }
      if (onHit) onHit(a, b, Math.abs(rv));
    }
  }
}

// Rebond contre des piliers fixes.
export function collidePillars(bodies, pillars) {
  for (const b of bodies) {
    if (!b.alive || b.falling) continue;
    for (const p of pillars) {
      const dx = b.x - p.x, dy = b.y - p.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const min = b.r + p.r;
      if (d >= min) continue;
      const nx = dx / d, ny = dy / d;
      b.x = p.x + nx * min; b.y = p.y + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) { b.vx -= 1.8 * vn * nx; b.vy -= 1.8 * vn * ny; }
    }
  }
}

export function collideWalls(bodies, w = W, h = H) {
  for (const b of bodies) {
    if (!b.alive) continue;
    if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx) * 0.8; }
    if (b.x > w - b.r) { b.x = w - b.r; b.vx = -Math.abs(b.vx) * 0.8; }
    if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.8; }
    if (b.y > h - b.r) { b.y = h - b.r; b.vy = -Math.abs(b.vy) * 0.8; }
  }
}

// Détection front montant d'un bouton.
export function pressed(b, key) {
  const now = b.inp[key];
  const prevKey = key === 'a' ? 'prevA' : 'prevB';
  const was = b[prevKey];
  b[prevKey] = now;
  return now && !was;
}

export function spawnCircle(n, radius, cx = W / 2, cy = H / 2) {
  const off = Math.random() * Math.PI * 2;
  return Array.from({ length: n }, (_, i) => {
    const a = off + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * radius, cy + Math.sin(a) * radius];
  });
}

export function bodySnap(b) {
  return {
    id: b.id, x: Math.round(b.x), y: Math.round(b.y), r: b.r,
    fx: +b.fx.toFixed(2), fy: +b.fy.toFixed(2),
    alive: b.alive, falling: +b.falling.toFixed(2), stun: b.stun > 0 ? 1 : 0,
    cdA: +b.cdA.toFixed(2), cdB: +b.cdB.toFixed(2),
  };
}

// Points de saison à partir d'un classement (groupes d'ex aequo).
export function pointsFromRanking(groups) {
  const table = [3, 2, 1];
  const pts = {};
  let pos = 0;
  for (const g of groups) {
    for (const id of g) pts[id] = table[pos] || 0;
    pos += g.length;
  }
  return pts;
}

// Petite IA de bot pour les jeux d'arène.
export function botSeek(self, target, { flee = false, jitter = 0.3 } = {}) {
  if (!target) return { mx: Math.cos(Date.now() / 700 + self.x), my: Math.sin(Date.now() / 900 + self.y), a: false, b: false };
  let dx = target.x - self.x, dy = target.y - self.y;
  if (flee) { dx = -dx; dy = -dy; }
  const l = Math.hypot(dx, dy) || 1;
  return {
    mx: dx / l + rand(-jitter, jitter),
    my: dy / l + rand(-jitter, jitter),
    a: false, b: false,
  };
}
