// Relative drag (touch / mouse / pen) plus arrow keys and A/D.
// Drag distance in screen pixels is converted to world units with the
// renderer's pixels-per-unit, so the crowd follows your finger 1:1-ish.

const SENSITIVITY = 1.15;

export function createInput(target, getPpu) {
  let pending = 0;
  let dragging = false;
  let lastX = 0;
  const keys = { left: false, right: false };

  target.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  target.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    pending += ((e.clientX - lastX) / Math.max(0.5, getPpu())) * SENSITIVITY;
    lastX = e.clientX;
  });
  const end = () => { dragging = false; };
  target.addEventListener('pointerup', end);
  target.addEventListener('pointercancel', end);
  target.addEventListener('lostpointercapture', end);

  const keyMap = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  window.addEventListener('keydown', (e) => {
    const k = keyMap[e.code];
    if (k) { keys[k] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    const k = keyMap[e.code];
    if (k) keys[k] = false;
  });
  window.addEventListener('blur', () => { keys.left = keys.right = false; dragging = false; });

  return {
    // Called once per sim step. Drag movement is delivered on the first step only.
    take() {
      const dx = pending;
      pending = 0;
      return { dx, axis: (keys.right ? 1 : 0) - (keys.left ? 1 : 0) };
    },
    reset() { pending = 0; dragging = false; keys.left = keys.right = false; },
  };
}
