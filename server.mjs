import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const REG_FILE = path.join(ROOT, "sessions.json");
const PORT = Number(process.env.PORT) || 4600;
const LIVE_MS = 90_000; // fleet agent counts as live if it heartbeat within this window

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/* ── sessions ─────────────────────────────── */
// One hub serves many projects. The registry persists name → data dir
// (a project's .composer folder); heartbeats are in-memory only —
// after a restart, agents re-register within one poll cycle.
function saveRegistry() {
  fs.writeFileSync(REG_FILE, JSON.stringify(registry, null, 2) + "\n");
}
let registry = {};
if (fs.existsSync(REG_FILE)) {
  try { registry = JSON.parse(fs.readFileSync(REG_FILE, "utf8")); } catch {}
} else if (fs.existsSync(path.join(ROOT, "demo"))) {
  registry = { demo: { dir: path.join(ROOT, "demo") } };
  saveRegistry();
}
// the address a phone on the same network reaches this hub at
function lanIP() {
  for (const ifs of Object.values(os.networkInterfaces()))
    for (const i of ifs || []) if (i.family === "IPv4" && !i.internal) return i.address;
  return "localhost";
}

const lastSeen = new Map();
// which task the board is showing, per session — a paired phone follows it
// (and the board follows the phone's switcher back). Ephemeral, like focus.
const sessionTask = new Map();
function isLive(name) { return Date.now() - (lastSeen.get(name) || 0) < LIVE_MS; }
function taskPath(name, task) { return path.join(registry[name].dir, task); }

/* ── data ─────────────────────────────────── */

function loadTasks(name) {
  const dir = registry[name]?.dir;
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && NAME_RE.test(d.name))
    .map((d) => {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, d.name, "task.json"), "utf8")); } catch {}
      const vdir = path.join(dir, d.name, "variants");
      const variants = fs.existsSync(vdir)
        ? fs.readdirSync(vdir).filter((f) => f.endsWith(".html")).length
        : 0;
      return { slug: d.name, title: meta.title || d.name, created: meta.created || null, variants };
    })
    .sort((a, b) => (b.created || "").localeCompare(a.created || ""));
}

function loadVariants(name, task) {
  const dir = path.join(taskPath(name, task), "variants");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .sort()
    .map((file) => {
      const full = path.join(dir, file);
      const html = fs.readFileSync(full, "utf8");
      // when the file first appeared — the board matches a landed variant to the
      // open iterate request that asked for it, so ghost slots survive a reload
      const st = fs.statSync(full);
      let meta = {};
      const m = html.match(/<!--\s*variant-meta\s+({[\s\S]*?})\s*-->/);
      if (m) {
        try { meta = JSON.parse(m[1]); } catch {}
      }
      return {
        id: file,
        name: meta.name || file.replace(/\.html$/, ""),
        model: meta.model || "",
        description: meta.description || "",
        parent: meta.parent || null,
        // a combine names every parent it was mixed from; parent stays the primary one
        parents: Array.isArray(meta.parents) ? meta.parents.filter((p) => typeof p === "string") : null,
        url: meta.url || null, // url variants render a live route instead of the file body
        // min: a copied / restored tree keeps its mtimes but is born now
        ts: new Date(Math.min(st.birthtimeMs || Infinity, st.mtimeMs)).toISOString(),
        html,
      };
    });
}

/* ── images ───────────────────────────────── */
// Reference images pasted into the board's composer. Stored content-addressed
// in <task>/images/ so re-pasting the same screenshot never duplicates, and
// request lines can point at them with stable relative paths.
const IMG_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const IMG_FILE_RE = /^[a-f0-9]{12}\.(png|jpg|gif|webp)$/;
const IMG_MAX = 10 * 1024 * 1024;

// requests.jsonl is append-only. "request" lines create entries; "status"
// lines (appended later) override an entry's status — except "cancelled",
// which is terminal (nothing legitimately un-cancels). Never rewritten.
function requestsFile(name, task) { return path.join(taskPath(name, task), "requests.jsonl"); }
function loadRequests(name, task) {
  const file = requestsFile(name, task);
  if (!fs.existsSync(file)) return [];
  const lines = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  const byId = new Map();
  for (const l of lines) {
    if (l.kind === "request") byId.set(l.id, { ...l });
    else if (l.kind === "status" && byId.has(l.id)) {
      const r = byId.get(l.id);
      // a stale "building" from a fleet that claimed the request before
      // seeing the cancel must not resurrect it on the board
      if (r.status === "cancelled") continue;
      r.status = l.status;
      if (l.note) r.note = l.note;
    }
  }
  return [...byId.values()].reverse(); // newest first
}
function appendRequest(name, task, entry) {
  fs.appendFileSync(requestsFile(name, task), JSON.stringify(entry) + "\n");
}

