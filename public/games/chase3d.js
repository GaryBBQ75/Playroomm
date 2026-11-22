// Rendu 3D de la Course-poursuite (Three.js) : une ville vue de dessus, low-poly en aplats,
// aux couleurs rétro un peu passées, avec des voitures typées années 60-70.
// Le module gère son propre canvas WebGL, posé juste derrière le HUD : création paresseuse
// au premier dessin, nettoyage complet dans unmount(). Three.js n'est chargé qu'à ce moment-là.
import { sound } from '../lib/fx.js';
import { getMap, rng, SIZE, DECK_Z } from '../engine/games/chasemap.js';

// Indique à app.js que ce jeu n'utilise pas le canvas 2D commun.
export const ownCanvas = true;

const U = 0.1;                 // 1 unité serveur = 0,1 unité 3D
const WORLD = SIZE * U;
const FLOOR_H = 2.6;
const DECK = DECK_Z * U;
const MAX_CARS = 8;
const CAR_SCALE = 1.15;        // voitures un peu grossies pour la lisibilité
const PITCH_ANGLE = 1.1;       // caméra très plongeante (environ 63°)
const FOV = 30;                // focale longue : perspective douce, presque isométrique
const SHADOW_EXT = 64;
const CHUNKS = 5;              // la ville est découpée en 5 x 5 morceaux, masqués hors champ

// Palette rétro : crème, vert d'eau, moutarde, rouille, bleu pétrole, rouge cerise délavé.
const V = ['#efe6d0', '#a9d3c2', '#d9a441', '#b5543a', '#2f6f7e', '#c2534f', '#8a9a6c', '#e6c39a'];
const PAL = {
  sky: '#efe4cb', asphalt: '#9a9287', lot: '#8d867c', line: '#e9dfc6', walk: '#d9cfba', kerb: '#c2b8a3',
  grass: '#a9bd8b', sand: '#e3d3a4', concrete: '#c7beae', plaza: '#dccfb0', path: '#dccb9c',
  water: '#7fbfb9', waterLight: '#9ad0ca', sea: '#74b8b3',
  walls: ['#e9dfc8', '#d8b98a', '#c98a6b', '#b9cdbd', '#8fa7a5', '#e6c39a', '#b5654a'],
  roofs: ['#b5543a', '#6f7f86', '#8a6a52', '#7d8f6a'],
  tree: ['#7fa277', '#93b584', '#6d9a7a'], palm: '#86b07a', trunk: '#8f7358', hedge: '#6f9068',
  dark: '#2f3142', glass: '#44535f', white: '#f6f1e4', tyre: '#2a2b38', chrome: '#d6d2c8', wood: '#a9794f',
  red: '#d8434a', blue: '#3b7df0', smoke: '#f4eee0', soot: '#3a3632', dust: '#cdbb92', bill: '#58b97f',
  gold: '#f0c04f', flame: '#f58a3c', steel: '#8b8f93',
};

let THREE = null;
let loading = null;
let G = null;                  // tout l'état graphique (null tant que rien n'est monté)
let L = { w: 0, h: 0, portrait: true };
let savedQuality = 0;          // niveau de qualité trouvé lors de la partie précédente
const pending = [];            // événements reçus avant la fin du chargement

// ---------- Interface attendue par app.js ----------

// Charge Three.js en avance (appelé pendant l'écran de présentation du jeu).
export function preload() {
  if (!loading) loading = import('three').then(m => { THREE = m; }).catch(err => { console.error('Three.js introuvable', err); loading = null; });
  return loading;
}

export function layout(w, h, portrait) {
  L = { w, h, portrait };
  if (G && !G.failed) applySize();
}

export function draw(ctx, view, now) {
  if (!THREE) { preload(); return; }
  if (!G) init(ctx.canvas);
  if (G.failed) return;
  render(view, now);
}

export function unmount() {
  pending.length = 0;
  if (!G) return;
  const g = G;
  G = null;
  g.ui?.remove();
  g.fail?.remove();
  if (g.failed) return;
  g.canvas.removeEventListener('webglcontextlost', onContextLost);
  g.scene.traverse(o => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) m.dispose();
  });
  g.bagGeo.dispose(); g.mat.dispose(); g.burnt.dispose();
  for (const geo of g.carGeos.values()) geo.dispose();
  g.renderer.dispose();
  g.renderer.forceContextLoss();
  g.canvas.remove();
}

export function hud(view) {
  const s = view.cur;
  if (!s || !s.cars) return { center: '' };
  const mine = s.cars.find(c => c.id === view.me);
  const role = !mine ? '👀 Spectateur' : s.fug === view.me ? '💰 Tu es le fugitif' : mine.dd ? '💥 Voiture détruite…' : '🚨 Tu es flic';
  const chip = t => `<span class="chip" style="padding:3px 10px">${t}</span>`;
  return {
    center: `${s.timer}s`,
    left: chip(`Manche ${s.round}/${s.rounds}`) + chip(role) + chip(`Butin : ${s.fs} pts`),
  };
}

export function cooldowns(view) {
  const c = view.cur?.cars?.find(x => x.id === view.me);
  return [c ? c.cd : 0, 0];
}

// Gerbe de petits cubes autour d'un point.
function burst(x, y, z, n, color, { speed = 8, up = 7, size = 0.5, life = 0.8, flat = false } = {}) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, s = speed * (0.35 + Math.random() * 0.65), k = size * (0.6 + Math.random() * 0.8);
    G.cubes.add({
      x, y, z, vx: Math.cos(a) * s, vy: up * (0.5 + Math.random() * 0.7), vz: Math.sin(a) * s,
      sx: flat ? k * 1.8 : k, sy: flat ? k * 0.14 : k, sz: k, life: life * (0.7 + Math.random() * 0.5),
      grav: 20, spin: 4 + Math.random() * 8, color: Array.isArray(color) ? color[i % color.length] : color, floor: y > 2 ? y - 1.4 : 0.15,
    });
  }
}

// Explosion : boule de feu en gros cubes, fumée noire qui monte, débris. Si plusieurs
// explosions se suivent de près, les suivantes sont allégées.
function explode(x, y, z, big) {
  const recent = G.booms.filter(t => G.time - t < 0.5).length;
  G.booms = G.booms.filter(t => G.time - t < 0.5);
  G.booms.push(G.time);
  const k = (recent > 2 ? 0.45 : 1) * (big ? 1.4 : 1);
  for (let i = 0; i < 16 * k; i++) {
    const a = Math.random() * 6.283, s = 3 + Math.random() * 8, sz = (1 + Math.random() * 1.5) * (big ? 1.3 : 1);
    G.lights.add({ x, y: y + 0.8, z, vx: Math.cos(a) * s, vy: 3 + Math.random() * 7, vz: Math.sin(a) * s, sx: sz, sy: sz, sz, grow: 0.9, life: 0.35 + Math.random() * 0.3, spin: 3, drag: 3, color: [PAL.flame, PAL.gold, '#fff0b8', PAL.red][i % 4] });
  }
  for (let i = 0; i < 12 * k; i++) {
    const a = Math.random() * 6.283, s = 1 + Math.random() * 3, sz = 1 + Math.random() * 1.2;
    G.cubes.add({ x: x + Math.cos(a) * 1.2, y: y + 1.5, z: z + Math.sin(a) * 1.2, vx: Math.cos(a) * s, vy: 4 + Math.random() * 5, vz: Math.sin(a) * s, sx: sz, sy: sz, sz, grow: 1.6, life: 1.4 + Math.random() * 1.2, spin: 1.5, drag: 1, color: i % 3 ? PAL.soot : '#5a544d' });
  }
  burst(x, y + 1, z, Math.round(14 * k), [PAL.dark, PAL.steel, PAL.flame, PAL.soot], { speed: 14, up: 12, size: 0.6, life: 1.3 });
  G.shake = Math.max(G.shake, big ? 1.5 : 1.2);
  flash('#ffb561', 0.35);
  sound.play('boom');
}

export function onEvent(ev, view) {
  if (!G || G.failed) { if (pending.length < 20) pending.push(ev); return; }
  const me = view.me;
  const x = (ev.x || 0) * U, z = (ev.y || 0) * U, y = (ev.h || 0) * U;
  switch (ev.t) {
    case 'round':
      G.marks.reset();
      G.zoom = 1.5;
      G.snapCam = true;
      break;
    case 'go':
      sound.play('play');
      break;
    case 'turbo': {
      const c = G.cars.get(ev.id);
      if (c) for (let i = 0; i < 10; i++) flame(c, 1.6);
      if (ev.id === me) { sound.play('dash'); G.shake = Math.max(G.shake, 0.25); }
      break;
    }
    case 'bump':
      burst(x, y + 1.4, z, 8 + Math.round(ev.f * 8), [PAL.white, PAL.gold, PAL.dark], { speed: 9, size: 0.45 });
      G.shake = Math.max(G.shake, 0.25 + ev.f * 0.5);
      sound.play('bump');
      break;
    case 'crash':
      // Choc contre un mur : débris et secousse, mais pas de vibration du téléphone.
      burst(x, y + 0.6, z, 7, [PAL.dust, PAL.white, PAL.steel], { speed: 6, up: 5, size: 0.42, life: 0.6 });
      if (ev.id === me) { G.shake = Math.max(G.shake, 0.25 + ev.f * 0.45); sound.play('hit'); }
      break;
    case 'boom':
      explode(x, y, z, !!ev.big);
      break;
    case 'toss':
      burst(x, 1.2, z, 10, [PAL.white, PAL.steel, PAL.dark], { speed: 10, up: 9, size: 0.45 });
      G.shake = Math.max(G.shake, 0.5);
      sound.play('bump');
      break;
    case 'cash':
      burst(x, y + 1.5, z, 22, [PAL.bill, PAL.bill, PAL.white], { speed: 7, up: 11, size: 0.55, life: 1.1, flat: true });
      floatText(x, y + 2.5, z, '+2', '#fff');
      sound.play('cash');
      break;
    case 'bust':
      burst(x, y + 1.6, z, 30, [PAL.white, PAL.red, PAL.blue, PAL.gold], { speed: 12, up: 9, size: 0.6, life: 1 });
      stamp('Arrêté !', 'bust');
      flash('#fff', 0.7);
      G.shake = 1;
      G.zoom = 0.78;
      G.focus = ev.id;
      sound.play('siren');
      navigator.vibrate?.(ev.id === me || ev.by === me ? [120, 60, 200] : 60); // seule vibration du jeu
      break;
    case 'escape':
      stamp('Échappé !', 'escape');
      sound.play('win');
      break;
    default:
  }
}

// ---------- Petits outils ----------
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const colCache = new Map();
function col(hex) {
  let c = colCache.get(hex);
  if (!c) { c = new THREE.Color(hex); colCache.set(hex, c); }
  return c;
}
function mix(a, b, t) { return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString(); }
function mat4(x, y, z, sx = 1, sy = sx, sz = sx, ry = 0) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));
}

// Assemble beaucoup de petites formes en une seule géométrie (un seul appel de dessin).
// Les couleurs sont portées par les sommets : aucun besoin de texture.
class Geo {
  constructor() { this.p = []; this.c = []; }

  // Volume à 8 sommets : 0-3 forment une face, 4-7 la face opposée (même ordre que box).
  hull(P, color, topCol = null) {
    const quad = (a, b, c, d, k) => {
      for (const i of [a, b, c, a, c, d]) { this.p.push(P[i][0], P[i][1], P[i][2]); this.c.push(k.r, k.g, k.b); }
    };
    quad(3, 7, 6, 2, topCol || color); // dessus
    quad(4, 5, 6, 7, color);
    quad(1, 0, 3, 2, color);
    quad(5, 1, 2, 6, color);
    quad(0, 4, 7, 3, color);
  }

