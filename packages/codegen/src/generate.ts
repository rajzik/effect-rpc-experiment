/**
 * The schema generator: reads the routers of a TypeScript project with the TypeScript 7 checker
 * API and writes, next to each router module, the schemas inferred from its handlers.
 *
 * For `router.ts` it writes two modules:
 *
 * - `router.gen.ts` (server): `Router.withSchemas(AppRouter, { ... })` over the router module
 *   itself, with the inferred `output` / `error` schemas of every procedure written without
 *   `.output`. Serve this one (for a service source, a router service with the source's key: serve
 *   it with `Handlers.fromService`).
 * - `router.client.gen.ts` (client): the same contract as a schema-only router (`query({...})`
 *   definitions, no handlers, no import of the router module). Give this router to clients, so
 *   handler code and server-only imports stay out of client bundles. A compile-time check in it
 *   fails when it no longer matches the server router.
 *
 * A router service's `make` may be `Effect.succeed({...})`, `Effect.sync(() => ({...}))` or
 * `Effect.gen(function* () { ...; return {...} })` (it may read services); a schema must not
 * depend on a value declared in `make`. A service whose `make` yields no procedure, router or
 * router service is not a router and is skipped.
 *
 * @since 0.1.0
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  API,
  NodeBuilderFlags,
  ObjectFlags,
  SymbolFlags,
  TypeFlags,
} from 'typescript/unstable/sync';
import type {
  Checker,
  Program,
  Project,
  Symbol as TsSymbol,
  Type,
  TypeReference,
} from 'typescript/unstable/sync';
import {
  isArrowFunction,
  isCallExpression,
  isClassDeclaration,
  isFunctionExpression,
  isHeritageClause,
  isIdentifier,
  isImportClause,
  isImportDeclaration,
  isImportSpecifier,
  isNamespaceImport,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isShorthandPropertyAssignment,
  isSourceFile,
  isStringLiteral,
  isVariableDeclaration,
  isVariableStatement,
  SyntaxKind,
} from 'typescript/unstable/ast';
import type {
  CallExpression,
  ClassDeclaration,
  Expression,
  Node,
  ObjectLiteralExpression,
  SourceFile,
} from 'typescript/unstable/ast';

/**
 * Options of {@link generate} and {@link createGenerator}.
 *
 * @category models
 * @since 0.1.0
 */
export interface GenerateOptions {
  /** The `tsconfig.json` of the project that contains the routers. */
  readonly project: string;
  /** The router modules to generate for (paths, relative to `cwd`). */
  readonly routers: ReadonlyArray<string>;
  /** Base directory for relative paths (default: `process.cwd()`). */
  readonly cwd?: string | undefined;
  /** Write the generated modules (default `true`); `false` only returns them. */
  readonly write?: boolean | undefined;
}

/**
 * One generated module.
 *
 * @category models
 * @since 0.1.0
 */
export interface GeneratedFile {
  /** Absolute path of the module. */
  readonly path: string;
  /** Its full contents. */
  readonly content: string;
  /** Whether it differs from the file on disk (before writing). */
  readonly changed: boolean;
}

/**
 * What was inferred for one procedure.
 *
 * @category models
 * @since 0.1.0
 */
export interface ProcedureReport {
  /** `file:line` of the terminal (`.query` / `.mutation` / `.subscription`). */
  readonly where: string;
  /** The dot-joined path of the procedure in its router. */
  readonly path: string;
  /** The output schema expression, when inferred. */
  readonly output?: string | undefined;
  /** The error schema expression, when inferred. */
  readonly error?: string | undefined;
  /** Failures of the handler that are not schemas: they reach the client as `RpcDefect`. */
  readonly defects?: ReadonlyArray<string> | undefined;
}

/**
 * The result of a generator run.
 *
 * @category models
 * @since 0.1.0
 */
export interface GenerateResult {
  /** The generated modules (empty for a router module with errors). */
  readonly files: ReadonlyArray<GeneratedFile>;
  /** What was inferred, per procedure. */
  readonly procedures: ReadonlyArray<ProcedureReport>;
  /** Problems, each starting with `file:line:`. Modules with errors are not written. */
  readonly errors: ReadonlyArray<string>;
  /**
   * The project's own source files the run read (no `node_modules`, no generated modules): what a
   * bundler plugin watches so that editing a model module regenerates too.
   */
  readonly inputs: ReadonlyArray<string>;
}

/**
 * A generator that keeps the TypeScript checker running between runs (watch mode, bundler
 * plugins).
 *
 * @category models
 * @since 0.1.0
 */
export interface Generator {
  /** Re-reads the project and regenerates every router module. */
  readonly run: () => GenerateResult;
  /** Stops the checker process. */
  readonly close: () => void;
}

const S = '__Schema';
const TERMINALS = new Set(['query', 'mutation', 'subscription']);
const LEGACY = new Set(['query', 'mutation', 'subscription']);

class Unmappable extends Error {}

// --- The router model -------------------------------------------------------------------------

interface RecordNode {
  readonly kind: 'record';
  readonly entries: Array<readonly [string, EntryNode]>;
}
interface RouterNode {
  readonly kind: 'router';
  readonly record: RecordNode;
  readonly middlewares: ReadonlyArray<Expression>;
}
interface ProcNode {
  readonly kind: 'proc';
  readonly terminal: string;
  readonly call: CallExpression;
  readonly input: Expression | undefined;
  readonly output: Expression | undefined;
  readonly error: Expression | undefined;
  readonly inferred: boolean;
  readonly middlewares: ReadonlyArray<Expression>;
}
interface LegacyNode {
  readonly kind: 'legacy';
  readonly expression: Expression;
}
type EntryNode = RecordNode | RouterNode | ProcNode | LegacyNode;

interface FoundRouter {
  readonly name: string;
  readonly root: RouterNode;
}

/** An expression of the form `a.b(...)`, as a method name and its receiver. */
const asMethodCall = (
  node: Node,
):
  | { readonly name: string; readonly receiver: Expression; readonly call: CallExpression }
  | undefined => {
  if (!isCallExpression(node) || !isPropertyAccessExpression(node.expression)) return undefined;
  const name = node.expression.name;
  if (!isIdentifier(name)) return undefined;
  return { name: name.text, receiver: node.expression.expression, call: node };
};

const unwrap = (node: Expression): Expression =>
  isParenthesizedExpression(node) ? unwrap(node.expression) : node;

const isNamed = (node: Node, name: string): boolean => isIdentifier(node) && node.text === name;

/** `Router.make({...})` (the call, unwrapped). */
const asRouterMake = (node: Expression): ObjectLiteralExpression | undefined => {
  const call = asMethodCall(node);
  if (call === undefined || call.name !== 'make' || !isNamed(call.receiver, 'Router'))
    return undefined;
  const [arg] = call.call.arguments;
  const value = arg === undefined ? undefined : unwrap(arg);
  return value !== undefined && isObjectLiteralExpression(value) ? value : undefined;
};

/**
 * The record expression of a `make` of `Effect.succeed({...})`, `Effect.sync(() => ({...}))` or
 * `Effect.gen(function* () { ...; return {...} })` (the generator's last top-level `return`).
 */
