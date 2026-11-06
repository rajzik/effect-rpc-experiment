// Spike: infer the schemas of Procedure builder chains from each handler's inferred
// `Effect<A, E>` / `Stream<A, E>`, using the TypeScript 7 checker API
// (`typescript/unstable/sync`), and write `<file>.gen.ts` with them injected as
// `.inferred({ output, error })` right before the terminal.
//
// Usage: node generate.mjs <tsconfig.json> <router.ts> [<router.ts>...]
//
// Rules:
// - Only inferring chains are touched: a chain with `.output(...)` (or `.inferred(...)`) is
//   explicit and kept as written.
// - Output types map structurally: primitives, literals, `Date`, arrays, tuples, plain object
//   types, unions, and Schema classes (`Schema.Class`, `Schema.TaggedClass`, ...), which are
//   imported from their declaring module instead of re-synthesised. A `void` output needs no
//   schema.
// - Without a user `.error(...)`, the Schema-class members of `E` become `error`; everything
//   else (e.g. a `Data.TaggedError`) is left out and so stays a defect on the client. Errors
//   declared by the chain's middleware are not repeated.
// - An output type that cannot be mapped (a plain class, a function, `any`) fails the run with
//   the procedure's location, asking for an explicit `.output(...)`.
import { API, ObjectFlags, SymbolFlags, TypeFlags } from 'typescript/unstable/sync';
import { SyntaxKind } from 'typescript/unstable/ast';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [tsconfigArg, ...files] = process.argv.slice(2);
if (tsconfigArg === undefined || files.length === 0) {
  console.error('usage: node generate.mjs <tsconfig.json> <router.ts> [...]');
  process.exit(2);
}
const tsconfig = path.resolve(tsconfigArg);

const TERMINALS = new Set(['query', 'mutation', 'subscription']);
const S = '__Schema';

class Unmappable extends Error {}

const started = performance.now();
const api = new API({ cwd: path.dirname(tsconfig) });
const snapshot = api.updateSnapshot({ openProjects: [tsconfig] });
const project = snapshot.getProject(tsconfig) ?? snapshot.getProjects()[0];
const { program, checker } = project;

const lineOf = (text, pos) => text.slice(0, pos).split('\n').length;

/** Whether a class symbol's constructor is an Effect schema (has a static `ast`). */
const isSchemaClass = (symbol) => {
  if ((symbol.flags & SymbolFlags.Class) === 0) return false;
  const staticSide = checker.getTypeOfSymbol(symbol);
  return staticSide !== undefined && checker.getPropertyOfType(staticSide, 'ast') !== undefined;
};

/** The step names of a builder chain ending at `call` (e.g. ['input', 'error', 'query']). */
const chainSteps = (call) => {
  const steps = [];
  let node = call;
  while (
    node.kind === SyntaxKind.CallExpression &&
    node.expression.kind === SyntaxKind.PropertyAccessExpression
  ) {
    steps.push(node.expression.name.text);
    node = node.expression.expression;
  }
  return steps;
};

/** Symbol ids of the error classes declared by the `.middleware(M)` steps of a chain. */
const middlewareErrorSymbols = (call) => {
  const ids = new Set();
  let node = call.expression.expression;
  while (
    node.kind === SyntaxKind.CallExpression &&
    node.expression.kind === SyntaxKind.PropertyAccessExpression
  ) {
    if (node.expression.name.text === 'middleware' && node.arguments.length === 1) {
      const middleware = checker.getTypeAtLocation(node.arguments[0]);
      const errorProp = middleware && checker.getPropertyOfType(middleware, 'error');
      const errorSchema = errorProp && checker.getTypeOfSymbol(errorProp);
      const typeProp = errorSchema && checker.getPropertyOfType(errorSchema, 'Type');
      const errorType = typeProp && checker.getTypeOfSymbol(typeProp);
      if (errorType !== undefined) {
        const members = errorType.flags & TypeFlags.Union ? errorType.getTypes() : [errorType];
        for (const member of members) {
          const symbol = member.getSymbol();
          if (symbol !== undefined) ids.add(symbol.id);
        }
      }
    }
    node = node.expression.expression;
  }
  return ids;
};

const isBool = (type) => /^(true|false)$/.test(checker.typeToString(type));

/** `Effect<A, E, R>` / `Stream<A, E, R>` are type references: their arguments can be read. */
const isReference = (type) =>
  (type.flags & TypeFlags.Object) !== 0 && (type.objectFlags & ObjectFlags.Reference) !== 0;

