// Concatenates src/ back into the single self-contained index.html.
// Usage: node build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(root, 'src', f), 'utf8');

const out = src('shell.html').replace(
  /^<!-- @include (\S+) -->\n/gm,
  (_, f) => src(f),
);

writeFileSync(join(root, 'index.html'), out);
console.log(`index.html built (${out.length} bytes)`);
