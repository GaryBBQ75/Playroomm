// Rendu 3D de la Course-poursuite (Three.js), dans l'esprit de Pako : low-poly en aplats,
// palette réduite (sable, tons pierre, accents turquoise et corail), ombres nettes.
// Le module gère son propre canvas WebGL, posé juste derrière le HUD : création paresseuse
// au premier dessin, nettoyage complet dans unmount(). Three.js n'est chargé qu'à ce moment-là.
import { sound } from '../lib/fx.js';
import { getMap, rng, SIZE } from '../engine/games/chasemap.js';

// Indique à app.js que ce jeu n'utilise pas le canvas 2D commun.
export const ownCanvas = true;

const U = 0.1;                 // 1 unité serveur = 0,1 unité 3D
const WORLD = SIZE * U;
const FLOOR_H = 3;
const MAX_CARS = 8;
const CAR_SCALE = 1.15;        // voitures un peu grossies pour la lisibilité
const PITCH_ANGLE = 1.1;       // caméra très plongeante (environ 63°)
const FOV = 30;                // focale longue : perspective douce, presque isométrique
const SHADOW_EXT = 64;

// Palette : une ambiance sable unifiée, quelques tons proches pour les immeubles,
// deux accents (turquoise, corail).
const PAL = {
  sky: '#f0e6cf', road: '#d6c398', plinth: '#eee3c8', quay: '#f3e9d0', plaza: '#ebdcb8', park: '#b3ca96',
  build: ['#f7f2e8', '#e7c489', '#dc9c7e', '#8fb3a6'],
  tree: ['#6fae8f', '#5c9c84', '#8cbf96'], trunk: '#8f7358',
  sea: '#6ccbc3', seaLight: '#8fd9d1', turquoise: '#3fb8af', coral: '#f2695c', stone: '#f7f2e6',
  dark: '#2f3142', glass: '#3a4257', white: '#fbfaf5', tyre: '#2a2b38',
  smoke: '#fffaf0', dust: '#cdbb92', bill: '#58b97f', gold: '#f6c453', flame: '#ff9a3c', red: '#ef3b4a', blue: '#3b7df0',
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
  g.bagGeo.dispose(); g.mat.dispose();
  g.renderer.dispose();
  g.renderer.forceContextLoss();
  g.canvas.remove();
}

export function hud(view) {
  const s = view.cur;
  if (!s || !s.cars) return { center: '' };
  const mine = s.cars.find(c => c.id === view.me);
  const role = !mine ? '👀 Spectateur' : s.fug === view.me ? '💰 Tu es le fugitif' : '🚨 Tu es flic';
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
      grav: 20, spin: 4 + Math.random() * 8, color: Array.isArray(color) ? color[i % color.length] : color,
    });
  }
}

export function onEvent(ev, view) {
  if (!G || G.failed) { if (pending.length < 20) pending.push(ev); return; }
  const me = view.me;
  const x = (ev.x || 0) * U, z = (ev.y || 0) * U;
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
      burst(x, 1.4, z, 8 + Math.round(ev.f * 8), [PAL.white, PAL.gold, PAL.dark], { speed: 9, size: 0.45 });
      G.shake = Math.max(G.shake, 0.25 + ev.f * 0.5);
      sound.play('bump');
      break;
    case 'crash':
      burst(x, 0.6, z, 6, [PAL.dust, PAL.stone], { speed: 5, up: 4, size: 0.4, life: 0.55 });
      if (ev.id === me) { G.shake = Math.max(G.shake, 0.2 + ev.f * 0.35); sound.play('hit'); navigator.vibrate?.(20); }
      break;
    case 'cash':
      burst(x, 1.5, z, 22, [PAL.bill, PAL.bill, PAL.white], { speed: 7, up: 11, size: 0.55, life: 1.1, flat: true });
      floatText(x, 2.5, z, '+2', '#fff');
      sound.play('cash');
      if (ev.id === me) navigator.vibrate?.(25);
      break;
    case 'bust':
      burst(x, 1.6, z, 30, [PAL.white, PAL.red, PAL.blue, PAL.gold], { speed: 12, up: 9, size: 0.6, life: 1 });
      stamp('Arrêté !', 'bust');
      flash();
      G.shake = 1;
      G.zoom = 0.78;
      G.focus = ev.id;
      sound.play('siren');
      navigator.vibrate?.(ev.id === me || ev.by === me ? [120, 60, 200] : 60);
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
function mix(a, b, t) { return new THREE.Color(a).lerp(new THREE.Color(b), t); }
function mat4(x, y, z, sx = 1, sy = sx, sz = sx, ry = 0) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));
}