const makeRecord = (make: Expression): Expression | undefined => {
  const call = asMethodCall(unwrap(make));
  if (call === undefined || !isNamed(call.receiver, 'Effect')) return undefined;
  const [arg] = call.call.arguments;
  if (arg === undefined) return undefined;
  if (call.name === 'succeed') return unwrap(arg);
  if (call.name === 'sync' && isArrowFunction(arg))
    return arg.body.kind === SyntaxKind.Block ? undefined : unwrap(arg.body);
  if (call.name === 'gen' && isFunctionExpression(arg) && arg.asteriskToken !== undefined) {
    const returned = arg.body.statements.findLast(isReturnStatement)?.expression;
    return returned === undefined ? undefined : unwrap(returned);
  }
  return undefined;
};

/** Whether a node is inside the `make` of a service class (a value declared in `make`). */
const isInMake = (node: Node): boolean => {
  let inMake = false;
  for (let n = node.parent; !isSourceFile(n); n = n.parent) {
    if (isPropertyAssignment(n) && isNamed(n.name, 'make')) inMake = true;
    else if (inMake && isHeritageClause(n)) return true;
  }
  return false;
};

/** The `make` of `class X extends Context.Service<X>()('X', { make }) {}`. */
const serviceMake = (decl: ClassDeclaration): Expression | undefined => {
  for (const clause of decl.heritageClauses ?? []) {
    for (const type of clause.types) {
      const call = unwrap(type.expression);
      if (!isCallExpression(call)) continue;
      for (const arg of call.arguments) {
        const options = unwrap(arg);
        if (!isObjectLiteralExpression(options)) continue;
        for (const prop of options.properties) {
          if (isPropertyAssignment(prop) && isNamed(prop.name, 'make')) return prop.initializer;
        }
      }
    }
  }
  return undefined;
};

const keyOf = (name: Node): string | undefined =>
  isIdentifier(name) || isStringLiteral(name) ? name.text : undefined;

// --- Generation -------------------------------------------------------------------------------

interface Ctx {
  readonly checker: Checker;
  readonly program: Program;
  readonly project: Project;
  readonly cwd: string;
}

const lineOf = (node: Node): number => {
  const sf = node.getSourceFile();
  return sf.text.slice(0, node.getStart(sf)).split('\n').length;
};

const where = (ctx: Ctx, node: Node): string =>
  `${path.relative(ctx.cwd, node.getSourceFile().fileName)}:${lineOf(node)}`;

/** Whether a class symbol's constructor is an Effect schema (it has a static `ast`). */
const isSchemaClass = (ctx: Ctx, symbol: TsSymbol): boolean => {
  if ((symbol.flags & SymbolFlags.Class) === 0) return false;
  const staticSide = ctx.checker.getTypeOfSymbol(symbol);
  return staticSide !== undefined && ctx.checker.getPropertyOfType(staticSide, 'ast') !== undefined;
};

/** `Effect<A, E, R>` / `Stream<A, E, R>` are type references: their arguments can be read. */
const isReference = (type: Type): type is TypeReference =>
  type.isObjectType() && (type.objectFlags & ObjectFlags.Reference) !== 0;

/** The members of a union, or the type itself. */
const membersOf = (type: Type): ReadonlyArray<Type> =>
  type.isUnionType() ? type.getTypes() : [type];

const isBool = (ctx: Ctx, type: Type): boolean =>
  /^(true|false)$/.test(ctx.checker.typeToString(type));

/** Imports of one generated module, keyed by module specifier. */
class Imports {
  private readonly named = new Map<string, Map<string, string>>(); // spec -> local -> imported
  private readonly typeNamed = new Map<string, Map<string, string>>();
  private readonly namespaces = new Map<string, string>(); // spec -> local
  private readonly defaults = new Map<string, string>();

  add(spec: string, imported: string, local: string, typeOnly = false): void {
    const table = typeOnly ? this.typeNamed : this.named;
    const entries = table.get(spec) ?? new Map<string, string>();
    entries.set(local, imported);
    table.set(spec, entries);
  }
  addNamespace(spec: string, local: string): void {
    this.namespaces.set(spec, local);
  }
  addDefault(spec: string, local: string): void {
    this.defaults.set(spec, local);
  }
  render(): string {
    const lines: Array<string> = [];
    const specs = new Set([
      ...this.named.keys(),
      ...this.typeNamed.keys(),
      ...this.namespaces.keys(),
      ...this.defaults.keys(),
    ]);
    for (const spec of [...specs].toSorted()) {
      const ns = this.namespaces.get(spec);
      if (ns !== undefined) lines.push(`import * as ${ns} from '${spec}';`);
      const def = this.defaults.get(spec);
      const named = [...(this.named.get(spec) ?? new Map<string, string>())]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([local, imported]) => (local === imported ? local : `${imported} as ${local}`));
      if (def !== undefined || named.length > 0) {
        const parts = [def, named.length > 0 ? `{ ${named.join(', ')} }` : undefined].filter(
          (p) => p !== undefined,
        );
        lines.push(`import ${parts.join(', ')} from '${spec}';`);
      }
      const typeNamed = [...(this.typeNamed.get(spec) ?? new Map<string, string>())]
        .filter(([local]) => !(this.named.get(spec)?.has(local) ?? false))
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([local, imported]) => (local === imported ? local : `${imported} as ${local}`));
      if (typeNamed.length > 0)
        lines.push(`import type { ${typeNamed.join(', ')} } from '${spec}';`);
    }
    return lines.join('\n');
  }
}

/** The extension style of a module's relative imports (`.ts`, `.js` or none). */
const extensionStyle = (sf: SourceFile): string => {
  for (const statement of sf.statements) {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue;
    const spec = statement.moduleSpecifier.text;
    if (!spec.startsWith('.')) continue;
    if (spec.endsWith('.ts') || spec.endsWith('.tsx')) return '.ts';
    if (spec.endsWith('.js') || spec.endsWith('.mjs')) return '.js';
    return '';
  }
  return '.js';
};

const relativeSpec = (fromDir: string, file: string, ext: string): string => {
  const noExt = file.replace(/\.(d\.)?[cm]?[jt]sx?$/, '');
  let spec = path.relative(fromDir, noExt).replaceAll(path.sep, '/');
  if (!spec.startsWith('.')) spec = `./${spec}`;
  return `${spec}${ext}`;
};

/** Where a symbol is imported from in `sf` (an existing import of the same declaration). */
const findImportOf = (
  ctx: Ctx,
  sf: SourceFile,
  target: TsSymbol,
): { readonly spec: string; readonly imported: string } | undefined => {
  for (const statement of sf.statements) {
    if (!isImportDeclaration(statement) || !isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || isNamespaceImport(bindings)) continue;
    for (const element of bindings.elements) {
      const local = ctx.checker.getSymbolAtLocation(element.name);
      if (local === undefined) continue;
      const aliased =
        (local.flags & SymbolFlags.Alias) !== 0 ? ctx.checker.getAliasedSymbol(local) : local;
      if (aliased.id === target.id) {
        const imported =
          element.propertyName !== undefined &&
          (isIdentifier(element.propertyName) || isStringLiteral(element.propertyName))
            ? element.propertyName.text
            : element.name.text;
        return { spec: statement.moduleSpecifier.text, imported };
      }
    }
  }
  return undefined;
};

