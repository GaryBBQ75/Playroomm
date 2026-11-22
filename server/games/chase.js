// Course-poursuite : un fugitif contre des flics dans une ville vue de dessus (rendu 3D côté client).
// Conduite façon Pako : la voiture roule toute seule, on ne fait que tourner à gauche ou à
// droite (les deux à la fois = frein à main). Ça glisse, ça cogne et ça explose.
import { shuffle, rand, clamp } from './arena.js';
import {
  getMap, getNav, clearLine, heightOn, groundHeight, keepOn, rampT, rampSpan, rampDir,
  SIZE, CELL, GN, LOW,
} from './chasemap.js';

const ROUND_TIME = 45;
const MAX_ROUNDS = 4;
const READY_TIME = 2.6;
const END_TIME = 3.2;
const SURVIVE_EVERY = 3;   // 1 point toutes les 3 s de cavale
const BAG_PTS = 2;
const BUST_PTS = 5;        // le flic qui arrête
const ASSIST_PTS = 2;      // les autres flics
const ESCAPE_PTS = 8;
const MAX_BAGS = 4;
const HOLD_TIME = 0.4;     // contact maintenu pour arrêter
const RAM_SPEED = 100;     // ou choc franc à cette vitesse relative

const CAR_R = 11;          // deux disques par voiture (avant et arrière)
const CAR_OFF = 10;
const TURBO_TIME = 1.0;
const WRECK_WALL = 228;    // choc contre un mur qui fait exploser une voiture de police
const WRECK_CAR = 270;     // choc entre deux voitures de police
const WRECK_TIME = 3.5;    // la carcasse brûle, puis le flic réapparaît
const TOSS_SPEED = 160;    // choc qui projette une voiture civile
const BLAST = 75;          // rayon du souffle d'un baril
const NPC_SPEED = 105;
const MODELS = 6;          // modèles de voitures du fugitif (tirés au hasard à chaque manche)

// Plus les flics sont nombreux, moins ils sont rapides ; seul (à 2 joueurs), le flic a
// un turbo bien plus fréquent.
const ROBBER = { speed: 262, accel: 430, turn: 3.7 };
const COP = { speed: 246, accel: 390, turn: 3.4 };
function roleConfig(role, cops) {
  if (role === 'robber') return { ...ROBBER, turboCd: Math.max(4, 7 - 0.5 * cops) };
  if (cops === 1) return { ...COP, speed: 256, accel: 430, turboCd: 3 };
  return { ...COP, speed: COP.speed - 8 * Math.min(6, cops - 2), turboCd: 5 };
}

export default {
  id: 'chase',
  name: 'Course-poursuite',
  emoji: '🚓',
  tagline: 'Un fugitif, des flics, toute une ville en 3D',
  duration: '3 min',
  family: 'Chaos',
  minPlayers: 2,
  maxPlayers: 8,
  controls: { type: 'steer', a: 'Turbo' },
  howto: [
    'Touche la moitié gauche ou droite de l\'écran pour tourner',
    'Les deux côtés en même temps : frein à main, ça dérape !',
    'Fugitif : tiens 45 s et ramasse les liasses de billets',
    'Flics : foncez dessus, mais gare aux murs et aux barils',
  ],
  create(players) { return new Chase(players); },
};

const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const r1 = v => Math.round(v * 10) / 10;

function sanitize(inp) {
  if (!inp || typeof inp !== 'object') return { s: 0, b: false, a: false };
  return { s: clamp(Number(inp.s) || 0, -1, 1), b: !!inp.b, a: !!inp.a };
}

class Chase {
  constructor(players) {
    this.players = players;
    this.map = getMap();
    this.nav = getNav();
    this.scores = Object.fromEntries(players.map(p => [p.id, 0]));
    this.busts = Object.fromEntries(players.map(p => [p.id, 0]));
    this.rounds = Math.min(players.length, MAX_ROUNDS);
    // Fugitifs tirés au hasard, sans répétition.
    this.order = shuffle(players.map(p => p.id)).slice(0, this.rounds);
    this.round = 0;
    this.over = false;
    this.events = [];
    this.ai = {};
    this.bagSeq = 0;
    this.stats = { wrecks: 0, barrels: 0, tosses: 0 };
    this.startRound();
  }

  name(id) { return this.players.find(p => p.id === id)?.name || '?'; }
  car(id) { return this.cars.find(c => c.id === id); }

