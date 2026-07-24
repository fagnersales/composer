/* ---------- camera ---------- */
function applyCamera() {
  world.style.transform = 'translate(' + cam.x + 'px,' + cam.y + 'px) scale(' + cam.scale + ')';
  canvas.style.backgroundPosition = cam.x + 'px ' + cam.y + 'px';
  var g = 40 * cam.scale;
  canvas.style.backgroundSize = g + 'px ' + g + 'px';
  syncComposer();
  renderMinimap();
  traceCamera();
}
function zoomBy(f) {
  organizeSettle();
  var mx = window.innerWidth / 2, my = window.innerHeight / 2;
  var wx = (mx - cam.x) / cam.scale, wy = (my - cam.y) / cam.scale;
  cam.scale = clamp(cam.scale * f, 0.15, 2.5);
  cam.x = mx - wx * cam.scale;
  cam.y = my - wy * cam.scale;
  applyCamera();
}
/* the camera that frames a set of card boxes — Fit uses it on where the cards
   are, Organize on where they are about to be */
function fitCam(boxes) {
  if (!boxes.length) return null;
  var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  boxes.forEach(function (b) {
    minx = Math.min(minx, b.x); miny = Math.min(miny, b.y);
    maxx = Math.max(maxx, b.x + NODE_W); maxy = Math.max(maxy, b.y + NODE_H);
  });
  var bw = maxx - minx, bh = maxy - miny, pad = 90;
  var s = clamp(Math.min((window.innerWidth - pad * 2) / bw, (window.innerHeight - pad * 2 - 40) / bh), 0.15, 1.4);
  return {
    scale: s,
    x: window.innerWidth / 2 - (minx + bw / 2) * s,
    y: (window.innerHeight / 2 + 20) - (miny + bh / 2) * s
  };
}
function fitView() {
  trace('fit');
  organizeSettle();
  var c = fitCam(allNodes());
  if (!c) return;
  cam.scale = c.scale; cam.x = c.x; cam.y = c.y;
  applyCamera();
}

/* ---------- placement ---------- */
function collides(x, y, ignoreId) {
  return allNodes().some(function (o) {
    return o.id !== ignoreId && Math.abs(o.x - x) < NODE_W + 20 && Math.abs(o.y - y) < NODE_H + 20;
  });
}
function placeChild(parent, i, count) {
  var gap = 60;
  var total = count * NODE_W + (count - 1) * gap;
  var x = parent.x + NODE_W / 2 - total / 2 + i * (NODE_W + gap);
  var y = parent.y + NODE_H + 140;
  while (collides(x, y, null)) y += NODE_H + 40;
  return { x: x, y: y };
}
function placeRoot(i) {
  var x = 60 + i * (NODE_W + 120), y = 90;
  while (collides(x, y, null)) y += NODE_H + 40;
  return { x: x, y: y };
}
/* a freshly arrived variant takes over a ghost slot of its parent's pending
   iterate request, so it lands exactly where the "building…" card was — and
   inherits its combine strands, so a mix doesn't drop back to one edge */
function adoptGhostSlot(parentId) {
  for (var i = 0; i < state.ghosts.length; i++) {
    var g = state.ghosts[i];
    if (g.parentId !== parentId) continue;
    state.ghosts.splice(i, 1);
    removeNodeEl(g.id);
    return { x: g.x, y: g.y, extraParents: g.extraParents };
  }
  return null;
}
/* Every iterate request owns a row of `count` slots under its parent, and which
   of them are already filled is read off the files — never off what this page
   happened to watch arrive. That is what lets a board be reloaded (or opened
   twice) mid-flight without resurrecting ghosts for variants that already
   landed, and what lets a fresh load rebuild the rows exactly as they grew.
   Slots fill oldest first with the children the parent gained after the
   request was sent. */
function bornAt(n) { return Date.parse(n.ts) || 0; }
function iterateSlots() {
  // oldest first: sibling requests on one parent claim their children in turn
  var rows = reqLog.filter(function (rq) { return rq.count && rq.variants && rq.variants.length; }).reverse();
  var claimed = {};
  return rows.map(function (rq) {
    var pid = rq.variants[0], sent = Date.parse(rq.ts) || 0;
    var kids = state.nodes.filter(function (n) {
      return n.parentId === pid && !claimed[n.id] && bornAt(n) > sent;
    }).sort(function (a, b) { return bornAt(a) - bornAt(b); }).slice(0, rq.count);
    kids.forEach(function (n) { claimed[n.id] = 1; });
    return { req: rq, parentId: pid, sent: sent, filled: kids.length };
  });
}
/* a child read back on a fresh load has no ghost left to adopt, but it still
   belongs to a slot of the request that asked for it — so the row a board comes
   back to is the row it left */
