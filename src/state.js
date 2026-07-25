/* ---------- constants ---------- */
var NODE_W = 300, NODE_H = 215;
/* which project session + task this board shows: /b/<session>?task=<slug> */
var SESSION = (location.pathname.match(/^\/b\/([A-Za-z0-9_-]+)/) || [null, 'demo'])[1];
var API = '/api/s/' + SESSION;
var TASK = new URLSearchParams(location.search).get('task');
var TASKS = [];
var DIR = ''; // the session's absolute data dir — baked into the pick hand-off prompt
var fleetLive = false;
var POS_KEY = 'composer-pos'; // rescoped per session+task on boot
var REJ_KEY = 'composer-rejected'; // rescoped per session+task on boot
var rejected = new Set();

/* ---------- state ---------- */
/* selected is an ordered list — shift+click grows it; a plain click collapses
   it back to one. The last id is the anchor (composer placement, keyboard nav). */
var state = { nodes: [], ghosts: [], camera: { x: 0, y: 0, scale: 0.8 }, selected: [], winner: null, inspectId: null };
var cam = state.camera;
var nodeEls = {};   // real + ghost elements, keyed by node id
var drag = null;
var cmpCount = 3;
var CMP_MIN = 1, CMP_MAX = 12;
var currentAspect = '16:9';
var inspIframe = null, insPausedState = false;
var didFit = false;
var savedPos = {}; // loaded on boot once the task is known
var reqLog = [];   // last requests.jsonl view from the server, newest first

/* ---------- dom refs ---------- */
var canvas = document.getElementById('canvas');
var world  = document.getElementById('world');
var edgesSvg = document.getElementById('edges');
var composer = document.getElementById('composer');
var cmpModeEl = document.getElementById('cmpMode');
var cmpInput = document.getElementById('cmpInput');
var cmpField = document.getElementById('cmpField');
var cmpMirror = document.getElementById('cmpMirror');
var cmpInline = document.getElementById('cmpInline');
var cmpGo = document.getElementById('cmpGo');
var cmpN = document.getElementById('cmpN');
var cmpMinus = document.getElementById('cmpMinus');
var cmpPlus = document.getElementById('cmpPlus');
var cmpCountEl = document.getElementById('cmpCount');
var cmpOdo = document.getElementById('odo');
var cmpLadder = document.getElementById('ladder');
var cmpNote = document.getElementById('cmpNote');
var cmpImgs = document.getElementById('cmpImgs');
var mini = document.getElementById('minimap');
var inspect = document.getElementById('inspect');
var ispFrame = document.getElementById('ispFrame');
var ispStage = document.getElementById('ispStage');
var inspPaused = document.getElementById('ispPaused');
var ispAspect = document.getElementById('ispAspect');
var ispAspectBtn = document.getElementById('ispAspectBtn');
var ispPause = document.getElementById('ispPause');
var ispRestart = document.getElementById('ispRestart');
var ispPick = document.getElementById('ispPick');
var ispPickLabel = document.getElementById('ispPickLabel');
var ispPickCheck = document.getElementById('ispPickCheck');
var ispCopyPrompt = document.getElementById('ispCopyPrompt');
var ispClose = document.getElementById('ispClose');
var ispPrev = document.getElementById('ispPrev');
var ispNext = document.getElementById('ispNext');
var ispGlass = document.getElementById('ispGlass');
var ispGrow = document.getElementById('ispGrow');
var ispLadder = document.getElementById('ispLadder');
var ispLadderN = document.getElementById('ispLadderN');
var ispLadderWrap = document.getElementById('ispLadderWrap');
var toastEl = document.getElementById('toast');

/* ---------- helpers ---------- */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function allNodes() { return state.nodes.concat(state.ghosts); }
function byId(id) { var a = allNodes(); for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }
function isSelected(id) { return state.selected.indexOf(id) >= 0; }
function selNodes() {
  return state.selected.map(byId).filter(function (n) { return n && !n.building; });
}
function selPrimary() {
  var s = selNodes();
  return s.length ? s[s.length - 1] : null;
}
function screenToWorld(sx, sy) { return { x: (sx - cam.x) / cam.scale, y: (sy - cam.y) / cam.scale }; }
/* effort formatting: 640000 → "10m40s", 259772 → "260k" */
function fmtDur(ms) {
  var s = Math.round(ms / 1000);
  var m = Math.floor(s / 60);
  s = s % 60;
  return m ? m + 'm' + (s < 10 ? '0' : '') + s + 's' : s + 's';
}
function fmtTok(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : '' + n;
}