  // Pavé aligné sur les axes. `topCol` permet un dessus d'une autre teinte.
  box(x0, y0, z0, x1, y1, z1, color, topCol = null) {
    this.hull([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color, topCol);
  }

  // Tronc de pyramide centré sur z = 0 (carrosseries) : base [bx0, bx1] x [-bz, bz], dessus [tx0, tx1] x [-tz, tz].
  frustum(bx0, bx1, bz, y0, tx0, tx1, tz, y1, color, topCol = null) {
    this.hull([[bx0, y0, -bz], [bx1, y0, -bz], [tx1, y1, -tz], [tx0, y1, -tz], [bx0, y0, bz], [bx1, y0, bz], [tx1, y1, tz], [tx0, y1, tz]], color, topCol);
  }

  // Toit à deux pans sur le rectangle (x0, z0)-(x1, z1), faîtage le long de x (ax = 0) ou de z.
  gable(x0, z0, x1, z1, y0, y1, ax, color) {
    const e = 0.02;
    if (ax === 0) { const m = (z0 + z1) / 2; this.hull([[x0, y0, z0], [x1, y0, z0], [x1, y1, m - e], [x0, y1, m - e], [x0, y0, z1], [x1, y0, z1], [x1, y1, m + e], [x0, y1, m + e]], color); }
    else { const m = (x0 + x1) / 2; this.hull([[x0, y0, z0], [x1, y0, z0], [m + e, y1, z0], [m - e, y1, z0], [x0, y0, z1], [x1, y0, z1], [m + e, y1, z1], [m - e, y1, z1]], color); }
  }

  // Bande posée au sol entre deux points (allées, marquages obliques).
  strip(x0, z0, x1, z1, w, y, color) {
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = -dz / l * w / 2, nz = dx / l * w / 2;
    const P = [[x0 - nx, y, z0 - nz], [x1 - nx, y, z1 - nz], [x1 + nx, y, z1 + nz], [x0 + nx, y, z0 + nz]];
    const flip = (P[1][2] - P[0][2]) * (P[2][0] - P[0][0]) - (P[1][0] - P[0][0]) * (P[2][2] - P[0][2]) < 0;
    for (const i of flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]) { this.p.push(P[i][0], P[i][1], P[i][2]); this.c.push(color.r, color.g, color.b); }
  }

  // Ajoute une géométrie Three.js quelconque, transformée par `m`.
  add(geom, m, color) {
    const g = geom.index ? geom.toNonIndexed() : geom;
    const pos = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.p.push(v.x, v.y, v.z);
      this.c.push(color.r, color.g, color.b);
    }
    if (g !== geom) g.dispose();
    geom.dispose();
  }

  // Recopie une autre Geo, transformée (voitures garées).
  append(other, m) {
    const v = new THREE.Vector3();
    for (let i = 0; i < other.p.length; i += 3) {
      v.set(other.p[i], other.p[i + 1], other.p[i + 2]).applyMatrix4(m);
      this.p.push(v.x, v.y, v.z);
    }
    for (const c of other.c) this.c.push(c);
  }

  // Les normales par face donnent le rendu en aplats.
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const cyl = (r0, r1, h, n = 8) => new THREE.CylinderGeometry(r0, r1, h, n);

// ---------- Voitures années 60-70, en quelques volumes ----------
// 0 berline à ailerons, 1 coccinelle, 2 muscle car, 3 break, 4 pick-up, 5 fourgon, 'cop' police.
function carShape(model, body, two, wheels = false) {
  const g = new Geo();
  const B = col(body), T = col(two), GL = col(PAL.glass), CH = col(PAL.chrome), DK = col(PAL.dark), RD = col(PAL.red);
  const bumpers = (xf = 2.42, xr = -2.44) => { g.box(xf - 0.08, 0.42, -1.14, xf + 0.1, 0.66, 1.14, CH); g.box(xr - 0.1, 0.42, -1.14, xr + 0.08, 0.66, 1.14, CH); };
  const lamps = (x, y, zs, r = 0.2, c = '#fff3c4') => { for (const z of zs) g.add(cyl(r, r, 0.14, 7).rotateZ(Math.PI / 2), mat4(x, y, z), col(c)); };
  const tails = (x, y) => { g.box(x - 0.06, y, -1.02, x + 0.04, y + 0.24, -0.62, RD); g.box(x - 0.06, y, 0.62, x + 0.04, y + 0.24, 1.02, RD); };
  switch (model) {
    case 'cop':
      // Berline de police : avant et arrière noirs, portières blanches, gyrophare
      g.frustum(0.75, 2.4, 1.14, 0.4, 0.75, 2.3, 1.08, 1.08, DK);
      g.frustum(-1.15, 0.75, 1.16, 0.4, -1.15, 0.75, 1.1, 1.1, col(PAL.white));
      g.frustum(-2.4, -1.15, 1.14, 0.4, -2.38, -1.15, 1.08, 1.08, DK);
      g.frustum(-1.25, 0.75, 1.0, 1.08, -0.8, 0.35, 0.86, 1.72, GL);
      g.box(-0.85, 1.72, -0.88, 0.4, 1.82, 0.88, col(PAL.white));
      g.box(-0.85, 1.82, -0.14, 0.4, 1.86, 0.14, B); // fine ligne à la couleur du joueur
      g.box(-0.48, 1.82, -0.8, -0.08, 1.94, 0.8, DK);
      g.box(-2.42, 1.05, -1.12, -1.55, 1.3, -0.95, DK); g.box(-2.42, 1.05, 0.95, -1.55, 1.3, 1.12, DK);
      bumpers(); lamps(2.36, 0.84, [-0.78, 0.78]); tails(-2.42, 0.86);
      g.box(2.36, 0.6, -0.45, 2.44, 0.9, 0.45, CH);
      break;
    case 1:
      // Coccinelle : tout en rondeurs
      g.add(new THREE.SphereGeometry(1, 8, 5), mat4(0, 0.95, 0, 2.2, 0.62, 1.15), B);
      g.add(new THREE.SphereGeometry(1, 8, 5), mat4(-0.25, 1.38, 0, 1.25, 0.64, 0.94), B);
      g.box(-1.0, 1.3, -0.97, 0.3, 1.62, 0.97, GL);
      g.box(0.3, 1.32, -0.72, 0.66, 1.62, 0.72, GL);
      for (const [x, z] of [[1.45, 1], [1.45, -1], [-1.45, 1], [-1.45, -1]]) g.add(new THREE.SphereGeometry(1, 7, 4), mat4(x, 0.68, z, 0.66, 0.42, 0.3), B);
      g.box(2.08, 0.42, -0.95, 2.24, 0.6, 0.95, CH); g.box(-2.24, 0.42, -0.95, -2.08, 0.6, 0.95, CH);
      lamps(1.86, 0.98, [-0.78, 0.78], 0.24); tails(-2.05, 0.8);
      break;
    case 2:
      // Muscle car : long capot, arrière fuyant, bandes de course
      g.frustum(-2.45, 2.45, 1.16, 0.38, -2.4, 2.4, 1.12, 1.0, B);
      g.frustum(-1.75, 0.25, 1.02, 1.0, -0.75, -0.15, 0.84, 1.58, GL);
      g.box(-0.78, 1.58, -0.86, -0.12, 1.66, 0.86, B);
      g.box(0.85, 1.0, -0.32, 1.65, 1.17, 0.32, DK);
      for (const z of [-0.62, 0.36]) { g.box(0.3, 1.0, z, 2.38, 1.03, z + 0.26, T); g.box(-2.38, 1.0, z, -1.8, 1.03, z + 0.26, T); }
      g.box(-2.45, 1.22, -1.14, -2.15, 1.32, 1.14, B); g.box(-2.36, 1.0, -1.0, -2.24, 1.22, -0.86, DK); g.box(-2.36, 1.0, 0.86, -2.24, 1.22, 1.0, DK);
      bumpers(2.46, -2.48); lamps(2.42, 0.78, [-0.92, -0.58, 0.58, 0.92], 0.15); tails(-2.46, 0.72);
      break;
    case 3:
      // Break familial : long toit, flancs en faux bois, galerie
      g.frustum(-2.4, 2.4, 1.14, 0.4, -2.38, 2.3, 1.08, 1.08, B);
      g.frustum(-2.3, 0.75, 1.0, 1.08, -2.12, 0.35, 0.9, 1.72, GL);
      g.box(-2.14, 1.72, -0.92, 0.4, 1.82, 0.92, T);
      for (const x of [-1.7, -0.3]) g.box(x, 1.82, -0.8, x + 0.1, 1.94, 0.8, CH);
      g.box(-2.0, 0.6, -1.19, 1.3, 0.95, -1.12, col(PAL.wood)); g.box(-2.0, 0.6, 1.12, 1.3, 0.95, 1.19, col(PAL.wood));
      bumpers(); lamps(2.36, 0.84, [-0.78, 0.78]); tails(-2.42, 0.82);
      break;
    case 4:
      // Pick-up : cabine haute, benne ouverte avec une caisse
      g.frustum(-0.4, 2.4, 1.14, 0.4, -0.4, 2.28, 1.08, 1.12, B);
      g.frustum(-0.5, 0.95, 1.02, 1.12, -0.4, 0.6, 0.9, 1.82, GL);
      g.box(-0.42, 1.82, -0.92, 0.62, 1.92, 0.92, T);
      g.box(-2.4, 0.4, -1.14, -0.4, 0.8, 1.14, B);
      g.box(-2.4, 0.8, -1.14, -0.5, 1.2, -1.02, B); g.box(-2.4, 0.8, 1.02, -0.5, 1.2, 1.14, B); g.box(-2.4, 0.8, -1.02, -2.28, 1.2, 1.02, B);
      g.box(-1.9, 0.8, -0.6, -1.05, 1.36, 0.25, col(PAL.wood));
      bumpers(); lamps(2.36, 0.86, [-0.78, 0.78], 0.22); tails(-2.42, 0.84);
      break;
    case 5:
      // Fourgon bicolore : bas coloré, haut crème, gros phares ronds
      g.frustum(-2.3, 2.3, 1.15, 0.4, -2.3, 2.3, 1.15, 1.25, B);
      g.frustum(-2.3, 2.3, 1.15, 1.25, -2.26, 1.85, 1.08, 2.15, T);
      g.box(1.72, 1.42, -0.94, 2.14, 1.96, 0.94, GL);
      g.box(-1.6, 1.45, -1.17, 1.3, 1.9, 1.17, GL);
      g.box(-2.3, 1.2, -1.17, 2.3, 1.3, 1.17, CH);
      for (const x of [-1.5, 0.2]) g.box(x, 2.15, -0.85, x + 0.1, 2.27, 0.85, CH);
      bumpers(2.32, -2.34); lamps(2.3, 0.92, [-0.76, 0.76], 0.26); tails(-2.32, 0.9);
      break;
    default:
      // Berline à ailerons
      g.frustum(-2.4, 2.4, 1.14, 0.4, -2.38, 2.3, 1.08, 1.08, B);
      g.frustum(-1.25, 0.75, 1.0, 1.08, -0.8, 0.35, 0.86, 1.72, GL);
      g.box(-0.85, 1.72, -0.88, 0.4, 1.82, 0.88, T);
      g.hull([[-2.46, 1.05, -1.14], [-1.4, 1.05, -1.14], [-1.4, 1.08, -1.1], [-2.5, 1.42, -1.1], [-2.46, 1.05, -0.94], [-1.4, 1.05, -0.94], [-1.4, 1.08, -0.98], [-2.5, 1.42, -0.98]], B);
      g.hull([[-2.46, 1.05, 0.94], [-1.4, 1.05, 0.94], [-1.4, 1.08, 0.98], [-2.5, 1.42, 0.98], [-2.46, 1.05, 1.14], [-1.4, 1.05, 1.14], [-1.4, 1.08, 1.1], [-2.5, 1.42, 1.1]], B);
      g.box(2.36, 0.6, -0.5, 2.44, 0.92, 0.5, CH);
      bumpers(); lamps(2.36, 0.84, [-0.78, 0.78]); tails(-2.44, 0.92);
  }
  if (wheels) for (const [x, z] of [[1.45, 1.08], [1.45, -1.08], [-1.45, 1.08], [-1.45, -1.08]]) g.add(cyl(0.55, 0.55, 0.45, 8).rotateX(Math.PI / 2), mat4(x, 0.55, z), col(PAL.tyre));
  return g;
}

