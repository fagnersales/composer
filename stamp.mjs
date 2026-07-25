#!/usr/bin/env node
// Stamp builder effort into a variant's meta comment.
//
// usage: node stamp.mjs <claude-json-log> <variant-html>
//
// The log is `claude -p --output-format json` stdout (spawn.sh captures it
// per slot). Adds `"stats":{"ms","in","out"}` to the variant-meta line:
//   ms  wall time of the builder run
//   in  fresh input actually processed (input + cache writes; cache READS
//       are near-free re-reads and would dwarf everything else)
//   out tokens generated
// Exits 0 silently when there's nothing to stamp (missing file, cancelled
// build, unparseable log) — effort badges are best-effort, never a failure.
import fs from "node:fs";

const [, , logPath, htmlPath] = process.argv;
try {
  const j = JSON.parse(fs.readFileSync(logPath, "utf8"));
  const u = j.usage || {};
  const stats = {
    ms: j.duration_ms || 0,
    in: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    out: u.output_tokens || 0,
  };
  const html = fs.readFileSync(htmlPath, "utf8");
  const m = html.match(/<!--\s*variant-meta\s+({[\s\S]*?})\s*-->/);
  if (!m) process.exit(0);
  const meta = JSON.parse(m[1]);
  meta.stats = stats;
  fs.writeFileSync(htmlPath, html.replace(m[0], `<!--variant-meta ${JSON.stringify(meta)}-->`));
} catch {
  process.exit(0);
}
