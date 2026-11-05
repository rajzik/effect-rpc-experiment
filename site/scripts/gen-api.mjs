#!/usr/bin/env node
// Generates the API reference (`site/api/*.md`) from the packages' JSDoc.
//
//   node site/scripts/gen-api.mjs                # writes site/api/
//   node site/scripts/gen-api.mjs --out <dir>    # writes elsewhere (tests)
//
// One page per package entry point (`.` → `<pkg>.md`, `./node` → `<pkg>-node.md`). Each public
// name of the entry is resolved through the barrel's re-exports to its declaration; its JSDoc is
// rendered with the sections of docs/jsdoc-style.md. Namespaces (`Router.Any`), value objects
// (`Router.make`) and `export * as` modules (`Codecs.*`) list their members. Parsing is shared with
// scripts/verify-jsdoc.mjs, so what is verified is what is published.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { braceDelta, docAbove, docText, scanDeclarations } from '../../scripts/jsdoc-parse.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packagesDir = join(repoRoot, 'packages');
const githubTree = 'https://github.com/rajzik/effect-rpc-experiment/tree/main';
const SKIP_PACKAGES = new Set(['e2e']);
const MAX_SIGNATURE_LINES = 40;
const CATEGORY_ORDER = [
  'constructors',
  'models',
  'combinators',
  'hooks',
  'components',
  'context',
  'layers',
  'guards',
  'refinements',
  'errors',
  'codecs',
  'type-level',
  'utils',
  're-exports',
];

const argv = process.argv.slice(2);
const outIndex = argv.indexOf('--out');
const outDir = outIndex === -1 ? join(repoRoot, 'site', 'api') : resolve(argv[outIndex + 1]);

/** Anchor slug: lower-case, non-alphanumerics to `-`. */
export const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

// ---------------------------------------------------------------------------------------------
// Source files

const fileCache = new Map();

/** Lines and declarations of a source file (cached). */
function source(file) {
  let entry = fileCache.get(file);
  if (!entry) {
    const lines = readFileSync(file, 'utf8').split('\n');
    entry = { file, lines, decls: scanDeclarations(lines) };
    fileCache.set(file, entry);
  }
  return entry;
}

/** Resolves a relative module specifier (`./X.js`) from `fromFile` to a `.ts`/`.tsx` file. */
function resolveModule(fromFile, specifier) {
  const workspace = /^@effect-trpc\/([^/]+)(?:\/(.+))?$/.exec(specifier);
  if (workspace) {
    return resolveModule(
      join(packagesDir, workspace[1], 'src', 'x.ts'),
      `./${workspace[2] ?? 'index'}.js`,
    );
  }
  const base = resolve(dirname(fromFile), specifier.replace(/\.(m?js|tsx?)$/, ''));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`gen-api: cannot resolve ${specifier} from ${fromFile}`);
}

/** The module header text (overview) of a file, without tags. */
function moduleOverview(file) {
  const { lines } = source(file);
  const first = lines.findIndex((l) => l.trim() !== '');
  if (!lines[first]?.trim().startsWith('/**')) return '';
  let end = first;
  while (end < lines.length && !lines[end].includes('*/')) end++;
  return splitTags(docText(lines.slice(first, end + 1))).body;
}

// ---------------------------------------------------------------------------------------------
// Entry exports: what a package entry makes public, and where each name is declared

/**
 * Public names of an entry file: `[{ name, file, original, star }]`. `star` marks
 * `export * as Name from` (a module namespace: its members are that module's exports).
 */
