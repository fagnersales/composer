---
name: composer
description: Spawn a fleet of agents that each build a DIFFERENT backend-free variant of the requested UI/page into this project's .composer/, open the Composer board (localhost:4600) for comparison, then stay resident as the fleet agent serving iterate/cancel/pick requests from the board. Invoke when the user runs /composer, or wants several divergent design options built in parallel to choose from.
---

# Composer

Explore a design by building **several divergent variants at once** — one
agent per variant — so the user compares real, clickable options on the
**Composer board** instead of imagining them. Variants live **inside the
current project** under `.composer/<task-slug>/` (gitignored, never
committed — the accumulated task folders are the user's generation history).
After the initial fan-out you **stay resident as the fleet agent**: the user
works entirely from the board (iterate from a parent, cancel a build, pick
a winner) and you serve those requests until they end the session.

The board tool (`$HUB` everywhere below) is the repo this skill ships
in — this SKILL.md lives at `<repo>/skills/composer/SKILL.md`, and the
recommended install symlinks that folder into `~/.claude/skills/`.
Resolve it once at the start and use it for every command:
`HUB=$(cd "$(dirname "$(readlink -f ~/.claude/skills/composer/SKILL.md)")/../.." && pwd)`.
If the prompt that invoked you already states the clone's path (e.g. a
Codex prompt file with `HUB=` baked in), use that and skip the symlink
resolution.
Sanity-check that `$HUB/server.mjs` exists; if it doesn't (the skill was
copied instead of symlinked), ask the user where their composer clone
lives and use that path as `$HUB`. Read `$HUB/README.md` for the full
API/protocol if anything below is insufficient.

The request (what to build; optionally how many variants): `$ARGUMENTS`

**Resume mode:** if `$ARGUMENTS` is (or contains) a board link —
`http://localhost:4600/b/<name>?task=<slug>` — the user wants you to
**attach to that existing task**, not create anything. Skip steps 1–4:
look up the session's `dir` via `GET /api/sessions` (start the hub first
if :4600 is down), verify `dir/<slug>/` exists, re-register the session
if it's missing from the hub (`POST /api/sessions` with the same name +
dir), then go straight to steps 5–6 — open the board and start
heartbeating as NAME=`<name>`. Serve any stale `pending`/`building`
requests already in `requests.jsonl` per step 6. If the session or task
folder can't be found, tell the user what you looked for and stop.

## Shape of the flow

1. Understand the ask + mine any provided data.
2. Set up: task folder in the project, gitignore, hub server, session.
3. Choose N genuinely different design directions; fan out one agent per
   variant.
4. Open the board; stay resident serving board requests (heartbeating).
5. Pick = implement the chosen design in the real codebase. No teardown —
   the task folder stays as history.

## Steps

1. **Understand the request and gather data.** Parse `$ARGUMENTS` for what
   to build and how many variants (default **3**; 2–5 is the sane range).
   Then pick the **mode** — it shapes every briefing:
   - **sketch** — the user wants a direction, not a product ("explore some
     layouts", "what could this feel like"). Static comps: NO working
     interactivity, the whole budget goes to visual quality. Fastest.
   - **html** (default) — self-contained interactive mockups, as before,
     but bounded by the demo-depth rule below.
   - **worktree** — the ask is to iterate on an **existing page of this
     app** and fidelity matters. Builders work in git worktrees of the
     real project, commit their change, and ship a *capture*
     (screenshot/recording) as the card. See "Worktree mode" below.
     Prefer this whenever the user complains that HTML mockups "don't
     look like my app" — rebuilding an existing app's look in standalone
     HTML is a losing game; forking the real code isn't.
   When unsure between html and worktree for an existing-app iteration,
   ask the user once — it's a real cost/fidelity tradeoff (worktree needs
   a runnable dev setup and a slower first fan-out).
   - **If a screenshot or data was provided**, extract the concrete content
     into text — labels, real numbers, names, layout cues. Agents have NONE
     of this context; the extraction goes verbatim into every briefing.
   - **If it's a variant of an existing page in this codebase**, builders
     must SEE it, not read your prose about it. Screenshot the real page —
     `node $HUB/capture.mjs shot <url> DATA/<slug>/ref.png` if a
     dev server is up — and put the image path in every briefing (builders
     are `claude -p`; they can Read images). Also read the real page and
     its data dependencies so variants match the true data shape, and
     reuse the project's real copy/brand. Text descriptions of visuals are
     the historical failure mode of this skill — don't rely on them.
   - **If realism-critical assets are missing** (avatar/thumbnail URLs,
     brand copy) and no data was given, ask the user before spawning —
     don't let agents invent `example.com` URLs.