  startRound() {
    this.round += 1;
    this.fugId = this.order[this.round - 1];
    this.fugModel = Math.floor(Math.random() * MODELS);
    this.t = 0;
    this.phase = 'ready';
    this.wait = READY_TIME;
    this.fugScore = 0;
    this.surviveT = 0;
    this.bags = [];
    this.bagT = 0.5;
    this.ai = {};
    this.fields = null;
    const cops = this.players.length - 1;
    const [fx, fy, fa] = this.map.fugSpawns[Math.floor(Math.random() * this.map.fugSpawns.length)];
    // Les flics partent des accès les plus proches, à bonne distance tout de même.
    const far = shuffle([...this.map.copSpawns])
      .map(([x, y]) => ({ x, y, d: Math.hypot(x - fx, y - fy) }))
      .filter(s => s.d > 620)
      .sort((a, b) => a.d - b.d);
    let k = 0;
    this.cars = this.players.map(p => {
      const fug = p.id === this.fugId;
      const pos = fug ? { x: fx, y: fy } : far[k++ % far.length];
      return {
        id: p.id, role: fug ? 'robber' : 'cop', cfg: roleConfig(fug ? 'robber' : 'cop', cops),
        x: pos.x, y: pos.y, a: fug ? fa : Math.atan2(fy - pos.y, fx - pos.x), vx: 0, vy: 0,
        up: -1, z: 0, inp: { s: 0, b: false, a: false }, prevA: false,
        cdA: 0, turbo: 0, skid: 0, hold: 0, bump: 0, dead: 0, rev: 0, jam: 0, age: 0,
      };
    });
    // Circulation civile et objets explosifs remis en place.
    this.npcs = this.map.npcs.map(([loop, i]) => {
      const l = this.map.loops[loop], p = l[i % l.length], q = l[(i + 1) % l.length];
      return { loop, i: (i + 1) % l.length, x: (p[0] + q[0]) / 2, y: (p[1] + q[1]) / 2, a: Math.atan2(q[1] - p[1], q[0] - p[0]), v: NPC_SPEED, k: 0, vx: 0, vy: 0, spin: 0, wait: 0 };
    });
    this.barrels = this.map.barrels.map(b => ({ ...b, alive: true, fuse: 0 }));
    this.msg = `Manche ${this.round}/${this.rounds} : ${this.name(this.fugId)} est le fugitif !`;
    this.events.push({ t: 'round' });
  }

  input(pid, inp) {
    const c = this.car(pid);
    if (c) c.inp = sanitize(inp);
  }

  tick(dt) {
    if (this.over) return;
    if (this.phase === 'ready') {
      this.wait -= dt;
      if (this.wait <= 0) { this.phase = 'play'; this.msg = ''; this.events.push({ t: 'go' }); }
      return;
    }
    if (this.phase === 'end') {
      this.wait -= dt;
      // Ralenti juste après l'arrestation, puis tout le monde s'arrête.
      const slow = this.wait > END_TIME - 0.9 ? 0.22 : 1;
      this.simulate(dt * slow, true);
      if (this.wait <= 0) {
        if (this.round >= this.rounds) this.over = true;
        else this.startRound();
      }
      return;
    }

    this.t += dt;
    this.simulate(dt, false);
    if (this.phase !== 'play') return;

    // Points de cavale.
    this.surviveT += dt;
    if (this.surviveT >= SURVIVE_EVERY) {
      this.surviveT -= SURVIVE_EVERY;
      this.scores[this.fugId] += 1;
      this.fugScore += 1;
    }

    // Liasses de billets.
    const fug = this.car(this.fugId);
    this.bagT -= dt;
    if (this.bags.length < MAX_BAGS && this.bagT <= 0) { this.spawnBag(fug); this.bagT = 1.5; }
    for (const b of this.bags) {
      if (b.st === fug.up && Math.hypot(b.x - fug.x, b.y - fug.y) < 28) {
        b.gone = true;
        this.scores[this.fugId] += BAG_PTS;
        this.fugScore += BAG_PTS;
        this.events.push({ t: 'cash', id: fug.id, x: b.x, y: b.y, h: b.z });
      }
    }
    this.bags = this.bags.filter(b => !b.gone);

    if (this.t >= ROUND_TIME) {
      this.scores[this.fugId] += ESCAPE_PTS;
      this.fugScore += ESCAPE_PTS;
      this.msg = 'Il s\'est échappé !';
      this.events.push({ t: 'escape', id: this.fugId });
      this.endRound();
    }
  }

  endRound() {
    this.phase = 'end';
    this.wait = END_TIME;
  }

  arrest(cop, fug) {
    if (this.phase !== 'play') return;
    for (const c of this.cars) {
      if (c.role !== 'cop') continue;
      this.scores[c.id] += c === cop ? BUST_PTS : ASSIST_PTS;
    }
    this.busts[cop.id] += 1;
    this.msg = `Arrêté par ${this.name(cop.id)} !`;
    this.events.push({ t: 'bust', by: cop.id, id: fug.id, x: Math.round(fug.x), y: Math.round(fug.y), h: Math.round(fug.z) });
    this.endRound();
  }

  spawnBag(fug) {
    const spots = this.map.bagSpots.filter(s =>
      Math.hypot(s.x - fug.x, s.y - fug.y) > 220 && !this.bags.some(b => Math.hypot(b.x - s.x, b.y - s.y) < 260));
    if (!spots.length) return;
    // Plutôt pas trop loin du fugitif, pour qu'il ait toujours un sac à aller chercher.
    spots.sort((a, b) => Math.hypot(a.x - fug.x, a.y - fug.y) - Math.hypot(b.x - fug.x, b.y - fug.y));
    const s = spots[Math.floor(Math.random() * Math.min(spots.length, 14))];
    this.bags.push({ i: ++this.bagSeq, x: s.x, y: s.y, st: s.st, z: s.st >= 0 ? Math.round(heightOn(this.map.structs[s.st], s.x, s.y)) : 0 });
  }

  // ---------- Physique ----------
  simulate(dt, stopping) {
    for (const c of this.cars) this.drive(c, dt, stopping);
    this.moveNpcs(dt);
    this.collideCars();
    this.collideNpcs();
    for (const c of this.cars) this.collideWorld(c);
    for (const b of this.barrels) {
      if (b.alive && b.fuse > 0) { b.fuse -= dt; if (b.fuse <= 0) this.blowBarrel(b); }
    }
  }