// Couleur de joueur un peu passée, pour rester dans la palette rétro.
const vintage = hex => mix(hex, '#d9cdb0', 0.26);

function carGeometry(model, hex) {
  const key = model + hex;
  let geo = G.carGeos.get(key);
  if (!geo) {
    geo = carShape(model, model === 'cop' ? hex : vintage(hex), model === 2 ? PAL.white : V[0]).build();
    G.carGeos.set(key, geo);
  }
  return geo;
}

// ---------- Ville ----------
function buildCity(scene) {
  const map = getMap();
  const rand = rng(99);
  const pick = n => Math.floor(rand() * n);
  // Un morceau de géométrie par case de 40 x 40 : seuls ceux qui sont à l'écran sont dessinés.
  const chunks = Array.from({ length: CHUNKS * CHUNKS }, () => new Geo());
  const size = WORLD / CHUNKS;
  const at = (x, z) => chunks[clamp(Math.floor(x / size), 0, CHUNKS - 1) + clamp(Math.floor(z / size), 0, CHUNKS - 1) * CHUNKS];
  const C = k => col(PAL[k] || k);
  const parkedShapes = new Map();

  const tree = (g, x, y, z, k, s) => {
    if (k === 2) {
      // Palmier : tronc fin, palmes en étoile
      g.box(x - 0.14, y, z - 0.14, x + 0.14, y + 3.6 * s, z + 0.14, C('trunk'));
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * 6.283 + x, dx = Math.cos(a), dz = Math.sin(a), h = y + 3.6 * s;
        g.strip(x, z, x + dx * 1.7 * s, z + dz * 1.7 * s, 0.6 * s, h + 0.12 - i * 0.012, C('palm'));
        g.strip(x + dx * 1.5 * s, z + dz * 1.5 * s, x + dx * 2.3 * s, z + dz * 2.3 * s, 0.42 * s, h - 0.25, C(PAL.tree[2]));
      }
      g.add(new THREE.IcosahedronGeometry(0.34 * s, 0), mat4(x, y + 3.6 * s, z), C('trunk'));
    } else if (k === 3) {
      g.add(new THREE.IcosahedronGeometry(0.75 * s, 0), mat4(x, y + 0.5 * s, z, 1, 0.8, 1, x), C('hedge'));
    } else if (k === 1) {
      g.box(x - 0.16, y, z - 0.16, x + 0.16, y + 0.9 * s, z + 0.16, C('trunk'));
      g.add(new THREE.ConeGeometry(1.15 * s, 2 * s, 6), mat4(x, y + 1.8 * s, z, 1, 1, 1, x), C(PAL.tree[2]));
      g.add(new THREE.ConeGeometry(0.85 * s, 1.7 * s, 6), mat4(x, y + 2.9 * s, z, 1, 1, 1, z), C(PAL.tree[0]));
    } else {
      g.box(x - 0.18, y, z - 0.18, x + 0.18, y + 1.3 * s, z + 0.18, C('trunk'));
      g.add(new THREE.IcosahedronGeometry(1.3 * s, 0), mat4(x, y + 2.3 * s, z, 1, 0.95, 1, x + z), C(PAL.tree[Math.floor(Math.abs(x * 7 + z * 3)) % 2]));
    }
  };

  const draw = {
    ground(g, o, x, z, w, d) {
      if (o.g === 'walk') g.box(x, 0, z, x + w, 0.2, z + d, C('kerb'), C('walk'));
      else g.box(x, 0, z, x + w, o.g === 'lot' ? 0.03 : 0.05, z + d, C(o.g));
    },
    water(g, o, x, z, w, d) {
      // Canal : l'eau, un liseré clair, un quai bas tout autour
      g.box(x, 0, z, x + w, 0.04, z + d, C('waterLight'));
      g.box(x + 0.5, 0, z + 0.5, x + w - 0.5, 0.06, z + d - 0.5, C('water'));
      for (const [a, b, c, e] of [[x - 0.3, z - 0.3, x + w + 0.3, z], [x - 0.3, z + d, x + w + 0.3, z + d + 0.3], [x - 0.3, z, x, z + d], [x + w, z, x + w + 0.3, z + d]]) g.box(a, 0, b, c, 0.32, e, C('walk'));
    },
    lake(g, o, x, z) {
      const r = o.r * U;
      g.add(cyl(r + 0.5, r + 0.5, 0.06, 14), mat4(x, 0.05, z), C('sand'));
      g.add(cyl(r - 0.3, r - 0.3, 0.06, 14), mat4(x, 0.09, z), C('water'));
    },
    pool(g, o, x, z, w, d) { g.box(x - 0.25, 0.05, z - 0.25, x + w + 0.25, 0.14, z + d + 0.25, C('white')); g.box(x, 0.05, z, x + w, 0.16, z + d, C('water')); },
    bld(g, o, x, z, w, d) {
      // Immeuble : volume simple, bandeaux de fenêtres, détail de toit, parfois une enseigne
      const tone = PAL.walls[o.c], h = 0.2 + o.f * FLOOR_H, roof = C(o.r === 4 ? mix(tone, '#6a625a', 0.4) : mix(tone, '#fff8e8', 0.42));
      g.box(x, 0.2, z, x + w, h, z + d, C(tone), roof);
      g.box(x - 0.1, h, z - 0.1, x + w + 0.1, h + 0.3, z + d + 0.1, C(mix(tone, '#ffffff', 0.35)), roof);
      g.box(x - 0.04, 0.2, z - 0.04, x + w + 0.04, 1.5, z + d + 0.04, C(mix(tone, PAL.dark, 0.45)));
      if (o.r !== 4) for (let k = 1; k < o.f; k++) g.box(x - 0.04, 0.2 + k * FLOOR_H + 0.7, z - 0.04, x + w + 0.04, 0.2 + k * FLOOR_H + 1.75, z + d + 0.04, C('glass'));
      const cx = x + w / 2, cz = z + d / 2, top = h + 0.3;
      if (o.r === 0) { g.box(cx - 1, top, cz - 0.7, cx + 0.2, top + 0.8, cz + 0.4, C('concrete')); g.box(cx + 0.6, top, cz - 0.2, cx + 1.3, top + 0.5, cz + 0.6, C('steel')); }
      else if (o.r === 1 && w > 3.5 && d > 3.5) {
        // Château d'eau de toit
        for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) g.box(cx + a - 0.07, top, cz + b - 0.07, cx + a + 0.07, top + 0.9, cz + b + 0.07, C('dark'));
        g.add(cyl(0.8, 0.8, 1.3, 8), mat4(cx, top + 1.5, cz), C('wood'));
        g.add(new THREE.ConeGeometry(0.95, 0.6, 8), mat4(cx, top + 2.45, cz), C(PAL.roofs[0]));
      } else if (o.r === 2 && w > 5 && d > 5) g.box(x + w * 0.2, top - 0.3, z + d * 0.2, x + w * 0.75, top + FLOOR_H, z + d * 0.75, C(tone), roof);
      else if (o.r === 3 && w > 4) {
        // Panneau publicitaire tourné vers la caméra
        const c1 = V[2 + (o.s % 4)];
        g.box(cx - 1.5, top, z + d - 0.5, cx - 1.38, top + 2.2, z + d - 0.38, C('dark')); g.box(cx + 1.38, top, z + d - 0.5, cx + 1.5, top + 2.2, z + d - 0.38, C('dark'));
        g.box(cx - 1.9, top + 0.8, z + d - 0.36, cx + 1.9, top + 2.5, z + d - 0.2, C(c1));
        g.box(cx - 1.5, top + 1.4, z + d - 0.2, cx + 1.5, top + 1.9, z + d - 0.16, C(V[0]));
      } else g.box(cx - 0.05, top, cz - 0.05, cx + 0.05, top + 2.2, cz + 0.05, C('dark'));
      // Enseigne verticale sur la façade sud
      if (o.s < 2 && o.f >= 2) { const sx = x + (o.s ? w - 0.7 : 0.3); g.box(sx, 1.9, z + d, sx + 0.4, Math.min(h - 0.3, 6.5), z + d + 0.5, C(V[o.s ? 5 : 2])); }
      else if (o.s === 2 && w > 3) g.box(x + 0.4, 1.5, z + d, x + w - 0.4, 2.1, z + d + 0.22, C(V[4]));
    },
    house(g, o, x, z, w, d) {
      const tone = [V[0], V[1], V[7], '#e9dfc8', V[2], '#d9c7b8'][o.c];
      if (o.bw) {
        // Bungalow de plage à toit plat
        g.box(x, 0.05, z, x + w, 2.3, z + d, C(tone), C('white'));
        g.box(x - 0.3, 2.3, z - 0.3, x + w + 0.3, 2.55, z + d + 0.3, C(V[[1, 5, 2, 4][o.rc]]), C('white'));
      } else {
        g.box(x, 0.05, z, x + w, 2.4, z + d, C(tone));
        g.gable(x - 0.3, z - 0.3, x + w + 0.3, z + d + 0.3, 2.4, 4.1, o.ax, C(PAL.roofs[o.rc]));
        g.box(x + w * 0.2, 3.2, z + d * 0.25, x + w * 0.2 + 0.5, 4.6, z + d * 0.25 + 0.5, C('#b5654a'));
      }
      g.box(x + w / 2 - 0.4, 0.05, z + d, x + w / 2 + 0.4, 1.7, z + d + 0.06, C('wood'));
      g.box(x + 0.5, 1, z + d, x + 1.6, 1.8, z + d + 0.05, C('glass'));
    },
    tree(g, o, x, z) { tree(g, x, o.s < 0.7 ? 0.2 : 0, z, o.k, o.s); },
    hedge(g, o, x, z, w, d) { g.box(x, 0, z, x + w, 1.2, z + d, C('hedge')); },
    fence(g, o, x, z, w, d) { g.box(x, 0, z, x + w, 1.1, z + d, C('steel')); },
    wall(g, o, x, z, w, d) { g.box(x, 0, z, x + w, 2.2, z + d, C('#b5654a'), C('walk')); },
    barrier(g, o, x, z, w, d) {
      const n = Math.max(2, Math.round(Math.max(w, d) / 0.9));
      for (let k = 0; k < n; k++) {
        if (w > d) g.box(x + k * w / n, 0.45, z, x + (k + 1) * w / n, 0.95, z + d, C(k % 2 ? 'white' : 'red'));
        else g.box(x, 0.45, z + k * d / n, x + w, 0.95, z + (k + 1) * d / n, C(k % 2 ? 'white' : 'red'));
      }
      g.box(x, 0, z, x + 0.15, 0.45, z + 0.15, C('dark')); g.box(x + w - 0.15, 0, z + d - 0.15, x + w, 0.45, z + d, C('dark'));
    },
    cone(g, o, x, z) { g.add(new THREE.ConeGeometry(0.3, 0.8, 6), mat4(x, 0.4, z), C('flame')); g.box(x - 0.3, 0, z - 0.3, x + 0.3, 0.06, z + 0.3, C('flame')); },
    bollard(g, o, x, z) { g.add(cyl(0.3, 0.38, 0.8, 6), mat4(x, 0.4, z), C('dark')); },
    lamp(g, o, x, z) {
      g.box(x - 0.07, 0, z - 0.07, x + 0.07, 3.4, z + 0.07, C('dark'));
      g.box(x - 0.07, 3.3, z - 0.07, x + 0.9, 3.42, z + 0.07, C('dark'));
      g.box(x + 0.55, 3.1, z - 0.16, x + 1.0, 3.3, z + 0.16, C('#fff3c4'));
    },
    light(g, o, x, z) {
      g.box(x - 0.07, 0, z - 0.07, x + 0.07, 2.8, z + 0.07, C('dark'));
      g.box(x - 0.2, 2.2, z - 0.2, x + 0.2, 3.3, z + 0.2, C('dark'));
      g.box(x - 0.12, 2.95, z + 0.2, x + 0.12, 3.18, z + 0.24, C('red')); g.box(x - 0.12, 2.64, z + 0.2, x + 0.12, 2.87, z + 0.24, C('gold')); g.box(x - 0.12, 2.33, z + 0.2, x + 0.12, 2.56, z + 0.24, C('bill'));
    },
    bench(g, o, x, z, w, d) {
      if (w === undefined) { w = o.a ? 0.5 : 1.6; d = o.a ? 1.6 : 0.5; x -= w / 2; z -= d / 2; }
      g.box(x, 0.2, z, x + w, 0.6, z + d, C('wood'));
      if (w > d) g.box(x, 0.6, z, x + w, 1.0, z + 0.12, C('wood')); else g.box(x, 0.6, z, x + 0.12, 1.0, z + d, C('wood'));
    },
    bin(g, o, x, z) { g.add(cyl(0.28, 0.22, 0.8, 6), mat4(x, 0.6, z), C(V[4])); },
    sign(g, o, x, z) {
      g.box(x - 0.05, 0.2, z - 0.05, x + 0.05, 2.4, z + 0.05, C('steel'));
      const k = Math.floor(Math.abs(x + z)) % 3;
      if (k === 0) g.add(cyl(0.4, 0.4, 0.08, 8).rotateX(Math.PI / 2), mat4(x, 2.5, z + 0.06), C('red'));
      else g.box(x - 0.4, 2.1, z + 0.04, x + 0.4, 2.8, z + 0.1, C(k === 1 ? V[4] : V[2]));
    },
    booth(g, o, x, z) { g.box(x - 0.42, 0.2, z - 0.42, x + 0.42, 2.4, z + 0.42, C(V[5]), C(V[0])); g.box(x - 0.3, 0.9, z + 0.42, x + 0.3, 2.1, z + 0.45, C('glass')); },
    totem(g, o, x, z) {
      g.box(x - 0.12, 0, z - 0.12, x + 0.12, 5.2, z + 0.12, C('steel'));
      g.box(x - 1.1, 4.1, z - 0.15, x + 1.1, 5.6, z + 0.15, C(V[5])); g.box(x - 0.8, 4.6, z + 0.15, x + 0.8, 5.1, z + 0.19, C(V[0]));
    },
    parasol(g, o, x, z) { g.box(x - 0.05, 0, z - 0.05, x + 0.05, 2, z + 0.05, C('white')); g.add(new THREE.ConeGeometry(1.4, 0.6, 8), mat4(x, 2.2, z), C(V[[5, 2, 1, 4][o.c]])); },
    pillar(g, o, x, z) { const r = o.r * U; g.add(cyl(r, r, o.low ? 3.4 : DECK, 8), mat4(x, (o.low ? 3.4 : DECK) / 2, z), C('concrete')); },
    canopy(g, o, x, z, w, d) { g.box(x, 3.4, z, x + w, 3.9, z + d, C(V[5]), C(V[0])); g.box(x + 0.3, 3.3, z + 0.3, x + w - 0.3, 3.4, z + d - 0.3, C(V[0])); },
    shop(g, o, x, z, w, d) {
      g.box(x, 0.05, z, x + w, 2.8, z + d, C(V[0]));
      g.box(x - 0.3, 2.8, z - 0.3, x + w + 0.3, 3.15, z + d + 0.6, C(V[5]), C(V[0]));
      g.box(x + 0.5, 0.6, z + d, x + w - 0.5, 2.2, z + d + 0.06, C('glass'));
    },
    ware(g, o, x, z, w, d) {
      // Entrepôt : grand volume, toit à deux pans, portail
      const tone = [V[1], '#c9a47e', V[0], '#a8b3b0'][o.c];
      g.box(x, 0.05, z, x + w, 4.2, z + d, C(tone));
      g.gable(x - 0.2, z - 0.2, x + w + 0.2, z + d + 0.2, 4.2, 5.6, o.ax, C(mix(tone, PAL.dark, 0.35)));
      g.box(x + w / 2 - 1.6, 0.05, z + d, x + w / 2 + 1.6, 3, z + d + 0.08, C(V[4]));
      if (o.ch) for (const k of [0.25, 0.6]) { g.add(cyl(0.5, 0.65, 8, 8), mat4(x + w * k, 6, z + d * 0.4), C(V[3])); g.add(cyl(0.55, 0.55, 0.6, 8), mat4(x + w * k, 10.1, z + d * 0.4), C('dark')); }
    },
    tank(g, o, x, z) {
      const r = o.r * U, h = o.big ? 5 : 3.2;
      g.add(cyl(r, r, h, 12), mat4(x, h / 2, z), C(o.big ? V[0] : V[2]));
      g.add(cyl(r + 0.05, r + 0.05, 0.5, 12), mat4(x, h * 0.62, z), C(o.big ? V[5] : V[0]));
      g.add(new THREE.ConeGeometry(r, 0.7, 12), mat4(x, h + 0.35, z), C('concrete'));
    },
    crate(g, o, x, z, w, d) { for (let k = 0; k < o.n; k++) g.box(x + k * 0.1, k * 1.5, z + k * 0.1, x + w - k * 0.1, k * 1.5 + 1.5, z + d - k * 0.1, C(k ? '#b98b5e' : 'wood')); },
    cont(g, o, x, z, w, d) {
      // Conteneurs empilés, de couleurs rétro
      for (let k = 0; k < o.n; k++) {
        const c = V[(o.c + k * 3) % 8];
        g.box(x, k * 2.6, z, x + w, k * 2.6 + 2.55, z + d, C(c), C(mix(c, PAL.dark, 0.2)));
        g.box(x + w - 0.05, k * 2.6 + 0.3, z + 0.3, x + w + 0.03, k * 2.6 + 2.2, z + d - 0.3, C(mix(c, PAL.dark, 0.3)));
      }
    },
    crane(g, o, x, z, w, d) {
      // Portique : quatre pieds, poutre, chariot ; la grue de quai a une flèche au-dessus du bassin
      const H = 9, c = C(V[2]);
      for (const [a, b] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]]) g.box(x + a, 0, z + b, x + a + 1, H, z + b + 1, c);
      g.box(x, H, z, x + w, H + 0.9, z + 1, c); g.box(x, H, z + d - 1, x + w, H + 0.9, z + d, c);
      g.box(x + w * 0.45, H, z - (o.quay ? 2 : 0), x + w * 0.45 + 1.2, H + 0.8, z + d + (o.quay ? 14 : 0), C(V[3]));
      g.box(x + w * 0.45 - 0.6, H - 1.6, z + d * 0.4, x + w * 0.45 + 1.8, H, z + d * 0.4 + 2, C(V[0]));
      const hz = z + d + (o.quay ? 9 : -d * 0.3);
      g.box(x + w * 0.45 + 0.5, H - 4.5, hz, x + w * 0.45 + 0.62, H, hz + 0.12, C('dark'));
      g.box(x + w * 0.45 - 0.2, H - 5, hz - 0.7, x + w * 0.45 + 1.3, H - 4.5, hz + 0.8, C('dark'));
    },
    ship(g, o, x, z, w, d) {
      // Cargo à quai
      g.hull([[x + 1.5, 0.05, z + 1], [x + w - 2, 0.05, z + 1], [x + w, 2.6, z], [x, 2.6, z], [x + 1.5, 0.05, z + d - 1], [x + w - 2, 0.05, z + d - 1], [x + w, 2.6, z + d], [x, 2.6, z + d]], C(V[4]), C('walk'));
      g.box(x, 2.6, z, x + w, 2.9, z + d, C(V[3]), C('walk'));
      g.box(x + 1, 2.9, z + 1.2, x + 5, 6.3, z + d - 1.2, C(V[0])); g.box(x + 1.3, 4.6, z + 1.1, x + 5.1, 5.4, z + d - 1.1, C('glass'));
      g.add(cyl(0.8, 0.9, 2.6, 8), mat4(x + 2.6, 7.6, z + d / 2), C(V[5]));
      for (let k = 0; k < 4; k++) { const cx = x + 7 + (k % 2) * 6.5, cz = z + 1.2 + Math.floor(k / 2) * 3; g.box(cx, 2.9, cz, cx + 6, 5.4, cz + 2.5, C(V[(k * 3 + 1) % 8])); }
    },
    island(g, o, x, z) {
      // Rond-point : pelouse, bordure, obélisque
      const r = o.r * U;
      g.add(cyl(r, r, 0.3, 16), mat4(x, 0.15, z), C('walk'));
      g.add(cyl(r - 0.6, r - 0.6, 0.1, 16), mat4(x, 0.33, z), C('grass'));
      g.add(cyl(1.2, 1.5, 0.8, 4), mat4(x, 0.7, z, 1, 1, 1, Math.PI / 4), C('concrete'));
      g.add(cyl(0.2, 0.6, 5, 4), mat4(x, 3.6, z, 1, 1, 1, Math.PI / 4), C(V[0]));
      for (let k = 0; k < 5; k++) tree(g, x + Math.cos(k * 1.257) * (r - 1.6), 0.3, z + Math.sin(k * 1.257) * (r - 1.6), 3, 0.8);
    },
    median(g, o, x, z, w, d) { g.box(x, 0, z, x + w, 0.25, z + d, C('walk'), C('grass')); },
    fountain(g, o, x, z) {
      const r = o.r * U;
      g.add(cyl(r, r + 0.3, 0.9, 8), mat4(x, 0.45, z, 1, 1, 1, Math.PI / 8), C('white'));
      g.add(cyl(r - 0.5, r - 0.5, 0.1, 8), mat4(x, 0.92, z, 1, 1, 1, Math.PI / 8), C('water'));
      g.add(cyl(0.45, 0.7, 2.4, 4), mat4(x, 1.7, z, 1, 1, 1, Math.PI / 4), C('white'));
      g.add(new THREE.OctahedronGeometry(0.7, 0), mat4(x, 3.5, z), C(V[5]));
    },
    kiosk(g, o, x, z) { const r = o.r * U; g.box(x - r * 0.8, 0, z - r * 0.8, x + r * 0.8, 2.2, z + r * 0.8, C(V[0])); g.add(new THREE.ConeGeometry(r * 1.45, 1.4, 4).rotateY(Math.PI / 4), mat4(x, 2.9, z), C(V[4])); },
    paint(g, o, x, z, w, d) { g.box(x, 0, z, x + w, 0.045, z + d, C(o.c)); },
    zebra(g, o, x, z, w, d) {
      const n = Math.round((o.hz ? w : d) / 1.5);
      for (let k = 0; k < n; k++) { if (o.hz) g.box(x + k * w / n + 0.2, 0, z, x + (k + 1) * w / n - 0.3, 0.045, z + d, C('line')); else g.box(x, 0, z + k * d / n + 0.2, x + w, 0.045, z + (k + 1) * d / n - 0.3, C('line')); }
    },
    ring(g, o, x, z) { g.add(new THREE.RingGeometry(o.r0 * U, o.r1 * U, 28).rotateX(-Math.PI / 2), mat4(x, 0.045, z), C('line')); },
    path(g, o) { g.strip(o.x0 * U, o.y0 * U, o.x1 * U, o.y1 * U, o.w * U, 0.07, C('path')); },
    rail(g, o, x, z, w, d) { g.box(x, 0, z, x + w, 1, z + d, C('white')); },
    car(g, o) {
      // Voiture garée : un des modèles, recopié dans le décor
      const key = o.m + '.' + o.c;
      let shape = parkedShapes.get(key);
      if (!shape) { shape = carShape(o.m, V[o.c], V[0], true); parkedShapes.set(key, shape); }
      g.append(shape, mat4(o.cx * U, (o.z || 0) * U, o.cy * U, 1.08, 1.08, 1.08, -o.a));
    },
  };

  for (const o of map.items) {
    const fn = draw[o.t];
    if (!fn) continue;
    const x = o.x * U, z = o.y * U, w = o.w * U, d = o.h * U;
    const cx = o.t === 'car' ? o.cx * U : o.t === 'path' ? o.x0 * U : o.w ? x + w / 2 : x;
    const cz = o.t === 'car' ? o.cy * U : o.t === 'path' ? o.y0 * U : o.h ? z + d / 2 : z;
    fn(at(cx, cz), o, x, z, o.w ? w : undefined, o.h ? d : undefined);
  }

  // Ouvrages : rampes en biseau, tabliers, garde-corps, bâtiment du parking.
  for (const st of map.structs) {
    const g = at((st.parts[1].x + st.parts[1].w / 2) * U, (st.parts[1].y + st.parts[1].h / 2) * U);
    const road = C('lot'), side = C('concrete'), rail = C('white');
    for (const b of st.solid || []) {
      const x0 = b[0] * U, z0 = b[1] * U, x1 = b[2] * U, z1 = b[3] * U;
      g.box(x0, 0, z0, x1, DECK - 0.3, z1, side);
      g.box(x0 - 0.05, 1.3, z0 - 0.05, x1 + 0.05, 2.6, z1 + 0.05, C('dark'));
      for (let x = x0 + 0.2; x < x1; x += 3) g.box(x, 0, z1, x + 0.5, DECK - 0.3, z1 + 0.08, side);
    }
    for (const p of st.parts) {
      const x0 = p.x * U, z0 = p.y * U, x1 = x0 + p.w * U, z1 = z0 + p.h * U, t = 0.35;
      // Hauteur du tablier aux quatre coins (nord-ouest, nord-est, sud-est, sud-ouest)
      const hs = !p.ramp ? [DECK, DECK, DECK, DECK] : p.ramp === 'S' ? [0, 0, DECK, DECK] : p.ramp === 'N' ? [DECK, DECK, 0, 0] : p.ramp === 'E' ? [0, DECK, DECK, 0] : [DECK, 0, 0, DECK];
      // Rampe pleine jusqu'au sol ; tablier en simple dalle
      if (p.ramp) g.hull([[x0, 0, z0], [x1, 0, z0], [x1, hs[1], z0], [x0, hs[0], z0], [x0, 0, z1], [x1, 0, z1], [x1, hs[2], z1], [x0, hs[3], z1]], side, road);
      else g.hull([[x0, DECK - 0.5, z0], [x1, DECK - 0.5, z0], [x1, DECK, z0], [x0, DECK, z0], [x0, DECK - 0.5, z1], [x1, DECK - 0.5, z1], [x1, DECK, z1], [x0, DECK, z1]], side, road);
      // Garde-corps sur les côtés fermés (ils suivent la pente)
      const o = p.open;
      const wall = (ax, az, bx, bz, ha, hb) => {
        const horiz = Math.abs(bx - ax) > Math.abs(bz - az);
        const e = horiz ? [0, t] : [t, 0];
        g.hull([[ax, ha, az], [bx, hb, bz], [bx, hb + 0.75, bz], [ax, ha + 0.75, az], [ax + e[0], ha, az + e[1]], [bx + e[0], hb, bz + e[1]], [bx + e[0], hb + 0.75, bz + e[1]], [ax + e[0], ha + 0.75, az + e[1]]], rail);
      };
      if (!o.includes('n') && p.ramp !== 'S') wall(x0, z0, x1, z0, hs[0], hs[1]);
      if (!o.includes('s') && p.ramp !== 'N') wall(x0, z1 - t, x1, z1 - t, hs[3], hs[2]);
      if (!o.includes('w') && p.ramp !== 'E') wall(x0, z0, x0, z1, hs[0], hs[3]);
      if (!o.includes('e') && p.ramp !== 'O') wall(x1 - t, z0, x1 - t, z1, hs[1], hs[2]);
    }
    for (const r of st.obs) if (r.h < 12) g.box(r.x * U, DECK, r.y * U, (r.x + r.w) * U, DECK + 0.75, (r.y + r.h) * U, rail);
    // Marquage des places sur le toit du parking
    if (st.solid) for (let x = st.solid[0][0] + 10; x < st.solid[0][2]; x += 40) g.box(x * U, DECK, (st.solid[0][3] - 48) * U, x * U + 0.15, DECK + 0.03, (st.solid[0][3] - 4) * U, C('line'));
  }

  // Sol de l'île et quais.
  const base = new Geo();
  base.box(0, -2, 0, WORLD, 0, WORLD, C('asphalt'));
  const q = 2.2;
  base.box(-q, -2, -q, WORLD + q, 0.3, 0, C('walk'));
  base.box(-q, -2, WORLD, WORLD + q, 0.3, WORLD + q, C('walk'));
  base.box(-q, -2, 0, 0, 0.3, WORLD, C('walk'));
  base.box(WORLD, -2, 0, WORLD + q, 0.3, 145, C('walk'));
  base.box(WORLD, -2, 162, WORLD + q, 0.3, WORLD, C('walk'));
  // Quelques voiliers au large, pour le décor.
  for (const [bx, bz, ry] of [[-13, 30, 0.4], [WORLD + 14, 88, 2.2], [52, WORLD + 13, 1.2], [WORLD + 11, 22, 4], [-15, 112, 5.2], [100, -12, 3], [150, WORLD + 16, 0.3]]) {
    const m = mat4(bx, -2, bz, 1, 1, 1, ry);
    base.add(cyl(1.4, 0.8, 1, 4), m.clone().multiply(mat4(0, 0.4, 0, 2, 1, 0.9)), C('white'));
    base.add(new THREE.ConeGeometry(1.6, 4, 3), m.clone().multiply(mat4(0.3, 3, 0, 1, 1, 0.1)), C(V[5]));
  }
  const ground = new THREE.Mesh(base.build(), G.mat);
  ground.receiveShadow = true;
  scene.add(ground);
  for (const c of chunks) {
    if (!c.p.length) continue;
    const mesh = new THREE.Mesh(c.build(), G.mat);
    mesh.receiveShadow = true; mesh.castShadow = true;
    scene.add(mesh);
  }

  // Mer : un aplat, et une frange plus claire autour de l'île.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), new THREE.MeshBasicMaterial({ color: PAL.sea }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(WORLD / 2, -2, WORLD / 2);
  const fringe = new THREE.Mesh(new THREE.PlaneGeometry(WORLD + 10, WORLD + 10), new THREE.MeshBasicMaterial({ color: PAL.waterLight }));
  fringe.rotation.x = -Math.PI / 2; fringe.position.set(WORLD / 2, -1.95, WORLD / 2);
  scene.add(sea, fringe);

  // Barils, bonbonnes de gaz et pompes à essence : ils disparaissent en explosant.
  G.barrels = map.barrels.map(b => {
    const geo = new Geo();
    if (b.kind === 'pump') { geo.box(-0.55, 0, -0.4, 0.55, 1.9, 0.4, C(V[0]), C(V[5])); geo.box(-0.4, 1, 0.4, 0.4, 1.6, 0.44, C('glass')); geo.box(-0.6, 1.9, -0.45, 0.6, 2.2, 0.45, C(V[5])); }
    else if (b.kind === 'gas') { geo.add(cyl(0.5, 0.5, 1.3, 8), mat4(0, 0.65, 0), C(V[5])); geo.add(new THREE.SphereGeometry(0.5, 8, 4), mat4(0, 1.3, 0, 1, 0.7, 1), C(V[5])); geo.add(cyl(0.15, 0.15, 0.35, 6), mat4(0, 1.75, 0), C('chrome')); }
    else { geo.add(cyl(0.6, 0.6, 1.5, 8), mat4(0, 0.75, 0), C(V[3])); geo.add(cyl(0.63, 0.63, 0.25, 8), mat4(0, 0.95, 0), C(V[0])); }
    const m = new THREE.Mesh(geo.build(), G.mat);
    m.position.set(b.x * U, 0, b.y * U);
    m.rotation.y = pick(6);
    m.castShadow = true;
    scene.add(m);
    return { mesh: m, x: b.x * U, z: b.y * U };
  });

  // Passants (purement décoratifs) : ils vont et viennent, et s'écartent d'un bond quand une voiture arrive.
  G.peds = [];
  const walk = (x0, y0, x1, y1) => G.peds.push({ x0: x0 * U, z0: y0 * U, x1: x1 * U, z1: y1 * U, t: rand(), dir: rand() < 0.5 ? 1 : -1, sp: 0.05 + rand() * 0.04, c: V[pick(8)], hop: 0, ox: 0, oz: 0 });
  for (const [x0, y0, x1, y1, type] of map.blocks) {
    if (type === 'town') { walk(x0 + 5, y1 - 5, x1 - 5, y1 - 5); walk(x1 - 5, y0 + 5, x1 - 5, y1 - 5); if (rand() < 0.6) walk(x0 + 5, y0 + 5, x1 - 5, y0 + 5); }
    else if (type === 'plaza') { walk(x0 + 20, y0 + 25, x1 - 20, y0 + 25); walk(x0 + 20, y1 - 25, x1 - 20, y1 - 25); walk(x0 + 30, y0 + 30, x0 + 30, y1 - 30); }
    else if (type === 'beach') { walk(x0 + 20, y1 - 50, x1 - 20, y1 - 50); walk(x0 + 60, y1 - 15, x1 - 60, y1 - 15); }
    else if (type === 'park') { walk(x0 + 30, y0 + 20, x1 - 40, y0 + 20); walk(x0 + 20, y1 - 20, x1 - 200, y1 - 20); }
    else if (type === 'parking') walk(x0 + 30, y1 - 30, x1 - 80, y1 - 30);
  }
}