// Assemble beaucoup de petites formes en une seule géométrie (un seul appel de dessin).
// Les couleurs sont portées par les sommets : aucun besoin de texture.
class Geo {
  constructor() { this.p = []; this.c = []; }

  // Pavé aligné sur les axes. `topCol` permet un dessus d'une autre teinte.
  box(x0, y0, z0, x1, y1, z1, color, topCol = null) {
    const P = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const quad = (a, b, c, d, k) => {
      for (const i of [a, b, c, a, c, d]) { this.p.push(P[i][0], P[i][1], P[i][2]); this.c.push(k.r, k.g, k.b); }
    };
    quad(3, 7, 6, 2, topCol || color); // dessus
    quad(4, 5, 6, 7, color);           // sud
    quad(1, 0, 3, 2, color);           // nord
    quad(5, 1, 2, 6, color);           // est
    quad(0, 4, 7, 3, color);           // ouest
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

  // Les normales par face donnent le rendu en aplats.
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

// ---------- Ville ----------
function buildCity(scene) {
  const map = getMap();
  const rand = rng(99);
  const city = new Geo();
  const trees = [];

  // Île : sol sable, quais un peu plus clairs.
  city.box(0, -2, 0, WORLD, 0, WORLD, col(PAL.road));
  const q = 2.2;
  city.box(-q, -2, -q, WORLD + q, 0.3, 0, col(PAL.quay));
  city.box(-q, -2, WORLD, WORLD + q, 0.3, WORLD + q, col(PAL.quay));
  city.box(-q, -2, 0, 0, 0.3, WORLD, col(PAL.quay));
  city.box(WORLD, -2, 0, WORLD + q, 0.3, WORLD, col(PAL.quay));

  // Pâtés : un socle clair et des immeubles en blocs épurés, de hauteurs variées.
  for (const b of map.blocks) {
    const x0 = b.x * U, z0 = b.y * U, x1 = x0 + b.w * U, z1 = z0 + b.h * U;
    city.box(x0, 0, z0, x1, 0.2, z1, col(PAL.plinth));
    for (const bd of b.buildings) {
      const g = 0.18;
      const ax = bd.x * U + g, az = bd.y * U + g, bx = (bd.x + bd.w) * U - g, bz = (bd.y + bd.h) * U - g;
      const tone = PAL.build[bd.color % PAL.build.length];
      const h = 0.2 + (bd.floors + (bd.color > 5 ? 1 : 0)) * FLOOR_H * (0.8 + (bd.awning % 3) * 0.15);
      const roof = mix(tone, '#ffffff', 0.5);
      city.box(ax, 0.2, az, bx, h, bz, col(tone), roof);
      const w = bx - ax, d = bz - az, cx = (ax + bx) / 2, cz = (az + bz) / 2;
      if (bd.roof === 2 && w > 4 && d > 4) {
        // Volume en retrait : silhouette en gradins
        const k = 0.28;
        city.box(ax + w * k, h, az + d * k, bx - w * k * 0.4, h + FLOOR_H, bz - d * k * 0.4, col(tone), roof);
      } else if (bd.roof === 0 && w > 3 && d > 3) {
        // Édicule de toit, parfois d'une couleur d'accent
        const accent = bd.awning === 0 ? PAL.turquoise : bd.awning === 1 ? PAL.coral : null;
        city.box(cx - w * 0.22, h, cz - d * 0.2, cx + w * 0.08, h + 0.9, cz + d * 0.12, accent ? col(accent) : roof, accent ? mix(accent, '#ffffff', 0.3) : col(PAL.stone));
      }
    }
    if (rand() < 0.55) trees.push({ x: x1 - 0.75, y: 0.2, z: z1 - 0.75, s: 0.6, c: Math.floor(rand() * 3) });
    if (rand() < 0.3) trees.push({ x: x0 + 0.75, y: 0.2, z: z0 + 0.75, s: 0.6, c: Math.floor(rand() * 3) });
  }

  // Parcs et place : de simples aplats.
  for (const p of map.parks) {
    const x0 = p.x * U, z0 = p.y * U;
    city.box(x0, 0, z0, x0 + p.w * U, 0.04, z0 + p.h * U, col(PAL.park));
  }
  {
    const p = map.plaza, x0 = p.x * U, z0 = p.y * U;
    city.box(x0, 0, z0, x0 + p.w * U, 0.04, z0 + p.h * U, col(PAL.plaza));
  }
  for (const o of map.circles) {
    const x = o.x * U, z = o.y * U, r = o.r * U;
    if (o.kind === 'tree') trees.push({ x, y: 0, z, s: 1.05 + rand() * 0.3, c: Math.floor(rand() * 3) });
    else if (o.kind === 'bollard') {
      city.add(new THREE.CylinderGeometry(r * 0.8, r, 1.2, 6), mat4(x, 0.6, z), col(PAL.coral));
    } else if (o.kind === 'fountain') {
      city.add(new THREE.CylinderGeometry(r, r + 0.3, 0.9, 8), mat4(x, 0.45, z, 1, 1, 1, Math.PI / 8), col(PAL.stone));
      city.add(new THREE.CylinderGeometry(r - 0.6, r - 0.6, 0.1, 8), mat4(x, 0.92, z, 1, 1, 1, Math.PI / 8), col(PAL.turquoise));
      city.add(new THREE.CylinderGeometry(0.5, 0.8, 2.4, 4), mat4(x, 1.7, z, 1, 1, 1, Math.PI / 4), col(PAL.stone));
      city.add(new THREE.OctahedronGeometry(0.75, 0), mat4(x, 3.5, z), col(PAL.coral));
    } else if (o.kind === 'kiosk') {
      city.box(x - r * 0.8, 0, z - r * 0.8, x + r * 0.8, 2.2, z + r * 0.8, col(PAL.stone));
      city.add(new THREE.ConeGeometry(r * 1.45, 1.5, 4).rotateY(Math.PI / 4), mat4(x, 2.95, z), col(PAL.coral));
    }
  }

  // Quelques voiliers au large, pour le décor.
  for (const [bx, bz, ry] of [[-13, 30, 0.4], [WORLD + 14, 88, 2.2], [52, WORLD + 13, 1.2], [WORLD + 11, 22, 4], [-15, 112, 5.2], [100, -12, 3]]) {
    const m = mat4(bx, -2, bz, 1, 1, 1, ry);
    city.add(new THREE.CylinderGeometry(1.4, 0.8, 1, 4), m.clone().multiply(mat4(0, 0.4, 0, 2, 1, 0.9)), col(PAL.white));
    city.add(new THREE.ConeGeometry(1.6, 4, 3), m.clone().multiply(mat4(0.3, 3, 0, 1, 1, 0.1)), col(PAL.coral));
  }

  const mesh = new THREE.Mesh(city.build(), G.mat);
  mesh.receiveShadow = true; mesh.castShadow = true;
  scene.add(mesh);

  // Arbres : un cône sur un petit tronc, une instance par arbre.
  const dummy = new THREE.Object3D();
  const cone = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 2.6, 6), new THREE.MeshLambertMaterial({ flatShading: true }), trees.length);
  const trunk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 1, 0.4), new THREE.MeshLambertMaterial({ color: PAL.trunk, flatShading: true }), trees.length);
  trees.forEach((t, k) => {
    dummy.rotation.set(0, rand() * 3, 0);
    dummy.position.set(t.x, t.y + 0.45 * t.s, t.z); dummy.scale.setScalar(t.s); dummy.updateMatrix();
    trunk.setMatrixAt(k, dummy.matrix);
    dummy.position.set(t.x, t.y + 2.15 * t.s, t.z); dummy.scale.set(1.15 * t.s, t.s, 1.15 * t.s); dummy.updateMatrix();
    cone.setMatrixAt(k, dummy.matrix); cone.setColorAt(k, col(PAL.tree[t.c]));
  });
  cone.castShadow = trunk.castShadow = true;
  scene.add(cone, trunk);

  // Mer : un aplat turquoise, et une frange plus claire autour de l'île.
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800), new THREE.MeshBasicMaterial({ color: PAL.sea }));
  sea.rotation.x = -Math.PI / 2; sea.position.set(WORLD / 2, -2, WORLD / 2);
  const fringe = new THREE.Mesh(new THREE.PlaneGeometry(WORLD + 10, WORLD + 10), new THREE.MeshBasicMaterial({ color: PAL.seaLight }));
  fringe.rotation.x = -Math.PI / 2; fringe.position.set(WORLD / 2, -1.95, WORLD / 2);
  scene.add(sea, fringe);
}