interface ModuleGen {
  readonly ctx: Ctx;
  readonly routerFile: SourceFile;
  readonly outDir: string;
  readonly ext: string;
  readonly side: 'server' | 'client';
  readonly imports: Imports;
  readonly hoisted: Array<string>;
  readonly aliases: Map<number, string>;
  readonly counter: { next: number };
  readonly recursion: Map<number, { name: string; used: boolean; typeRef: string }>;
  /** Recursive types already hoisted (type id -> declaration name): each is declared once. */
  readonly hoistedNames: Map<number, string>;
  /** Type-only imports already added (symbol id -> local name). */
  readonly typeAliases: Map<number, string>;
}

const newModule = (ctx: Ctx, routerFile: SourceFile, side: 'server' | 'client'): ModuleGen => ({
  ctx,
  routerFile,
  outDir: path.dirname(routerFile.fileName),
  ext: extensionStyle(routerFile),
  side,
  imports: new Imports(),
  hoisted: [],
  aliases: new Map(),
  counter: { next: 0 },
  recursion: new Map(),
  hoistedNames: new Map(),
  typeAliases: new Map(),
});

/**
 * The package import of a symbol declared in another package (a workspace package or a
 * `node_modules` dependency), as the checker would write it in the router module: it follows
 * symlinks back to the package name, `exports` subpaths, barrels and tsconfig `paths`, exactly
 * like declaration emit. `undefined` when the checker names it relatively (same package) or not
 * at all.
 */
const packageImportOf = (
  gen: ModuleGen,
  symbol: TsSymbol,
): { readonly spec: string; readonly imported: string } | undefined => {
  const type = gen.ctx.checker.getDeclaredTypeOfSymbol(symbol);
  const text = gen.ctx.checker.typeToString(type, gen.routerFile, NodeBuilderFlags.NoTruncation);
  const match = /^import\("([^"]+)"\)\.([A-Za-z_$][\w$]*)(?:<.*)?$/s.exec(text);
  const spec = match?.[1];
  const imported = match?.[2];
  if (spec === undefined || imported === undefined) return undefined;
  if (spec.startsWith('.') || path.isAbsolute(spec)) return undefined;
  return { spec, imported };
};

/** A reference to a declared symbol (a schema class, or a named type) from the generated module. */
const importSymbol = (gen: ModuleGen, symbol: TsSymbol, typeOnly: boolean): string => {
  const cached = (typeOnly ? gen.typeAliases : gen.aliases).get(symbol.id);
  if (cached !== undefined) return cached;
  const local = `__i${gen.counter.next++}`;
  const found = findImportOf(gen.ctx, gen.routerFile, symbol);
  if (found !== undefined) {
    const spec = found.spec.startsWith('.')
      ? relativeSpec(
          gen.outDir,
          path.resolve(gen.outDir, found.spec),
          found.spec.match(/\.[cm]?[jt]sx?$/)?.[0] ?? '',
        )
      : found.spec;
    gen.imports.add(spec, found.imported, local, typeOnly);
  } else {
    const decl = symbol.valueDeclaration ?? symbol.declarations[0];
    const declFile = decl === undefined ? undefined : gen.ctx.program.getSourceFile(decl.path);
    if (declFile === undefined)
      throw new Unmappable(`cannot locate the declaration of ${symbol.name}`);
    const fromPackage = packageImportOf(gen, symbol);
    if (fromPackage !== undefined) {
      gen.imports.add(fromPackage.spec, fromPackage.imported, local, typeOnly);
      (typeOnly ? gen.typeAliases : gen.aliases).set(symbol.id, local);
      return local;
    }
    if (declFile.fileName.includes(`${path.sep}node_modules${path.sep}`))
      throw new Unmappable(
        `${symbol.name} is not exported by its package (no import path reaches it): import it in the router module`,
      );
    if (gen.side === 'client' && declFile.fileName === gen.routerFile.fileName)
      throw new Unmappable(
        `${symbol.name} is declared in the router module: move it to a module the client can import`,
      );
    const fileSymbol = gen.ctx.checker.getSymbolAtLocation(declFile);
    const exported =
      fileSymbol !== undefined &&
      gen.ctx.checker.getExportsOfModule(fileSymbol).some((s) => s.name === symbol.name);
    if (!exported)
      throw new Unmappable(
        `${symbol.name} is not exported from ${path.relative(gen.ctx.cwd, declFile.fileName)}`,
      );
    gen.imports.add(
      relativeSpec(gen.outDir, declFile.fileName, gen.ext),
      symbol.name,
      local,
      typeOnly,
    );
  }
  (typeOnly ? gen.typeAliases : gen.aliases).set(symbol.id, local);
  return local;
};

/** Members of a union -> schema (`boolean` collapsed, `null` / `undefined` as `NullOr` / `UndefinedOr`). */
const unionSchema = (gen: ModuleGen, members: ReadonlyArray<Type>): string => {
  const { checker } = gen.ctx;
  const flat = members.flatMap(membersOf);
  const unique = [...new Map(flat.map((m) => [m.id, m])).values()].filter(
    (m) => (m.flags & TypeFlags.Never) === 0,
  );
  if (unique.length === 0) return `${S}.Never`;
  const hasBoolean =
    unique.some((m) => checker.typeToString(m) === 'true') &&
    unique.some((m) => checker.typeToString(m) === 'false');
  const parts = unique
    .filter((m) => !(hasBoolean && isBool(gen.ctx, m)))
    .map((m) => toSchema(gen, m));
  if (hasBoolean) parts.push(`${S}.Boolean`);
  const distinct = [...new Set(parts)];
  const hasNull = distinct.includes(`${S}.Null`);
  const hasUndefined = distinct.includes(`${S}.Undefined`);
  const nonNullish = distinct.filter((p) => p !== `${S}.Null` && p !== `${S}.Undefined`);
  if (nonNullish.length === 0)
    return hasNull && hasUndefined
      ? `${S}.Union([${S}.Null, ${S}.Undefined])`
      : hasNull
        ? `${S}.Null`
        : `${S}.Undefined`;
  let inner =
    nonNullish.length === 1
      ? (nonNullish[0] ?? `${S}.Never`)
      : `${S}.Union([${nonNullish.join(', ')}])`;
  if (hasNull) inner = `${S}.NullOr(${inner})`;
  if (hasUndefined) inner = `${S}.UndefinedOr(${inner})`;
  return inner;
};

const GLOBAL_COLLECTIONS: Record<string, (args: ReadonlyArray<string>) => string> = {
  Date: () => `${S}.Date`,
  Map: ([k, v]) => `${S}.ReadonlyMap(${k}, ${v})`,
  ReadonlyMap: ([k, v]) => `${S}.ReadonlyMap(${k}, ${v})`,
  Set: ([v]) => `${S}.ReadonlySet(${v})`,
  ReadonlySet: ([v]) => `${S}.ReadonlySet(${v})`,
};

