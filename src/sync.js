/* ---------- server sync ---------- */
function refreshVariants(announce) {
  return fetch(API + '/t/' + TASK + '/variants').then(function (r) { return r.json(); }).then(function (list) {
    // one node per variant file — a tweak lands as a child card like any other
    var seen = {};
    var added = 0;
    var rootIdx = state.nodes.filter(function (n) { return n.parentId == null; }).length;
    list.forEach(function (v) {
      seen[v.id] = true;
      var parentId = v.parent || null;
      // a combine lists every parent it was mixed from; the extras keep their
      // ghostly strands once the real card lands where the ghost stood
      var extra = [];
      (v.parents || []).forEach(function (f) {
        if (f !== parentId && f !== v.id && extra.indexOf(f) < 0) extra.push(f);
      });
      var existing = byId(v.id);
      if (existing) {
        existing.parentId = parentId;
        if (extra.length) existing.extraParents = extra;
        // stats land in a second write (spawn.sh stamps after the builder
        // exits), so an already-seen node can still gain its effort badge
        existing.stats = v.stats || null;
        return;
      }
      var pos = savedPos[v.id], how = 'saved';
      if (!pos) {
        var parent = parentId ? byId(parentId) : null;
        if (parent) {
          pos = adoptGhostSlot(parent.id);
          how = pos ? 'ghost-slot' : 'placed';
          if (!pos) pos = placeArrival(parent, Date.parse(v.ts) || 0);
        } else {
          pos = placeRoot(rootIdx++);
          how = 'root';
        }
      }
      trace('variant:landed', {
        id: v.id, name: v.name, model: v.model, parent: parentId,
        x: Math.round(pos.x), y: Math.round(pos.y), how: how
      });
      var n = {
        id: v.id, parentId: parentId, ts: v.ts,
        extraParents: extra.length ? extra : (pos.extraParents || []),
        name: v.name, model: v.model, description: v.description, html: v.html, url: v.url,
        commit: v.commit || null, stats: v.stats || null,
        x: pos.x, y: pos.y, building: false
      };
      state.nodes.push(n);
      createNodeEl(n);
      added++;
    });
    state.nodes = state.nodes.filter(function (n) {
      if (seen[n.id]) return true;
      trace('variant:removed', { id: n.id });
      removeNodeEl(n.id);
      var si = state.selected.indexOf(n.id);
      if (si >= 0) { state.selected.splice(si, 1); syncComposer(); }
      return false;
    });
    renderEdges();
    renderMinimap();
    state.nodes.forEach(updateNodeVisual); // repaint late-arriving effort badges
    paintEffort();
    if (added > 0) traceLayout('landed');
    if (!didFit && state.nodes.length) { didFit = true; fitView(); }
    if (announce && added > 0) toast(added + ' new variant' + (added > 1 ? 's' : '') + ' arrived ✨');
  });
}

// failed requests toast once each — but never for failures that predate
// this page load (reqsPrimed gates the first refresh)
var failedSeen = {}, reqsPrimed = false;

