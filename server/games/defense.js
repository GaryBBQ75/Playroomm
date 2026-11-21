import { rand } from './arena.js';

export const COLS = 9;
export const ROWS = 14;
const WAVES = 12;
const BASE_HP = 20;

// Chemin des monstres, en coordonnées de cases.
const WAYPOINTS = [[1, -1], [1, 3], [7, 3], [7, 6], [1, 6], [1, 9], [7, 9], [7, 12], [4, 12], [4, 14.5]];

export const TOWERS = {
  arrow:  { name: 'Archer', emoji: '🏹', cost: 50, range: 2.4, dmg: 20, rate: 0.5 },
  cannon: { name: 'Canon',  emoji: '💣', cost: 80, range: 2.1, dmg: 44, rate: 1.3, splash: 0.9 },
  frost:  { name: 'Glace',  emoji: '❄️', cost: 60, range: 2.0, dmg: 8,  rate: 0.9, splash: 0.7, slow: 1.6 },
};

const ENEMIES = {
  slime:  { hp: 55,   speed: 1.25, bounty: 4,  leak: 1, r: 0.28 },
  runner: { hp: 38,   speed: 2.3,  bounty: 5,  leak: 1, r: 0.22 },
  tank:   { hp: 240,  speed: 0.8,  bounty: 10, leak: 2, r: 0.38 },
  boss:   { hp: 1400, speed: 0.6,  bounty: 60, leak: 6, r: 0.48 },
};

function buildPath() {
  const segs = [];
  let total = 0;
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const [x1, y1] = WAYPOINTS[i], [x2, y2] = WAYPOINTS[i + 1];
    const l = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, x2, y2, l, start: total });
    total += l;
  }
  const cells = new Set();
  for (const s of segs) {
    const steps = Math.ceil(s.l * 2);
    for (let k = 0; k <= steps; k++) {
      const x = Math.round(s.x1 + (s.x2 - s.x1) * k / steps);
      const y = Math.round(s.y1 + (s.y2 - s.y1) * k / steps);
      if (y >= 0 && y < ROWS) cells.add(`${x},${y}`);
    }
  }
  return { segs, total, cells };
}
const PATH = buildPath();

export function pathCells() { return [...PATH.cells].map(s => s.split(',').map(Number)); }

function posAt(dist) {
  for (const s of PATH.segs) {
    if (dist <= s.start + s.l) {
      const k = (dist - s.start) / s.l;
      return [s.x1 + (s.x2 - s.x1) * k, s.y1 + (s.y2 - s.y1) * k];
    }
  }
  const last = PATH.segs[PATH.segs.length - 1];
  return [last.x2, last.y2];
}

function waveList(w) {
  const list = [];
  if (w % 6 === 0) {
    list.push('boss');
    for (let i = 0; i < 4 + w / 2; i++) list.push('slime');
    return list;
  }
  for (let i = 0; i < 6 + w; i++) list.push('slime');
  if (w >= 2) for (let i = 0; i < w; i++) list.push('runner');
  if (w >= 4) for (let i = 0; i < Math.floor(w / 2); i++) list.push('tank');
  // Mélange léger pour varier l'ordre d'arrivée
  return list.sort(() => Math.random() - 0.5);
}

export default {
  id: 'defense',
  name: 'Défense coop',
  emoji: '🛡️',
  tagline: 'Tenez la base ensemble, 12 vagues',
  duration: '8 à 10 min',
  family: 'Défense',
  minPlayers: 1,
  maxPlayers: 8,
  controls: { type: 'tap' },
  howto: ['Tous dans la même équipe', 'Touche une case libre pour construire une tour', 'Touche ta tour pour l\'améliorer', 'Chaque monstre tué rapporte de l\'or à tout le monde', 'Survivez aux 12 vagues !'],
  create(players) { return new Defense(players); },
};

let NEXT = 1;

class Defense {
  constructor(players) {
    this.players = players;
    this.n = players.length;
    // L'or est partagé : plus on est nombreux, moins chacun en reçoit.
    this.share = 2 / (this.n + 1);
    this.over = false;
    this.events = [];
    this.t = 0;
    this.wave = 0;
    this.baseHp = BASE_HP;
    this.enemies = [];
    this.towers = [];
    this.queue = [];
    this.spawnT = 0;
    this.breakT = 6;
    this.won = false;
    this.msg = 'Construisez vos tours !';
    this.msgT = 3;
    this.me = Object.fromEntries(players.map(p => [p.id, { gold: 100, dmg: 0, kills: 0, botT: rand(0.5, 2) }]));
    this.colors = Object.fromEntries(players.map(p => [p.id, p.color]));
  }

