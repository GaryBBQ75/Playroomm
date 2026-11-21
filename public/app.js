import { createControls } from './lib/input.js';
import { createVisio } from './lib/visio.js';
import { fx, sound } from './lib/fx.js';
import * as arena from './games/arena.js';
import * as clash from './games/clash.js';
import * as defense from './games/defense.js';

const RENDERERS = { sumo: arena, potato: arena, brawl: arena, clash, defense };
const EMOTES = ['😂', '🔥', '😱', '👏', '😈', '💀'];

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const avatar = (color, small = false) => `<span class="av ${small ? 'small' : ''}" style="background:${esc(color)}"><i></i><i></i></span>`;

// ---------- Identité locale ----------
const store = {
  get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* rien */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* rien */ } },
};
let pid = store.get('pr_pid');
if (!pid) {
  pid = 'p_' + (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36));
  store.set('pr_pid', pid);
}

const S = {
  ws: null, hello: null, connected: false, retry: 0,
  catalog: [], state: null, you: pid,
  prev: null, cur: null, curAt: 0, priv: null, snapGame: null,
  emotes: {}, screen: null, endAt: 0,
};

// ---------- Réseau ----------
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  S.ws = ws;
  ws.onopen = () => {
    S.connected = true; S.retry = 0;
    $('conn').classList.add('hidden');
    if (S.hello) send(S.hello);
  };
  ws.onmessage = e => onMessage(JSON.parse(e.data));
  ws.onclose = ev => {
    S.connected = false;
    if (ev.code === 4000) { toast('Ouvert dans un autre onglet'); return; }
    if (!S.hello) return;
    $('conn').classList.remove('hidden');
    $('conn').textContent = 'Reconnexion…';
    S.retry = Math.min(S.retry + 1, 6);
    setTimeout(connect, 400 * S.retry);
  };
}
function send(obj) {
  if (S.local) { S.local.handle(pid, obj); return; }
  if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(obj));
}

// ---------- Mode solo : le moteur tourne dans le navigateur, contre des bots ----------
async function startSolo() {
  sound.unlock();
  const name = $('in-name').value.trim() || store.get('pr_name') || 'Moi';
  store.set('pr_name', name);
  const [{ Crew }, { catalog }] = await Promise.all([import('./engine/crew.js'), import('./engine/games/index.js')]);
  let rec;
  try { rec = JSON.parse(store.get('pr_solo') || 'null'); } catch { rec = null; }
  if (!rec || !rec.season) rec = { code: 'SOLO', name: 'Mode solo', createdAt: Date.now(), season: {}, history: [] };
  const crew = new Crew(rec, { save() { store.set('pr_solo', JSON.stringify(rec)); } });
  S.local = crew;
  S.hello = null;
  onMessage({ type: 'welcome', you: pid, catalog: catalog() });
  crew.join(pid, name, str => onMessage(JSON.parse(str)));
  for (let i = 0; i < 3; i++) crew.addBot();
}

function joinCrew(hello) {
  sound.unlock();
  S.hello = { type: 'hello', pid, ...hello };
  if (S.ws && S.ws.readyState === 1) send(S.hello);
  else if (!S.ws || S.ws.readyState > 1) connect();
}

function onMessage(m) {
  switch (m.type) {
    case 'welcome':
      S.catalog = m.catalog;
      visio.setIce(m.iceServers);
      break;
    case 'error':
      if (m.code === 'nocrew') { store.del('pr_crew'); S.hello = null; history.replaceState(null, '', '/'); }
      if (!S.state) { showHome(); $('home-err').textContent = m.message; S.hello = null; }
      else toast(m.message);
      break;
    case 'state':
      onState(m);
      break;
    case 'snap':
      if (S.snapGame !== m.g) { S.prev = null; S.snapGame = m.g; }
      else S.prev = S.cur;
      S.cur = m.s;
      S.priv = m.me;
      S.curAt = performance.now();
      if (m.s.ev) {
        const r = RENDERERS[m.g];
        for (const ev of m.s.ev) r?.onEvent(ev, view());
      }
      break;
    case 'signal':
      visio.onSignal(m.from, m.data);
      break;
    case 'emote': {
      S.emotes[m.id] = { e: m.e, t: performance.now() };
      const p = S.state?.players.find(x => x.id === m.id);
      const inArena = S.screen === 's-game' && arena === RENDERERS[S.state?.gameId] && S.state?.participants.includes(m.id);
      if (p && !inArena) toast(`${p.name} ${m.e}`);
      break;
    }
    default:
  }
}

