import { shuffle, rand, clamp } from './arena.js';

// Terrain vertical : l'équipe 0 en bas, l'équipe 1 en haut.
export const FW = 600;
export const FH = 1000;
const RIVER = 500;
const BRIDGES = [140, 460];
const GAME_TIME = 150;
const OVERTIME = 60;

export const CARDS = {
  knight:  { name: 'Chevalier',  emoji: '🛡️', cost: 3, hp: 1150, dmg: 115, rate: 1.1, range: 20,  speed: 62,  r: 18, count: 1 },
  archers: { name: 'Archères',   emoji: '🏹', cost: 3, hp: 290,  dmg: 68,  rate: 1.0, range: 165, speed: 66,  r: 13, count: 2 },
  giant:   { name: 'Géant',      emoji: '🗿', cost: 5, hp: 3000, dmg: 175, rate: 1.5, range: 20,  speed: 44,  r: 27, count: 1, buildings: true },
  goblins: { name: 'Gobelins',   emoji: '👺', cost: 2, hp: 175,  dmg: 78,  rate: 0.9, range: 16,  speed: 118, r: 12, count: 3 },
  wizard:  { name: 'Sorcier',    emoji: '🧙', cost: 4, hp: 580,  dmg: 130, rate: 1.4, range: 150, speed: 60,  r: 16, count: 1, splash: 55 },
  fireball:{ name: 'Boule de feu', emoji: '☄️', cost: 4, spell: true, radius: 85, dmg: 400 },
};
const DECK = Object.keys(CARDS);

const TOWERS = {
  princess: { hp: 1500, dmg: 58, rate: 0.8, range: 205, r: 34 },
  king:     { hp: 2500, dmg: 72, rate: 1.0, range: 215, r: 44 },
};

export default {
  id: 'clash',
  name: 'Mini Clash',
  emoji: '🏰',
  tagline: 'Pose tes troupes, rase la tour d\'en face',
  duration: '3 min',
  family: 'Stratégie',
  minPlayers: 2,
  maxPlayers: 8,
  controls: { type: 'tap' },
  howto: ['Équipes tirées au sort', 'Touche une carte puis ta moitié de terrain pour la poser', 'L\'énergie ⚡ se recharge toute seule', 'Détruis la tour du roi 👑 ou plus de tours que l\'adversaire'],
  create(players) { return new Clash(players); },
};

let NEXT_ID = 1;

class Clash {
  constructor(players) {
    this.players = players;
    this.over = false;
    this.events = [];
    this.t = 0;
    this.ents = [];
    this.crowns = [0, 0];
    this.winner = null;
    this.msg = 'À l\'attaque !';
    const order = shuffle(players.map(p => p.id));
    this.team = {};
    order.forEach((id, i) => { this.team[id] = i % 2; });
    const sizes = [0, 0];
    for (const id of order) sizes[this.team[id]] += 1;
    const maxSize = Math.max(...sizes);
    this.me = {};
    for (const p of players) {
      const deck = shuffle([...DECK]);
      const tm = this.team[p.id];
      this.me[p.id] = {
        energy: 5, hand: deck.slice(0, 4), queue: deck.slice(4),
        regen: maxSize / sizes[tm], dmg: 0, botT: rand(1, 3),
      };
    }
    for (const team of [0, 1]) {
      this.addTower(team, 'princess', 140, 800);
      this.addTower(team, 'princess', 460, 800);
      this.addTower(team, 'king', 300, 925);
    }
  }

  // Convertit des coordonnées "vue équipe 0" vers le monde.
  toWorld(team, x, y) { return team === 0 ? [x, y] : [FW - x, FH - y]; }

  addTower(team, type, x, y) {
    const [wx, wy] = this.toWorld(team, x, y);
    const def = TOWERS[type];
    this.ents.push({
      id: NEXT_ID++, k: 'tower', type, team, x: wx, y: wy, hp: def.hp, max: def.hp, r: def.r,
      cd: 0, active: type !== 'king', lane: x < 300 ? 0 : x > 300 ? 1 : -1,
    });
  }

  ownSide(team, y) { return team === 0 ? y > RIVER + 30 : y < RIVER - 30; }

  input() {}

