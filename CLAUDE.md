# Composer

Hub viewer for the `/composer` skill: agents generate variants of a UI
into the current project's `.composer/<task>/` folder; the user
compares them on an infinite pan/zoom canvas, iterates new ones from a chosen
parent, and picks a winner — all from the browser, no chat round-trip.

This repo is the **tool only** (`server.mjs` + `index.html` +
`capture.mjs`, "Monochrome" kit from claude.ai/design). The `/composer`
skill's canonical home is `skills/composer/SKILL.md` **in this repo** —
`~/.claude/skills/composer` is a symlink to it; edit it here, never a
copy elsewhere. The skill locates this repo by resolving that symlink
(`$HUB`), so it works wherever the repo is cloned. The hub itself is
zero-dep; `capture.mjs` (headless screenshot/record/snapshot helper for
builder agents — one Chromium per invocation so parallel builders never
share a browser) is the sole reason `node_modules` exists (playwright). `index.html` is BUILT — edit the
pieces in `src/` and run `node build.mjs`, which concatenates them back
into the single self-contained `index.html`; commit both. Never hand-edit
`index.html`. Project data never lives here —
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
   variant of `variants[0]`, no subagent; pick requests only record the winner — the board's
   "Copy prompt" button hands implementation to a fresh agent session
   (the fleet never implements a pick).
5. The resident fleet agent heartbeats
   (`POST /api/sessions/<name>/heartbeat`, 90s window) and serves requests.
   No heartbeat → board shows "fleet offline" and locks iterate/tweak
   (cancel and pick stay allowed — they only record state). Server pushes SSE on file changes + liveness
   flips; the board hot-updates.

Full protocol details: README.md.

## Don't break

- The API contract (see README "HTTP API") — UI and fleet agents both
  depend on it.
- The built `index.html` must stay a single self-contained file; the rule
  applies to the artifact — the source lives in `src/`.
- The `src/` script files are one shared-scope program concatenated in
  `shell.html`'s marker order — no ES modules, no per-file scoping. Any
  literal `</script>` in JS strings must stay split.
- The `withPause` script-injection (`src/state.js`) (pause/play inside
  sandboxed variant iframes) uses split script tags on purpose — don't
  "clean it up".
- Never rewrite a `requests.jsonl` history; only append.
- Board actions must stay locked while the session has no live heartbeat
  (except cancel and pick — both only record state, no agent work).
