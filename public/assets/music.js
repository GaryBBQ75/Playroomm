/* Original Web Audio synthesis of public-domain melodies for Playroom.
   No third-party recordings, streams, or proprietary samples are used. */
(() => {
  'use strict';
  let audio = null;
  let playing = [];
  function stop() {
    for (const osc of playing) { try { osc.stop(); } catch (_) {} }
    playing = [];
    if (audio) { try { audio.close(); } catch (_) {} audio = null }
  }
  async function play(notes, noteMs = 330) {
    if (!Array.isArray(notes) || !notes.length) return 0;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Audio non compatible avec ce navigateur');
    stop();
    audio = new Ctx();
    await audio.resume();
    const duration = Math.min(550, Math.max(140, Number(noteMs) || 330)) / 1000;
    const start = audio.currentTime + .075;
    const master = audio.createGain();
    master.gain.value = .18;
    master.connect(audio.destination);
    notes.slice(0, 28).forEach((raw, i) => {
      const midi = Number(raw);
      if (!Number.isFinite(midi) || midi < 36 || midi > 96) return;
      const at = start + i * duration;
      const end = at + duration * .90;
      const frequency = 440 * Math.pow(2, (midi - 69) / 12);
      // Sine + quiet harmonic makes a toy-piano sound, keeping the samples original.
      [1, 2].forEach((harmonic, n) => {
        const osc = audio.createOscillator(), gain = audio.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(frequency * harmonic, at);
        gain.gain.setValueAtTime(.0001, at);
        gain.gain.exponentialRampToValueAtTime(n ? .055 : .35, at + .023);
        gain.gain.exponentialRampToValueAtTime(.0001, end);
        osc.connect(gain); gain.connect(master);
        osc.start(at); osc.stop(end + .025);
        playing.push(osc);
      });
    });
    return Math.round(notes.length * duration * 1000);
  }
  window.PlayroomAudio = {play, stop};
})();
