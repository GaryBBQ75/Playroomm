// Rendu 3D de la Course-poursuite (Three.js) : grandes surfaces de couleur, volumes simples,
// soleil rasant et longues ombres, explosions très graphiques. Trois ambiances (automne,
// nuit, hiver), une par manche.
// Le module gère son propre canvas WebGL, posé juste derrière le HUD : création paresseuse
// au premier dessin, nettoyage complet dans unmount(). Three.js n'est chargé qu'à ce moment-là.
import { sound } from '../lib/fx.js';
import { getMap, rng, SIZE, DECK_Z } from '../engine/games/chasemap.js';

// Indique à app.js que ce jeu n'utilise pas le canvas 2D commun.
export const ownCanvas = true;

const U = 0.1;                 // 1 unité serveur = 0,1 unité 3D
const WORLD = SIZE * U;
const FLOOR_H = 2.8;
const DECK = DECK_Z * U;
const MAX_CARS = 8;
const CAR_SCALE = 1.15;        // voitures un peu grossies pour la lisibilité
const PITCH_ANGLE = 1.02;      // caméra plongeante (environ 58°)
const YAW = 0.5;               // et tournée d'un quart : vue en biais, façon isométrique
const FOV = 30;                // focale longue : perspective douce
const SHADOW_EXT = 70;
const CHUNKS = 5;              // la ville est découpée en 5 x 5 morceaux, masqués hors champ

// Couleurs des voitures (rétro, pleines) : indépendantes de l'ambiance.
const V = ['#f2e6cc', '#7fc4b8', '#e9b23c', '#c9522f', '#2f6f86', '#d6455a', '#9aa7b8', '#f0a070'];
const CAR = { dark: '#23263a', glass: '#2c3550', white: '#f7f3ea', tyre: '#1b1d2b', lamp: '#fff2c0', red: '#ff4a55', blue: '#3f8cff' };

// Une ambiance = une palette de grands aplats + un éclairage.
const THEMES = [
  { // Automne : asphalte gris-bleu, sols crème et ocre, arbres orange, soleil rasant
    name: 'automne', sky: '#f3c896', asphalt: '#3b4156', lot: '#444b63', line: '#f6efe2', walk: '#f1dcc0', kerb: '#d7bc99',
    lawn: '#f0a63a', sand: '#f6e3b8', concrete: '#58627b', plaza: '#f3d6ab', path: '#f8e6c4',
    water: '#2f9c9b', waterLight: '#63c2bd', sea: '#2a8f93',
    leaf: '#e2592b', leaf2: '#c9472a', trunk: '#5a3b34', bush: '#d9722e',
    walls: ['#f3e3c8', '#e8b98f', '#d9805f', '#8f9bb3', '#f0cfa0'], roofs: ['#c8502f', '#3f5873', '#7a4a3a'], metal: '#7d87a0',
    sun: '#ffd9ad', sunI: 4.2, hemiSky: '#efe4ff', hemiGround: '#f2b58a', hemiI: 1.5, glow: 0.3, vignette: 'rgba(70, 30, 20, .5)',
  },
  { // Nuit bleutée : tout est sombre, les lumières ressortent
    name: 'nuit', sky: '#141a2b', asphalt: '#1c2233', lot: '#232a3f', line: '#aeb9d6', walk: '#33405e', kerb: '#28324c',
    lawn: '#1f5560', sand: '#3a4a66', concrete: '#2a3350', plaza: '#3a4668', path: '#44517a',
    water: '#123a55', waterLight: '#1d5673', sea: '#0f2f47',
    leaf: '#2f8f8a', leaf2: '#25736f', trunk: '#1a2233', bush: '#267a76',
    walls: ['#3c4a6e', '#4a5580', '#58507a', '#2f3c5c', '#506089'], roofs: ['#6b3f52', '#2f4a66', '#3f3550'], metal: '#3d4868',
    sun: '#9fb8ff', sunI: 2.4, hemiSky: '#8ea2ea', hemiGround: '#1a2238', hemiI: 2.1, glow: 1, vignette: 'rgba(0, 0, 10, .6)',
  },
  { // Hiver : neige partout, sapins verts aux étages blancs
    name: 'hiver', sky: '#dfe7ee', asphalt: '#59616f', lot: '#636c7c', line: '#ffffff', walk: '#f4f6f8', kerb: '#d5dbe2',
    lawn: '#eef2f5', sand: '#e9edf1', concrete: '#9aa4b2', plaza: '#f1f3f5', path: '#dfe5ea',
    water: '#7fb9c9', waterLight: '#a9d3de', sea: '#6aa7ba',
    leaf: '#2f6b55', leaf2: '#f4f6f8', trunk: '#4a3a35', bush: '#3d7d66',
    walls: ['#c9d2dc', '#b7646a', '#e8dfd2', '#7f8fa6', '#d9c2a5'], roofs: ['#f4f6f8', '#eef2f5', '#c9d2dc'], metal: '#8d98a8',
    sun: '#fff0dc', sunI: 3.4, hemiSky: '#f2f6ff', hemiGround: '#b8c4d6', hemiI: 1.55, glow: 0.25, vignette: 'rgba(30, 40, 60, .4)',
  },
];
let PAL = THEMES[0];

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

function disposeTree(root) {
  root.traverse(o => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (m !== G?.mat) m.dispose();
  });
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
  disposeTree(g.scene);
  g.bagGeo.dispose(); g.mat.dispose(); g.burnt.dispose();
  for (const geo of g.carGeos.values()) geo.dispose();
  g.renderer.dispose();
  g.renderer.forceContextLoss();
  g.canvas.remove();
}

// Le HUD de ce jeu est dessiné par le module lui-même (barre de vie, chrono, billets).
export function hud() { return { center: '' }; }

export function cooldowns(view) {
  const c = view.cur?.cars?.find(x => x.id === view.me);
  return [c ? c.cd : 0, 0];
}

// Gerbe de petits cubes autour d'un point.
function burst(x, y, z, n, color, { speed = 8, up = 7, size = 0.5, life = 0.8, flat = false, lit = true } = {}) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.283, s = speed * (0.35 + Math.random() * 0.65), k = size * (0.6 + Math.random() * 0.8);
    (lit ? G.cubes : G.lights).add({
      x, y, z, vx: Math.cos(a) * s, vy: up * (0.5 + Math.random() * 0.7), vz: Math.sin(a) * s,
      sx: flat ? k * 1.8 : k, sy: flat ? k * 0.14 : k, sz: k, life: life * (0.7 + Math.random() * 0.5),
      grav: 20, spin: 4 + Math.random() * 8, color: Array.isArray(color) ? color[i % color.length] : color, floor: y > 2 ? y - 1.4 : 0.15,
    });
  }
}

// Étincelles : petits cubes lumineux.
function sparks(x, y, z, n, color = '#ffe9a0') { burst(x, y, z, n, color, { speed: 11, up: 8, size: 0.22, life: 0.5, lit: false }); }

// Explosion très graphique : sphères orange et blanches qui claquent, anneau d'onde de choc,
// rayons blancs, fumée en boules, débris. Les explosions rapprochées sont allégées.
function explode(x, y, z, big) {
  G.booms = G.booms.filter(t => G.time - t < 0.5);
  const k = (G.booms.length > 2 ? 0.45 : 1) * (big ? 1.35 : 1);
  G.booms.push(G.time);
  const s0 = big ? 1.3 : 1;
  G.fire.add({ x, y: y + 1.2, z, sx: 5 * s0, sy: 5 * s0, sz: 5 * s0, life: 0.16, color: '#ffffff', pop: 1 });
  for (let i = 0; i < 9 * k; i++) {
    const a = Math.random() * 6.283, r = 1 + Math.random() * 2.4, sz = (2 + Math.random() * 2.2) * s0;
    G.fire.add({ x: x + Math.cos(a) * r, y: y + 0.8 + Math.random() * 2, z: z + Math.sin(a) * r, vx: Math.cos(a) * 3, vy: 2 + Math.random() * 3, vz: Math.sin(a) * 3, sx: sz, sy: sz, sz, life: 0.32 + Math.random() * 0.3, color: ['#ff8a1f', '#ffb347', '#ff6a1a', '#ffe6a8'][i % 4], pop: 1 });
  }
  for (let i = 0; i < 10 * k; i++) {
    const a = i / 10 * 6.283 + Math.random() * 0.4, l = 3 + Math.random() * 4;
    G.lights.add({ x: x + Math.cos(a) * 2, y: y + 1.2 + Math.random(), z: z + Math.sin(a) * 2, vx: Math.cos(a) * 34, vz: Math.sin(a) * 34, sx: l, sy: 0.16, sz: 0.16, ry: -a, life: 0.22, drag: 5, color: '#ffffff' });
  }
  for (let i = 0; i < 10 * k; i++) {
    const a = Math.random() * 6.283, s = 1 + Math.random() * 3, sz = 1.2 + Math.random() * 1.4;
    G.balls.add({ x: x + Math.cos(a) * 1.4, y: y + 1.6, z: z + Math.sin(a) * 1.4, vx: Math.cos(a) * s, vy: 3.5 + Math.random() * 4, vz: Math.sin(a) * s, sx: sz, sy: sz, sz, grow: 1.3, life: 1.2 + Math.random() * 1.1, drag: 1, color: i % 3 ? '#3a3a44' : '#f4f0e8' });
  }
  burst(x, y + 1, z, Math.round(12 * k), [CAR.dark, '#ff8a1f', '#f4f0e8'], { speed: 15, up: 13, size: 0.5, life: 1.2 });
  sparks(x, y + 1, z, Math.round(10 * k), '#ffd27a');
  ring(x, y + 0.3, z, big ? 20 : 15);
  G.glow.add({ x, y: y + 1.5, z, size: big ? 46 : 36, life: 0.3, r: 1, g: 0.6, b: 0.2, a: 0.9 });
  G.shake = Math.max(G.shake, big ? 1.5 : 1.2);
  flash('#ffb561', 0.3);
  sound.play('boom');
}