function entryExports(entryFile) {
  const text = readFileSync(entryFile, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const reExport = /export\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(reExport)) {
    // Third-party re-exports (`skipToken` from @tanstack/react-query) are listed, not documented.
    const external = /^(\.|@effect-trpc\/)/.test(m[3]) ? undefined : m[3];
    const file = external ? entryFile : resolveModule(entryFile, m[3]);
    for (const raw of m[2].split(',')) {
      const part = raw
        .replace(/\/\/.*$/gm, '')
        .trim()
        .replace(/^type\s+/, '');
      if (!part) continue;
      const [original, alias] = part.split(/\s+as\s+/);
      out.push({ name: alias ?? original, file, original, star: false, external });
    }
  }
  for (const m of text.matchAll(
    /export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/g,
  )) {
    out.push({ name: m[1], file: resolveModule(entryFile, m[2]), original: m[1], star: true });
  }
  for (const m of text.matchAll(/export\s+\*\s+from\s*['"]([^'"]+)['"]/g)) {
    const file = resolveModule(entryFile, m[1]);
    for (const decl of source(file).decls) {
      if (decl.exported && decl.depth === 0) {
        out.push({ name: decl.name, file, original: decl.name, star: false });
      }
    }
  }
  for (const decl of source(entryFile).decls) {
    if (decl.exported && decl.depth === 0) {
      out.push({ name: decl.name, file: entryFile, original: decl.name, star: false });
    }
  }
  const seen = new Set();
  return out.filter((e) => (seen.has(e.name) ? false : (seen.add(e.name), true)));
}

/** Relative and workspace named imports of a file: `[{ name, file, original, star: false }]`. */
function importsOf(file) {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)) {
    if (!/^(\.|@effect-trpc\/)/.test(m[2])) continue;
    const from = resolveModule(file, m[2]);
    for (const raw of m[1].split(',')) {
      const part = raw.trim().replace(/^type\s+/, '');
      if (!part) continue;
      const [original, alias] = part.split(/\s+as\s+/);
      out.push({ name: alias ?? original, file: from, original, star: false });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Declarations → signature and doc

/** The declaration head of `decl`: the text a reader needs, without the implementation body. */
function signatureOf(file, decl) {
  const { lines } = source(file);
  const start = decl.index;
  const kind = decl.kind;
  const take = [];
  let depth = 0; // ( [ {
  let done = false;
  let assigned = false;
  for (let i = start; i < lines.length && !done; i++) {
    let line = lines[i];
    if (i === start) line = line.replace(/^(\s*)export\s+(declare\s+)?/, '$1');
    let cut = -1;
    const stripped = line.replace(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:\\.|[^`])*`/g, (s) =>
      ' '.repeat(s.length),
    );
    for (let c = 0; c < stripped.length; c++) {
      const ch = stripped[c];
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      else if (ch === '{') {
        if (
          depth === 0 &&
          (kind === 'function' || kind === 'async function') &&
          /\)\s*(:[^{]*)?$/.test(stripped.slice(0, c).trimEnd() + ' ')
        ) {
          cut = c;
          break;
        }
        if (depth === 0 && kind === 'namespace') {
          cut = c + 1;
          break;
        }
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && (kind === 'interface' || kind === 'class' || kind === 'enum')) {
          cut = c + 1;
          break;
        }
      } else if (depth === 0 && (kind === 'const' || kind === 'let')) {
        if (stripped.startsWith('=>', c)) {
          cut = c + 2;
          break;
        }
        if (!assigned && ch === '=' && stripped[c + 1] !== '>' && stripped[c - 1] !== '=') {
          // The assignment of `const x = <value>` (later `=` are generic defaults or bodies).
          assigned = true;
          const rest = [line, ...lines.slice(i + 1)].join('\n').slice(c + 1);
          if (/^\s*(async\s+)?[<(]/.test(rest)) continue; // an arrow function: keep its head
          const value = stripped.slice(c + 1).trim();
          if (value.endsWith(';') && value.length <= 80) {
            cut = stripped.length; // a short literal (`'effect-trpc' as const;`): keep it
          } else cut = c;
          break;
        }
      } else if (ch === ';' && depth === 0) {
        cut = c + 1;
        break;
      }
    }
    if (cut !== -1) {
      line = line.slice(0, cut);
      done = true;
    }
    take.push(line);
  }
  if (kind === 'namespace') take[take.length - 1] += ' … }';
  else if (kind === 'function' || kind === 'async function') take[take.length - 1] += '';
  const indent = Math.min(...take.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length));
  let text = take
    .map((l) => l.slice(indent))
    .join('\n')
    .trimEnd();
  if (text.endsWith('=')) text = `${text.slice(0, -1).trimEnd()};`;
  const out = text.split('\n');
  if (out.length > MAX_SIGNATURE_LINES) {
    return `${out.slice(0, MAX_SIGNATURE_LINES).join('\n')}\n  // … (${out.length - MAX_SIGNATURE_LINES} more lines)`;
  }
  return text;
}

/** Splits doc text into its body and `@tag` lines. */
function splitTags(text) {
  const lines = text.split('\n');
  const body = [];
  const tags = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && /^@\w+/.test(line.trim())) tags.push(line.trim());
    else if (!inFence && tags.length > 0 && line.trim() !== '' && !line.trim().startsWith('@')) {
      tags[tags.length - 1] += ` ${line.trim()}`;
    } else body.push(line);
  }
  return { body: body.join('\n').trim(), tags };
}