function makeCar(id) {
  const root = new THREE.Group();
  root.scale.setScalar(CAR_SCALE);
  const body = new THREE.Group();
  root.add(body);
  G.scene.add(root);
  const tag = document.createElement('div');
  tag.className = 'car-tag';
  G.ui.appendChild(tag);
  const c = {
    id, root, body, tag, mesh: null, kind: '', color: '',
    x: WORLD / 2, z: WORLD / 2, y: 0, a: 0, v: 0, spin: 0, lean: 0, yaw: 0, tilt: 0,
    cop: false, dead: false, skid: false, turbo: false, wl: null, wr: null, known: false, tagTxt: '', tx: 0, ty: 0,
  };
  G.cars.set(id, c);
  return c;
}

function dressCar(c, kind, hex) {
  if (c.kind === kind && c.color === hex) return;
  if (c.mesh) c.body.remove(c.mesh);
  c.mesh = new THREE.Mesh(carGeometry(kind, hex), G.mat);
  c.mesh.castShadow = true;
  c.body.add(c.mesh);
  c.kind = kind; c.color = hex;
  c.wl = c.wr = null;
}

function flame(c, k = 1) {
  const bx = c.x - Math.cos(c.a) * 3, bz = c.z - Math.sin(c.a) * 3, s = 0.35 + Math.random() * 0.4;
  G.lights.add({
    x: bx + (Math.random() - 0.5) * 0.9, y: c.y + 0.9, z: bz + (Math.random() - 0.5) * 0.9,
    vx: -Math.cos(c.a) * 8 * k + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: -Math.sin(c.a) * 8 * k + (Math.random() - 0.5) * 3,
    sx: s, sy: s, sz: s, life: 0.3, spin: 8, color: Math.random() < 0.5 ? PAL.flame : PAL.gold,
  });
}