2. **Set up the board session.**
   - Project root = git root of cwd (else cwd). `DATA=<root>/.composer`.
   - Ensure `.composer/` is in the project's `.gitignore` (append
     if missing; create the file if the project has none).
   - **Check for an existing task first.** List `DATA/*/task.json` and
     `GET /api/sessions` (if the hub is up). If a task already covers this
     same ask — matching title/slug, especially one from today or with
     unserved `pending`/`building` requests — don't set up a duplicate:
     tell the user which task you found and ask whether to resume it
     (→ resume mode, using its existing slug and session name) or start
     fresh. Only create a new task folder when nothing matches or the
     user says fresh.
   - Task slug: **`MM-DD-<short-kebab-case-from-the-ask>`** — e.g.
     `07-23-checkout-hero`. Get `MM-DD` from today's real date (`date
     +%m-%d`), never from memory or a guess. If the folder exists, suffix
     `-2`, `-3`, …. Create
     `DATA/<slug>/variants/` and write `DATA/<slug>/task.json`:
     `{"title":"<human title>","created":"<ISO now>"}`.
   - Hub: if :4600 isn't answering, start it:
     `nohup node $HUB/server.mjs >/dev/null 2>&1 &`.
   - Register: `POST http://localhost:4600/api/sessions` with
     `{"name":"<root basename>","dir":"<DATA abs path>"}`. On 409 (name
     taken by another dir) retry with `-2`, `-3`, …. Remember the final
     NAME — every later API call and heartbeat uses it.

3. **Define the variant directions.** N directions that are each a **real
   fork**, not a color swap — e.g. *dense data-table* vs *airy card
   gallery* vs *stepped wizard*; *nav-left* vs *nav-top*. Name each by the
   decision it embodies. If the variants aren't meaningfully different, the
   comparison is noise — that's the whole failure mode to avoid.

4. **Fan out the fleet — headless builders via `spawn.sh`, not the Agent
   tool.** Write one self-contained briefing per variant to
   `DATA/.builds/<slug>/init/NN-<variant-slug>.md` (batch the Writes in
   one message), then fire them all at once:
   `bash $HUB/spawn.sh DATA/<slug> - opus DATA/.builds/<slug>/init/*.md`
   — **run it as a background Bash call** (the harness's background mode,
   not nohup) so you get exactly ONE notification when the whole batch
   settles; a nonzero exit means some builder failed (its slot + log path
   are in `DATA/.builds/<slug>/init-*/`) — report that to the user and
   respawn just the failed prompt files if sensible. The builders are
   plain `claude -p` processes: they share nothing with your session, so
   each briefing must be fully self-contained and includes:
   - The thing to build and **this agent's assigned direction** only.
   - The extracted data/examples for realism (step 1).
   - The output file: `DATA/<slug>/variants/NN-<variant-slug>.html`
     (two-digit numbering, continue from highest existing; distinct file
     per agent so parallel is safe — no worktree needed). First line MUST
     be the meta comment:
     `<!--variant-meta {"name":"…","model":"<model used>","description":"one line","parent":"<parent file>"}-->`
     (`parent` only for iterated variants; for a combine also
     `"parents":["<parent 1>","<parent 2>",…]` — the request's whole
     `variants` list, with `parent` = the first of them — so the board keeps
     a strand to every parent instead of just one).
   - **Default mode — self-contained HTML**: inline CSS/JS, in-memory
     data, interactions that actually mutate local state, no
     network/backend/auth. When mocking an existing page, rewriting its
     components as plain HTML matching the project's look is expected.
   - **Demo depth — every interactive briefing states it.** Make **one or
     two representative items** fully interactive; render the rest as
     static fill. Never wire up (or invent) a whole dataset's worth of
     options — a variant is a demo of a direction, not a product. In
     sketch mode, demo depth is zero: say "static comp, no working
     interactions" explicitly.
   - **Worktree mode**: briefings follow the same self-contained recipe
     but the recipe itself changes — see the "Worktree mode" section for
     what each briefing must carry and what the builder writes.
   - **URL mode (only when the user wants component-true mocks)**: the
     agent builds a real mock route in the codebase (like `/mock` — e.g.
     `app/mock/<slug>-v<k>/page.tsx`, backend-free, in-memory data) and the
     variant file is just the meta comment (adding
     `"url":"http://localhost:<devport>/mock/<slug>-v<k>"`) plus a one-line
     fallback body. Requires the project's dev server running; the board
     iframes the URL.
   - Nothing about returning results — the builder's output is discarded;
     the written file IS the deliverable. Tell it: write the one file,
     verify the meta comment is the first line, and stop.