/** Type -> schema expression, or throws `Unmappable`. */
const toSchema = (gen: ModuleGen, type: Type): string => {
  const { checker } = gen.ctx;
  const f = type.flags;
  if (f & TypeFlags.Never) return `${S}.Never`;
  if (f & TypeFlags.Void) return `${S}.Void`;
  if (f & TypeFlags.Undefined) return `${S}.Undefined`;
  if (f & TypeFlags.Null) return `${S}.Null`;
  if (f & TypeFlags.String) return `${S}.String`;
  if (f & TypeFlags.Number) return `${S}.Number`;
  if (f & TypeFlags.Boolean) return `${S}.Boolean`;
  if (f & TypeFlags.BigInt) return `${S}.BigInt`;
  // An enum member is also a string / number literal type; its text (`Status.Active`) would
  // reference an enum the generated module does not import.
  if (f & TypeFlags.EnumLiteral || f & TypeFlags.Enum)
    throw new Unmappable(
      `the enum ${type.getSymbol()?.getParent()?.name ?? checker.typeToString(type)} has no schema mapping: add .output(Schema.Enum(...))`,
    );
  if (type.isStringLiteralType() || type.isNumberLiteralType())
    return `${S}.Literal(${JSON.stringify(type.value)})`;
  if (f & TypeFlags.BooleanLiteral) return `${S}.Literal(${checker.typeToString(type)})`;
  if (f & TypeFlags.TypeParameter)
    throw new Unmappable(
      `the type parameter ${checker.typeToString(type)} has no schema (make the handler concrete)`,
    );
  if (f & (TypeFlags.Any | TypeFlags.Unknown))
    throw new Unmappable(`${checker.typeToString(type)} has no schema`);
  if (type.isUnionType()) return unionSchema(gen, type.getTypes());
  if (f & TypeFlags.Object) {
    const symbol = type.getSymbol();
    if (symbol !== undefined && isSchemaClass(gen.ctx, symbol))
      return importSymbol(gen, symbol, false);
    const collection = symbol === undefined ? undefined : GLOBAL_COLLECTIONS[symbol.name];
    const isGlobal =
      symbol !== undefined &&
      (symbol.valueDeclaration ?? symbol.declarations[0]) !== undefined &&
      gen.ctx.program.isSourceFileDefaultLibrary(
        gen.ctx.program.getSourceFile(
          (symbol.valueDeclaration ?? symbol.declarations[0])?.path ?? '',
        ) ?? gen.routerFile,
      );
    if (collection !== undefined && isGlobal)
      return collection(
        (isReference(type) ? checker.getTypeArguments(type) : []).map((t) => toSchema(gen, t)),
      );
    if (isReference(type) && checker.isTupleType(type))
      return `${S}.Tuple([${checker
        .getTypeArguments(type)
        .map((t) => toSchema(gen, t))
        .join(', ')}])`;
    if (isReference(type) && checker.isArrayType(type)) {
      const element = checker.getTypeArguments(type)[0];
      if (element === undefined) throw new Unmappable(`array ${checker.typeToString(type)}`);
      const array = `${S}.Array(${toSchema(gen, element)})`;
      // `T[]` is mutable, `ReadonlyArray<T>` is not: keep the difference in the decoded type.
      return symbol?.name === 'Array' ? `${S}.mutable(${array})` : array;
    }
    if (checker.getSignaturesOfType(type, 0).length > 0)
      throw new Unmappable(`a function (${checker.typeToString(type)}) cannot be sent`);
    if (symbol !== undefined && symbol.flags & SymbolFlags.Class)
      throw new Unmappable(
        `class ${symbol.name} is not a Schema class: its instances would arrive as plain objects`,
      );
    return objectSchema(gen, type);
  }
  throw new Unmappable(`type ${checker.typeToString(type)} has no schema mapping`);
};

/** A plain object type: `Struct`, `Record`, or a hoisted recursive declaration. */
const objectSchema = (gen: ModuleGen, type: Type): string => {
  const { checker } = gen.ctx;
  const hoisted = gen.hoistedNames.get(type.id);
  if (hoisted !== undefined) return hoisted;
  const active = gen.recursion.get(type.id);
  if (active !== undefined) {
    active.used = true;
    return `${S}.suspend((): ${S}.Codec<${active.typeRef}, unknown> => ${active.name})`;
  }
  const named = type.getAliasSymbol() ?? type.getSymbol();
  const canName = named !== undefined && named.name !== '__type' && named.name !== '__object';
  const entry = {
    name: `__r${gen.counter.next++}`,
    used: false,
    // Only resolved if the type turns out to be recursive (see below).
    typeRef: '',
  };
  gen.recursion.set(type.id, entry);
  try {
    if (canName) entry.typeRef = `__T${type.id}`;
    const properties = checker.getPropertiesOfType(type);
    const indexes = checker.getIndexInfosOfType(type);
    let schema: string;
    if (properties.length === 0 && indexes.length === 1) {
      const [index] = indexes;
      if (index === undefined) throw new Unmappable('index signature');
      schema = `${S}.Record(${toSchema(gen, index.keyType)}, ${toSchema(gen, index.valueType)})`;
    } else if (indexes.length > 0) {
      throw new Unmappable(`${checker.typeToString(type)} mixes properties and an index signature`);
    } else {
      const fields = properties.map((prop) => {
        const optional = (prop.flags & SymbolFlags.Optional) !== 0;
        const propType = checker.getTypeOfSymbol(prop);
        if (propType === undefined) throw new Unmappable(`property ${prop.name}`);
        // `x?: T | null`: the `?` already allows `undefined`; keep `null` in the schema.
        const value = optional
          ? unionSchema(
              gen,
              membersOf(propType).filter((m) => (m.flags & TypeFlags.Undefined) === 0),
            )
          : toSchema(gen, propType);
        const key = /^[A-Za-z_$][\w$]*$/.test(prop.name) ? prop.name : JSON.stringify(prop.name);
        return `${key}: ${optional ? `${S}.optional(${value})` : value}`;
      });
      schema = `${S}.Struct({ ${fields.join(', ')} })`;
    }
    if (!entry.used) return schema;
    if (!canName || named === undefined)
      throw new Unmappable(
        `the recursive type ${checker.typeToString(type)} needs a name: declare it as an exported interface or type`,
      );
    const typeLocal = importSymbol(gen, named, true);
    const finalSchema = schema.replaceAll(
      `${S}.Codec<__T${type.id}, unknown>`,
      `${S}.Codec<${typeLocal}, unknown>`,
    );
    gen.hoisted.push(`const ${entry.name}: ${S}.Codec<${typeLocal}, unknown> = ${finalSchema};`);
    gen.hoistedNames.set(type.id, entry.name);
    return entry.name;
  } finally {
    gen.recursion.delete(type.id);
  }
};

/** Symbol ids of the error classes declared by the middleware of a procedure. */
const middlewareErrorSymbols = (ctx: Ctx, middlewares: ReadonlyArray<Expression>): Set<number> => {
  const ids = new Set<number>();
  for (const expr of middlewares) {
    const middleware = ctx.checker.getTypeAtLocation(expr);
    const errorProp = middleware && ctx.checker.getPropertyOfType(middleware, 'error');
    const errorSchema = errorProp && ctx.checker.getTypeOfSymbol(errorProp);
    const typeProp = errorSchema && ctx.checker.getPropertyOfType(errorSchema, 'Type');
    const errorType = typeProp && ctx.checker.getTypeOfSymbol(typeProp);
    if (errorType === undefined) continue;
    for (const member of membersOf(errorType)) {
      const symbol = member.getSymbol();
      if (symbol !== undefined) ids.add(symbol.id);
    }
  }
  return ids;
};