// ---------- Particules : de petits cubes (fumée, débris, billets, feu), tous dans un InstancedMesh ----------
class Cubes {
  constructor(max, lit) {
    this.max = max;
    this.list = [];
    this.once = [];   // cubes posés pour une seule image (gyrophares, passants)
    const mat = lit ? new THREE.MeshLambertMaterial({ flatShading: true }) : new THREE.MeshBasicMaterial();
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, col(PAL.white));
    this.d = new THREE.Object3D();
  }

  add(p) {
    if (this.list.length >= this.max - 90) this.list.shift();
    this.list.push({ vx: 0, vy: 0, vz: 0, grav: 0, grow: 0, spin: 0, drag: 1.5, floor: 0.15, rot: Math.random() * 6, ...p, max: p.life });
  }

  // Cube fixe, valable pour l'image en cours seulement.
  put(x, y, z, sx, sy, sz, ry, color) { this.once.push([x, y, z, sx, sy, sz, ry, color]); }

  update(dt) {
    const l = this.list, d = this.d, m = this.mesh;
    let n = 0, k = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.grav * dt;
      const f = Math.exp(-p.drag * dt);
      p.vx *= f; p.vz *= f;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.floor && p.grav) { p.y = p.floor; p.vy *= -0.4; p.vx *= 0.6; p.vz *= 0.6; p.spin *= 0.5; }
      p.rot += p.spin * dt;
      // Le cube grossit (fumée) puis rétrécit jusqu'à disparaître : pas de transparence.
      const t = p.life / p.max;
      const e = Math.min(1, t * 3) * (1 + p.grow * (1 - t));
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.rot * 0.7, p.rot, p.rot * 0.4);
      d.scale.set(p.sx * e, p.sy * e, p.sz * e);
      d.updateMatrix();
      m.setMatrixAt(n, d.matrix); m.setColorAt(n, col(p.color));
      n++;
      l[k++] = p;
    }
    l.length = k;
    for (const o of this.once) {
      if (n >= this.max) break;
      d.position.set(o[0], o[1], o[2]); d.rotation.set(0, o[6], 0); d.scale.set(o[3], o[4], o[5]); d.updateMatrix();
      m.setMatrixAt(n, d.matrix); m.setColorAt(n, col(o[7]));
      n++;
    }
    this.once.length = 0;
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    m.instanceColor.needsUpdate = true;
  }
}

