// Carte de la Course-poursuite : une petite ville sur une île, 6 x 6 pâtés de maisons.
// Module pur (aucune dépendance) partagé par le serveur (collisions, bots) et par le
// rendu 3D du client, pour que les deux voient exactement la même ville.

export const N = 6;          // pâtés par côté
export const ROAD = 90;      // largeur d'une rue
export const BLOCK = 130;    // côté d'un pâté (trottoir compris)
export const PITCH = ROAD + BLOCK;
export const SIZE = N * BLOCK + (N + 1) * ROAD; // 1410
export const NODES = N + 1;  // carrefours par côté

// Générateur pseudo-aléatoire à graine (la carte est fixe).
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const nodePos = i => ROAD / 2 + i * PITCH;
export const blockPos = i => ROAD + i * PITCH;

const PARKS = [[4, 1], [1, 4], [0, 0], [5, 5]];
const isPlaza = (i, j) => (i === 2 || i === 3) && (j === 2 || j === 3);
const isPark = (i, j) => PARKS.some(p => p[0] === i && p[1] === j);

let cache = null;

export function getMap() {
  if (cache) return cache;
  const rand = rng(20261122);
  const rects = [];     // pâtés pleins (collisions) : { x, y, w, h }
  const circles = [];   // obstacles ronds : { x, y, r, kind }
  const blocks = [];    // description visuelle des pâtés bâtis
  const parks = [];

  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (isPlaza(i, j)) continue;
      const x = blockPos(i), y = blockPos(j);
      if (isPark(i, j)) {
        const trees = [];
        let guard = 0;
        while (trees.length < 4 && guard++ < 60) {
          const tx = x + 24 + rand() * (BLOCK - 48), ty = y + 24 + rand() * (BLOCK - 48);
          if (trees.some(t => Math.hypot(t.x - tx, t.y - ty) < 44)) continue;
          trees.push({ x: Math.round(tx), y: Math.round(ty), r: 9, kind: 'tree' });
        }
        circles.push(...trees);
        parks.push({ x, y, w: BLOCK, h: BLOCK });
        continue;
      }
      rects.push({ x, y, w: BLOCK, h: BLOCK });
      // Découpage du pâté en 1, 2 ou 4 immeubles (purement visuel).
      const m = 14; // trottoir
      const bx = x + m, by = y + m, bs = BLOCK - 2 * m;
      const kind = rand();
      const lots = [];
      const cut = 0.4 + rand() * 0.2;
      if (kind < 0.22) lots.push([0, 0, 1, 1]);
      else if (kind < 0.5) lots.push([0, 0, cut, 1], [cut, 0, 1, 1]);
      else if (kind < 0.78) lots.push([0, 0, 1, cut], [0, cut, 1, 1]);
      else {
        const c2 = 0.4 + rand() * 0.2;
        lots.push([0, 0, cut, c2], [cut, 0, 1, c2], [0, c2, cut, 1], [cut, c2, 1, 1]);
      }
      const buildings = lots.map(l => ({
        x: bx + l[0] * bs, y: by + l[1] * bs, w: (l[2] - l[0]) * bs, h: (l[3] - l[1]) * bs,
        floors: 1 + Math.floor(rand() * rand() * 4.2), // surtout bas, quelques tours
        color: Math.floor(rand() * 8), roof: Math.floor(rand() * 4), awning: Math.floor(rand() * 6),
      }));
      blocks.push({ x, y, w: BLOCK, h: BLOCK, buildings });
    }
  }

  // Place centrale : fontaine, kiosques et bornes.
  const c = SIZE / 2;
  const plaza = { x: blockPos(2), y: blockPos(2), w: 2 * BLOCK + ROAD, h: 2 * BLOCK + ROAD };
  circles.push({ x: c, y: c, r: 40, kind: 'fountain' });
  for (const [sx, sy] of [[-1, -1], [1, 1]]) circles.push({ x: c + sx * 112, y: c + sy * 112, r: 17, kind: 'kiosk' });
  for (const [sx, sy] of [[1, -1], [-1, 1]]) {
    circles.push({ x: c + sx * 118, y: c + sy * 100, r: 9, kind: 'tree' });
    circles.push({ x: c + sx * 96, y: c + sy * 124, r: 9, kind: 'tree' });
  }
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2;
    circles.push({ x: Math.round(c + Math.cos(a) * 92), y: Math.round(c + Math.sin(a) * 92), r: 5, kind: 'bollard' });
  }

  // Carrefours : le centre de la place est occupé par la fontaine.
  const blocked = new Set([3 + 3 * NODES]);

  // Emplacements possibles des sacs de billets : milieux de rues, parcs, coins de la place.
  const bagSpots = [];
  for (let j = 0; j < NODES; j++) {
    for (let i = 0; i < NODES; i++) {
      if (i < NODES - 1 && !(j === 3 && (i === 2 || i === 3))) bagSpots.push({ x: nodePos(i) + PITCH / 2, y: nodePos(j) });
      if (j < NODES - 1 && !(i === 3 && (j === 2 || j === 3))) bagSpots.push({ x: nodePos(i), y: nodePos(j) + PITCH / 2 });
    }
  }
  for (const p of parks) bagSpots.push({ x: p.x + p.w / 2, y: p.y + p.h / 2 });
  for (const [sx, sy] of [[1, -1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) bagSpots.push({ x: c + sx * 80, y: c + sy * 80 });
  const free = s => !circles.some(o => Math.hypot(o.x - s.x, o.y - s.y) < o.r + 30);

  cache = { size: SIZE, rects, circles, blocks, parks, plaza, blocked, bagSpots: bagSpots.filter(free) };
  return cache;
}

// Le segment (x1,y1)-(x2,y2) est-il dégagé de tout pâté (élargi de `pad`) ?
export function clearLine(map, x1, y1, x2, y2, pad = 14) {
  const dx = x2 - x1, dy = y2 - y1;
  for (const r of map.rects) {
    const minX = r.x - pad, maxX = r.x + r.w + pad, minY = r.y - pad, maxY = r.y + r.h + pad;
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-6) { if (x1 < minX || x1 > maxX) continue; }
    else {
      let a = (minX - x1) / dx, b = (maxX - x1) / dx;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    if (Math.abs(dy) < 1e-6) { if (y1 < minY || y1 > maxY) continue; }
    else {
      let a = (minY - y1) / dy, b = (maxY - y1) / dy;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) continue;
    }
    return false;
  }
  return true;
}

// Distances (en nombre de rues) de tous les carrefours vers le carrefour `goal`.
export function nodeDistances(map, goal) {
  const dist = new Array(NODES * NODES).fill(99);
  if (map.blocked.has(goal)) return dist;
  dist[goal] = 0;
  const queue = [goal];
  for (let q = 0; q < queue.length; q++) {
    const n = queue[q], i = n % NODES, j = (n - i) / NODES;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= NODES || b >= NODES) continue;
      const m = a + b * NODES;
      if (map.blocked.has(m) || dist[m] <= dist[n] + 1) continue;
      dist[m] = dist[n] + 1;
      queue.push(m);
    }
  }
  return dist;
}

// Carrefour libre le plus proche d'un point.
export function nearestNode(map, x, y) {
  let best = 0, bd = Infinity;
  for (let n = 0; n < NODES * NODES; n++) {
    if (map.blocked.has(n)) continue;
    const i = n % NODES, j = (n - i) / NODES;
    const d = Math.hypot(nodePos(i) - x, nodePos(j) - y);
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}
