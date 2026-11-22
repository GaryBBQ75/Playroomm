// Carte de la Course-poursuite : une île aux chaussées très larges et aux grands espaces
// ouverts (parkings, places, quais), avec peu d'obstacles pleins : gros bâtiments, murs,
// eau, voitures garées. Tout le petit décor (arbres, lampadaires, plots, bancs…) est
// traversable : il vole en éclats côté client sans arrêter les voitures.
// Trois ouvrages sur lesquels on monte : pont sur le canal, voie surélevée, parking à étage.
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

// Pâtés : [x0, y0, x1, y1, type]. L'asphalte, c'est tout ce qui reste entre eux
// (rues de 100 à 240 de large, soit 4 à 10 largeurs de voiture).
const BLOCKS = [
  // Nord-ouest : quelques maisons, un grand parking
  [90, 90, 600, 390, 'houses'], [90, 540, 600, 850, 'parking'],
  // Centre-ville autour du grand carrefour : trois gros pâtés, une place
  [800, 90, 1040, 330, 'town'], [1240, 90, 1480, 330, 'plaza'],
  [800, 440, 960, 600, 'town'], [1320, 440, 1480, 600, 'town'],
  [800, 700, 1020, 850, 'town'], [1260, 700, 1480, 850, 'town'],
  // Nord-est : parking, station-service
  [1640, 90, 1910, 360, 'parking'], [1640, 450, 1910, 570, 'gas'],
  // Sud : parc et lac, plage, zone industrielle, port
  [90, 1130, 620, 1500, 'park'], [90, 1640, 620, 1910, 'beach'],
  [800, 1130, 1020, 1400, 'depot'], [1260, 1130, 1480, 1400, 'containers'],
  [800, 1680, 1020, 1910, 'depot'], [1260, 1680, 1480, 1910, 'tanks'],
  [1640, 1130, 1910, 1910, 'port'],
];

// Eau : le canal (franchi par deux ponts plats et le grand pont) et le bassin du port.
const WATER = [[200, 950, 620, 1030], [800, 950, 1480, 1030], [1640, 950, 1800, 1030], [1760, 1450, 2000, 1620]];

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
    solid: [[1650, 710, 1910, 860], [1850, 640, 1910, 710]],
    parts: [{ x: 1650, y: 640, w: 200, h: 70, ramp: 'E', open: 'ew' }, { x: 1850, y: 640, w: 60, h: 70, open: 'ws' }, { x: 1650, y: 710, w: 260, h: 150, open: 'n' }],
    path: [[1620, 675], [1700, 675], [1790, 675], [1880, 685], [1872, 760], [1780, 790], [1700, 790]],
    deadEnd: true,
  },
];