/* ── trace ────────────────────────────────── */
// Debug timeline for a task: the board posts batches of UI events (clicks,
// sends, landings, errors) and they land here as append-only JSONL, one file
// per task, so a session can be replayed start to finish. Never rewritten.
const TRACE_MAX_BATCH = 500;
function traceFile(name, task) { return path.join(taskPath(name, task), "trace.jsonl"); }
function appendTrace(name, task, events) {
  const recv = new Date().toISOString();
  const lines = events
    .slice(0, TRACE_MAX_BATCH)
    .filter((e) => e && typeof e === "object")
    .map((e) => JSON.stringify({ ...e, recv }) + "\n")
    .join("");
  if (lines) fs.appendFileSync(traceFile(name, task), lines);
}

/* ── live updates (SSE) ───────────────────── */
// One watcher group per (session, task); a recursive watch on the task dir
// covers variants/, requests.jsonl and task.json in one go.
const groups = new Map();
function group(name, task) {
  const key = name + "\0" + task;
  let g = groups.get(key);
  if (!g) {
    g = { name, clients: new Set(), watcher: null, debounce: null };
    try {
      g.watcher = fs.watch(taskPath(name, task), { recursive: true }, (ev, fn) => {
        // trace writes are the board talking to itself — never a board change
        if (fn && /(^|[\\/])trace\.jsonl$/.test(fn)) return;
        clearTimeout(g.debounce);
        g.debounce = setTimeout(() => send(g, { kind: "change" }), 150);
      });
    } catch {}
    groups.set(key, g);
  }
  return g;
}
function send(g, msg) {
  for (const res of g.clients) res.write(`data: ${JSON.stringify(msg)}\n\n`);
}

// push liveness flips + keepalive pings
const liveState = new Map();
setInterval(() => {
  const names = new Set([...groups.values()].map((g) => g.name));
  for (const n of names) {
    const v = isLive(n);
    if (liveState.get(n) !== v) {
      liveState.set(n, v);
      for (const g of groups.values()) if (g.name === n) send(g, { kind: "status", live: v });
    }
  }
  for (const g of groups.values()) for (const res of g.clients) res.write(": ping\n\n");
}, 5000);