  drive(c, dt, stopping) {
    const cfg = c.cfg;
    c.cdA = Math.max(0, c.cdA - dt);
    c.turbo = Math.max(0, c.turbo - dt);
    c.bump = Math.max(0, c.bump - dt);
    c.age += dt;
    if (c.dead > 0) {
      // Carcasse en feu : elle glisse encore un peu, puis le flic réapparaît ailleurs.
      c.dead -= dt;
      const f = Math.exp(-3.5 * dt);
      c.vx *= f; c.vy *= f;
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.skid = 0;
      if (c.dead <= 0 && !stopping) this.respawn(c);
      return;
    }
    const inp = stopping ? { s: 0, b: true, a: false } : c.inp;

    if (!stopping && inp.a && !c.prevA && c.cdA <= 0) {
      c.turbo = TURBO_TIME;
      c.cdA = cfg.turboCd;
      this.events.push({ t: 'turbo', id: c.id });
    }
    c.prevA = inp.a;
    const brake = inp.b;

    // Direction : on tourne tant qu'on appuie, plus sec au frein à main.
    let fx = Math.cos(c.a), fy = Math.sin(c.a);
    let vf = c.vx * fx + c.vy * fy;
    if (inp.s) {
      const grip = 0.5 + 0.5 * Math.min(1, Math.abs(vf) / 130);
      c.a = wrap(c.a + inp.s * cfg.turn * (brake ? 1.6 : 1) * grip * dt);
      fx = Math.cos(c.a); fy = Math.sin(c.a);
    }
    const rx = -fy, ry = fx;
    vf = c.vx * fx + c.vy * fy;
    let vl = c.vx * rx + c.vy * ry;

    // La voiture roule toujours. Coincée le nez contre un mur, elle recule toute seule un instant.
    c.rev = Math.max(0, c.rev - dt);
    if (!stopping && c.rev <= 0 && vf < 45 && c.age > 0.6) {
      c.jam += dt;
      if (c.jam > 0.22) { c.rev = 0.45; c.jam = 0; c.age = -0.45; } // et on laisse le temps de repartir
    } else c.jam = 0;
    let target = cfg.speed * (1 - 0.1 * Math.abs(inp.s));
    if (c.turbo > 0) target = cfg.speed * 1.45;
    if (brake) target *= 0.62;
    if (c.rev > 0) target = -150;
    if (stopping) target = 0;
    const accel = c.turbo > 0 ? cfg.accel * 2.6 : cfg.accel;
    vf += clamp(target - vf, -(stopping ? 520 : c.rev > 0 ? 900 : 300) * dt, accel * dt);
    // Peu d'adhérence latérale : ça glisse dans chaque virage, et beaucoup au frein à main.
    vl *= Math.exp(-(brake ? 1.1 : 4.8) * dt);
    c.skid = !stopping && Math.abs(vl) > (brake ? 20 : 30) && Math.hypot(vf, vl) > 90 ? 1 : 0;

    c.vx = fx * vf + rx * vl;
    c.vy = fy * vf + ry * vl;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
  }

  // Les deux disques d'une voiture.
  discs(c) {
    const ox = Math.cos(c.a) * CAR_OFF, oy = Math.sin(c.a) * CAR_OFF;
    return [[c.x + ox, c.y + oy], [c.x - ox, c.y - oy]];
  }

  // Repousse la voiture le long de la normale (nx, ny) et amortit le choc.
  bounce(c, nx, ny, depth) {
    c.x += nx * depth; c.y += ny * depth;
    const vn = c.vx * nx + c.vy * ny;
    if (vn >= 0) return 0;
    c.vx -= 1.3 * vn * nx; c.vy -= 1.3 * vn * ny;
    if (vn < -130) {
      // Choc franc : on perd de la vitesse, et une voiture de police lancée à fond explose.
      c.vx *= 0.72; c.vy *= 0.72;
      if (c.role === 'cop' && vn < -WRECK_WALL && this.phase === 'play' && c.dead <= 0) { this.wreck(c); return vn; }
      if (c.bump <= 0) {
        c.bump = 0.35;
        this.events.push({ t: 'crash', id: c.id, x: Math.round(c.x - nx * CAR_R), y: Math.round(c.y - ny * CAR_R), h: Math.round(c.z), f: r1(Math.min(1, -vn / 300)) });
      }
    } else {
      c.vx *= 0.992; c.vy *= 0.992;
    }
    return vn;
  }

  // Une voiture de police explose : carcasse immobile pendant quelques secondes.
  wreck(c) {
    if (c.dead > 0 || c.role !== 'cop') return;
    c.dead = WRECK_TIME;
    c.turbo = 0; c.hold = 0;
    c.vx *= 0.35; c.vy *= 0.35;
    this.stats.wrecks += 1;
    this.events.push({ t: 'boom', id: c.id, x: Math.round(c.x), y: Math.round(c.y), h: Math.round(c.z) });
  }

