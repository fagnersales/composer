# Composer

Hub viewer for the `/composer` skill: agents generate variants of a UI
into the current project's `.composer/<task>/` folder; the user
compares them on an infinite pan/zoom canvas, iterates new ones from a chosen
parent, and picks a winner — all from the browser, no chat round-trip.

This repo is the **tool only** (`server.mjs` + `index.html`, zero deps,
"Monochrome" kit from claude.ai/design). Project data never lives here —
except `demo/`, a sample session, and `sessions.json`, the persisted
session→dir registry.

## Words the user uses

When the user says one of these, this is what they mean — answer and edit in
their vocabulary, not the code's.

| The user says | It means | In the code |
| --- | --- | --- |
| **Card**, **Variant** | one generated variant on the board | `state.nodes[i]` / a `.node` element / a `NN-slug.html` file |
| **Line** | the connector drawn from a parent variant to its child | `renderEdges` / `edgePath` / `#edges path.edge` |
| **App** | this page — the board itself, the thing being worked on | `index.html` |
| **Input** | the panel where the count is set and a variant is created, iterated or tweaked | `#composer` and every `cmp*` symbol |

Beware the two "composer"s: the **Input** is `#composer` in the code, while
the *product* is also called Composer. If it's the box you type into, it's
the Input.

## How it flows

1. One hub on :4600 serves many projects. The skill registers a session
   (`POST /api/sessions {name, dir}`), where `dir` is the project's
   `.composer/` folder; each task is a subfolder with `task.json`,
   `requests.jsonl`, and `variants/`.
2. Board per task: `/b/<session>?task=<slug>`. Hub page at `/` lists
   everything (that's the user's generation history, together with the
   board's task switcher).
3. Variants are `NN-slug.html` files starting with a
   `<!--variant-meta {"name","model","description","parent"?,"parents"?,"url"?}-->`
   comment. `parent` draws the lineage edge (a combine also carries
   `parents`: every parent it was mixed from, `parent` first — the extras
   draw ghostly strands); `url` makes the board iframe a
   live dev-server route instead of the file body.
4. UI feedback appends `request` lines to the task's `requests.jsonl`
   (append-only; `status` lines override, later wins — except `cancelled`,
   which is terminal). Iterate requests carry
   `count` (ghost nodes), `model` (which model the user picked in the
   Input — `sonnet`/`opus`/`fable`; tweaks carry it too, with `count` 1),
   optionally
   `images` (reference images pasted
   into the composer, stored under the task's `images/`), and may list
   several parents in `variants` (multi-select = combine); tweak requests
   ("one small change") are served inline by the fleet as a new child
   variant of `variants[0]`, no subagent; pick requests mean "implement this design in the
   real codebase", not a file move.
5. The resident fleet agent heartbeats
   (`POST /api/sessions/<name>/heartbeat`, 90s window) and serves requests.
   No heartbeat → board shows "fleet offline" and locks iterate/pick
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
