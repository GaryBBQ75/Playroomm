// Joystick flottant + 2 boutons, avec repli clavier sur ordinateur.
export function createControls({ onChange }) {
  const zone = document.getElementById('stick-zone');
  const base = document.getElementById('stick-base');
  const knob = document.getElementById('stick-knob');
  const btnA = document.getElementById('btn-a');
  const btnB = document.getElementById('btn-b');
  const state = { mx: 0, my: 0, a: false, b: false };
  const keys = new Set();
  let stickId = null;
  let cx = 0, cy = 0;
  const R = 56;

  const emit = () => onChange({ ...state });

  function placeBase(x, y) {
    const r = zone.getBoundingClientRect();
    base.style.left = (x - r.left) + 'px';
    base.style.top = (y - r.top) + 'px';
  }
  function resetStick() {
    stickId = null;
    state.mx = 0; state.my = 0;
    knob.style.transform = '';
    base.style.left = '50%'; base.style.top = '50%';
    emit();
  }
  zone.addEventListener('pointerdown', e => {
    if (stickId !== null) return;
    stickId = e.pointerId;
    zone.setPointerCapture(e.pointerId);
    cx = e.clientX; cy = e.clientY;
    placeBase(cx, cy);
    e.preventDefault();
  });
  zone.addEventListener('pointermove', e => {
    if (e.pointerId !== stickId) return;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) {
      // La base suit le doigt si on dépasse : plus confortable.
      const k = (d - R) / d;
      cx += dx * k; cy += dy * k;
      placeBase(cx, cy);
      dx = e.clientX - cx; dy = e.clientY - cy;
    }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    const dead = 8;
    const l = Math.hypot(dx, dy);
    if (l < dead) { state.mx = 0; state.my = 0; }
    else { state.mx = dx / R; state.my = dy / R; }
    emit();
  });
  const endStick = e => { if (e.pointerId === stickId) resetStick(); };
  zone.addEventListener('pointerup', endStick);
  zone.addEventListener('pointercancel', endStick);

  function bindBtn(el, key) {
    const down = e => { e.preventDefault(); state[key] = true; el.classList.add('down'); emit(); navigator.vibrate?.(10); };
    const up = e => { e.preventDefault(); state[key] = false; el.classList.remove('down'); emit(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('contextmenu', e => e.preventDefault());
  }
  bindBtn(btnA, 'a');
  bindBtn(btnB, 'b');

  function fromKeys() {
    let x = 0, y = 0;
    if (keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('KeyQ')) x -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) x += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('KeyZ')) y -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) y += 1;
    const l = Math.hypot(x, y) || 1;
    state.mx = x / l; state.my = y / l;
    state.a = keys.has('Space') || keys.has('KeyJ');
    state.b = keys.has('ShiftLeft') || keys.has('KeyK') || keys.has('KeyE');
    emit();
  }
  const kd = e => {
    if (!active || e.target.tagName === 'INPUT') return;
    if (e.repeat) return;
    keys.add(e.code); fromKeys();
    if (e.code === 'Space') e.preventDefault();
  };
  const ku = e => { if (!active) return; keys.delete(e.code); fromKeys(); };
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);

  let active = false;
  return {
    setActive(v) {
      active = v;
      if (!v) { keys.clear(); state.a = state.b = false; btnA.classList.remove('down'); btnB.classList.remove('down'); resetStick(); }
    },
    setLabels(a, b) {
      btnA.querySelector('span').textContent = a || '';
      btnB.querySelector('span').textContent = b || '';
      btnB.classList.toggle('hidden', !b);
    },
    setCooldowns(a, b) {
      btnA.style.setProperty('--cd', `${Math.round(a * 100)}%`);
      btnB.style.setProperty('--cd', `${Math.round(b * 100)}%`);
    },
  };
}
