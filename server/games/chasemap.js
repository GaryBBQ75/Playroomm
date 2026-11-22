// Carte de la Course-poursuite : une île avec des quartiers variés (résidentiel, centre-ville,
// parking, station-service, canal, parc, zone industrielle, port), des rues de largeurs
// différentes, un rond-point, des ruelles et impasses, et trois ouvrages sur lesquels on
// monte : un pont au-dessus du canal, une voie surélevée et un parking à étage.
// Module pur (aucune dépendance) partagé par le serveur (collisions, bots, circulation) et
// par le rendu 3D du client, pour que les deux voient exactement la même ville.

export const SIZE = 2000;
export const CELL = 25;                 // pas de la grille de navigation des bots
export const GN = SIZE / CELL;
export const DECK_Z = 40;               // hauteur des tabliers
export const LOW = 30;                  // pied de rampe : presque au niveau du sol, franchissable

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

// Pâtés : [x0, y0, x1, y1, type]. L'asphalte, c'est tout ce qui reste entre eux.
const BLOCKS = [
  // Quartier résidentiel (nord-ouest)
  [70, 70, 330, 300, 'houses'], [390, 70, 700, 300, 'houses'], [70, 360, 250, 640, 'houses'],
  [310, 360, 700, 560, 'houses'], [70, 700, 330, 870, 'houses'], [390, 620, 700, 870, 'houses'],
  // Centre-ville autour du rond-point (deux ruelles, une place)
  [800, 70, 915, 330, 'town'], [955, 70, 1040, 330, 'town'], [1240, 70, 1480, 180, 'town'], [1240, 180, 1480, 330, 'plaza'],
  [800, 400, 990, 610, 'town'], [1290, 400, 1480, 610, 'town'],
  [800, 680, 1040, 870, 'town'], [1240, 680, 1345, 870, 'town'], [1385, 680, 1480, 870, 'town'],
  // Nord-est : grand parking, station-service
  [1570, 70, 1930, 360, 'parking'], [1570, 420, 1930, 580, 'gas'],
  // Sud : parc et lac, bord de plage, zone industrielle, port
  [70, 1100, 700, 1560, 'park'], [70, 1630, 700, 1930, 'beach'],
  [800, 1100, 1040, 1440, 'depot'], [1240, 1100, 1480, 1440, 'containers'],
  [800, 1640, 1040, 1930, 'depot'], [1240, 1640, 1480, 1930, 'tanks'],
  [1570, 1100, 1930, 1930, 'port'],
];

// Eau : le canal (franchi par deux ponts plats et le grand pont) et le bassin du port.
const WATER = [[150, 945, 700, 1025], [800, 945, 1480, 1025], [1570, 945, 1850, 1025], [1720, 1450, 2000, 1620]];

// Ouvrages surélevés. Chaque partie est un rectangle ; `ramp` donne le sens de la montée
// (N, S, E, O), `open` les côtés par lesquels on passe à la partie voisine.
// `path` : points de passage des bots (le premier et, sauf impasse, le dernier sont au sol).
const STRUCTS = [
  {
    name: 'pont',
    parts: [{ x: 1095, y: 670, w: 90, h: 200, ramp: 'S', open: 'ns' }, { x: 1095, y: 870, w: 90, h: 230, open: 'ns' }, { x: 1095, y: 1100, w: 90, h: 200, ramp: 'N', open: 'ns' }],
    path: [[1140, 640], [1140, 720], [1140, 800], [1140, 880], [1140, 985], [1140, 1090], [1140, 1170], [1140, 1250], [1140, 1330]],
  },
  {
    name: 'voie',
    parts: [{ x: 820, y: 1500, w: 200, h: 80, ramp: 'E', open: 'ew' }, { x: 1020, y: 1500, w: 280, h: 80, open: 'ew' }, { x: 1300, y: 1500, w: 180, h: 80, ramp: 'O', open: 'ew' }],
    path: [[790, 1540], [870, 1540], [960, 1540], [1060, 1540], [1160, 1540], [1260, 1540], [1350, 1540], [1430, 1540], [1510, 1540]],
  },
  {
    name: 'parking',
    solid: [[1600, 710, 1900, 870], [1840, 640, 1900, 710]],
    parts: [{ x: 1600, y: 640, w: 240, h: 70, ramp: 'E', open: 'ew' }, { x: 1840, y: 640, w: 60, h: 70, open: 'ws' }, { x: 1600, y: 710, w: 300, h: 160, open: 'n' }],
    path: [[1572, 675], [1650, 675], [1740, 675], [1820, 675], [1870, 685], [1862, 765], [1750, 795], [1650, 795]],
    deadEnd: true,
  },
];

// Boucles de circulation des voitures civiles (au centre des rues).
const LOOPS = [
  [[35, 35], [1965, 35], [1965, 1405], [1690, 1405], [1690, 1665], [1965, 1665], [1965, 1965], [35, 1965]],
  [[750, 365], [1525, 365], [1525, 645], [750, 645]],
  [[750, 905], [750, 1065], [1525, 1065], [1525, 905]],
  [[750, 1470], [1525, 1470], [1525, 1610], [750, 1610]],
];
const NPCS = [[0, 0], [0, 3], [0, 6], [1, 0], [1, 2], [2, 1], [2, 3], [3, 0], [3, 2]]; // [boucle, point de départ]