function modelColor(m) {
  if (/opus/.test(m)) return '#e0aa5a';
  if (/sonnet/.test(m)) return '#7c9cff';
  if (/haiku/.test(m)) return '#5ee08a';
  if (/fable/.test(m)) return '#c07cff';
  return '#8a9099';
}
function savePositions() {
  var out = {};
  state.nodes.forEach(function (n) { out[n.id] = { x: Math.round(n.x), y: Math.round(n.y) }; });
  try { localStorage.setItem(POS_KEY, JSON.stringify(out)); } catch (e) {}
}
var toastTimer;
function toast(msg) {
  trace('toast', { msg: msg });
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3200);
}

/* ---------- tracing ----------
   Every interaction lands in the task's trace.jsonl on the server, so a
   session can be reconstructed start to finish when something goes wrong.
   Events buffer here and flush in batches; pagehide flushes via sendBeacon
   so the tail of a session isn't lost when the tab closes. */
var traceBuf = [], traceTimer = null, traceSeq = 0;
var TRACE_ID = Math.random().toString(36).slice(2, 8); // one board load = one id
function trace(ev, data) {
  var e = { pg: TRACE_ID, seq: ++traceSeq, t: new Date().toISOString(), ev: ev };
  if (data) for (var k in data) if (data[k] !== undefined) e[k] = data[k];
  traceBuf.push(e);
  if (traceBuf.length >= 40) traceFlush();
  else if (!traceTimer) traceTimer = setTimeout(traceFlush, 2000);
}
function traceFlush(useBeacon) {
  clearTimeout(traceTimer);
  traceTimer = null;
  if (!traceBuf.length || !TASK) return;
  var payload = JSON.stringify({ events: traceBuf.splice(0) });
  var url = API + '/t/' + TASK + '/trace';
  if (useBeacon && navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
  } else {
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true })
      .catch(function () {});
  }
}
window.addEventListener('pagehide', function () { trace('pagehide'); traceFlush(true); });
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden') traceFlush(true);
});
/* a click's target, said in board words: the element chain, which card it
   was on, and where it hit — both on screen and on the board */
function traceTarget(el) {
  var parts = [];
  for (var e = el, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
    var s = e.tagName.toLowerCase();
    if (e.id) s += '#' + e.id;
    else if (typeof e.className === 'string' && e.className.trim())
      s += '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.');
    parts.push(s);
  }
  var out = { el: parts.join(' < ') };
  var card = el.closest ? el.closest('.node') : null;
  if (card) for (var id in nodeEls) if (nodeEls[id] === card) { out.node = id; break; }
  var txt = (el.textContent || '').trim();
  if (txt && !el.children.length) out.text = txt.slice(0, 40);
  return out;
}
document.addEventListener('click', function (e) {
  var d = traceTarget(e.target);
  d.x = e.clientX; d.y = e.clientY;
  var w = screenToWorld(e.clientX, e.clientY);
  d.wx = Math.round(w.x); d.wy = Math.round(w.y);
  if (e.shiftKey) d.shift = true;
  trace('click', d);
}, true);
document.addEventListener('dblclick', function (e) {
  trace('dblclick', traceTarget(e.target));
}, true);
window.addEventListener('error', function (e) {
  trace('error', { msg: String(e.message).slice(0, 300), src: e.filename, line: e.lineno, col: e.colno });
  traceFlush();
});
window.addEventListener('unhandledrejection', function (e) {
  trace('error', { msg: ('unhandled rejection: ' + (e.reason && (e.reason.message || e.reason))).slice(0, 300) });
  traceFlush();
});
/* the camera settles often (pan, zoom, tweens) — log where it comes to rest */
var traceCamTimer = null, traceCamLast = '';
function traceCamera() {
  clearTimeout(traceCamTimer);
  traceCamTimer = setTimeout(function () {
    var s = Math.round(cam.x) + ',' + Math.round(cam.y) + ',' + cam.scale.toFixed(2);
    if (s === traceCamLast) return;
    traceCamLast = s;
    trace('camera', { x: Math.round(cam.x), y: Math.round(cam.y), scale: +cam.scale.toFixed(3) });
  }, 500);
}
/* a compact picture of the whole board — where every card sits right now.
   Emitted after anything that rearranges cards (boot, drag, organize, a
   landing), debounced, so a visual bug can be re-drawn straight from the log. */
