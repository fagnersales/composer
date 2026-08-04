# Install Composer — agent playbook

You are an AI coding agent (Claude Code, Codex, or similar) installing
**Composer** for the user on this machine. Follow this file top to bottom.

Composer is a parallel UI-iteration tool: a `/composer` command spawns a
fleet of agents that each build a **different** variant of the requested
UI, and the user compares them as live cards on an infinite pan/zoom
board (localhost:4600) — iterating children from a favorite, tweaking,
combining, and finally picking a winner that hands off to a fresh agent
for real implementation. For existing apps it has a **worktree mode**:
builders fork the real codebase in git worktrees, commit their change,
and ship a screenshot/recording as the card — real fidelity, no mockup
drift. Everything runs locally; variant data lives inside each project
under a gitignored `.composer/` folder.

```
/composer "explore checkout layouts"        the board (localhost:4600)
        │                                   ┌─────┐   ┌─────┐   ┌─────┐
        ├─▶ builder 1 ─▶ 01-variant.html ─▶ │ v1  │   │ v2  │   │ v3  │
        ├─▶ builder 2 ─▶ 02-variant.html ─▶ └──┬──┘   └─────┘   └─────┘
        └─▶ builder 3 ─▶ 03-variant.html ─▶    └── iterate / tweak / pick
```

Every step is **idempotent**: check state first, only create what's
missing. Re-running this playbook on a half-finished install just
completes it.

## Ground rules

- **Check before you create.** Clones, symlinks, prompt files: look at
  what exists first, and only add what's missing.
- **Never overwrite the user's files silently.** If a path you want to
  write (a skill folder, a prompt file) already exists with different
  content, show the user what's there and ask before replacing it.
- **Narrate as you go.** One line before each outward action (cloning,
  writing outside the repo). Finish with the report in step 4.

## 0. Preflight

Check each requirement; help the user fix anything missing before
continuing:

| requirement | check | if missing |
| --- | --- | --- |
| Node.js ≥ 18 | `node --version` | install via their usual channel (nvm, brew, …) |
| git | `git --version` | platform installer |
| Claude Code CLI | `claude --version` | see below |

**The Claude Code CLI is the builder engine.** The fleet builds each
variant by spawning headless `claude -p` processes (via the repo's
`spawn.sh`) — this is required even if *you*, the installing agent, are
something else (Codex, etc.). If it's missing, point the user at
<https://claude.com/claude-code> and pause until it's installed and
logged in.

## 1. Get the code

Ask where to put it if the user hasn't said; default to `~/composer`:

```bash
git clone https://github.com/fagnersales/composer ~/composer
cd ~/composer
npm install
npx playwright install chromium
```

If the target directory already exists and is a clone of this repo,
don't re-clone — `git pull` and re-run the two install commands (both
are no-ops when already satisfied).

Playwright and its Chromium are used only by `capture.mjs`, the
screenshot/record helper builder agents use (essential for worktree
mode, where every card is a capture of the real app). The hub server
itself is zero-dependency. If `npx playwright install chromium` fails
(network policy, disk), Composer still works in sketch/html modes —
tell the user what won't work (worktree-mode captures) and continue.

All remaining steps run from the repo root; `<clone>` below means its
absolute path.

## 2. Wire the user's coding agent

Ask the user which agent they drive day-to-day: **Claude Code**,
**Codex**, or both. Set up each one they name.

### 2a. Claude Code — symlink the skill

```bash
mkdir -p ~/.claude/skills
ln -s "<clone>/skills/composer" ~/.claude/skills/composer
```

The **symlink matters** — don't copy the folder: the skill locates the
clone by resolving the symlink, and updating stays a plain `git pull`.
Check first:

- Symlink already pointing at this clone → done, skip.
- Symlink pointing at a *different* path → ask the user which clone
  should win before relinking.
- A real (copied) directory → show it, and with the user's OK replace
  it with the symlink.

After this, `/composer <what to build>` works in every project the user
opens with Claude Code.

### 2b. Codex — custom prompt file

Codex has no skill symlinks; instead write a custom prompt that points
at the skill file in the clone. Create `~/.codex/prompts/composer.md`
(create the directory if absent) with exactly this content, substituting
the real absolute clone path:

```markdown
Read <clone>/skills/composer/SKILL.md and follow it completely.
Use HUB=<clone> (skip the skill's symlink-based HUB resolution — this
is the composer repo's path). The user's request (what to build) is:
$ARGUMENTS

Where the skill references Claude-Code-specific facilities (the Monitor
tool, background-Bash completion notifications), substitute your own
equivalents: a detached shell loop for the heartbeat + requests.jsonl
watch, and polling for builder completion. Builders are still spawned
with `claude -p` via spawn.sh exactly as the skill says.
```

If the file already exists, show the user a diff before replacing.
After this, `/composer <what to build>` works inside Codex. Note the
caveat honestly: the resident-fleet loop is tuned for Claude Code;
under Codex it's functional but less polished.

## 3. Verify

If `http://localhost:4600` already answers, a hub is running — verify
with the running one instead of starting a second.

```bash
node server.mjs &            # only if :4600 was not answering
curl -fsS http://localhost:4600/api/sessions
```

The response must list the bundled `demo` session. Open
`http://localhost:4600` for the user if you can — the hub page should
show **demo** with a `coffee-hero` task; the board for it proves
end-to-end rendering. Then stop the server if you started it (the
skill starts it on demand; nothing needs to keep running).

## 4. Report

Give the user a closing report:

- **Use it:** from any project, run `/composer <what to build>` (in
  Claude Code or Codex, whichever was wired). Default is 3 variants;
  "5 variants of …" works. The board opens at http://localhost:4600.
- **Modes:** *sketch* (static comps, fastest), *html* (interactive
  self-contained mockups, default), *worktree* (builders fork the real
  app in git worktrees — ask for it when mockups "don't look like my
  app").
- **On the board:** select a card + type to iterate children from it;
  shift-click several to combine; the Iterate|Tweak toggle makes one
  small change inline; "Pick this one" crowns a winner and reveals a
  **Copy prompt** hand-off for a fresh agent session to implement it.
- **Data:** variants live in each project's `.composer/` folder
  (gitignored automatically — never committed; the accumulated tasks
  are their generation history, browsable from the board).
- **Updating:** `git pull` in `<clone>` — the symlink/prompt file keeps
  the skill current automatically.