  action(pid, act) {
    if (this.over || !act || act.t !== 'play') return;
    const st = this.me[pid];
    if (!st) return;
    const i = act.i;
    if (!Number.isInteger(i) || i < 0 || i > 3) return;
    const x = Number(act.x), y = Number(act.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const key = st.hand[i];
    const card = CARDS[key];
    if (!card || st.energy < card.cost) return;
    const team = this.team[pid];
    const px = clamp(x, 15, FW - 15), py = clamp(y, 15, FH - 15);
    if (!card.spell && !this.ownSide(team, py)) return;
    st.energy -= card.cost;
    st.hand[i] = st.queue.shift();
    st.queue.push(key);
    if (card.spell) this.castFireball(pid, team, px, py, card);
    else this.spawn(pid, team, key, px, py);
    this.events.push({ t: 'play', team, card: key, x: Math.round(px), y: Math.round(py) });
  }

  spawn(pid, team, key, x, y) {
    const c = CARDS[key];
    for (let n = 0; n < c.count; n++) {
      const a = (n / c.count) * Math.PI * 2;
      const off = c.count > 1 ? 22 : 0;
      this.ents.push({
        id: NEXT_ID++, k: 'unit', type: key, team, owner: pid,
        x: clamp(x + Math.cos(a) * off, 10, FW - 10), y: clamp(y + Math.sin(a) * off, 10, FH - 10),
        hp: c.hp, max: c.hp, r: c.r, cd: 0.6, target: null, retarget: 0, deploy: 0.8, atk: 0,
      });
    }
  }

  castFireball(pid, team, x, y, card) {
    this.events.push({ t: 'fireball', x: Math.round(x), y: Math.round(y), r: card.radius });
    for (const e of this.ents) {
      if (e.team === team) continue;
      if (Math.hypot(e.x - x, e.y - y) > card.radius + e.r) continue;
      this.damage(pid, e, e.k === 'tower' ? card.dmg * 0.35 : card.dmg);
    }
  }

  damage(pid, e, amount) {
    e.hp -= amount;
    if (pid && this.me[pid]) this.me[pid].dmg += Math.min(amount, Math.max(0, e.hp + amount));
    if (e.k === 'tower' && e.type === 'king') e.active = true;
  }

  enemiesOf(u) { return this.ents.filter(e => e.team !== u.team && e.hp > 0); }

  pickTarget(u) {
    const c = CARDS[u.type];
    let best = null, bd = Infinity;
    for (const e of this.enemiesOf(u)) {
      if (c.buildings && e.k !== 'tower') continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      const sight = e.k === 'tower' ? 230 : 190;
      if (d < sight && d < bd) { bd = d; best = e; }
    }
    if (best) return best;
    // Sinon : tour adverse de la voie, puis le roi.
    const lane = u.x < FW / 2 ? 0 : 1;
    const enemyTowers = this.ents.filter(e => e.k === 'tower' && e.team !== u.team && e.hp > 0);
    const laneX = BRIDGES[lane];
    const princess = enemyTowers.find(e => e.type === 'princess' && Math.abs(e.x - laneX) < 10);
    return princess || enemyTowers.find(e => e.type === 'king') || null;
  }

  moveToward(u, tx, ty, dt) {
    const c = CARDS[u.type];
    let wx = tx, wy = ty;
    const crossing = (u.y - RIVER) * (ty - RIVER) < 0;
    if (crossing) {
      const bx = Math.abs(u.x - BRIDGES[0]) < Math.abs(u.x - BRIDGES[1]) ? BRIDGES[0] : BRIDGES[1];
      if (Math.abs(u.y - RIVER) > 28 && Math.abs(u.x - bx) > 6) { wx = bx; wy = RIVER; }
      else { wx = bx; wy = ty > RIVER ? RIVER + 60 : RIVER - 60; }
    }
    const dx = wx - u.x, dy = wy - u.y, d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, c.speed * dt);
    u.x += dx / d * step; u.y += dy / d * step;
  }