var traceLayoutTimer = null;
function traceLayout(why) {
  clearTimeout(traceLayoutTimer);
  traceLayoutTimer = setTimeout(function () {
    trace('layout', {
      why: why,
      nodes: allNodes().map(function (n) {
        var o = { id: n.id, x: Math.round(n.x), y: Math.round(n.y) };
        if (n.parentId) o.p = n.parentId;
        if (n.building) o.ghost = true;
        return o;
      })
    });
  }, 400);
}

/* srcdoc documents have no base URL, so a variant's relative srcs (worktree
   mode keeps NN-slug.png / .webm next to NN-slug.html) would 404 — inject a
   <base> aimed at the server's /v/ asset route. Inside <head> when the file
   has one; prepended otherwise (leading metadata lands in the implied head). */
function withBase(html) {
  var base = '<base href="/v/' + SESSION + '/' + TASK + '/">';
  var m = html.match(/<head[^>]*>/i);
  return m ? html.replace(m[0], m[0] + base) : base + html;
}

/* inject pause listener before </body>; script tags split so no literal close-tag hits the outer parser */
function withPause(html) {
  var scr = '<scr' + 'ipt>(function(){var s=document.createElement("style");' +
    's.textContent="*{animation-play-state:paused!important;-webkit-animation-play-state:paused!important}";' +
    'window.addEventListener("message",function(e){if(e.data==="pause"){if(!s.parentNode)document.documentElement.appendChild(s)}' +
    'else if(e.data==="play"){if(s.parentNode)s.parentNode.removeChild(s)}});' +
    'window.addEventListener("keydown",function(e){if(e.key==="Escape"||(e.key&&e.key.indexOf("Arrow")===0)){' +
    'e.preventDefault();parent.postMessage({composerKey:e.key},"*")}});' +
    /* "shot": rasterize this document's LIVE DOM (scripts have run, state is
       current) via SVG foreignObject → canvas → PNG blob back to the board.
       Runs in here because the sandboxed frame's pixels are unreachable from
       the parent — the page can only screenshot itself. */
    'window.addEventListener("message",function(e){if(e.data!=="shot")return;' +
    'var fail=function(){parent.postMessage({composerShotFail:1},"*")};' +
    'try{var w=innerWidth,h=innerHeight,d=document,clone=d.documentElement.cloneNode(true);' +
    // live form state and canvas pixels don't survive cloneNode — copy them over
    'var a=d.querySelectorAll("input,textarea,select"),b=clone.querySelectorAll("input,textarea,select");' +
    'for(var i=0;i<a.length;i++){var el=a[i],cl=b[i];if(!cl)continue;' +
    'if(el.tagName==="TEXTAREA")cl.textContent=el.value;' +
    'else if(el.tagName==="SELECT"){for(var j=0;j<el.options.length;j++){if(el.options[j].selected)cl.options[j].setAttribute("selected","");else cl.options[j].removeAttribute("selected")}}' +
    'else{cl.setAttribute("value",el.value);if(el.checked)cl.setAttribute("checked","");else cl.removeAttribute("checked")}}' +
    'var cv=d.querySelectorAll("canvas"),cw=clone.querySelectorAll("canvas");' +
    'for(i=0;i<cv.length;i++){if(!cw[i])continue;var im=d.createElement("img");' +
    'try{im.src=cv[i].toDataURL()}catch(_){}' +
    'im.className=cv[i].className;' +
    'im.setAttribute("style",(cv[i].getAttribute("style")||"")+";width:"+cv[i].offsetWidth+"px;height:"+cv[i].offsetHeight+"px");' +
    'cw[i].parentNode.replaceChild(im,cw[i])}' +
    'var xml=new XMLSerializer().serializeToString(clone);' +
    'var svg="<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\""+w+"\\" height=\\""+h+"\\"><foreignObject width=\\"100%\\" height=\\"100%\\">"+xml+"</foreignObject></svg>";' +
    'var img=new Image();' +
    'img.onload=function(){try{var k=2,c=d.createElement("canvas");c.width=w*k;c.height=h*k;' +
    'var x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,c.width,c.height);' +
    'x.scale(k,k);x.drawImage(img,0,0);' +
    'c.toBlob(function(bl){if(bl)parent.postMessage({composerShot:bl},"*");else fail()},"image/png")}catch(_){fail()}};' +
    'img.onerror=fail;' +
    'img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svg)}catch(_){fail()}})' +
    '})();<\/scr' + 'ipt>';
  return html.indexOf('</body>') !== -1 ? html.replace('</body>', scr + '</body>') : html + scr;
}

