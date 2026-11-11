// Relative drag (touch / mouse / pen) plus arrow keys and A/D, and the squeeze.
// Drag distance in screen pixels is converted to world units with the
// renderer's pixels-per-unit, so the crowd follows your finger 1:1-ish.
//
// Squeeze (pack the crowd tight) is held, and works with one thumb:
//   - start your drag on the SQUEEZE pad (bottom right): that touch steers AND
//     squeezes until you lift it, or
//   - put a second finger anywhere while steering with the first, or
//   - hold Space, Shift, S or Down on a keyboard.

const SENSITIVITY = 1.15;

export function createInput(target, getPpu, isPad = () => false) {
  let pending = 0;
  const pointers = new Map(); // pointerId -> { x, pad }
  let steerId = null;
  const keys = { left: false, right: false, squeeze: false };

  const local = (e) => {
    const r = target.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  target.addEventListener('pointerdown', (e) => {
    const [lx, ly] = local(e);
    pointers.set(e.pointerId, { x: e.clientX, pad: isPad(lx, ly) });
    if (steerId === null) steerId = e.pointerId;
    try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  target.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    if (e.pointerId === steerId) pending += ((e.clientX - p.x) / Math.max(0.5, getPpu())) * SENSITIVITY;
    p.x = e.clientX;
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (e.pointerId === steerId) {
      // Hand steering to a finger that is still down, if any.
      steerId = pointers.size ? pointers.keys().next().value : null;
    }
  };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  target.addEventListener('lostpointercapture', end);

  const keyMap = {
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Space: 'squeeze', ShiftLeft: 'squeeze', ShiftRight: 'squeeze', KeyS: 'squeeze', ArrowDown: 'squeeze',
  };
  window.addEventListener('keydown', (e) => {
    const k = keyMap[e.code];
    if (k) { keys[k] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.code];
    if (k) keys[k] = false;
  });
  const releaseAll = () => {
    keys.left = keys.right = keys.squeeze = false;
    pointers.clear();
    steerId = null;
  };
  window.addEventListener('blur', releaseAll);

  function squeezing() {
    if (keys.squeeze || pointers.size >= 2) return true;
    for (const p of pointers.values()) if (p.pad) return true;
    return false;
  }

  return {
    // Called once per sim step. Drag movement is delivered on the first step only.
    take() {
      const dx = pending;
      pending = 0;
      return { dx, axis: (keys.right ? 1 : 0) - (keys.left ? 1 : 0), squeeze: squeezing() };
    },
    get squeezing() { return squeezing(); },
    reset() { pending = 0; releaseAll(); },
  };
}
