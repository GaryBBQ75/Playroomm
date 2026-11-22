// Course-poursuite : un fugitif contre des flics dans une petite ville (rendu 3D côté client).
// Physique arcade sur le plan (x, y) : la voiture avance toute seule et braque vers la
// direction du joystick, dérape au frein à main, rebondit sur les immeubles.
import { sanitizeInput, shuffle, rand, clamp } from './arena.js';
import { getMap, clearLine, nodeDistances, nearestNode, nodePos, NODES, PITCH, SIZE } from './chasemap.js';

const ROUND_TIME = 45;
const MAX_ROUNDS = 4;
const READY_TIME = 2.6;
const END_TIME = 3.2;
const SURVIVE_EVERY = 3;   // 1 point toutes les 3 s de cavale
const BAG_PTS = 2;
const BUST_PTS = 5;        // le flic qui arrête
const ASSIST_PTS = 2;      // les autres flics
const ESCAPE_PTS = 8;
const MAX_BAGS = 3;
const HOLD_TIME = 0.4;     // contact maintenu pour arrêter
const RAM_SPEED = 100;     // ou choc franc à cette vitesse relative

const CAR_R = 11;          // deux disques par voiture (avant et arrière)
const CAR_OFF = 10;
const TURBO_TIME = 1.0;

// Réglages par rôle : le fugitif est un peu plus rapide et plus maniable.
// Plus les flics sont nombreux, moins ils sont rapides ; seul (à 2 joueurs), le flic a
// un turbo bien plus fréquent.
const ROBBER = { speed: 272, accel: 430, turn: 4.6 };
const COP = { speed: 252, accel: 390, turn: 4.1 };
function roleConfig(role, cops) {
  if (role === 'robber') return { ...ROBBER, turboCd: Math.max(4, 7 - 0.5 * cops) };
  if (cops === 1) return { ...COP, speed: 264, accel: 430, turboCd: 3 };
  return { ...COP, speed: COP.speed - 9 * Math.min(6, cops - 2), turboCd: 5 };
}

export default {
  id: 'chase',
  name: 'Course-poursuite',
  emoji: '🚓',
  tagline: 'Un fugitif, des flics, une ville en 3D',
  duration: '3 min',
  family: 'Chaos',
  minPlayers: 2,
  maxPlayers: 8,
  controls: { type: 'stick', a: 'Turbo', b: 'Frein à main' },
  howto: [
    'Joystick pour braquer, la voiture roule toute seule',
    '⚡ Turbo, 💨 frein à main pour déraper dans les virages',
    'Fugitif : tiens 45 s et ramasse les sacs de billets',
    'Flics : foncez dessus pour l\'arrêter',
  ],
  create(players) { return new Chase(players); },
};

const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const r1 = v => Math.round(v * 10) / 10;

class Chase {
  constructor(players) {
    this.players = players;
    this.map = getMap();
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
    this.startRound();
  }

  name(id) { return this.players.find(p => p.id === id)?.name || '?'; }
  car(id) { return this.cars.find(c => c.id === id); }

  startRound() {
    this.round += 1;
    this.fugId = this.order[this.round - 1];
    this.t = 0;
    this.phase = 'ready';
    this.wait = READY_TIME;
    this.fugScore = 0;
    this.surviveT = 0;
    this.bags = [];
    this.bagT = 0.5;
    this.ai = {};
    const cops = this.players.length - 1;
    const c = SIZE / 2;
    // Le fugitif part d'un carrefour au bord de la place, les flics des bords de la ville.
    const [fi, fj] = [[3, 2], [2, 3], [4, 3], [3, 4]][Math.floor(Math.random() * 4)];
    const fx = nodePos(fi), fy = nodePos(fj);
    const outer = shuffle([[0, 0], [6, 0], [0, 6], [6, 6], [3, 0], [0, 3], [6, 3], [3, 6]])
      .map(([i, j]) => ({ x: nodePos(i), y: nodePos(j) }))
      .sort((a, b) => Math.hypot(b.x - fx, b.y - fy) - Math.hypot(a.x - fx, a.y - fy));
    let k = 0;
    this.cars = this.players.map(p => {
      const fug = p.id === this.fugId;
      const pos = fug ? { x: fx, y: fy } : outer[k++ % outer.length];
      const toCenter = Math.atan2(c - pos.y, c - pos.x);
      return {
        id: p.id, role: fug ? 'robber' : 'cop', cfg: roleConfig(fug ? 'robber' : 'cop', cops),
        x: pos.x, y: pos.y, a: fug ? toCenter + Math.PI : toCenter, vx: 0, vy: 0,
        inp: { mx: 0, my: 0, a: false, b: false }, prevA: false,
        cdA: 0, turbo: 0, skid: 0, hold: 0, bump: 0,
      };
    });
    this.msg = `Manche ${this.round}/${this.rounds} : ${this.name(this.fugId)} est le fugitif !`;
    this.events.push({ t: 'round' });
  }