// ---------- Traces de pneus : un ruban épais de quadrilatères qui s'estompent lentement ----------
class SkidMarks {
  constructor(max = 1400) {
    this.max = max; this.next = 0; this.life = 16;
    this.pos = new Float32Array(max * 12);
    this.colr = new Float32Array(max * 16);
    this.age = new Float32Array(max).fill(99);
    const idx = [];
    for (let i = 0; i < max; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.colr, 4).setUsage(THREE.DynamicDrawUsage));
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.tint = col('#3f3a36');
  }

  reset() { this.age.fill(99); this.colr.fill(0); this.mesh.geometry.attributes.color.needsUpdate = true; }

  // Tronçon de trace entre deux positions d'une roue.
  add(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
    if (l < 0.02 || l > 6) return;
    const nx = -dz / l * 0.32, nz = dx / l * 0.32, i = this.next;
    this.pos.set([ax - nx, ay + 0.08, az - nz, ax + nx, ay + 0.08, az + nz, bx + nx, by + 0.08, bz + nz, bx - nx, by + 0.08, bz - nz], i * 12);
    this.age[i] = 0;
    this.next = (i + 1) % this.max;
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  update(dt) {
    const t = this.tint;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > this.life) continue;
      this.age[i] += dt;
      const a = Math.max(0, 0.62 * Math.min(1, (1 - this.age[i] / this.life) * 2.5));
      for (let k = 0; k < 4; k++) {
        const o = i * 16 + k * 4;
        this.colr[o] = t.r; this.colr[o + 1] = t.g; this.colr[o + 2] = t.b; this.colr[o + 3] = a;
      }
    }
    this.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

// ---------- Interface HTML par-dessus la 3D ----------
function floatText(x, y, z, txt, color) {
  const p = project(x, y, z);
  const el = document.createElement('div');
  el.className = 'chase-float';
  el.textContent = txt;
  el.style.color = color;
  el.style.left = `${clamp(p.x, 40, L.w - 40)}px`;
  el.style.top = `${clamp(p.y, 90, L.h - 60)}px`;
  G.ui.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// Grand bandeau graphique en travers de l'écran ("Arrêté !", "Échappé !").
function stamp(txt, kind) {
  const el = G.stamp;
  el.firstChild.textContent = txt;
  el.className = 'chase-stamp ' + kind;
  void el.offsetWidth; // relance l'animation
  el.classList.add('on');
}

function flash(color, strength) {
  G.flash.style.background = color;
  G.flash.style.setProperty('--f', strength);
  G.flash.classList.remove('on');
  void G.flash.offsetWidth;
  G.flash.classList.add('on');
}

const projV = { x: 0, y: 0, behind: false };
function project(x, y, z) {
  const v = G.tmp.set(x, y, z).project(G.camera);
  projV.x = (v.x * 0.5 + 0.5) * L.w;
  projV.y = (-v.y * 0.5 + 0.5) * L.h;
  projV.behind = v.z > 1;
  return projV;
}

// ---------- Initialisation ----------
function onContextLost(e) { e.preventDefault(); }

function init(cv2d) {
  const host = cv2d.parentNode;
  const canvas = document.createElement('canvas');
  canvas.className = 'gl3d';
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    // Pas de WebGL : on prévient au lieu de laisser un écran vide.
    const fail = document.createElement('div');
    fail.className = 'gl3d-fail';
    fail.textContent = 'La 3D n\'est pas disponible sur cet appareil 😕';
    host.insertBefore(fail, cv2d.nextSibling);
    G = { failed: true, fail };
    return;
  }
  host.insertBefore(canvas, cv2d.nextSibling);
  canvas.addEventListener('webglcontextlost', onContextLost);
  const ui = document.createElement('div');
  ui.className = 'gl3d-ui';
  ui.innerHTML = '<div class="chase-flash"></div><div class="chase-count"></div><div class="chase-arrow"></div><div class="chase-stamp"><span></span></div>';
  host.insertBefore(ui, canvas.nextSibling);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  // Le ciel, le brouillard et l'horizon partagent la même teinte crème : tout se fond au loin.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.sky);
  scene.fog = new THREE.Fog(PAL.sky, 200, 480);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 30, 1600);

  // Lumière douce et chaude de fin d'après-midi, ombres portées nettes.
  scene.add(new THREE.HemisphereLight('#fff6e2', '#cdb991', 1.25));
  const sun = new THREE.DirectionalLight('#ffeccb', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 340;
  sun.shadow.camera.left = -SHADOW_EXT; sun.shadow.camera.right = SHADOW_EXT;
  sun.shadow.camera.top = SHADOW_EXT; sun.shadow.camera.bottom = -SHADOW_EXT;
  sun.shadow.bias = -0.001; sun.shadow.normalBias = 0.18;
  sun.shadow.radius = 1;
  scene.add(sun, sun.target);

  const debug = new URLSearchParams(location.search).has('debug');
  G = {
    canvas, renderer, scene, camera, sun, ui, debug,
    flash: ui.querySelector('.chase-flash'), count: ui.querySelector('.chase-count'), arrow: ui.querySelector('.chase-arrow'), stamp: ui.querySelector('.chase-stamp'),
    cars: new Map(), bags: new Map(), carGeos: new Map(), npcs: [], booms: [], bz: '',
    tmp: new THREE.Vector3(), dummy: new THREE.Object3D(),
    cam: { x: WORLD / 2, z: WORLD / 2, d: 0 }, zoom: 1.4, snapCam: true, shake: 0, focus: null,
    last: 0, time: 0, countTxt: '', skidAt: 0, sirenAt: 0,
    // Qualité adaptative : on baisse la définition si le téléphone peine.
    quality: Math.min(3, savedQuality), slow: 0, frameMs: 16, pr: 1,
  };
  // Un seul matériau en aplats pour la ville, les voitures et les sacs ; un autre pour les carcasses.
  G.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  G.burnt = new THREE.MeshLambertMaterial({ color: '#2b2724', flatShading: true });

  buildCity(scene);

  // Voitures civiles : un modèle et une couleur par voiture, toujours les mêmes.
  const map = getMap();
  G.npcs = map.npcs.map((_, i) => {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(carGeometry((i * 5 + 3) % 6, V[(i * 3 + 1) % 8]), G.mat);
    mesh.castShadow = true;
    root.add(mesh);
    root.scale.setScalar(1.08);
    root.visible = false;
    scene.add(root);
    return { root, mesh, x: 0, z: 0, a: 0, air: 0, spin: 0, known: false };
  });

  // Roues : une seule géométrie instanciée pour toutes les voitures qui roulent.
  const wheel = new Geo();
  wheel.add(cyl(0.55, 0.55, 0.5, 8), new THREE.Matrix4().makeRotationX(Math.PI / 2), col(PAL.tyre));
  wheel.box(-0.3, -0.12, -0.27, 0.3, 0.12, 0.27, col(PAL.chrome));
  G.wheels = new THREE.InstancedMesh(wheel.build(), G.mat, (MAX_CARS + G.npcs.length) * 4);
  G.wheels.castShadow = true; G.wheels.frustumCulled = false; G.wheels.count = 0;
  scene.add(G.wheels);

  // Petit marqueur triangulaire à la couleur du joueur, au-dessus de chaque voiture
  // (toujours visible, même derrière un immeuble).
  const pin = new THREE.ConeGeometry(0.7, 1.15, 3).rotateX(Math.PI);
  G.pins = new THREE.InstancedMesh(pin, new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }), MAX_CARS);
  G.pins.frustumCulled = false; G.pins.count = 0; G.pins.renderOrder = 8;
  scene.add(G.pins);

  G.marks = new SkidMarks();
  G.cubes = new Cubes(700, true);
  G.lights = new Cubes(260, false);
  scene.add(G.marks.mesh, G.cubes.mesh, G.lights.mesh);

  // Butin : une liasse de billets en trois blocs.
  const bag = new Geo();
  bag.box(-0.95, 0, -0.6, 0.95, 0.8, 0.6, col(PAL.bill));
  bag.box(-0.28, -0.03, -0.63, 0.28, 0.83, 0.63, col(PAL.white));
  bag.box(-0.8, 0.8, -0.5, 0.8, 1.25, 0.5, col('#6fcf97'));
  G.bagGeo = bag.build();

  if (debug) window.__chase = G;
  applySize();
  for (const ev of pending.splice(0)) onEvent(ev, { me: null, players: {} });
}