/** Parsed JSDoc of a declaration, or undefined. */
function docOf(file, decl) {
  const block = docAbove(source(file).lines, decl.index);
  if (!block) return undefined;
  const { body, tags } = splitTags(docText(block));
  const tag = (name) =>
    tags.filter((t) => t.startsWith(`@${name}`)).map((t) => t.slice(name.length + 1).trim());
  return {
    body,
    category: tag('category')[0],
    since: tag('since')[0],
    see: tag('see'),
    deprecated: tag('deprecated')[0],
    internal: tags.some((t) => t.startsWith('@internal')),
  };
}

/** Members of a `const X = { a, b: c } as const` value object: `[{ name, decl }]`. */
function valueObjectMembers(file, decl) {
  const { lines, decls } = source(file);
  const head = lines[decl.index];
  if (!/=\s*\{\s*$/.test(head)) return [];
  const out = [];
  let depth = braceDelta(head);
  for (let i = decl.index + 1; i < lines.length && depth > 0; i++) {
    const line = lines[i];
    if (depth === 1) {
      const spread = /^\s*\.\.\.([\w$.]+),?\s*$/.exec(line);
      const m = /^\s*([A-Za-z_$][\w$]*)\s*(?::\s*(.+?))?,?\s*$/.exec(line);
      if (spread) out.push({ spread: spread[1] });
      else if (m && !line.trim().startsWith('*') && !line.trim().startsWith('/')) {
        const target = m[2] ?? m[1];
        const local = /^[A-Za-z_$][\w$]*$/.test(target)
          ? decls.find((d) => d.name === target && d.depth === 0)
          : undefined;
        // `name` / `name: local` → the local declaration; `name: expr` → the property itself.
        if (local) out.push({ name: m[1], decl: local });
        else out.push({ name: m[1], decl: { index: i, kind: 'property' }, expr: target });
      }
    }
    depth += braceDelta(line);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Items: one per public name, with merged declarations and members

/** Builds the documented item for one public name of an entry. */
function itemOf(entry) {
  if (entry.external) {
    // A doc block right above the `export { … } from '<pkg>'` statement documents it.
    const { lines } = source(entry.file);
    const at = lines.findIndex(
      (l) => /^export\s/.test(l) && l.includes(entry.external) && l.includes(entry.original),
    );
    const own = at === -1 ? undefined : docOf(entry.file, { index: at });
    return {
      name: entry.name,
      doc: {
        body: `Re-exported from \`${entry.external}\`${entry.original === entry.name ? '' : ` (as \`${entry.original}\`)`}.${own?.body ? `\n\n${own.body}` : ''}`,
        category: own?.category ?? 're-exports',
        since: own?.since,
        see: own?.see ?? [],
      },
      signatures: [`export { ${entry.original} } from '${entry.external}';`],
      members: [],
    };
  }
  if (entry.star) {
    const members = source(entry.file)
      .decls.filter((d) => d.exported && d.depth === 0)
      .map((d) => memberOf(entry.file, d.name, d));
    return {
      name: entry.name,
      doc: { body: moduleOverview(entry.file), category: 'modules', see: [] },
      signatures: [`import { ${entry.name} } from '…'; // module namespace`],
      members: dedupe(members),
    };
  }
  const { decls } = source(entry.file);
  const own = decls.filter((d) => d.name === entry.original && d.depth === 0);
  if (own.length === 0) {
    // A barrel re-exporting another barrel (`export { ClientError } from '@effect-trpc/core'`).
    // Or a module re-exporting a name it imported (`import type { ErrorAt } from './types.js'`).
    const next =
      entryExports(entry.file).find((e) => e.name === entry.original) ??
      importsOf(entry.file).find((e) => e.name === entry.original);
    if (next?.external) return { ...itemOf(next), name: entry.name };
    if (!next || next.file === entry.file) {
      throw new Error(`gen-api: no declaration of ${entry.original} in ${entry.file}`);
    }
    return { ...itemOf(next), name: entry.name };
  }
  const docs = own.map((d) => ({ decl: d, doc: docOf(entry.file, d) }));
  const primary =
    docs.find((d) => d.doc && ['const', 'function', 'class'].includes(d.decl.kind)) ??
    docs.find((d) => d.doc);
  const members = [];
  for (const d of own) {
    if (d.kind === 'namespace') {
      for (const child of decls) {
        if (child.namespace === d.name && child.exported) {
          members.push(memberOf(entry.file, child.name, child));
        }
      }
    }
    if (d.kind === 'const') {
      const objectMembers = valueObjectMembers(entry.file, d);
      if (objectMembers.length > 0) {
        d.objectKeys = objectMembers.map((m) =>
          m.spread
            ? `...typeof ${m.spread}`
            : `${m.name}: ${m.expr ? `typeof ${m.expr}` : `typeof ${m.name}`};`,
        );
      }
      for (const m of objectMembers) {
        if (m.spread) continue;
        members.push(
          m.expr
            ? {
                name: m.name,
                doc: docOf(entry.file, m.decl) ?? { body: '', see: [] },
                signature: `${m.name}: typeof ${m.expr}`,
              }
            : memberOf(entry.file, m.name, m.decl),
        );
      }
    }
  }
  return {
    name: entry.name,
    doc: primary?.doc ?? { body: '', see: [] },
    signatures: own
      .filter((d) => !(d.kind === 'namespace' && own.length > 1))
      .map((d) =>
        d.objectKeys
          ? `const ${d.name}: {\n${d.objectKeys.map((k) => `  ${k}${k.startsWith('...') ? ',' : ''}`).join('\n')}\n};`
          : signatureOf(entry.file, d),
      ),
    members: dedupe(members),
  };
}

function memberOf(file, name, decl) {
  return {
    name,
    doc: docOf(file, decl) ?? { body: '', see: [] },
    signature: signatureOf(file, decl),
  };
}

/** Members sharing a name (a type and a value) merge into one entry. */
function dedupe(members) {
  const byName = new Map();
  for (const m of members) {
    if (m.doc.internal) continue;
    const prev = byName.get(m.name);
    if (!prev) byName.set(m.name, { ...m, signatures: [m.signature] });
    else {
      prev.signatures.push(m.signature);
      if (!prev.doc.body && m.doc.body) prev.doc = m.doc;
    }
  }
  return [...byName.values()];
}

// ---------------------------------------------------------------------------------------------
// Rendering

/** Replaces `{@link X}` with a link when X is documented, else inline code. */
function linkify(text, page, anchors) {
  return text.replace(/\{@link\s+([^}|\s]+)(?:\s*\|\s*([^}]+))?\}/g, (_, target, label) => {
    const shown = `\`${(label ?? target).trim()}\``;
    const key = slug(target);
    const home = anchors.get(key);
    if (!home) return shown;
    return home === page ? `[${shown}](#${key})` : `[${shown}](./${home}#${key})`;
  });
}

/** Escapes `<` outside code so Vue does not read type parameters as tags. */
function escapeProse(md) {
  return md
    .split(/(```[\s\S]*?```)/g)
    .map((chunk, i) =>
      i % 2 === 1
        ? chunk
        : chunk
            .split(/(`[^`\n]*`)/g)
            .map((part, j) => (j % 2 === 1 ? part : part.replace(/</g, '&lt;')))
            .join(''),
    )
    .join('');
}

function renderDoc(doc, page, anchors) {
  const out = [];
  if (doc.deprecated !== undefined) {
    out.push(`::: warning Deprecated\n${doc.deprecated || 'Deprecated.'}\n:::`);
  }
  if (doc.body) out.push(doc.body);
  if (doc.see.length > 0) out.push(`**See also:** ${doc.see.join(', ')}`);
  return escapeProse(linkify(out.join('\n\n'), page, anchors));
}

const fence = (code) => `\`\`\`ts\n${code}\n\`\`\``;

function renderItem(item, page, anchors) {
  const out = [`### \`${item.name}\` {#${item.anchor}}`, ''];
  for (const signature of item.signatures) out.push(fence(signature), '');
  const doc = renderDoc(item.doc, page, anchors);
  if (doc) out.push(doc, '');
  if (item.members.length > 0) {
    out.push(`**Members of \`${item.name}\`**`, '');
    // `Router.merge` (value) and `Router.Merge` (type) slug alike: the type gets `-type`.
    const used = new Set();
    const ordered = [...item.members].toSorted(
      (a, b) => Number(/^[A-Z]/.test(a.name)) - Number(/^[A-Z]/.test(b.name)),
    );
    const anchorOf = new Map();
    for (const member of ordered) {
      let anchor = `${slug(item.name)}-${slug(member.name)}`;
      if (used.has(anchor)) anchor = `${anchor}-type`;
      used.add(anchor);
      anchorOf.set(member, anchor);
    }
    for (const member of item.members) {
      const anchor = anchorOf.get(member);
      out.push(`#### \`${item.name}.${member.name}\` {#${anchor}}`, '');
      for (const signature of member.signatures) out.push(fence(signature), '');
      const memberDoc = renderDoc(member.doc, page, anchors);
      if (memberDoc) out.push(memberDoc, '');
      if (member.doc.since) out.push(`<p class="api-since">Since ${member.doc.since}</p>`, '');
    }
  }
  if (item.doc.since) out.push(`<p class="api-since">Since ${item.doc.since}</p>`, '');
  return out.join('\n');
}

const titleCase = (s) =>
  s.replace(/(^|[-\s])(\w)/g, (_, sep, c) => `${sep === '-' ? ' ' : sep}${c.toUpperCase()}`);

function categoryRank(category) {
  const i = CATEGORY_ORDER.indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

function renderPage(page) {
  const groups = new Map();
  for (const item of page.items) {
    const category = item.doc.category ?? 'other';
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push(item);
  }
  const ordered = [...groups.entries()].toSorted(
    ([a], [b]) => categoryRank(a) - categoryRank(b) || a.localeCompare(b),
  );
  const out = [
    '---',
    `title: '${page.importPath}'`,
    'outline: [2, 3]',
    'editLink: false',
    '---',
    '',
    `# ${page.importPath}`,
    '',
    '<!-- Generated by site/scripts/gen-api.mjs from the package JSDoc. Do not edit. -->',
    '',
    escapeProse(linkify(page.overview, page.name, page.anchors)),
    '',
    fence(`import { … } from '${page.importPath}';`),
    '',
    `Source: [\`packages/${page.pkg}/src\`](${githubTree}/packages/${page.pkg}/src) · README: [\`packages/${page.pkg}/README.md\`](${githubTree}/packages/${page.pkg}/README.md)`,
    '',
    '::: v-pre',
    '',
  ];
  for (const [category, items] of ordered) {
    out.push(`## ${titleCase(category)} {#section-${slug(category)}}`, '');
    for (const item of items) out.push(renderItem(item, page.name, page.anchors));
  }
  out.push(':::', '');
  return out.join('\n');
}

function renderIndex(pages) {
  const rows = pages.map(
    (p) => `| [\`${p.importPath}\`](./${p.name}) | ${p.description.replace(/\|/g, '\\|')} |`,
  );
  return [
    '---',
    'title: API reference',
    'editLink: false',
    '---',
    '',
    '# API reference',
    '',
    'Every public export of every package, generated from the JSDoc in the source. Each entry has',
    'its signature, a summary, **When to use**, **Details**, **Gotchas** and a type-checked',
    '**Example**. The guides explain how the pieces fit together; this is where to look up the exact',
    'shape of one of them.',
    '',
    '| Entry point | What it is for |',
    '| --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Main

function collectPages() {
  const pages = [];
  for (const pkg of readdirSync(packagesDir).toSorted()) {
    if (SKIP_PACKAGES.has(pkg)) continue;
    const pkgDir = join(packagesDir, pkg);
    const manifestPath = join(pkgDir, 'package.json');
    if (!existsSync(join(pkgDir, 'src')) || !existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    for (const key of Object.keys(manifest.exports ?? {})) {
      if (key === './package.json') continue;
      const sub = key === '.' ? 'index' : key.replace(/^\.\//, '');
      const entryFile = resolveModule(join(pkgDir, 'src', 'x.ts'), `./${sub}.js`);
      const items = entryExports(entryFile).map(itemOf);
      pages.push({
        pkg,
        name: sub === 'index' ? pkg : `${pkg}-${sub.replace(/\//g, '-')}`,
        importPath: key === '.' ? manifest.name : `${manifest.name}/${sub}`,
        description:
          sub === 'index'
            ? (manifest.description ?? '')
            : moduleOverview(entryFile)
                .split(/\n\s*\n/)[0]
                .replace(/\s+/g, ' '),
        overview: moduleOverview(entryFile),
        items,
      });
    }
  }
  // Global anchor → page map, for cross-page {@link}s (first page wins).
  const anchors = new Map();
  for (const page of pages) {
    for (const item of page.items) {
      if (!anchors.has(slug(item.name))) anchors.set(slug(item.name), page.name);
      for (const member of item.members) {
        const key = slug(`${item.name}.${member.name}`);
        if (!anchors.has(key)) anchors.set(key, page.name);
      }
    }
  }
  for (const page of pages) {
    // `skipToken` (value) and `SkipToken` (type) slug alike: the type gets `-type`.
    const used = new Set();
    const valuesFirst = [...page.items].toSorted(
      (a, b) => Number(/^[A-Z]/.test(a.name)) - Number(/^[A-Z]/.test(b.name)),
    );
    for (const item of valuesFirst) {
      item.anchor = slug(item.name);
      if (used.has(item.anchor)) item.anchor = `${item.anchor}-type`;
      used.add(item.anchor);
    }
    const local = new Map(anchors);
    for (const item of page.items) {
      local.set(slug(item.name), page.name);
      for (const member of item.members) local.set(slug(`${item.name}.${member.name}`), page.name);
    }
    page.anchors = local;
  }
  return pages;
}

const pages = collectPages();
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const page of pages) writeFileSync(join(outDir, `${page.name}.md`), renderPage(page));
writeFileSync(join(outDir, 'index.md'), renderIndex(pages));
process.stdout.write(
  `gen-api: ${pages.length} pages, ${pages.reduce((n, p) => n + p.items.length, 0)} exports → ${outDir}\n`,
);