const AXIS = { S: [0, 1], N: [0, -1], E: [1, 0], O: [-1, 0] };

// Distance parcourue depuis le pied d'une rampe (négative avant le pied).
export function rampT(p, x, y) {
  switch (p.ramp) {
    case 'S': return y - p.y;
    case 'N': return p.y + p.h - y;
    case 'E': return x - p.x;
    default: return p.x + p.w - x;
  }
}
const rampLen = p => (p.ramp === 'S' || p.ramp === 'N' ? p.h : p.w);
// Le point est-il dans la largeur de la rampe ?
export function rampSpan(p, x, y, pad = 0) {
  return p.ramp === 'S' || p.ramp === 'N' ? x > p.x - pad && x < p.x + p.w + pad : y > p.y - pad && y < p.y + p.h + pad;
}
export function rampDir(p) { return AXIS[p.ramp]; }

// Hauteur du tablier d'un ouvrage sous le point (x, y).
export function heightOn(st, x, y) {
  let best = null, bd = Infinity;
  for (const p of st.parts) {
    const px = Math.max(p.x, Math.min(p.x + p.w, x)), py = Math.max(p.y, Math.min(p.y + p.h, y));
    const d = Math.hypot(x - px, y - py);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best.ramp) return DECK_Z;
  return Math.max(0, Math.min(1, rampT(best, x, y) / rampLen(best))) * DECK_Z;
}

// Hauteur au sol : nulle, sauf sur le pied d'une rampe qu'on peut traverser.
export function groundHeight(map, x, y) {
  for (const st of map.structs) {
    for (const p of st.parts) {
      if (!p.ramp || !rampSpan(p, x, y)) continue;
      const t = rampT(p, x, y);
      if (t > 0 && t <= LOW + 6) return t / rampLen(p) * DECK_Z;
    }
  }
  return 0;
}

// Garde un disque à l'intérieur d'un ouvrage (garde-corps). Renvoie la correction ou null.
export function keepOn(st, x, y, r) {
  let bx = 0, by = 0, bd = Infinity;
  for (const p of st.parts) {
    const o = p.open;
    let x0 = p.x + (o.includes('w') ? -r : r), x1 = p.x + p.w + (o.includes('e') ? r : -r);
    let y0 = p.y + (o.includes('n') ? -r : r), y1 = p.y + p.h + (o.includes('s') ? r : -r);
    // Le pied de rampe est ouvert vers la rue.
    if (p.ramp === 'S') y0 -= 60; else if (p.ramp === 'N') y1 += 60; else if (p.ramp === 'E') x0 -= 60; else if (p.ramp === 'O') x1 += 60;
    const px = Math.max(x0, Math.min(x1, x)), py = Math.max(y0, Math.min(y1, y));
    const d = Math.hypot(x - px, y - py);
    if (d < bd) { bd = d; bx = px; by = py; }
  }
  if (bd < 0.01) return null;
  return { nx: (bx - x) / bd, ny: (by - y) / bd, depth: bd };
}

