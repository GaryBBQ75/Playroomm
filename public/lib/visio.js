// Visio entre potes (WebRTC en maillage, signalisation via le serveur de jeu).
// Une connexion par paire de joueurs dès qu'au moins l'un des deux a sa caméra allumée.
// On peut voir les autres même caméra coupée.

export function createVisio({ send, me, onChange, toast }) {
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
  let local = null;          // MediaStream de ma caméra
  let micOn = true;
  const peers = new Map();   // id -> { pc, key, stream, pending: [] }
  const videos = new Map();  // id -> <video>
  let players = [];

  function videoFor(id) {
    let v = videos.get(id);
    if (!v) {
      v = document.createElement('video');
      v.autoplay = true;
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      if (id === me) { v.muted = true; v.classList.add('mirror'); }
      videos.set(id, v);
    }
    return v;
  }

  function attach(id, stream) {
    const v = videoFor(id);
    if (v.srcObject !== stream) v.srcObject = stream;
    v.play?.().catch(() => {});
  }

  function pairKey(other) {
    const a = !!local, b = !!other.media;
    return `${a}|${b}`;
  }

  function close(id) {
    const p = peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch { /* rien */ }
    peers.delete(id);
    const v = videos.get(id);
    if (v) { v.srcObject = null; videos.delete(id); }
  }

  function build(other) {
    const pc = new RTCPeerConnection({ iceServers });
    const entry = { pc, key: pairKey(other), stream: new MediaStream(), pending: [] };
    peers.set(other.id, entry);
    pc.onicecandidate = e => { if (e.candidate) send({ type: 'signal', target: other.id, data: { ice: e.candidate.toJSON(), key: entry.key } }); };
    pc.ontrack = e => {
      if (!entry.stream.getTracks().includes(e.track)) entry.stream.addTrack(e.track);
      attach(other.id, entry.stream);
      e.track.onunmute = () => onChange();
      onChange();
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        toast?.(`Visio impossible avec ${other.name} (réseau)`);
      }
    };
    return entry;
  }

  function addLocalTracks(pc) {
    const v = local?.getVideoTracks()[0] || null;
    const a = local?.getAudioTracks()[0] || null;
    const trs = pc.getTransceivers();
    if (!trs.length) {
      pc.addTransceiver(v || 'video', { direction: 'sendrecv', streams: local ? [local] : [] });
      pc.addTransceiver(a || 'audio', { direction: 'sendrecv', streams: local ? [local] : [] });
      return;
    }
    for (const t of trs) {
      const kind = t.receiver.track?.kind;
      t.direction = 'sendrecv';
      if (kind === 'video' && v) t.sender.replaceTrack(v);
      if (kind === 'audio' && a) t.sender.replaceTrack(a);
    }
  }

  async function offer(other) {
    const entry = build(other);
    addLocalTracks(entry.pc);
    const o = await entry.pc.createOffer();
    await entry.pc.setLocalDescription(o);
    send({ type: 'signal', target: other.id, data: { sdp: entry.pc.localDescription.toJSON(), key: entry.key } });
  }

  // Appelé à chaque nouvel état du crew.
  function sync(list) {
    players = list.filter(p => !p.bot);
    const others = players.filter(p => p.id !== me);
    for (const id of [...peers.keys()]) {
      const o = others.find(p => p.id === id);
      if (!o || (!local && !o.media) || peers.get(id).key !== pairKey(o)) close(id);
    }
    if (typeof RTCPeerConnection === 'undefined') return;
    for (const o of others) {
      if (!local && !o.media) continue;
      if (peers.has(o.id)) continue;
      // Le plus petit identifiant lance l'appel, l'autre attend l'offre.
      if (me < o.id) offer(o).catch(e => console.warn('visio', e));
    }
    onChange();
  }

  async function onSignal(from, data) {
    if (!data || typeof data !== 'object') return;
    const other = players.find(p => p.id === from);
    if (!other) return;
    try {
      let entry = peers.get(from);
      if (data.sdp) {
        if (data.sdp.type === 'offer') {
          if (entry) close(from);
          entry = build(other);
          entry.key = data.key;
          await entry.pc.setRemoteDescription(data.sdp);
          addLocalTracks(entry.pc);
          const ans = await entry.pc.createAnswer();
          await entry.pc.setLocalDescription(ans);
          send({ type: 'signal', target: from, data: { sdp: entry.pc.localDescription.toJSON(), key: entry.key } });
        } else if (entry && data.key === entry.key) {
          await entry.pc.setRemoteDescription(data.sdp);
        }
        if (entry) {
          for (const c of entry.pending) await entry.pc.addIceCandidate(c).catch(() => {});
          entry.pending = [];
        }
      } else if (data.ice && entry && data.key === entry.key) {
        if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(data.ice).catch(() => {});
        else entry.pending.push(data.ice);
      }
    } catch (e) {
      console.warn('visio signal', e);
    }
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) { toast?.('La caméra demande une connexion sécurisée (HTTPS).'); return false; }
    try {
      local = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 240 }, height: { ideal: 240 }, frameRate: { ideal: 15, max: 20 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      toast?.('Caméra refusée ou indisponible');
      return false;
    }
    micOn = true;
    attach(me, local);
    send({ type: 'media', on: true });
    onChange();
    return true;
  }

  function stop() {
    if (local) for (const t of local.getTracks()) t.stop();
    local = null;
    const v = videos.get(me);
    if (v) { v.srcObject = null; videos.delete(me); }
    send({ type: 'media', on: false });
    onChange();
  }

  function toggleMic() {
    if (!local) return micOn;
    micOn = !micOn;
    for (const t of local.getAudioTracks()) t.enabled = micOn;
    onChange();
    return micOn;
  }

  function destroy() {
    for (const id of [...peers.keys()]) close(id);
    if (local) for (const t of local.getTracks()) t.stop();
    local = null;
    videos.clear();
  }

  // Vidéo à afficher pour un joueur (la mienne ou celle reçue), ou null.
  function videoOf(id) {
    if (id === me) return local ? videoFor(me) : null;
    const e = peers.get(id);
    if (!e || !e.stream.getVideoTracks().some(t => t.readyState === 'live' && !t.muted)) return null;
    return videoFor(id);
  }

  return {
    sync, onSignal, start, stop, toggleMic, destroy, videoOf,
    setIce(list) { if (Array.isArray(list) && list.length) iceServers = list; },
    get on() { return !!local; },
    get mic() { return micOn; },
  };
}