function refreshRequests() {
  return fetch(API + '/t/' + TASK + '/requests').then(function (r) { return r.json(); }).then(function (reqs) {
    reqLog = reqs;
    reqs.forEach(function (rq) {
      if (rq.status !== 'failed' || failedSeen[rq.id]) return;
      failedSeen[rq.id] = true;
      trace('request:failed', { id: rq.id, note: rq.note });
      if (reqsPrimed) toast('Generation failed' + (rq.note ? ' — ' + rq.note : ''));
    });
    reqsPrimed = true;
    // the winner is server-side state: the newest non-cancelled pick request
    var w = null;
    for (var i = 0; i < reqs.length; i++) {
      if (reqs[i].type === 'pick' && reqs[i].status !== 'cancelled' && reqs[i].variants && reqs[i].variants[0]) { w = reqs[i].variants[0]; break; }
    }
    if (w !== state.winner) {
      trace('winner', { id: w });
      state.winner = w;
      allNodes().forEach(updateNodeVisual);
      if (state.inspectId) ispPaintPick();
    }
    // ghost nodes for the slots of open iterate requests still being built
    var wanted = {};
    iterateSlots().forEach(function (s) {
      var rq = s.req;
      if (rq.status === 'done' || rq.status === 'cancelled' || rq.status === 'failed') return;
      var parent = byId(s.parentId);
      if (!parent || parent.building) return;
      for (var i = s.filled; i < rq.count; i++) {
        var gid = 'ghost:' + rq.id + ':' + i;
        wanted[gid] = true;
        if (byId(gid)) continue;
        var pos = placeChild(parent, i, rq.count);
        var g = {
          id: gid, name: 'building…', model: 'fleet', description: '',
          parentId: parent.id,
          extraParents: rq.variants.slice(1),
          html: '', x: pos.x, y: pos.y, building: true, reqText: rq.text, reqId: rq.id
        };
        trace('ghost:opened', { id: gid, req: rq.id, parent: parent.id, x: Math.round(pos.x), y: Math.round(pos.y) });
        state.ghosts.push(g);
        createNodeEl(g);
      }
    });
    state.ghosts = state.ghosts.filter(function (g) {
      if (wanted[g.id]) return true;
      trace('ghost:closed', { id: g.id });
      removeNodeEl(g.id);
      return false;
    });
    renderEdges();
    renderMinimap();
  });
}

function cancelRequest(reqId) {
  trace('request:cancel', { id: reqId });
  // allowed even when the fleet is offline — it only retracts work
  fetch(API + '/t/' + TASK + '/requests/' + reqId + '/cancel', { method: 'POST' }).then(function (r) {
    if (r.ok) toast('Generation cancelled');
    refreshRequests();
  });
}

function sendRequest(text, variantIds, count, type, images) {
  var body = { text: text, variants: variantIds };
  // which model the fleet should build with — iterate and tweak both carry it
  if (type === 'iterate' || type === 'tweak') body.model = cmpModel().id;
  if (count) body.count = count;
  if (type) body.type = type;
  if (images && images.length) body.images = images;
  // what was asked for, verbatim — then whether the server took it
  trace('request:send', {
    type: type || 'feedback', text: text, variants: variantIds,
    count: count || undefined, model: body.model, images: body.images
  });
  return fetch(API + '/t/' + TASK + '/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(function (r) {
    return r.json().then(function (d) {
      trace(r.ok ? 'request:ack' : 'request:fail', { id: d.id, error: d.error, http: r.status });
      return r;
    }).catch(function () { trace('request:fail', { http: r.status }); return r; });
  }, function (err) {
    trace('request:fail', { msg: String(err).slice(0, 200) });
    throw err;
  });
}

/* ---------- iterate (core) ---------- */
function doIterate() {
  var parents = selNodes();
  if (!parents.length) return;
  if (!fleetLive) { cmpShowNote('Fleet offline — run /composer to reconnect.'); return; }
  if (!cmpImagesReady()) { cmpShowNote('Still uploading an image…', 2600); return; }
  var req = cmpInput.value.trim();
  var imgs = cmpImages.map(function (i) { return i.file; });
  var names = parents.map(function (p) { return '"' + p.name + '"'; }).join(' + ');
  var text = 'Iterate ' + cmpCount + ' new variant' + (cmpCount > 1 ? 's' : '') +
    (parents.length > 1 ? ' combining ' + names : ' from ' + names) + (req ? ' — ' + req : '') +
    (imgs.length ? ' (see the ' + (imgs.length > 1 ? imgs.length + ' attached reference images' : 'attached reference image') + ')' : '');
  var ids = parents.map(function (p) { return p.id; });
  sendRequest(text, ids, cmpCount, 'iterate', imgs).then(function () {
    cmpInput.value = '';
    cmpClearImages();
    cmpLayout(true);   // collapse straight back to the bare chip
    cmpShowNote('<i class="dot"></i>Sent · ' + cmpCount + ' variant' + (cmpCount > 1 ? 's' : ''), 3800);
    refreshRequests();
  });
}

