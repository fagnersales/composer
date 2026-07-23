# Composer

Hub viewer for the `/composer` skill: agents generate variants of a UI
into the current project's `.composer/<task>/` folder; the user
compares them on an infinite pan/zoom canvas, derives new ones from a chosen
parent, and picks a winner — all from the browser, no chat round-trip.

This repo is the **tool only** (`server.mjs` + `index.html`, zero deps,
"Monochrome" kit from claude.ai/design). Project data never lives here —
except `demo/`, a sample session, and `sessions.json`, the persisted
session→dir registry.

## How it flows

1. One hub on :4600 serves many projects. The skill registers a session
   (`POST /api/sessions {name, dir}`), where `dir` is the project's
   `.composer/` folder; each task is a subfolder with `task.json`,
   `requests.jsonl`, and `variants/`.
2. Board per task: `/b/<session>?task=<slug>`. Hub page at `/` lists
   everything (that's the user's generation history, together with the
   board's task switcher).
3. Variants are `NN-slug.html` files starting with a
   `<!--variant-meta {"name","model","description","parent"?,"url"?}-->`
   comment. `parent` draws the lineage edge; `url` makes the board iframe a
   live dev-server route instead of the file body.
4. UI feedback appends `request` lines to the task's `requests.jsonl`
   (append-only; `status` lines override, later wins — except `cancelled`,
   which is terminal). Derive requests carry
   `count` (ghost nodes); pick requests mean "implement this design in the
   real codebase", not a file move.
5. The resident fleet agent heartbeats
   (`POST /api/sessions/<name>/heartbeat`, 90s window) and serves requests.
   No heartbeat → board shows "fleet offline" and locks derive/pick
   (cancel stays allowed). Server pushes SSE on file changes + liveness
   flips; the board hot-updates.

Full protocol details: README.md.

## Don't break

- The API contract (see README "HTTP API") — UI and fleet agents both
  depend on it.
- `index.html` must stay a single self-contained file.
- The `withPause` script-injection in `index.html` (pause/play inside
  sandboxed variant iframes) uses split script tags on purpose — don't
  "clean it up".
- Never rewrite a `requests.jsonl` history; only append.
- Board actions must stay locked while the session has no live heartbeat
  (except cancel — retracting work is always safe).