function placeArrival(parent, born) {
  var slots = iterateSlots();
  for (var i = slots.length - 1; i >= 0; i--) { // newest request first
    var s = slots[i];
    if (s.parentId === parent.id && born > s.sent && s.filled < s.req.count)
      return placeChild(parent, s.filled, s.req.count);
  }
  return placeNewChild(parent);
}
function placeNewChild(parent) {
  var sibs = state.nodes.filter(function (n) { return n.parentId === parent.id; });
  if (!sibs.length) return placeChild(parent, 0, 1);
  var right = sibs[0];
  sibs.forEach(function (s) { if (s.x > right.x) right = s; });
  var x = right.x + NODE_W + 60, y = right.y;
  while (collides(x, y, null)) x += NODE_W + 60;
  return { x: x, y: y };
}

/* ---------- organize ---------- */
/* One tidy tree over the whole board, packed by contours: a sibling subtree
   slides left until its nearest card — at any depth — sits one gap from its
   neighbour, so a narrow chain tucks under a wide branch instead of pushing
   it away. Each parent rides centred over its own children. Depth is the
   generation — a variant always sits one row under the variant it came from.
   Ghost slots lay out with the rest, so a row still building keeps the shape
   it will have once it lands.
   The order the user already sees (left to right) is the order kept. */
var ORG_HGAP = 60, ORG_VGAP = 140, ORG_ROOT_GAP = 120, ORG_X0 = 60, ORG_Y0 = 90;
function organizeLayout() {
  var all = allNodes();
  if (!all.length) return null;
  var byid = {}, kids = {};
  all.forEach(function (n) { byid[n.id] = n; kids[n.id] = []; });
  var roots = [];
  all.forEach(function (n) {
    var p = n.parentId != null && n.parentId !== n.id ? byid[n.parentId] : null;
    if (p) kids[p.id].push(n); else roots.push(n);
  });
  function leftToRight(a, b) { return a.x - b.x || a.y - b.y; }
  roots.sort(leftToRight);
  Object.keys(kids).forEach(function (k) { kids[k].sort(leftToRight); });

  // walk into a strictly acyclic tree first: a bad parent chain must not be
  // able to spin the layout pass forever
  var visited = {}, tree = {};
  function build(n) {
    visited[n.id] = 1;
    var own = [];
    kids[n.id].forEach(function (c) { if (!visited[c.id]) { visited[c.id] = 1; own.push(c); } });
    tree[n.id] = own;
    own.forEach(build);
  }
  roots.forEach(function (r) { if (!visited[r.id]) build(r); });
  all.forEach(function (n) { if (!visited[n.id]) { roots.push(n); build(n); } });

  // each subtree reports its left/right edge per depth row (L[d]..R[d]) plus
  // every node's x relative to the subtree; packing two subtrees is then just
  // the smallest shift that clears the gap on every row both of them reach
  function pack(into, s, gap) {
    var shift = 0, d;
    if (into.R) for (d = 0; d < Math.min(into.R.length, s.L.length); d++)
      shift = Math.max(shift, into.R[d] + gap - s.L[d]);
    for (var k in s.pos) into.pos[k] = s.pos[k] + shift;
    if (!into.R) { into.L = s.L.slice(); into.R = s.R.slice(); }
    else for (d = 0; d < s.L.length; d++) {
      if (d >= into.L.length) into.L[d] = s.L[d] + shift;
      into.R[d] = s.R[d] + shift;
    }
    return shift;
  }
  function layout(n) {
    var ch = tree[n.id], posr = {};
    posr[n.id] = 0;
    if (!ch.length) return { pos: posr, L: [0], R: [NODE_W] };
    var row = { pos: posr, L: null, R: null };
    ch.forEach(function (c) { pack(row, layout(c), ORG_HGAP); });
    var px = (posr[ch[0].id] + posr[ch[ch.length - 1].id]) / 2;
    posr[n.id] = px;
    row.L.unshift(px); row.R.unshift(px + NODE_W);
    return row;
  }

  var depth = {};
  function setDepth(n, d) { depth[n.id] = d; tree[n.id].forEach(function (c) { setDepth(c, d + 1); }); }
  var forest = { pos: {}, L: null, R: null };
  roots.forEach(function (r) { setDepth(r, 0); pack(forest, layout(r), ORG_ROOT_GAP); });
  var minX = Infinity;
  Object.keys(forest.pos).forEach(function (k) { minX = Math.min(minX, forest.pos[k]); });
  var pos = {};
  all.forEach(function (n) {
    pos[n.id] = { x: ORG_X0 + forest.pos[n.id] - minX, y: ORG_Y0 + depth[n.id] * (NODE_H + ORG_VGAP) };
  });
  return pos;
}