  respawn(c) {
    const fug = this.car(this.fugId);
    const spots = this.map.copSpawns
      .map(([x, y]) => ({ x, y, d: Math.hypot(x - fug.x, y - fug.y) }))
      .filter(s => s.d > 420 && !this.cars.some(o => o !== c && Math.hypot(o.x - s.x, o.y - s.y) < 60))
      .sort((a, b) => a.d - b.d);
    const s = spots[Math.floor(Math.random() * Math.min(3, spots.length))] || { x: 40, y: 40 };
    c.x = s.x; c.y = s.y; c.vx = c.vy = 0; c.up = -1; c.z = 0;
    c.a = Math.atan2(fug.y - s.y, fug.x - s.x);
    c.dead = 0; c.age = 0; c.rev = 0; c.jam = 0;
    delete this.ai[c.id];
    this.events.push({ t: 'spawn', id: c.id });
  }

  // Baril, bonbonne ou pompe à essence : explosion, souffle, réaction en chaîne.
  blowBarrel(b) {
    if (!b.alive) return;
    b.alive = false;
    this.stats.barrels += 1;
    this.events.push({ t: 'boom', x: b.x, y: b.y, h: 0, big: b.kind === 'pump' ? 1 : 0 });
    const reach = b.kind === 'pump' ? BLAST * 1.3 : BLAST;
    for (const c of this.cars) {
      if (c.up >= 0) continue;
      const dx = c.x - b.x, dy = c.y - b.y, d = Math.hypot(dx, dy) || 1;
      if (d > reach) continue;
      const k = 330 * (1 - d / reach);
      c.vx += dx / d * k; c.vy += dy / d * k;
      if (c.role === 'cop' && d < reach * 0.62 && this.phase === 'play') this.wreck(c);
    }
    for (const n of this.npcs) {
      const dx = n.x - b.x, dy = n.y - b.y, d = Math.hypot(dx, dy) || 1;
      if (d < reach && n.k <= 0) this.toss(n, dx / d * 260, dy / d * 260);
    }
    for (const o of this.barrels) if (o.alive && o.fuse <= 0 && Math.hypot(o.x - b.x, o.y - b.y) < reach) o.fuse = 0.12 + Math.random() * 0.15;
  }

  // Passe du sol à un ouvrage (par le pied d'une rampe) et inversement.
  updateLevel(c) {
    const hx = Math.cos(c.a), hy = Math.sin(c.a);
    if (c.up < 0) {
      for (const st of this.map.structs) {
        for (const p of st.parts) {
          if (!p.ramp || !rampSpan(p, c.x, c.y)) continue;
          const t = rampT(p, c.x, c.y), d = rampDir(p);
          if (t > 0 && t <= LOW && hx * d[0] + hy * d[1] > 0.3) { c.up = st.id; return; }
        }
      }
      return;
    }
    const st = this.map.structs[c.up];
    for (const p of st.parts) {
      if (!p.ramp || !rampSpan(p, c.x, c.y, 4)) continue;
      const t = rampT(p, c.x, c.y), d = rampDir(p);
      if (t < LOW) {
        // Au pied de la rampe : on redescend dans la rue.
        if (hx * d[0] + hy * d[1] < 0.3 || t < -20) c.up = -1;
        return;
      }
    }
    for (let pass = 0; pass < 2; pass++) {
      for (const [dx, dy] of this.discs(c)) {
        const k = keepOn(st, dx, dy, CAR_R);
        if (k) this.bounce(c, k.nx, k.ny, k.depth);
        for (const r of st.obs) this.hitRect(c, dx, dy, r);
      }
    }
  }

  hitRect(c, dx, dy, r) {
    const px = clamp(dx, r.x, r.x + r.w), py = clamp(dy, r.y, r.y + r.h);
    let nx = dx - px, ny = dy - py;
    const d = Math.hypot(nx, ny);
    if (d >= CAR_R) return;
    if (d < 0.001) {
      // Disque enfoncé dans l'obstacle : on sort par le côté le plus proche.
      const l = dx - r.x, rr = r.x + r.w - dx, t = dy - r.y, b = r.y + r.h - dy;
      const m = Math.min(l, rr, t, b);
      if (m === l) this.bounce(c, -1, 0, l + CAR_R);
      else if (m === rr) this.bounce(c, 1, 0, rr + CAR_R);
      else if (m === t) this.bounce(c, 0, -1, t + CAR_R);
      else this.bounce(c, 0, 1, b + CAR_R);
      return;
    }
    nx /= d; ny /= d;
    this.bounce(c, nx, ny, CAR_R - d);
  }

