# Composer

One prompt spawns a fleet of agents that each build a **different** take
on the requested UI. You compare them as live cards on an infinite
pan/zoom board, iterate children from a favorite, and pick a winner —
all on your machine. For existing apps, builders fork the real code in
git worktrees, so what you compare is what you'd ship.

Homepage: <https://composer.fagner.ink>

This repo is the tool (hub server + board UI + the `/composer` skill).
The data lives inside each project you use it in, under a gitignored
`<project>/.composer/` folder — your generation history, browsable from
the board.

## Get started

Composer is installed *by your coding agent*. Paste this into Claude
Code, Codex, or any agent that can fetch a URL and run commands:

> Fetch https://raw.githubusercontent.com/fagnersales/composer/master/INSTALL.md
> and follow it to install Composer for me.

The playbook ([INSTALL.md](INSTALL.md)) clones the repo, wires the
`/composer` command into Claude Code (skill symlink) and/or Codex
(custom prompt) — it asks which — and verifies the board end-to-end.

Requirements: Node 18+, and the Claude Code CLI — the fleet builds each
variant by spawning headless `claude -p` processes, whichever agent you
drive day-to-day.

## The board

Cards are variants; edges show parent→child lineage; ghost cards show
builds in flight (live over SSE). Select a card and type to iterate
children from it; shift-click several to combine them; the
Iterate|Tweak toggle makes one small inline change; paste reference
images to send them along to the builders. **Pick this one** crowns a
winner and reveals a **Copy prompt** hand-off brief for a fresh agent
session to implement. Drag to arrange, `o` to organize the tree into
generations, double-click to inspect. Iterate/tweak lock while no fleet
agent is heartbeating ("fleet offline"), so a request never goes
unheard.

## Run

```sh
node server.mjs        # hub on http://localhost:4600 (PORT env to override)
```

- `/` — hub page: every registered session, its tasks, fleet-live dots.
- `/b/<session>?task=<slug>` — the board for one project task.

The skill starts the hub on demand; you rarely run it by hand. A `demo`
session ships in `demo/`.

## Per-project layout

```
<project>/.composer/                 # gitignored, never committed
  <task-slug>/
    task.json                        # {"title": "...", "created": ISO}
    requests.jsonl                   # append-only feedback inbox
    variants/                        # NN-slug.html, one per variant
    images/                          # reference images pasted into the board
```

## Docs

- [INSTALL.md](INSTALL.md) — the install playbook, written for an agent
  to execute.
- [PROTOCOL.md](PROTOCOL.md) — the reference for agents and integrators:
  variant file format, HTTP API, the `requests.jsonl` agent protocol,
  `spawn.sh`.
- [skills/composer/SKILL.md](skills/composer/SKILL.md) — the `/composer`
  skill itself.