interface Inferred {
  readonly output?: string | undefined;
  readonly error?: string | undefined;
  readonly defects: ReadonlyArray<string>;
}

/** Reads a terminal's handler result and maps it to schemas. */
const inferProcedure = (
  gen: ModuleGen,
  proc: ProcNode,
  routerMiddlewares: ReadonlyArray<Expression>,
): Inferred => {
  const { checker } = gen.ctx;
  const handler = proc.call.arguments[0];
  if (handler === undefined) throw new Unmappable('the terminal has no handler');
  const handlerType = checker.getTypeAtLocation(handler);
  const signature = handlerType && checker.getSignaturesOfType(handlerType, 0)[0];
  const returned = signature && checker.getReturnTypeOfSignature(signature);
  // `Effect<A, E, R>` / `Stream<A, E, R>`, or a union of them (`cond ? fail : succeed`).
  const results = returned === undefined ? [] : membersOf(returned);
  const references = results.filter(isReference);
  if (results.length === 0 || references.length !== results.length)
    throw new Unmappable("cannot read the handler's Effect / Stream type");
  const args = references.map((t) => checker.getTypeArguments(t));
  const successes = args.map((a) => a[0]).filter((t) => t !== undefined);
  const failures = args.map((a) => a[1]).filter((t) => t !== undefined);
  const voidLike = TypeFlags.Void | TypeFlags.Undefined | TypeFlags.Never;
  const valued = successes.filter((t) => (t.flags & voidLike) === 0);
  const output =
    proc.output === undefined && valued.length > 0 ? unionSchema(gen, valued) : undefined;
  if (proc.error !== undefined) return { output, defects: [] };
  const fromMiddleware = middlewareErrorSymbols(gen.ctx, [
    ...proc.middlewares,
    ...routerMiddlewares,
  ]);
  const members = [...new Map(failures.flatMap(membersOf).map((t) => [t.id, t] as const)).values()];
  const typed: Array<string> = [];
  const defects: Array<string> = [];
  for (const member of members) {
    if (member.flags & TypeFlags.Never) continue;
    const symbol = member.getSymbol();
    if (symbol !== undefined && fromMiddleware.has(symbol.id)) continue;
    if (symbol !== undefined && isSchemaClass(gen.ctx, symbol))
      typed.push(importSymbol(gen, symbol, false));
    else defects.push(checker.typeToString(member));
  }
  const error =
    typed.length === 0
      ? undefined
      : typed.length === 1
        ? typed[0]
        : `${S}.Union([${typed.join(', ')}])`;
  return { output, error, defects };
};

// --- Reading the router structure ---------------------------------------------------------

/** Parses a builder chain ending at `node` (with `.middleware(...)` after the terminal). */
const asProcedure = (node: Expression): ProcNode | undefined => {
  const after: Array<Expression> = [];
  let top = unwrap(node);
  for (let m = asMethodCall(top); m?.name === 'middleware'; m = asMethodCall(top)) {
    const [arg] = m.call.arguments;
    if (arg !== undefined) after.unshift(arg);
    top = unwrap(m.receiver);
  }
  const terminal = asMethodCall(top);
  if (terminal === undefined || !TERMINALS.has(terminal.name)) return undefined;
  const steps: Array<{ readonly name: string; readonly arg: Expression | undefined }> = [];
  let base: Expression = terminal.receiver;
  for (let m = asMethodCall(base); m !== undefined; m = asMethodCall(base)) {
    steps.unshift({ name: m.name, arg: m.call.arguments[0] });
    base = m.receiver;
  }
  if (!isNamed(base, 'Procedure')) return undefined;
  const last = (name: string): Expression | undefined =>
    steps.findLast((s) => s.name === name)?.arg;
  const hasInferred = steps.some((s) => s.name === 'inferred');
  return {
    kind: 'proc',
    terminal: terminal.name,
    call: terminal.call,
    input: last('input'),
    output: last('output'),
    error: last('error'),
    inferred: !hasInferred && last('output') === undefined,
    middlewares: [
      ...steps
        .filter((s) => s.name === 'middleware')
        .flatMap((s) => (s.arg === undefined ? [] : [s.arg])),
      ...after,
    ],
  };
};

/** `query({...})` / `mutation(...)` / `subscription(...)` (optionally with `.middleware(...)`). */
const isLegacy = (node: Expression): boolean => {
  let top = unwrap(node);
  for (let m = asMethodCall(top); m?.name === 'middleware'; m = asMethodCall(top))
    top = unwrap(m.receiver);
  return isCallExpression(top) && isIdentifier(top.expression) && LEGACY.has(top.expression.text);
};

const readRecord = (
  ctx: Ctx,
  literal: ObjectLiteralExpression,
  errors: Array<string>,
): RecordNode => {
  const entries: Array<readonly [string, EntryNode]> = [];
  for (const prop of literal.properties) {
    let key: string | undefined;
    let value: Expression | undefined;
    if (isPropertyAssignment(prop)) {
      key = keyOf(prop.name);
      value = prop.initializer;
    } else if (isShorthandPropertyAssignment(prop) && isIdentifier(prop.name)) {
      key = prop.name.text;
      value = prop.name;
    }
    if (key === undefined || value === undefined) {
      errors.push(`${where(ctx, prop)}: unsupported router entry (use \`key: value\` properties)`);
      continue;
    }
    const entry = readEntry(ctx, value, errors);
    if (entry !== undefined) entries.push([key, entry]);
  }
  return { kind: 'record', entries };
};

/** `Router.make({...}).middleware(a).middleware(b)`. */
const asRouter = (ctx: Ctx, node: Expression, errors: Array<string>): RouterNode | undefined => {
  const middlewares: Array<Expression> = [];
  let top = unwrap(node);
  for (let m = asMethodCall(top); m?.name === 'middleware'; m = asMethodCall(top)) {
    const [arg] = m.call.arguments;
    if (arg !== undefined) middlewares.unshift(arg);
    top = unwrap(m.receiver);
  }
  const literal = asRouterMake(top);
  return literal === undefined
    ? undefined
    : { kind: 'router', record: readRecord(ctx, literal, errors), middlewares };
};

const ENTRY_BRANDS = ['~@effect-trpc/core/ProcedureDef', '~@effect-trpc/core/Router'];

/**
 * Whether a service's `make` (an `Effect`) yields a router record: one of its entries, in a nested
 * record too, is a procedure, a router or a router service. Other services are not routers.
 */
const yieldsRouter = (ctx: Ctx, make: Type | undefined, depth: number): boolean => {
  const record =
    make !== undefined && isReference(make) ? ctx.checker.getTypeArguments(make)[0] : undefined;
  return record !== undefined && isRouterRecord(ctx, record, depth);
};

const isRouterRecord = (ctx: Ctx, record: Type, depth: number): boolean =>
  depth < 8 &&
  ctx.checker.getPropertiesOfType(record).some((prop) => {
    const type = ctx.checker.getTypeOfSymbol(prop);
    if (type === undefined) return false;
    if (ENTRY_BRANDS.some((brand) => ctx.checker.getPropertyOfType(type, brand) !== undefined))
      return true;
    const make = ctx.checker.getPropertyOfType(type, 'make');
    if (make !== undefined) return yieldsRouter(ctx, ctx.checker.getTypeOfSymbol(make), depth + 1);
    return (
      type.isObjectType() &&
      ctx.checker.getSignaturesOfType(type, 0).length === 0 &&
      isRouterRecord(ctx, type, depth + 1)
    );
  });