  collideWorld(c) {
    this.updateLevel(c);
    if (c.up >= 0) { c.z = heightOn(this.map.structs[c.up], c.x, c.y); return; }
    const { rects, circles } = this.map;
    const reach = CAR_R + CAR_OFF + 2;
    for (let pass = 0; pass < 2; pass++) {
      for (const [dx, dy] of this.discs(c)) {
        for (const r of rects) {
          if (c.x < r.x - reach || c.x > r.x + r.w + reach || c.y < r.y - reach || c.y > r.y + r.h + reach) continue;
          this.hitRect(c, dx, dy, r);
        }
        for (const o of circles) {
          const nx = dx - o.x, ny = dy - o.y;
          if (Math.abs(nx) > CAR_R + o.r || Math.abs(ny) > CAR_R + o.r) continue;
          const d = Math.hypot(nx, ny) || 0.001;
          if (d >= CAR_R + o.r) continue;
          this.bounce(c, nx / d, ny / d, CAR_R + o.r - d);
        }
        for (const b of this.barrels) {
          if (!b.alive) continue;
          const nx = dx - b.x, ny = dy - b.y;
          const d = Math.hypot(nx, ny) || 0.001;
          if (d >= CAR_R + b.r) continue;
          // Percuté à bonne vitesse, ça saute.
          if (Math.hypot(c.vx, c.vy) > 110 && this.phase !== 'ready') this.blowBarrel(b);
          else this.bounce(c, nx / d, ny / d, CAR_R + b.r - d);
        }
        // Quais : bords de l'île.
        if (dx < CAR_R) this.bounce(c, 1, 0, CAR_R - dx);
        if (dx > SIZE - CAR_R) this.bounce(c, -1, 0, dx - (SIZE - CAR_R));
        if (dy < CAR_R) this.bounce(c, 0, 1, CAR_R - dy);
        if (dy > SIZE - CAR_R) this.bounce(c, 0, -1, dy - (SIZE - CAR_R));
      }
    }
    c.z = groundHeight(this.map, c.x, c.y);
  }

  // Contact entre deux paires de disques : le plus profond, ou null.
  touch(a, b, ra = CAR_R, rb = CAR_R) {
    if (Math.hypot(a.x - b.x, a.y - b.y) > ra + rb + 2 * CAR_OFF) return null;
    let best = null;
    for (const [ax, ay] of this.discs(a)) {
      for (const [bx, by] of this.discs(b)) {
        const d = Math.hypot(bx - ax, by - ay) || 0.001;
        const depth = ra + rb - d;
        if (depth > 0 && (!best || depth > best.depth)) best = { depth, nx: (bx - ax) / d, ny: (by - ay) / d, x: (ax + bx) / 2, y: (ay + by) / 2 };
      }
    }
    return best;
  }

