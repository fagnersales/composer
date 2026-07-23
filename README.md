# Composer — Infinite Board

Live infinite-canvas board for `/composer`. This repo is the **tool**
(server + UI + protocol); the **data** lives inside each project you use it
in, under `<project>/.composer/` (gitignored, never committed). Task
folders accumulate there — that's your generation history, browsable from
the board's task switcher.

One hub server on port 4600 serves every project. The skill registers a
named *session* per project; each session holds *tasks*; each task is one
variant tree. Variants are nodes on a pan/zoom canvas; parent→child edges
show lineage. The user selects a node and derives new variants from it; the
resident fleet agent watches the task's inbox file and drops new variant
files in — no chat round-trip. Ghost "building…" nodes appear while a derive
request is open and resolve into real nodes when files land (SSE).

Board UI: drag nodes to arrange (positions persist per task in
localStorage), double-click to inspect (aspect switcher + pause/restart for
HTML variants), select + composer to derive children (paste or drop
reference images into the composer to send them along; shift+click
selects multiple variants and derives children combining all of them).
The composer's Derive|Adjust toggle (or a node's "+" rail chip) switches
to **adjust**: one small tweak to the selected node, delivered as a new
revision chip on the same node instead of a branch. "Cancel" on a ghost
node cancels its derive request, "Pick this one" asks the fleet to implement
that design. Task switcher in the HUD flips between the project's past and
current tasks. Derive/pick are **locked while no fleet agent is
heartbeating** ("fleet offline") so requests can't pile up unheard;
cancel always works. Keyboard: +/- zoom, 0 fit, Esc close/deselect.

## Run

```sh
node server.mjs        # hub on http://localhost:4600 (PORT env to override)
```

- `/` — hub page: every registered session, its tasks, fleet-live dots.
- `/b/<session>?task=<slug>` — the board for one project task.

The skill normally starts the hub if it isn't running; you rarely run it by
hand. `sessions.json` (next to `server.mjs`) persists session name → data
dir. A `demo` session ships in `demo/`.

## Per-project layout

```
<project>/.composer/                 # add to the project's .gitignore
  <task-slug>/
    task.json                        # {"title": "...", "created": ISO}
    requests.jsonl                   # append-only feedback inbox
    variants/                        # NN-slug.html, one per variant
    images/                          # reference images pasted into the board
```

`images/` holds reference images uploaded from the board's composer,
content-addressed as `<sha1-prefix>.<ext>` (png/jpg/gif/webp). Requests
point at them via the `images` field.

## Variant file format

Each variant is an `.html` file whose first line is a metadata comment:

```html
<!--variant-meta {"name":"Sunrise Pour","model":"opus-4.8","description":"…","parent":"01-sunrise-pour.html","url":"http://localhost:3000/mock/x-v2"}-->
<!doctype html><html>…</html>
```

- `parent` (optional): filename of the variant this one was derived from —
  draws the lineage edge. Derived variants MUST set it.
- `adjust` (optional, boolean): this file is a **revision** of its `parent`
  (same design, one small tweak), not a branch. The board folds the whole
  adjust-chain into the parent's node as a revision rail (v1·v2·… chips
  under the card, "+" to request another tweak) — no lineage edge is drawn.
  Adjust variants MUST also set `parent`.
- `url` (optional): for variants that are real routes on the project's dev
  server (component-based mocks) instead of self-contained HTML. The board
  iframes the URL; the file body is just a fallback note. URL variants need
  the dev server running, and pause/restart doesn't apply to them.
- No `url` → the file must be fully self-contained (inline CSS/JS, no
  network), rendered via iframe `srcdoc`.

Any file written into a task's `variants/` appears on that board instantly.

## HTTP API