5. **Open the board.**
   `open http://localhost:4600/b/<NAME>?task=<slug>` once variants land.
   Tell the user: compare on the board; select a node to iterate more,
   Cancel on a building node stops it, "Pick this one" makes me implement
   it. The board also has their task history (task switcher / hub at `/`).

6. **Stay resident as the fleet agent.** The board disables iterate/pick
   unless you heartbeat, so the loop is mandatory. Repeat until the user
   ends it:
   - **One persistent Monitor does both heartbeat and watch** — don't
     wake yourself just to heartbeat. Start a single Monitor
     (`persistent: true`, long timeout) running a shell loop that every
     ~30s: (a) `curl -s -m 5 -X POST
     http://localhost:4600/api/sessions/<NAME>/heartbeat`, and (b) counts
     **`"kind":"request"`** lines AND **`"status":"failed"`** lines in
     `DATA/<slug>/requests.jsonl` (two `grep -c` calls), echoing only when
     either count grows. Counting those — not file lines — matters: your
     own `building`/`done` appends must never echo back and wake you,
     but a `failed` line from spawn.sh must (it's your failure channel).
     The board flips to "fleet offline" 90s after the last heartbeat.
   - The heartbeat must die with you: only a session-tied process
     (persistent Monitor / background Bash), **never `nohup` or any
     detached process** — a heartbeat that outlives the agent keeps the
     board unlocked with nobody listening.
   - **Stay silent on idle wakes.** Builder-completion notifications and
     anything non-actionable get no narration — no "still listening", no
     progress recaps per finished builder. Speak only when you claim or
     finish a request, when all builds of a batch are done, or on an
     error the user must know about.
   - New `pending` request whose latest status isn't `cancelled` → re-read
     the file tail right before claiming (a cancel may have landed while
     you were deciding — never append `building` after a `cancelled` line;
     the hub treats `cancelled` as terminal and ignores later statuses),
     then append `{"kind":"status","id":…,"status":"building"}` to that
     `requests.jsonl` (**append-only, never rewrite**), then:
     - `type:"iterate"`: `variants[0]` is the parent file, `count` children.
       Write `count` briefing files (step 4 style + the request's `text` as
       direction, `"parent"` set) to `DATA/.builds/<slug>/<req-id>/`, then
       fire them **detached** — success must cost you zero turns:
       `nohup bash $HUB/spawn.sh DATA/<slug> <req-id> <request's model> DATA/.builds/<slug>/<req-id>/*.md >/dev/null 2>&1 &`
       That's it — do NOT wait, do NOT append `done` yourself: spawn.sh
       appends the terminal `done`/`failed` status line when the builders
       settle. A `failed` line showing up on a later poll is your cue to
       tell the user and (optionally) retry the failed slots. More than
       one entry in `variants` is a **combine**: brief the builders to mix
       all of them, and have each set `"parents"` to the full `variants`
       list (`"parent"` = `variants[0]`).
     - `type:"tweak"`: one small tweak to `variants[0]` — **no subagent,
       ever**. Small changes asked in chat count too ("remove this word",
       "re-align this"): treat them as tweaks and go straight to
       implementing inline — spawning a builder for these wastes a whole
       agent on a one-line edit.
       Do it inline yourself: copy the parent file to the next
       `NN-<slug>.html`, apply the tweak with targeted edits (never a
       rewrite), and set the meta comment to the parent's meta plus
       `"parent":"<parent file>"` and `description` = the tweak. The
       board shows it as a normal child card with a lineage edge — same
       as an iterate of one. Re-check for `cancelled` before writing the file.
     - `type:"pick"`: **do NOT implement anything.** A pick only records
       the winner; the board gives the user a "Copy prompt" button whose
       hand-off brief a FRESH agent session implements from (it names the
       variant's absolute path and tells that agent to screenshot it
       first). Your only job: append
       `{"kind":"status","id":…,"status":"done","note":"winner recorded — implement via the board's Copy prompt in a fresh session"}`
       and tell the user in chat that the prompt is ready to copy from
       the board. Even if the user asks you in chat to implement the
       pick, point out the fresh-session hand-off exists precisely to
       avoid this session's bloated context — implement here only if they
       insist.
   - New `cancelled` status on a request you're building → **immediately
     kill its builder processes** on that same wake, before any other
     work: `while read p; do pkill -P "$p"; kill "$p"; done <
     DATA/.builds/<slug>/<req-id>/pids` (2>/dev/null — some may have
     exited). Discard any output they produced and append nothing further
     for that request (no `done` line, ever; spawn.sh also skips its own
     append once cancelled).
   - For tweaks (the work you do yourself) append
     `{"kind":"status","id":…,"status":"done","note":"→ …"}` when
     finished; picks get their `done` line immediately (no work); for
     iterates spawn.sh owns the `done`/`failed` line.
   - On start of any session, also scan for stale `pending`/`building`
     requests from a previous run and offer to serve or cancel them.

## Worktree mode

For iterating on an existing app with real fidelity: builders fork the
real code instead of imitating it. A variant is **a commit plus a
capture** — the commit holds the code (free to keep, trivial to land),
the capture (screenshot or short recording) is what the board shows.
Cards are not live: viewing needs no dev server, and N variants never
means N running apps.

**One-time prep (orchestrator, before spawning):**
- Record the base: `BASE=$(git rev-parse HEAD)`; add `"base":"<sha>"` to
  `task.json`.
- Worktree pool, one per concurrent builder:
  `git worktree add --detach <root>/.composer/.worktrees/wt<N> $BASE`.
  Install deps in each (a pnpm/shared store makes repeats cheap). This
  first install is the only slow round — pool worktrees stay warm for
  the whole session.
- Assign each worktree a dev port (project's port + 100 + N) and note
  the project's dev-server command; both go in the briefing.
- Two builders never share a worktree in the same round.

**Each briefing additionally carries:** its worktree path + port, the
dev-server command, the parent SHA (task `base` for roots; the parent
variant's meta `commit` for iterates/combines), the reference screenshot
path from step 1, and the builder loop:

1. Reset if dirty (`git reset --hard && git clean -fd` — ignored files
   like `node_modules` survive), then `git checkout --detach <parent-sha>`.
2. Make the change in the real codebase, demo-depth bounded.
3. `git add -A && git commit -m "composer: <variant name>"`, then pin it:
   `git update-ref refs/composer/<task-slug>/NN-<variant-slug> HEAD`.
   The SHA goes in the meta comment as `"commit"`.
4. Dev server: reuse if already listening on the assigned port
   (`curl -sf`), else start it detached and wait for it to answer.
   Leave it running — warm for the next round.
5. Capture with `$HUB/capture.mjs` into the task's `variants/`:
   - default: `shot <url> …/variants/NN-<slug>.png`
   - only when the interaction IS the point: write a small driver
     (`export default async (page) => { …clicks… }`) and
     `record <url> …/variants/NN-<slug>.webm driver.mjs` — the briefing
     names WHICH interaction to show on camera; nothing else gets wired.
   - `snapshot <url> out.json --shot out.png` is the builder's own
     "look at my work" check before the final capture.
6. Write `…/variants/NN-<slug>.html`: the meta comment (with `"commit"`
   and `parent`), then just
   `<img src="NN-<slug>.png" style="width:100%">` (or the `<video …
   autoplay loop muted>` equivalent). Relative srcs are correct — the
   board resolves them.

**Boundaries:** never touch the user's branches, index, or main working
tree — all work is detached HEADs in pool worktrees, all history lives
under `refs/composer/` (invisible to `git branch`/`log`, never pushed).
Pick stays record-only: the board's Copy prompt sees `commit` and hands
a fresh agent "cherry-pick this SHA" instead of "rebuild this mockup".
Teardown only on user request: delete the task's `refs/composer/<slug>/*`
refs and `git worktree remove` the pool.

## Rules

- **Backend-free is non-negotiable** (sketch/html/url modes): never call
  a real backend; every button/action mutates in-memory state (no fake
  toasts); never fabricate asset URLs — use provided data or ask.
  (Worktree mode runs whatever the real app runs — its cards are static
  captures, so the board never depends on a live backend either.)
- **Demo depth**: 1–2 representative items interactive, the rest static
  fill; never mock an entire dataset. Sketch mode: zero interactivity.
- **Variants must genuinely diverge.** Each encodes a distinct decision.
- **One headless builder per variant, distinct output path each**, fired
  through `$HUB/spawn.sh` — not the Agent tool, not the
  Workflow tool. Builders are fire-and-forget: their chat output is
  discarded; the variant file + spawn.sh's status line are the only
  channels.
- **Never commit `.composer/`** or suggest committing it; keep the
  gitignore entry intact. Task folders are never deleted by you — they are
  the user's history; only the user deletes them.
- **Never rewrite `requests.jsonl`; only append.** Heartbeat only while
  actually listening — the offline lock is the user's guarantee that a
  click never goes unheard.