/* the board settles into the new shape instead of teleporting into it — the
   cards and the camera ride the same eased clock, so the layout stays readable
   the whole way across. Any grab or zoom mid-flight lands it immediately. */
var orgTween = null;
function organizeSettle() {
  if (!orgTween) return;
  cancelAnimationFrame(orgTween.raf);
  orgTween.moves.forEach(function (m) {
    m.n.x = m.x1; m.n.y = m.y1;
    if (nodeEls[m.n.id]) updateNodePos(m.n);
  });
  cam.x = orgTween.c1.x; cam.y = orgTween.c1.y; cam.scale = orgTween.c1.scale;
  orgTween = null;
  renderEdges();
  applyCamera();
  savePositions();
  traceLayout('organize');
}
function organizeView() {
  trace('organize');
  organizeSettle();   // read the board from where a previous organize left it
  var target = organizeLayout();
  if (!target) return;
  var moves = [];
  allNodes().forEach(function (n) {
    var t = target[n.id];
    if (t) moves.push({ n: n, x0: n.x, y0: n.y, x1: t.x, y1: t.y });
  });
  if (!moves.length) return;
  var c0 = { x: cam.x, y: cam.y, scale: cam.scale };
  var c1 = fitCam(moves.map(function (m) { return { x: m.x1, y: m.y1 }; })) || c0;
  orgTween = { moves: moves, c1: c1, raf: 0 };
  if (cmpReduce()) { organizeSettle(); return; }
  drag = null;   // organizing takes the board over from any drag in flight
  var t0 = performance.now(), DUR = 520;
  function step(now) {
    var k = clamp((now - t0) / DUR, 0, 1);
    if (k >= 1) { organizeSettle(); return; }
    var e = 1 - Math.pow(1 - k, 3);
    moves.forEach(function (m) {
      m.n.x = m.x0 + (m.x1 - m.x0) * e;
      m.n.y = m.y0 + (m.y1 - m.y0) * e;
      if (nodeEls[m.n.id]) updateNodePos(m.n);
    });
    cam.x = c0.x + (c1.x - c0.x) * e;
    cam.y = c0.y + (c1.y - c0.y) * e;
    cam.scale = c0.scale + (c1.scale - c0.scale) * e;
    renderEdges();
    applyCamera();
    orgTween.raf = requestAnimationFrame(step);
  }
  orgTween.raf = requestAnimationFrame(step);
}

/* ---------- nodes ---------- */
function createNodeEl(n) {
  var d = document.createElement('div');
  d.className = 'node';
  d.style.width = NODE_W + 'px';
  d.innerHTML =
    '<div class="preview"><div class="scaler"><iframe sandbox="allow-scripts" scrolling="no"></iframe></div>' +
    '<div class="build"><div class="spin"></div><span>building…</span><span class="req"></span>' +
    '<button class="cancel" type="button" title="Cancel this iterate request">Cancel</button></div></div>' +
    '<div class="foot"><span class="ttl"><span class="crown">♔</span><span class="nm"></span></span><span class="mdl"><i></i><span class="mt"></span></span></div>';
  d.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    // shift+click grows / shrinks the multi-selection and never drags
    if (!n.building && e.shiftKey) { toggleSelect(n.id); return; }
    // an already-selected node keeps the group on mousedown so it can be
    // dragged without collapsing; a still click collapses on mouseup
    if (!n.building && !isSelected(n.id)) select(n.id);
    drag = { mode: 'node', id: n.id, lastX: e.clientX, lastY: e.clientY, moved: 0, fromX: n.x, fromY: n.y };
  });
  d.addEventListener('dblclick', function (e) { e.stopPropagation(); if (!n.building) openInspect(n.id); });
  var cx = d.querySelector('.build .cancel');
  cx.addEventListener('mousedown', function (e) { e.stopPropagation(); });
  cx.addEventListener('click', function (e) { e.stopPropagation(); if (n.reqId) cancelRequest(n.reqId); });
  world.appendChild(d);
  nodeEls[n.id] = d;
  updateNodePos(n);
  updateNodeVisual(n);
  if (!n.building) {
    var ifr = d.querySelector('iframe');
    if (n.url) { ifr.setAttribute('sandbox', 'allow-scripts allow-same-origin'); ifr.src = n.url; }
    else ifr.srcdoc = n.html;
  }
  if (n.building && n.reqText) d.querySelector('.req').textContent = '“' + n.reqText + '”';
  if (!n.building) {
    var badge = document.createElement('div');
    badge.className = 'rej-badge';
    badge.innerHTML = '<i></i>Rejected';
    d.querySelector('.preview').appendChild(badge);
    var rj = document.createElement('button');
    rj.className = 'rejbtn'; rj.type = 'button';
    rj.title = 'Reject this variant';
    rj.innerHTML = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="4.4"/><path d="M3.1 3.1l5.8 5.8"/></svg>';
    rj.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    rj.addEventListener('dblclick', function (e) { e.stopPropagation(); });
    rj.addEventListener('click', function (e) { e.stopPropagation(); toggleReject(n.id); });
    d.querySelector('.foot').appendChild(rj);
  }
}
function removeNodeEl(id) {
  if (nodeEls[id]) { nodeEls[id].remove(); delete nodeEls[id]; }
}
function updateNodePos(n) {
  var d = nodeEls[n.id];
  d.style.left = n.x + 'px';
  d.style.top = n.y + 'px';
}
function updateNodeVisual(n) {
  var d = nodeEls[n.id];
  d.classList.toggle('selected', isSelected(n.id));
  d.classList.toggle('winner', winnerNodeId() === n.id);
  d.classList.toggle('building', !!n.building);
  d.querySelector('.nm').textContent = n.name;
  d.querySelector('.mt').textContent = n.model;
  d.querySelector('.mdl i').style.background = modelColor(n.model);
  d.classList.toggle('rejected', isRejected(n.id));
}