// ---------- Écrans ----------
function show(id) {
  if (S.screen === id) return;
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id === id));
  const prev = S.screen;
  S.screen = id;
  if (prev === 's-game') leaveGame();
  if (id === 's-game') enterGame();
}

function isHost() { return S.state?.hostId === pid; }

function onState(st) {
  const first = !S.state;
  S.state = st;
  S.endAt = performance.now() + (st.remaining || 0);
  document.body.classList.toggle('solo', !!S.local);
  if (!S.local) visio.sync(st.players);
  if (!S.local) {
    store.set('pr_crew', st.crew.code);
    if (first || location.pathname !== `/c/${st.crew.code}`) history.replaceState(null, '', `/c/${st.crew.code}`);
  }
  document.querySelectorAll('.host-only').forEach(el => el.classList.toggle('hidden', !isHost()));
  const map = { lobby: 's-lobby', vote: 's-vote', spin: 's-spin', intro: 's-intro', playing: 's-game', results: 's-results' };
  const target = map[st.phase] || 's-lobby';
  if (target !== 's-game') { S.cur = null; S.prev = null; S.priv = null; S.snapGame = null; }
  show(target);
  if (target === 's-lobby') renderLobby();
  if (target === 's-vote') renderVote();
  if (target === 's-spin') renderSpin();
  if (target === 's-intro') renderIntro();
  if (target === 's-results') renderResults();
  if (target === 's-game') refreshGameChrome();
  placeVideos();
}

function gameDef(id) { return S.catalog.find(g => g.id === id); }

function showHome() {
  S.state = null;
  show('s-home');
  const m = location.pathname.match(/^\/c\/([A-Za-z0-9]{4,8})/);
  const name = store.get('pr_name');
  $('in-name').value = name;
  const last = store.get('pr_crew');
  if (m) {
    $('join-invite').classList.remove('hidden');
    $('home-actions').classList.add('hidden');
    $('invite-code').textContent = m[1].toUpperCase();
  } else {
    $('join-invite').classList.add('hidden');
    $('home-actions').classList.remove('hidden');
    $('btn-resume').classList.toggle('hidden', !last);
    $('btn-resume').textContent = `↩ Reprendre mon crew ${last}`;
  }
}

function needName() {
  const n = $('in-name').value.trim();
  if (!n) { $('home-err').textContent = 'Choisis d\'abord un pseudo 🙂'; $('in-name').focus(); return null; }
  store.set('pr_name', n);
  $('home-err').textContent = '';
  return n;
}