/* ---------- tweak (one small change, lands as a child card) ---------- */
function doTweak() {
  var n = selPrimary();
  if (!n) return;
  if (!fleetLive) { cmpShowNote('Fleet offline — run /composer to reconnect.'); return; }
  var req = cmpInput.value.trim();
  if (!req) { cmpShowNote('Describe the tweak first.', 2600); return; }
  // count:1 so the board draws a ghost child slot for it, like an iterate
  sendRequest('Tweak "' + n.name + '" — ' + req, [n.id], 1, 'tweak').then(function () {
    cmpInput.value = '';
    cmpLayout(true);
    cmpShowNote('<i class="dot"></i>Sent · tweak', 3800);
    refreshRequests();
  });
}
function doSend() {
  // a rejected card is a dead end — nothing regenerates from it
  var p = selPrimary();
  if (p && isRejected(p.id)) { cmpShowNote('Rejected — rescue it to iterate.', 2600); return; }
  if (cmpModeType === 'tweak') doTweak(); else doIterate();
}

/* the Reject segment mirrors the anchor selection; Iterate locks against it */
var cmpReject = document.getElementById('cmpReject');
function refreshRejectBtn() {
  var sel = selNodes();
  var one = sel.length === 1 && !sel[0].building ? sel[0] : null;
  composer.classList.toggle('show-reject', !!one);
  if (one) {
    var r = isRejected(one.id);
    cmpReject.classList.toggle('is-rejected', r);
    cmpReject.querySelector('.lbl').textContent = r ? 'Rescue' : 'Reject';
    cmpReject.title = r ? 'Rescue this variant' : 'Reject this variant';
  }
}
function refreshIterateLock() {
  var p = selPrimary();
  if (p && isRejected(p.id)) {
    cmpGo.disabled = true;
    cmpGo.title = 'rejected — rescue to iterate';
  } else {
    cmpGo.disabled = !fleetLive;
    cmpGo.title = '';
  }
}
cmpReject.addEventListener('click', function (e) {
  e.stopPropagation();
  var sel = selNodes();
  if (sel.length === 1) toggleReject(sel[0].id);
});


/* ---------- effort tally ---------- */
/* header line: Σ builder time (parallel-aware wall clock in parens) · cards
   · tokens. Wall clock = union of each stamped builder's [ts-ms, ts]
   interval, so overlapping builders only count once. */
function paintEffort() {
  var el = document.getElementById('effort');
  if (!el) return;
  var iv = [], ms = 0, tin = 0, tout = 0, count = 0;
  state.nodes.forEach(function (nd) {
    if (!nd.stats || !nd.stats.ms) return;
    count++;
    ms += nd.stats.ms; tin += nd.stats.in || 0; tout += nd.stats.out || 0;
    var end = Date.parse(nd.ts) || 0;
    if (end) iv.push([end - nd.stats.ms, end]);
  });
  if (!count) { el.textContent = ''; return; }
  iv.sort(function (a, b) { return a[0] - b[0]; });
  var wall = 0, cur = null;
  iv.forEach(function (s) {
    if (!cur || s[0] > cur[1]) { if (cur) wall += cur[1] - cur[0]; cur = s.slice(); }
    else if (s[1] > cur[1]) cur[1] = s[1];
  });
  if (cur) wall += cur[1] - cur[0];
  el.textContent = '· ' + fmtDur(ms) + ' (' + fmtDur(wall) + ') · ' +
    count + ' card' + (count > 1 ? 's' : '') + ' · ' +
    fmtTok(tin) + ' in · ' + fmtTok(tout) + ' out';
}
