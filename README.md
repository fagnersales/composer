# Composer — Infinite Board

Live infinite-canvas board for `/composer`. This repo is the **tool**
(server + UI + protocol); the **data** lives inside each project you use it
in, under `<project>/.composer/` (gitignored, never committed). Task
folders accumulate there — that's your generation history, browsable from
the board's task switcher.

One hub server on port 4600 serves every project. The skill registers a
named *session* per project; each session holds *tasks*; each task is one
variant tree. Variants are nodes on a pan/zoom canvas; parent→child edges
show lineage. The user selects a node and iterates new variants from it; the
resident fleet agent watches the task's inbox file and drops new variant
files in — no chat round-trip. Ghost "building…" nodes appear while an iterate
request is open and resolve into real nodes when files land (SSE).

Board UI: drag nodes to arrange (positions persist per task in
localStorage) or hit **Organize** to tidy the whole board into one
generation-per-row tree — every subtree gets exactly the width it needs, so
branches can't overlap and each parent rides centred above its children;
the cards and the camera ease into place together, and grabbing the board
mid-flight lands them at once. Double-click to inspect (aspect switcher + pause/restart for
HTML variants), select + composer to iterate children (paste or drop
reference images into the composer to send them along; shift+click
selects multiple variants and iterates children combining all of them).
The composer's Iterate|Tweak toggle switches to **tweak**: one small
change to the selected node, delivered as a single child card (with a
lineage edge), built inline by the fleet. "Cancel" on a ghost
node cancels its iterate request, "Pick this one" crowns the winner and
reveals a "Copy prompt" hand-off for a fresh agent to implement it. Task
switcher in the HUD flips between the project's past and
current tasks. Iterate/tweak are **locked while no fleet agent is
heartbeating** ("fleet offline") so requests can't pile up unheard;
cancel and pick always work — they only record state. Keyboard: +/- zoom, 0 fit, o organize, Esc close/deselect.

## Get started

Composer is driven by [Claude Code](https://claude.com/claude-code): the
`/composer` skill (in `skills/composer/`) spawns the builder fleet and
serves the board's requests. The fastest setup is to let your agent do
it — paste this into a Claude Code session:

> Set up Composer for me:
> 1. Clone https://github.com/fagnersales/composer somewhere permanent
>    (e.g. `~/work/composer`) and `cd` into it.
> 2. `npm install && npx playwright install chromium` — Playwright and
>    its browser are only used by `capture.mjs` (the screenshot/record
>    helper builder agents use).
> 3. Symlink the skill into my global skills folder so `/composer` works
>    in every project:
>    `ln -s "$(pwd)/skills/composer" ~/.claude/skills/composer`
> 4. Verify: `node server.mjs`, open http://localhost:4600 — the bundled
>    `demo` session should be listed. Then stop the server.
>
> When it's ready, tell me — I'll run `/composer <what to build>` from
> any project.

The symlink matters: the skill resolves the repo's location by following
it, and updating Composer stays a plain `git pull`. (If you copy the
folder instead, the skill will ask where the clone lives.)

Requirements: Node 18+, Claude Code. The hub itself is zero-dependency;
Playwright is only needed by `capture.mjs`.

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

- `parent` (optional): filename of the variant this one was iterated from —
  draws the lineage edge. Iterated variants MUST set it.
- `parents` (optional, array of filenames): every parent a **combine** was
  mixed from (`variants` of the iterate request, in order). `parent` must stay
  the first of them — it draws the solid lineage edge; the rest draw ghostly
  strands. Without it the board can only show one edge, so a mix looks like it
  came from a single parent once the build finishes.
- `url` (optional): for variants that are real routes on the project's dev
  server (component-based mocks) instead of self-contained HTML. The board
  iframes the URL; the file body is just a fallback note. URL variants need
  the dev server running, and pause/restart doesn't apply to them.
- No `url` → the file must be fully self-contained (inline CSS/JS, no
  network), rendered via iframe `srcdoc`.
- `commit` (optional): for variants built in a git worktree of the real
  project — the SHA holding the variant's actual code (kept alive under a
  `refs/composer/…` ref). The board's pick hand-off then says "cherry-pick
  this SHA" instead of "rebuild from the mockup". These variants' bodies are
  typically just a capture: an `<img>`/`<video>` whose relative src points at
  a `NN-slug.png` / `.webm` sitting next to the file in `variants/` — the
  board injects a `<base>` into `srcdoc` so those resolve via the `/v/`
  asset route.