function applySize() {
  const { w, h } = L;
  if (!w || !h) return;
  const base = Math.min(2, window.devicePixelRatio || 1);
  const pr = [base, Math.min(base, 1.5), Math.min(base, 1.15), Math.min(base, 0.85)][Math.min(3, G.quality)];
  G.pr = pr;
  G.renderer.setPixelRatio(pr);
  G.renderer.setSize(w, h, false);
  G.camera.aspect = w / h;
  G.camera.updateProjectionMatrix();
}

// Baisse la définition, puis coupe les ombres, si le rendu ne tient pas 40 images par seconde.
function adaptQuality(ms) {
  G.frameMs += (ms - G.frameMs) * 0.05;
  if (G.debug) return;
  if (G.frameMs > 25) G.slow += 1; else G.slow = Math.max(0, G.slow - 2);
  if (G.slow > 90 && G.quality < 4) {
    G.quality += 1; G.slow = 0; G.frameMs = 16;
    savedQuality = G.quality;
    if (G.quality === 4) { G.renderer.shadowMap.enabled = false; G.sun.castShadow = false; G.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); }
    else applySize();
  }
}

// ---------- Boucle de rendu ----------
function render(view, now) {
  const dt = G.last ? Math.min(0.05, (now - G.last) / 1000) : 0.016;
  if (G.last) adaptQuality(now - G.last);
  G.last = now;
  G.time += dt;
  const s = view.cur;
  const playing = !!s?.cars?.some(c => c.id === view.me);

  G.wi = 0;
  if (s?.cars) {
    syncCars(view, dt);
    syncNpcs(view, dt);
    syncBags(s, dt);
    syncBarrels(s);
  }
  G.wheels.count = G.wi; G.wheels.instanceMatrix.needsUpdate = true;
  walkPeds(dt);
  updateCamera(view, dt, playing);
  updateOverlay(view, playing);
  G.marks.update(dt);
  G.cubes.update(dt);
  G.lights.update(dt);
  G.renderer.render(G.scene, G.camera);
}

// Pose les quatre roues d'une voiture dans l'InstancedMesh commun.
function putWheels(x, y, z, ang, spin, steer, scale) {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  for (const [wx, wz] of [[1.45, -1.1], [1.45, 1.1], [-1.45, -1.1], [-1.45, 1.1]]) {
    const lx = wx * scale, lz = wz * scale;
    G.dummy.position.set(x + cos * lx - sin * lz, y + 0.55 * scale, z + sin * lx + cos * lz);
    G.dummy.scale.setScalar(scale);
    G.dummy.rotation.set(0, 0, 0);
    G.dummy.rotateY(-ang - (wx > 0 ? steer : 0));
    G.dummy.rotateZ(-spin);
    G.dummy.updateMatrix();
    G.wheels.setMatrixAt(G.wi++, G.dummy.matrix);
  }
}

function syncCars(view, dt) {
  const s = view.cur, p = view.prev, a = view.alpha;
  const prevCars = p?.cars && p.round === s.round ? p.cars : null;
  const seen = new Set();
  let pi = 0;
  const blink = Math.floor(G.time * 7) % 2;
  for (const cur of s.cars) {
    seen.add(cur.id);
    const c = G.cars.get(cur.id) || makeCar(cur.id);
    const pl = view.players[cur.id];
    const hex = pl?.color || '#888888';
    dressCar(c, cur.cop ? 'cop' : s.fm || 0, hex);
    c.cop = !!cur.cop;
    // Carcasse calcinée tant que la voiture est détruite.
    if (c.dead !== !!cur.dd) { c.dead = !!cur.dd; c.mesh.material = c.dead ? G.burnt : G.mat; c.wl = c.wr = null; }

    // Interpolation entre les deux derniers instantanés (angle par le plus court chemin).
    const pv = prevCars?.find(o => o.id === cur.id);
    let x = cur.x * U, z = cur.y * U, ang = cur.a, y = (cur.h || 0) * U;
    if (pv && Math.hypot(pv.x - cur.x, pv.y - cur.y) < 80) {
      x = lerp(pv.x, cur.x, a) * U; z = lerp(pv.y, cur.y, a) * U;
      ang = pv.a + wrap(cur.a - pv.a) * a;
      y = lerp(pv.h || 0, cur.h || 0, a) * U;
    }
    const moved = c.known ? Math.hypot(x - c.x, z - c.z) : 0;
    if (moved > 8) { c.wl = c.wr = null; c.y = y; }
    const yaw = c.known && dt > 0 ? wrap(ang - c.a) / dt : 0;
    c.yaw += (clamp(yaw, -6, 6) - c.yaw) * Math.min(1, dt * 10);
    // Sur une rampe, la voiture se cabre selon la pente.
    const py = c.y;
    c.y += (y - c.y) * Math.min(1, dt * 14);
    const slope = moved > 0.03 && moved < 8 ? Math.atan2(c.y - py, moved) : 0;
    c.tilt += (clamp(slope, -0.4, 0.4) - c.tilt) * Math.min(1, dt * 8);
    c.x = x; c.z = z; c.a = ang; c.v = cur.v; c.known = true;
    c.spin += moved / (0.55 * CAR_SCALE);
    c.skid = !!cur.sk; c.turbo = !!cur.tb;

    // Carrosserie : roulis dans les virages, cabrage au turbo.
    const roll = c.dead ? 0.12 : clamp(c.yaw * 0.04 * Math.min(1, cur.v / 150), -0.2, 0.2);
    c.lean += (roll - c.lean) * Math.min(1, dt * 9);
    c.root.position.set(x, c.y, z);
    c.root.rotation.y = -ang;
    c.body.rotation.x = c.lean;
    c.body.rotation.z = c.tilt + (c.turbo ? 0.06 : 0);
    putWheels(x, c.y, z, ang, c.spin, clamp(c.yaw * 0.08, -0.4, 0.4), CAR_SCALE);

    // Marqueur triangulaire (le mien est plus gros et sautille)
    const mine = cur.id === view.me;
    G.dummy.rotation.set(0, G.time * 2, 0);
    G.dummy.position.set(x, c.y + 4.6 + (mine ? 0.35 * Math.abs(Math.sin(G.time * 5)) : 0), z);
    G.dummy.scale.setScalar(mine ? 1.35 : 1);
    G.dummy.updateMatrix();
    G.pins.setMatrixAt(pi, G.dummy.matrix); G.pins.setColorAt(pi, col(hex));
    pi += 1;

    const cos = Math.cos(ang), sin = Math.sin(ang);
    if (c.dead) {
      // La carcasse brûle : flammes et grosse fumée noire.
      if (Math.random() < dt * 16) { const k = 0.5 + Math.random() * 0.6; G.lights.add({ x: x + (Math.random() - 0.5) * 2.4, y: c.y + 1.4, z: z + (Math.random() - 0.5) * 2, vy: 3 + Math.random() * 3, sx: k, sy: k, sz: k, life: 0.45, spin: 5, color: Math.random() < 0.5 ? PAL.flame : PAL.gold }); }
      if (Math.random() < dt * 9) { const k = 0.8 + Math.random() * 0.7; G.cubes.add({ x: x + (Math.random() - 0.5) * 1.5, y: c.y + 2.2, z: z + (Math.random() - 0.5) * 1.5, vx: 0.8, vy: 3.5 + Math.random() * 2, sx: k, sy: k, sz: k, grow: 1.5, life: 1.8, spin: 1.2, drag: 0.3, color: PAL.soot }); }
      continue;
    }

    // Dérapage : beaucoup de fumée de pneus et de grosses traces qui durent.
    const ox = 1.45 * CAR_SCALE, oz = 1.1 * CAR_SCALE;
    const rlx = x - cos * ox + sin * oz, rlz = z - sin * ox - cos * oz;
    const rrx = x - cos * ox - sin * oz, rrz = z - sin * ox + cos * oz;
    if (c.skid) {
      if (c.wl) { G.marks.add(c.wl[0], c.wl[2], c.wl[1], rlx, c.y, rlz); G.marks.add(c.wr[0], c.wr[2], c.wr[1], rrx, c.y, rrz); }
      c.wl = [rlx, rlz, c.y]; c.wr = [rrx, rrz, c.y];
      if (Math.random() < dt * 60) {
        const left = Math.random() < 0.5, k = 0.55 + Math.random() * 0.55;
        G.cubes.add({ x: left ? rlx : rrx, y: c.y + 0.5, z: left ? rlz : rrz, vx: (Math.random() - 0.5) * 3 - cos * 2, vy: 1.6 + Math.random() * 1.6, vz: (Math.random() - 0.5) * 3 - sin * 2, sx: k, sy: k, sz: k, grow: 1.7, life: 0.95, spin: 2, color: PAL.smoke, floor: c.y + 0.15 });
      }
      if (mine && G.time - G.skidAt > 0.28) { G.skidAt = G.time; sound.play('skid'); }
    } else { c.wl = c.wr = null; }
    if (c.turbo && Math.random() < dt * 50) flame(c);

    // Gyrophare : deux blocs rouge et bleu qui s'allument en alternance.
    if (c.cop) {
      const lx = -0.28 * CAR_SCALE, ly = c.y + 2.2 * CAR_SCALE, lz = 0.42 * CAR_SCALE;
      G.lights.put(x + cos * lx - sin * lz, ly, z + sin * lx + cos * lz, 0.5, blink ? 0.3 : 0.5, 0.75, -ang, blink ? '#7a3340' : '#ff4d5e');
      G.lights.put(x + cos * lx + sin * lz, ly, z + sin * lx - cos * lz, 0.5, blink ? 0.5 : 0.3, 0.75, -ang, blink ? '#5aa2ff' : '#3a4a78');
    }
  }
  G.pins.count = pi; G.pins.instanceMatrix.needsUpdate = true;
  if (G.pins.instanceColor) G.pins.instanceColor.needsUpdate = true;

  // Voitures de joueurs partis
  for (const [id, c] of G.cars) {
    if (seen.has(id)) continue;
    G.scene.remove(c.root); c.tag.remove();
    G.cars.delete(id);
  }

  // Sirène de temps en temps quand un flic passe tout près du fugitif.
  const fug = G.cars.get(s.fug);
  if (fug && s.phase === 'play' && G.time - G.sirenAt > 2.4) {
    let near = Infinity;
    for (const c of G.cars.values()) if (c.cop && !c.dead) near = Math.min(near, Math.hypot(c.x - fug.x, c.z - fug.z));
    if (near < 22) { G.sirenAt = G.time; sound.play('siren'); }
  }
}

