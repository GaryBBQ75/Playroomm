// Simulation de la Course-poursuite entre bots : statistiques d'équilibrage.
// Usage : node scripts/sim-chase.mjs [parties par taille]
import chase from '../server/games/chase.js';

const GAMES = Number(process.argv[2] || 40);
const dt = 1 / 60;
for (const n of [2, 3, 4, 5, 8]) {
  let rounds = 0, busts = 0, bustTime = 0, fugPts = 0, stuck = 0, maxStuck = 0, crashes = 0;
  for (let g = 0; g < GAMES; g++) {
    const ps = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Bot ' + i, color: '#fff', bot: true }));
    const game = chase.create(ps);
    const still = {}, last = {};
    let bt = 0, round = 0;
    while (!game.over) {
      bt += dt;
      if (bt >= 0.1) { bt = 0; for (const p of ps) { const o = game.bot(p.id, 0.1); if (o?.input) game.input(p.id, o.input); } }
      const before = game.phase, tBefore = game.t, fs = game.fugScore;
      game.tick(dt);
      if (game.round !== round) { round = game.round; rounds++; for (const p of ps) { still[p.id] = 0; last[p.id] = null; } }
      if (before === 'play' && game.phase === 'end') { fugPts += game.fugScore; if (game.msg.startsWith('Arrêté')) { busts++; bustTime += tBefore; } }
      if (game.phase === 'play') {
        // Temps passé presque à l'arrêt, par voiture.
        for (const c of game.cars) {
          const l = last[c.id];
          if (l && Math.hypot(c.x - l.x, c.y - l.y) < 0.4) { still[c.id] += dt; maxStuck = Math.max(maxStuck, still[c.id]); stuck += dt; } else still[c.id] = 0;
          last[c.id] = { x: c.x, y: c.y };
        }
      }
      for (const e of game.snapshot().ev) if (e.t === 'crash') crashes++;
    }
  }
  console.log(`${n} joueurs : ${rounds} manches, ${(100 * busts / rounds).toFixed(0)} % d'arrestations, temps moyen avant arrestation ${(bustTime / Math.max(1, busts)).toFixed(1)} s, ${(fugPts / rounds).toFixed(1)} pts fugitif par manche, blocage max ${maxStuck.toFixed(2)} s, temps bloqué ${(100 * stuck / (rounds * n * 45)).toFixed(2)} %, ${(crashes / rounds).toFixed(1)} chocs murs par manche`);
}
