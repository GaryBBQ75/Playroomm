import {
  makeBody, moveBodies, collideBodies, collideWalls, collidePillars, pressed,
  spawnCircle, bodySnap, sanitizeInput, botSeek, rand, W, H,
} from './arena.js';

const PILLARS = [
  { x: 300, y: 300, r: 55 }, { x: 700, y: 300, r: 55 },
  { x: 300, y: 700, r: 55 }, { x: 700, y: 700, r: 55 },
  { x: 500, y: 500, r: 70 },
];

export default {
  id: 'potato',
  name: 'Patate chaude',
  emoji: '💣',
  tagline: 'Refile la bombe avant le boum',
  duration: '1 à 2 min',
  family: 'Chaos',
  minPlayers: 2,
  maxPlayers: 8,
  controls: { type: 'stick', a: 'Sprint' },
  howto: ['Joystick pour courir', 'Touche quelqu\'un pour lui refiler la bombe 💣', 'Bouton ⚡ pour un sprint', 'Le dernier en vie gagne'],
  create(players) { return new Potato(players); },
};

class Potato {
  constructor(players) {
    this.players = players;
    const pos = spawnCircle(players.length, 380);
    this.bodies = players.map((p, i) => makeBody(p, pos[i][0], pos[i][1], 38));
    this.out = [];
    this.events = [];
    this.over = false;
    this.t = 0;
    this.endPause = 0;
    this.msg = 'Prêts ?';
    this.holder = null;
    this.fuse = 0;
    this.fuseMax = 1;
    this.passCd = 0;
  }

  body(id) { return this.bodies.find(b => b.id === id); }
  alive() { return this.bodies.filter(b => b.alive && !b.falling); }

  input(pid, inp) {
    const b = this.body(pid);
    if (b) b.inp = sanitizeInput(inp);
  }

  giveBomb() {
    const list = this.alive();
    if (list.length <= 1) return;
    this.holder = list[Math.floor(Math.random() * list.length)].id;
    // La mèche raccourcit quand il reste peu de joueurs.
    this.fuseMax = this.fuse = rand(7, 12) * (list.length > 3 ? 1 : 0.8);
    this.passCd = 1;
    this.msg = `${this.body(this.holder).name} a la bombe !`;
    this.msgT = 1.5;
  }

  tick(dt) {
    if (this.over) return;
    this.t += dt;
    if (this.endPause > 0) {
      this.endPause -= dt;
      if (this.endPause <= 0) this.over = true;
      return;
    }
    if (this.msgT !== undefined) { this.msgT -= dt; if (this.msgT <= 0) this.msg = ''; }
    if (this.t < 1.5) {
      for (const b of this.bodies) b.inp = { mx: 0, my: 0, a: false, b: false };
    } else if (!this.holder) this.giveBomb();

    for (const b of this.bodies) {
      if (!b.alive) continue;
      if (pressed(b, 'a') && b.cdA <= 0) {
        b.boost = 0.6; b.cdA = 2.2;
        this.events.push({ t: 'dash', id: b.id });
      }
      if (b.boost) b.boost = Math.max(0, b.boost - dt);
    }
    moveBodies(this.bodies, dt, {
      accel: 2600, maxSpeed: 300, friction: 5,
      speedMul: b => (b.id === this.holder ? 1.15 : 1) * (b.boost > 0 ? 1.7 : 1),
    });
    this.passCd = Math.max(0, this.passCd - dt);
    collideBodies(this.bodies, {
      bounce: 0.6,
      onHit: (a, b) => {
        if (this.passCd > 0) return;
        if (a.id === this.holder) this.pass(a, b);
        else if (b.id === this.holder) this.pass(b, a);
      },
    });
    collidePillars(this.bodies, PILLARS);
    collideWalls(this.bodies);

    if (this.holder) {
      this.fuse -= dt;
      if (this.fuse <= 0) this.explode();
    }
  }

  pass(from, to) {
    this.holder = to.id;
    this.passCd = 0.45;
    this.events.push({ t: 'pass', from: from.id, to: to.id });
  }

  explode() {
    const b = this.body(this.holder);
    b.alive = false;
    this.out.push(b.id);
    this.events.push({ t: 'boom', x: Math.round(b.x), y: Math.round(b.y), id: b.id });
    for (const o of this.alive()) {
      const dx = o.x - b.x, dy = o.y - b.y, d = Math.hypot(dx, dy) || 1;
      if (d < 260) {
        const f = (1 - d / 260) * 900;
        o.vx += dx / d * f; o.vy += dy / d * f;
        o.stun = 0.25;
      }
    }
    this.holder = null;
    const left = this.alive();
    if (left.length <= 1) {
      this.msg = left.length ? `${left[0].name} survit !` : 'Boum général !';
      this.msgT = 99;
      this.endPause = 2.5;
    } else {
      this.msg = `💥 ${b.name} a explosé !`;
      this.msgT = 1.4;
      this.giveBomb();
      this.msg = `💥 ${b.name} a explosé !`;
    }
  }

  snapshot() {
    const ev = this.events; this.events = [];
    return {
      bodies: this.bodies.map(bodySnap), holder: this.holder,
      fuse: +(this.fuse / this.fuseMax).toFixed(3), pillars: PILLARS, msg: this.msg,
      left: this.alive().length, ev,
    };
  }

  bot(pid) {
    const me = this.body(pid);
    if (!me || !me.alive) return { input: { mx: 0, my: 0 } };
    const others = this.alive().filter(o => o.id !== pid);
    if (me.id === this.holder) {
      let target = null, best = Infinity;
      for (const o of others) {
        const d = Math.hypot(o.x - me.x, o.y - me.y);
        if (d < best) { best = d; target = o; }
      }
      const inp = botSeek(me, target, { jitter: 0.2 });
      inp.a = best < 250 && Math.random() < 0.05;
      return { input: inp };
    }
    const h = this.body(this.holder);
    if (!h || !h.alive) return { input: botSeek(me, null) };
    const d = Math.hypot(h.x - me.x, h.y - me.y);
    if (d > 380) return { input: botSeek(me, { x: W / 2 + rand(-300, 300), y: H / 2 + rand(-300, 300) }, { jitter: 0.6 }) };
    const inp = botSeek(me, h, { flee: true, jitter: 0.5 });
    // Évite les murs en fuyant.
    if (me.x < 120) inp.mx += 1; if (me.x > W - 120) inp.mx -= 1;
    if (me.y < 120) inp.my += 1; if (me.y > H - 120) inp.my -= 1;
    inp.a = d < 160 && Math.random() < 0.06;
    return { input: inp };
  }

  results() {
    const left = this.bodies.filter(b => b.alive).map(b => b.id);
    const groups = [];
    if (left.length) groups.push(left);
    for (let i = this.out.length - 1; i >= 0; i--) groups.push([this.out[i]]);
    const detail = {};
    for (const id of left) detail[id] = 'Survivant 🏆';
    for (const id of this.out) detail[id] = `A sauté en ${this.out.indexOf(id) + 1}${this.out.indexOf(id) === 0 ? 'er' : 'e'}`;
    return { groups, detail };
  }
}