// Circulation civile : mêmes instantanés interpolés ; une voiture projetée fait un vol plané en vrille.
function syncNpcs(view, dt) {
  const cur = view.cur.npcs || [], prev = view.prev?.round === view.cur.round ? view.prev.npcs : null, a = view.alpha;
  G.npcs.forEach((n, i) => {
    const c = cur[i];
    if (!c) { n.root.visible = false; return; }
    const p = prev?.[i];
    let x = c[0] * U, z = c[1] * U, ang = c[2];
    if (p && Math.hypot(p[0] - c[0], p[1] - c[1]) < 80) { x = lerp(p[0], c[0], a) * U; z = lerp(p[1], c[1], a) * U; ang = p[2] + wrap(c[2] - p[2]) * a; }
    const moved = n.known ? Math.hypot(x - n.x, z - n.z) : 0;
    n.air = c[3] ? n.air + dt : 0;
    const y = c[3] ? Math.max(0, Math.sin(Math.min(1, n.air / 1.1) * Math.PI) * 4.5) : 0;
    n.x = x; n.z = z; n.a = ang; n.known = true;
    n.spin += moved < 8 ? moved / 0.6 : 0;
    n.root.visible = true;
    n.root.position.set(x, y, z);
    n.root.rotation.set(c[3] ? n.air * 5 : 0, -ang, 0);
    if (!c[3]) putWheels(x, 0, z, ang, n.spin, 0, 1.08);
    else if (Math.random() < dt * 20) { const k = 0.4 + Math.random() * 0.4; G.cubes.add({ x, y: y + 1, z, vy: 1, sx: k, sy: k, sz: k, grow: 1.2, life: 0.7, spin: 2, color: PAL.smoke }); }
  });
}

// Barils, bonbonnes et pompes : ceux qui ont explosé laissent une trace de brûlé.
function syncBarrels(s) {
  if (s.bz && s.bz !== G.bz) {
    G.bz = s.bz;
    G.barrels.forEach((b, i) => { b.mesh.visible = s.bz[i] !== '0'; });
  }
  for (const b of G.barrels) if (!b.mesh.visible) G.lights.put(b.x, 0.06, b.z, 3.2, 0.03, 3.2, b.x, '#4a4039');
}

// Passants décoratifs : deux cubes chacun, posés dans le nuage de particules.
function walkPeds(dt) {
  for (const p of G.peds) {
    p.t += p.dir * p.sp * dt;
    if (p.t > 1) { p.t = 1; p.dir = -1; } else if (p.t < 0) { p.t = 0; p.dir = 1; }
    const x = lerp(p.x0, p.x1, p.t), z = lerp(p.z0, p.z1, p.t);
    if (Math.abs(x - G.cam.x) > 45 || Math.abs(z - G.cam.z) > 70) continue;
    // Une voiture arrive : on saute sur le côté.
    let scare = null;
    for (const c of G.cars.values()) if (Math.abs(c.x - x - p.ox) < 6 && Math.abs(c.z - z - p.oz) < 6 && c.v > 60) scare = c;
    if (scare && p.hop <= 0) {
      p.hop = 0.5;
      const dx = x - scare.x, dz = z - scare.z, l = Math.hypot(dx, dz) || 1;
      p.tx = dx / l * 2.2; p.tz = dz / l * 2.2;
    }
    if (p.hop > 0) { p.hop -= dt; p.ox += (p.tx - p.ox) * Math.min(1, dt * 10); p.oz += (p.tz - p.oz) * Math.min(1, dt * 10); }
    else { p.ox *= 1 - Math.min(1, dt * 1.5); p.oz *= 1 - Math.min(1, dt * 1.5); }
    const y = 0.2 + (p.hop > 0 ? Math.sin((0.5 - p.hop) / 0.5 * Math.PI) * 1.1 : Math.abs(Math.sin(G.time * 9 + p.x0)) * 0.08);
    G.cubes.put(x + p.ox, y + 0.55, z + p.oz, 0.5, 1.1, 0.42, 0, p.c);
    G.cubes.put(x + p.ox, y + 1.35, z + p.oz, 0.42, 0.42, 0.42, 0, '#e8c9a8');
  }
}

function syncBags(s, dt) {
  const seen = new Set();
  for (const b of s.bags || []) {
    seen.add(b.i);
    let o = G.bags.get(b.i);
    if (!o) {
      o = new THREE.Mesh(G.bagGeo, G.mat);
      o.castShadow = true;
      o.position.set(b.x * U, 0, b.y * U);
      o.userData = { t: Math.random() * 6, grow: 0, y: (b.h || 0) * U };
      G.scene.add(o);
      G.bags.set(b.i, o);
    }
    // La liasse flotte, tourne et se penche un peu.
    const d = o.userData;
    d.t += dt; d.grow = Math.min(1, d.grow + dt * 4);
    o.position.y = d.y + 1.1 + Math.sin(d.t * 3) * 0.35;
    o.rotation.set(0.25, d.t * 2, 0.15);
    o.scale.setScalar(1.25 * d.grow);
  }
  for (const [i, o] of G.bags) {
    if (seen.has(i)) continue;
    G.scene.remove(o);
    G.bags.delete(i);
  }
}

function updateCamera(view, dt, playing) {
  const s = view.cur;
  // On suit ma voiture ; en spectateur ou à l'arrestation, le fugitif.
  let t = G.cars.get(view.me);
  if (!t || (s?.phase === 'end' && G.focus)) t = G.cars.get(G.focus || s?.fug) || G.cars.get(s?.fug) || t;
  if (s?.phase !== 'end') G.focus = null;
  let tx = WORLD / 2, tz = WORLD / 2, sp = 0;
  if (t) {
    sp = Math.min(1.5, t.v / 270);
    // Un peu d'anticipation dans le sens de la marche.
    tx = t.x + Math.cos(t.a) * sp * 3.5; tz = t.z + Math.sin(t.a) * sp * 3.5;
  }
  const k = G.snapCam ? 1 : 1 - Math.exp(-6 * dt);
  G.cam.x += (tx - G.cam.x) * k; G.cam.z += (tz - G.cam.z) * k;
  G.snapCam = false;
  // Cadrage serré mais lisible. Un peu de recul quand on va vite.
  G.zoom += (1 - G.zoom) * (1 - Math.exp(-(G.zoom > 1 ? 1.6 : 3.5) * dt));
  if (s?.phase === 'end' && G.focus) G.zoom = Math.min(G.zoom, 0.85);
  const aspect = L.w / L.h;
  const tanH = Math.tan(FOV * Math.PI / 360);
  const base = aspect < 1 ? clamp(25 / (tanH * aspect), 110, 230) : clamp(48 / (tanH * aspect), 80, 140);
  const want = base * (1 + 0.1 * sp) * G.zoom;
  G.cam.d = G.cam.d ? G.cam.d + (want - G.cam.d) * Math.min(1, dt * 4) : want;
  const d = G.cam.d;
  G.shake = Math.max(0, G.shake - dt * 2.2);
  const sh = Math.min(2.4, G.shake * G.shake * 1.5);
  const cx = G.cam.x + (Math.random() - 0.5) * sh, cz = G.cam.z + (Math.random() - 0.5) * sh;
  G.camera.position.set(cx, Math.sin(PITCH_ANGLE) * d, cz + Math.cos(PITCH_ANGLE) * d);
  G.camera.lookAt(cx, 0, cz);
  // La voiture un peu sous le centre : on voit loin devant, et les pouces restent en bas.
  const off = L.portrait ? (playing ? 0.02 : 0.03) : 0.02;
  G.camera.setViewOffset(L.w, L.h, 0, L.h * off, L.w, L.h);
  G.scene.fog.near = d + 40; G.scene.fog.far = d + 330;

  // La lumière et sa carte d'ombres suivent la caméra, par pas entiers pour éviter le scintillement.
  const step = (2 * SHADOW_EXT) / 2048 * 8;
  const lx = Math.round(G.cam.x / step) * step, lz = Math.round(G.cam.z / step) * step;
  G.sun.target.position.set(lx, 0, lz);
  G.sun.position.set(lx - 78, 120, lz + 52);
  G.camera.updateMatrixWorld();
}

function updateOverlay(view, playing) {
  const s = view.cur;
  // Compte à rebours de début de manche
  const txt = s?.count ? String(s.count) : '';
  if (txt !== G.countTxt) {
    G.countTxt = txt;
    G.count.textContent = txt;
    G.count.classList.remove('pop'); void G.count.offsetWidth; G.count.classList.add('pop');
    if (txt) sound.play('tick');
  }

  // Petites étiquettes de noms au-dessus des voitures
  for (const c of G.cars.values()) {
    const pl = view.players[c.id];
    const label = c.id === view.me ? 'Toi' : pl?.name || '?';
    if (label !== c.tagTxt) {
      c.tagTxt = label; c.tag.textContent = label;
      c.tag.classList.toggle('me', c.id === view.me);
    }
    const p = project(c.x, c.y + 7.6, c.z);
    const vis = !p.behind && p.x > -40 && p.x < L.w + 40 && p.y > 74 && p.y < L.h + 20;
    const x = vis ? Math.round(p.x) : -999, y = vis ? Math.round(p.y) : -999;
    if (x !== c.tx || y !== c.ty) { c.tx = x; c.ty = y; c.tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`; }
  }

  // Flèche au bord de l'écran : vers le fugitif pour les flics, vers le flic le plus proche pour le fugitif.
  const me = G.cars.get(view.me);
  let target = null;
  if (me && s && s.phase !== 'end') {
    if (me.cop) target = G.cars.get(s.fug);
    else {
      let best = Infinity;
      for (const c of G.cars.values()) {
        if (!c.cop || c.dead) continue;
        const d = Math.hypot(c.x - me.x, c.z - me.z);
        if (d < best) { best = d; target = c; }
      }
    }
  }
  let show = false;
  if (target) {
    const x0 = 26, x1 = L.w - 26, y0 = 74, y1 = L.h - (playing ? 96 : 30);
    const m = project(me.x, me.y + 1, me.z);
    const mx = clamp(m.x, x0, x1), my = clamp(m.y, y0, y1);
    const p = project(target.x, target.y + 1, target.z);
    let dx = p.x - mx, dy = p.y - my;
    if (p.behind) { dx = -dx; dy = -dy; }
    if (p.behind || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) {
      // Intersection de la demi-droite (moi vers la cible) avec le cadre visible
      let k = Infinity;
      if (dx > 0) k = Math.min(k, (x1 - mx) / dx); else if (dx < 0) k = Math.min(k, (x0 - mx) / dx);
      if (dy > 0) k = Math.min(k, (y1 - my) / dy); else if (dy < 0) k = Math.min(k, (y0 - my) / dy);
      if (Number.isFinite(k)) {
        show = true;
        const dist = Math.hypot(target.x - me.x, target.z - me.z);
        const el = G.arrow;
        el.style.transform = `translate(${Math.round(mx + dx * k)}px, ${Math.round(my + dy * k)}px) translate(-50%, -50%) rotate(${Math.atan2(dy, dx)}rad)`;
        el.style.setProperty('--c', me.cop ? (view.players[target.id]?.color || '#fff') : PAL.red);
        el.classList.toggle('near', dist < 30);
      }
    }
  }
  G.arrow.classList.toggle('on', show);
}