$('btn-create').onclick = () => { const n = needName(); if (n) joinCrew({ name: n, create: $('in-crew-name').value.trim() || true }); };
$('btn-join').onclick = () => {
  const n = needName(); if (!n) return;
  const code = $('in-code').value.trim().toUpperCase();
  if (code.length < 4) { $('home-err').textContent = 'Entre le code du crew'; return; }
  joinCrew({ name: n, crew: code });
};
$('btn-join-invite').onclick = () => { const n = needName(); if (n) joinCrew({ name: n, crew: $('invite-code').textContent }); };
$('btn-solo').onclick = () => startSolo();
$('btn-resume').onclick = () => { const n = needName(); if (n) joinCrew({ name: n, crew: store.get('pr_crew') }); };
$('in-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });

// ---------- Lobby ----------
let tab = 'season';
function renderLobby() {
  const st = S.state;
  $('crew-name').textContent = st.crew.name;
  $('crew-code').textContent = S.local ? 'Solo contre des bots' : `${st.crew.code} · Inviter`;
  $('btn-share').disabled = !!S.local;
  const slots = [];
  for (const p of st.players) {
    slots.push(`<div class="pl">${p.id === st.hostId ? '<span class="crown">👑</span>' : ''}${avatar(p.color).replace('class="av', `data-vid="${esc(p.id)}" class="av`)}<span class="name">${esc(p.name)}${p.id === pid ? ' (toi)' : ''}</span>${p.bot ? '<span class="tag">bot</span>' : ''}</div>`);
  }
  for (let i = st.players.length; i < 8; i++) slots.push('<div class="pl empty"><span class="av"></span><span class="name">libre</span></div>');
  $('lobby-players').innerHTML = slots.join('');
  const host = isHost();
  $('host-tools').classList.toggle('hidden', !host);
  $('btn-start').classList.toggle('hidden', !host);
  $('lobby-wait').classList.toggle('hidden', host);
  $('btn-start').disabled = !st.eligible.length;
  $('btn-bot-rem').disabled = !st.players.some(p => p.bot);
  $('btn-bot-add').disabled = st.players.length >= 8;
  renderTabs();
}

function renderTabs() {
  const st = S.state;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  ['season', 'history', 'catalog'].forEach(t => $('tab-' + t).classList.toggle('hidden', t !== tab));
  $('tab-season').innerHTML = st.season.length
    ? st.season.map((r, i) => `<div class="lb ${r.id === pid ? 'me' : ''}"><span class="rk">${['🥇', '🥈', '🥉'][i] || i + 1}</span>${avatar(r.color || '#888', true)}<span class="nm">${esc(r.name)}<div class="sub">${r.wins} victoire${r.wins > 1 ? 's' : ''} · ${r.played} partie${r.played > 1 ? 's' : ''}</div></span><span class="pts">${r.pts}</span></div>`).join('')
    : '<p class="empty-note">Pas encore de points. Lancez une partie pour ouvrir la saison !</p>';
  $('tab-history').innerHTML = st.history.length
    ? st.history.map(h => { const g = gameDef(h.game); return `<div class="game-item"><span class="em">${g?.emoji || '🎮'}</span><div><b>${esc(h.title)}</b><small>${esc(g?.name || h.game)} · ${ago(h.at)}</small></div></div>`; }).join('')
    : '<p class="empty-note">Aucune partie jouée pour l\'instant.</p>';
  $('tab-catalog').innerHTML = S.catalog.map(g => `<div class="game-item"><span class="em">${g.emoji}</span><div><b>${esc(g.name)}</b><small>${esc(g.tagline)}</small><div><span class="pill ${g.family}">${g.family}</span><span class="pill">${g.duration}</span><span class="pill">${g.minPlayers === 1 ? '1' : g.minPlayers}-${g.maxPlayers} joueurs</span></div></div></div>`).join('');
}

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'à l\'instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

document.querySelectorAll('.tab').forEach(t => t.onclick = () => { tab = t.dataset.tab; renderTabs(); });
$('btn-start').onclick = () => { sound.unlock(); send({ type: 'start' }); };
$('btn-bot-add').onclick = () => send({ type: 'addBot' });
$('btn-bot-rem').onclick = () => send({ type: 'removeBot' });
$('btn-leave').onclick = () => {
  visio.destroy();
  if (S.local) { S.local.leave(pid); S.local = null; S.state = null; showHome(); return; }
  S.hello = null;
  store.del('pr_crew');
  try { S.ws?.close(); } catch { /* rien */ }
  history.replaceState(null, '', '/');
  showHome();
};
$('btn-share').onclick = async () => {
  const url = `${location.origin}/c/${S.state.crew.code}`;
  const text = `Rejoins mon crew "${S.state.crew.name}" sur Playroom 🎮`;
  try {
    if (navigator.share) { await navigator.share({ title: 'Playroom', text, url }); return; }
  } catch { return; }
  try { await navigator.clipboard.writeText(url); toast('Lien copié, envoie-le à ta bande !'); } catch { prompt('Copie ce lien :', url); }
};
const updateSoundBtn = () => { $('btn-sound').textContent = sound.muted ? '🔇' : '🔊'; };
$('btn-sound').onclick = () => { sound.toggle(); updateSoundBtn(); };
updateSoundBtn();

// ---------- Visio ----------
const visio = createVisio({ send: o => send(o), me: pid, onChange: () => { placeVideos(); updateVisioButtons(); }, toast: m => toast(m) });

function updateVisioButtons() {
  $('btn-cam').textContent = visio.on ? '📷 Couper ma caméra' : '📷 Activer ma caméra';
  $('btn-cam').classList.toggle('primary', visio.on);
  $('btn-mic').classList.toggle('hidden', !visio.on);
  $('btn-mic').textContent = visio.mic ? '🎙️ Micro activé' : '🔇 Micro coupé';
  $('btn-cam-game').textContent = visio.on ? '📷' : '🚫';
}

// Range chaque vidéo dans sa pastille (crew) ou dans la bande de visages (jeu, vote, résultats).
function placeVideos() {
  const pool = $('visio-pool');
  const st = S.state;
  const humans = (st?.players || []).filter(p => !p.bot);
  const withVideo = humans.filter(p => visio.videoOf(p.id));
  const used = new Set();
  const strip = $('visio-strip');
  const showStrip = !S.local && st && S.screen && !['s-home', 's-lobby'].includes(S.screen) && withVideo.length > 0;
  strip.classList.toggle('on', !!showStrip);
  if (S.screen === 's-lobby') {
    document.querySelectorAll('#lobby-players .av[data-vid]').forEach(av => {
      const v = visio.videoOf(av.dataset.vid);
      av.classList.toggle('has-video', !!v);
      if (v) { if (v.parentNode !== av) av.appendChild(v); used.add(v); v.play?.().catch(() => {}); }
    });
  }
  if (showStrip) {
    const key = withVideo.map(p => p.id + p.color).join();
    if (strip.dataset.key !== key) {
      strip.dataset.key = key;
      strip.innerHTML = withVideo.map(p => `<div class="vb" data-vid="${esc(p.id)}" style="border-color:${esc(p.color)}"><span>${esc(p.name)}</span></div>`).join('');
    }
    strip.querySelectorAll('.vb').forEach(el => {
      const v = visio.videoOf(el.dataset.vid);
      if (v) { if (v.parentNode !== el) el.prepend(v); used.add(v); v.play?.().catch(() => {}); }
    });
  }
  // Les vidéos non affichées restent dans la page pour garder le son.
  for (const p of humans) {
    const v = visio.videoOf(p.id);
    if (v && !used.has(v) && v.parentNode !== pool) { pool.appendChild(v); v.play?.().catch(() => {}); }
  }
}

$('btn-cam').onclick = async () => { sound.unlock(); if (visio.on) visio.stop(); else await visio.start(); };
$('btn-mic').onclick = () => visio.toggleMic();
$('btn-cam-game').onclick = async () => { if (visio.on) visio.stop(); else await visio.start(); };

// ---------- Vote ----------
function voteCard(g, extra = '', voters = []) {
  return `<div class="em">${g.emoji}</div><div class="info"><b>${esc(g.name)}</b><small>${esc(g.tagline)}</small><span class="pill ${g.family}">${g.family}</span><span class="pill">⏱ ${g.duration}</span></div><div class="voters">${voters.map(v => avatar(v.color, true)).join('')}</div>${extra}`;
}

function renderVote() {
  const st = S.state;
  const v = st.vote;
  const mine = v.votes[pid];
  $('vote-list').innerHTML = '';
  for (const id of v.options) {
    const g = gameDef(id);
    if (!g) continue;
    const voters = Object.entries(v.votes).filter(([, gid]) => gid === id).map(([p]) => st.players.find(x => x.id === p)).filter(Boolean);
    const el = document.createElement('button');
    el.className = 'vote-card' + (mine === id ? ' mine' : '');
    el.innerHTML = voteCard(g, id === v.replay ? '<span class="replay">↻ Rejouer</span>' : '', voters);
    el.onclick = () => { sound.play('tick'); send({ type: 'vote', game: id }); };
    $('vote-list').appendChild(el);
  }
  const humans = st.players.filter(p => !p.bot).length;
  const n = Object.keys(v.votes).length;
  $('vote-hint').textContent = mine ? `${n}/${humans} ont voté` : 'Touche un jeu pour voter';
}
$('btn-vote-now').onclick = () => send({ type: 'skip' });

// ---------- Roue ----------
let spinTimer = null;
function renderSpin() {
  const sp = S.state.spin;
  $('reel').innerHTML = sp.options.map(id => `<div class="vote-card" data-id="${id}">${voteCard(gameDef(id))}</div>`).join('');
  const cards = [...$('reel').children];
  const target = sp.options.indexOf(sp.chosen);
  const total = cards.length * 4 + target;
  let i = 0;
  clearTimeout(spinTimer);
  const tick = () => {
    cards.forEach((c, k) => c.classList.toggle('hot', k === i % cards.length));
    sound.play('tick');
    if (i >= total) { cards[target].classList.remove('hot'); cards[target].classList.add('win'); sound.play('win'); return; }
    i += 1;
    const k = i / total;
    spinTimer = setTimeout(tick, 60 + 260 * k * k);
  };
  tick();
}

// ---------- Intro ----------
function renderIntro() {
  const g = gameDef(S.state.gameId);
  if (!g) return;
  $('intro-emoji').textContent = g.emoji;
  $('intro-name').textContent = g.name;
  $('intro-tag').textContent = g.tagline;
  $('intro-howto').innerHTML = g.howto.map(h => `<li>${esc(h)}</li>`).join('');
  const playing = S.state.participants.includes(pid);
  $('intro-spec').textContent = playing ? (g.controls.type === 'stick' ? 'Astuce : tourne le téléphone ou passe en plein écran pour plus de confort.' : '') : '👀 Partie complète : tu regardes celle-ci.';
}

// ---------- Résultats ----------
function renderResults() {
  const r = S.state.results;
  if (!r) return;
  $('res-emoji').textContent = r.emoji;
  $('res-title').textContent = r.title;
  $('res-rows').innerHTML = r.rows.map((row, i) => `
    <div class="res-row ${row.rank === 1 ? 'first' : ''} " style="animation-delay:${i * 0.08}s">
      <span class="rk">${['🥇', '🥈', '🥉'][row.rank - 1] || row.rank}</span>
      ${avatar(row.color, true)}
      <span class="nm">${esc(row.name)}${row.id === pid ? ' (toi)' : ''}${row.bot ? ' 🤖' : ''}<small>${esc(row.detail)}</small></span>
      <span class="pts">${row.bot ? '' : `+${row.points}`}</span>
    </div>`).join('');
  const me = r.rows.find(x => x.id === pid);
  if (me?.rank === 1) { sound.play('win'); navigator.vibrate?.([80, 60, 80, 60, 200]); }
}
$('btn-res-lobby').onclick = () => send({ type: 'lobby' });
$('btn-res-vote').onclick = () => send({ type: 'skip' });
$('res-emotes').innerHTML = EMOTES.map(e => `<button data-e="${e}">${e}</button>`).join('');
$('res-emotes').onclick = e => { const b = e.target.closest('button'); if (b) send({ type: 'emote', e: b.dataset.e }); };

// ---------- Compteurs (vote, intro, résultats) ----------
function tickers() {
  const left = Math.max(0, S.endAt - performance.now());
  if (S.screen === 's-vote') {
    $('vote-bar').style.transform = `scaleX(${left / 15000})`;
  } else if (S.screen === 's-intro') {
    const n = Math.ceil(left / 1000);
    if ($('intro-count').textContent !== String(n)) { $('intro-count').textContent = n; if (n <= 3 && n > 0) sound.play('tick'); }
  } else if (S.screen === 's-results') {
    $('res-next').textContent = `Vote du prochain jeu dans ${Math.ceil(left / 1000)} s`;
  }
}

// ---------- Jeu ----------
const cv = $('cv');
const ctx = cv.getContext('2d');
let raf = 0;
let last = 0;
let wakeLock = null;
let lastInput = { mx: 0, my: 0, a: false, b: false };
let lastSent = 0;
let pendingSend = null;
let hudCache = '';
let bannerCache = '';

const controls = createControls({
  onChange(inp) {
    const btnChange = inp.a !== lastInput.a || inp.b !== lastInput.b;
    lastInput = inp;
    const now = performance.now();
    if (btnChange || now - lastSent > 50) { send({ type: 'input', v: inp }); lastSent = now; clearTimeout(pendingSend); }
    else { clearTimeout(pendingSend); pendingSend = setTimeout(() => { send({ type: 'input', v: lastInput }); lastSent = performance.now(); }, 50); }
  },
});

function view() {
  const st = S.state;
  const players = {};
  for (const p of st?.players || []) players[p.id] = p;
  if (S.cur?.bodies) for (const b of S.cur.bodies) if (!players[b.id]) players[b.id] = { id: b.id, name: '?', color: '#888' };
  return {
    gameId: st?.gameId, me: pid, players, cur: S.cur, prev: S.prev, priv: S.priv,
    alpha: Math.min(1, (performance.now() - S.curAt) / 50), emotes: S.emotes,
  };
}

const api = {
  act: v => send({ type: 'act', v }),
  toast,
};

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const r = RENDERERS[S.state?.gameId];
  r?.layout(w, h, h >= w);
}
window.addEventListener('resize', () => { if (S.screen === 's-game') resize(); });

function refreshGameChrome() {
  const g = gameDef(S.state.gameId);
  if (!g) return;
  const playing = S.state.participants.includes(pid);
  const stick = g.controls.type === 'stick';
  $('controls').classList.toggle('hidden', !stick || !playing);
  $('tapbar').classList.toggle('on', !stick && playing);
  $('spectator').classList.toggle('hidden', playing);
  controls.setLabels(g.controls.a === 'Coup' ? '👊' : '⚡', g.controls.b ? '💨' : '');
  controls.setActive(stick && playing);
}

function enterGame() {
  fx.reset();
  hudCache = ''; bannerCache = '';
  const g = gameDef(S.state.gameId);
  const r = RENDERERS[S.state.gameId];
  if (g && g.controls.type === 'tap' && r?.mount) r.mount($('tapbar'), api);
  refreshGameChrome();
  resize();
  last = performance.now();
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(frame);
  try { navigator.wakeLock?.request('screen').then(l => { wakeLock = l; }).catch(() => {}); } catch { /* rien */ }
}

function leaveGame() {
  cancelAnimationFrame(raf);
  controls.setActive(false);
  $('emote-bar').classList.add('hidden');
  $('tapbar').classList.remove('on');
  $('tapbar').innerHTML = '';
  try { wakeLock?.release(); } catch { /* rien */ }
  wakeLock = null;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const w = cv.clientWidth, h = cv.clientHeight;
  ctx.fillStyle = '#0e0c20';
  ctx.fillRect(0, 0, w, h);
  const r = RENDERERS[S.state?.gameId];
  if (!r) return;
  fx.update(dt);
  r.step?.(dt);
  const v = view();
  r.update?.(v);
  r.draw(ctx, v, now);
  // HUD
  const hd = r.hud(v);
  const key = (hd.left || '') + '|' + (hd.center || '') + '|' + (hd.sub || '');
  if (key !== hudCache) {
    hudCache = key;
    $('hud-center').textContent = hd.center || '';
    $('hud-left').innerHTML = hd.left || (hd.sub ? `<span class="chip" style="padding:3px 10px">${esc(hd.sub)}</span>` : '');
  }
  const msg = S.cur?.msg || '';
  if (msg !== bannerCache) { bannerCache = msg; $('banner').textContent = msg; }
  if (r.cooldowns) { const [a, b] = r.cooldowns(v); controls.setCooldowns(a, b); }
}

cv.addEventListener('pointerdown', e => {
  const r = RENDERERS[S.state?.gameId];
  if (!r?.tap || !S.state.participants.includes(pid)) return;
  const rect = cv.getBoundingClientRect();
  r.tap(e.clientX - rect.left, e.clientY - rect.top, view());
});

$('btn-emote').onclick = () => $('emote-bar').classList.toggle('hidden');
$('emote-bar').innerHTML = EMOTES.map(e => `<button data-e="${e}">${e}</button>`).join('');
$('emote-bar').onclick = e => {
  const b = e.target.closest('button');
  if (!b) return;
  send({ type: 'emote', e: b.dataset.e });
  $('emote-bar').classList.add('hidden');
};
$('btn-full').onclick = () => {
  const el = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => toast('Plein écran indisponible ici'));
};
// Double appui pour arrêter (les fenêtres confirm() sont bloquées dans certaines vues).
let quitArmed = 0;
$('btn-quit').onclick = () => {
  if (Date.now() - quitArmed < 2500) { quitArmed = 0; send({ type: 'lobby' }); return; }
  quitArmed = Date.now();
  toast('Touche encore ✕ pour arrêter la partie');
};

// ---------- Divers ----------
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

document.addEventListener('pointerdown', () => sound.unlock(), { once: false, passive: true });
setInterval(tickers, 100);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.hello && (!S.ws || S.ws.readyState > 1)) connect();
});

const OFFLINE = !!window.PLAYROOM_OFFLINE;
if (OFFLINE) document.body.classList.add('offline');
else if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

// Démarrage : reprise automatique si on a déjà un pseudo et un crew.
(function boot() {
  if (OFFLINE) { showHome(); return; }
  if (location.pathname === '/solo') { startSolo(); return; }
  const m = location.pathname.match(/^\/c\/([A-Za-z0-9]{4,8})/);
  const name = store.get('pr_name');
  const code = m ? m[1].toUpperCase() : null;
  if (code && name) { show('s-lobby'); joinCrew({ name, crew: code }); $('conn').classList.remove('hidden'); return; }
  showHome();
})();

// Accès de débogage (uniquement avec ?debug dans l'URL).
if (new URLSearchParams(location.search).has('debug')) window.__pr = { S, send };