/* ---------- reject ---------- */
/* a rejected card is a marked dead end: it stays on the board (softly red,
   dimmed) but the carousel skips it and nothing can be iterated from it */
function isRejected(id) { return rejected.has(id); }
function saveRejected() {
  try { localStorage.setItem(REJ_KEY, JSON.stringify(Array.from(rejected))); } catch (e) {}
}
function toggleReject(id) {
  var n = byId(id);
  if (!n || n.building) return;
  if (rejected.has(id)) rejected.delete(id); else rejected.add(id);
  trace('reject', { id: id, rejected: isRejected(id) });
  saveRejected();
  updateNodeVisual(n);
  renderEdges();
  renderMinimap();
  syncComposer();
  toast(isRejected(id) ? 'Rejected · ' + n.name : 'Rescued · ' + n.name);
}

/* one node per variant file — state.winner is that file's id directly */
function winnerNodeId() { return state.winner || null; }

/* ---------- edges ---------- */
function edgePath(p, ch) {
  var x1 = p.x + NODE_W / 2, y1 = p.y + NODE_H;
  var x2 = ch.x + NODE_W / 2, y2 = ch.y;
  var dy = Math.max(40, (y2 - y1) / 2);
  return 'M' + x1 + ',' + y1 + ' C' + x1 + ',' + (y1 + dy) + ' ' + x2 + ',' + (y2 - dy) + ' ' + x2 + ',' + y2;
}
function renderEdges() {
  var s = '';
  allNodes().forEach(function (n) {
    // strands touching a rejected card fade back with it
    if (n.parentId != null) {
      var p = byId(n.parentId);
      if (p) s += '<path class="edge' + (n.building ? ' ghostly' : '') + (isRejected(n.id) || isRejected(p.id) ? ' dim' : '') + '" d="' + edgePath(p, n) + '"/>';
    }
    // a multi-parent iterate draws a ghostly strand from each extra parent too
    (n.extraParents || []).forEach(function (pid) {
      var xp = byId(pid);
      if (xp) s += '<path class="edge ghostly' + (isRejected(n.id) || isRejected(pid) ? ' dim' : '') + '" d="' + edgePath(xp, n) + '"/>';
    });
  });
  edgesSvg.innerHTML = s;
}