// ---------- Voitures : quelques blocs, façon Pako ----------
function carGeometry(kind, hex) {
  const geo = new Geo();
  const box = (x0, y0, z0, x1, y1, z1, c) => geo.box(x0, y0, z0, x1, y1, z1, col(c));
  if (kind === 'cop') {
    // Avant et arrière noirs, portières blanches, fine ligne à la couleur du joueur sur le toit
    box(0.75, 0.38, -1.15, 2.3, 1.12, 1.15, PAL.dark);
    box(-1.1, 0.38, -1.18, 0.75, 1.16, 1.18, PAL.white);
    box(-2.3, 0.38, -1.15, -1.1, 1.12, 1.15, PAL.dark);
    box(-1.25, 1.14, -0.98, 0.7, 1.75, 0.98, PAL.glass);
    box(-1.1, 1.75, -0.92, 0.55, 1.9, 0.92, PAL.white);
    box(-1.1, 1.9, -0.16, 0.55, 1.95, 0.16, hex);
    box(-0.5, 1.9, -0.8, -0.05, 2.02, 0.8, PAL.dark);
  } else {
    // Bolide du fugitif : tout à la couleur du joueur, long capot, petit aileron
    const deep = '#' + mix(hex, '#1d1b2e', 0.28).getHexString();
    box(-2.35, 0.36, -1.15, 2.35, 1.08, 1.15, hex);
    box(-1.55, 1.08, -0.98, 0.35, 1.66, 0.98, PAL.glass);
    box(-1.4, 1.66, -0.9, 0.2, 1.8, 0.9, deep);
    box(-2.4, 1.08, -1.15, -1.95, 1.5, 1.15, deep);
    box(0.9, 1.08, -0.3, 2.2, 1.13, 0.3, PAL.white);
  }
  box(2.3, 0.7, -1.0, 2.38, 0.98, -0.5, '#fff3c4');
  box(2.3, 0.7, 0.5, 2.38, 0.98, 1.0, '#fff3c4');
  box(-2.4, 0.74, -1.0, -2.32, 0.98, 1.0, PAL.red);
  return geo.build();
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
    x: WORLD / 2, z: WORLD / 2, a: 0, v: 0, spin: 0, lean: 0, yaw: 0,
    cop: false, skid: false, turbo: false, wl: null, wr: null, known: false, tagTxt: '', tx: 0, ty: 0,
  };
  G.cars.set(id, c);
  return c;
}