  collideCars() {
    const cars = this.cars;
    const touching = new Set();
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (Math.abs(a.z - b.z) > 18) continue; // pas au même niveau
        const best = this.touch(a, b);
        if (!best) continue;
        const { nx, ny, depth } = best;
        a.x -= nx * depth / 2; a.y -= ny * depth / 2;
        b.x += nx * depth / 2; b.y += ny * depth / 2;
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const imp = -1.6 * rv / 2;
          a.vx -= imp * nx; a.vy -= imp * ny;
          b.vx += imp * nx; b.vy += imp * ny;
          if (rv < -90 && a.bump <= 0 && b.bump <= 0) {
            a.bump = b.bump = 0.3;
            this.events.push({ t: 'bump', x: Math.round(best.x), y: Math.round(best.y), h: Math.round(a.z), f: r1(Math.min(1, -rv / 350)) });
          }
          // Deux voitures de police qui se rentrent dedans à fond : tout explose.
          if (rv < -WRECK_CAR && a.role === 'cop' && b.role === 'cop' && this.phase === 'play') { this.wreck(a); this.wreck(b); }
        }
        // Flic contre fugitif : choc franc ou contact maintenu, c'est l'arrestation.
        if (this.phase === 'play' && a.role !== b.role) {
          const cop = a.role === 'cop' ? a : b, fug = cop === a ? b : a;
          if (cop.dead > 0) continue;
          touching.add(cop.id);
          cop.hold += 1 / 60;
          if (-rv > RAM_SPEED || cop.hold >= HOLD_TIME) this.arrest(cop, fug);
        }
      }
    }
    for (const c of cars) if (!touching.has(c.id)) c.hold = Math.max(0, c.hold - 0.5 / 60);
  }

  // ---------- Circulation civile ----------
  toss(n, vx, vy) {
    n.k = 1.5;
    n.vx = vx; n.vy = vy;
    n.spin = (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 6);
    this.stats.tosses += 1;
    this.events.push({ t: 'toss', x: Math.round(n.x), y: Math.round(n.y) });
  }

  moveNpcs(dt) {
    const loops = this.map.loops;
    this.npcs.forEach((n, idx) => {
      if (n.k > 0) {
        // Projetée : elle part en vrille, puis reprend sa ronde loin des joueurs.
        n.k -= dt;
        n.x = clamp(n.x + n.vx * dt, 15, SIZE - 15); n.y = clamp(n.y + n.vy * dt, 15, SIZE - 15);
        const f = Math.exp(-1.6 * dt);
        n.vx *= f; n.vy *= f;
        n.a = wrap(n.a + n.spin * dt);
        if (n.k <= 0) {
          const l = loops[n.loop];
          let best = 0, bd = -1;
          l.forEach((p, i) => {
            const d = Math.min(...this.cars.map(c => Math.hypot(c.x - p[0], c.y - p[1])), ...this.npcs.map(o => (o === n ? 1e9 : Math.hypot(o.x - p[0], o.y - p[1]))));
            if (d > bd) { bd = d; best = i; }
          });
          const p = l[best], q = l[(best + 1) % l.length];
          n.x = p[0]; n.y = p[1]; n.i = (best + 1) % l.length; n.a = Math.atan2(q[1] - p[1], q[0] - p[0]); n.v = 0; n.wait = 0;
        }
        return;
      }
      const l = loops[n.loop];
      let p = l[n.i];
      if (Math.hypot(p[0] - n.x, p[1] - n.y) < 34) { n.i = (n.i + 1) % l.length; p = l[n.i]; }
      const diff = wrap(Math.atan2(p[1] - n.y, p[0] - n.x) - n.a);
      n.a = wrap(n.a + clamp(diff * 6, -2.6, 2.6) * dt);
      // On freine si une voiture est juste devant (les civils cèdent aux civils de rang inférieur).
      const fx = Math.cos(n.a), fy = Math.sin(n.a);
      let blocked = false;
      const ahead = (x, y) => {
        const dx = x - n.x, dy = y - n.y, f = dx * fx + dy * fy;
        return f > 8 && f < 62 && Math.abs(dx * -fy + dy * fx) < 19;
      };
      for (const c of this.cars) if (c.up < 0 && ahead(c.x, c.y)) blocked = true;
      for (let k = 0; k < idx; k++) if (this.npcs[k].k <= 0 && ahead(this.npcs[k].x, this.npcs[k].y)) blocked = true;
      // Si ça dure, elle force le passage : personne ne reste coincé.
      n.wait = blocked ? n.wait + dt : 0;
      if (n.wait > 4) blocked = false;
      n.v += clamp((blocked ? 0 : NPC_SPEED * (Math.abs(diff) > 0.5 ? 0.6 : 1)) - n.v, -420 * dt, 160 * dt);
      n.x += fx * n.v * dt; n.y += fy * n.v * dt;
    });
  }

  collideNpcs() {
    for (const n of this.npcs) {
      if (n.k > 0) continue;
      for (const c of this.cars) {
        if (c.up >= 0 || c.z > 10) continue;
        const best = this.touch(n, c);
        if (!best) continue;
        const { nx, ny, depth } = best; // de la voiture civile vers le joueur
        c.x += nx * depth; c.y += ny * depth;
        const nvx = Math.cos(n.a) * n.v, nvy = Math.sin(n.a) * n.v;
        const rv = (c.vx - nvx) * nx + (c.vy - nvy) * ny;
        if (rv >= 0) continue;
        const speed = Math.hypot(c.vx - nvx, c.vy - nvy);
        if (-rv > TOSS_SPEED && this.phase !== 'ready') {
          // Percutée à pleine vitesse : la voiture civile est projetée.
          this.toss(n, c.vx * 0.9 - nx * 60, c.vy * 0.9 - ny * 60);
          c.vx *= 0.62; c.vy *= 0.62;
          if (c.role === 'cop' && speed > WRECK_CAR + 20 && this.phase === 'play') this.wreck(c);
        } else {
          c.vx -= 1.4 * rv * nx; c.vy -= 1.4 * rv * ny;
          if (rv < -90 && c.bump <= 0) { c.bump = 0.3; this.events.push({ t: 'bump', x: Math.round(best.x), y: Math.round(best.y), h: 0, f: r1(Math.min(1, -rv / 350)) }); }
        }
      }
    }
  }

  // ---------- Diffusion ----------
  snapshot() {
    const ev = this.events; this.events = [];
    return {
      round: this.round, rounds: this.rounds, phase: this.phase, msg: this.msg,
      timer: Math.max(0, Math.ceil(ROUND_TIME - this.t)),
      count: this.phase === 'ready' ? Math.ceil(this.wait) : 0,
      fug: this.fugId, fs: this.fugScore, fm: this.fugModel,
      cars: this.cars.map(c => ({
        id: c.id, x: r1(c.x), y: r1(c.y), a: Math.round(c.a * 1000) / 1000, h: Math.round(c.z),
        v: Math.round(Math.hypot(c.vx, c.vy)), cop: c.role === 'cop' ? 1 : 0,
        sk: c.skid, tb: c.turbo > 0 ? 1 : 0, dd: c.dead > 0 ? 1 : 0,
        cd: +(c.cdA / c.cfg.turboCd).toFixed(2),
      })),
      npcs: this.npcs.map(n => [Math.round(n.x), Math.round(n.y), Math.round(n.a * 100) / 100, n.k > 0 ? 1 : 0]),
      bz: this.barrels.map(b => (b.alive ? '1' : '0')).join(''),
      bags: this.bags.map(b => ({ i: b.i, x: Math.round(b.x), y: Math.round(b.y), h: b.z })),
      scores: this.scores, ev,
    };
  }

  // ---------- Bots ----------
  // Champs de distances partagés par tous les bots, recalculés dix fois par seconde.
  getFields() {
    const stamp = Math.floor(this.t * 10);
    if (this.fields && this.fields.stamp === stamp) return this.fields;
    const fug = this.car(this.fugId);
    const cops = this.cars.filter(c => c.role === 'cop' && c.dead <= 0);
    this.fields = {
      stamp,
      fug: this.nav.field([this.nodeOf(fug)]),
      cops: this.nav.field(cops.length ? cops.map(c => this.nodeOf(c)) : [0]),
    };
    return this.fields;
  }

  nodeOf(o) {
    if (o.up < 0) return this.nav.nearest(o.x, o.y);
    let best = 0, bd = Infinity;
    for (const n of this.map.structs[o.up].nodes) {
      const p = this.nav.pos(n), d = Math.hypot(p.x - o.x, p.y - o.y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  // Points de passage que la voiture peut viser tout de suite.
  candidates(me) {
    const out = [];
    const nav = this.nav;
    if (me.up >= 0) {
      const st = this.map.structs[me.up];
      for (const n of st.nodes) { const p = nav.pos(n), d = Math.hypot(p.x - me.x, p.y - me.y); if (d < 210) out.push({ n, x: p.x, y: p.y, d }); }
      for (const a of st.aprons) { const d = Math.hypot(a.x - me.x, a.y - me.y); if (d < 170) out.push({ n: a.node, x: a.x, y: a.y, d }); }
      return out;
    }
    const ci = Math.floor(me.x / CELL), cj = Math.floor(me.y / CELL);
    for (let j = Math.max(0, cj - 4); j <= Math.min(GN - 1, cj + 4); j++) {
      for (let i = Math.max(0, ci - 4); i <= Math.min(GN - 1, ci + 4); i++) {
        const n = i + j * GN;
        if (!nav.valid[n]) continue;
        const x = i * CELL + CELL / 2, y = j * CELL + CELL / 2, d = Math.hypot(x - me.x, y - me.y);
        if (d > 112 || (d > 30 && !clearLine(this.map, me.x, me.y, x, y, 17))) continue;
        out.push({ n, x, y, d });
      }
    }
    // Devant le pied d'une rampe : on peut monter.
    for (const st of this.map.structs) {
      for (const a of st.aprons) {
        if (Math.hypot(a.x - me.x, a.y - me.y) > 75) continue;
        const p = nav.pos(a.entry);
        out.push({ n: a.entry, x: p.x, y: p.y, d: Math.hypot(p.x - me.x, p.y - me.y) });
      }
    }
    return out;
  }

  bot(pid, dt = 0.1) {
    const me = this.car(pid);
    const idle = { input: { s: 0, b: false, a: false } };
    if (!me || this.phase !== 'play' || me.dead > 0) return idle;
    const ai = this.ai[pid] || (this.ai[pid] = { still: 0, escape: 0, ex: 0, ey: 0, node: -1, lx: me.x, ly: me.y, seed: Math.random() * 10 });

    // Anti-blocage : si on n'avance plus, on vise un autre point de passage pendant un instant.
    const moved = Math.hypot(me.x - ai.lx, me.y - ai.ly);
    ai.lx = me.x; ai.ly = me.y;
    ai.still = moved < 60 * dt ? ai.still + dt : Math.max(0, ai.still - dt * 2);
    if (ai.escape > 0) {
      ai.escape -= dt;
      return { input: this.steerTo(me, ai.ex, ai.ey, false) };
    }
    if (ai.still > 0.7) {
      ai.still = 0;
      ai.escape = 0.5 + Math.random() * 0.4;
      const c = this.candidates(me).filter(o => o.d > 40);
      const o = c.length ? c[Math.floor(Math.random() * c.length)] : { x: me.x - Math.cos(me.a) * 100 + rand(-80, 80), y: me.y - Math.sin(me.a) * 100 + rand(-80, 80) };
      ai.ex = o.x; ai.ey = o.y;
      return { input: this.steerTo(me, ai.ex, ai.ey, false) };
    }
    return { input: me.role === 'cop' ? this.botCop(me, ai) : this.botRobber(me, ai) };
  }

  // Commandes pour rouler vers un point : braquage proportionnel, frein à main si ça tourne sec.
  steerTo(me, x, y, allowDrift = true, slow = false) {
    let dx = x - me.x, dy = y - me.y;
    let l = Math.hypot(dx, dy) || 1;
    const sp = Math.hypot(me.vx, me.vy);
    if (me.up < 0) {
      // Un arbre, un poteau ou un baril sur la route : on vise à côté.
      const dodge = o => {
        const ox = o.x - me.x, oy = o.y - me.y;
        if (Math.abs(ox) > 150 || Math.abs(oy) > 150) return false;
        const along = (ox * dx + oy * dy) / l;
        if (along < 0 || along > Math.min(l, 110 + o.r)) return false;
        const nx = -dy / l, ny = dx / l;
        const side = ox * nx + oy * ny;
        const need = o.r + 22;
        if (Math.abs(side) >= need) return false;
        const k = side > 0 ? -1 : 1;
        dx = ox + nx * need * k; dy = oy + ny * need * k;
        l = Math.hypot(dx, dy) || 1;
        return true;
      };
      if (!this.map.circles.some(dodge)) this.barrels.some(b => b.alive && dodge(b));
    }
    const diff = wrap(Math.atan2(dy, dx) - me.a);
    // Frein à main si ça tourne sec, ou si le point est trop près pour le rayon de braquage
    // (sinon on tourne autour sans jamais l'atteindre).
    const tight = Math.abs(diff) > 1.3 || (Math.abs(diff) > 0.7 && l < 150);
    return { s: clamp(diff * 2.6, -1, 1), a: false, b: allowDrift && ((tight && sp > 125) || (slow && sp > 180)) };
  }

  // Meilleur point de passage selon un champ de distances (le plus petit, ou le plus grand si `flee`).
  follow(me, field) {
    let best = null, bc = Infinity;
    for (const c of this.candidates(me)) {
      const cost = field[c.n] * CELL + c.d * 0.9;
      if (cost < bc) { bc = cost; best = c; }
    }
    if (best && best.n < this.nav.grid) {
      // Virage serré juste après ce point : on lèvera le pied avant d'y arriver.
      const q = this.nav.pos(this.nav.descend(field, best.n, 5));
      if (Math.hypot(q.x - best.x, q.y - best.y) > 60) {
        const bend = Math.abs(wrap(Math.atan2(q.y - best.y, q.x - best.x) - Math.atan2(best.y - me.y, best.x - me.x)));
        best.slow = bend > 0.9 && best.d < 150;
      }
    }
    return best;
  }

  botCop(me, ai) {
    const fug = this.car(this.fugId);
    const cops = this.cars.filter(c => c.role === 'cop');
    const k = cops.indexOf(me);
    const d = Math.hypot(fug.x - me.x, fug.y - me.y);
    // Chaque flic anticipe un peu différemment pour prendre le fugitif en tenaille.
    const lead = d > 140 ? [0.15, 0.8, 0.45, 1.2][k % 4] * Math.min(1, d / 400) : 0.1;
    const tx = clamp(fug.x + fug.vx * lead, 20, SIZE - 20), ty = clamp(fug.y + fug.vy * lead, 20, SIZE - 20);
    let to = null, direct = false;
    if (me.up === fug.up && (me.up >= 0 || clearLine(this.map, me.x, me.y, tx, ty))) { to = { x: tx, y: ty }; direct = true; }
    else to = this.follow(me, this.getFields().fug) || { x: tx, y: ty };
    const inp = this.steerTo(me, to.x + Math.sin(this.t * 1.7 + ai.seed) * 10, to.y + Math.cos(this.t * 1.3 + ai.seed) * 10, true, !!to.slow);
    // Turbo quand le fugitif est en vue, droit devant.
    const aim = Math.abs(wrap(Math.atan2(to.y - me.y, to.x - me.x) - me.a));
    inp.a = direct && d < 330 && d > 60 && aim < 0.3 && me.cdA <= 0 && Math.random() < 0.5;
    return inp;
  }

  botRobber(me, ai) {
    const f = this.getFields();
    const cops = this.cars.filter(c => c.role === 'cop' && c.dead <= 0);
    const danger = cops.length ? Math.min(...cops.map(c => Math.hypot(c.x - me.x, c.y - me.y) + Math.abs(c.z - me.z) * 4)) : 9999;
    const cands = this.candidates(me);
    if (!cands.length) return this.steerTo(me, SIZE / 2, SIZE / 2);

    // Une liasse toute proche et en vue : on la prend au passage.
    for (const b of this.bags) {
      const d = Math.hypot(b.x - me.x, b.y - me.y);
      if (b.st !== me.up || d > 170 || danger < 200) continue;
      const turn = Math.abs(wrap(Math.atan2(b.y - me.y, b.x - me.x) - me.a));
      if (turn < 1 && (me.up >= 0 || clearLine(this.map, me.x, me.y, b.x, b.y))) return this.steerTo(me, b.x, b.y);
    }

    // On choisit une destination où l'on arrive bien avant les flics, et on s'y tient
    // quelques secondes (changer d'avis sans arrêt, c'est finir dans un mur).
    ai.goalT = (ai.goalT || 0) - 0.1;
    const lost = () => !ai.goal || ai.goalT <= 0 || f.fug[ai.goal.n] < 4 || f.cops[ai.goal.n] - f.fug[ai.goal.n] < 3;
    if (lost()) {
      let top = null, ts = -Infinity;
      const rate = (n, bonus) => {
        const mine = f.fug[n], theirs = f.cops[n];
        if (mine >= 30000) return;
        // Un demi-tour dans une rue coûte cher : on préfère ce qui est devant.
        const p = this.nav.pos(n);
        const back = Math.abs(wrap(Math.atan2(p.y - me.y, p.x - me.x) - me.a)) > 2 ? 14 : 0;
        const sc = (theirs - mine) + Math.min(theirs, 70) * 0.35 + bonus - back - (mine < 12 ? 25 : 0) + Math.random() * 6;
        if (sc > ts) { ts = sc; top = n; }
      };
      for (const sp of this.map.bagSpots) {
        if (sp.n === undefined) sp.n = this.nodeOf({ x: sp.x, y: sp.y, up: sp.st });
        rate(sp.n, 0);
      }
      for (const b of this.bags) rate(this.nodeOf({ x: b.x, y: b.y, up: b.st }), danger > 330 ? 45 : 10);
      ai.goal = { n: top ?? this.nodeOf(me) };
      ai.goalT = 4;
      ai.field = this.nav.field([ai.goal.n]);
    }
    const best = this.follow(me, ai.field) || cands[0];
    const inp = this.steerTo(me, best.x, best.y, true, !!best.slow);
    inp.a = danger < 160 && me.cdA <= 0 && Math.random() < 0.4;
    return inp;
  }

  results() {
    const ids = Object.keys(this.scores).sort((a, b) => this.scores[b] - this.scores[a] || this.busts[b] - this.busts[a]);
    const groups = [];
    for (const id of ids) {
      const last = groups[groups.length - 1];
      if (last && this.scores[last[0]] === this.scores[id] && this.busts[last[0]] === this.busts[id]) last.push(id);
      else groups.push([id]);
    }
    const detail = Object.fromEntries(ids.map(id => {
      const n = this.busts[id];
      return [id, `${this.scores[id]} pts` + (n ? ` · ${n} arrestation${n > 1 ? 's' : ''}` : '')];
    }));
    return { groups, detail };
  }
}