  tick(dt) {
    if (this.over) return;
    this.t += dt;
    if (this.t > 1.5 && this.msg === 'À l\'attaque !') this.msg = '';
    const double = this.t > GAME_TIME - 60;
    if (double && !this.doubleAnnounced) { this.doubleAnnounced = true; this.msg = 'Énergie x2 !'; this.msgT = this.t + 2; }
    if (this.msgT && this.t > this.msgT) { this.msg = ''; this.msgT = 0; }
    for (const st of Object.values(this.me)) {
      st.energy = Math.min(10, st.energy + dt / 2.8 * st.regen * (double ? 2 : 1));
    }

    // Unités
    for (const u of this.ents) {
      if (u.k !== 'unit' || u.hp <= 0) continue;
      const c = CARDS[u.type];
      if (u.deploy > 0) { u.deploy -= dt; continue; }
      u.retarget -= dt;
      if (!u.target || u.target.hp <= 0 || u.retarget <= 0) {
        u.target = this.pickTarget(u);
        u.retarget = 0.4;
      }
      const tg = u.target;
      u.atk = Math.max(0, u.atk - dt);
      if (!tg) continue;
      const d = Math.hypot(tg.x - u.x, tg.y - u.y) - tg.r - u.r;
      if (d <= c.range) {
        u.cd -= dt;
        if (u.cd <= 0) {
          u.cd = c.rate;
          u.atk = 0.2;
          this.hit(u, tg, c);
        }
      } else {
        u.cd = Math.min(u.cd, 0.3);
        this.moveToward(u, tg.x, tg.y, dt);
      }
    }

    // Tours
    for (const tw of this.ents) {
      if (tw.k !== 'tower' || tw.hp <= 0 || !tw.active) continue;
      const def = TOWERS[tw.type];
      tw.cd -= dt;
      if (tw.cd > 0) continue;
      let best = null, bd = Infinity;
      for (const e of this.ents) {
        if (e.k !== 'unit' || e.team === tw.team || e.hp <= 0) continue;
        const d = Math.hypot(e.x - tw.x, e.y - tw.y);
        if (d < def.range && d < bd) { bd = d; best = e; }
      }
      if (best) {
        tw.cd = def.rate;
        best.hp -= def.dmg;
        this.events.push({ t: 'shot', k: 'tower', x1: Math.round(tw.x), y1: Math.round(tw.y), x2: Math.round(best.x), y2: Math.round(best.y), team: tw.team });
      }
    }

    // Séparation douce entre unités
    const units = this.ents.filter(e => e.k === 'unit' && e.hp > 0);
    for (let i = 0; i < units.length; i++) {
      for (let j = i + 1; j < units.length; j++) {
        const a = units[i], b = units[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.01, min = a.r + b.r;
        if (d < min) {
          const push = (min - d) / 2, nx = dx / d, ny = dy / d;
          const wa = a.type === 'giant' ? 0.3 : 1, wb = b.type === 'giant' ? 0.3 : 1;
          a.x -= nx * push * wa; a.y -= ny * push * wa;
          b.x += nx * push * wb; b.y += ny * push * wb;
        }
      }
    }
    for (const u of units) { u.x = clamp(u.x, 8, FW - 8); u.y = clamp(u.y, 8, FH - 8); }

    // Morts et tours détruites
    for (const e of this.ents) {
      if (e.hp > 0 || e.dead) continue;
      e.dead = true;
      this.events.push({ t: 'die', k: e.k, x: Math.round(e.x), y: Math.round(e.y), team: e.team, type: e.type });
      if (e.k === 'tower') {
        const other = 1 - e.team;
        this.crowns[other] += e.type === 'king' ? 3 : 1;
        if (e.type === 'king') this.finish(other);
        else {
          const king = this.ents.find(k => k.k === 'tower' && k.type === 'king' && k.team === e.team);
          if (king) king.active = true;
        }
      }
    }
    this.ents = this.ents.filter(e => e.hp > 0);
    if (this.over) return;

    if (this.t >= GAME_TIME && this.crowns[0] !== this.crowns[1]) this.finish(this.crowns[0] > this.crowns[1] ? 0 : 1);
    else if (this.t >= GAME_TIME && !this.overtime) { this.overtime = true; this.msg = 'Prolongation ! Première tour gagne'; this.msgT = this.t + 2.5; }
    else if (this.t >= GAME_TIME + OVERTIME) this.finish(this.crowns[0] === this.crowns[1] ? -1 : this.crowns[0] > this.crowns[1] ? 0 : 1);
  }

  hit(u, tg, c) {
    if (c.range > 40) {
      this.events.push({ t: 'shot', k: u.type, x1: Math.round(u.x), y1: Math.round(u.y), x2: Math.round(tg.x), y2: Math.round(tg.y), team: u.team });
    } else {
      this.events.push({ t: 'melee', x: Math.round((u.x + tg.x) / 2), y: Math.round((u.y + tg.y) / 2) });
    }
    if (c.splash) {
      for (const e of this.enemiesOf(u)) {
        if (Math.hypot(e.x - tg.x, e.y - tg.y) <= c.splash + e.r) this.damage(u.owner, e, c.dmg);
      }
    } else this.damage(u.owner, tg, c.dmg);
  }

  finish(team) {
    this.winner = team;
    this.over = true;
    this.overT = 0;
  }

  snapshot() {
    const ev = this.events; this.events = [];
    const left = this.overtime ? GAME_TIME + OVERTIME - this.t : GAME_TIME - this.t;
    return {
      t: Math.max(0, Math.ceil(left)), overtime: !!this.overtime, double: this.t > GAME_TIME - 60,
      crowns: this.crowns, msg: this.msg, team: this.team,
      ents: this.ents.map(e => ({
        id: e.id, k: e.k, type: e.type, team: e.team, x: Math.round(e.x), y: Math.round(e.y),
        hp: Math.round(e.hp), max: e.max, r: e.r, atk: e.atk > 0 ? 1 : 0, dep: e.deploy > 0 ? 1 : 0,
        active: e.k === 'tower' ? e.active : undefined,
      })),
      ev,
    };
  }

  privateSnap(pid) {
    const st = this.me[pid];
    if (!st) return null;
    return { team: this.team[pid], energy: +st.energy.toFixed(2), hand: st.hand, next: st.queue[0] };
  }

  bot(pid, dt) {
    const st = this.me[pid];
    if (!st) return null;
    st.botT -= dt;
    if (st.botT > 0) return null;
    st.botT = rand(1.2, 3);
    const team = this.team[pid];
    const affordable = st.hand.map((k, i) => [k, i]).filter(([k]) => CARDS[k].cost <= st.energy);
    if (!affordable.length) return null;
    // Défense : ennemis sur notre moitié ?
    const threats = this.ents.filter(e => e.k === 'unit' && e.team !== team && this.ownSide(team, e.y));
    if (threats.length && Math.random() < 0.8) {
      const tg = threats[0];
      const spell = affordable.find(([k]) => CARDS[k].spell);
      if (spell && threats.filter(t => Math.hypot(t.x - tg.x, t.y - tg.y) < 80).length >= 2) {
        return { action: { t: 'play', i: spell[1], x: tg.x, y: tg.y } };
      }
      const unit = affordable.find(([k]) => !CARDS[k].spell && !CARDS[k].buildings);
      if (unit) {
        const [, y] = this.toWorld(team, 0, 700);
        const yy = team === 0 ? Math.max(tg.y + 60, 560) : Math.min(tg.y - 60, 440);
        return { action: { t: 'play', i: unit[1], x: tg.x, y: Number.isFinite(yy) ? yy : y } };
      }
    }
    if (st.energy < 7 && Math.random() < 0.6) return null; // on économise
    const choices = affordable.filter(([k]) => !CARDS[k].spell);
    if (!choices.length) return null;
    const [, i] = choices[Math.floor(Math.random() * choices.length)];
    const lane = Math.random() < 0.5 ? 0 : 1;
    const [x, y] = this.toWorld(team, BRIDGES[lane] + rand(-30, 30), rand(640, 760));
    return { action: { t: 'play', i, x, y } };
  }

  results() {
    const t0 = this.players.filter(p => this.team[p.id] === 0).map(p => p.id);
    const t1 = this.players.filter(p => this.team[p.id] === 1).map(p => p.id);
    const detail = {};
    for (const p of this.players) detail[p.id] = `${this.team[p.id] === 0 ? '🔵' : '🔴'} ${Math.round(this.me[p.id].dmg)} dégâts`;
    const points = {};
    let groups;
    if (this.winner === -1 || this.winner === null) {
      groups = [[...t0, ...t1]];
      for (const id of [...t0, ...t1]) points[id] = 1;
    } else {
      const win = this.winner === 0 ? t0 : t1;
      const lose = this.winner === 0 ? t1 : t0;
      groups = [win, lose];
      for (const id of win) points[id] = 3;
      for (const id of lose) points[id] = 0;
    }
    const title = this.winner === -1 ? 'Match nul !' : `Victoire ${this.winner === 0 ? 'des Bleus 🔵' : 'des Rouges 🔴'} ${this.crowns[0]} - ${this.crowns[1]}`;
    return { groups, detail, points, title };
  }
}
