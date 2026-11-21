import {
  makeBody, moveBodies, collideBodies, pressed, spawnCircle, bodySnap,
  sanitizeInput, botSeek, rand, W, H,
} from './arena.js';

const N = 10;            // grille 10 x 10
const T = W / N;         // taille d'une dalle
const ROUNDS = 3;
const ROUND_MAX = 75;

export default {
  id: 'brawl',
  name: 'Bagarre',
  emoji: '🥊',
  tagline: 'Cogne, le sol s\'effondre',
  duration: '3 min',
  family: 'Chaos',
  minPlayers: 2,
  maxPlayers: 8,
  controls: { type: 'stick', a: 'Coup', b: 'Esquive' },
  howto: ['Joystick pour bouger', '👊 pour frapper : plus tu as pris de coups, plus tu voles loin', '💨 pour esquiver', 'Les dalles tombent, ne tombe pas avec !', '3 manches'],
  create(players) { return new Brawl(players); },
};

class Brawl {
  constructor(players) {
    this.players = players;
    this.round = 0;
    this.scores = Object.fromEntries(players.map(p => [p.id, 0]));
    this.kos = Object.fromEntries(players.map(p => [p.id, 0]));
    this.over = false;
    this.events = [];
    this.startRound();
  }

  startRound() {
    this.round += 1;
    this.t = 0;
    this.phase = 'play';
    this.out = [];
    this.tiles = new Array(N * N).fill(0); // 0 solide, >0 tremble, -1 tombée
    this.nextCrumble = 8;
    const pos = spawnCircle(this.players.length, 250);
    this.bodies = this.players.map((p, i) => {
      const b = makeBody(p, pos[i][0], pos[i][1], 36);
      b.dmg = 0; b.lastHitBy = null; b.lastHitT = -10; b.punchT = 0;
      return b;
    });
    this.msg = `Manche ${this.round} / ${ROUNDS}`;
  }

  body(id) { return this.bodies.find(b => b.id === id); }

  input(pid, inp) {
    const b = this.body(pid);
    if (b) b.inp = sanitizeInput(inp);
  }

  tileAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return -1;
    return this.tiles[Math.floor(y / T) * N + Math.floor(x / T)];
  }

  crumble() {
    const solid = [];
    for (let i = 0; i < N * N; i++) if (this.tiles[i] === 0) solid.push(i);
    if (solid.length <= 6) return;
    const dist = i => {
      const cx = (i % N + 0.5) * T - W / 2, cy = (Math.floor(i / N) + 0.5) * T - H / 2;
      return Math.hypot(cx, cy) + rand(0, 140);
    };
    solid.sort((a, b) => dist(b) - dist(a));
    const count = this.t > 40 ? 3 : this.t > 22 ? 2 : 1;
    for (let k = 0; k < count && k < solid.length - 6; k++) this.tiles[solid[k]] = 1.4;
  }

  tick(dt) {
    if (this.over) return;
    if (this.phase === 'pause') {
      this.pause -= dt;
      if (this.pause <= 0) {
        if (this.round >= ROUNDS) this.over = true;
        else this.startRound();
      }
      return;
    }
    this.t += dt;
    if (this.t > 1.2 && this.msg.startsWith('Manche')) this.msg = '';

    // Effondrement progressif du sol
    if (this.t >= this.nextCrumble) {
      this.crumble();
      this.nextCrumble = this.t + Math.max(0.7, 1.6 - this.t / 60);
    }
    for (let i = 0; i < N * N; i++) {
      if (this.tiles[i] > 0) {
        this.tiles[i] -= dt;
        if (this.tiles[i] <= 0) this.tiles[i] = -1;
      }
    }

    const ready = this.t >= 1.2;
    for (const b of this.bodies) {
      if (!b.alive || b.falling) continue;
      if (!ready) { b.inp = { mx: 0, my: 0, a: false, b: false }; continue; }
      b.punchT = Math.max(0, b.punchT - dt);
      if (pressed(b, 'a') && b.cdA <= 0 && b.stun <= 0) this.punch(b);
      if (pressed(b, 'b') && b.cdB <= 0 && b.stun <= 0) {
        b.vx += b.fx * 700; b.vy += b.fy * 700; b.cdB = 1.3;
        b.dodge = 0.25;
        this.events.push({ t: 'dash', id: b.id });
      }
      if (b.dodge) b.dodge = Math.max(0, b.dodge - dt);
    }
    moveBodies(this.bodies, dt, { accel: 2400, maxSpeed: 290, friction: 4.2 });
    collideBodies(this.bodies, { bounce: 0.5 });

    for (const b of this.bodies) {
      if (!b.alive) continue;
      if (b.falling) {
        b.falling += dt;
        if (b.falling > 0.9) b.alive = false;
        continue;
      }
      if (this.tileAt(b.x, b.y) === -1) {
        b.falling = 0.001;
        b.vx *= 0.3; b.vy *= 0.3;
        this.out.push(b.id);
        let by = null;
        if (b.lastHitBy && this.t - b.lastHitT < 4 && b.lastHitBy !== b.id) {
          by = b.lastHitBy;
          this.kos[by] += 1;
          this.scores[by] += 2;
        }
        this.events.push({ t: 'fall', id: b.id, by, x: Math.round(b.x), y: Math.round(b.y) });
      }
    }

    const standing = this.bodies.filter(b => b.alive && !b.falling);
    if (standing.length <= 1 || this.t > ROUND_MAX) this.endRound(standing);
  }

  punch(b) {
    b.cdA = 0.42;
    b.punchT = 0.18;
    this.events.push({ t: 'punch', id: b.id });
    for (const o of this.bodies) {
      if (o === b || !o.alive || o.falling || o.dodge > 0) continue;
      const dx = o.x - b.x, dy = o.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d > b.r + o.r + 55) continue;
      const dot = (dx * b.fx + dy * b.fy) / (d || 1);
      if (dot < 0.45) continue;
      o.dmg += 11;
      const force = 260 + o.dmg * 7.5;
      const nx = dx / (d || 1), ny = dy / (d || 1);
      o.vx += nx * force; o.vy += ny * force;
      o.stun = 0.18 + Math.min(0.5, o.dmg / 400);
      o.lastHitBy = b.id; o.lastHitT = this.t;
      this.events.push({ t: 'hit', id: o.id, x: Math.round((o.x + b.x) / 2), y: Math.round((o.y + b.y) / 2), f: Math.min(1, o.dmg / 150) });
    }
  }

  endRound(standing) {
    this.out.forEach((id, i) => { this.scores[id] += i; });
    for (const b of standing) this.scores[b.id] += this.out.length + 1;
    const winner = standing.length === 1 ? standing[0] : null;
    this.msg = winner ? `${winner.name} gagne la manche !` : 'Égalité !';
    this.phase = 'pause';
    this.pause = 2.8;
  }

  snapshot() {
    const ev = this.events; this.events = [];
    return {
      round: this.round, rounds: ROUNDS, msg: this.msg,
      timer: Math.max(0, Math.ceil(ROUND_MAX - this.t)),
      tiles: this.tiles.map(v => (v === -1 ? -1 : v > 0 ? 1 : 0)),
      bodies: this.bodies.map(b => ({ ...bodySnap(b), dmg: b.dmg, punch: b.punchT > 0 ? 1 : 0 })),
      scores: this.scores, ev,
    };
  }

  bot(pid) {
    const me = this.body(pid);
    if (!me || !me.alive || me.falling) return { input: { mx: 0, my: 0 } };
    // Si la dalle sous moi tremble ou si je suis près du vide : rejoindre une dalle sûre au centre.
    const look = (dx, dy) => this.tileAt(me.x + dx, me.y + dy);
    const danger = look(0, 0) !== 0 || look(me.vx * 0.35, me.vy * 0.35) !== 0;
    if (danger) {
      let best = null, bd = Infinity;
      for (let i = 0; i < N * N; i++) {
        if (this.tiles[i] !== 0) continue;
        const x = (i % N + 0.5) * T, y = (Math.floor(i / N) + 0.5) * T;
        const d = Math.hypot(x - me.x, y - me.y) + Math.hypot(x - W / 2, y - H / 2) * 0.3;
        if (d < bd) { bd = d; best = { x, y }; }
      }
      return { input: { ...botSeek(me, best, { jitter: 0.05 }), b: Math.random() < 0.02 } };
    }
    const others = this.bodies.filter(o => o.id !== pid && o.alive && !o.falling);
    let target = null, best = Infinity;
    for (const o of others) {
      const d = Math.hypot(o.x - me.x, o.y - me.y);
      if (d < best) { best = d; target = o; }
    }
    const inp = botSeek(me, target, { jitter: 0.2 });
    inp.a = best < 110 && Math.random() < 0.25;
    return { input: inp };
  }

  results() {
    const ids = Object.keys(this.scores).sort((a, b) => this.scores[b] - this.scores[a]);
    const groups = [];
    for (const id of ids) {
      const last = groups[groups.length - 1];
      if (last && this.scores[last[0]] === this.scores[id]) last.push(id);
      else groups.push([id]);
    }
    return {
      groups,
      detail: Object.fromEntries(ids.map(id => [id, `${this.scores[id]} pts · ${this.kos[id]} KO`])),
    };
  }
}