  input() {}

  cellFree(c, r) {
    if (!Number.isInteger(c) || !Number.isInteger(r)) return false;
    if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
    if (PATH.cells.has(`${c},${r}`)) return false;
    return !this.towers.some(t => t.c === c && t.r === r);
  }

  upgradeCost(t) { return Math.round(TOWERS[t.kind].cost * 0.8 * t.lvl); }

  action(pid, act) {
    if (this.over || !act) return;
    const st = this.me[pid];
    if (!st) return;
    if (act.t === 'build') {
      const def = TOWERS[act.kind];
      if (!def || st.gold < def.cost || !this.cellFree(act.c, act.r)) return;
      st.gold -= def.cost;
      this.towers.push({ id: NEXT++, kind: act.kind, c: act.c, r: act.r, owner: pid, lvl: 1, cd: 0, aim: 0 });
      this.events.push({ t: 'build', c: act.c, r: act.r });
    } else if (act.t === 'up') {
      const tw = this.towers.find(t => t.c === act.c && t.r === act.r);
      if (!tw || tw.owner !== pid || tw.lvl >= 3) return;
      const cost = this.upgradeCost(tw);
      if (st.gold < cost) return;
      st.gold -= cost;
      tw.lvl += 1;
      this.events.push({ t: 'up', c: tw.c, r: tw.r });
    }
  }

  stats(tw) {
    const d = TOWERS[tw.kind];
    const k = tw.lvl - 1;
    return { range: d.range + 0.3 * k, dmg: d.dmg * Math.pow(1.6, k), rate: d.rate * Math.pow(0.9, k), splash: d.splash, slow: d.slow };
  }