```
GET  /api/sessions                          all sessions + tasks + live flags
POST /api/sessions                          {name, dir} register/re-register (409 if name taken by another dir)
POST /api/sessions/<name>/heartbeat         fleet agent liveness (90s window)
GET  /api/s/<name>/tasks                    {live, tasks:[{slug,title,created,variants}]}
GET  /api/s/<name>/t/<task>/variants
GET  /api/s/<name>/t/<task>/requests
POST /api/s/<name>/t/<task>/requests        {text, variants[], count?, type?: derive|adjust|pick|feedback, images?: ["images/…"]}
POST /api/s/<name>/t/<task>/requests/<id>/cancel
POST /api/s/<name>/t/<task>/images          raw image body (Content-Type: image/png|jpeg|gif|webp, 10MB max) → {file:"images/<hash>.<ext>"}
GET  /api/s/<name>/t/<task>/images/<file>   serve a stored reference image
GET  /api/s/<name>/events?task=<slug>       SSE: {"kind":"change"} | {"kind":"status","live":bool}
```

## Agent protocol (`requests.jsonl`)

Append-only JSONL per task. The UI writes `request` lines; the fleet agent
appends `status` lines. Later status lines override earlier state — except
`cancelled`, which is terminal: once a request has a `cancelled` line, later
status lines are ignored (a fleet that claimed the request before seeing the
cancel can't resurrect it). Never rewrite the file, only append.

```jsonl
{"kind":"request","id":"a1b2c3d4","ts":"…","text":"Derive 3 new variants from \"Midnight Brew\" — warmer","variants":["02-midnight-brew.html"],"status":"pending","count":3,"type":"derive","images":["images/ab12cd34ef56.png"]}
{"kind":"status","id":"a1b2c3d4","status":"building"}
{"kind":"status","id":"a1b2c3d4","status":"done","note":"→ 06-x.html, 07-y.html, 08-z.html"}
```

Request `type`s the board sends:

- `derive` — carries `count` (how many children; board shows that many
  ghost nodes under `variants[0]` until the request closes). `variants`
  may list **several** parents (shift+click multi-select): build children
  that combine/blend all of them, and set each child's meta `parent` to
  `variants[0]` — the primary lineage edge.
Requests may carry `images`: reference images the user attached in the
board's composer, as paths relative to the task folder (they live in its
`images/` subfolder). The fleet agent should view them — they are visual
guidance for the requested work.

- `adjust` — `variants[0]` is the revision being tweaked; `text` carries
  one small change (`Adjust "<name>" — <tweak>`). Always a single parent,
  no `count`. The fleet should NOT spawn a builder for this: copy the
  parent file to the next `NN-slug.html`, apply the tweak with targeted
  edits, and set meta `{"adjust":true,"parent":"<parent file>"}` with the
  tweak as `description`. While the request is open the board shimmers the
  node in place (no ghost); the landed file becomes the node's next
  revision chip.

- `pick` — `variants[0]` is the chosen design (the revision the user had
  active, if the node has several). This is **not** a file
  operation: it tells the resident agent to *implement that design in the
  project's real code*. The newest non-cancelled pick marks the crown.

Cancellation: the board's ghost-node "Cancel" button hits the cancel
endpoint, which appends
`{"kind":"status","id":…,"status":"cancelled","note":"cancelled from board"}`.
`cancelled` is terminal — the board drops the ghosts; the agent must not
start (or must stop) work on that request.

Fleet-agent loop (the skill session stays resident):

1. Heartbeat `POST /api/sessions/<name>/heartbeat` at least every 60s —
   the board disables derive/pick when the last beat is >90s old.
2. Watch the task's `requests.jsonl` for `pending` requests.
3. Unless the request's latest status is `cancelled`, append
   `{"kind":"status","id":…,"status":"building"}`.
4. For `derive`: read `variants` as the parent set (usually one; several
   means combine them), build `count` children into `variants/` (meta
   `parent` set to `variants[0]`, numbering continues from the highest
   existing). Re-check for `cancelled` between files. For `pick`:
   implement the chosen variant's design in the project's real codebase.
5. Append `{"kind":"status","id":…,"status":"done","note":"…"}`.