function segHitsRect(x1, y1, x2, y2, r, pad) {
  const dx = x2 - x1, dy = y2 - y1;
  const minX = r.x - pad, maxX = r.x + r.w + pad, minY = r.y - pad, maxY = r.y + r.h + pad;
  let t0 = 0, t1 = 1;
  if (Math.abs(dx) < 1e-6) { if (x1 < minX || x1 > maxX) return false; }
  else {
    let a = (minX - x1) / dx, b = (maxX - x1) / dx;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  if (Math.abs(dy) < 1e-6) { if (y1 < minY || y1 > maxY) return false; }
  else {
    let a = (minY - y1) / dy, b = (maxY - y1) / dy;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

// Le segment est-il dégagé de tout obstacle plein au sol (élargi de `pad`) ?
export function clearLine(map, x1, y1, x2, y2, pad = 14) {
  const minX = Math.min(x1, x2) - pad, maxX = Math.max(x1, x2) + pad, minY = Math.min(y1, y2) - pad, maxY = Math.max(y1, y2) + pad;
  for (const r of map.sight) {
    if (r.x > maxX || r.x + r.w < minX || r.y > maxY || r.y + r.h < minY) continue;
    if (segHitsRect(x1, y1, x2, y2, r, pad)) return false;
  }
  return true;
}

let cache = null;

export function getMap() {
  if (cache) return cache;
  const rand = rng(20261123);
  const rects = [];     // obstacles pleins au sol : { x, y, w, h }
  const circles = [];   // obstacles ronds au sol : { x, y, r }
  const items = [];     // tout ce que le client dessine
  const barrels = [];   // objets explosifs : { x, y, r, kind }
  const structs = STRUCTS.map((s, i) => ({ ...s, id: i, obs: [] }));
  const pick = n => Math.floor(rand() * n);

  // Couloirs à garder libres : circulation civile, accès aux rampes.
  const keep = [];
  for (const l of LOOPS) l.forEach((p, i) => { const q = l[(i + 1) % l.length]; keep.push([p[0], p[1], q[0], q[1]]); });
  for (const s of structs) keep.push([s.path[0][0], s.path[0][1], s.path[1][0], s.path[1][1]]);
  const free = (x, y, w, h, pad = 30) => {
    const r = { x, y, w, h };
    if (keep.some(k => segHitsRect(k[0], k[1], k[2], k[3], r, pad))) return false;
    if (rects.some(o => x < o.x + o.w + 4 && x + w > o.x - 4 && y < o.y + o.h + 4 && y + h > o.y - 4)) return false;
    return !circles.some(o => o.x > x - o.r - 4 && o.x < x + w + o.r + 4 && o.y > y - o.r - 4 && o.y < y + h + o.r + 4);
  };
  const solid = (x, y, w, h, item) => {
    if (!free(x, y, w, h)) return false;
    rects.push({ x, y, w, h });
    if (item) items.push({ x, y, w, h, ...item });
    return true;
  };
  const round = (x, y, r, item, pad = 30) => {
    if (!free(x - r, y - r, 2 * r, 2 * r, pad)) return false;
    circles.push({ x, y, r });
    if (item) items.push({ x, y, r, ...item });
    return true;
  };
  const barrel = (x, y, kind = 'barrel') => {
    if (!free(x - 8, y - 8, 16, 16) || barrels.some(b => Math.hypot(b.x - x, b.y - y) < 18)) return;
    barrels.push({ x: Math.round(x), y: Math.round(y), r: kind === 'pump' ? 9 : 7, kind });
  };
  const parked = (x, y, a) => {
    const flat = Math.abs(Math.cos(a)) > 0.7;
    return solid(x - (flat ? 23 : 12), y - (flat ? 12 : 23), flat ? 46 : 24, flat ? 24 : 46, { t: 'car', cx: x, cy: y, a, m: pick(6), c: pick(8) });
  };

  // ----- Eau -----
  for (const [x0, y0, x1, y1] of WATER) { rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }); items.push({ t: 'water', x: x0, y: y0, w: x1 - x0, h: y1 - y0 }); }

  // ----- Ouvrages : au sol, une rampe est un mur sauf son pied -----
  for (const s of structs) {
    for (const p of s.parts) {
      if (!p.ramp) continue;
      const r = { x: p.x, y: p.y, w: p.w, h: p.h };
      if (p.ramp === 'S') { r.y += LOW; r.h -= LOW; } else if (p.ramp === 'N') r.h -= LOW; else if (p.ramp === 'E') { r.x += LOW; r.w -= LOW; } else r.w -= LOW;
      rects.push(r);
    }
    for (const b of s.solid || []) rects.push({ x: b[0], y: b[1], w: b[2] - b[0], h: b[3] - b[1] });
  }
  // Piles du pont et de la voie surélevée.
  for (const [x, y] of [[1030, 1508], [1030, 1572], [1290, 1508], [1290, 1572], [1140, 1508], [1140, 1572]]) { circles.push({ x, y, r: 7 }); items.push({ t: 'pillar', x, y, r: 7 }); }
  for (const [x, y] of [[1103, 955], [1177, 955], [1103, 1015], [1177, 1015]]) items.push({ t: 'pillar', x, y, r: 7 });
  // Toit du parking : muret au-dessus de la rampe, voitures garées.
  structs[2].obs.push({ x: 1600, y: 706, w: 240, h: 8 });
  for (const [x, y] of [[1625, 845], [1665, 845], [1745, 845], [1825, 845], [1875, 845], [1625, 738], [1700, 738]]) {
    structs[2].obs.push({ x: x - 12, y: y - 22, w: 24, h: 44 });
    items.push({ t: 'car', cx: x, cy: y, a: Math.PI / 2, m: pick(6), c: pick(8), z: DECK_Z });
  }

  // ----- Rond-point, terre-plein du boulevard, chantier -----
  circles.push({ x: 1140, y: 505, r: 55 }); items.push({ t: 'island', x: 1140, y: 505, r: 55 });
  for (let y = 100; y <= 290; y += 62) { circles.push({ x: 1140, y, r: 7 }); items.push({ t: 'tree', x: 1140, y, r: 7, k: 0, s: 1 }); }
  items.push({ t: 'median', x: 1128, y: 80, w: 24, h: 232 });
  for (const [x, y, w, h] of [[1050, 1745, 44, 7], [1050, 1800, 44, 7]]) { rects.push({ x, y, w, h }); items.push({ t: 'barrier', x, y, w, h }); }
  for (const [x, y] of [[1100, 1740], [1104, 1772], [1100, 1806], [1056, 1772]]) { circles.push({ x, y, r: 3 }); items.push({ t: 'cone', x, y, r: 3 }); }
  barrels.push({ x: 1075, y: 1773, r: 7, kind: 'barrel' });
  // Mur au bout de la ruelle : une impasse.
  rects.push({ x: 1345, y: 852, w: 40, h: 10 }); items.push({ t: 'wall', x: 1345, y: 852, w: 40, h: 10 });
  barrels.push({ x: 1356, y: 838, r: 7, kind: 'barrel' }, { x: 1374, y: 836, r: 7, kind: 'gas' }, { x: 935, y: 200, r: 7, kind: 'barrel' });

  // ----- Remplissage des pâtés -----
  const town = (x0, y0, x1, y1) => {
    // Pâté plein (trottoir), découpé en immeubles de tailles et hauteurs variées.
    rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'walk' });
    const lots = [];
    const split = (a, b, c, d, depth) => {
      const w = c - a, h = d - b;
      if ((w < 100 && h < 100) || depth > 3 || (depth > 0 && rand() < 0.2)) { lots.push([a, b, c, d]); return; }
      if (w > h) { const m = a + w * (0.36 + rand() * 0.28); split(a, b, m, d, depth + 1); split(m, b, c, d, depth + 1); }
      else { const m = b + h * (0.36 + rand() * 0.28); split(a, b, c, m, depth + 1); split(a, m, c, d, depth + 1); }
    };
    split(x0 + 13, y0 + 13, x1 - 13, y1 - 13, 0);
    for (const [a, b, c, d] of lots) {
      items.push({ t: 'bld', x: a + 2, y: b + 2, w: c - a - 4, h: d - b - 4, f: 2 + Math.floor(rand() * rand() * 7), c: pick(7), r: pick(5), s: pick(5) });
    }
    // Mobilier de trottoir (dans la zone pleine : aucune collision à gérer).
    const kinds = ['lamp', 'tree', 'bin', 'lamp', 'bench', 'sign', 'tree', 'booth'];
    let n = pick(8);
    for (let x = x0 + 26; x < x1 - 20; x += 44) { items.push({ t: kinds[n++ % 8], x, y: y0 + 6, k: 0, s: 0.55, a: 0 }); items.push({ t: kinds[n++ % 8], x: x + 14, y: y1 - 6, k: 0, s: 0.55, a: 0 }); }
    for (let y = y0 + 40; y < y1 - 30; y += 52) { items.push({ t: kinds[n++ % 8], x: x0 + 6, y, k: 0, s: 0.55, a: 1.57 }); items.push({ t: kinds[n++ % 8], x: x1 - 6, y: y + 12, k: 0, s: 0.55, a: 1.57 }); }
    items.push({ t: 'light', x: x0 + 5, y: y0 + 5 }, { t: 'light', x: x1 - 5, y: y1 - 5 });
  };

  const houses = (x0, y0, x1, y1, beach) => {
    // Maisons avec jardin : on peut couper à travers les pelouses, entre haies et arbres.
    items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: beach ? 'sand' : 'grass' });
    const nx = Math.max(1, Math.round((x1 - x0) / 125)), ny = Math.max(1, Math.round((y1 - y0) / 125));
    const pw = (x1 - x0) / nx, ph = (y1 - y0) / ny;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const px = x0 + i * pw, py = y0 + j * ph;
        const edge = i === 0 || j === 0 || i === nx - 1 || j === ny - 1;
        if (!edge) {
          // Cœur d'îlot : une piscine ou un bosquet
          if (rand() < 0.5) items.push({ t: 'pool', x: px + pw / 2 - 20, y: py + ph / 2 - 13, w: 40, h: 26 });
          else round(px + pw / 2, py + ph / 2, 9, { t: 'tree', k: beach ? 2 : pick(2), s: 1.1 });
          continue;
        }
        const along = j === 0 || j === ny - 1;
        const hw = along ? 58 + rand() * 18 : 46 + rand() * 12, hh = along ? 46 + rand() * 12 : 58 + rand() * 18;
        let hx = px + (pw - hw) / 2, hy = py + (ph - hh) / 2;
        if (j === 0) hy = py + 20; else if (j === ny - 1) hy = py + ph - hh - 20;
        else if (i === 0) hx = px + 20; else hx = px + pw - hw - 20;
        solid(Math.round(hx), Math.round(hy), Math.round(hw), Math.round(hh), { t: 'house', c: pick(6), rc: pick(4), ax: along ? 0 : 1, bw: beach ? 1 : 0 });
        round(px + pw - 15 - rand() * 8, py + ph - 15 - rand() * 8, 8, { t: 'tree', k: beach ? 2 : pick(2), s: 0.9 + rand() * 0.3 }, 34);
        if (rand() < 0.5) round(px + 16, py + ph - 16, 6, { t: 'tree', k: 3, s: 0.8 }, 34);
        if (i < nx - 1 && rand() < 0.55) solid(Math.round(px + pw - 3), Math.round(py + 16), 6, Math.round(ph * 0.5), { t: 'hedge' });
        if (j < ny - 1 && rand() < 0.4) solid(Math.round(px + 16), Math.round(py + ph - 3), Math.round(pw * 0.5), 6, { t: 'hedge' });
        if (rand() < 0.35) items.push({ t: 'lamp', x: px + 8, y: py + 8, a: 0 });
      }
    }
  };

  const fill = {
    town,
    houses: (a, b, c, d) => houses(a, b, c, d, false),
    beach: (x0, y0, x1, y1) => {
      houses(x0, y0, x1, y1 - 90, true);
      // Promenade plantée de palmiers, parasols sur le sable
      items.push({ t: 'ground', x: x0, y: y1 - 90, w: x1 - x0, h: 90, g: 'sand' });
      for (let x = x0 + 30; x < x1 - 20; x += 70) round(x, y1 - 72, 5, { t: 'tree', k: 2, s: 1.15 }, 34);
      for (let x = x0 + 60; x < x1 - 30; x += 95) round(x + rand() * 20, y1 - 30 + rand() * 12, 5, { t: 'parasol', c: pick(4) }, 34);
    },
    plaza: (x0, y0, x1, y1) => {
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'plaza' });
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      round(cx, cy, 30, { t: 'fountain' });
      round(cx - 80, cy - 30, 14, { t: 'kiosk' }); round(cx + 82, cy + 28, 14, { t: 'kiosk' });
      for (const [dx, dy] of [[-95, 45], [95, -45], [-40, 52], [45, -52]]) round(cx + dx, cy + dy, 7, { t: 'tree', k: 0, s: 0.95 });
      for (const [dx, dy] of [[-52, 0], [52, 0]]) solid(cx + dx - 4, cy + dy - 10, 8, 20, { t: 'bench', a: 1.57 });
      for (const dx of [-100, -50, 50, 100]) items.push({ t: 'lamp', x: cx + dx, y: y1 - 8, a: 0 });
    },
    parking: (x0, y0, x1, y1) => {
      // Grand parking à ciel ouvert : rangées de places marquées, une place sur deux occupée.
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'lot' });
      const rows = [[y0 + 14, 1], [y0 + 120, -1], [y0 + 166, 1]];
      for (const [ry, dir] of rows) {
        items.push({ t: 'paint', x: x0 + 20, y: dir > 0 ? ry - 1 : ry + 44, w: x1 - x0 - 40, h: 2, c: 'line' });
        for (let x = x0 + 20; x <= x1 - 20; x += 30) {
          items.push({ t: 'paint', x: x - 1, y: ry, w: 2, h: 45, c: 'line' });
          if (x < x1 - 40 && rand() < 0.5) parked(x + 15, ry + 23, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
      }
      for (const x of [x0 + 12, (x0 + x1) / 2, x1 - 12]) round(x, y0 + 165, 4, { t: 'lamp', a: 0 }, 20);
      solid(x0 + 150, y1 - 34, 60, 9, { t: 'barrier' });
      barrel(x1 - 26, y1 - 30); barrel(x1 - 40, y1 - 22);
    },
    gas: (x0, y0, x1, y1) => {
      // Station-service : auvent sur quatre poteaux, pompes explosives, boutique.
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'concrete' });
      const cx = x0 + 130, cy = y0 + 95;
      items.push({ t: 'canopy', x: cx - 75, y: cy - 42, w: 150, h: 84 });
      for (const [dx, dy] of [[-68, -35], [68, -35], [-68, 35], [68, 35]]) { circles.push({ x: cx + dx, y: cy + dy, r: 5 }); items.push({ t: 'pillar', x: cx + dx, y: cy + dy, r: 5, low: 1 }); }
      for (const dx of [-36, 0, 36]) barrels.push({ x: cx + dx, y: cy, r: 9, kind: 'pump' });
      solid(x0 + 240, y0 + 22, 100, 60, { t: 'shop' });
      round(x0 + 24, y1 - 24, 5, { t: 'totem' });
      parked(x0 + 290, y0 + 122, 0);
      barrels.push({ x: x0 + 232, y: y0 + 96, r: 7, kind: 'gas' }, { x: x0 + 248, y: y0 + 98, r: 7, kind: 'gas' });
    },
    park: (x0, y0, x1, y1) => {
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'grass' });
      // Lac (deux cercles qui se chevauchent)
      for (const [x, y, r] of [[330, 1330, 100], [425, 1385, 70]]) { circles.push({ x, y, r }); items.push({ t: 'lake', x, y, r }); }
      // Allée courbe qui traverse le parc
      for (let k = 0; k < 16; k++) {
        const a0 = Math.PI * (1 + k / 16 * 0.5), a1 = Math.PI * (1 + (k + 1) / 16 * 0.5);
        items.push({ t: 'path', x0: 700 + Math.cos(a0) * 560, y0: 1640 + Math.sin(a0) * 480, x1: 700 + Math.cos(a1) * 560, y1: 1640 + Math.sin(a1) * 480, w: 40 });
      }
      const onPath = (x, y) => Math.abs(Math.hypot((x - 700) / 560, (y - 1640) / 480) - 1) < 0.09;
      for (let n = 0; n < 150; n++) {
        const x = x0 + 18 + rand() * (x1 - x0 - 36), y = y0 + 18 + rand() * (y1 - y0 - 36);
        if (onPath(x, y)) continue;
        if (n % 5 === 4) round(x, y, 6, { t: 'tree', k: 3, s: 0.9 }, 34);
        else round(x, y, 8 + rand() * 3, { t: 'tree', k: pick(2), s: 0.95 + rand() * 0.5 }, 34);
      }
      for (const [x, y] of [[210, 1235], [450, 1285], [520, 1440]]) { solid(x, y, 20, 8, { t: 'bench', a: 0 }); items.push({ t: 'lamp', x: x + 30, y: y + 4, a: 0 }); }
    },
    depot: (x0, y0, x1, y1) => {
      // Entrepôts, palettes, barils
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'concrete' });
      const w = x1 - x0, h = y1 - y0;
      solid(x0 + 24, y0 + 26, w - 100, Math.round(h * 0.36), { t: 'ware', c: pick(4), ax: 0 });
      solid(x0 + 60, y1 - 24 - Math.round(h * 0.33), w - 84, Math.round(h * 0.33), { t: 'ware', c: pick(4), ax: 0 });
      round(x1 - 40, y0 + 56, 20, { t: 'tank' });
      for (let n = 0; n < 5; n++) solid(x0 + 20 + pick(w - 60), Math.round(y0 + h * 0.44 + rand() * h * 0.12), 16, 16, { t: 'crate', n: 1 + pick(2) });
      for (let n = 0; n < 4; n++) barrel(x0 + 22 + rand() * (w - 44), y0 + h * 0.43 + rand() * h * 0.16, n % 3 === 2 ? 'gas' : 'barrel');
      solid(x0 + 6, y0 + 6, 70, 5, { t: 'fence' }); solid(x1 - 76, y1 - 11, 70, 5, { t: 'fence' });
      items.push({ t: 'lamp', x: x0 + 10, y: y1 - 14, a: 0 }, { t: 'lamp', x: x1 - 10, y: y0 + 14, a: 0 });
    },
    containers: (x0, y0, x1, y1) => {
      // Parc à conteneurs avec un portique
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'concrete' });
      for (let y = y0 + 24; y < y1 - 50; y += 78) {
        for (let x = x0 + 20; x < x1 - 70; x += 70) {
          if (rand() < 0.22) continue;
          solid(x, y, 62, 26, { t: 'cont', n: 1 + pick(3), c: pick(8) });
        }
      }
      for (const [dx, dy] of [[0, 0], [150, 0], [0, 60], [150, 60]]) solid(x0 + 30 + dx, y1 - 104 + dy, 10, 10, null);
      items.push({ t: 'crane', x: x0 + 30, y: y1 - 104, w: 160, h: 70 });
      barrel(x1 - 24, y0 + 60); barrel(x1 - 26, y0 + 76); barrel(x0 + 14, y1 - 30, 'gas');
    },
    tanks: (x0, y0, x1, y1) => {
      // Dépôt de carburant : cuves, tuyaux, cheminées
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'concrete' });
      for (const [dx, dy, r] of [[62, 66, 40], [170, 60, 34], [70, 180, 34], [176, 176, 42]]) round(x0 + dx, y0 + dy, r, { t: 'tank', big: 1 });
      solid(x0 + 22, y1 - 60, 120, 40, { t: 'ware', c: 3, ax: 0, ch: 1 });
      solid(x0 + 108, y0 + 112, 6, 30, { t: 'fence' });
      for (const [dx, dy] of [[124, 118], [138, 124], [126, 136], [214, 250], [200, 258]]) barrel(x0 + dx, y0 + dy, dx % 3 ? 'barrel' : 'gas');
      items.push({ t: 'lamp', x: x1 - 10, y: y1 - 12, a: 0 });
    },
    port: (x0, y0, x1, y1) => {
      // Port : hangar, conteneurs, grue de quai, cargo dans le bassin
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'concrete' });
      solid(x0 + 30, y0 + 30, 150, 110, { t: 'ware', c: 1, ax: 1 });
      for (const [dx, dy] of [[0, 0], [120, 0], [0, 60], [120, 60]]) solid(1760 + dx, 1300 + dy, 10, 10, null);
      items.push({ t: 'crane', x: 1760, y: 1300, w: 130, h: 70, quay: 1 });
      for (let y = y0 + 40; y < y0 + 260; y += 44) for (let x = x0 + 220; x < x1 - 70; x += 72) if (rand() < 0.7) solid(x, y, 62, 26, { t: 'cont', n: 1 + pick(3), c: pick(8) });
      for (let y = y0 + 600; y < y1 - 40; y += 46) for (let x = x0 + 30; x < x1 - 80; x += 74) if (rand() < 0.6) solid(x, y, 62, 26, { t: 'cont', n: 1 + pick(3), c: pick(8) });
      items.push({ t: 'ship', x: 1760, y: 1480, w: 220, h: 80 });
      for (let x = 1735; x < 1930; x += 50) { round(x, 1436, 4, { t: 'bollard' }, 20); round(x, 1634, 4, { t: 'bollard' }, 20); }
      for (const [dx, dy] of [[40, 170], [56, 176], [44, 190], [200, 300], [320, 640], [306, 652]]) barrel(x0 + dx, y0 + dy, dy % 4 ? 'barrel' : 'gas');
      for (const [dx, dy] of [[20, 420], [330, 560]]) items.push({ t: 'lamp', x: x0 + dx, y: y0 + dy, a: 0 });
    },
  };
  for (const [x0, y0, x1, y1, type] of BLOCKS) fill[type](x0, y0, x1, y1);

  // ----- Peinture au sol : axes des grandes rues, rond-point, passages piétons -----
  const line = (x, y, w, h) => items.push({ t: 'paint', x, y, w, h, c: 'line' });
  line(749, 80, 2, 840); line(749, 1110, 2, 810); line(1524, 80, 2, 840); line(1524, 1110, 2, 810);
  line(160, 904, 530, 2); line(810, 904, 660, 2); line(160, 1064, 530, 2); line(810, 1064, 660, 2); line(1580, 904, 260, 2); line(1580, 1064, 260, 2);
  line(80, 34, 1840, 2); line(80, 1964, 1840, 2); line(34, 80, 2, 1840); line(1964, 80, 2, 1310);
  items.push({ t: 'ring', x: 1140, y: 505, r0: 100, r1: 103 });
  for (const [x, y, w, h, hz] of [[708, 318, 84, 14, 1], [708, 688, 84, 14, 1], [1488, 318, 84, 14, 1], [1488, 588, 84, 14, 1], [1048, 338, 184, 14, 1], [808, 618, 14, 54, 0], [1458, 338, 14, 54, 0], [708, 1108, 84, 14, 1], [1248, 1448, 14, 44, 0]]) items.push({ t: 'zebra', x, y, w, h, hz });
  // Garde-corps des deux ponts plats
  for (const x of [700, 800, 1480, 1570]) items.push({ t: 'rail', x: x - 2, y: 942, w: 4, h: 86 });
  // Feux et panneaux aux grands carrefours, lampadaires le long des quais et de la côte
  for (const [x, y] of [[704, 334], [796, 396], [704, 614], [796, 676], [1484, 334], [1566, 396], [1484, 614], [1566, 584], [1044, 334], [1236, 334], [1044, 676], [1236, 676]]) items.push({ t: 'light', x, y });
  for (let x = 180; x < 1840; x += 110) { if (free(x - 3, 937, 6, 6, 4)) items.push({ t: 'lamp', x, y: 941, a: 0 }); if (free(x - 3, 1026, 6, 6, 4)) items.push({ t: 'lamp', x: x + 50, y: 1029, a: 0 }); }
  for (let v = 120; v < 1900; v += 150) { items.push({ t: 'lamp', x: v, y: 5, a: 0 }, { t: 'lamp', x: v, y: 1995, a: 0 }, { t: 'lamp', x: 5, y: v, a: 0 }); if (v < 1440 || v > 1630) items.push({ t: 'lamp', x: 1995, y: v, a: 0 }); }

  // Rectangles qui bouchent la vue des bots : obstacles pleins + gros obstacles ronds.
  const sight = rects.filter(r => r.w > 12 || r.h > 12);
  for (const c of circles) if (c.r >= 18) sight.push({ x: c.x - c.r * 0.75, y: c.y - c.r * 0.75, w: c.r * 1.5, h: c.r * 1.5 });

  cache = {
    size: SIZE, rects, circles, items, barrels, structs, sight,
    loops: LOOPS, npcs: NPCS, blocks: BLOCKS,
    fugSpawns: [[1140, 372, 0], [1012, 505, Math.PI / 2], [1268, 505, -Math.PI / 2], [1140, 636, Math.PI]],
    copSpawns: [[40, 40], [1960, 40], [40, 1960], [1960, 1960], [40, 1000], [1140, 36], [1140, 1964], [1960, 1000], [360, 330], [1525, 1240], [750, 1800], [280, 1595]],
    nav: null, bagSpots: null,
  };
  return cache;
}