// Boucles de circulation des voitures civiles.
const LOOPS = [
  [[45, 45], [1955, 45], [1955, 1400], [1700, 1400], [1700, 1665], [1955, 1665], [1955, 1955], [45, 1955]],
  [[710, 385], [1560, 385], [1560, 645], [710, 645]],
  [[710, 900], [710, 1080], [1560, 1080], [1560, 900]],
  [[710, 1450], [1560, 1450], [1560, 1630], [710, 1630]],
];
const NPCS = [[0, 0], [0, 3], [0, 6], [1, 0], [1, 2], [2, 1], [3, 0]]; // [boucle, point de départ]

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
  const rand = rng(20261124);
  const rects = [];     // obstacles pleins au sol : { x, y, w, h }
  const circles = [];   // obstacles ronds au sol : { x, y, r }
  const items = [];     // décor fixe dessiné par le client
  const props = [];     // petit décor cassable, sans collision : { x, y, k, … }
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
  const round = (x, y, r, item) => {
    if (!free(x - r, y - r, 2 * r, 2 * r)) return false;
    circles.push({ x, y, r });
    if (item) items.push({ x, y, r, ...item });
    return true;
  };
  // Petit décor : jamais dans un obstacle plein, mais il peut déborder sur la chaussée.
  const prop = (x, y, k, extra) => {
    if (rects.some(o => x > o.x - 6 && x < o.x + o.w + 6 && y > o.y - 6 && y < o.y + o.h + 6)) return;
    if (circles.some(o => Math.hypot(o.x - x, o.y - y) < o.r + 6)) return;
    props.push({ x: Math.round(x), y: Math.round(y), k, ...extra });
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
  // Piles (sans collision : on passe librement sous les tabliers).
  for (const [x, y] of [[1030, 1508], [1030, 1572], [1290, 1508], [1290, 1572], [1103, 955], [1177, 955], [1103, 1025], [1177, 1025]]) items.push({ t: 'pillar', x, y, r: 7 });
  // Toit du parking : muret au-dessus de la rampe, quelques voitures garées.
  structs[2].obs.push({ x: 1650, y: 706, w: 200, h: 8 });
  for (const [x, y] of [[1680, 835], [1760, 835], [1880, 835], [1680, 738]]) {
    structs[2].obs.push({ x: x - 12, y: y - 22, w: 24, h: 44 });
    items.push({ t: 'car', cx: x, cy: y, a: Math.PI / 2, m: pick(6), c: pick(8), z: DECK_Z });
  }

  // ----- Grand carrefour : un terre-plein franchissable, des arbres cassables -----
  items.push({ t: 'island', x: 1140, y: 520, r: 60 });
  for (let k = 0; k < 6; k++) prop(1140 + Math.cos(k * 1.047) * 38, 520 + Math.sin(k * 1.047) * 38, 'tree', { s: 0.9 });
  items.push({ t: 'median', x: 1128, y: 100, w: 24, h: 210 });
  for (let y = 115; y <= 300; y += 46) prop(1140, y, 'tree', { s: 0.95 });
  // Chantier sur le boulevard sud : barrières et plots qui volent, un baril qui saute.
  for (const [x, y] of [[1050, 1745], [1050, 1800]]) prop(x + 22, y, 'barrier');
  for (const [x, y] of [[1100, 1740], [1104, 1772], [1100, 1806], [1056, 1772]]) prop(x, y, 'cone');
  barrels.push({ x: 1075, y: 1773, r: 7, kind: 'barrel' });

  // ----- Remplissage des pâtés -----
  const fill = {
    town(x0, y0, x1, y1) {
      // Pâté plein (trottoir) portant un à trois gros immeubles.
      rects.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'walk' });
      const m = 16, w = x1 - x0 - 2 * m, h = y1 - y0 - 2 * m;
      const cut = 0.4 + rand() * 0.2, kind = pick(3);
      const lots = kind === 0 ? [[0, 0, 1, 1]] : w > h ? [[0, 0, cut, 1], [cut, 0, 1, 1]] : [[0, 0, 1, cut], [0, cut, 1, 1]];
      for (const l of lots) items.push({ t: 'bld', x: x0 + m + l[0] * w + 2, y: y0 + m + l[1] * h + 2, w: (l[2] - l[0]) * w - 4, h: (l[3] - l[1]) * h - 4, f: 2 + pick(5), c: pick(5), r: pick(3) });
      for (let x = x0 + 30; x < x1 - 20; x += 70) { items.push({ t: 'deco', k: 'lamp', x, y: y0 + 7 }); items.push({ t: 'deco', k: 'tree', x: x + 34, y: y1 - 8, s: 0.6 }); }
    },
    houses(x0, y0, x1, y1) {
      // Quelques grandes maisons bien espacées sur une pelouse : on roule entre elles.
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'lawn' });
      for (const [dx, dy] of [[50, 50], [230, 44], [400, 56], [120, 190], [320, 196]]) {
        const w = 80 + pick(20), h = 62 + pick(14);
        solid(x0 + dx, y0 + dy, w, h, { t: 'house', c: pick(5), rc: pick(3), ax: 0 });
      }
      for (let n = 0; n < 16; n++) prop(x0 + 20 + rand() * (x1 - x0 - 40), y0 + 20 + rand() * (y1 - y0 - 40), n % 4 === 3 ? 'bush' : 'tree', { s: 0.85 + rand() * 0.4 });
      for (const dx of [20, 260, 490]) prop(x0 + dx, y1 - 10, 'lamp');
    },
    plaza(x0, y0, x1, y1) {
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'plaza' });
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      round(cx, cy, 30, { t: 'fountain' });
      for (const [dx, dy] of [[-90, -80], [90, -80], [-90, 80], [90, 80], [-95, 0], [95, 0]]) prop(cx + dx, cy + dy, 'tree', { s: 1 });
      for (const [dx, dy] of [[-52, 0], [52, 0], [0, -55], [0, 55]]) prop(cx + dx, cy + dy, 'bench');
      for (const dx of [-100, 100]) { prop(cx + dx, y1 - 10, 'lamp'); prop(cx + dx, y0 + 10, 'lamp'); }
    },
    parking(x0, y0, x1, y1) {
      // Grand parking ouvert : places marquées, peu de voitures, lampadaires cassables.
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'lot' });
      const rows = [[y0 + 16, 1], [y0 + 150, -1], [y0 + 196, 1]];
      for (const [ry, dir] of rows) {
        items.push({ t: 'paint', x: x0 + 24, y: dir > 0 ? ry - 1 : ry + 44, w: Math.floor((x1 - x0 - 48) / 30) * 30, h: 3 });
        for (let x = x0 + 24; x <= x1 - 24; x += 30) {
          items.push({ t: 'paint', x: x - 1, y: ry, w: 3, h: 45 });
          if (x < x1 - 54 && rand() < 0.22) parked(x + 15, ry + 23, dir > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
      }
      for (const x of [x0 + 12, (x0 + x1) / 2, x1 - 12]) { prop(x, y0 + 196, 'lamp'); prop(x, y1 - 12, 'lamp'); }
      prop(x0 + 150, y1 - 30, 'barrier'); prop(x1 - 30, y1 - 30, 'cone'); prop(x1 - 46, y1 - 22, 'cone');
    },
    gas(x0, y0, x1, y1) {
      // Station-service : auvent, pompes explosives, boutique.
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'plaza' });
      const cx = x0 + 100, cy = y0 + 60;
      items.push({ t: 'canopy', x: cx - 75, y: cy - 40, w: 150, h: 80 });
      for (const [dx, dy] of [[-68, -33], [68, -33], [-68, 33], [68, 33]]) items.push({ t: 'pillar', x: cx + dx, y: cy + dy, r: 4, low: 1 });
      for (const dx of [-36, 0, 36]) barrels.push({ x: cx + dx, y: cy, r: 9, kind: 'pump' });
      solid(x1 - 86, y0 + 18, 70, 84, { t: 'shop' });
      prop(x0 + 14, y1 - 12, 'sign'); prop(x0 + 190, y1 - 12, 'lamp');
      barrels.push({ x: x1 - 100, y: y0 + 40, r: 7, kind: 'gas' }, { x: x1 - 100, y: y0 + 58, r: 7, kind: 'gas' });
    },
    park(x0, y0, x1, y1) {
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'lawn' });
      // Lac (deux cercles qui se chevauchent)
      for (const [x, y, r] of [[300, 1330, 90], [385, 1375, 62]]) { circles.push({ x, y, r }); items.push({ t: 'lake', x, y, r }); }
      // Allée courbe qui traverse le parc
      for (let k = 0; k < 16; k++) {
        const a0 = Math.PI * (1 + k / 16 * 0.5), a1 = Math.PI * (1 + (k + 1) / 16 * 0.5);
        items.push({ t: 'path', x0: 620 + Math.cos(a0) * 480, y0: 1540 + Math.sin(a0) * 400, x1: 620 + Math.cos(a1) * 480, y1: 1540 + Math.sin(a1) * 400, w: 50 });
      }
      for (let n = 0; n < 60; n++) prop(x0 + 18 + rand() * (x1 - x0 - 36), y0 + 18 + rand() * (y1 - y0 - 36), n % 5 === 4 ? 'bush' : 'tree', { s: 0.9 + rand() * 0.6 });
      for (const [x, y] of [[190, 1215], [430, 1255], [500, 1440]]) { prop(x, y, 'bench'); prop(x + 30, y, 'lamp'); }
    },
    beach(x0, y0, x1, y1) {
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'sand' });
      for (const dx of [40, 220, 400]) solid(x0 + dx, y0 + 30, 90, 60, { t: 'house', c: pick(5), rc: pick(3), bw: 1 });
      for (let x = x0 + 30; x < x1 - 20; x += 66) prop(x, y0 + 140 + (x % 3) * 8, 'palm', { s: 1.1 });
      for (let x = x0 + 50; x < x1 - 30; x += 80) prop(x + rand() * 20, y1 - 50 + rand() * 24, 'parasol', { c: pick(4) });
    },
    depot(x0, y0, x1, y1) {
      // Un grand entrepôt, une cuve, des caisses qui volent et des barils qui sautent
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'concrete' });
      const w = x1 - x0, h = y1 - y0;
      solid(x0 + 20, y0 + 20, w - 90, Math.round(h * 0.5), { t: 'ware', c: pick(4), ax: 0 });
      round(x1 - 36, y0 + 50, 22, { t: 'tank' });
      for (let n = 0; n < 6; n++) prop(x0 + 24 + rand() * (w - 48), y0 + h * 0.62 + rand() * h * 0.3, 'crate');
      for (let n = 0; n < 4; n++) barrel(x0 + 22 + rand() * (w - 44), y0 + h * 0.62 + rand() * h * 0.3, n % 3 === 2 ? 'gas' : 'barrel');
      prop(x0 + 10, y1 - 12, 'lamp'); prop(x1 - 10, y1 - 12, 'lamp');
    },
    containers(x0, y0, x1, y1) {
      // Quelques piles de conteneurs bien espacées, un portique
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'concrete' });
      for (const [dx, dy] of [[20, 24], [130, 24], [20, 120], [130, 150]]) solid(x0 + dx, y0 + dy, 62, 26, { t: 'cont', n: 1 + pick(3), c: pick(8) });
      items.push({ t: 'crane', x: x0 + 30, y: y1 - 80, w: 160, h: 60 });
      barrel(x1 - 24, y0 + 90); barrel(x1 - 26, y0 + 106); barrel(x0 + 14, y1 - 100, 'gas');
      for (let n = 0; n < 4; n++) prop(x0 + 30 + rand() * 160, y0 + 200 + rand() * 30, 'crate');
    },
    tanks(x0, y0, x1, y1) {
      // Dépôt de carburant : trois grandes cuves, des barils
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'concrete' });
      for (const [dx, dy, r] of [[60, 62, 40], [164, 150, 42], [60, 180, 32]]) round(x0 + dx, y0 + dy, r, { t: 'tank', big: 1 });
      for (const [dx, dy] of [[124, 60], [138, 66], [126, 78], [110, 196], [200, 40]]) barrel(x0 + dx, y0 + dy, dx % 3 ? 'barrel' : 'gas');
      prop(x1 - 10, y1 - 12, 'lamp');
    },
    port(x0, y0, x1, y1) {
      // Port : hangar, conteneurs, grue de quai, cargo dans le bassin
      items.push({ t: 'ground', x: x0, y: y0, w: x1 - x0, h: y1 - y0, g: 'concrete' });
      solid(x0 + 110, y0 + 30, 140, 100, { t: 'ware', c: 1, ax: 1 });
      for (const [dx, dy] of [[150, 190], [150, 232], [30, 620], [104, 620], [30, 700], [180, 700]]) solid(x0 + dx, y0 + dy, 62, 26, { t: 'cont', n: 1 + pick(3), c: pick(8) });
      items.push({ t: 'crane', x: 1790, y: 1300, w: 110, h: 60, quay: 1 });
      items.push({ t: 'ship', x: 1790, y: 1480, w: 200, h: 80 });
      for (const [dx, dy] of [[130, 150], [146, 156], [240, 640], [226, 652]]) barrel(x0 + dx, y0 + dy, dy % 4 ? 'barrel' : 'gas');
      for (let n = 0; n < 5; n++) prop(x0 + 120 + rand() * 130, y0 + 560 + rand() * 40, 'crate');
      for (const [dx, dy] of [[100, 420], [250, 560]]) prop(x0 + dx, y0 + dy, 'lamp');
    },
  };
  for (const [x0, y0, x1, y1, type] of BLOCKS) fill[type](x0, y0, x1, y1);

  // ----- Peinture au sol : pointillés des grandes rues, passages piétons, lignes d'arrêt -----
  const dash = (x0, y0, x1, y1) => items.push({ t: 'dash', x0, y0, x1, y1 });
  dash(710, 100, 710, 840); dash(710, 1140, 710, 1900); dash(1560, 100, 1560, 840); dash(1560, 1140, 1560, 1390);
  dash(210, 900, 600, 900); dash(810, 900, 1470, 900); dash(210, 1080, 600, 1080); dash(810, 1080, 1470, 1080);
  dash(100, 45, 1900, 45); dash(100, 1955, 1900, 1955); dash(45, 100, 45, 1900); dash(1955, 100, 1955, 1390);
  dash(810, 385, 1470, 385); dash(810, 1450, 1470, 1450); dash(810, 1630, 1470, 1630); dash(1140, 1340, 1140, 1490); dash(1140, 1590, 1140, 1900);
  dash(100, 465, 590, 465); dash(100, 1570, 610, 1570);
  for (const [x, y, w, h, hz] of [[630, 400, 160, 18, 1], [630, 860, 160, 18, 1], [1490, 400, 140, 18, 1], [1490, 860, 140, 18, 1], [1050, 340, 180, 18, 1], [770, 345, 18, 84, 0], [1492, 610, 18, 80, 0], [630, 1108, 160, 18, 1], [1490, 1108, 140, 18, 1], [1232, 1410, 18, 80, 0], [610, 410, 18, 110, 0]]) items.push({ t: 'zebra', x, y, w, h, hz });
  // Garde-corps des deux ponts plats
  for (const x of [620, 800, 1480, 1640]) items.push({ t: 'rail', x: x - 2, y: 946, w: 4, h: 88 });
  // Lampadaires et feux le long des grandes rues : tout se renverse.
  for (let v = 150; v < 1900; v += 160) { prop(v, 8, 'lamp'); prop(v, 1992, 'lamp'); prop(8, v, 'lamp'); if (v < 1430 || v > 1640) prop(1992, v, 'lamp'); }
  for (let x = 240; x < 1800; x += 130) { prop(x, 942, 'lamp'); prop(x + 60, 1038, 'lamp'); }
  for (const [x, y] of [[626, 396], [794, 434], [626, 606], [794, 694], [1486, 336], [1634, 434], [1486, 606], [1634, 576], [1046, 336], [1234, 336], [1026, 694], [1254, 694], [626, 1124], [794, 1124]]) prop(x, y, 'light');

  // Rectangles qui bouchent la vue des bots : obstacles pleins + gros obstacles ronds.
  const sight = rects.filter(r => r.w > 12 || r.h > 12);
  for (const c of circles) if (c.r >= 18) sight.push({ x: c.x - c.r * 0.75, y: c.y - c.r * 0.75, w: c.r * 1.5, h: c.r * 1.5 });

  cache = {
    size: SIZE, rects, circles, items, props, barrels, structs, sight,
    loops: LOOPS, npcs: NPCS, blocks: BLOCKS,
    fugSpawns: [[1140, 385, 0], [1025, 520, Math.PI / 2], [1262, 520, -Math.PI / 2], [1140, 640, Math.PI]],
    copSpawns: [[45, 45], [1955, 45], [45, 1955], [1955, 1955], [45, 1000], [1140, 45], [1140, 1955], [1955, 1000], [710, 200], [1560, 1250], [710, 1800], [350, 1570]],
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
  const reach = field([nearest(1140, 385)]);
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
  spots.push({ x: 1140, y: 985, st: 0 }, { x: 1160, y: 1540, st: 1 }, { x: 1790, y: 790, st: 2 });
  map.bagSpots = spots;
  map.nav = { valid, extra, links, total, grid: N, pos, nearest, field, descend };
  return map.nav;
}