/** The router a declaration defines (a router service class or a `Router.make` constant). */
const routerOfDeclaration = (
  ctx: Ctx,
  decl: Node,
  errors: Array<string>,
): RouterNode | undefined => {
  if (isClassDeclaration(decl)) {
    const make = serviceMake(decl);
    if (make === undefined || !yieldsRouter(ctx, ctx.checker.getTypeAtLocation(make), 0))
      return undefined;
    const record = makeRecord(make);
    if (record !== undefined && isObjectLiteralExpression(record))
      return { kind: 'router', record: readRecord(ctx, record, errors), middlewares: [] };
    errors.push(
      `${where(ctx, record ?? make)}: make must return an object literal for the generator to read it (Effect.succeed({...}), Effect.sync(() => ({...})) or Effect.gen ending in return {...})`,
    );
    return { kind: 'router', record: { kind: 'record', entries: [] }, middlewares: [] };
  }
  if (isVariableDeclaration(decl) && decl.initializer !== undefined)
    return asRouter(ctx, decl.initializer, errors);
  return undefined;
};

const declarationOf = (ctx: Ctx, identifier: Node): Node | undefined => {
  let symbol = ctx.checker.getSymbolAtLocation(identifier);
  if (symbol === undefined) return undefined;
  if (symbol.flags & SymbolFlags.Alias) symbol = ctx.checker.getAliasedSymbol(symbol);
  return (symbol.valueDeclaration ?? symbol.declarations[0])?.resolve(ctx.project);
};

const readEntry = (ctx: Ctx, value: Expression, errors: Array<string>): EntryNode | undefined => {
  const node = unwrap(value);
  if (isObjectLiteralExpression(node)) return readRecord(ctx, node, errors);
  const proc = asProcedure(node);
  if (proc !== undefined) return proc;
  if (isLegacy(node)) return { kind: 'legacy', expression: node };
  const router = asRouter(ctx, node, errors);
  if (router !== undefined) return router;
  if (isIdentifier(node)) {
    const decl = declarationOf(ctx, node);
    const nested = decl === undefined ? undefined : routerOfDeclaration(ctx, decl, errors);
    if (nested !== undefined) return nested;
  }
  errors.push(
    `${where(ctx, node)}: cannot read this router entry statically (use a Procedure chain, query({...}), Router.make({...}), a nested record or a router service)`,
  );
  return undefined;
};

/** The routers exported by a module. */
const findRouters = (ctx: Ctx, sf: SourceFile, errors: Array<string>): Array<FoundRouter> => {
  const fileSymbol = ctx.checker.getSymbolAtLocation(sf);
  if (fileSymbol === undefined) return [];
  const found: Array<FoundRouter> = [];
  for (const exported of ctx.checker.getExportsOfModule(fileSymbol)) {
    const decl = (exported.valueDeclaration ?? exported.declarations[0])?.resolve(ctx.project);
    if (decl === undefined || decl.getSourceFile().fileName !== sf.fileName) continue;
    const root = routerOfDeclaration(ctx, decl, errors);
    if (root !== undefined) found.push({ name: exported.name, root });
  }
  return found;
};

// --- Copying schema expressions for the client module -------------------------------------

/** Copies an expression of the router module into the client module, with what it references. */
const copyExpression = (gen: ModuleGen, expr: Node, copied: Map<string, string>): string => {
  const { checker } = gen.ctx;
  const sf = expr.getSourceFile();
  const start = expr.getStart(sf);
  const end = expr.end;
  const visit = (node: Node): void => {
    if (isPropertyAccessExpression(node)) {
      visit(node.expression);
      return;
    }
    if (isPropertyAssignment(node)) {
      visit(node.initializer);
      return;
    }
    if (isIdentifier(node)) {
      resolveIdentifier(node);
      return;
    }
    node.forEachChild((child) => {
      visit(child);
    });
  };
  const resolveIdentifier = (identifier: Node & { readonly text: string }): void => {
    const symbol = checker.getSymbolAtLocation(identifier);
    if (symbol === undefined) return;
    const decl = symbol.declarations[0]?.resolve(gen.ctx.project);
    if (decl === undefined) return;
    const declSf = decl.getSourceFile();
    if (
      gen.ctx.program.isSourceFileDefaultLibrary(declSf) ||
      gen.ctx.program.isSourceFileFromExternalLibrary(declSf)
    ) {
      if (!(symbol.flags & SymbolFlags.Alias)) return;
    }
    // Declared inside the copied expression (a parameter, a local): nothing to bring along.
    if (declSf.fileName === sf.fileName && decl.pos >= start && decl.end <= end) return;
    if (isInMake(decl))
      throw new Unmappable(
        `${identifier.text} is declared in make: schemas must not depend on values declared in make (declare the schema at module level)`,
      );
    if (isImportSpecifier(decl) || isImportClause(decl) || isNamespaceImport(decl)) {
      let importDecl: Node = decl;
      while (!isImportDeclaration(importDecl)) importDecl = importDecl.parent;
      if (!isStringLiteral(importDecl.moduleSpecifier)) return;
      const spec0 = importDecl.moduleSpecifier.text;
      const spec = spec0.startsWith('.')
        ? relativeSpec(
            gen.outDir,
            path.resolve(path.dirname(declSf.fileName), spec0),
            spec0.match(/\.[cm]?[jt]sx?$/)?.[0] ?? '',
          )
        : spec0;
      const routerSpecs = new Set([gen.routerFile.fileName]);
      if (
        spec0.startsWith('.') &&
        routerSpecs.has(
          path.resolve(path.dirname(declSf.fileName), spec0).replace(/\.[cm]?[jt]sx?$/, '.ts'),
        )
      )
        throw new Unmappable(
          `${identifier.text} comes from the router module: move it to a module the client can import`,
        );
      if (isNamespaceImport(decl)) gen.imports.addNamespace(spec, identifier.text);
      else if (isImportClause(decl)) gen.imports.addDefault(spec, identifier.text);
      else {
        const imported =
          decl.propertyName !== undefined &&
          (isIdentifier(decl.propertyName) || isStringLiteral(decl.propertyName))
            ? decl.propertyName.text
            : decl.name.text;
        gen.imports.add(spec, imported, identifier.text);
      }
      return;
    }
    if (
      isVariableDeclaration(decl) &&
      isVariableStatement(decl.parent.parent) &&
      decl.initializer !== undefined
    ) {
      if (copied.has(identifier.text)) return;
      copied.set(identifier.text, ''); // reserve (cycles)
      const text = copyExpression(gen, decl.initializer, copied);
      copied.set(identifier.text, `const ${identifier.text} = ${text};`);
      return;
    }
    if (isClassDeclaration(decl))
      throw new Unmappable(
        `${identifier.text} is a class declared next to the router: move it to a module the client can import`,
      );
    throw new Unmappable(`cannot copy ${identifier.text} into the client module`);
  };
  visit(expr);
  return sf.text.slice(start, end);
};

// --- Emitting -----------------------------------------------------------------------------

const HEADER = (source: string): string =>
  `// GENERATED by @effect-trpc/codegen from ${source}. Do not edit: regenerate with \`effect-trpc-codegen\`.\n`;