  tick(dt) {
    if (this.over) return;
    this.t += dt;
    if (this.endT !== undefined) {
      this.endT -= dt;
      if (this.endT <= 0) this.over = true;
      return;
    }

    // Vagues
    if (!this.queue.length && !this.enemies.length) {
      if (this.wave >= WAVES) { this.end(true); return; }
      this.breakT -= dt;
      if (this.breakT <= 0) {
        this.wave += 1;
        this.queue = waveList(this.wave);
        this.spawnT = 0;
        this.msg = this.wave % 6 === 0 ? `Vague ${this.wave} : BOSS !` : `Vague ${this.wave}`;
        this.msgT = this.t + 2;
        if (this.wave > 1) for (const st of Object.values(this.me)) st.gold += (20 + this.wave * 3) * this.share;
      }
    }
    if (this.msgT && this.t > this.msgT) { this.msg = ''; this.msgT = 0; }
    if (this.queue.length) {
      this.spawnT -= dt;
      if (this.spawnT <= 0) {
        const type = this.queue.shift();
        const e = ENEMIES[type];
        const hpMul = Math.pow(1.27, this.wave - 1) * (0.75 + 0.25 * this.n);
        this.enemies.push({ id: NEXT++, type, hp: e.hp * hpMul, max: e.hp * hpMul, dist: 0, slow: 0 });
        this.spawnT = type === 'runner' ? 0.45 : type === 'boss' ? 2 : 0.75;
        if (!this.queue.length) this.breakT = 7;
      }
    }

    // Déplacement des monstres
    for (const e of this.enemies) {
      const def = ENEMIES[e.type];
      const sp = def.speed * (e.slow > 0 ? 0.5 : 1);
      e.slow = Math.max(0, e.slow - dt);
      e.dist += sp * dt;
      if (e.dist >= PATH.total) {
        e.hp = 0; e.leaked = true;
        this.baseHp -= def.leak;
        this.events.push({ t: 'leak', n: def.leak });
      }
    }

    // Tirs des tours
    for (const tw of this.towers) {
      tw.cd -= dt;
      if (tw.cd > 0) continue;
      const s = this.stats(tw);
      const cx = tw.c, cy = tw.r;
      let best = null;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        const [x, y] = posAt(e.dist);
        if (Math.hypot(x - cx, y - cy) > s.range) continue;
        if (!best || e.dist > best.dist) best = e;
      }
      if (!best) continue;
      tw.cd = s.rate;
      const [bx, by] = posAt(best.dist);
      tw.aim = Math.atan2(by - cy, bx - cx);
      this.events.push({ t: 'shot', kind: tw.kind, x1: cx, y1: cy, x2: +bx.toFixed(2), y2: +by.toFixed(2) });
      const hitList = s.splash
        ? this.enemies.filter(e => e.hp > 0 && Math.hypot(...posAt(e.dist).map((v, i) => v - [bx, by][i])) <= s.splash)
        : [best];
      for (const e of hitList) {
        const real = Math.min(e.hp, s.dmg);
        e.hp -= s.dmg;
        this.me[tw.owner].dmg += real;
        if (s.slow) e.slow = s.slow;
        if (e.hp <= 0 && !e.counted) {
          e.counted = true;
          this.me[tw.owner].kills += 1;
          const bounty = ENEMIES[e.type].bounty;
          const share = bounty * this.share;
          for (const st of Object.values(this.me)) st.gold += share;
          const [x, y] = posAt(e.dist);
          this.events.push({ t: 'kill', x: +x.toFixed(2), y: +y.toFixed(2), g: bounty });
        }
      }
    }
    this.enemies = this.enemies.filter(e => e.hp > 0);
    if (this.baseHp <= 0) { this.baseHp = 0; this.end(false); }
  }

  end(won) {
    this.won = won;
    this.msg = won ? 'Base sauvée ! 🎉' : 'La base est tombée…';
    this.msgT = 0;
    this.endT = 3;
  }

  snapshot() {
    const ev = this.events; this.events = [];
    return {
      wave: this.wave, waves: WAVES, baseHp: this.baseHp, baseMax: BASE_HP, msg: this.msg,
      next: !this.queue.length && !this.enemies.length && this.wave < WAVES ? Math.max(0, Math.ceil(this.breakT)) : null,
      enemies: this.enemies.map(e => {
        const [x, y] = posAt(e.dist);
        return { id: e.id, type: e.type, x: +x.toFixed(2), y: +y.toFixed(2), hp: +(e.hp / e.max).toFixed(2), slow: e.slow > 0 ? 1 : 0 };
      }),
      towers: this.towers.map(t => ({ id: t.id, kind: t.kind, c: t.c, r: t.r, lvl: t.lvl, owner: t.owner, aim: +t.aim.toFixed(2), up: t.lvl < 3 ? this.upgradeCost(t) : null })),
      colors: this.colors,
      team: Object.fromEntries(Object.entries(this.me).map(([id, s]) => [id, { gold: Math.floor(s.gold), kills: s.kills }])),
      ev,
    };
  }

  privateSnap(pid) {
    const st = this.me[pid];
    return st ? { gold: Math.floor(st.gold) } : null;
  }

  bot(pid, dt) {
    const st = this.me[pid];
    if (!st) return null;
    st.botT -= dt;
    if (st.botT > 0) return null;
    st.botT = rand(1, 2.5);
    // Améliorer une de ses tours de temps en temps
    const mine = this.towers.filter(t => t.owner === pid && t.lvl < 3);
    if (mine.length && Math.random() < 0.35) {
      const t = mine[Math.floor(Math.random() * mine.length)];
      if (st.gold >= this.upgradeCost(t)) return { action: { t: 'up', c: t.c, r: t.r } };
    }
    const kinds = Object.keys(TOWERS).filter(k => TOWERS[k].cost <= st.gold);
    if (!kinds.length) return null;
    const kind = Math.random() < 0.5 ? (kinds.includes('arrow') ? 'arrow' : kinds[0]) : kinds[Math.floor(Math.random() * kinds.length)];
    // Case libre adjacente au chemin
    const spots = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!this.cellFree(c, r)) continue;
      let near = 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (PATH.cells.has(`${c + dc},${r + dr}`)) near++;
      if (near) spots.push([c, r, near]);
    }
    if (!spots.length) return null;
    spots.sort((a, b) => b[2] - a[2]);
    const pick = spots[Math.floor(Math.random() * Math.min(6, spots.length))];
    return { action: { t: 'build', kind, c: pick[0], r: pick[1] } };
  }

  results() {
    const ids = this.players.map(p => p.id).sort((a, b) => this.me[b].dmg - this.me[a].dmg);
    const points = {};
    for (const id of ids) points[id] = this.won ? 2 : 0;
    if (ids.length) points[ids[0]] += 1;
    const detail = Object.fromEntries(ids.map((id, i) => [id, `${i === 0 ? 'MVP · ' : ''}${Math.round(this.me[id].dmg)} dégâts · ${this.me[id].kills} kills`]));
    return {
      groups: ids.map(id => [id]),
      detail, points,
      title: this.won ? 'Base sauvée, bravo l\'équipe ! 🎉' : `Tombés à la vague ${this.wave} / ${WAVES}`,
    };
  }
}
