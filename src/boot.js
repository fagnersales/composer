/* ---------- fleet liveness ---------- */
/* iterate/pick only work while a fleet agent is heartbeating; without one
   the requests would sit in the file forever, so the board locks them */
var liveEl = document.getElementById('live');
function setLive(v) {
  if (v !== fleetLive) trace('fleet', { live: v });
  fleetLive = v;
  liveEl.textContent = v ? '● fleet live' : '○ fleet offline';
  liveEl.classList.toggle('off', !v);
  liveEl.title = v ? 'A fleet agent is listening' : 'No fleet agent — run /composer in the project to reconnect';
  cmpGo.disabled = !v;
  composer.classList.toggle('offline', !v);
  refreshIterateLock(); // a rejected selection keeps Iterate locked even when live
  if (!v) cmpShowNote('Fleet offline — run /composer to reconnect.');
  else if (cmpNote.textContent.indexOf('offline') !== -1) cmpHideNote();
}

/* ---------- boot + live sync ---------- */
applyCamera();
document.getElementById('sessName').textContent = SESSION;
fetch(API + '/tasks').then(function (r) {
  if (!r.ok) throw new Error('unknown session');
  return r.json();
}).then(function (info) {
  TASKS = info.tasks || [];
  if (!TASK && TASKS.length) TASK = TASKS[0].slug; // newest task by default
  var sel = document.getElementById('taskSel');
  if (!TASKS.length) {
    var o = document.createElement('option');
    o.textContent = 'no tasks yet';
    sel.appendChild(o);
    sel.disabled = true;
  }
  TASKS.forEach(function (t) {
    var o = document.createElement('option');
    o.value = t.slug;
    o.textContent = 'task: “' + t.title + '”';
    if (t.slug === TASK) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', function () { location.href = '/b/' + SESSION + '?task=' + sel.value; });
  setLive(!!info.live);
  if (!TASK) return;
  document.title = 'Composer — ' + SESSION;
  POS_KEY = 'composer-pos:' + SESSION + ':' + TASK;
  try { savedPos = JSON.parse(localStorage.getItem(POS_KEY) || '{}'); } catch (e) { savedPos = {}; }
  REJ_KEY = 'composer-rejected:' + SESSION + ':' + TASK;
  try { rejected = new Set(JSON.parse(localStorage.getItem(REJ_KEY) || '[]')); } catch (e) { rejected = new Set(); }
  trace('boot', {
    session: SESSION, task: TASK, href: location.href,
    vw: window.innerWidth, vh: window.innerHeight,
    theme: document.documentElement.getAttribute('data-theme'),
    savedPositions: Object.keys(savedPos).length, live: !!info.live
  });
  // requests first: a cold load must know the open slots before it places the
  // children that already filled some of them
  refreshRequests().then(function () { return refreshVariants(false); }).then(refreshRequests);
  var es = new EventSource(API + '/events?task=' + TASK);
  es.onmessage = function (ev) {
    var msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.kind === 'status') setLive(!!msg.live);
    else { trace('sse:change'); refreshVariants(true).then(refreshRequests); }
  };
  es.onerror = function () { trace('sse:error'); liveEl.textContent = '○ reconnecting…'; liveEl.classList.add('off'); };
}).catch(function () {
  liveEl.textContent = '○ unknown session';
  liveEl.classList.add('off');
});
