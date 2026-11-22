// Fait jouer chaque jeu par des bots jusqu'à la fin, sans réseau.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_GAMES as GAME_LIST } from '../server/games/index.js';

const players = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'Joueur ' + i, color: '#fff', bot: true }));

for (const def of GAME_LIST) {
  for (const n of [def.minPlayers, 2, 5, 8].filter((v, i, a) => v >= def.minPlayers && a.indexOf(v) === i)) {
    test(`${def.id} se termine avec ${n} bots`, () => {
      const ps = players(n);
      const g = def.create(ps);
      const dt = 1 / 60;
      let t = 0;
      let bt = 0;
      while (!g.over && t < 900) {
        bt += dt;
        for (const p of ps) {
          if (def.controls.type === 'stick' || def.controls.type === 'steer') {
            if (bt >= 0.1) { const o = g.bot(p.id, 0.1); if (o?.input) g.input(p.id, o.input); }
          } else {
            const o = g.bot(p.id, dt); if (o?.action) g.action(p.id, o.action);
          }
        }
        if (bt >= 0.1) bt = 0;
        g.tick(dt);
        t += dt;
        if (Math.round(t * 60) % 3 === 0) {
          const s = JSON.stringify(g.snapshot());
          assert.ok(s.length < 40000, 'snapshot trop gros ' + s.length);
          for (const p of ps) g.privateSnap?.(p.id);
        }
      }
      assert.ok(g.over, `${def.id} ne s'est pas terminé (t=${t.toFixed(0)}s)`);
      const r = g.results();
      const ids = r.groups.flat();
      assert.equal(new Set(ids).size, n);
      console.log(`  ${def.id} n=${n} durée=${t.toFixed(0)}s ${r.title || ''}`);
    });
  }
}

test('les entrées invalides sont ignorées', () => {
  for (const def of GAME_LIST) {
    const g = def.create(players(3));
    for (const bad of [null, 1, 'x', { mx: 'a' }, { mx: 1e9, my: -1e9 }, { t: 'play', i: 99 }, { t: 'build', kind: 'x', c: -1, r: 2.5 }, { t: 'up', c: 0, r: 0 }]) {
      g.input?.('p0', bad);
      g.action?.('p0', bad);
      g.input?.('inconnu', bad);
      g.action?.('inconnu', bad);
    }
    g.tick(1 / 60);
    JSON.stringify(g.snapshot());
  }
});