/* ---------- selection ---------- */
function select(id) {
  trace('select', { selected: id == null ? [] : [id] });
  state.selected = id == null ? [] : [id];
  allNodes().forEach(updateNodeVisual);
  syncComposer();
  if (id != null) focusBroadcast(id); // paired phones follow the selection
}
function toggleSelect(id) {
  var i = state.selected.indexOf(id);
  if (i >= 0) state.selected.splice(i, 1);
  else state.selected.push(id);
  trace('select', { selected: state.selected.slice(), multi: true });
  allNodes().forEach(updateNodeVisual);
  syncComposer();
}
function syncComposer() {
  var sel = selNodes();
  if (!sel.length) { composer.hidden = true; return; }
  var n = sel[sel.length - 1]; // anchor next to the freshest selection
  composer.hidden = false;
  // tweak targets exactly one node — a multi-selection falls back to iterate
  cmpModeEl.querySelector('[data-m="tweak"]').disabled = sel.length > 1;
  if (sel.length > 1 && cmpModeType === 'tweak') setCmpModeType('iterate');
  refreshRejectBtn();
  refreshIterateLock();
  if (composer.classList.contains('in-inspect')) { composer.classList.remove('at-bottom'); composer.style.left = ''; composer.style.top = ''; return; }
  // combining several: float fixed at the bottom, clear of the selected nodes
  composer.classList.toggle('at-bottom', sel.length > 1);
  if (sel.length > 1) { composer.style.left = ''; composer.style.top = ''; return; }
  var sx = n.x * cam.scale + cam.x, sy = n.y * cam.scale + cam.y;
  // the panel's own width transition is in flight while composing, so place
  // against the target width rather than whatever this frame happens to measure
  var w = cmpPanelWidth(cmpMode), h = composer.offsetHeight || 150;
  var left = sx + NODE_W * cam.scale + 14;
  if (left + w > window.innerWidth - 10) left = sx - w - 14;
  if (left < 10) left = 10;
  var top = clamp(sy, 10, window.innerHeight - h - 10);
  composer.style.left = left + 'px';
  composer.style.top = top + 'px';
}

/* ---------- keyboard navigation ---------- */
/* left/right walk siblings (roots count as siblings of each other),
   down descends into the selected node's children — so navigation stays
   scoped to that parent's children — and up returns to the parent */
function navSort(list) { return list.sort(function (a, b) { return a.x - b.x || a.y - b.y; }); }
/* rejected cards are invisible to the carousel — walked past, never landed on
   (the current node stays in its own sibling list so the walk has an anchor) */
function navChildren(id) { return navSort(state.nodes.filter(function (n) { return n.parentId === id && !isRejected(n.id); })); }
function navSiblingsOf(n) {
  var pid = n.parentId || null;
  return navSort(state.nodes.filter(function (o) { return (o.parentId || null) === pid && (o.id === n.id || !isRejected(o.id)); }));
}
function navTo(n) {
  if (!n) return;
  organizeSettle();   // navigate against the final layout, not a moving one
  select(n.id);
  /* pan just enough to keep the node in view (36px margin, topbar excluded) */
  var m = 36;
  var x1 = n.x * cam.scale + cam.x, y1 = n.y * cam.scale + cam.y;
  var x2 = x1 + NODE_W * cam.scale, y2 = y1 + NODE_H * cam.scale;
  var dx = 0, dy = 0;
  if (x1 < m) dx = m - x1; else if (x2 > window.innerWidth - m) dx = window.innerWidth - m - x2;
  if (y1 < m + 44) dy = m + 44 - y1; else if (y2 > window.innerHeight - m) dy = window.innerHeight - m - y2;
  if (dx || dy) { cam.x += dx; cam.y += dy; applyCamera(); }
}
function navArrow(key) {
  var cur = selPrimary();
  if (!cur) {
    navTo(navSort(state.nodes.filter(function (n) { return n.parentId == null && !isRejected(n.id); }))[0]);
    return;
  }
  var sibs = navSiblingsOf(cur), i = sibs.indexOf(cur);
  if (key === 'ArrowLeft') navTo(sibs[i - 1]);
  else if (key === 'ArrowRight') navTo(sibs[i + 1]);
  else if (key === 'ArrowDown') {
    var kids = navChildren(cur.id);
    if (!kids.length) return;
    var best = kids[0], cx = cur.x + NODE_W / 2;
    kids.forEach(function (k) {
      if (Math.abs(k.x + NODE_W / 2 - cx) < Math.abs(best.x + NODE_W / 2 - cx)) best = k;
    });
    navTo(best);
  } else if (key === 'ArrowUp' && cur.parentId != null) {
    navTo(byId(cur.parentId));
  }
}
/* while inspecting, arrows retarget the overlay to the variant navigated to */
function handleNavKey(key) {
  var inspecting = state.inspectId != null;
  if (inspecting) ispGather(); // keyboard travel wakes the chrome like the pointer does
  var p = selPrimary();
  if (inspecting && (!p || p.id !== state.inspectId)) select(state.inspectId);
  navArrow(key);
  p = selPrimary();
  if (inspecting && p && p.id !== state.inspectId) openInspect(p.id);
}