/* ── phone remote ─────────────────────────── */
// One variant full-screen on a phone, walking the same list as the board.
// Focus rides the task's SSE channel both ways: swipe here → the board pans
// there; select there → this page switches. Session comes from the path,
// like the board's /b/ page.
function phonePage() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<title>Composer — phone</title><style>
  *{box-sizing:border-box;margin:0}
  html,body{height:100%;overflow:hidden}
  body{display:flex;flex-direction:column;background:#0a0a0a;color:#f5f5f5;
    font-family:'Geist',ui-sans-serif,-apple-system,sans-serif}
  header{flex:none;display:flex;align-items:center;gap:8px;padding:10px 14px;
    padding-top:calc(10px + env(safe-area-inset-top));border-bottom:1px solid #262626;font-size:13px}
  header select{flex:none;max-width:42%;border:1px solid #262626;border-radius:8px;background:#141414;
    color:#f5f5f5;font:inherit;font-size:12px;padding:4px 6px;overflow:hidden;text-overflow:ellipsis}
  header .nm{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  header .ct{margin-left:auto;color:#737373;font-variant-numeric:tabular-nums;flex:none}
  header i{width:7px;height:7px;border-radius:50%;background:#404040;flex:none}
  iframe{flex:1;width:100%;border:0;background:#fff}
  footer{flex:none;display:flex;align-items:stretch;gap:1px;background:#262626;border-top:1px solid #262626;
    padding-bottom:env(safe-area-inset-bottom)}
  footer button{flex:1;border:0;background:#141414;color:#f5f5f5;font-size:22px;padding:14px 0;font-family:inherit}
  footer button:active{background:#1f1f1f}
  footer button:disabled{color:#404040}
  .empty{flex:1;display:grid;place-items:center;color:#737373;font-size:13px}
</style></head><body>
<header><select id="taskSel" aria-label="Task"></select><i id="dot"></i><span class="nm" id="nm">connecting…</span><span class="ct" id="ct"></span></header>
<iframe id="fr"></iframe>
<footer><button id="prev" aria-label="Previous variant">‹</button><button id="next" aria-label="Next variant">›</button></footer>
<script>
var S = (location.pathname.match(/^\\/m\\/([A-Za-z0-9_-]+)/) || [])[1];
var API = '/api/s/' + S;
var TASK = new URLSearchParams(location.search).get('task');
var SRC = 'ph-' + Math.random().toString(36).slice(2, 8);
var list = [], cur = -1, pendingFocus = null, es = null, TASKS = [];
var fr = document.getElementById('fr'), nm = document.getElementById('nm'), ct = document.getElementById('ct');
var taskSel = document.getElementById('taskSel');

function show(i, push) {
  if (!list.length) return;
  i = ((i % list.length) + list.length) % list.length;
  var v = list[i];
  if (i !== cur) {
    cur = i;
    fr.src = '/v/' + S + '/' + TASK + '/' + v.id;
  }
  nm.textContent = v.name;
  ct.textContent = (cur + 1) + ' / ' + list.length;
  document.getElementById('dot').style.background = modelColor(v.model);
  if (push) fetch(API + '/t/' + TASK + '/focus', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ variant: v.id, src: SRC })
  }).catch(function () {});
}
function modelColor(m) {
  if (/opus/.test(m)) return '#e0aa5a';
  if (/sonnet/.test(m)) return '#7c9cff';
  if (/haiku/.test(m)) return '#5ee08a';
  if (/fable/.test(m)) return '#c07cff';
  return '#8a9099';
}
function idx(id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return i; return -1; }
function load() {
  return fetch(API + '/t/' + TASK + '/variants').then(function (r) { return r.json(); }).then(function (l) {
    var curId = cur >= 0 && list[cur] ? list[cur].id : null;
    list = l;
    if (!list.length) { nm.textContent = 'no variants yet'; ct.textContent = ''; cur = -1; return; }
    var i = pendingFocus != null ? idx(pendingFocus) : -1;
    pendingFocus = null;
    if (i < 0 && curId) i = idx(curId);
    show(i < 0 ? 0 : i, false);
  });
}
document.getElementById('prev').addEventListener('click', function () { show(cur - 1, true); });
document.getElementById('next').addEventListener('click', function () { show(cur + 1, true); });

function fillTasks() {
  taskSel.innerHTML = '';
  TASKS.forEach(function (t) {
    var o = document.createElement('option');
    o.value = t.slug; o.textContent = t.title;
    taskSel.appendChild(o);
  });
  taskSel.value = TASK;
}
function attach() {
  if (es) es.close();
  es = new EventSource(API + '/events?task=' + TASK);
  es.onmessage = function (ev) {
    var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.kind === 'focus' && msg.src !== SRC) {
      var i = idx(msg.variant);
      if (i >= 0) show(i, false); else pendingFocus = msg.variant;
    } else if (msg.kind === 'task') {
      if (msg.src !== SRC && msg.task && msg.task !== TASK) switchTask(msg.task, false);
    } else if (msg.kind === 'change') load();
  };
}
function knownTask(slug) {
  for (var i = 0; i < TASKS.length; i++) if (TASKS[i].slug === slug) return true;
  return false;
}
function switchTask(slug, push) {
  if (slug === TASK) return;
  TASK = slug;
  list = []; cur = -1; pendingFocus = null;
  fr.removeAttribute('src');
  nm.textContent = 'loading…'; ct.textContent = '';
  history.replaceState(null, '', '/m/' + S + '?task=' + TASK);
  // a task born after this page loaded is missing from the switcher — refetch
  var ready = knownTask(slug)
    ? Promise.resolve()
    : fetch(API + '/tasks').then(function (r) { return r.json(); }).then(function (info) { TASKS = info.tasks || []; });
  ready.then(function () { fillTasks(); return load(); }).then(attach);
  if (push) fetch(API + '/task', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task: slug, src: SRC })
  }).catch(function () {});
}
taskSel.addEventListener('change', function () { switchTask(taskSel.value, true); });

fetch(API + '/tasks').then(function (r) { return r.json(); }).then(function (info) {
  TASKS = info.tasks || [];
  // start where the board is; the URL's task and the newest task are fallbacks
  if (!TASK || !knownTask(TASK)) TASK = info.boardTask || (TASKS.length ? TASKS[0].slug : null);
  if (!TASK) { nm.textContent = 'no tasks yet'; return; }
  document.title = 'Composer — ' + S;
  fillTasks();
  history.replaceState(null, '', '/m/' + S + '?task=' + TASK);
  load().then(attach);
}).catch(function () { nm.textContent = 'unknown session'; });
<\/script></body></html>`;
}

/* ── http ─────────────────────────────────── */

function json(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}
async function readBody(req) {
  let b = "";
  for await (const c of req) b += c;
  try { return JSON.parse(b); } catch { return null; }
}
async function readRaw(req, max) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > max) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// the hub index: every registered project, its tasks, live state
function hubPage() {
  const rows = Object.entries(registry).map(([name, s]) => {
    const live = isLive(name);
    const tasks = loadTasks(name)
      .map((t) => `<a href="/b/${name}?task=${t.slug}">${esc(t.title)} <span>· ${t.variants} variant${t.variants === 1 ? "" : "s"}</span></a>`)
      .join("") || "<em>no tasks yet</em>";
    return `<section><h2><i class="${live ? "on" : ""}"></i>${esc(name)}<small>${esc(s.dir)}</small></h2>${tasks}</section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Composer — sessions</title><style>
    body{font-family:'Geist',ui-sans-serif,-apple-system,sans-serif;background:#0a0a0a;color:#f5f5f5;max-width:680px;margin:48px auto;padding:0 24px}
    h1{font-size:18px;letter-spacing:-.02em}p.sub{color:#737373;font-size:13px;margin:6px 0 28px}
    section{border:1px solid #262626;border-radius:14px;padding:16px 18px;margin-bottom:14px;background:#141414}
    h2{font-size:14px;margin:0 0 10px;display:flex;align-items:center;gap:8px}
    h2 small{color:#737373;font-weight:400;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    h2 i{width:8px;height:8px;border-radius:50%;background:#404040;flex:none}h2 i.on{background:#5ee08a}
    a{display:block;color:#f5f5f5;text-decoration:none;font-size:13px;padding:7px 10px;border-radius:8px}
    a:hover{background:#1f1f1f}a span{color:#737373;font-size:11px}em{color:#525252;font-size:12px}
  </style></head><body><h1>Composer</h1><p class="sub">registered project sessions · ● = fleet agent live</p>${rows}</body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  let m;

  if (p === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(hubPage());
  }

  // phone remote for a session: one variant full-screen, focus synced with the board
  if ((m = p.match(/^\/m\/([A-Za-z0-9_-]+)\/?$/))) {
    if (!registry[m[1]]) { res.writeHead(404); return res.end("unknown session"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(phonePage());
  }

  // a single variant as a standalone page — what the phone iframes
  if ((m = p.match(/^\/v\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+\.html)$/))) {
    const [, name, task, file] = m;
    if (!registry[name]) { res.writeHead(404); return res.end("unknown session"); }
    const fp = path.join(taskPath(name, task), "variants", file);
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
    const html = fs.readFileSync(fp, "utf8");
    const mm = html.match(/<!--\s*variant-meta\s+({[\s\S]*?})\s*-->/);
    let meta = {};
    if (mm) { try { meta = JSON.parse(mm[1]); } catch {} }
    // url variants live on a dev server; a localhost url is rewritten to this
    // machine's LAN address so the redirect still lands from another device
    if (meta.url) {
      let loc = meta.url;
      try {
        const u = new URL(loc, `http://localhost:${PORT}`);
        if (u.hostname === "localhost" || u.hostname === "127.0.0.1") u.hostname = lanIP();
        loc = u.href;
      } catch {}
      res.writeHead(302, { Location: loc });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(html);
  }

  // board UI for a session
  if ((m = p.match(/^\/b\/([A-Za-z0-9_-]+)\/?$/))) {
    if (!registry[m[1]]) { res.writeHead(404); return res.end("unknown session"); }
    // read fresh + no-cache: editing index.html and reloading must be enough
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(fs.readFileSync(path.join(ROOT, "index.html")));
  }

  /* session registry */
  if (p === "/api/sessions" && req.method === "GET") {
    return json(res, 200, Object.entries(registry).map(([name, s]) => ({
      name, dir: s.dir, live: isLive(name), tasks: loadTasks(name),
    })));
  }
  if (p === "/api/sessions" && req.method === "POST") {
    const b = await readBody(req);
    const name = b?.name, dir = b?.dir;
    if (!NAME_RE.test(name || "")) return json(res, 400, { error: "bad name" });
    if (!dir || !path.isAbsolute(dir) || !fs.existsSync(dir))
      return json(res, 400, { error: "dir must be an absolute, existing path" });
    if (registry[name] && path.resolve(registry[name].dir) !== path.resolve(dir))
      return json(res, 409, { error: "name registered to another dir", dir: registry[name].dir });
    registry[name] = { dir: path.resolve(dir) };
    saveRegistry();
    lastSeen.set(name, Date.now());
    return json(res, 200, { name, dir: registry[name].dir, live: true, board: `http://localhost:${PORT}/b/${name}` });
  }
  if ((m = p.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)\/heartbeat$/)) && req.method === "POST") {
    if (!registry[m[1]]) return json(res, 404, { error: "unknown session" });
    lastSeen.set(m[1], Date.now());
    return json(res, 200, { live: true });
  }

  /* session-scoped api */
  if ((m = p.match(/^\/api\/s\/([A-Za-z0-9_-]+)\/(.+)$/))) {
    const name = m[1], rest = m[2];
    if (!registry[name]) return json(res, 404, { error: "unknown session" });

    if (rest === "tasks")
      return json(res, 200, {
        live: isLive(name), tasks: loadTasks(name),
        // where a phone on the same network reaches this session's remote
        phone: `http://${lanIP()}:${PORT}/m/${name}`,
        boardTask: sessionTask.get(name) || null,
      });

    // task switch announcement — broadcast to every SSE client of the session
    // regardless of which task's channel they sit on, so devices can hop over
    if (rest === "task" && req.method === "POST") {
      const b = await readBody(req);
      const t = b?.task;
      if (!NAME_RE.test(t || "") || !fs.existsSync(taskPath(name, t)))
        return json(res, 400, { error: "unknown task" });
      const src = typeof b?.src === "string" ? b.src.slice(0, 16) : "";
      sessionTask.set(name, t);
      for (const g of groups.values()) if (g.name === name) send(g, { kind: "task", task: t, src });
      return json(res, 200, { ok: true });
    }

    if (rest === "events") {
      const task = url.searchParams.get("task") || "";
      if (!NAME_RE.test(task) || !fs.existsSync(taskPath(name, task)))
        return json(res, 404, { error: "unknown task" });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      const g = group(name, task);
      g.clients.add(res);
      res.write(`data: ${JSON.stringify({ kind: "status", live: isLive(name) })}\n\n`);
      // a device joining mid-session starts on whatever is focused right now
      if (g.focus) res.write(`data: ${JSON.stringify({ kind: "focus", ...g.focus })}\n\n`);
      req.on("close", () => g.clients.delete(res));
      return;
    }

    // shared focus: board and phone(s) tell each other which variant is looked
    // at. Ephemeral — lives on the SSE group, never written to disk.
    const fo = rest.match(/^t\/([A-Za-z0-9_-]+)\/focus$/);
    if (fo && req.method === "POST") {
      const dir = taskPath(name, fo[1]);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
        return json(res, 404, { error: "unknown task" });
      const b = await readBody(req);
      if (typeof b?.variant !== "string" || !b.variant)
        return json(res, 400, { error: "variant required" });
      const g = group(name, fo[1]);
      // src tags the sender so it can ignore its own echo
      g.focus = { variant: b.variant.slice(0, 200), src: typeof b.src === "string" ? b.src.slice(0, 16) : "" };
      send(g, { kind: "focus", ...g.focus });
      return json(res, 200, { ok: true });
    }

    const im = rest.match(/^t\/([A-Za-z0-9_-]+)\/images(?:\/([a-f0-9]{12}\.[a-z0-9]+))?$/);
    if (im) {
      const dir = taskPath(name, im[1]);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
        return json(res, 404, { error: "unknown task" });
      const idir = path.join(dir, "images");

      if (!im[2] && req.method === "POST") {
        const ext = IMG_EXT[(req.headers["content-type"] || "").split(";")[0].trim()];
        if (!ext) return json(res, 415, { error: "png, jpeg, gif or webp only" });
        const buf = await readRaw(req, IMG_MAX);
        if (!buf) return json(res, 413, { error: "image too large (10MB max)" });
        if (!buf.length) return json(res, 400, { error: "empty body" });
        const file = crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12) + "." + ext;
        fs.mkdirSync(idir, { recursive: true });
        fs.writeFileSync(path.join(idir, file), buf);
        return json(res, 200, { file: "images/" + file });
      }
      if (im[2] && req.method === "GET" && IMG_FILE_RE.test(im[2])) {
        const fp = path.join(idir, im[2]);
        if (!fs.existsSync(fp)) { res.writeHead(404); return res.end("not found"); }
        const type = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" }[im[2].split(".").pop()];
        // content-addressed names never change contents — cache forever
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "max-age=31536000, immutable" });
        return res.end(fs.readFileSync(fp));
      }
    }

    // debug trace: POST appends a batch of board events, GET reads the file back
    const tr = rest.match(/^t\/([A-Za-z0-9_-]+)\/trace$/);
    if (tr) {
      const dir = taskPath(name, tr[1]);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
        return json(res, 404, { error: "unknown task" });
      if (req.method === "POST") {
        const b = await readBody(req);
        if (!Array.isArray(b?.events)) return json(res, 400, { error: "events array required" });
        appendTrace(name, tr[1], b.events);
        return json(res, 200, { ok: true, count: Math.min(b.events.length, TRACE_MAX_BATCH) });
      }
      if (req.method === "GET") {
        const fp = traceFile(name, tr[1]);
        res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" });
        return res.end(fs.existsSync(fp) ? fs.readFileSync(fp) : "");
      }
    }

    const t = rest.match(/^t\/([A-Za-z0-9_-]+)\/(variants|requests)(?:\/([A-Za-z0-9-]+)\/cancel)?$/);
    if (t) {
      const task = t[1];
      const dir = taskPath(name, task);
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
        return json(res, 404, { error: "unknown task" });

      if (t[2] === "variants" && req.method === "GET")
        return json(res, 200, loadVariants(name, task));

      if (t[2] === "requests" && !t[3] && req.method === "GET")
        return json(res, 200, loadRequests(name, task));

      if (t[2] === "requests" && !t[3] && req.method === "POST") {
        const b = await readBody(req);
        // reference images: previously-uploaded paths only, relative to the task dir
        const images = (Array.isArray(b?.images) ? b.images : []).filter(
          (f) => typeof f === "string" && f.startsWith("images/") && IMG_FILE_RE.test(f.slice(7)) &&
            fs.existsSync(path.join(dir, f))
        );
        if (!b?.text?.trim() && !images.length) return json(res, 400, { error: "empty text" });
        const entry = {
          kind: "request",
          id: crypto.randomBytes(4).toString("hex"),
          ts: new Date().toISOString(),
          text: (b.text || "").trim(),
          variants: Array.isArray(b.variants) ? b.variants : [],
          status: "pending",
        };
        if (images.length) entry.images = images;
        if (["iterate", "tweak", "pick", "feedback"].includes(b.type)) entry.type = b.type;
        // which model the board asked the fleet to build with
        if (["sonnet", "opus", "fable"].includes(b.model)) entry.model = b.model;
        // iterate requests carry how many children to build; the board renders
        // that many ghost nodes while the request is open
        if (Number.isInteger(b.count) && b.count > 0) entry.count = Math.min(b.count, 5);
        appendRequest(name, task, entry);
        return json(res, 200, entry);
      }

      // cancel: append a "cancelled" status override; the board drops the
      // ghost nodes and the fleet agent must skip / stop work on the request
      if (t[2] === "requests" && t[3] && req.method === "POST") {
        const id = t[3];
        const existing = loadRequests(name, task).find((r) => r.id === id);
        if (!existing) return json(res, 404, { error: "unknown request" });
        if (existing.status === "done" || existing.status === "cancelled")
          return json(res, 409, { error: `already ${existing.status}` });
        appendRequest(name, task, { kind: "status", id, status: "cancelled", note: "cancelled from board" });
        return json(res, 200, { id, status: "cancelled" });
      }
    }
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`composer hub on http://localhost:${PORT}`);
  console.log(`  sessions: ${Object.keys(registry).join(", ") || "(none)"}`);
});
