import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Crew } from './crew.js';
import { Store } from './store.js';
import { catalog } from './games/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');

const store = new Store(DATA_DIR);

// Serveurs ICE pour la visio. Un serveur TURN (TURN_URL, TURN_USER, TURN_PASS) aide
// quand certains réseaux mobiles bloquent la connexion directe.
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
if (process.env.TURN_URL) {
  ICE_SERVERS.push({ urls: process.env.TURN_URL.split(','), username: process.env.TURN_USER || '', credential: process.env.TURN_PASS || '' });
}
const crews = new Map();

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon',
};

function cleanName(v, max = 16) {
  return String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
}

function newCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 5; i++) c += letters[crypto.randomInt(letters.length)];
    if (!store.get(c)) return c;
  }
}

function getCrew(code) {
  code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  if (crews.has(code)) return crews.get(code);
  const rec = store.get(code);
  if (!rec) return null;
  const crew = new Crew(rec, store);
  crews.set(code, crew);
  return crew;
}

function sendFile(res, file) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end('Introuvable'); return; }
    const ext = path.extname(file);
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(buf);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  if (p === '/healthz' || p === '/readyz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', crews: crews.size }));
    return;
  }
  if (p === '/api/catalog') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(catalog()));
    return;
  }
  if (p === '/' || p.startsWith('/c/') || p === '/solo') return sendFile(res, path.join(PUBLIC, 'index.html'));
  // Moteur de jeu partagé : le mode solo le fait tourner directement dans le navigateur.
  if (/^\/engine\/(crew\.js|games\/[a-z]+\.js)$/.test(p)) {
    return sendFile(res, path.join(ROOT, 'server', p.slice('/engine/'.length)));
  }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); res.end(); return; }
  sendFile(res, file);
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024 });

wss.on('connection', ws => {
  let crew = null;
  let pid = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  const send = s => { if (ws.readyState === 1) ws.send(s); };

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'hello') {
      if (crew) return;
      const id = String(msg.pid || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
      const name = cleanName(msg.name);
      if (id.length < 8 || !name) { send(JSON.stringify({ type: 'error', message: 'Choisis un pseudo.' })); return; }
      let c;
      if (msg.create) {
        const crewName = (typeof msg.create === 'string' && cleanName(msg.create, 28)) || `Le crew de ${name}`;
        const rec = store.create(newCode(), crewName);
        c = getCrew(rec.code);
      } else {
        c = getCrew(msg.crew);
        if (!c) { send(JSON.stringify({ type: 'error', message: 'Ce crew n\'existe pas. Vérifie le code.', code: 'nocrew' })); return; }
      }
      // Même joueur ouvert dans un autre onglet : on remplace l'ancienne connexion.
      const existing = c.players.get(id);
      if (existing?.online && existing.ws && existing.ws !== ws) {
        try { existing.ws.close(4000, 'Ouvert ailleurs'); } catch { /* rien */ }
      }
      const r = c.join(id, name, send);
      if (r.error) { send(JSON.stringify({ type: 'error', message: r.error })); return; }
      c.players.get(id).ws = ws;
      crew = c; pid = id;
      send(JSON.stringify({ type: 'welcome', you: pid, catalog: catalog(), iceServers: ICE_SERVERS }));
      send(JSON.stringify(crew.state()));
      return;
    }
    if (crew && pid) crew.handle(pid, msg);
  });

  ws.on('close', () => {
    if (crew && pid) {
      const p = crew.players.get(pid);
      if (p && p.ws === ws) crew.leave(pid);
    }
  });
});

// Battements de cœur et ménage des crews inactifs en mémoire.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, c] of crews) {
    if (!c.humans().length && c.emptySince && now - c.emptySince > 30 * 60 * 1000) {
      c.clearTimers();
      crews.delete(code);
    }
  }
}, 20000);

function shutdown() {
  try { store.flushSync(); } catch (e) { console.error(e); }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`Playroom prêt sur http://localhost:${PORT}`));