// ---------- Navigation des bots : grille fine + points de passage des ouvrages ----------
export function getNav() {
  const map = getMap();
  if (map.nav) return map.nav;
  const N = GN * GN;
  const valid = new Uint8Array(N);
  const pad = 17;
  for (let j = 0; j < GN; j++) {
    for (let i = 0; i < GN; i++) {
      const x = i * CELL + CELL / 2, y = j * CELL + CELL / 2;
      if (x < 22 || y < 22 || x > SIZE - 22 || y > SIZE - 22) continue;
      let ok = true;
      for (const r of map.rects) {
        if (x > r.x - pad && x < r.x + r.w + pad && y > r.y - pad && y < r.y + r.h + pad) { ok = false; break; }
      }
      if (ok) for (const c of map.circles) if (Math.hypot(c.x - x, c.y - y) < c.r + pad) { ok = false; break; }
      // Les pieds de rampe ne sont pas des rues.
      if (ok) for (const s of map.structs) for (const p of s.parts) if (p.ramp && x > p.x - 4 && x < p.x + p.w + 4 && y > p.y - 4 && y < p.y + p.h + 4) ok = false;
      valid[i + j * GN] = ok ? 1 : 0;
    }
  }
  const nearest = (x, y) => {
    const ci = Math.max(0, Math.min(GN - 1, Math.floor(x / CELL))), cj = Math.max(0, Math.min(GN - 1, Math.floor(y / CELL)));
    for (let r = 0; r < 12; r++) {
      let best = -1, bd = Infinity;
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= GN || j >= GN || !valid[i + j * GN]) continue;
          const d = Math.hypot(i * CELL + CELL / 2 - x, j * CELL + CELL / 2 - y);
          if (d < bd) { bd = d; best = i + j * GN; }
        }
      }
      if (best >= 0) return best;
    }
    return 0;
  };
  // Nœuds supplémentaires : le dessus des ouvrages.
  const extra = [];            // { x, y, st }
  const links = new Map();     // nœud -> voisins hors grille
  const link = (a, b) => { for (const [u, v] of [[a, b], [b, a]]) { if (!links.has(u)) links.set(u, []); links.get(u).push(v); } };
  for (const s of map.structs) {
    s.nodes = [];
    const last = s.path.length - 1;
    let prev = -1;
    s.path.forEach((p, k) => {
      let id;
      if (k === 0 || (k === last && !s.deadEnd)) { id = nearest(p[0], p[1]); (s.aprons || (s.aprons = [])).push({ node: id, x: p[0], y: p[1], next: k === 0 ? 1 : last - 1 }); }
      else { id = N + extra.length; extra.push({ x: p[0], y: p[1], st: s.id }); s.nodes.push(id); }
      if (prev >= 0) link(prev, id);
      prev = id;
    });
    // Indice du nœud d'entrée correspondant à chaque accès.
    for (const a of s.aprons) a.entry = a.next === 1 ? s.nodes[0] : s.nodes[s.nodes.length - 1];
  }
  const total = N + extra.length;
  const pos = n => (n < N ? { x: (n % GN) * CELL + CELL / 2, y: Math.floor(n / GN) * CELL + CELL / 2, st: -1 } : extra[n - N]);

  // Distances (en pas) de tous les nœuds vers un ensemble de sources.
  const queue = new Int32Array(total);
  const field = sources => {
    const dist = new Int16Array(total).fill(30000);
    let head = 0, tail = 0;
    for (const s of sources) if (dist[s] !== 0) { dist[s] = 0; queue[tail++] = s; }
    while (head < tail) {
      const n = queue[head++], d = dist[n] + 1;
      if (n < N) {
        const i = n % GN, j = (n - i) / GN;
        if (i > 0 && valid[n - 1] && dist[n - 1] > d) { dist[n - 1] = d; queue[tail++] = n - 1; }
        if (i < GN - 1 && valid[n + 1] && dist[n + 1] > d) { dist[n + 1] = d; queue[tail++] = n + 1; }
        if (j > 0 && valid[n - GN] && dist[n - GN] > d) { dist[n - GN] = d; queue[tail++] = n - GN; }
        if (j < GN - 1 && valid[n + GN] && dist[n + GN] > d) { dist[n + GN] = d; queue[tail++] = n + GN; }
      }
      const l = links.get(n);
      if (l) for (const m of l) if (dist[m] > d + 2) { dist[m] = d + 2; queue[tail++] = m; }
    }
    return dist;
  };

  // Les poches fermées (jardins clos, recoins) ne font pas partie du réseau.
  const reach = field([nearest(1140, 372)]);
  for (let n = 0; n < N; n++) if (valid[n] && reach[n] >= 30000) valid[n] = 0;

  // Descend un champ de distances de quelques pas : où mène le chemin après ce nœud ?
  const descend = (dist, n, steps) => {
    for (let k = 0; k < steps && n < N; k++) {
      const i = n % GN, j = (n - i) / GN;
      let best = n, bd = dist[n];
      if (i > 0 && valid[n - 1] && dist[n - 1] < bd) { bd = dist[n - 1]; best = n - 1; }
      if (i < GN - 1 && valid[n + 1] && dist[n + 1] < bd) { bd = dist[n + 1]; best = n + 1; }
      if (j > 0 && valid[n - GN] && dist[n - GN] < bd) { bd = dist[n - GN]; best = n - GN; }
      if (j < GN - 1 && valid[n + GN] && dist[n + GN] < bd) { bd = dist[n + GN]; best = n + GN; }
      if (best === n) break;
      n = best;
    }
    return n;
  };

  // Emplacements des sacs : un semis régulier de cases libres, plus un sac sur chaque ouvrage.
  const rand = rng(77);
  const spots = [];
  for (let n = 0; n < 4000 && spots.length < 90; n++) {
    const k = Math.floor(rand() * N);
    if (!valid[k]) continue;
    const p = pos(k);
    if (spots.some(s => Math.hypot(s.x - p.x, s.y - p.y) < 130)) continue;
    spots.push({ x: p.x, y: p.y, st: -1 });
  }
  spots.push({ x: 1140, y: 985, st: 0 }, { x: 1160, y: 1540, st: 1 }, { x: 1760, y: 790, st: 2 });
  map.bagSpots = spots;
  map.nav = { valid, extra, links, total, grid: N, pos, nearest, field, descend };
  return map.nav;
}
