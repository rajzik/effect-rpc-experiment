// Shared JSDoc/export scanning for the docs oracles: `verify-jsdoc.mjs` (enforces the contract in
// docs/jsdoc-style.md) and `site/scripts/gen-api.mjs` (renders the API reference). One parser, so
// what is verified is exactly what is published.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Source directories that are never public API. */
export const SKIP_DIRS = new Set(['internal', 'internals']);

/** Matches an export declaration line: `[indent, kind, name]`. */
export const EXPORT_RE =
  /^(\s*)export\s+(?:declare\s+)?(?:default\s+)?(const|let|function|async\s+function|abstract\s+class|class|interface|type|namespace|enum)\s+([A-Za-z_$][\w$]*)/;

/** Matches any (exported or local) declaration line: `[indent, kind, name]`. */
export const DECL_RE =
  /^(\s*)(?:export\s+)?(?:declare\s+)?(const|let|function|async\s+function|abstract\s+class|class|interface|type|namespace|enum)\s+([A-Za-z_$][\w$]*)/;

/** Export kinds that are runtime values (and so need an **Example**). */
export const VALUE_KINDS = new Set([
  'const',
  'let',
  'function',
  'async function',
  'class',
  'abstract class',
]);

/** All `.ts` / `.tsx` source files under `dir`, skipping `internal(s)` directories. */
export function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) out.push(...walk(full));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Returns the JSDoc block (as raw lines) that ends right above `index`, or undefined. */
export function docAbove(lines, index) {
  let end = index - 1;
  if (end < 0 || !lines[end].trim().endsWith('*/')) return undefined;
  let start = end;
  while (start >= 0 && !lines[start].trim().startsWith('/**')) {
    if (lines[start].trim().startsWith('//')) return undefined;
    start--;
  }
  if (start < 0) return undefined;
  return lines.slice(start, end + 1);
}

/** Strips comment decoration: `/**`, `*\/`, leading ` * `. */
export const docText = (block) =>
  block
    .map((l) =>
      l
        .replace(/^\s*\/\*\*\s?/, '')
        .replace(/\s*\*\/\s*$/, '')
        .replace(/^\s*\* ?/, ''),
    )
    .join('\n');

/** `ts` / `tsx` fences in a doc text: `{ lang, info, code }`. */
export function examplesOf(text) {
  const out = [];
  const re = /```(tsx?)\b([^\n]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) out.push({ lang: m[1], info: m[2].trim(), code: m[3] });
  return out;
}

/** Net `{`/`}` depth change of a line, ignoring comment lines, strings and `//` comments. */
export function braceDelta(line) {
  // JSDoc / block-comment lines are documentation: their braces (`{@link …}`, examples) are not code.
  if (/^\s*(\/\*|\*)/.test(line)) return 0;
  // Strings first: a `//` inside a string ('http://…') is not a comment.
  const stripped = line
    .replace(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:\\.|[^`])*`/g, '')
    .replace(/\/\/.*$/, '');
  let delta = 0;
  for (const ch of stripped) {
    if (ch === '{') delta++;
    else if (ch === '}') delta--;
  }
  return delta;
}

/**
 * Every declaration in a source file, with its brace depth and enclosing namespace:
 * `{ index, indent, kind, name, exported, depth, namespace }`. `namespace` is the name of the
 * innermost `namespace X {` the declaration sits in (or undefined at the top level).
 */
export function scanDeclarations(lines) {
  const out = [];
  const namespaces = []; // [{ name, depth }] — depth inside the namespace body
  let depth = 0;
  lines.forEach((line, index) => {
    const m = DECL_RE.exec(line);
    if (m) {
      const [, indent, rawKind, name] = m;
      const kind = rawKind.replace(/\s+/g, ' ');
      out.push({
        index,
        indent,
        kind,
        name,
        exported: /^\s*export\s/.test(line),
        depth,
        namespace: namespaces.at(-1)?.name,
      });
      if (kind === 'namespace' && line.includes('{')) namespaces.push({ name, depth: depth + 1 });
    }
    depth = Math.max(0, depth + braceDelta(line));
    while (namespaces.length > 0 && depth < namespaces.at(-1).depth) namespaces.pop();
  });
  return out;
}