Any file written into a task's `variants/` appears on that board instantly.
Non-HTML files in `variants/` (png/jpg/gif/webp/svg/webm/mp4) are served as
capture assets, not shown as cards.

## HTTP API

```
GET  /api/sessions                          all sessions + tasks + live flags
POST /api/sessions                          {name, dir} register/re-register (409 if name taken by another dir)
POST /api/sessions/<name>/heartbeat         fleet agent liveness (90s window)
GET  /api/s/<name>/tasks                    {live, tasks:[{slug,title,created,variants}], phone:"http://<lan-ip>:<port>/m/<name>", boardTask}
GET  /api/s/<name>/t/<task>/variants         [{id,name,model,description,parent,parents,url,ts,html}] — ts = when the file appeared
GET  /api/s/<name>/t/<task>/requests
POST /api/s/<name>/t/<task>/requests        {text, variants[], count?, type?: iterate|tweak|pick|feedback, model?: sonnet|opus|fable, images?: ["images/…"]}
POST /api/s/<name>/t/<task>/requests/<id>/cancel
POST /api/s/<name>/t/<task>/images          raw image body (Content-Type: image/png|jpeg|gif|webp, 10MB max) → {file:"images/<hash>.<ext>"}
GET  /api/s/<name>/t/<task>/images/<file>   serve a stored reference image
GET  /api/s/<name>/events?task=<slug>       SSE: {"kind":"change"} | {"kind":"status","live":bool} | {"kind":"focus","variant","src"}
POST /api/s/<name>/t/<task>/focus           {variant, src} — shared "looked at" variant, broadcast to every SSE client; ephemeral, never on disk
POST /api/s/<name>/task                     {task, src} — task switch announcement, broadcast to every SSE client of the session ({"kind":"task"}); board and phone follow each other
GET  /m/<name>                              phone remote: one variant full-screen, focus AND task synced with the board both ways (?task= optional override)
GET  /v/<name>/<task>/<file>.html           a single variant as a standalone page (url variants 302 to their dev route, localhost rewritten to the LAN ip)
GET  /v/<name>/<task>/<file>.<img|video ext> a capture asset from the task's variants/ folder (png/jpg/gif/webp/svg/webm/mp4)
POST /api/s/<name>/t/<task>/trace           {events:[…]} — board debug events, appended to the task's trace.jsonl (max 500/batch)
GET  /api/s/<name>/t/<task>/trace           the raw trace.jsonl (NDJSON)
```

## Debug trace (`trace.jsonl`)

Append-only JSONL per task, written by the board so a session can be
reconstructed start to finish when something goes wrong (a screenshot can't
say why). One line per UI event; each carries `pg` (a random id per board
load), `seq` (order within that load), `t` (client time), `ev`, and `recv`
(server time the batch arrived). The file watcher ignores it, so trace
writes never trigger SSE `change` events.

