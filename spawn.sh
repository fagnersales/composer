#!/usr/bin/env bash
# Composer fleet spawner — fires one headless `claude -p` per prompt file,
# all at once, and owns the request's terminal status line so the fleet
# agent never has to collect builder output. On success nothing signals the
# agent at all: the variants land as files and the hub's watcher tells the
# board. Only failure produces a "failed" status line for the fleet loop to
# see on its next poll.
#
# usage: spawn.sh <task-dir> <request-id|-> <model> <prompt-file>...
#
#   task-dir    the task folder (contains requests.jsonl and variants/)
#   request-id  the requests.jsonl id to report status for, or "-" for a
#               spawn with no request line (the initial fan-out) — then no
#               status is written and failures surface via the exit code
#   model       sonnet | opus | fable (or a full model id, passed through)
#   prompt-file one self-contained briefing per builder; the builder's slot
#               name is the file's basename
#
# Logs, exit codes and PIDs land in <data-dir>/.builds/<task>/<id>/ —
# outside the task dir on purpose: the hub watches the task dir recursively
# and log writes must not fire SSE churn. Cancellation = kill the PIDs in
# that dir's `pids` file; a post-cancel status append is harmless (the hub
# treats "cancelled" as terminal at read time) but we skip it anyway.
set -u

SELF_DIR=$(cd "$(dirname "$0")" && pwd)
TASK_DIR=$(cd "$1" && pwd) || exit 1
REQ_ID=$2
MODEL=$3
shift 3
[ $# -ge 1 ] || { echo "no prompt files" >&2; exit 1; }

REQS="$TASK_DIR/requests.jsonl"
BUILD="$(dirname "$TASK_DIR")/.builds/$(basename "$TASK_DIR")/${REQ_ID#-}"
[ "$REQ_ID" = "-" ] && BUILD="$(dirname "$TASK_DIR")/.builds/$(basename "$TASK_DIR")/init-$$"
mkdir -p "$BUILD"

case "$MODEL" in
  sonnet) MODEL=claude-sonnet-5 ;;
  opus)   MODEL=claude-opus-5 ;;
  fable)  MODEL=claude-fable-5 ;;
esac

TIMEOUT_S=${COMPOSER_BUILD_TIMEOUT:-900}
ALLOWED_TOOLS=${COMPOSER_ALLOWED_TOOLS:-"Read,Glob,Grep,Write,Edit"}

append_status() { # status, note — skipped entirely for id "-"
  [ "$REQ_ID" = "-" ] && return 0
  printf '{"kind":"status","id":"%s","status":"%s","note":"%s"}\n' \
    "$REQ_ID" "$1" "$2" >> "$REQS"
}
is_cancelled() {
  [ "$REQ_ID" != "-" ] &&
    grep -q "\"id\":\"$REQ_ID\".*\"status\":\"cancelled\"" "$REQS" 2>/dev/null
}

# one builder: headless claude with a portable watchdog (macOS has no
# `timeout`); records the claude PID for cancellation kills and the exit
# code for the final tally
run_one() { # prompt-file slot
  claude -p "$(cat "$1")" --model "$MODEL" \
    --allowedTools "$ALLOWED_TOOLS" \
    --output-format json \
    > "$BUILD/$2.log" 2>&1 &
  local cpid=$!
  echo "$cpid" >> "$BUILD/pids"
  ( sleep "$TIMEOUT_S" && kill "$cpid" 2>/dev/null ) &
  local wpid=$!
  wait "$cpid"
  local code=$?
  kill "$wpid" 2>/dev/null
  echo "$code" > "$BUILD/$2.exit"
  # effort badge: the JSON result carries duration + token usage; stamp it
  # into the variant's meta (slot name == variant filename by convention).
  # Best-effort — stamp.mjs exits 0 quietly when there's nothing to stamp.
  [ "$code" -eq 0 ] && [ -f "$TASK_DIR/variants/$2.html" ] &&
    node "$SELF_DIR/stamp.mjs" "$BUILD/$2.log" "$TASK_DIR/variants/$2.html"
}

: > "$BUILD/pids"
pids=""
for prompt in "$@"; do
  slot=$(basename "$prompt")
  slot=${slot%.*}
  run_one "$prompt" "$slot" &
  pids="$pids $!"
done
for p in $pids; do wait "$p"; done

fails=""
for prompt in "$@"; do
  slot=$(basename "$prompt")
  slot=${slot%.*}
  code=$(cat "$BUILD/$slot.exit" 2>/dev/null || echo "?")
  [ "$code" != "0" ] && fails="$fails $slot(exit $code)"
done

is_cancelled && exit 0
if [ -n "$fails" ]; then
  append_status failed "builders failed:$fails — logs in $BUILD"
  exit 1
else
  append_status done "→ $# variant(s) landed"
fi