// Anneau d'onde de choc au sol.
function ring(x, y, z, size) {
  const r = G.rings[G.ringN++ % G.rings.length];
  r.position.set(x, y, z);
  r.userData = { t: 0, size };
  r.visible = true;
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
      resetProps();
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
      sparks(x, y + 1.2, z, 8 + Math.round(ev.f * 8));
      burst(x, y + 1.2, z, 5, [CAR.white, CAR.dark], { speed: 8, size: 0.4 });
      G.shake = Math.max(G.shake, 0.2 + ev.f * 0.4);
      sound.play('bump');
      break;
    case 'crash':
      // Choc de face contre un mur : étincelles et légère secousse.
      sparks(x, y + 0.8, z, 8);
      if (ev.id === me) { G.shake = Math.max(G.shake, 0.2 + ev.f * 0.3); sound.play('hit'); }
      break;
    case 'hit':
      // Un flic percute le fugitif : la barre de vie descend.
      sparks(x, y + 1.2, z, 14, '#ffffff');
      burst(x, y + 1.2, z, 8, [CAR.white, CAR.red, CAR.blue], { speed: 10, size: 0.45 });
      ring(x, y + 0.3, z, 8);
      G.glow.add({ x, y: y + 1.2, z, size: 18, life: 0.18, r: 1, g: 0.95, b: 0.8, a: 0.8 });
      G.shake = Math.max(G.shake, 0.6);
      G.hudBar.classList.remove('hit'); void G.hudBar.offsetWidth; G.hudBar.classList.add('hit');
      if (ev.id === me) flash('#ff4a55', 0.28);
      sound.play('hit');
      break;
    case 'boom':
      explode(x, y, z, !!ev.big);
      break;
    case 'toss':
      sparks(x, 1.2, z, 10);
      burst(x, 1.2, z, 8, [CAR.white, CAR.dark], { speed: 10, up: 9, size: 0.45 });
      G.shake = Math.max(G.shake, 0.5);
      sound.play('bump');
      break;
    case 'cash':
      burst(x, y + 1.5, z, 22, ['#58c98a', '#58c98a', '#ffffff'], { speed: 7, up: 11, size: 0.55, life: 1.1, flat: true });
      G.glow.add({ x, y: y + 1.5, z, size: 14, life: 0.2, r: 0.5, g: 1, b: 0.6, a: 0.6 });
      floatText(x, y + 2.5, z, '+2', '#fff');
      sound.play('cash');
      break;
    case 'bust':
      burst(x, y + 1.6, z, 30, [CAR.white, CAR.red, CAR.blue, '#ffd27a'], { speed: 12, up: 9, size: 0.6, life: 1 });
      ring(x, y + 0.3, z, 14);
      stamp('Arrêté !', 'bust');
      flash('#fff', 0.7);
      G.shake = 1;
      G.zoom = 0.78;
      G.focus = ev.id;
      sound.play('siren');
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

  // Toit à deux pans sur le rectangle (x0, z0)-(x1, z1), faîtage le long de x.
  gable(x0, z0, x1, z1, y0, y1, color) {
    const e = 0.02, m = (z0 + z1) / 2;
    this.hull([[x0, y0, z0], [x1, y0, z0], [x1, y1, m - e], [x0, y1, m - e], [x0, y0, z1], [x1, y0, z1], [x1, y1, m + e], [x0, y1, m + e]], color);
  }

  // Bande posée au sol entre deux points (allées, marquages).
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

  // Recopie une autre Geo, transformée (voitures garées, décor fixe).
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

// ---------- Voitures : une caisse, une cabine, des phares ----------
// 0 berline, 1 petite ronde, 2 coupé sport, 3 break, 4 pick-up, 5 fourgon, 'cop' police.
function carShape(model, body, wheels = false) {
  const g = new Geo();
  const B = col(body), GL = col(CAR.glass), DK = col(CAR.dark), W = col(CAR.white);
  const roof = col(mix(body, '#ffffff', 0.22));
  let front = 2.4, rear = -2.4, lampY = 0.72;
  switch (model) {
    case 'cop':
      // Avant et arrière noirs, portières blanches, rampe de gyrophares
      g.frustum(0.7, 2.4, 1.15, 0.4, 0.7, 2.3, 1.08, 1.1, DK);
      g.frustum(-1.1, 0.7, 1.17, 0.4, -1.1, 0.7, 1.1, 1.12, W);
      g.frustum(-2.4, -1.1, 1.15, 0.4, -2.35, -1.1, 1.08, 1.1, DK);
      g.frustum(-1.2, 0.7, 1.0, 1.1, -0.8, 0.3, 0.84, 1.75, GL, W);
      g.box(-0.8, 1.75, -0.12, 0.3, 1.8, 0.12, B); // fine ligne à la couleur du joueur
      g.box(-0.5, 1.75, -0.8, -0.05, 1.86, 0.8, DK);
      break;
    case 1:
      g.frustum(-2.1, 2.1, 1.15, 0.4, -1.75, 1.65, 1.02, 1.15, B);
      g.frustum(-1.35, 0.65, 0.95, 1.15, -0.75, 0.1, 0.74, 1.8, GL, roof);
      front = 2.0; rear = -2.0; lampY = 0.78;
      break;
    case 2:
      g.frustum(-2.5, 2.5, 1.17, 0.38, -2.45, 2.4, 1.1, 1.0, B);
      g.frustum(-1.85, 0.2, 1.0, 1.0, -0.9, -0.25, 0.82, 1.55, GL, roof);
      g.box(0.25, 1.0, -0.22, 2.38, 1.03, 0.22, W);
      front = 2.48; rear = -2.5; lampY = 0.68;
      break;
    case 3:
      g.frustum(-2.4, 2.4, 1.15, 0.4, -2.38, 2.3, 1.08, 1.1, B);
      g.frustum(-2.3, 0.7, 1.0, 1.1, -2.15, 0.3, 0.88, 1.75, GL, roof);
      break;
    case 4:
      g.frustum(-2.4, 2.4, 1.15, 0.4, -2.38, 2.3, 1.08, 1.12, B);
      g.frustum(-0.45, 1.0, 1.0, 1.12, -0.35, 0.6, 0.88, 1.82, GL, roof);
      g.box(-2.25, 1.12, -0.95, -0.55, 1.15, 0.95, DK);
      break;
    case 5:
      g.frustum(-2.3, 2.3, 1.16, 0.4, -2.28, 1.9, 1.08, 2.1, B, col(CAR.white));
      g.box(1.5, 1.35, -1.0, 2.15, 1.9, 1.0, GL);
      g.box(-1.5, 1.4, -1.18, 1.2, 1.85, 1.18, GL);
      front = 2.25; rear = -2.3; lampY = 0.85;
      break;
    default:
      g.frustum(-2.4, 2.4, 1.15, 0.4, -2.38, 2.3, 1.08, 1.1, B);
      g.frustum(-1.2, 0.7, 1.0, 1.1, -0.8, 0.3, 0.84, 1.75, GL, roof);
  }
  for (const z of [-0.95, 0.5]) {
    g.box(front - 0.06, lampY, z, front + 0.06, lampY + 0.3, z + 0.45, col(CAR.lamp));
    g.box(rear - 0.06, lampY, z, rear + 0.06, lampY + 0.3, z + 0.45, col(CAR.red));
  }
  if (wheels) for (const [x, z] of [[1.45, 1.08], [1.45, -1.08], [-1.45, 1.08], [-1.45, -1.08]]) g.add(cyl(0.55, 0.55, 0.45, 8).rotateX(Math.PI / 2), mat4(x, 0.55, z), col(CAR.tyre));
  return g;
}

function carGeometry(model, hex) {
  const key = model + hex;
  let geo = G.carGeos.get(key);
  if (!geo) { geo = carShape(model, hex).build(); G.carGeos.set(key, geo); }
  return geo;
}
// Couleur de joueur légèrement adoucie pour rester dans la palette rétro.
const retro = hex => mix(hex, '#e8d9b8', 0.18);

// ---------- Petit décor : formes simples, posées à l'origine ----------
const C = k => col(PAL[k] || k);
const PROPS = {
  // Arbre en cônes empilés
  tree(g) {
    g.box(-0.2, 0, -0.2, 0.2, 1.1, 0.2, C('trunk'));
    g.add(new THREE.ConeGeometry(1.7, 1.9, 7), mat4(0, 1.7, 0), C('leaf'));
    g.add(new THREE.ConeGeometry(1.35, 1.7, 7), mat4(0, 2.75, 0, 1, 1, 1, 0.4), C('leaf2'));
    g.add(new THREE.ConeGeometry(0.95, 1.6, 7), mat4(0, 3.75, 0, 1, 1, 1, 0.8), C('leaf'));
  },
  palm(g) {
    g.box(-0.14, 0, -0.14, 0.14, 3.6, 0.14, C('trunk'));
    for (let i = 0; i < 6; i++) { const a = i / 6 * 6.283; g.strip(0, 0, Math.cos(a) * 2.1, Math.sin(a) * 2.1, 0.6, 3.6 - i * 0.012, C(i % 2 ? 'leaf' : 'leaf2')); }
    g.add(new THREE.IcosahedronGeometry(0.34, 0), mat4(0, 3.6, 0), C('trunk'));
  },
  bush(g) { g.add(new THREE.IcosahedronGeometry(0.9, 0), mat4(0, 0.6, 0, 1, 0.8, 1), C('bush')); },
  lamp(g) {
    g.box(-0.06, 0, -0.06, 0.06, 4.2, 0.06, col(CAR.dark));
    g.box(-0.06, 4.1, -0.06, 1.2, 4.2, 0.06, col(CAR.dark));
    g.box(0.8, 3.95, -0.14, 1.3, 4.1, 0.14, col(CAR.lamp));
  },
  light(g) {
    g.box(-0.07, 0, -0.07, 0.07, 3, 0.07, col(CAR.dark));
    g.box(-0.2, 2.3, -0.2, 0.2, 3.4, 0.2, col(CAR.dark));
    g.box(-0.12, 3.05, 0.2, 0.12, 3.28, 0.24, col(CAR.red)); g.box(-0.12, 2.74, 0.2, 0.12, 2.97, 0.24, col('#ffcf5a')); g.box(-0.12, 2.43, 0.2, 0.12, 2.66, 0.24, col('#58c98a'));
  },
  bench(g) { g.box(-0.8, 0.25, -0.25, 0.8, 0.5, 0.25, C('trunk')); g.box(-0.8, 0.5, -0.25, 0.8, 0.95, -0.15, C('trunk')); },
  sign(g) { g.box(-0.08, 0, -0.08, 0.08, 4, 0.08, C('metal')); g.box(-1, 3, -0.1, 1, 4.4, 0.1, col(V[5])); g.box(-0.7, 3.5, 0.1, 0.7, 3.9, 0.14, col(V[0])); },
  cone(g) { g.add(new THREE.ConeGeometry(0.32, 0.85, 6), mat4(0, 0.43, 0), col('#ff7a2a')); g.box(-0.32, 0, -0.32, 0.32, 0.07, 0.32, col('#ff7a2a')); },
  barrier(g) { for (let k = 0; k < 5; k++) g.box(-2.2 + k * 0.88, 0.45, -0.12, -2.2 + (k + 1) * 0.88, 0.95, 0.12, col(k % 2 ? '#ffffff' : '#ff5a3a')); g.box(-2.2, 0, -0.1, -2.05, 0.45, 0.1, col(CAR.dark)); g.box(2.05, 0, -0.1, 2.2, 0.45, 0.1, col(CAR.dark)); },
  parasol(g) { g.box(-0.05, 0, -0.05, 0.05, 2, 0.05, col('#ffffff')); g.add(new THREE.ConeGeometry(1.4, 0.6, 8), mat4(0, 2.2, 0), col(V[5])); },
  crate(g) { g.box(-0.7, 0, -0.7, 0.7, 1.4, 0.7, col('#b98452'), col('#cf9a62')); },
};
// Couleurs des éclats quand le décor est percuté.
const SHARDS = { tree: ['leaf', 'leaf2', 'trunk'], palm: ['leaf', 'trunk'], bush: ['bush'], lamp: [CAR.dark, CAR.lamp], light: [CAR.dark, CAR.red], bench: ['trunk'], sign: [V[5], V[0]], cone: ['#ff7a2a'], barrier: ['#ffffff', '#ff5a3a'], parasol: [V[5], '#ffffff'], crate: ['#b98452', '#cf9a62'] };
const PROP_R = { tree: 1.5, palm: 1.1, bush: 1.2, lamp: 0.9, light: 0.9, bench: 1.3, sign: 1, cone: 0.9, barrier: 2.2, parasol: 1.2, crate: 1.3 };

// ---------- Ville ----------
function buildCity() {
  const map = getMap();
  const city = new THREE.Group();
  const rand = rng(99);
  const pick = n => Math.floor(rand() * n);
  // Un morceau de géométrie par case de 40 x 40 : seuls ceux qui sont à l'écran sont dessinés.
  const chunks = Array.from({ length: CHUNKS * CHUNKS }, () => new Geo());
  const size = WORLD / CHUNKS;
  const at = (x, z) => chunks[clamp(Math.floor(x / size), 0, CHUNKS - 1) + clamp(Math.floor(z / size), 0, CHUNKS - 1) * CHUNKS];
  const parkedShapes = new Map();
  const decoShapes = {};
  const deco = k => decoShapes[k] || (decoShapes[k] = (() => { const g = new Geo(); PROPS[k](g); return g; })());

  const draw = {
    ground(g, o, x, z, w, d) {
      if (o.g === 'walk') g.box(x, 0, z, x + w, 0.22, z + d, C('kerb'), C('walk'));
      else if (o.g === 'lot') g.box(x, 0, z, x + w, 0.03, z + d, C('lot'));
      else { g.box(x - 0.25, 0, z - 0.25, x + w + 0.25, 0.05, z + d + 0.25, C('walk')); g.box(x, 0, z, x + w, 0.08, z + d, C(o.g)); }
    },
    water(g, o, x, z, w, d) {
      // Canal : l'eau, un liseré clair, un quai bas tout autour
      g.box(x, 0, z, x + w, 0.04, z + d, C('waterLight'));
      g.box(x + 0.6, 0, z + 0.6, x + w - 0.6, 0.06, z + d - 0.6, C('water'));
      for (const [a, b, c, e] of [[x - 0.4, z - 0.4, x + w + 0.4, z], [x - 0.4, z + d, x + w + 0.4, z + d + 0.4], [x - 0.4, z, x, z + d], [x + w, z, x + w + 0.4, z + d]]) g.box(a, 0, b, c, 0.35, e, C('walk'));
    },
    lake(g, o, x, z) {
      const r = o.r * U;
      g.add(cyl(r + 0.6, r + 0.6, 0.06, 14), mat4(x, 0.09, z), C('walk'));
      g.add(cyl(r - 0.2, r - 0.2, 0.06, 14), mat4(x, 0.12, z), C('water'));
    },
    bld(g, o, x, z, w, d) {
      // Immeuble : un gros volume, un acrotère clair, parfois un bandeau ou un étage en retrait
      const tone = PAL.walls[o.c], h = 0.22 + o.f * FLOOR_H;
      g.box(x, 0.22, z, x + w, h, z + d, C(tone));
      g.box(x - 0.2, h, z - 0.2, x + w + 0.2, h + 0.5, z + d + 0.2, C(mix(tone, '#ffffff', 0.3)), C(mix(tone, PAL.asphalt, 0.35)));
      if (o.c % 2) g.box(x - 0.06, h * 0.55, z - 0.06, x + w + 0.06, h * 0.55 + 0.9, z + d + 0.06, C(mix(tone, PAL.asphalt, 0.45)));
      const top = h + 0.5;
      if (o.r === 1) g.box(x + w * 0.2, top - 0.5, z + d * 0.2, x + w * 0.7, top + FLOOR_H, z + d * 0.7, C(tone), C(mix(tone, '#ffffff', 0.3)));
      else if (o.r === 2) g.box(x + w * 0.55, top - 0.3, z + d * 0.3, x + w * 0.55 + 1.6, top + 0.9, z + d * 0.3 + 1.2, C('metal'));
    },
    house(g, o, x, z, w, d) {
      const tone = PAL.walls[o.c];
      g.box(x, 0.08, z, x + w, 2.6, z + d, C(tone));
      if (o.bw) g.box(x - 0.3, 2.6, z - 0.3, x + w + 0.3, 2.9, z + d + 0.3, C(PAL.roofs[o.rc]), C(mix(PAL.roofs[o.rc], '#ffffff', 0.25)));
      else g.gable(x - 0.35, z - 0.35, x + w + 0.35, z + d + 0.35, 2.6, 4.6, C(PAL.roofs[o.rc]));
    },
    deco(g, o, x, z) { g.append(deco(o.k), mat4(x, 0.22, z, o.s || 1, o.s || 1, o.s || 1, x)); },
    wall(g, o, x, z, w, d) { g.box(x, 0, z, x + w, 2.2, z + d, C(PAL.walls[2]), C('walk')); },
    pillar(g, o, x, z) { const r = o.r * U; g.add(cyl(r, r, o.low ? 3.4 : DECK - 0.4, 6), mat4(x, (o.low ? 3.4 : DECK - 0.4) / 2, z), C('metal')); },
    canopy(g, o, x, z, w, d) { g.box(x, 3.4, z, x + w, 3.9, z + d, col(V[5]), col(V[0])); },
    shop(g, o, x, z, w, d) { g.box(x, 0.08, z, x + w, 3, z + d, C(PAL.walls[0])); g.box(x - 0.3, 3, z - 0.3, x + w + 0.3, 3.4, z + d + 0.3, col(V[5]), col(V[0])); },
    ware(g, o, x, z, w, d) {
      // Entrepôt : grand volume, toit à deux pans
      const tone = PAL.walls[(o.c % 3) + 1];
      g.box(x, 0.08, z, x + w, 4.4, z + d, C(tone));
      g.gable(x - 0.25, z - 0.25, x + w + 0.25, z + d + 0.25, 4.4, 6, C(mix(tone, PAL.asphalt, 0.4)));
    },
    tank(g, o, x, z) {
      const r = o.r * U, h = o.big ? 5.5 : 3.4;
      g.add(cyl(r, r, h, 12), mat4(x, h / 2, z), col(o.big ? V[0] : V[2]));
      g.add(cyl(r + 0.06, r + 0.06, 0.6, 12), mat4(x, h * 0.6, z), col(o.big ? V[5] : V[0]));
    },
    cont(g, o, x, z, w, d) { for (let k = 0; k < o.n; k++) { const c = V[(o.c + k * 3) % 8]; g.box(x, k * 2.6 + 0.08, z, x + w, k * 2.6 + 2.6, z + d, col(c), col(mix(c, '#ffffff', 0.18))); } },
    crane(g, o, x, z, w, d) {
      // Portique jaune : quatre pieds fins, deux poutres, une flèche
      const H = 9, c = col(V[2]);
      for (const [a, b] of [[0, 0], [w - 0.7, 0], [0, d - 0.7], [w - 0.7, d - 0.7]]) g.box(x + a, 0, z + b, x + a + 0.7, H, z + b + 0.7, c);
      g.box(x, H, z, x + w, H + 0.8, z + 0.7, c); g.box(x, H, z + d - 0.7, x + w, H + 0.8, z + d, c);
      g.box(x + w * 0.45, H, z - 1, x + w * 0.45 + 1, H + 0.7, z + d + (o.quay ? 14 : 1), col(V[3]));
    },
    ship(g, o, x, z, w, d) {
      g.hull([[x + 1.5, 0.05, z + 1], [x + w - 2, 0.05, z + 1], [x + w, 2.6, z], [x, 2.6, z], [x + 1.5, 0.05, z + d - 1], [x + w - 2, 0.05, z + d - 1], [x + w, 2.6, z + d], [x, 2.6, z + d]], col(V[4]), col(V[0]));
      g.box(x + 1, 2.6, z + 1.2, x + 5, 6, z + d - 1.2, col(V[0]));
      g.add(cyl(0.8, 0.9, 2.4, 8), mat4(x + 2.6, 7.2, z + d / 2), col(V[5]));
      for (let k = 0; k < 4; k++) { const cx = x + 7 + (k % 2) * 6.3, cz = z + 1.2 + Math.floor(k / 2) * 3; g.box(cx, 2.6, cz, cx + 5.8, 5.1, cz + 2.5, col(V[(k * 3 + 1) % 8])); }
    },
    island(g, o, x, z) { const r = o.r * U; g.add(cyl(r + 0.3, r + 0.3, 0.05, 20), mat4(x, 0.03, z), C('walk')); g.add(cyl(r, r, 0.05, 20), mat4(x, 0.06, z), C('lawn')); },
    median(g, o, x, z, w, d) { g.box(x - 0.25, 0, z - 0.25, x + w + 0.25, 0.05, z + d + 0.25, C('walk')); g.box(x, 0, z, x + w, 0.08, z + d, C('lawn')); },
    fountain(g, o, x, z) {
      const r = o.r * U;
      g.add(cyl(r, r + 0.3, 0.9, 8), mat4(x, 0.45, z, 1, 1, 1, Math.PI / 8), C('walk'));
      g.add(cyl(r - 0.5, r - 0.5, 0.1, 8), mat4(x, 0.92, z, 1, 1, 1, Math.PI / 8), C('water'));
      g.add(cyl(0.4, 0.7, 2.6, 4), mat4(x, 1.8, z, 1, 1, 1, Math.PI / 4), C('walk'));
    },
    paint(g, o, x, z, w, d) { g.box(x, 0, z, x + w, 0.05, z + d, C('line')); },
    dash(g, o) {
      // Pointillés blancs au milieu des grandes rues
      const x0 = o.x0 * U, z0 = o.y0 * U, x1 = o.x1 * U, z1 = o.y1 * U, l = Math.hypot(x1 - x0, z1 - z0), n = Math.floor(l / 5);
      for (let k = 0; k < n; k++) { const a = (k + 0.2) / n, b = (k + 0.65) / n; at(lerp(x0, x1, a), lerp(z0, z1, a)).strip(lerp(x0, x1, a), lerp(z0, z1, a), lerp(x0, x1, b), lerp(z0, z1, b), 0.32, 0.04, C('line')); }
    },
    zebra(g, o, x, z, w, d) {
      const n = Math.round((o.hz ? w : d) / 1.6);
      for (let k = 0; k < n; k++) { if (o.hz) g.box(x + k * w / n + 0.25, 0, z, x + (k + 1) * w / n - 0.4, 0.05, z + d, C('line')); else g.box(x, 0, z + k * d / n + 0.25, x + w, 0.05, z + (k + 1) * d / n - 0.4, C('line')); }
    },
    path(g, o) { g.strip(o.x0 * U, o.y0 * U, o.x1 * U, o.y1 * U, o.w * U, 0.1, C('path')); },
    rail(g, o, x, z, w, d) { g.box(x, 0, z, x + w, 1, z + d, C('walk')); },
    car(g, o) {
      // Voiture garée : un des modèles, recopié dans le décor
      const key = o.m + '.' + o.c;
      let shape = parkedShapes.get(key);
      if (!shape) { shape = carShape(o.m, V[o.c], true); parkedShapes.set(key, shape); }
      g.append(shape, mat4(o.cx * U, (o.z || 0) * U, o.cy * U, 1.08, 1.08, 1.08, -o.a));
    },
  };

  for (const o of map.items) {
    const fn = draw[o.t];
    if (!fn) continue;
    const x = o.x * U, z = o.y * U, w = o.w * U, d = o.h * U;
    const cx = o.t === 'car' ? o.cx * U : o.x0 !== undefined ? o.x0 * U : o.w ? x + w / 2 : x;
    const cz = o.t === 'car' ? o.cy * U : o.x0 !== undefined ? o.y0 * U : o.h ? z + d / 2 : z;
    fn(at(cx, cz), o, x, z, o.w ? w : undefined, o.h ? d : undefined);
  }

  // Ouvrages : rampes en biseau, tabliers, garde-corps, bâtiment du parking.
  for (const st of map.structs) {
    const g = at((st.parts[1].x + st.parts[1].w / 2) * U, (st.parts[1].y + st.parts[1].h / 2) * U);
    const road = C('lot'), side = C('metal'), rail = C('walk');
    for (const b of st.solid || []) g.box(b[0] * U, 0, b[1] * U, b[2] * U, DECK - 0.3, b[3] * U, C(PAL.walls[3]));
    for (const p of st.parts) {
      const x0 = p.x * U, z0 = p.y * U, x1 = x0 + p.w * U, z1 = z0 + p.h * U, t = 0.4;
      // Hauteur du tablier aux quatre coins (nord-ouest, nord-est, sud-est, sud-ouest)
      const hs = !p.ramp ? [DECK, DECK, DECK, DECK] : p.ramp === 'S' ? [0, 0, DECK, DECK] : p.ramp === 'N' ? [DECK, DECK, 0, 0] : p.ramp === 'E' ? [0, DECK, DECK, 0] : [DECK, 0, 0, DECK];
      // Rampe pleine jusqu'au sol ; tablier en simple dalle
      if (p.ramp) g.hull([[x0, 0, z0], [x1, 0, z0], [x1, hs[1], z0], [x0, hs[0], z0], [x0, 0, z1], [x1, 0, z1], [x1, hs[2], z1], [x0, hs[3], z1]], side, road);
      else g.hull([[x0, DECK - 0.5, z0], [x1, DECK - 0.5, z0], [x1, DECK, z0], [x0, DECK, z0], [x0, DECK - 0.5, z1], [x1, DECK - 0.5, z1], [x1, DECK, z1], [x0, DECK, z1]], side, road);
      // Garde-corps sur les côtés fermés (ils suivent la pente)
      const o = p.open;
      const wall = (ax, az, bx, bz, ha, hb) => {
        const e = Math.abs(bx - ax) > Math.abs(bz - az) ? [0, t] : [t, 0];
        g.hull([[ax, ha, az], [bx, hb, bz], [bx, hb + 0.8, bz], [ax, ha + 0.8, az], [ax + e[0], ha, az + e[1]], [bx + e[0], hb, bz + e[1]], [bx + e[0], hb + 0.8, bz + e[1]], [ax + e[0], ha + 0.8, az + e[1]]], rail);
      };
      if (!o.includes('n') && p.ramp !== 'S') wall(x0, z0, x1, z0, hs[0], hs[1]);
      if (!o.includes('s') && p.ramp !== 'N') wall(x0, z1 - t, x1, z1 - t, hs[3], hs[2]);
      if (!o.includes('w') && p.ramp !== 'E') wall(x0, z0, x0, z1, hs[0], hs[3]);
      if (!o.includes('e') && p.ramp !== 'O') wall(x1 - t, z0, x1 - t, z1, hs[1], hs[2]);
    }
    for (const r of st.obs) if (r.h < 12) g.box(r.x * U, DECK, r.y * U, (r.x + r.w) * U, DECK + 0.8, (r.y + r.h) * U, rail);
    // Marquage des places sur le toit du parking
    if (st.solid) for (let x = st.solid[0][0] + 10; x < st.solid[0][2]; x += 40) g.box(x * U, DECK, (st.solid[0][3] - 48) * U, x * U + 0.25, DECK + 0.04, (st.solid[0][3] - 4) * U, C('line'));
  }

  // Sol de l'île et quais.
  const base = new Geo();
  base.box(0, -2, 0, WORLD, 0, WORLD, C('asphalt'));
  const q = 2.4;
  base.box(-q, -2, -q, WORLD + q, 0.3, 0, C('walk'));
  base.box(-q, -2, WORLD, WORLD + q, 0.3, WORLD + q, C('walk'));
  base.box(-q, -2, 0, 0, 0.3, WORLD, C('walk'));
  base.box(WORLD, -2, 0, WORLD + q, 0.3, 145, C('walk'));
  base.box(WORLD, -2, 162, WORLD + q, 0.3, WORLD, C('walk'));
  const ground = new THREE.Mesh(base.build(), G.mat);
  ground.receiveShadow = true;
  city.add(ground);
  for (const c of chunks) {
    if (!c.p.length) continue;
    const mesh = new THREE.Mesh(c.build(), G.mat);
    mesh.receiveShadow = true; mesh.castShadow = true;
    city.add(mesh);
  }

  // Mer : un aplat, et une frange plus claire autour de l'île.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), new THREE.MeshBasicMaterial({ color: PAL.sea }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(WORLD / 2, -2, WORLD / 2);
  const fringe = new THREE.Mesh(new THREE.PlaneGeometry(WORLD + 12, WORLD + 12), new THREE.MeshBasicMaterial({ color: PAL.waterLight }));
  fringe.rotation.x = -Math.PI / 2; fringe.position.set(WORLD / 2, -1.95, WORLD / 2);
  city.add(sea, fringe);

  // Petit décor cassable : une InstancedMesh par type, chaque objet peut disparaître.
  const dummy = new THREE.Object3D();
  G.props = [];
  const kinds = {};
  for (const p of map.props) (kinds[p.k] || (kinds[p.k] = [])).push(p);
  for (const [k, list] of Object.entries(kinds)) {
    if (!PROPS[k]) continue;
    const geo = new Geo(); PROPS[k](geo);
    const mesh = new THREE.InstancedMesh(geo.build(), G.mat, list.length);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
    list.forEach((p, i) => {
      const s = p.s || 1, ry = pick(628) / 100;
      dummy.position.set(p.x * U, 0, p.y * U); dummy.rotation.set(0, k === 'barrier' ? 0 : ry, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      G.props.push({ k, mesh, i, x: p.x * U, z: p.y * U, s, m: dummy.matrix.clone(), alive: true, r: PROP_R[k] * s });
    });
    city.add(mesh);
  }

  // Barils, bonbonnes de gaz et pompes à essence : ils disparaissent en explosant.
  G.barrels = map.barrels.map(b => {
    const geo = new Geo();
    if (b.kind === 'pump') { geo.box(-0.55, 0, -0.4, 0.55, 1.9, 0.4, col(V[0]), col(V[5])); geo.box(-0.6, 1.9, -0.45, 0.6, 2.2, 0.45, col(V[5])); }
    else if (b.kind === 'gas') { geo.add(cyl(0.5, 0.5, 1.5, 8), mat4(0, 0.75, 0), col(V[5])); geo.add(cyl(0.2, 0.5, 0.4, 8), mat4(0, 1.7, 0), col(V[0])); }
    else { geo.add(cyl(0.62, 0.62, 1.5, 8), mat4(0, 0.75, 0), col('#ff7a2a')); geo.add(cyl(0.65, 0.65, 0.3, 8), mat4(0, 0.9, 0), col('#ffffff')); }
    const m = new THREE.Mesh(geo.build(), G.mat);
    m.position.set(b.x * U, 0, b.y * U);
    m.castShadow = true;
    city.add(m);
    return { mesh: m, x: b.x * U, z: b.y * U };
  });
  G.bz = '';

  // Passants (purement décoratifs) : ils vont et viennent, et s'écartent d'un bond quand une voiture arrive.
  G.peds = [];
  const walk = (x0, y0, x1, y1) => G.peds.push({ x0: x0 * U, z0: y0 * U, x1: x1 * U, z1: y1 * U, t: rand(), dir: rand() < 0.5 ? 1 : -1, sp: 0.05 + rand() * 0.04, c: V[pick(8)], hop: 0, ox: 0, oz: 0, tx: 0, tz: 0 });
  for (const [x0, y0, x1, y1, type] of map.blocks) {
    if (type === 'town') { walk(x0 + 5, y1 - 5, x1 - 5, y1 - 5); walk(x1 - 5, y0 + 5, x1 - 5, y1 - 5); }
    else if (type === 'plaza') { walk(x0 + 20, y0 + 25, x1 - 20, y0 + 25); walk(x0 + 20, y1 - 25, x1 - 20, y1 - 25); }
    else if (type === 'beach') walk(x0 + 20, y1 - 80, x1 - 20, y1 - 80);
    else if (type === 'park') walk(x0 + 30, y0 + 20, x1 - 40, y0 + 20);
  }
  return city;
}

// Change d'ambiance : palette, lumières, et reconstruction du décor.
function setTheme(i) {
  PAL = THEMES[i % THEMES.length];
  G.theme = i;
  colCache.clear();
  if (G.city) { G.scene.remove(G.city); disposeTree(G.city); }
  G.scene.background = new THREE.Color(PAL.sky);
  G.scene.fog.color.set(PAL.sky);
  G.hemi.color.set(PAL.hemiSky); G.hemi.groundColor.set(PAL.hemiGround); G.hemi.intensity = PAL.hemiI;
  G.sun.color.set(PAL.sun); G.sun.intensity = PAL.sunI;
  G.ui.style.setProperty('--vig', PAL.vignette);
  G.ui.dataset.theme = PAL.name;
  G.city = buildCity();
  G.scene.add(G.city);
}

function resetProps() {
  for (const p of G.props) if (!p.alive) { p.alive = true; p.mesh.setMatrixAt(p.i, p.m); p.mesh.instanceMatrix.needsUpdate = true; }
}

// Le petit décor vole en éclats au passage d'une voiture, sans la ralentir.
const ZERO = { m: null };
function smashProps() {
  if (!ZERO.m) ZERO.m = new THREE.Matrix4().makeScale(0, 0, 0);
  const hit = (x, z, v, mine) => {
    for (const p of G.props) {
      if (!p.alive || Math.abs(p.x - x) > 4 || Math.abs(p.z - z) > 4) continue;
      if (Math.hypot(p.x - x, p.z - z) > p.r + 1.5) continue;
      p.alive = false;
      p.mesh.setMatrixAt(p.i, ZERO.m); p.mesh.instanceMatrix.needsUpdate = true;
      burst(p.x, 1.2 * p.s, p.z, p.k === 'tree' ? 14 : 8, SHARDS[p.k].map(k => PAL[k] || k), { speed: 6 + v * 0.02, up: 7, size: p.k === 'tree' ? 0.6 : 0.4, life: 0.9 });
      if (mine) { G.shake = Math.max(G.shake, 0.12); sound.play('shot'); }
    }
  };
  for (const c of G.cars.values()) if (!c.out && c.y < 1 && c.v > 30) hit(c.x, c.z, c.v, c.mine);
  for (const n of G.npcs) if (n.root.visible) hit(n.x, n.z, 100, false);
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
    cop: false, dead: false, out: false, mine: false, skid: false, turbo: false, wl: null, wr: null, known: false, tagTxt: '', tx: 0, ty: 0,
  };
  G.cars.set(id, c);
  return c;
}

function dressCar(c, kind, hex) {
  if (c.kind === kind && c.color === hex) return;
  if (c.mesh) c.body.remove(c.mesh);
  c.mesh = new THREE.Mesh(carGeometry(kind, kind === 'cop' ? hex : retro(hex)), G.mat);
  c.mesh.castShadow = true;
  c.body.add(c.mesh);
  c.kind = kind; c.color = hex;
  c.wl = c.wr = null;
}

function flame(c, k = 1) {
  const bx = c.x - Math.cos(c.a) * 3, bz = c.z - Math.sin(c.a) * 3, s = 0.5 + Math.random() * 0.5;
  G.fire.add({
    x: bx + (Math.random() - 0.5) * 0.9, y: c.y + 0.9, z: bz + (Math.random() - 0.5) * 0.9,
    vx: -Math.cos(c.a) * 8 * k + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: -Math.sin(c.a) * 8 * k + (Math.random() - 0.5) * 3,
    sx: s, sy: s, sz: s, life: 0.3, color: Math.random() < 0.5 ? '#ff8a1f' : '#ffd27a',
  });
}

// ---------- Particules : petits volumes dans un InstancedMesh (cubes de débris, boules de fumée et de feu) ----------
class Bits {
  constructor(max, lit, geom) {
    this.max = max;
    this.list = [];
    this.once = [];   // volumes posés pour une seule image (gyrophares, passants)
    const mat = lit ? new THREE.MeshLambertMaterial({ flatShading: true }) : new THREE.MeshBasicMaterial();
    this.mesh = new THREE.InstancedMesh(geom, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, col('#ffffff'));
    this.d = new THREE.Object3D();
  }

  add(p) {
    if (this.list.length >= this.max - 90) this.list.shift();
    this.list.push({ vx: 0, vy: 0, vz: 0, grav: 0, grow: 0, spin: 0, drag: 1.5, floor: 0.15, rot: Math.random() * 6, ...p, max: p.life });
  }

  // Volume fixe, valable pour l'image en cours seulement.
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
      // Pas de transparence : le volume grossit puis rétrécit jusqu'à disparaître.
      // `pop` : il claque d'un coup à pleine taille (boules de feu) avant de se rétracter.
      const t = p.life / p.max;
      const e = p.pop ? Math.sin(Math.min(1, (1 - t) * 4 + 0.25) * Math.PI / 2) * Math.min(1, t * 2.2) : Math.min(1, t * 3) * (1 + p.grow * (1 - t));
      d.position.set(p.x, p.y, p.z);
      if (p.ry !== undefined) d.rotation.set(0, p.ry, 0); else d.rotation.set(p.rot * 0.7, p.rot, p.rot * 0.4);
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

// ---------- Halos lumineux : des points additifs (gyrophares au sol, phares, éclairs d'explosion) ----------
const GLOW_VS = `
attribute vec4 pcolor;
attribute float psize;
uniform float uScale;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = psize * uScale / -mv.z;
  vColor = pcolor;
}`;
const GLOW_FS = `
varying vec4 vColor;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  float a = 1.0 - smoothstep(0.0, 1.0, d);
  gl_FragColor = vec4(vColor.rgb * vColor.a * a * a, 1.0);
}`;
class Glow {
  constructor(max) {
    this.max = max; this.list = []; this.once = [];
    this.pos = new Float32Array(max * 3); this.colr = new Float32Array(max * 4); this.size = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.colr, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({ vertexShader: GLOW_VS, fragmentShader: GLOW_FS, uniforms: { uScale: { value: 1000 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
  }

  add(p) { if (this.list.length < this.max - 80) this.list.push({ ...p, max: p.life }); }
  put(x, y, z, size, r, g, b, a) { this.once.push([x, y, z, size, r, g, b, a]); }

  update(dt) {
    let n = 0, k = 0;
    const set = (x, y, z, size, r, g, b, a) => {
      if (n >= this.max) return;
      this.pos[n * 3] = x; this.pos[n * 3 + 1] = y; this.pos[n * 3 + 2] = z;
      this.colr[n * 4] = r; this.colr[n * 4 + 1] = g; this.colr[n * 4 + 2] = b; this.colr[n * 4 + 3] = a;
      this.size[n++] = size;
    };
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      set(p.x, p.y, p.z, p.size * (1.3 - 0.3 * p.life / p.max), p.r, p.g, p.b, p.a * p.life / p.max);
      this.list[k++] = p;
    }
    this.list.length = k;
    for (const o of this.once) set(...o);
    this.once.length = 0;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true; g.attributes.pcolor.needsUpdate = true; g.attributes.psize.needsUpdate = true;
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
  }

  reset() { this.age.fill(99); this.colr.fill(0); this.mesh.geometry.attributes.color.needsUpdate = true; }

  // Tronçon de trace entre deux positions d'une roue.
  add(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
    if (l < 0.02 || l > 6) return;
    const nx = -dz / l * 0.32, nz = dx / l * 0.32, i = this.next;
    this.pos.set([ax - nx, ay + 0.11, az - nz, ax + nx, ay + 0.11, az + nz, bx + nx, by + 0.11, bz + nz, bx - nx, by + 0.11, bz - nz], i * 12);
    this.age[i] = 0;
    this.next = (i + 1) % this.max;
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > this.life) continue;
      this.age[i] += dt;
      const a = Math.max(0, 0.6 * Math.min(1, (1 - this.age[i] / this.life) * 2.5));
      for (let k = 0; k < 4; k++) {
        const o = i * 16 + k * 4;
        this.colr[o] = 0.04; this.colr[o + 1] = 0.045; this.colr[o + 2] = 0.07; this.colr[o + 3] = a;
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
  ui.className = 'gl3d-ui chase-ui';
  ui.innerHTML = '<div class="chase-vignette"></div><div class="chase-flash"></div>'
    + '<div class="p3-hud"><div class="p3-life"><b></b><span><i></i></span></div><div class="p3-row p3-time"><b></b><span>00:00.00</span></div><div class="p3-row p3-cash"><b></b><span>0</span></div><div class="p3-role"></div></div>'
    + '<div class="p3-progress"><span><i></i></span><b>★</b></div>'
    + '<div class="chase-count"></div><div class="chase-note"></div><div class="chase-arrow"></div><div class="chase-stamp"><span></span></div>';
  host.insertBefore(ui, canvas.nextSibling);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  // Le ciel et le brouillard partagent la même teinte : tout se fond au loin.
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#ffffff', 200, 480);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 30, 1700);

  // Soleil rasant : longues ombres portées nettes, lumière chaude, ombres froides.
  const hemi = new THREE.HemisphereLight('#ffffff', '#ffffff', 1);
  const sun = new THREE.DirectionalLight('#ffffff', 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 420;
  sun.shadow.camera.left = -SHADOW_EXT; sun.shadow.camera.right = SHADOW_EXT;
  sun.shadow.camera.top = SHADOW_EXT; sun.shadow.camera.bottom = -SHADOW_EXT;
  sun.shadow.bias = -0.001; sun.shadow.normalBias = 0.2;
  sun.shadow.radius = 1;
  scene.add(hemi, sun, sun.target);

  const debug = new URLSearchParams(location.search).has('debug');
  const q = s => ui.querySelector(s);
  G = {
    canvas, renderer, scene, camera, sun, hemi, ui, debug,
    flash: q('.chase-flash'), count: q('.chase-count'), note: q('.chase-note'), arrow: q('.chase-arrow'), stamp: q('.chase-stamp'),
    hudBar: q('.p3-life'), hudHp: q('.p3-life i'), hudTime: q('.p3-time span'), hudCash: q('.p3-cash span'), hudRole: q('.p3-role'), hudProg: q('.p3-progress i'),
    cars: new Map(), bags: new Map(), carGeos: new Map(), npcs: [], booms: [], bz: '', props: [], peds: [], barrels: null, city: null, theme: -1,
    tmp: new THREE.Vector3(), dummy: new THREE.Object3D(),
    cam: { x: WORLD / 2, z: WORLD / 2, d: 0 }, zoom: 1.4, snapCam: true, shake: 0, focus: null,
    last: 0, time: 0, countTxt: '', noteTxt: '', hudKey: '', skidAt: 0, sirenAt: 0, ringN: 0,
    // Qualité adaptative : on baisse la définition si le téléphone peine.
    quality: Math.min(3, savedQuality), slow: 0, frameMs: 16, pr: 1,
  };
  // Un seul matériau en aplats pour la ville, les voitures et les sacs ; un autre pour les carcasses.
  G.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  G.burnt = new THREE.MeshLambertMaterial({ color: '#1d1c22', flatShading: true });

  setTheme(0);

  // Voitures civiles : un modèle et une couleur par voiture, toujours les mêmes.
  G.npcs = getMap().npcs.map((_, i) => {
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
  wheel.add(cyl(0.55, 0.55, 0.5, 8), new THREE.Matrix4().makeRotationX(Math.PI / 2), col(CAR.tyre));
  G.wheels = new THREE.InstancedMesh(wheel.build(), G.mat, (MAX_CARS + G.npcs.length) * 4);
  G.wheels.castShadow = true; G.wheels.frustumCulled = false; G.wheels.count = 0;
  scene.add(G.wheels);

  // Faisceaux des phares, posés au sol devant chaque voiture.
  const beam = new THREE.BufferGeometry();
  beam.setAttribute('position', new THREE.Float32BufferAttribute([2.4, 0, -0.9, 8, 0, -2.2, 8, 0, 2.2, 2.4, 0, -0.9, 8, 0, 2.2, 2.4, 0, 0.9], 3));
  G.beams = new THREE.InstancedMesh(beam, new THREE.MeshBasicMaterial({ color: '#fff2c0', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), MAX_CARS + G.npcs.length);
  G.beams.frustumCulled = false; G.beams.count = 0; G.beams.renderOrder = 2;
  scene.add(G.beams);

  // Petit marqueur triangulaire à la couleur du joueur, au-dessus de chaque voiture
  // (toujours visible, même derrière un immeuble).
  const pin = new THREE.ConeGeometry(0.7, 1.15, 3).rotateX(Math.PI);
  G.pins = new THREE.InstancedMesh(pin, new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }), MAX_CARS);
  G.pins.frustumCulled = false; G.pins.count = 0; G.pins.renderOrder = 8;
  scene.add(G.pins);

  // Anneaux d'onde de choc (trois suffisent, ils sont réutilisés).
  G.rings = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false }));
    m.visible = false; m.renderOrder = 3;
    scene.add(m);
    return m;
  });

  G.marks = new SkidMarks();
  G.cubes = new Bits(620, true, new THREE.BoxGeometry(1, 1, 1));
  G.lights = new Bits(260, false, new THREE.BoxGeometry(1, 1, 1));
  G.balls = new Bits(360, true, new THREE.IcosahedronGeometry(0.5, 1));
  G.fire = new Bits(140, false, new THREE.IcosahedronGeometry(0.5, 1));
  G.glow = new Glow(260);
  scene.add(G.marks.mesh, G.cubes.mesh, G.lights.mesh, G.balls.mesh, G.fire.mesh, G.glow.points);

  // Butin : une liasse de billets en trois blocs.
  const bag = new Geo();
  bag.box(-0.95, 0, -0.6, 0.95, 0.8, 0.6, col('#58c98a'));
  bag.box(-0.28, -0.03, -0.63, 0.28, 0.83, 0.63, col('#ffffff'));
  bag.box(-0.8, 0.8, -0.5, 0.8, 1.25, 0.5, col('#7ddba3'));
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
  G.glow.mat.uniforms.uScale.value = h * pr / (2 * Math.tan(FOV * Math.PI / 360));
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
  if (s && s.th !== undefined && s.th !== G.theme) setTheme(s.th);

  G.wi = 0; G.bi = 0;
  if (s?.cars) {
    syncCars(view, dt);
    syncNpcs(view, dt);
    syncBags(s, dt);
    syncBarrels(s);
    smashProps();
  }
  G.wheels.count = G.wi; G.wheels.instanceMatrix.needsUpdate = true;
  G.beams.count = G.bi; G.beams.instanceMatrix.needsUpdate = true;
  G.beams.material.opacity = 0.03 + 0.2 * PAL.glow;
  walkPeds(dt);
  for (const r of G.rings) {
    if (!r.visible) continue;
    const u = r.userData; u.t += dt;
    const k = u.t / 0.45;
    if (k >= 1) { r.visible = false; continue; }
    r.scale.setScalar(u.size * (0.15 + 0.85 * (1 - (1 - k) * (1 - k))));
    r.material.opacity = 0.9 * (1 - k);
  }
  updateCamera(view, dt, playing);
  updateOverlay(view, playing);
  G.marks.update(dt);
  G.cubes.update(dt); G.lights.update(dt); G.balls.update(dt); G.fire.update(dt); G.glow.update(dt);
  G.renderer.render(G.scene, G.camera);
}

// Pose les quatre roues et le faisceau des phares d'une voiture.
function putWheels(x, y, z, ang, spin, steer, scale, beam) {
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
  if (beam) {
    G.dummy.position.set(x, y + 0.13, z); G.dummy.rotation.set(0, -ang, 0); G.dummy.scale.setScalar(scale); G.dummy.updateMatrix();
    G.beams.setMatrixAt(G.bi++, G.dummy.matrix);
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
    c.cop = !!cur.cop; c.mine = cur.id === view.me;
    // En renfort : la voiture n'est pas encore entrée en jeu.
    c.out = cur.w > 0; c.wait = cur.w;
    c.root.visible = !c.out;
    if (c.out) { c.known = false; c.v = 0; continue; }
    // Carcasse calcinée tant que la voiture est détruite.
    if (c.dead !== !!cur.dd) { c.dead = !!cur.dd; c.mesh.material = c.dead ? G.burnt : G.mat; c.wl = c.wr = null; }

    // Interpolation entre les deux derniers instantanés (angle par le plus court chemin).
    const pv = prevCars?.find(o => o.id === cur.id);
    let x = cur.x * U, z = cur.y * U, ang = cur.a, y = (cur.h || 0) * U;
    if (pv && !(pv.w > 0) && Math.hypot(pv.x - cur.x, pv.y - cur.y) < 80) {
      x = lerp(pv.x, cur.x, a) * U; z = lerp(pv.y, cur.y, a) * U;
      ang = pv.a + wrap(cur.a - pv.a) * a;
      y = lerp(pv.h || 0, cur.h || 0, a) * U;
    }
    const moved = c.known ? Math.hypot(x - c.x, z - c.z) : 0;
    if (moved > 8 || !c.known) { c.wl = c.wr = null; c.y = y; }
    const yaw = c.known && dt > 0 && moved < 8 ? wrap(ang - c.a) / dt : 0;
    c.yaw += (clamp(yaw, -6, 6) - c.yaw) * Math.min(1, dt * 10);
    // Sur une rampe, la voiture se cabre selon la pente.
    const py = c.y;
    c.y += (y - c.y) * Math.min(1, dt * 14);
    const slope = moved > 0.03 && moved < 8 ? Math.atan2(c.y - py, moved) : 0;
    c.tilt += (clamp(slope, -0.4, 0.4) - c.tilt) * Math.min(1, dt * 8);
    c.x = x; c.z = z; c.a = ang; c.v = cur.v; c.known = true;
    c.spin += moved < 8 ? moved / (0.55 * CAR_SCALE) : 0;
    c.skid = !!cur.sk; c.turbo = !!cur.tb;

    // Carrosserie : roulis dans les virages, cabrage au turbo.
    const roll = c.dead ? 0.12 : clamp(c.yaw * 0.04 * Math.min(1, cur.v / 150), -0.2, 0.2);
    c.lean += (roll - c.lean) * Math.min(1, dt * 9);
    c.root.position.set(x, c.y, z);
    c.root.rotation.y = -ang;
    c.body.rotation.x = c.lean;
    c.body.rotation.z = c.tilt + (c.turbo ? 0.06 : 0);
    putWheels(x, c.y, z, ang, c.spin, clamp(c.yaw * 0.08, -0.4, 0.4), CAR_SCALE, !c.dead);

    // Marqueur triangulaire (le mien est plus gros et sautille)
    G.dummy.rotation.set(0, G.time * 2, 0);
    G.dummy.position.set(x, c.y + 4.6 + (c.mine ? 0.35 * Math.abs(Math.sin(G.time * 5)) : 0), z);
    G.dummy.scale.setScalar(c.mine ? 1.35 : 1);
    G.dummy.updateMatrix();
    G.pins.setMatrixAt(pi, G.dummy.matrix); G.pins.setColorAt(pi, col(hex));
    pi += 1;

    const cos = Math.cos(ang), sin = Math.sin(ang);
    if (c.dead) {
      // La carcasse brûle : boules de feu et grosse fumée noire.
      if (Math.random() < dt * 14) { const k = 0.9 + Math.random() * 0.9; G.fire.add({ x: x + (Math.random() - 0.5) * 2.4, y: c.y + 1.5, z: z + (Math.random() - 0.5) * 2, vy: 3 + Math.random() * 3, sx: k, sy: k, sz: k, life: 0.45, color: Math.random() < 0.5 ? '#ff8a1f' : '#ffd27a' }); }
      if (Math.random() < dt * 8) { const k = 1.2 + Math.random(); G.balls.add({ x: x + (Math.random() - 0.5) * 1.5, y: c.y + 2.4, z: z + (Math.random() - 0.5) * 1.5, vx: 0.8, vy: 3.5 + Math.random() * 2, sx: k, sy: k, sz: k, grow: 1.3, life: 1.8, drag: 0.3, color: '#2f2f3a' }); }
      G.glow.put(x, c.y + 1.5, z, 16, 1, 0.5, 0.15, 0.35 + 0.15 * Math.sin(G.time * 20));
      continue;
    }

    // Dérapage : fumée blanche en boules et grosses traces qui durent.
    const ox = 1.45 * CAR_SCALE, oz = 1.1 * CAR_SCALE;
    const rlx = x - cos * ox + sin * oz, rlz = z - sin * ox - cos * oz;
    const rrx = x - cos * ox - sin * oz, rrz = z - sin * ox + cos * oz;
    if (c.skid) {
      if (c.wl) { G.marks.add(c.wl[0], c.wl[2], c.wl[1], rlx, c.y, rlz); G.marks.add(c.wr[0], c.wr[2], c.wr[1], rrx, c.y, rrz); }
      c.wl = [rlx, rlz, c.y]; c.wr = [rrx, rrz, c.y];
      if (Math.random() < dt * 55) {
        const left = Math.random() < 0.5, k = 0.8 + Math.random() * 0.8;
        G.balls.add({ x: left ? rlx : rrx, y: c.y + 0.5, z: left ? rlz : rrz, vx: (Math.random() - 0.5) * 3 - cos * 2, vy: 1.4 + Math.random() * 1.5, vz: (Math.random() - 0.5) * 3 - sin * 2, sx: k, sy: k, sz: k, grow: 1.4, life: 0.9, color: '#ffffff' });
      }
      if (c.mine && G.time - G.skidAt > 0.28) { G.skidAt = G.time; sound.play('skid'); }
    } else { c.wl = c.wr = null; }
    if (c.turbo && Math.random() < dt * 50) flame(c);
    // Phares : deux petits halos
    G.glow.put(x + cos * 2.9, c.y + 0.9, z + sin * 2.9, 5, 1, 0.92, 0.7, 0.1 + 0.6 * PAL.glow);

    // Gyrophare : deux blocs lumineux rouge et bleu en alternance, et leur halo coloré au sol.
    if (c.cop) {
      const lx = -0.28 * CAR_SCALE, ly = c.y + 2.15 * CAR_SCALE, lz = 0.42 * CAR_SCALE;
      G.lights.put(x + cos * lx - sin * lz, ly, z + sin * lx + cos * lz, 0.5, blink ? 0.3 : 0.55, 0.75, -ang, blink ? '#5a2030' : '#ff5060');
      G.lights.put(x + cos * lx + sin * lz, ly, z + sin * lx - cos * lz, 0.5, blink ? 0.55 : 0.3, 0.75, -ang, blink ? '#60a8ff' : '#203a6a');
      const side = blink ? 1 : -1, gx = x + cos * lx + sin * lz * side, gz = z + sin * lx - cos * lz * side;
      G.glow.put(gx, ly + 0.2, gz, 6, blink ? 0.2 : 1, 0.25, blink ? 1 : 0.2, 1);
      G.glow.put(x + sin * 2.5 * side, c.y + 0.3, z - cos * 2.5 * side, 24, blink ? 0.1 : 1, 0.15, blink ? 1 : 0.15, 0.3 + 0.45 * PAL.glow);
    } else if (s.sh) {
      // Bouclier de début de manche : un halo qui pulse autour du fugitif
      G.glow.put(x, c.y + 1, z, 20 + Math.sin(G.time * 8) * 3, 0.4, 0.8, 1, 0.22);
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
    for (const c of G.cars.values()) if (c.cop && !c.dead && !c.out) near = Math.min(near, Math.hypot(c.x - fug.x, c.z - fug.z));
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
    if (!c[3]) putWheels(x, 0, z, ang, n.spin, 0, 1.08, true);
    else if (Math.random() < dt * 20) { const k = 0.7 + Math.random() * 0.6; G.balls.add({ x, y: y + 1, z, vy: 1, sx: k, sy: k, sz: k, grow: 1.2, life: 0.7, color: '#ffffff' }); }
  });
}

// Barils, bonbonnes et pompes : ceux qui ont explosé laissent une trace de brûlé.
function syncBarrels(s) {
  if (s.bz && s.bz !== G.bz) {
    G.bz = s.bz;
    G.barrels.forEach((b, i) => { b.mesh.visible = s.bz[i] !== '0'; });
  }
  for (const b of G.barrels) if (!b.mesh.visible) G.lights.put(b.x, 0.1, b.z, 3.4, 0.03, 3.4, b.x, '#15161f');
}

// Passants décoratifs : deux cubes chacun, posés dans le nuage de particules.
function walkPeds(dt) {
  for (const p of G.peds) {
    p.t += p.dir * p.sp * dt;
    if (p.t > 1) { p.t = 1; p.dir = -1; } else if (p.t < 0) { p.t = 0; p.dir = 1; }
    const x = lerp(p.x0, p.x1, p.t), z = lerp(p.z0, p.z1, p.t);
    if (Math.abs(x - G.cam.x) > 60 || Math.abs(z - G.cam.z) > 70) continue;
    // Une voiture arrive : on saute sur le côté.
    let scare = null;
    for (const c of G.cars.values()) if (!c.out && Math.abs(c.x - x - p.ox) < 6 && Math.abs(c.z - z - p.oz) < 6 && c.v > 60) scare = c;
    if (scare && p.hop <= 0) {
      p.hop = 0.5;
      const dx = x - scare.x, dz = z - scare.z, l = Math.hypot(dx, dz) || 1;
      p.tx = dx / l * 2.2; p.tz = dz / l * 2.2;
    }
    if (p.hop > 0) { p.hop -= dt; p.ox += (p.tx - p.ox) * Math.min(1, dt * 10); p.oz += (p.tz - p.oz) * Math.min(1, dt * 10); }
    else { p.ox *= 1 - Math.min(1, dt * 1.5); p.oz *= 1 - Math.min(1, dt * 1.5); }
    const y = 0.22 + (p.hop > 0 ? Math.sin((0.5 - p.hop) / 0.5 * Math.PI) * 1.1 : Math.abs(Math.sin(G.time * 9 + p.x0)) * 0.08);
    G.cubes.put(x + p.ox, y + 0.55, z + p.oz, 0.5, 1.1, 0.42, 0, p.c);
    G.cubes.put(x + p.ox, y + 1.35, z + p.oz, 0.42, 0.42, 0.42, 0, '#f0cfa8');
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
    // La liasse flotte, tourne, et brille un peu.
    const d = o.userData;
    d.t += dt; d.grow = Math.min(1, d.grow + dt * 4);
    o.position.y = d.y + 1.1 + Math.sin(d.t * 3) * 0.35;
    o.rotation.set(0.25, d.t * 2, 0.15);
    o.scale.setScalar(1.25 * d.grow);
    G.glow.put(o.position.x, d.y + 1.2, o.position.z, 9 + Math.sin(d.t * 4), 0.4, 1, 0.6, 0.3 + 0.3 * PAL.glow);
  }
  for (const [i, o] of G.bags) {
    if (seen.has(i)) continue;
    G.scene.remove(o);
    G.bags.delete(i);
  }
}

function updateCamera(view, dt, playing) {
  const s = view.cur;
  // On suit ma voiture ; en spectateur, en attente de renfort ou à l'arrestation, le fugitif.
  let t = G.cars.get(view.me);
  if (!t || t.out || (s?.phase === 'end' && G.focus)) t = G.cars.get(G.focus || s?.fug) || G.cars.get(s?.fug) || t;
  if (s?.phase !== 'end') G.focus = null;
  let tx = WORLD / 2, tz = WORLD / 2, sp = 0;
  if (t && !t.out) {
    sp = Math.min(1.5, t.v / 270);
    // Un peu d'anticipation dans le sens de la marche.
    tx = t.x + Math.cos(t.a) * sp * 3.5; tz = t.z + Math.sin(t.a) * sp * 3.5;
  }
  const far = Math.hypot(tx - G.cam.x, tz - G.cam.z) > 60;
  const k = G.snapCam || far ? 1 : 1 - Math.exp(-6 * dt);
  G.cam.x += (tx - G.cam.x) * k; G.cam.z += (tz - G.cam.z) * k;
  G.snapCam = false;
  // Cadrage serré mais lisible. Un peu de recul quand on va vite.
  G.zoom += (1 - G.zoom) * (1 - Math.exp(-(G.zoom > 1 ? 1.6 : 3.5) * dt));
  if (s?.phase === 'end' && G.focus) G.zoom = Math.min(G.zoom, 0.85);
  const aspect = L.w / L.h;
  const tanH = Math.tan(FOV * Math.PI / 360);
  const base = aspect < 1 ? clamp(27 / (tanH * aspect), 110, 240) : clamp(50 / (tanH * aspect), 84, 140);
  const want = base * (1 + 0.1 * sp) * G.zoom;
  G.cam.d = G.cam.d ? G.cam.d + (want - G.cam.d) * Math.min(1, dt * 4) : want;
  const d = G.cam.d;
  G.shake = Math.max(0, G.shake - dt * 2.2);
  const sh = Math.min(2.4, G.shake * G.shake * 1.5);
  const cx = G.cam.x + (Math.random() - 0.5) * sh, cz = G.cam.z + (Math.random() - 0.5) * sh;
  const flat = Math.cos(PITCH_ANGLE) * d;
  G.camera.position.set(cx + Math.sin(YAW) * flat, Math.sin(PITCH_ANGLE) * d, cz + Math.cos(YAW) * flat);
  G.camera.lookAt(cx, 0, cz);
  G.camera.setViewOffset(L.w, L.h, 0, L.h * 0.02, L.w, L.h);
  G.scene.fog.near = d + 50; G.scene.fog.far = d + 360;

  // Le soleil, bas sur l'horizon, suit la caméra par pas entiers pour éviter le scintillement des ombres.
  const step = (2 * SHADOW_EXT) / 2048 * 8;
  const lx = Math.round(G.cam.x / step) * step, lz = Math.round(G.cam.z / step) * step;
  G.sun.target.position.set(lx, 0, lz);
  G.sun.position.set(lx - 150, 82, lz - 40);
  G.camera.updateMatrixWorld();
}

const pad2 = n => String(n).padStart(2, '0');

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

  // HUD : barre de vie du fugitif, chrono au centième, billets, progression de la manche.
  if (s?.cars) {
    const el = s.el || 0, cs = Math.floor(el * 100);
    G.hudTime.textContent = `${pad2(Math.floor(cs / 6000))}:${pad2(Math.floor(cs / 100) % 60)}.${pad2(cs % 100)}`;
    const mine = s.cars.find(c => c.id === view.me);
    const role = !mine ? 'Spectateur' : s.fug === view.me ? 'Fugitif' : mine.dd ? 'Voiture détruite' : 'Police';
    const key = `${s.hp}|${s.fs}|${s.round}|${role}|${s.sh}`;
    if (key !== G.hudKey) {
      G.hudKey = key;
      G.hudHp.style.width = `${s.hp}%`;
      G.hudBar.classList.toggle('low', s.hp <= 30);
      G.hudBar.classList.toggle('shield', !!s.sh);
      G.hudCash.textContent = s.fs;
      G.hudRole.textContent = `Manche ${s.round}/${s.rounds} · ${role}`;
    }
    G.hudProg.style.width = `${Math.min(100, el / (s.dur || 75) * 100).toFixed(1)}%`;
    // En attente de renfort
    const note = mine && mine.w > 0 && s.phase === 'play' ? `Tu entres en renfort dans ${mine.w} s` : '';
    if (note !== G.noteTxt) { G.noteTxt = note; G.note.textContent = note; }
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
    const vis = !c.out && !p.behind && p.x > -40 && p.x < L.w + 40 && p.y > 74 && p.y < L.h + 20;
    const x = vis ? Math.round(p.x) : -999, y = vis ? Math.round(p.y) : -999;
    if (x !== c.tx || y !== c.ty) { c.tx = x; c.ty = y; c.tag.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`; }
  }

  // Flèche au bord de l'écran : vers le fugitif pour les flics, vers le flic le plus proche pour le fugitif.
  const me = G.cars.get(view.me);
  let target = null;
  if (me && !me.out && s && s.phase !== 'end') {
    if (me.cop) target = G.cars.get(s.fug);
    else {
      let best = Infinity;
      for (const c of G.cars.values()) {
        if (!c.cop || c.dead || c.out) continue;
        const d = Math.hypot(c.x - me.x, c.z - me.z);
        if (d < best) { best = d; target = c; }
      }
    }
  }
  let show = false;
  if (target) {
    const x0 = 26, x1 = L.w - 26, y0 = 96, y1 = L.h - (playing ? 96 : 30);
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
        el.style.setProperty('--c', me.cop ? (view.players[target.id]?.color || '#fff') : CAR.red);
        el.classList.toggle('near', dist < 30);
      }
    }
  }
  G.arrow.classList.toggle('on', show);
}