Event kinds: `boot` (session/task/viewport), `click`/`dblclick` (element
chain, card id, screen + world coords), `key`, `select`, `input:mode`,
`input:model`, `input:count`, `request:send`/`request:ack`/`request:fail`,
`request:cancel`, `variant:landed` (id, parent, coords, how it was placed),
`variant:removed`, `ghost:opened`/`ghost:closed`, `node:moved` (from → to),
`layout` (every card's position, emitted after boot/drag/organize/landing),
`camera` (where a pan/zoom came to rest), `organize`, `fit`, `winner`,
`fleet` (liveness flips), `inspect:*`, `image:*`, `toast`, `note`,
`sse:change`/`sse:error`, `error` (uncaught JS errors), `pagehide`.

## Agent protocol (`requests.jsonl`)

Append-only JSONL per task. The UI writes `request` lines; the fleet agent
appends `status` lines. Later status lines override earlier state — except
`cancelled`, which is terminal: once a request has a `cancelled` line, later
status lines are ignored (a fleet that claimed the request before seeing the
cancel can't resurrect it). Never rewrite the file, only append.

```jsonl
{"kind":"request","id":"a1b2c3d4","ts":"…","text":"Iterate 3 new variants from \"Midnight Brew\" — warmer","variants":["02-midnight-brew.html"],"status":"pending","count":3,"type":"iterate","model":"opus","images":["images/ab12cd34ef56.png"]}
{"kind":"status","id":"a1b2c3d4","status":"building"}
{"kind":"status","id":"a1b2c3d4","status":"done","note":"→ 06-x.html, 07-y.html, 08-z.html"}
```

Besides `building`/`done`/`cancelled` there is `failed`: appended by the
build wrapper (see `spawn.sh` below) when a builder process exits nonzero
or times out. The board closes the request's ghost slots and toasts the
note. Unlike `cancelled` it is **not** terminal — a later `building` line
(a retry) reopens the request.

Request `type`s the board sends:

- `iterate` — carries `count` (how many children; board shows that many
  ghost nodes under `variants[0]` until the request closes). `variants`
  may list **several** parents (shift+click multi-select): build children
  that combine/blend all of them, and set each child's meta `parent` to
  `variants[0]` — the primary lineage edge. A ghost stands for a slot no
  child has landed in yet: the board matches children to the request by
  parent + file age, so it counts the same after a reload as before one.
`iterate` and `tweak` requests also carry `model` — which model the user
picked in the board's Input (`sonnet` | `opus` | `fable`, default `opus`).
The fleet agent must build with it: spawn the subagents on that model, and
write its name into each child's `variant-meta` `model` field.

Requests may carry `images`: reference images the user attached in the
board's composer, as paths relative to the task folder (they live in its
`images/` subfolder). The fleet agent should view them — they are visual
guidance for the requested work.

- `tweak` — `variants[0]` is the variant being tweaked; `text` carries
  one small change (`Tweak "<name>" — <change>`). Always a single parent,
  `count` is always 1 (so the board shows one ghost child while the
  request is open). The fleet should NOT spawn a builder for this: copy
  the parent file to the next `NN-slug.html`, apply the tweak with
  targeted edits, and set meta `"parent":"<parent file>"` with the tweak
  as `description`. The landed file is a normal child card with a
  lineage edge — same as an iterate of one.

- `pick` — `variants[0]` is the chosen design. The newest non-cancelled
  pick marks the crown. A pick only *records* the winner: implementation
  is handed off via the board's **Copy prompt** button, which puts a
  self-contained brief on the clipboard (the winning variant's absolute
  file path or live URL, the task goal, and instructions to screenshot
  the mockup first) for the user to paste into a fresh agent session —
  the resident fleet agent does **not** implement it.

Cancellation: the board's ghost-node "Cancel" button hits the cancel
endpoint, which appends
`{"kind":"status","id":…,"status":"cancelled","note":"cancelled from board"}`.
`cancelled` is terminal — the board drops the ghosts; the agent must not
start (or must stop) work on that request.

Fleet-agent loop (the skill session stays resident):

1. Heartbeat `POST /api/sessions/<name>/heartbeat` at least every 60s —
   the board disables iterate/pick when the last beat is >90s old.
2. Watch the task's `requests.jsonl` for `pending` requests.
3. Unless the request's latest status is `cancelled`, append
   `{"kind":"status","id":…,"status":"building"}`.
4. For `iterate`: read `variants` as the parent set (usually one; several
   means combine them), build `count` children into `variants/` (meta
   `parent` set to `variants[0]`, numbering continues from the highest
   existing). For `pick`: nothing to build — acknowledge it (the winner
   is server-side state; the user hands implementation to a fresh agent
   via the board's Copy prompt button).
5. Append `{"kind":"status","id":…,"status":"done","note":"…"}` — unless
   the build ran through `spawn.sh`, which appends `done`/`failed` itself.

### `spawn.sh` — detached headless builders

`spawn.sh <task-dir> <request-id|-> <model> <prompt-file>...` fires one
headless `claude -p` per prompt file — all concurrently, each writing one
variant file — then appends the request's terminal status line itself:
`done` if every builder exited 0, `failed` (with the failing slots and log
dir in `note`) otherwise. Run it detached (`nohup … &`) and the fleet
agent hears nothing on success: the files land, the hub's watcher pushes
SSE, the board updates. The fleet agent only reacts when its poll of
`requests.jsonl` shows a `failed` line.

- Model aliases `sonnet`/`opus`/`fable` (what iterate requests carry) map
  to full model ids; anything else passes through.
- Request id `-` means "no request line" (the initial fan-out): no status
  is appended; failures surface via the script's exit code instead.
- Logs, per-slot exit codes and builder PIDs go to
  `<data-dir>/.builds/<task>/<id>/` — outside the task dir so log writes
  never fire the task watcher. To cancel a running build, kill the PIDs
  in that dir's `pids` file; the script then appends nothing (`cancelled`
  is terminal at read time anyway).
- Tunables: `COMPOSER_BUILD_TIMEOUT` (seconds per builder, default 900)
  and `COMPOSER_ALLOWED_TOOLS` (default `Read,Glob,Grep,Write,Edit`).
