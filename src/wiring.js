/* ---------- minimap ---------- */
function renderMinimap() {
  var ctx = mini.getContext('2d');
  var W = mini.width, H = mini.height;
  ctx.clearRect(0, 0, W, H);
  var a = allNodes();
  if (!a.length) return;
  var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  a.forEach(function (n) {
    minx = Math.min(minx, n.x); miny = Math.min(miny, n.y);
    maxx = Math.max(maxx, n.x + NODE_W); maxy = Math.max(maxy, n.y + NODE_H);
  });
  var v0 = screenToWorld(0, 0), v1 = screenToWorld(window.innerWidth, window.innerHeight);
  minx = Math.min(minx, v0.x); miny = Math.min(miny, v0.y);
  maxx = Math.max(maxx, v1.x); maxy = Math.max(maxy, v1.y);
  var bw = maxx - minx, bh = maxy - miny, pad = 8;
  var s = Math.min((W - pad * 2) / bw, (H - pad * 2) / bh);
  var ox = pad - minx * s + (W - pad * 2 - bw * s) / 2;
  var oy = pad - miny * s + (H - pad * 2 - bh * s) / 2;
  a.forEach(function (n) {
    ctx.fillStyle = n.id === winnerNodeId() ? '#f5f5f5' : (n.building ? '#525252' : '#a3a3a3');
    ctx.fillRect(ox + n.x * s, oy + n.y * s, Math.max(2, NODE_W * s), Math.max(2, NODE_H * s));
  });
  ctx.strokeStyle = 'rgba(245,245,245,.7)';
  ctx.lineWidth = 1;
  ctx.strokeRect(ox + v0.x * s, oy + v0.y * s, (v1.x - v0.x) * s, (v1.y - v0.y) * s);
}

/* ---------- global pointer handlers ---------- */
canvas.addEventListener('mousedown', function (e) {
  if (e.button !== 0) return;
  drag = { mode: 'pan', lastX: e.clientX, lastY: e.clientY, moved: 0 };
});
/* a hand on the board wins: the organize tween lands where it was headed
   rather than fighting the pan, the drag or the zoom */
window.addEventListener('mousedown', organizeSettle, true);
window.addEventListener('mousemove', function (e) {
  if (!drag) return;
  var dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
  drag.lastX = e.clientX; drag.lastY = e.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (drag.mode === 'pan') {
    cam.x += dx; cam.y += dy; applyCamera();
  } else {
    var n = byId(drag.id);
    if (n) { n.x += dx / cam.scale; n.y += dy / cam.scale; updateNodePos(n); renderEdges(); syncComposer(); renderMinimap(); }
  }
});
window.addEventListener('mouseup', function (e) {
  if (drag && drag.mode === 'pan' && drag.moved < 4) select(null);
  if (drag && drag.mode === 'node') {
    // a plain still click on a member of a multi-selection collapses to it
    var n = byId(drag.id);
    if (drag.moved < 4 && !e.shiftKey && n && !n.building) select(drag.id);
    // a real drag: the card moved — log where it left and where it landed
    if (drag.moved >= 4 && n) {
      trace('node:moved', {
        id: drag.id,
        from: { x: Math.round(drag.fromX), y: Math.round(drag.fromY) },
        to: { x: Math.round(n.x), y: Math.round(n.y) }
      });
      traceLayout('drag');
    }
    savePositions();
  }
  drag = null;
});
canvas.addEventListener('wheel', function (e) {
  e.preventDefault();
  organizeSettle();
  var rect = canvas.getBoundingClientRect();
  var mx = e.clientX - rect.left, my = e.clientY - rect.top;
  var wx = (mx - cam.x) / cam.scale, wy = (my - cam.y) / cam.scale;
  var factor = Math.exp(-e.deltaY * 0.0015);
  cam.scale = clamp(cam.scale * factor, 0.15, 2.5);
  cam.x = mx - wx * cam.scale;
  cam.y = my - wy * cam.scale;
  applyCamera();
}, { passive: false });

/* ---------- ui wiring ---------- */
document.getElementById('tbZoomOut').addEventListener('click', function () { zoomBy(1 / 1.2); });
document.getElementById('tbZoomIn').addEventListener('click', function () { zoomBy(1.2); });
document.getElementById('tbFit').addEventListener('click', fitView);
document.getElementById('tbOrg').addEventListener('click', organizeView);

/* subtle light/dark toggle — canvas defaults to dark; only flips CSS tokens */
(function () {
  var tt = document.getElementById('themeToggle');
  function sync() { tt.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '☀' : '☾'; }
  sync();
  tt.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    sync();
  });
})();

