import {
  makeBody, moveBodies, collideBodies, pressed, spawnCircle, bodySnap,
  sanitizeInput, botSeek, W, H,
} from './arena.js';

const ROUNDS = 3;
const START_R = 440;
const END_R = 120;
const SHRINK_DELAY = 6;
const SHRINK_TIME = 30;
const ROUND_MAX = 60;

export default {
  id: 'sumo',
  name: 'Sumo tamponneuses',
  emoji: '🚗',
  tagline: 'Éjecte tout le monde de la piste',
  duration: '2 min',
  family: 'Chaos',
  minPlayers: 2,
  maxPlayers: 8,
  controls: { type: 'stick', a: 'Foncer' },
  howto: ['Joystick pour rouler', 'Bouton ⚡ pour foncer dans le tas', 'La piste rétrécit, reste dedans !', '3 manches'],
  create(players) { return new Sumo(players); },
};

class Sumo {
  constructor(players) {
    this.players = players;
    this.round = 0;
    this.scores = Object.fromEntries(players.map(p => [p.id, 0]));
    this.over = false;
    this.events = [];
    this.startRound();
  }

  startRound() {
    this.round += 1;
    this.t = 0;
    this.arenaR = START_R;
    this.phase = 'play';
    this.pause = 0;
    this.out = [];
    const pos = spawnCircle(this.players.length, 260);
    this.bodies = this.players.map((p, i) => makeBody(p, pos[i][0], pos[i][1], 42));
    for (const b of this.bodies) {
      const dx = W / 2 - b.x, dy = H / 2 - b.y, l = Math.hypot(dx, dy);
      b.fx = dx / l; b.fy = dy / l;
    }
    this.msg = `Manche ${this.round} / ${ROUNDS}`;
  }

  body(id) { return this.bodies.find(b => b.id === id); }

  input(pid, inp) {
    const b = this.body(pid);
    if (b) b.inp = sanitizeInput(inp);
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
    if (this.t > 1.2) this.msg = '';
    const k = Math.min(1, Math.max(0, (this.t - SHRINK_DELAY) / SHRINK_TIME));
    this.arenaR = START_R - (START_R - END_R) * k;

    for (const b of this.bodies) {
      if (!b.alive || b.falling) continue;
      if (this.t < 1.2) { b.inp = { ...b.inp, mx: 0, my: 0 }; }
      if (pressed(b, 'a') && b.cdA <= 0 && this.t >= 1.2) {
        b.vx += b.fx * 820; b.vy += b.fy * 820;
        b.cdA = 1.6;
        this.events.push({ t: 'dash', id: b.id });
      }
    }
    moveBodies(this.bodies, dt, { accel: 1700, maxSpeed: 330, friction: 2.4 });
    collideBodies(this.bodies, {
      bounce: 1.25,
      onHit: (a, b, force) => {
        if (force > 260) this.events.push({ t: 'bump', x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), f: Math.min(1, force / 900) });
        a.lastHit = b.id; b.lastHit = a.id;
      },
    });

    for (const b of this.bodies) {
      if (!b.alive) continue;
      if (b.falling) {
        b.falling += dt;
        b.x += b.vx * dt * 0.5; b.y += b.vy * dt * 0.5;
        if (b.falling > 0.8) { b.alive = false; }
        continue;
      }
      const d = Math.hypot(b.x - W / 2, b.y - H / 2);
      if (d > this.arenaR + b.r * 0.2) {
        b.falling = 0.001;
        this.out.push(b.id);
        this.events.push({ t: 'fall', id: b.id, x: Math.round(b.x), y: Math.round(b.y) });
      }
    }

    const standing = this.bodies.filter(b => b.alive && !b.falling);
    if (standing.length <= 1 || this.t > ROUND_MAX) this.endRound(standing);
  }

  endRound(standing) {
    // Points de manche : nombre de joueurs éliminés avant toi.
    this.out.forEach((id, i) => { this.scores[id] += i; });
    const n = this.out.length;
    for (const b of standing) this.scores[b.id] += n + 1;
    const winner = standing.length === 1 ? standing[0] : null;
    this.msg = winner ? `${winner.name} gagne la manche !` : 'Égalité !';
    this.phase = 'pause';
    this.pause = 2.8;
  }

  snapshot() {
    const ev = this.events; this.events = [];
    return {
      arenaR: Math.round(this.arenaR), round: this.round, rounds: ROUNDS, msg: this.msg,
      timer: Math.max(0, Math.ceil(ROUND_MAX - this.t)),
      bodies: this.bodies.map(bodySnap), scores: this.scores, ev,
    };
  }

  bot(pid) {
    const me = this.body(pid);
    if (!me || !me.alive || me.falling) return { input: { mx: 0, my: 0, a: false } };
    const cx = W / 2 - me.x, cy = H / 2 - me.y;
    const dCenter = Math.hypot(cx, cy);
    // Trop près du bord : on revient au centre.
    if (dCenter > this.arenaR * 0.7) {
      return { input: { mx: cx / dCenter, my: cy / dCenter, a: dCenter > this.arenaR * 0.85 && Math.random() < 0.02 } };
    }
    const others = this.bodies.filter(b => b.id !== pid && b.alive && !b.falling);
    let target = null, best = Infinity;
    for (const o of others) {
      const d = Math.hypot(o.x - me.x, o.y - me.y);
      if (d < best) { best = d; target = o; }
    }
    const inp = botSeek(me, target, { jitter: 0.25 });
    inp.a = best < 160 && Math.random() < 0.08;
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
    return { groups, detail: Object.fromEntries(ids.map(id => [id, `${this.scores[id]} pts`])) };
  }
}