interface Emitted {
  readonly server: string;
  readonly client: string;
  readonly reports: Array<ProcedureReport>;
}

const indent = (depth: number): string => '  '.repeat(depth);

const emitModules = (
  ctx: Ctx,
  sf: SourceFile,
  routers: ReadonlyArray<FoundRouter>,
  errors: Array<string>,
): Emitted | undefined => {
  const server = newModule(ctx, sf, 'server');
  const client = newModule(ctx, sf, 'client');
  const reports: Array<ProcedureReport> = [];
  const copied = new Map<string, string>();
  const startErrors = errors.length;

  const fail = (node: Node, error: unknown): void => {
    if (!(error instanceof Unmappable)) throw error;
    errors.push(`${where(ctx, node)}: ${error.message}`);
  };

  /** Server: the `{ output?, error? }` tree of the inferred procedures (or `undefined`). */
  const schemaTree = (
    node: RecordNode,
    routerMiddlewares: ReadonlyArray<Expression>,
    prefix: string,
    depth: number,
  ): string | undefined => {
    const parts: Array<string> = [];
    for (const [key, entry] of node.entries) {
      const k = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
      if (entry.kind === 'proc') {
        if (!entry.inferred) continue;
        try {
          const inferred = inferProcedure(server, entry, routerMiddlewares);
          reports.push({
            where: where(ctx, entry.call),
            path: `${prefix}${key}`,
            output: inferred.output,
            error: inferred.error,
            defects: inferred.defects.length > 0 ? inferred.defects : undefined,
          });
          const fields = [
            inferred.output === undefined ? undefined : `output: ${inferred.output}`,
            inferred.error === undefined ? undefined : `error: ${inferred.error}`,
          ].filter((p) => p !== undefined);
          if (fields.length > 0) parts.push(`${indent(depth)}${k}: { ${fields.join(', ')} },`);
        } catch (error) {
          fail(entry.call, error);
        }
      } else if (entry.kind === 'record' || entry.kind === 'router') {
        const record = entry.kind === 'record' ? entry : entry.record;
        const mws =
          entry.kind === 'router'
            ? [...routerMiddlewares, ...entry.middlewares]
            : routerMiddlewares;
        const sub = schemaTree(record, mws, `${prefix}${key}.`, depth + 1);
        if (sub !== undefined) parts.push(`${indent(depth)}${k}: ${sub},`);
      }
    }
    return parts.length === 0 ? undefined : `{\n${parts.join('\n')}\n${indent(depth - 1)}}`;
  };

  /** Client: the schema-only record. */
  const clientRecord = (
    node: RecordNode,
    routerMiddlewares: ReadonlyArray<Expression>,
    depth: number,
  ): string => {
    const parts: Array<string> = [];
    for (const [key, entry] of node.entries) {
      const k = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
      try {
        parts.push(`${indent(depth)}${k}: ${clientEntry(entry, routerMiddlewares, depth)},`);
      } catch (error) {
        fail(
          entry.kind === 'proc' ? entry.call : entry.kind === 'legacy' ? entry.expression : sf,
          error,
        );
      }
    }
    return `{\n${parts.join('\n')}\n${indent(depth - 1)}}`;
  };

  const clientEntry = (
    entry: EntryNode,
    routerMiddlewares: ReadonlyArray<Expression>,
    depth: number,
  ): string => {
    switch (entry.kind) {
      case 'legacy':
        return copyExpression(client, entry.expression, copied);
      case 'record':
        return clientRecord(entry, routerMiddlewares, depth + 1);
      case 'router': {
        const record = clientRecord(
          entry.record,
          [...routerMiddlewares, ...entry.middlewares],
          depth + 1,
        );
        const mws = entry.middlewares
          .map((m) => `.middleware(${copyExpression(client, m, copied)})`)
          .join('');
        return mws === '' ? record : `__Router.make(${record})${mws}`;
      }
      case 'proc': {
        const inferred = entry.inferred
          ? inferProcedure(client, entry, routerMiddlewares)
          : undefined;
        const payload =
          entry.input === undefined ? undefined : copyExpression(client, entry.input, copied);
        const success =
          entry.output !== undefined
            ? copyExpression(client, entry.output, copied)
            : (inferred?.output ?? inferredOutputOf(entry));
        const error =
          entry.error !== undefined
            ? copyExpression(client, entry.error, copied)
            : (inferred?.error ?? inferredErrorOf(entry));
        if (entry.terminal === 'subscription' && success === undefined)
          throw new Unmappable(
            'a subscription needs an element schema (its handler produces no value)',
          );
        const options = [
          payload === undefined ? undefined : `payload: ${payload}`,
          success === undefined ? undefined : `success: ${success}`,
          error === undefined ? undefined : `error: ${error}`,
        ].filter((p) => p !== undefined);
        client.imports.add('@effect-trpc/core', entry.terminal, `__${entry.terminal}`);
        const call = `__${entry.terminal}(${options.length === 0 ? '' : `{ ${options.join(', ')} }`})`;
        return (
          call +
          entry.middlewares.map((m) => `.middleware(${copyExpression(client, m, copied)})`).join('')
        );
      }
    }
    throw new Unmappable('unsupported router entry');
  };

  /** A chain with `.inferred({...})` already written (by hand): copy that schema. */
  const inferredStep = (entry: ProcNode, field: 'output' | 'error'): string | undefined => {
    const terminal = asMethodCall(entry.call);
    for (
      let m = terminal && asMethodCall(terminal.receiver);
      m !== undefined;
      m = asMethodCall(m.receiver)
    ) {
      if (m.name !== 'inferred') continue;
      const [arg] = m.call.arguments;
      const literal = arg === undefined ? undefined : unwrap(arg);
      if (literal === undefined || !isObjectLiteralExpression(literal)) return undefined;
      for (const prop of literal.properties)
        if (isPropertyAssignment(prop) && keyOf(prop.name) === field)
          return copyExpression(client, prop.initializer, copied);
      return undefined;
    }
    return undefined;
  };
  const inferredOutputOf = (entry: ProcNode): string | undefined => inferredStep(entry, 'output');
  const inferredErrorOf = (entry: ProcNode): string | undefined => inferredStep(entry, 'error');

  const serverExports: Array<string> = [];
  const clientExports: Array<string> = [];
  const sourceSpec = relativeSpec(server.outDir, sf.fileName, server.ext);
  for (const router of routers) {
    const tree = schemaTree(router.root.record, router.root.middlewares, '', 1) ?? '{}';
    server.imports.add(sourceSpec, router.name, `__source_${router.name}`);
    serverExports.push(
      `export const ${router.name} = __Router.withSchemas(__source_${router.name}, ${tree});`,
    );
    const record = clientRecord(router.root.record, router.root.middlewares, 1);
    const mws = router.root.middlewares
      .map((m) => `.middleware(${copyExpression(client, m, copied)})`)
      .join('');
    clientExports.push(`export const ${router.name} = __Router.make(${record})${mws};`);
  }
  if (errors.length > startErrors) return undefined;

  const base = path.basename(sf.fileName).replace(/\.[cm]?tsx?$/, '');
  const serverSpec = `./${base}.gen${server.ext}`;
  for (const gen of [server, client]) {
    gen.imports.add('@effect-trpc/core', 'Router', '__Router');
    gen.imports.add('effect', 'Schema', S);
  }
  for (const router of routers)
    client.imports.add(serverSpec, router.name, `__Server_${router.name}`, true);
  const contract = [
    'type __Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;',
    ...routers.map(
      (r) =>
        `/** Compile-time check: the client contract of \`${r.name}\` matches the server router. */\nexport const __contract_${r.name}: __Equals<__Router.Rpcs<typeof ${r.name}>, __Router.Rpcs<typeof __Server_${r.name}>> extends true\n  ? 'up to date'\n  : '${base}.client.gen.ts is out of date: run effect-trpc-codegen' = 'up to date';`,
    ),
  ];
  const source = `./${path.basename(sf.fileName)}`;
  const serverText = [
    HEADER(source) +
      '// The server router: serve this one (router services with `Handlers.fromService`); it imports the router module once, no copy.',
    server.imports.render(),
    '',
    ...server.hoisted,
    ...(server.hoisted.length > 0 ? [''] : []),
    ...serverExports,
    '',
  ].join('\n');
  const clientText = [
    HEADER(source) +
      '// The client contract: schemas only, no handlers and no import of the router module.',
    client.imports.render(),
    '',
    ...[...copied.values()].filter((v) => v !== ''),
    ...client.hoisted,
    ...(copied.size + client.hoisted.length > 0 ? [''] : []),
    ...clientExports,
    '',
    ...contract,
    '',
  ].join('\n');
  return { server: serverText, client: clientText, reports };
};

