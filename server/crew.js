// Un "crew" = l'espace permanent d'une bande de potes.
// Gère les joueurs connectés, le vote du prochain jeu, la boucle de jeu et la saison.
import { GAMES, GAME_LIST } from './games/index.js';
import { pointsFromRanking, shuffle } from './games/arena.js';

const COLORS = ['#ff4d6d', '#3a86ff', '#ffbe0b', '#06d6a0', '#b14dff', '#ff8c42', '#00c2d1', '#ff5fd2'];
const BOT_NAMES = ['Robotine', 'Boulon', 'Gizmo', 'Turbo', 'Pixel', 'Clank', 'Bipbip', 'Rouille'];
const TICK = 1 / 60;
const SNAP_EVERY = 3; // 20 images par seconde envoyées au client
const VOTE_TIME = 15;
const SPIN_TIME = 3.2;
const INTRO_TIME = 6;
const RESULTS_TIME = 10;
const MAX_PLAYERS = 8;

export class Crew {
  constructor(rec, store) {
    this.rec = rec;
    this.store = store;
    this.code = rec.code;
    this.players = new Map();
    this.hostId = null;
    this.phase = 'lobby';
    this.phaseEnd = 0;
    this.vote = null;
    this.spin = null;
    this.gameId = null;
    this.game = null;
    this.participants = [];
    this.results = null;
    this.lastGame = null;
    this.loop = null;
    this.timer = null;
    this.tickN = 0;
    this.emptySince = Date.now();
  }

  // ---------- Joueurs ----------
  online() { return [...this.players.values()].filter(p => p.online); }
  humans() { return this.online().filter(p => !p.bot); }

  pickColor() {
    const used = new Set(this.online().map(p => p.color));
    return COLORS.find(c => !used.has(c)) || COLORS[Math.floor(Math.random() * COLORS.length)];
  }

  join(pid, name, send) {
    let p = this.players.get(pid);
    if (!p) {
      if (this.online().length >= MAX_PLAYERS) return { error: 'Le crew est complet (8 joueurs max).' };
      p = { id: pid, name, color: this.pickColor(), bot: false, input: {} };
      this.players.set(pid, p);
    }
    if (!p.online) {
      // Si la couleur est prise entre-temps, on en change.
      if (this.online().some(o => o.color === p.color && o.id !== pid)) p.color = this.pickColor();
    }
    p.name = name;
    p.online = true;
    p.send = send;
    if (!this.hostId || !this.players.get(this.hostId)?.online || this.players.get(this.hostId)?.bot) this.hostId = pid;
    this.emptySince = 0;
    this.broadcastState();
    return { ok: true };
  }

  leave(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    p.online = false;
    p.media = false;
    p.send = null;
    p.input = {};
    if (this.game && this.participants.includes(pid)) this.game.input?.(pid, {});
    if (this.hostId === pid) this.hostId = this.humans()[0]?.id || null;
    if (!this.humans().length) {
      this.emptySince = Date.now();
      this.toLobby();
      // Sans humain, les bots s'en vont aussi.
      for (const b of this.online().filter(o => o.bot)) this.players.delete(b.id);
    }
    this.broadcastState();
  }

  addBot() {
    if (this.online().length >= MAX_PLAYERS) return;
    const used = new Set(this.online().map(p => p.name));
    const name = BOT_NAMES.find(n => !used.has(n)) || `Bot ${this.online().length}`;
    const id = 'bot_' + Math.random().toString(36).slice(2, 9);
    this.players.set(id, { id, name, color: this.pickColor(), bot: true, online: true, input: {} });
    this.broadcastState();
  }

  removeBot() {
    const bots = this.online().filter(p => p.bot);
    const last = bots[bots.length - 1];
    if (last) { this.players.delete(last.id); this.broadcastState(); }
  }

