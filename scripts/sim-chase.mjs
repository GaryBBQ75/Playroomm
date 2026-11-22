// Simulation de la Course-poursuite entre bots : statistiques d'équilibrage, et vérification
// que ni les bots ni les voitures civiles ne restent coincés (y compris sur les rampes).
// Usage : node scripts/sim-chase.mjs [parties par taille]
import chase from '../server/games/chase.js';

const GAMES = Number(process.argv[2] || 30);
const dt = 1 / 60;
for (const n of [2, 3, 4, 5, 8]) {
  let rounds = 0, busts = 0, bustTime = 0, fugPts = 0, stuck = 0, maxStuck = 0, npcMax = 0, upTime = 0, climbs = 0, time = 0;
  const st = { wrecks: 0, barrels: 0, tosses: 0 };
  let where = '';
  for (let g = 0; g < GAMES; g++) {
    const ps = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Bot ' + i, color: '#fff', bot: true }));
    const game = chase.create(ps);
    let still = {}, anchor = {}, npcStill = [], npcAnchor = [], was = {};
    let bt = 0, round = 0;
    while (!game.over) {
      bt += dt;
      if (bt >= 0.1) { bt = 0; for (const p of ps) { const o = game.bot(p.id, 0.1); if (o?.input) game.input(p.id, o.input); } }
      const before = game.phase, tBefore = game.t;
      game.tick(dt);
      if (game.round !== round) { round = game.round; rounds++; still = {}; anchor = {}; npcStill = []; npcAnchor = []; was = {}; }
      if (before === 'play' && game.phase === 'end') { fugPts += game.fugScore; if (game.msg.startsWith('Arrêté')) { busts++; bustTime += tBefore; } }
      if (game.phase === 'play') {
        time += dt;
        // Temps passé sans s'éloigner de plus de 25 unités d'un point (carcasses exclues).
        for (const c of game.cars) {
          if (c.up >= 0) upTime += dt;
          if (c.up >= 0 && !(was[c.id] >= 0)) climbs++;
          was[c.id] = c.up;
          const a = anchor[c.id];
          if (c.dead > 0 || !a || Math.hypot(c.x - a.x, c.y - a.y) > 25) { anchor[c.id] = { x: c.x, y: c.y }; still[c.id] = 0; continue; }
          still[c.id] += dt; stuck += dt;
          if (still[c.id] > maxStuck) { maxStuck = still[c.id]; where = `${c.role} (${Math.round(c.x)}, ${Math.round(c.y)}) niveau ${c.up}`; }
        }
        game.npcs.forEach((c, i) => {
          const a = npcAnchor[i];
          if (!a || Math.hypot(c.x - a.x, c.y - a.y) > 25) { npcAnchor[i] = { x: c.x, y: c.y }; npcStill[i] = 0; return; }
          npcStill[i] += dt; npcMax = Math.max(npcMax, npcStill[i]);
        });
      }
      game.snapshot();
    }
    for (const k in st) st[k] += game.stats[k];
  }
  console.log(`${n} joueurs : ${rounds} manches, ${(100 * busts / rounds).toFixed(0)} % d'arrestations (en ${(bustTime / Math.max(1, busts)).toFixed(1)} s en moyenne), ${(fugPts / rounds).toFixed(1)} pts fugitif/manche | blocage max bot ${maxStuck.toFixed(1)} s ${where}, civil ${npcMax.toFixed(1)} s | par manche : ${(st.wrecks / rounds).toFixed(1)} flics explosés, ${(st.barrels / rounds).toFixed(1)} barils, ${(st.tosses / rounds).toFixed(1)} civils projetés, ${(climbs / rounds).toFixed(1)} montées sur un ouvrage (${(100 * upTime / (time * n)).toFixed(1)} % du temps)`);
}