function dressCar(c, kind, hex) {
  if (c.kind === kind && c.color === hex) return;
  if (c.mesh) { c.body.remove(c.mesh); c.mesh.geometry.dispose(); }
  c.mesh = new THREE.Mesh(carGeometry(kind, hex), G.mat);
  c.mesh.castShadow = true;
  c.body.add(c.mesh);
  c.kind = kind; c.color = hex;
  c.wl = c.wr = null;
}

function flame(c, k = 1) {
  const bx = c.x - Math.cos(c.a) * 3, bz = c.z - Math.sin(c.a) * 3, s = 0.35 + Math.random() * 0.4;
  G.lights.add({
    x: bx + (Math.random() - 0.5) * 0.9, y: 0.9, z: bz + (Math.random() - 0.5) * 0.9,
    vx: -Math.cos(c.a) * 8 * k + (Math.random() - 0.5) * 3, vy: 1 + Math.random() * 2, vz: -Math.sin(c.a) * 8 * k + (Math.random() - 0.5) * 3,
    sx: s, sy: s, sz: s, life: 0.3, spin: 8, color: Math.random() < 0.5 ? PAL.flame : PAL.gold,
  });
}

// ---------- Particules : de petits cubes (fumée, débris, billets), tous dans un InstancedMesh ----------
class Cubes {
  constructor(max, lit) {
    this.max = max;
    this.list = [];
    this.once = [];   // cubes posés pour une seule image (gyrophares)
    const mat = lit ? new THREE.MeshLambertMaterial({ flatShading: true }) : new THREE.MeshBasicMaterial();
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, col(PAL.white));
    this.d = new THREE.Object3D();
  }

  add(p) {
    if (this.list.length >= this.max - 20) this.list.shift();
    this.list.push({ vx: 0, vy: 0, vz: 0, grav: 0, grow: 0, spin: 0, drag: 1.5, rot: Math.random() * 6, ...p, max: p.life });
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
      if (p.y < 0.15 && p.grav) { p.y = 0.15; p.vy *= -0.4; p.vx *= 0.6; p.vz *= 0.6; p.spin *= 0.5; }
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

// ---------- Traces de pneus : un ruban de quadrilatères qui s'estompent ----------
class SkidMarks {
  constructor(max = 420) {
    this.max = max; this.next = 0;
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
    this.tint = col('#6b5a45');
  }

  reset() { this.age.fill(99); this.colr.fill(0); this.mesh.geometry.attributes.color.needsUpdate = true; }

  // Tronçon de trace entre deux positions d'une roue.
  add(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz);
    if (l < 0.02 || l > 6) return;
    const nx = -dz / l * 0.22, nz = dx / l * 0.22, i = this.next, y = 0.07;
    this.pos.set([ax - nx, y, az - nz, ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz], i * 12);
    this.age[i] = 0;
    this.next = (i + 1) % this.max;
    this.mesh.geometry.attributes.position.needsUpdate = true;
  }

  update(dt) {
    const t = this.tint;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > 7) continue;
      this.age[i] += dt;
      const a = Math.max(0, 0.55 * (1 - this.age[i] / 7));
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

function flash() {
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

  // Le ciel, le brouillard et l'horizon partagent la même teinte sable : tout se fond au loin.
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.sky);
  scene.fog = new THREE.Fog(PAL.sky, 200, 480);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 30, 1400);

  // Lumière douce et chaude, ombres portées nettes.
  scene.add(new THREE.HemisphereLight('#fff8e8', '#d9c49a', 1.2));
  const sun = new THREE.DirectionalLight('#fff1d6', 2.5);
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
    cars: new Map(), bags: new Map(), tmp: new THREE.Vector3(), dummy: new THREE.Object3D(),
    cam: { x: WORLD / 2, z: WORLD / 2, d: 0 }, zoom: 1.4, snapCam: true, shake: 0, focus: null,
    last: 0, time: 0, countTxt: '', skidAt: 0, sirenAt: 0,
    // Qualité adaptative : on baisse la définition si le téléphone peine.
    quality: Math.min(3, savedQuality), slow: 0, frameMs: 16, pr: 1,
  };
  // Un seul matériau en aplats pour la ville, les voitures et les sacs.
  G.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

  buildCity(scene);

  // Roues : une seule géométrie instanciée pour toutes les voitures.
  const wheel = new Geo();
  wheel.add(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 8), new THREE.Matrix4().makeRotationX(Math.PI / 2), col(PAL.tyre));
  wheel.box(-0.3, -0.12, -0.27, 0.3, 0.12, 0.27, col('#b9b6ad'));
  G.wheels = new THREE.InstancedMesh(wheel.build(), G.mat, MAX_CARS * 4);
  G.wheels.castShadow = true; G.wheels.frustumCulled = false; G.wheels.count = 0;
  scene.add(G.wheels);

  // Petit marqueur triangulaire à la couleur du joueur, au-dessus de chaque voiture
  // (toujours visible, même derrière un immeuble).
  const pin = new THREE.ConeGeometry(0.7, 1.15, 3).rotateX(Math.PI);
  G.pins = new THREE.InstancedMesh(pin, new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }), MAX_CARS);
  G.pins.frustumCulled = false; G.pins.count = 0; G.pins.renderOrder = 8;
  scene.add(G.pins);

  G.marks = new SkidMarks();
  G.cubes = new Cubes(360, true);
  G.lights = new Cubes(120, false);
  scene.add(G.marks.mesh, G.cubes.mesh, G.lights.mesh);

  // Sac de butin : une liasse de billets en trois blocs.
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

  if (s?.cars) {
    syncCars(view, dt);
    syncBags(s, dt);
  }
  updateCamera(view, dt, playing);
  updateOverlay(view, playing);
  G.marks.update(dt);
  G.cubes.update(dt);
  G.lights.update(dt);
  G.renderer.render(G.scene, G.camera);
}