  // ---------- Messages ----------
  handle(pid, msg) {
    const p = this.players.get(pid);
    if (!p || !p.online || !msg || typeof msg !== 'object') return;
    const isHost = pid === this.hostId;
    switch (msg.type) {
      case 'start':
        if (isHost && (this.phase === 'lobby' || this.phase === 'results')) this.startVote();
        break;
      case 'vote':
        if (this.phase === 'vote' && this.vote.options.includes(msg.game)) {
          this.vote.votes[pid] = msg.game;
          const humans = this.humans();
          if (humans.every(h => this.vote.votes[h.id])) this.resolveVote();
          else this.broadcastState();
        }
        break;
      case 'skip':
        if (isHost && this.phase === 'vote') this.resolveVote();
        else if (isHost && this.phase === 'results') this.startVote();
        break;
      case 'addBot':
        if (isHost && this.phase === 'lobby') this.addBot();
        break;
      case 'removeBot':
        if (isHost && this.phase === 'lobby') this.removeBot();
        break;
      case 'lobby':
        if (isHost) { this.toLobby(); this.broadcastState(); }
        break;
      case 'input':
        if (this.phase === 'playing' && this.participants.includes(pid)) this.game.input?.(pid, msg.v);
        break;
      case 'act':
        if (this.phase === 'playing' && this.participants.includes(pid)) this.game.action?.(pid, msg.v);
        break;
      case 'media':
        if (!p.bot && p.media !== !!msg.on) { p.media = !!msg.on; this.broadcastState(); }
        break;
      case 'signal': {
        // Relais WebRTC entre deux joueurs humains du crew.
        const target = this.players.get(msg.target);
        if (target && target.online && !target.bot && target.id !== pid && msg.data && typeof msg.data === 'object') {
          target.send?.(JSON.stringify({ type: 'signal', from: pid, data: msg.data }));
        }
        break;
      }
      case 'emote': {
        const e = String(msg.e || '').slice(0, 4);
        if (['😂', '🔥', '😱', '👏', '😈', '💀'].includes(e)) {
          const now = Date.now();
          if (p.lastEmote && now - p.lastEmote < 600) return;
          p.lastEmote = now;
          this.broadcast({ type: 'emote', id: pid, e });
        }
        break;
      }
      default:
    }
  }