  input(pid, inp) {
    const c = this.car(pid);
    if (c) c.inp = sanitizeInput(inp);
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

    // Sacs de billets.
    const fug = this.car(this.fugId);
    this.bagT -= dt;
    if (this.bags.length < MAX_BAGS && this.bagT <= 0) { this.spawnBag(fug); this.bagT = 1.5; }
    for (const b of this.bags) {
      if (Math.hypot(b.x - fug.x, b.y - fug.y) < 26) {
        b.gone = true;
        this.scores[this.fugId] += BAG_PTS;
        this.fugScore += BAG_PTS;
        this.events.push({ t: 'cash', id: fug.id, x: b.x, y: b.y });
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
    this.events.push({ t: 'bust', by: cop.id, id: fug.id, x: Math.round(fug.x), y: Math.round(fug.y) });
    this.endRound();
  }

  spawnBag(fug) {
    const spots = this.map.bagSpots.filter(s =>
      Math.hypot(s.x - fug.x, s.y - fug.y) > 170 && !this.bags.some(b => Math.hypot(b.x - s.x, b.y - s.y) < 200));
    if (!spots.length) return;
    const s = spots[Math.floor(Math.random() * spots.length)];
    this.bags.push({ i: ++this.bagSeq, x: s.x, y: s.y });
  }

  // ---------- Physique ----------
  simulate(dt, stopping) {
    for (const c of this.cars) this.drive(c, dt, stopping);
    this.collideCars();
    for (const c of this.cars) this.collideWorld(c);
  }

  drive(c, dt, stopping) {
    const cfg = c.cfg;
    c.cdA = Math.max(0, c.cdA - dt);
    c.turbo = Math.max(0, c.turbo - dt);
    c.bump = Math.max(0, c.bump - dt);
    const inp = stopping ? { mx: 0, my: 0, a: false, b: true } : c.inp;
    const steer = Math.hypot(inp.mx, inp.my) > 0.2;

    if (!stopping && inp.a && !c.prevA && c.cdA <= 0) {
      c.turbo = TURBO_TIME;
      c.cdA = cfg.turboCd;
      this.events.push({ t: 'turbo', id: c.id });
    }
    c.prevA = inp.a;
    const brake = inp.b;

    // Direction : on tourne vers l'angle visé, plus sec au frein à main.
    let fx = Math.cos(c.a), fy = Math.sin(c.a);
    let vf = c.vx * fx + c.vy * fy;
    let turning = 0;
    if (steer) {
      const diff = wrap(Math.atan2(inp.my, inp.mx) - c.a);
      const grip = 0.55 + 0.45 * Math.min(1, Math.abs(vf) / 140);
      const rate = cfg.turn * (brake ? 1.75 : 1) * grip;
      const w = clamp(diff * 9, -rate, rate);
      c.a = wrap(c.a + w * dt);
      turning = Math.abs(w) / rate;
      fx = Math.cos(c.a); fy = Math.sin(c.a);
    }
    const rx = -fy, ry = fx;
    vf = c.vx * fx + c.vy * fy;
    let vl = c.vx * rx + c.vy * ry;

    // Vitesse visée : plein gaz si on braque, un peu moins joystick relâché.
    // On lève un peu le pied dans les virages serrés, ça aide à tourner dans les rues.
    let target = cfg.speed * (steer ? 1 - 0.22 * turning : 0.72);
    if (c.turbo > 0) target = cfg.speed * 1.5;
    if (brake) target *= 0.7;
    if (stopping) target = 0;
    const accel = c.turbo > 0 ? cfg.accel * 2.6 : cfg.accel;
    vf += clamp(target - vf, -(stopping ? 520 : 300) * dt, accel * dt);
    // Adhérence latérale : faible au frein à main, la voiture glisse.
    vl *= Math.exp(-(brake ? 1.7 : 7.5) * dt);
    c.skid = !stopping && Math.abs(vl) > (brake ? 35 : 75) && Math.hypot(vf, vl) > 90 ? 1 : 0;

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
    if (vn >= 0) return;
    c.vx -= 1.3 * vn * nx; c.vy -= 1.3 * vn * ny;
    if (vn < -130) {
      // Choc franc : on perd de la vitesse et ça fait des étincelles.
      c.vx *= 0.72; c.vy *= 0.72;
      if (c.bump <= 0) {
        c.bump = 0.35;
        this.events.push({ t: 'crash', id: c.id, x: Math.round(c.x - nx * CAR_R), y: Math.round(c.y - ny * CAR_R), f: r1(Math.min(1, -vn / 300)) });
      }
    } else {
      c.vx *= 0.992; c.vy *= 0.992;
    }
  }

  collideWorld(c) {
    const { rects, circles } = this.map;
    for (let pass = 0; pass < 2; pass++) {
      for (const [dx, dy] of this.discs(c)) {
        for (const r of rects) {
          const px = clamp(dx, r.x, r.x + r.w), py = clamp(dy, r.y, r.y + r.h);
          let nx = dx - px, ny = dy - py;
          const d = Math.hypot(nx, ny);
          if (d >= CAR_R) continue;
          if (d < 0.001) {
            // Disque enfoncé dans le pâté : on sort par le côté le plus proche.
            const l = dx - r.x, rr = r.x + r.w - dx, t = dy - r.y, b = r.y + r.h - dy;
            const m = Math.min(l, rr, t, b);
            if (m === l) this.bounce(c, -1, 0, l + CAR_R);
            else if (m === rr) this.bounce(c, 1, 0, rr + CAR_R);
            else if (m === t) this.bounce(c, 0, -1, t + CAR_R);
            else this.bounce(c, 0, 1, b + CAR_R);
            continue;
          }
          nx /= d; ny /= d;
          this.bounce(c, nx, ny, CAR_R - d);
        }
        for (const o of circles) {
          const nx = dx - o.x, ny = dy - o.y;
          const d = Math.hypot(nx, ny) || 0.001;
          if (d >= CAR_R + o.r) continue;
          this.bounce(c, nx / d, ny / d, CAR_R + o.r - d);
        }
        // Quais : bords de l'île.
        if (dx < CAR_R) this.bounce(c, 1, 0, CAR_R - dx);
        if (dx > SIZE - CAR_R) this.bounce(c, -1, 0, dx - (SIZE - CAR_R));
        if (dy < CAR_R) this.bounce(c, 0, 1, CAR_R - dy);
        if (dy > SIZE - CAR_R) this.bounce(c, 0, -1, dy - (SIZE - CAR_R));
      }
    }
  }

  collideCars() {
    const cars = this.cars;
    const touching = new Set();
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i], b = cars[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) > 2 * (CAR_R + CAR_OFF)) continue;
        let best = null;
        for (const [ax, ay] of this.discs(a)) {
          for (const [bx, by] of this.discs(b)) {
            const d = Math.hypot(bx - ax, by - ay) || 0.001;
            const depth = 2 * CAR_R - d;
            if (depth > 0 && (!best || depth > best.depth)) best = { depth, nx: (bx - ax) / d, ny: (by - ay) / d, x: (ax + bx) / 2, y: (ay + by) / 2 };
          }
        }
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
            this.events.push({ t: 'bump', x: Math.round(best.x), y: Math.round(best.y), f: r1(Math.min(1, -rv / 350)) });
          }
        }
        // Flic contre fugitif : choc franc ou contact maintenu, c'est l'arrestation.
        if (this.phase === 'play' && a.role !== b.role) {
          const cop = a.role === 'cop' ? a : b, fug = cop === a ? b : a;
          touching.add(cop.id);
          cop.hold += 1 / 60;
          if (-rv > RAM_SPEED || cop.hold >= HOLD_TIME) this.arrest(cop, fug);
        }
      }
    }
    for (const c of cars) if (!touching.has(c.id)) c.hold = Math.max(0, c.hold - 0.5 / 60);
  }

  // ---------- Diffusion ----------
  snapshot() {
    const ev = this.events; this.events = [];
    return {
      round: this.round, rounds: this.rounds, phase: this.phase, msg: this.msg,
      timer: Math.max(0, Math.ceil(ROUND_TIME - this.t)),
      count: this.phase === 'ready' ? Math.ceil(this.wait) : 0,
      fug: this.fugId, fs: this.fugScore,
      cars: this.cars.map(c => ({
        id: c.id, x: r1(c.x), y: r1(c.y), a: Math.round(c.a * 1000) / 1000,
        v: Math.round(Math.hypot(c.vx, c.vy)), cop: c.role === 'cop' ? 1 : 0,
        sk: c.skid, tb: c.turbo > 0 ? 1 : 0,
        cd: +(c.cdA / c.cfg.turboCd).toFixed(2),
      })),
      bags: this.bags.map(b => ({ i: b.i, x: Math.round(b.x), y: Math.round(b.y) })),
      scores: this.scores, ev,
    };
  }

  // ---------- Bots ----------
  bot(pid, dt = 0.1) {
    const me = this.car(pid);
    if (!me || this.phase !== 'play') return { input: { mx: 0, my: 0, a: false, b: false } };
    const ai = this.ai[pid] || (this.ai[pid] = { still: 0, escape: 0, ex: 0, ey: 0, node: -1, lx: me.x, ly: me.y, seed: Math.random() * 10 });

    // Anti-blocage : si on n'avance plus, on vise le carrefour le plus dégagé pendant un instant.
    const moved = Math.hypot(me.x - ai.lx, me.y - ai.ly);
    ai.lx = me.x; ai.ly = me.y;
    ai.still = moved < 60 * dt ? ai.still + dt : Math.max(0, ai.still - dt * 2);
    if (ai.escape > 0) {
      ai.escape -= dt;
      return { input: this.steerTo(me, ai.ex, ai.ey, false) };
    }
    if (ai.still > 0.5) {
      ai.still = 0;
      ai.tries = (ai.tries || 0) + 1;
      ai.escape = 0.6 + Math.random() * 0.4;
      const out = this.unstuckPoint(me, ai.tries);
      ai.ex = out.x; ai.ey = out.y;
      return { input: this.steerTo(me, ai.ex, ai.ey, false) };
    }
    if (moved > 150 * dt) ai.tries = 0;

    return { input: me.role === 'cop' ? this.botCop(me, ai) : this.botRobber(me, ai) };
  }

  unstuckPoint(me, tries) {
    // D'abord le carrefour le plus proche en vue, sinon une direction au hasard.
    if (tries % 3 !== 0) {
      const cands = this.visibleNodes(me);
      if (cands.length) {
        const n = cands[Math.floor(Math.random() * Math.min(2, cands.length))];
        return { x: n.x, y: n.y };
      }
    }
    const a = me.a + Math.PI + rand(-1.2, 1.2);
    return { x: me.x + Math.cos(a) * 200, y: me.y + Math.sin(a) * 200 };
  }

  // Entrée joystick pour rouler vers un point.
  steerTo(me, x, y, allowDrift = true) {
    let dx = x - me.x, dy = y - me.y;
    let l = Math.hypot(dx, dy) || 1;
    // Un arbre, un kiosque ou la fontaine sur la route : on vise à côté.
    for (const o of this.map.circles) {
      const ox = o.x - me.x, oy = o.y - me.y;
      const along = (ox * dx + oy * dy) / l;
      if (along < 0 || along > Math.min(l, 110 + o.r)) continue;
      const nx = -dy / l, ny = dx / l;
      const side = ox * nx + oy * ny;
      const need = o.r + 22;
      if (Math.abs(side) >= need) continue;
      const k = side > 0 ? -1 : 1;
      dx = ox + nx * need * k; dy = oy + ny * need * k;
      l = Math.hypot(dx, dy) || 1;
      break;
    }
    const diff = Math.abs(wrap(Math.atan2(dy, dx) - me.a));
    const sp = Math.hypot(me.vx, me.vy);
    return { mx: dx / l, my: dy / l, a: false, b: allowDrift && diff > 0.9 && sp > 150 };
  }

  // Carrefours voisins atteignables en ligne droite, du plus proche au plus loin.
  visibleNodes(me) {
    const gi = (me.x - nodePos(0)) / PITCH, gj = (me.y - nodePos(0)) / PITCH;
    const out = [];
    for (let j = Math.max(0, Math.floor(gj - 1)); j <= Math.min(NODES - 1, Math.ceil(gj + 1)); j++) {
      for (let i = Math.max(0, Math.floor(gi - 1)); i <= Math.min(NODES - 1, Math.ceil(gi + 1)); i++) {
        const n = i + j * NODES;
        if (this.map.blocked.has(n)) continue;
        const x = nodePos(i), y = nodePos(j);
        if (!clearLine(this.map, me.x, me.y, x, y)) continue;
        out.push({ n, x, y, d: Math.hypot(x - me.x, y - me.y) });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  // Suit les rues jusqu'au point (tx, ty) : tout droit si la vue est dégagée, sinon de carrefour en carrefour.
  routeTo(me, tx, ty) {
    if (clearLine(this.map, me.x, me.y, tx, ty)) return { x: tx, y: ty, direct: true };
    const dist = nodeDistances(this.map, nearestNode(this.map, tx, ty));
    let best = null, bc = Infinity;
    for (const c of this.visibleNodes(me)) {
      const cost = dist[c.n] * PITCH + c.d * 0.9;
      if (cost < bc) { bc = cost; best = c; }
    }
    return best ? { x: best.x, y: best.y, direct: false } : { x: tx, y: ty, direct: false };
  }

  botCop(me, ai) {
    const fug = this.car(this.fugId);
    const cops = this.cars.filter(c => c.role === 'cop');
    const k = cops.indexOf(me);
    const d = Math.hypot(fug.x - me.x, fug.y - me.y);
    // Chaque flic anticipe un peu différemment pour prendre le fugitif en tenaille.
    const lead = d > 140 ? [0.15, 0.9, 0.5, 1.4][k % 4] * Math.min(1, d / 400) : 0.1;
    const tx = clamp(fug.x + fug.vx * lead, 20, SIZE - 20), ty = clamp(fug.y + fug.vy * lead, 20, SIZE - 20);
    const to = this.routeTo(me, tx, ty);
    const inp = this.steerTo(me, to.x + Math.sin(this.t * 1.7 + ai.seed) * 14, to.y + Math.cos(this.t * 1.3 + ai.seed) * 14);
    // Turbo quand le fugitif est en vue, droit devant.
    const aim = Math.abs(wrap(Math.atan2(to.y - me.y, to.x - me.x) - me.a));
    inp.a = to.direct && d < 330 && d > 60 && aim < 0.35 && me.cdA <= 0 && Math.random() < 0.5;
    return inp;
  }

  botRobber(me, ai) {
    const cops = this.cars.filter(c => c.role === 'cop');
    const copDist = (x, y) => Math.min(...cops.map(c => Math.hypot(c.x + c.vx * 0.3 - x, c.y + c.vy * 0.3 - y)));
    const danger = copDist(me.x, me.y);

    // Un sac tout proche et la voie est libre : on le prend.
    if (danger > 190) {
      let bag = null, bd = 260;
      for (const b of this.bags) {
        const d = Math.hypot(b.x - me.x, b.y - me.y);
        if (d < bd && copDist(b.x, b.y) > 170 && clearLine(this.map, me.x, me.y, b.x, b.y)) { bd = d; bag = b; }
      }
      if (bag) { ai.node = -1; return this.steerTo(me, bag.x, bag.y); }
    }

    // Sinon on choisit le carrefour voisin le plus loin des flics.
    const cands = this.visibleNodes(me);
    let cur = cands.find(c => c.n === ai.node);
    if (cur && cur.d < 50) cur = null;
    let best = null, bs = -Infinity;
    for (const c of cands) {
      if (c.d < 50) continue;
      const i = c.n % NODES, j = (c.n - i) / NODES;
      // Un coup d'avance : la meilleure sortie de ce carrefour.
      let next = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= NODES || b >= NODES || this.map.blocked.has(a + b * NODES)) continue;
        next = Math.max(next, Math.min(500, copDist(nodePos(a), nodePos(b))));
      }
      const turn = Math.abs(wrap(Math.atan2(c.y - me.y, c.x - me.x) - me.a));
      const here = copDist(c.x, c.y);
      let s = Math.min(500, here) + next * 0.6 - turn * 55 - c.d * 0.15;
      // Un flic arrive avant nous à ce carrefour : mauvaise idée.
      if (here < c.d * 0.9) s -= 320;
      for (const b of this.bags) if (Math.hypot(b.x - c.x, b.y - c.y) < PITCH * 0.6) s += 70;
      if (c.n === ai.node) s += 45;
      if (s > bs) { bs = s; best = c; }
    }
    if (!best) best = cur || cands[0];
    if (!best) return this.steerTo(me, SIZE / 2, SIZE / 2);
    ai.node = best.n;
    const inp = this.steerTo(me, best.x, best.y);
    inp.a = danger < 150 && me.cdA <= 0 && Math.random() < 0.4;
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