// --- Driver -------------------------------------------------------------------------------

/**
 * Starts the TypeScript checker for a project and returns a {@link Generator} that regenerates
 * the schema modules of the given routers on every `run()`.
 *
 * **When to use**
 *
 * In watch mode and bundler plugins, where the checker should stay warm between runs. For a
 * single run use {@link generate}.
 *
 * **Details**
 *
 * - Each `run()` re-reads the project, so it sees edits made since the previous run.
 * - Modules are written only when their content changes; a router module with errors is not
 *   written (its previous output is kept) and its problems are in `errors`.
 *
 * **Gotchas**
 *
 * - Call `close()` when done: the checker is a child process.
 *
 * **Example** (Regenerating on demand)
 *
 * ```ts
 * import { createGenerator } from '@effect-trpc/codegen';
 *
 * const generator = createGenerator({ project: 'tsconfig.json', routers: ['src/router.ts'] });
 * const { errors } = generator.run();
 * if (errors.length > 0) console.error(errors.join('\n'));
 * generator.close();
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const createGenerator = (options: GenerateOptions): Generator => {
  const cwd = options.cwd ?? process.cwd();
  const tsconfig = path.resolve(cwd, options.project);
  const routers = options.routers.map((r) => path.resolve(cwd, r));
  const api = new API({ cwd: path.dirname(tsconfig) });
  let first = true;
  const run = (): GenerateResult => {
    const snapshot = api.updateSnapshot(
      first
        ? { openProjects: [tsconfig] }
        : { openProjects: [tsconfig], fileChanges: { invalidateAll: true } },
    );
    first = false;
    const project = snapshot.getProject(tsconfig) ?? snapshot.getProjects()[0];
    if (project === undefined)
      return {
        files: [],
        procedures: [],
        errors: [`${tsconfig}: no TypeScript project`],
        inputs: [],
      };
    const ctx: Ctx = { checker: project.checker, program: project.program, project, cwd };
    const files: Array<GeneratedFile> = [];
    const procedures: Array<ProcedureReport> = [];
    const errors: Array<string> = [];
    for (const file of routers) {
      const sf = project.program.getSourceFile(file);
      if (sf === undefined) {
        errors.push(`${path.relative(cwd, file)}: not part of ${path.relative(cwd, tsconfig)}`);
        continue;
      }
      const fileErrors: Array<string> = [];
      const found = findRouters(ctx, sf, fileErrors);
      if (found.length === 0 && fileErrors.length === 0)
        fileErrors.push(
          `${path.relative(cwd, file)}: exports no router (a router service class or a Router.make constant)`,
        );
      const emitted = fileErrors.length === 0 ? emitModules(ctx, sf, found, fileErrors) : undefined;
      errors.push(...fileErrors);
      if (emitted === undefined) continue;
      procedures.push(...emitted.reports);
      const base = file.replace(/\.[cm]?tsx?$/, '');
      for (const [target, content] of [
        [`${base}.gen.ts`, emitted.server],
        [`${base}.client.gen.ts`, emitted.client],
      ] as const) {
        const changed = !existsSync(target) || readFileSync(target, 'utf8') !== content;
        files.push({ path: target, content, changed });
        if (changed && options.write !== false) writeFileSync(target, content);
      }
    }
    const inputs = project.program
      .getSourceFileNames()
      .filter(
        (name) =>
          !name.includes(`${path.sep}node_modules${path.sep}`) &&
          !name.endsWith('.gen.ts') &&
          !/\.d\.[cm]?ts$/.test(name),
      );
    return { files, procedures, errors, inputs };
  };
  return { run, close: () => api.close() };
};

/**
 * Generates the schema modules of the given routers once: `router.gen.ts` (the server router,
 * `Router.withSchemas` over the router module) and `router.client.gen.ts` (the schema-only
 * client contract) next to each router module.
 *
 * **When to use**
 *
 * For routers written with the `Procedure` builder without `.output` / `.error`: run it after
 * changing a router (or use the CLI's `--watch`, or the Vite plugin), then serve `router.gen.ts`
 * and give `router.client.gen.ts` to clients.
 *
 * **Details**
 *
 * - Output types map structurally: primitives, literals, `Date`, arrays (`T[]` as
 *   `Schema.mutable(Schema.Array(...))`), tuples, plain object types, `Record<K, V>`,
 *   `Map` / `Set` (as `ReadonlyMap` / `ReadonlySet`), `bigint`, unions, recursive named types
 *   (`Schema.suspend`), and Schema classes, which are imported from their declaring module.
 * - Error members that are Schema classes become the error schema; other failures (e.g. a
 *   `Data.TaggedError`) are reported as defects and reach the client as `RpcDefect`. Errors the
 *   procedure's middleware declares are not repeated.
 * - Explicit chains (`.output(...)`) and `query({...})` definitions are not inferred; the client
 *   module copies their schema expressions.
 *
 * **Gotchas**
 *
 * - A type with no schema (a plain class, a function, a type parameter) is an error with its
 *   location: add `.output(schema)` to that procedure.
 * - The client module imports what the copied schema expressions reference: keep schemas and
 *   middleware tags in modules the client can import (not in the router module itself).
 *
 * **Example** (One run)
 *
 * ```ts
 * import { generate } from '@effect-trpc/codegen';
 *
 * const result = generate({ project: 'tsconfig.json', routers: ['src/router.ts'] });
 * for (const file of result.files) console.log(file.changed ? 'wrote' : 'unchanged', file.path);
 * if (result.errors.length > 0) process.exitCode = 1;
 * ```
 *
 * @category constructors
 * @since 0.1.0
 */
export const generate = (options: GenerateOptions): GenerateResult => {
  const generator = createGenerator(options);
  try {
    return generator.run();
  } finally {
    generator.close();
  }
};
