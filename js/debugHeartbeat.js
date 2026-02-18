'use strict';

(function debugHeartbeat() {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed; left:8px; bottom:8px; z-index:99999;
    background:rgba(0,0,0,.7); padding:8px 10px; border:1px solid #0ff;
    font:12px monospace; color:#0ff; border-radius:6px;
  `;
  document.body.appendChild(el);

  let lastRAF = performance.now();
  let lastStamp = 0;
  let fps = 0;
  let frames = 0;
  let lastFpsT = performance.now();

  window.addEventListener('error', (e) => console.log('ERROR', e.message, e.filename, e.lineno));
  window.addEventListener('unhandledrejection', (e) => console.log('PROMISE', e.reason));

  function tick(stamp) {
    const now = performance.now();
    lastRAF = now;
    frames++;
    if (now - lastFpsT >= 1000) {
      fps = frames;
      frames = 0;
      lastFpsT = now;
    }

    const dt = lastStamp ? (stamp - lastStamp) : 0;
    lastStamp = stamp;

    el.textContent =
      `FPS:${fps}  dt:${dt.toFixed(1)}ms  vis:${document.visibilityState}  focus:${document.hasFocus()}`;

    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  setInterval(() => {
    const now = performance.now();
    if (document.visibilityState === 'visible' && document.hasFocus() && (now - lastRAF) > 500) {
      console.log('Warning: rAF stalled while visible+focused. Something is throttling/suspending this tab.');
    }
  }, 500);
})();