const generate = (file) => {
  const text = readFileSync(file, 'utf8');
  const sourceFile = program.getSourceFile(file);
  if (sourceFile === undefined) throw new Error(`${file} is not part of ${tsconfig}`);

  /** module path -> import alias, for the schema classes the injected code references. */
  const imports = new Map();
  const importAlias = (symbol) => {
    const declaration = symbol.valueDeclaration ?? symbol.declarations[0];
    // `NodeHandle.path` is the checker's canonical (case-folded) path; use the real file name.
    const declSourceFile = program.getSourceFile(declaration.path);
    const declFile = declSourceFile?.fileName ?? declaration.path;
    const exportsOfModule = checker.getExportsOfModule(
      checker.getSymbolAtLocation(declSourceFile) ?? symbol.getParent(),
    );
    if (!exportsOfModule.some((s) => s.name === symbol.name))
      throw new Unmappable(`schema class ${symbol.name} is not exported from ${declFile}`);
    let specifier = path.relative(path.dirname(file), declFile).replaceAll(path.sep, '/');
    if (!specifier.startsWith('.')) specifier = `./${specifier}`;
    if (!imports.has(specifier)) imports.set(specifier, `__m${imports.size}`);
    return `${imports.get(specifier)}.${symbol.name}`;
  };

  /** Members of a union -> schema (`boolean` collapsed, `null` / `undefined` as `NullOr` / `UndefinedOr`). */
  const unionSchema = (members, seen = new Set()) => {
    const flat = members.flatMap((m) => (m.flags & TypeFlags.Union ? m.getTypes() : [m]));
    const unique = [...new Map(flat.map((m) => [m.id, m])).values()].filter(
      (m) => (m.flags & TypeFlags.Never) === 0,
    );
    if (unique.length === 0) return `${S}.Never`;
    const hasBoolean =
      unique.some((m) => checker.typeToString(m) === 'true') &&
      unique.some((m) => checker.typeToString(m) === 'false');
    const parts = unique.filter((m) => !(hasBoolean && isBool(m))).map((m) => toSchema(m, seen));
    if (hasBoolean) parts.push(`${S}.Boolean`);
    const distinct = [...new Set(parts)];
    const nonNullish = distinct.filter((p) => p !== `${S}.Null` && p !== `${S}.Undefined`);
    let inner = nonNullish.length === 1 ? nonNullish[0] : `${S}.Union([${nonNullish.join(', ')}])`;
    if (distinct.includes(`${S}.Null`)) inner = `${S}.NullOr(${inner})`;
    if (distinct.includes(`${S}.Undefined`)) inner = `${S}.UndefinedOr(${inner})`;
    return inner;
  };

  /** Type -> schema expression, or throws `Unmappable`. */
  const toSchema = (type, seen = new Set()) => {
    const f = type.flags;
    if (f & TypeFlags.Never) return `${S}.Never`;
    if (f & TypeFlags.Void) return `${S}.Void`;
    if (f & TypeFlags.Undefined) return `${S}.Undefined`;
    if (f & TypeFlags.Null) return `${S}.Null`;
    if (f & TypeFlags.String) return `${S}.String`;
    if (f & TypeFlags.Number) return `${S}.Number`;
    if (f & TypeFlags.Boolean) return `${S}.Boolean`;
    if (f & TypeFlags.BigInt) return `${S}.BigInt`;
    if (f & (TypeFlags.StringLiteral | TypeFlags.NumberLiteral | TypeFlags.BooleanLiteral))
      return `${S}.Literal(${checker.typeToString(type)})`;
    if (f & TypeFlags.Union) return unionSchema(type.getTypes(), seen);
    if (f & TypeFlags.Object) {
      const symbol = type.getSymbol();
      if (symbol !== undefined && isSchemaClass(symbol)) return importAlias(symbol);
      if (symbol?.name === 'Date') return `${S}.Date`;
      if (checker.isTupleType(type))
        return `${S}.Tuple([${checker
          .getTypeArguments(type)
          .map((t) => toSchema(t, seen))
          .join(', ')}])`;
      if (checker.isArrayType(type))
        return `${S}.Array(${toSchema(checker.getTypeArguments(type)[0], seen)})`;
      if (checker.getSignaturesOfType(type, 0).length > 0)
        throw new Unmappable(`a function (${checker.typeToString(type)}) cannot be sent`);
      if (symbol !== undefined && symbol.flags & SymbolFlags.Class)
        throw new Unmappable(
          `class ${symbol.name} is not a Schema class: its instances would arrive as plain objects`,
        );
      if (seen.has(type.id)) throw new Unmappable(`recursive type ${checker.typeToString(type)}`);
      const next = new Set(seen).add(type.id);
      const fields = checker.getPropertiesOfType(type).map((prop) => {
        const optional = (prop.flags & SymbolFlags.Optional) !== 0;
        let propType = checker.getTypeOfSymbol(prop);
        if (optional) propType = checker.getNonNullableType(propType);
        const schema = toSchema(propType, next);
        const key = /^[A-Za-z_$][\w$]*$/.test(prop.name) ? prop.name : JSON.stringify(prop.name);
        return `${key}: ${optional ? `${S}.optional(${schema})` : schema}`;
      });
      return `${S}.Struct({ ${fields.join(', ')} })`;
    }
    throw new Unmappable(`type ${checker.typeToString(type)} has no schema mapping`);
  };

  const edits = [];
  const report = [];
  const failures = [];
  const visit = (node) => {
    if (
      node.kind === SyntaxKind.CallExpression &&
      node.expression.kind === SyntaxKind.PropertyAccessExpression &&
      TERMINALS.has(node.expression.name.text) &&
      node.arguments.length === 1
    ) {
      const receiver = checker.getTypeAtLocation(node.expression.expression);
      const receiverName = receiver?.getSymbol()?.name ?? receiver?.getAliasSymbol()?.name;
      const isBuilder =
        receiverName === 'Builder' ||
        checker.typeToString(receiver).startsWith('{ readonly input:');
      if (isBuilder) {
        const where = `${path.relative(process.cwd(), file)}:${lineOf(text, node.expression.name.pos)}`;
        const steps = chainSteps(node);
        const handlerType = checker.getTypeAtLocation(node.arguments[0]);
        const signature = checker.getSignaturesOfType(handlerType, 0)[0];
        const returned = signature && checker.getReturnTypeOfSignature(signature);
        // `Effect<A, E, R>` / `Stream<A, E, R>`, or a union of them (`cond ? fail : succeed`).
        const results =
          returned === undefined
            ? []
            : returned.flags & TypeFlags.Union
              ? returned.getTypes()
              : [returned];
        const args = results.every(isReference)
          ? results.map((t) => checker.getTypeArguments(t))
          : [];
        const successes = args.map((a) => a[0]).filter((t) => t !== undefined);
        const failureTypes = args.map((a) => a[1]).filter((t) => t !== undefined);
        if (steps.includes('output') || steps.includes('inferred')) {
          // explicit chain: nothing to infer
        } else if (args.length === 0 || successes.length !== args.length) {
          failures.push(`${where}: cannot read the handler's Effect/Stream type`);
        } else {
          const parts = [];
          const summary = { where, kind: node.expression.name.text };
          const voidLike = TypeFlags.Void | TypeFlags.Undefined | TypeFlags.Never;
          const valued = successes.filter((t) => (t.flags & voidLike) === 0);
          if (valued.length > 0) {
            try {
              const schema = unionSchema(valued);
              parts.push(`output: ${schema}`);
              summary.output = schema;
            } catch (error) {
              if (!(error instanceof Unmappable)) throw error;
              failures.push(`${where}: ${error.message}; add an explicit .output(...)`);
            }
          }
          if (!steps.includes('error')) {
            const fromMiddleware = middlewareErrorSymbols(node);
            const members = [
              ...new Map(
                failureTypes
                  .flatMap((t) => (t.flags & TypeFlags.Union ? t.getTypes() : [t]))
                  .map((t) => [t.id, t]),
              ).values(),
            ];
            const typed = [];
            const defects = [];
            for (const member of members) {
              if (member.flags & TypeFlags.Never) continue;
              const symbol = member.getSymbol();
              if (symbol !== undefined && fromMiddleware.has(symbol.id)) continue;
              if (symbol !== undefined && isSchemaClass(symbol)) typed.push(importAlias(symbol));
              else defects.push(checker.typeToString(member));
            }
            if (typed.length > 0) {
              const schema = typed.length === 1 ? typed[0] : `${S}.Union([${typed.join(', ')}])`;
              parts.push(`error: ${schema}`);
              summary.error = schema;
            }
            if (defects.length > 0) summary.defects = defects;
          }
          const injected = parts.length === 0 ? '' : `.inferred({ ${parts.join(', ')} })`;
          // Insert right after the receiver, i.e. before `.query(` / `.mutation(` / `.subscription(`.
          if (injected !== '') edits.push({ at: node.expression.expression.end, text: injected });
          report.push(summary);
        }
      }
    }
    node.forEachChild((child) => {
      visit(child);
    });
  };
  visit(sourceFile);

  if (failures.length > 0) return { file, failures, report };

  let out = text;
  for (const edit of edits.toSorted((a, b) => b.at - a.at))
    out = out.slice(0, edit.at) + edit.text + out.slice(edit.at);
  const header = [
    `// GENERATED by packages/e2e/spike/infer-schemas/generate.mjs from ${path.basename(file)}. Do not edit.`,
    `import { Schema as ${S} } from 'effect';`,
    ...[...imports].map(([specifier, alias]) => `import * as ${alias} from '${specifier}';`),
    '',
  ].join('\n');
  const target = file.replace(/\.ts$/, '.gen.ts');
  writeFileSync(target, `${header}${out}`);
  return { file, target, failures, report };
};

let failed = false;
try {
  for (const file of files) {
    const result = generate(path.resolve(file));
    for (const entry of result.report) process.stdout.write(`${JSON.stringify(entry)}\n`);
    for (const failure of result.failures) console.error(`error: ${failure}`);
    if (result.failures.length > 0) failed = true;
    else process.stdout.write(`wrote ${path.relative(process.cwd(), result.target)}\n`);
  }
} finally {
  api.close();
}
process.stdout.write(`done in ${Math.round(performance.now() - started)} ms\n`);
process.exit(failed ? 1 : 0);