function syncCars(view, dt) {
  const s = view.cur, p = view.prev, a = view.alpha;
  const prevCars = p?.cars && p.round === s.round ? p.cars : null;
  const seen = new Set();
  let wi = 0, pi = 0;
  const blink = Math.floor(G.time * 7) % 2;
  for (const cur of s.cars) {
    seen.add(cur.id);
    const c = G.cars.get(cur.id) || makeCar(cur.id);
    const pl = view.players[cur.id];
    const hex = pl?.color || '#888888';
    dressCar(c, cur.cop ? 'cop' : 'robber', hex);
    c.cop = !!cur.cop;

    // Interpolation entre les deux derniers instantanés (angle par le plus court chemin).
    const pv = prevCars?.find(o => o.id === cur.id);
    let x = cur.x * U, z = cur.y * U, ang = cur.a;
    if (pv && Math.hypot(pv.x - cur.x, pv.y - cur.y) < 80) {
      x = lerp(pv.x, cur.x, a) * U; z = lerp(pv.y, cur.y, a) * U;
      ang = pv.a + wrap(cur.a - pv.a) * a;
    }
    const moved = c.known ? Math.hypot(x - c.x, z - c.z) : 0;
    if (moved > 8) { c.wl = c.wr = null; }
    const yaw = c.known && dt > 0 ? wrap(ang - c.a) / dt : 0;
    c.yaw += (clamp(yaw, -6, 6) - c.yaw) * Math.min(1, dt * 10);
    c.x = x; c.z = z; c.a = ang; c.v = cur.v; c.known = true;
    c.spin += moved / (0.55 * CAR_SCALE);
    c.skid = !!cur.sk; c.turbo = !!cur.tb;

    // Carrosserie : roulis dans les virages, cabrage au turbo.
    const roll = clamp(c.yaw * 0.035 * Math.min(1, cur.v / 150), -0.16, 0.16);
    c.lean += (roll - c.lean) * Math.min(1, dt * 9);
    c.root.position.set(x, 0, z);
    c.root.rotation.y = -ang;
    c.body.rotation.x = c.lean;
    c.body.rotation.z = c.turbo ? 0.06 : 0;

    // Roues
    const cos = Math.cos(ang), sin = Math.sin(ang);
    for (const [wx, wz] of [[1.45, -1.1], [1.45, 1.1], [-1.45, -1.1], [-1.45, 1.1]]) {
      const lx = wx * CAR_SCALE, lz = wz * CAR_SCALE;
      G.dummy.position.set(x + cos * lx - sin * lz, 0.55 * CAR_SCALE, z + sin * lx + cos * lz);
      G.dummy.scale.setScalar(CAR_SCALE);
      G.dummy.rotation.set(0, 0, 0);
      G.dummy.rotateY(-ang - (wx > 0 ? clamp(c.yaw * 0.08, -0.4, 0.4) : 0));
      G.dummy.rotateZ(-c.spin);
      G.dummy.updateMatrix();
      G.wheels.setMatrixAt(wi++, G.dummy.matrix);
    }

    // Marqueur triangulaire (le mien est plus gros et sautille)
    const mine = cur.id === view.me;
    G.dummy.rotation.set(0, G.time * 2, 0);
    G.dummy.position.set(x, 4.6 + (mine ? 0.35 * Math.abs(Math.sin(G.time * 5)) : 0), z);
    G.dummy.scale.setScalar(mine ? 1.35 : 1);
    G.dummy.updateMatrix();
    G.pins.setMatrixAt(pi, G.dummy.matrix); G.pins.setColorAt(pi, col(hex));
    pi += 1;

    // Dérapage : cubes de fumée et traces des roues arrière.
    const ox = 1.45 * CAR_SCALE, oz = 1.1 * CAR_SCALE;
    const rlx = x - cos * ox + sin * oz, rlz = z - sin * ox - cos * oz;
    const rrx = x - cos * ox - sin * oz, rrz = z - sin * ox + cos * oz;
    if (c.skid) {
      if (c.wl) { G.marks.add(c.wl[0], c.wl[1], rlx, rlz); G.marks.add(c.wr[0], c.wr[1], rrx, rrz); }
      c.wl = [rlx, rlz]; c.wr = [rrx, rrz];
      if (Math.random() < dt * 30) {
        const left = Math.random() < 0.5, k = 0.45 + Math.random() * 0.35;
        G.cubes.add({ x: left ? rlx : rrx, y: 0.5, z: left ? rlz : rrz, vx: (Math.random() - 0.5) * 2, vy: 1.5 + Math.random(), vz: (Math.random() - 0.5) * 2, sx: k, sy: k, sz: k, grow: 1.3, life: 0.7, spin: 2, color: PAL.smoke });
      }
      if (mine && G.time - G.skidAt > 0.28) { G.skidAt = G.time; sound.play('skid'); }
    } else { c.wl = c.wr = null; }
    if (c.turbo && Math.random() < dt * 50) flame(c);

    // Gyrophare : deux blocs rouge et bleu qui s'allument en alternance.
    if (c.cop) {
      const lx = -0.28 * CAR_SCALE, ly = 2.2 * CAR_SCALE, lz = 0.42 * CAR_SCALE;
      G.lights.put(x + cos * lx - sin * lz, ly, z + sin * lx + cos * lz, 0.5, blink ? 0.3 : 0.5, 0.75, -ang, blink ? '#7a3340' : '#ff4d5e');
      G.lights.put(x + cos * lx + sin * lz, ly, z + sin * lx - cos * lz, 0.5, blink ? 0.5 : 0.3, 0.75, -ang, blink ? '#5aa2ff' : '#3a4a78');
    }
  }
  G.wheels.count = wi; G.wheels.instanceMatrix.needsUpdate = true;
  G.pins.count = pi; G.pins.instanceMatrix.needsUpdate = true;
  if (G.pins.instanceColor) G.pins.instanceColor.needsUpdate = true;

  // Voitures de joueurs partis
  for (const [id, c] of G.cars) {
    if (seen.has(id)) continue;
    G.scene.remove(c.root); c.mesh?.geometry.dispose(); c.tag.remove();
    G.cars.delete(id);
  }

  // Sirène de temps en temps quand un flic passe tout près du fugitif.
  const fug = G.cars.get(s.fug);
  if (fug && s.phase === 'play' && G.time - G.sirenAt > 2.4) {
    let near = Infinity;
    for (const c of G.cars.values()) if (c.cop) near = Math.min(near, Math.hypot(c.x - fug.x, c.z - fug.z));
    if (near < 22) { G.sirenAt = G.time; sound.play('siren'); }
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
      o.userData = { t: Math.random() * 6, grow: 0 };
      G.scene.add(o);
      G.bags.set(b.i, o);
    }
    // La liasse flotte, tourne et se penche un peu.
    const d = o.userData;
    d.t += dt; d.grow = Math.min(1, d.grow + dt * 4);
    o.position.y = 1.1 + Math.sin(d.t * 3) * 0.35;
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
    tx = t.x + Math.cos(t.a) * sp * 3; tz = t.z + Math.sin(t.a) * sp * 3;
  }
  const k = G.snapCam ? 1 : 1 - Math.exp(-7 * dt);
  G.cam.x += (tx - G.cam.x) * k; G.cam.z += (tz - G.cam.z) * k;
  G.snapCam = false;
  // Cadrage serré : environ deux pâtés de large en portrait. Un peu de recul quand on va vite.
  G.zoom += (1 - G.zoom) * (1 - Math.exp(-(G.zoom > 1 ? 1.6 : 3.5) * dt));
  if (s?.phase === 'end' && G.focus) G.zoom = Math.min(G.zoom, 0.85);
  const aspect = L.w / L.h;
  const tanH = Math.tan(FOV * Math.PI / 360);
  const base = aspect < 1 ? clamp(24 / (tanH * aspect), 110, 230) : clamp(46 / (tanH * aspect), 78, 140);
  const want = base * (1 + 0.1 * sp) * G.zoom;
  G.cam.d = G.cam.d ? G.cam.d + (want - G.cam.d) * Math.min(1, dt * 4) : want;
  const d = G.cam.d;
  G.shake = Math.max(0, G.shake - dt * 2.2);
  const sh = G.shake * G.shake * 1.4;
  const cx = G.cam.x + (Math.random() - 0.5) * sh, cz = G.cam.z + (Math.random() - 0.5) * sh;
  G.camera.position.set(cx, Math.sin(PITCH_ANGLE) * d, cz + Math.cos(PITCH_ANGLE) * d);
  G.camera.lookAt(cx, 0, cz);
  // Cadrage décalé : la moitié basse de l'écran est prise par le joystick et les boutons.
  const off = L.portrait ? (playing ? 0.14 : 0.04) : 0.05;
  G.camera.setViewOffset(L.w, L.h, 0, L.h * off, L.w, L.h);
  G.scene.fog.near = d + 40; G.scene.fog.far = d + 330;

  // La lumière et sa carte d'ombres suivent la caméra, par pas entiers pour éviter le scintillement.
  const step = (2 * SHADOW_EXT) / 2048 * 8;
  const lx = Math.round(G.cam.x / step) * step, lz = Math.round((G.cam.z + (L.portrait ? 8 : 0)) / step) * step;
  G.sun.target.position.set(lx, 0, lz);
  G.sun.position.set(lx - 70, 125, lz + 48);
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
    const p = project(c.x, 7.6, c.z);
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
        if (!c.cop) continue;
        const d = Math.hypot(c.x - me.x, c.z - me.z);
        if (d < best) { best = d; target = c; }
      }
    }
  }
  let show = false;
  if (target) {
    const bottom = L.portrait && playing ? L.h * 0.56 : L.h - 30;
    const x0 = 26, x1 = L.w - 26, y0 = 74, y1 = bottom;
    const m = project(me.x, 1, me.z);
    const mx = clamp(m.x, x0, x1), my = clamp(m.y, y0, y1);
    const p = project(target.x, 1, target.z);
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
        el.style.setProperty('--c', me.cop ? (view.players[target.id]?.color || '#fff') : PAL.coral);
        el.classList.toggle('near', dist < 30);
      }
    }
  }
  G.arrow.classList.toggle('on', show);
}