  // ---------- Phases ----------
  clearTimers() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.loop) { clearInterval(this.loop); this.loop = null; }
  }

  setPhase(phase, seconds, next) {
    this.clearTimers();
    this.phase = phase;
    this.phaseEnd = seconds ? Date.now() + seconds * 1000 : 0;
    if (seconds && next) this.timer = setTimeout(next, seconds * 1000);
  }

  toLobby() {
    this.clearTimers();
    this.phase = 'lobby';
    this.phaseEnd = 0;
    this.game = null;
    this.gameId = null;
    this.vote = null;
    this.spin = null;
  }

  eligibleGames() {
    const n = this.online().length;
    return GAME_LIST.filter(g => n >= g.minPlayers && n <= g.maxPlayers).map(g => g.id);
  }

  startVote() {
    const eligible = this.eligibleGames();
    if (!eligible.length) return;
    const others = shuffle(eligible.filter(id => id !== this.lastGame));
    const options = others.slice(0, 3);
    if (this.lastGame && eligible.includes(this.lastGame)) options.push(this.lastGame);
    this.vote = { options, votes: {}, replay: this.lastGame && eligible.includes(this.lastGame) ? this.lastGame : null };
    this.results = null;
    this.setPhase('vote', VOTE_TIME, () => this.resolveVote());
    this.broadcastState();
  }

  resolveVote() {
    if (this.phase !== 'vote') return;
    const counts = {};
    for (const g of Object.values(this.vote.votes)) counts[g] = (counts[g] || 0) + 1;
    const max = Math.max(0, ...Object.values(counts));
    let tied = max > 0 ? Object.keys(counts).filter(g => counts[g] === max) : [...this.vote.options];
    tied = tied.filter(g => this.eligibleGames().includes(g));
    if (!tied.length) { this.toLobby(); this.broadcastState(); return; }
    const chosen = tied[Math.floor(Math.random() * tied.length)];
    if (tied.length > 1) {
      // Égalité : la roue tranche.
      this.spin = { options: tied, chosen };
      this.setPhase('spin', SPIN_TIME, () => this.startIntro(chosen));
      this.broadcastState();
    } else {
      this.startIntro(chosen);
    }
  }

  startIntro(gameId) {
    const players = this.online();
    const def = GAMES[gameId];
    if (players.length < def.minPlayers) { this.toLobby(); this.broadcastState(); return; }
    this.gameId = gameId;
    this.spin = null;
    this.participants = players.slice(0, def.maxPlayers).map(p => p.id);
    this.setPhase('intro', INTRO_TIME, () => this.startGame());
    this.broadcastState();
  }

  startGame() {
    const def = GAMES[this.gameId];
    const players = this.participants
      .map(id => this.players.get(id))
      .filter(Boolean)
      .map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot }));
    if (players.length < def.minPlayers) { this.toLobby(); this.broadcastState(); return; }
    this.game = def.create(players);
    this.botTimer = 0;
    this.setPhase('playing', 0);
    this.broadcastState();
    this.tickN = 0;
    this.lastStep = 0;
    this.loop = setInterval(() => this.step(), TICK * 1000);
  }

  // Appelé 60 fois par seconde. Si la boucle a pris du retard (navigateur occupé par le
  // rendu en mode solo, serveur chargé), on rattrape quelques pas pour garder le temps réel.
  step() {
    const now = Date.now();
    const late = this.lastStep ? (now - this.lastStep) / (TICK * 1000) : 1;
    this.lastStep = now;
    const n = late > 2 ? Math.min(8, Math.round(late)) : 1;
    for (let i = 0; i < n && this.game && this.phase === 'playing'; i++) this.stepOnce();
  }

  stepOnce() {
    const g = this.game;
    if (!g) return;
    try {
      this.botTimer += TICK;
      const botStick = this.botTimer >= 0.1;
      if (botStick) this.botTimer = 0;
      for (const id of this.participants) {
        const p = this.players.get(id);
        if (!p || !p.bot || !g.bot) continue;
        const def = GAMES[this.gameId];
        if (def.controls.type === 'stick') {
          if (!botStick) continue;
          const out = g.bot(id, 0.1);
          if (out?.input) g.input(id, out.input);
        } else {
          const out = g.bot(id, TICK);
          if (out?.action) g.action(id, out.action);
        }
      }
      g.tick(TICK);
      this.tickN += 1;
      if (this.tickN % SNAP_EVERY === 0 || g.over) this.sendSnapshot();
      if (g.over) this.finishGame();
    } catch (err) {
      console.error('Erreur de jeu', this.gameId, err);
      this.toLobby();
      this.broadcastState();
    }
  }

  sendSnapshot() {
    const common = JSON.stringify(this.game.snapshot());
    for (const p of this.online()) {
      if (!p.send) continue;
      const priv = this.game.privateSnap ? this.game.privateSnap(p.id) : null;
      p.send(`{"type":"snap","g":"${this.gameId}","s":${common},"me":${JSON.stringify(priv)}}`);
    }
  }

  finishGame() {
    const g = this.game;
    const res = g.results();
    const points = res.points || pointsFromRanking(res.groups);
    const rows = [];
    res.groups.forEach((group, gi) => {
      const rank = res.groups.slice(0, gi).reduce((n, gg) => n + gg.length, 0) + 1;
      for (const id of group) {
        const p = this.players.get(id);
        const info = g.players.find(pp => pp.id === id);
        rows.push({
          id, rank, name: info?.name || p?.name || '?', color: info?.color || p?.color, bot: !!info?.bot,
          detail: res.detail?.[id] || '', points: points[id] || 0,
        });
      }
    });
    // Saison du crew (les bots ne comptent pas).
    const season = this.rec.season;
    for (const r of rows) {
      if (r.bot) continue;
      const s = season[r.id] || (season[r.id] = { name: r.name, pts: 0, wins: 0, played: 0 });
      s.name = r.name;
      s.color = r.color;
      s.pts += r.points;
      s.played += 1;
      if (r.rank === 1) s.wins += 1;
    }
    const def = GAMES[this.gameId];
    const winners = rows.filter(r => r.rank === 1).map(r => r.name);
    const title = res.title || (winners.length === 1 ? `${winners[0]} gagne !` : `Égalité : ${winners.join(', ')}`);
    this.rec.history.unshift({ game: this.gameId, at: Date.now(), title, winners });
    this.rec.history = this.rec.history.slice(0, 30);
    this.store.save();
    this.results = { game: this.gameId, title, rows, emoji: def.emoji, name: def.name };
    this.lastGame = this.gameId;
    this.game = null;
    this.setPhase('results', RESULTS_TIME, () => {
      if (this.humans().length) this.startVote();
      else { this.toLobby(); this.broadcastState(); }
    });
    this.broadcastState();
  }

  // ---------- Diffusion ----------
  seasonRows() {
    return Object.entries(this.rec.season)
      .map(([id, s]) => ({ id, ...s }))
      .sort((a, b) => b.pts - a.pts || b.wins - a.wins)
      .slice(0, 20);
  }

  state() {
    return {
      type: 'state',
      crew: { code: this.code, name: this.rec.name },
      hostId: this.hostId,
      players: this.online().map(p => ({ id: p.id, name: p.name, color: p.color, bot: p.bot, media: !!p.media })),
      phase: this.phase,
      remaining: this.phaseEnd ? Math.max(0, this.phaseEnd - Date.now()) : 0,
      vote: this.vote,
      spin: this.spin,
      gameId: this.gameId,
      participants: this.participants,
      results: this.results,
      season: this.seasonRows(),
      history: this.rec.history.slice(0, 10),
      eligible: this.eligibleGames(),
    };
  }

  broadcastState() { this.broadcast(this.state()); }

  broadcast(obj) {
    const s = JSON.stringify(obj);
    for (const p of this.online()) p.send?.(s);
  }
}
