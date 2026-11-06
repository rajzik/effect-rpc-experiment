// The generator end to end: generate for the fixture app, type-check the result (including the
// client contract check), serve the server module and call it through the client module.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Effect, Layer, Stream } from 'effect';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { RpcDefect } from '@effect-trpc/core';
import { createClient, httpLink } from '@effect-trpc/client';
import type { Client } from '@effect-trpc/client';
import { Handlers, toWebHandler } from '@effect-trpc/server';
import type { WebHandler } from '@effect-trpc/server';
import { generate } from '../src/index.js';
import type { GenerateResult } from '../src/index.js';
import { copyFixture, fixtureDir, removeDir, typeCheck } from './helpers.js';
import { AppRouter as ClientRouter } from './fixtures/app/router.client.gen.js';
import { AppRouter as ServerRouter } from './fixtures/app/router.gen.js';
import { Auth, Forbidden, Log, Post, PostNotFound, Unauthorized } from './fixtures/app/models.js';
import { AppRouter as EffectfulClient } from './fixtures/effectful/router.client.gen.js';
import { AppRouter as EffectfulServer } from './fixtures/effectful/router.gen.js';
import { Database } from './fixtures/effectful/db.js';
import {
  Post as EffectfulPost,
  PostNotFound as EffectfulNotFound,
} from './fixtures/effectful/models.js';

const failure = (promise: Promise<unknown>): Promise<unknown> => promise.catch((e: unknown) => e);

let dir: string;
let result: GenerateResult;
const read = (file: string): string => readFileSync(path.join(dir, file), 'utf8');

beforeAll(() => {
  dir = copyFixture('app');
  result = generate({
    project: path.join(dir, 'tsconfig.json'),
    routers: [path.join(dir, 'router.ts')],
  });
});
afterAll(() => {
  removeDir(dir);
});

describe('generate', () => {
  it('writes the server and client modules with no errors', () => {
    expect(result.errors).toEqual([]);
    expect(result.files.map((f) => path.basename(f.path))).toEqual([
      'router.gen.ts',
      'router.client.gen.ts',
    ]);
  });

  it('reports what it inferred, including defects', () => {
    const byPath = new Map(result.procedures.map((p) => [p.path, p]));
    expect(byPath.get('post.byId')).toMatchObject({ output: '__i0', error: '__i1' });
    expect(byPath.get('post.create')?.defects).toEqual(['DbError']);
    expect(byPath.get('post.count')).toBeUndefined(); // explicit
    expect(byPath.get('data.ping')).toMatchObject({ output: undefined, error: undefined });
    expect(byPath.get('admin.count')?.output).toBe('__Schema.Number');
    expect(byPath.get('post.byId')?.where).toMatch(/router\.ts:\d+$/);
  });

  it('the server module overlays the router module instead of copying it', () => {
    const server = read('router.gen.ts');
    expect(server).toContain("from './router.js'");
    expect(server).toContain('__Router.withSchemas(__source_AppRouter');
    expect(server).not.toContain('db.posts');
  });

  it('the client module has no handlers and imports neither the router nor server-only modules', () => {
    const client = read('router.client.gen.ts');
    expect(client).not.toMatch(/from '\.\/(router|db|admin)(\.js)?'/);
    expect(client).not.toContain('db.');
    expect(client).not.toContain('Effect.succeed');
    expect(client).toContain('const PostById = Schema.Struct({ id: Schema.Finite });');
    expect(client).toContain('.middleware(Auth)');
    expect(client).toContain('.middleware(Log)');
  });

  it('type-checks, including the client contract check against the server router', () => {
    expect(typeCheck(dir)).toBe('');
  });

  it('is stable: a second run changes nothing', () => {
    const again = generate({
      project: path.join(dir, 'tsconfig.json'),
      routers: [path.join(dir, 'router.ts')],
      write: false,
    });
    expect(again.files.every((f) => !f.changed)).toBe(true);
  });

  it('the committed fixture output is up to date', () => {
    const fresh = generate({
      project: path.join(fixtureDir('app'), 'tsconfig.json'),
      routers: [path.join(fixtureDir('app'), 'router.ts')],
      write: false,
    });
    expect(fresh.errors).toEqual([]);
    expect(fresh.files.filter((f) => f.changed).map((f) => f.path)).toEqual([]);
  });
});

describe('generated modules at runtime (the committed fixture output)', () => {
  let web: WebHandler;
  let client: Client<typeof ClientRouter>;
  beforeAll(async () => {
    const AuthLive = Layer.succeed(Auth)(
      Auth.of((effect, { headers }) =>
        headers['authorization'] === 'yes' ? effect : Effect.fail(new Unauthorized()),
      ),
    );
    const LogLive = Layer.succeed(Log)(Log.of((effect) => effect));
    web = await toWebHandler(ServerRouter, {
      handlers: Handlers.fromService(ServerRouter).pipe(
        Layer.provideMerge(Layer.mergeAll(AuthLive, LogLive)),
      ),
    });
    client = createClient(ClientRouter, {
      link: httpLink({
        url: 'http://localhost/rpc',
        fetch: (input, init) => web.handler(new Request(input, init)),
      }),
    });
  });
  afterAll(async () => {
    await client.dispose();
    await web.dispose();
  });

  it('decodes Schema classes, typed errors and literals', async () => {
    expect(await client.health()).toBe('ok');
    const post = await client.post.byId({ id: 1 });
    expect(post).toBeInstanceOf(Post);
    expect(post.slug).toBe('hello-effect');
    expect(await failure(client.post.byId({ id: 9 }))).toBeInstanceOf(PostNotFound);
    expect(await client.post.first()).toBeInstanceOf(Post);
    expect(await client.post.count()).toBe(2);
  });

  it('typed errors, middleware errors and defects', async () => {
    const authed = client.withHeaders({ authorization: 'yes' });
    expect(await failure(client.post.create({ title: 'x' }))).toBeInstanceOf(Unauthorized);
    expect(await failure(authed.post.create({ title: '' }))).toBeInstanceOf(Forbidden);
    expect(await failure(authed.post.create({ title: 'nope' }))).toBeInstanceOf(Unauthorized);
    expect(await failure(authed.post.create({ title: 'db' }))).toBeInstanceOf(RpcDefect);
    expect(await authed.post.create({ title: 'New post' })).toBeInstanceOf(Post);
  });

  it('recursive types, bigint, Set, Map, Record, Date | undefined, arrays', async () => {
    expect(await client.data.tree()).toEqual({ value: 1, children: [{ value: 2, children: [] }] });
    const stats = await client.data.stats();
    expect(stats.total).toBe(2n);
    expect(stats.tags).toEqual(new Set(['effect']));
    expect(stats.byAuthor).toEqual(new Map([['ada', 2]]));
    expect(stats.counts).toEqual({ drafts: 1 });
    expect(stats.latest).toBeInstanceOf(Date);
    expect(stats.titles).toEqual(['Hello Effect', 'Typed errors']);
    expect(await client.data.ping()).toBeUndefined();
    expect(await client.data.forest()).toEqual([
      { value: 1, children: [{ value: 2, children: [] }] },
    ]);
    expect(await client.data.thread()).toEqual({
      text: 'root',
      replies: [{ text: 'reply', replies: [] }],
    });
    expect(await client.data.archive()).toEqual({ archivedAt: null, note: 'it\'s "quoted"' });
  });

  it('nested services, router-level middleware and subscriptions', async () => {
    expect(await client.admin.count()).toBe(2);
    expect(await client.logged.ping()).toBe('pong');
    const items = await Effect.runPromise(Stream.runCollect(client.$effect.post.onCreated()));
    expect(Array.from(items).every((p) => p instanceof Post)).toBe(true);
  });
});

describe('router services whose make is Effect.gen', () => {
  let effectful: string;
  let out: GenerateResult;
  const readOut = (file: string): string => readFileSync(path.join(effectful, file), 'utf8');
  beforeAll(() => {
    effectful = copyFixture('effectful');
    out = generate({
      project: path.join(effectful, 'tsconfig.json'),
      routers: [path.join(effectful, 'router.ts')],
    });
  });
  afterAll(() => {
    removeDir(effectful);
  });

  it('reads the record the generator returns', () => {
    expect(out.errors).toEqual([]);
    const client = readOut('router.client.gen.ts');
    expect(client).toContain(
      [
        'export const PostRouter = __Router.make({',
        '  byId: __query({ payload: { id: Schema.Finite }, success: __i0, error: __i1 }),',
        '});',
      ].join('\n'),
    );
    expect(client).toMatch(
      /import \{ Post as __i0, PostNotFound as __i1 \} from '\.\/models\.js';/,
    );
    expect(client).not.toMatch(/from '\.\/(router|db)(\.js)?'/);
    expect(client).not.toContain('yield*');
    const server = readOut('router.gen.ts');
    expect(server).toContain(
      'export const PostRouter = __Router.withSchemas(__source_PostRouter, {\n  byId: { output: __i0, error: __i1 },\n});',
    );
  });

  it('skips an ordinary Effect.gen service exported next to the routers', () => {
    expect(out.errors).toEqual([]);
    expect(readOut('router.gen.ts')).not.toContain('Cache');
    expect(readOut('router.client.gen.ts')).not.toContain('Cache');
  });

  it('inlines a nested effectful service into the client record', () => {
    expect(readOut('router.client.gen.ts')).toContain(
      [
        'export const AppRouter = __Router.make({',
        '  count: __query({ success: __Schema.Number }),',
        '  post: {',
        '    byId: __query({ payload: { id: Schema.Finite }, success: __i0, error: __i1 }),',
        '  },',
        '});',
      ].join('\n'),
    );
  });

  it('type-checks, including the client contract check against the lazy server service', () => {
    expect(typeCheck(effectful)).toBe('');
  });

  it('the committed fixture output is up to date', () => {
    const fresh = generate({
      project: path.join(fixtureDir('effectful'), 'tsconfig.json'),
      routers: [path.join(fixtureDir('effectful'), 'router.ts')],
      write: false,
    });
    expect(fresh.errors).toEqual([]);
    expect(fresh.files.filter((f) => f.changed).map((f) => f.path)).toEqual([]);
  });

  it('the contract check fails when only the server procedure gains a middleware', () => {
    const drifted = copyFixture('effectful');
    try {
      generate({
        project: path.join(drifted, 'tsconfig.json'),
        routers: [path.join(drifted, 'router.ts')],
      });
      const file = path.join(drifted, 'router.ts');
      writeFileSync(
        file,
        readFileSync(file, 'utf8')
          .replace(
            "import { Database } from './db.js';",
            "import { Database } from './db.js';\nimport { Auth } from './models.js';",
          )
          .replace(
            '.query(({ id }) => db.find(id))',
            '.middleware(Auth).query(({ id }) => db.find(id))',
          ),
      );
      expect(typeCheck(drifted)).toMatch(
        /router\.client\.gen\.ts is out of date: run effect-trpc-codegen/,
      );
    } finally {
      removeDir(drifted);
    }
  });

  it('serves the generated server module with Handlers.fromService and the contract', async () => {
    const DatabaseLive = Layer.succeed(Database)(
      Database.of({
        find: (id) =>
          id === 1
            ? Effect.succeed(new EffectfulPost({ id, title: 'Hello' }))
            : Effect.fail(new EffectfulNotFound({ id })),
        count: Effect.succeed(1),
      }),
    );
    const web = await toWebHandler(EffectfulClient, {
      handlers: Handlers.fromService(EffectfulServer).pipe(Layer.provide(DatabaseLive)),
    });
    const client = createClient(EffectfulClient, {
      link: httpLink({
        url: 'http://localhost/rpc',
        fetch: (input, init) => web.handler(new Request(input, init)),
      }),
    });
    try {
      expect(await client.count()).toBe(1);
      expect(await client.post.byId({ id: 1 })).toBeInstanceOf(EffectfulPost);
      expect(await failure(client.post.byId({ id: 2 }))).toBeInstanceOf(EffectfulNotFound);
    } finally {
      await client.dispose();
      await web.dispose();
    }
  });
});

describe('drift and errors', () => {
  it('the contract check fails when the client module no longer matches the server router', () => {
    const drifted = copyFixture('app');
    try {
      generate({
        project: path.join(drifted, 'tsconfig.json'),
        routers: [path.join(drifted, 'router.ts')],
      });
      const file = path.join(drifted, 'router.client.gen.ts');
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace(
          'health: __query({ success: __Schema.Literal("ok") })',
          'health: __query({ success: __Schema.String })',
        ),
      );
      expect(typeCheck(drifted)).toMatch(
        /router\.client\.gen\.ts is out of date: run effect-trpc-codegen/,
      );
    } finally {
      removeDir(drifted);
    }
  });

  it('reports unmappable types with their location and writes nothing for that module', () => {
    const bad = copyFixture('bad');
    try {
      const out = generate({
        project: path.join(bad, 'tsconfig.json'),
        routers: [path.join(bad, 'router.ts')],
      });
      expect(out.files).toEqual([]);
      const errors = out.errors.join('\n');
      expect(errors).toMatch(/router\.ts:\d+: class Plain is not a Schema class/);
      expect(errors).toMatch(/router\.ts:\d+: a function .* cannot be sent/);
      expect(errors).toMatch(
        /router\.ts:\d+: .*Local is declared in the router module|Local is a class declared next to the router/,
      );
      expect(errors).toMatch(/the recursive type .* needs a name|is not exported/);
      expect(errors).toMatch(/router\.ts:\d+: the enum Status has no schema mapping/);
    } finally {
      removeDir(bad);
    }
  });

  it('a schema built from a value declared in make is an error at its location', () => {
    const bad = copyFixture('bad');
    try {
      const out = generate({
        project: path.join(bad, 'tsconfig.json'),
        routers: [path.join(bad, 'router.ts')],
      });
      const source = readFileSync(path.join(bad, 'router.ts'), 'utf8').split('\n');
      const line = (text: string): number => source.findIndex((l) => l.includes(text)) + 1;
      const errors = out.errors.join('\n');
      expect(errors).toContain(
        `router.ts:${line('Procedure.input(cfg.schema)')}: cfg is declared in make: schemas must not depend on values declared in make (declare the schema at module level)`,
      );
      // A plain local declared in make, not only a value read from a service.
      expect(errors).toContain(
        `router.ts:${line('Procedure.input(Key)')}: Key is declared in make`,
      );
      // The same in a nested service's make.
      expect(errors).toContain(
        `router.ts:${line('Procedure.input(limits.schema)')}: limits is declared in make`,
      );
    } finally {
      removeDir(bad);
    }
  });

  it('a router make that does not return an object literal is an error at its location', () => {
    const bad = copyFixture('bad');
    try {
      const out = generate({
        project: path.join(bad, 'tsconfig.json'),
        routers: [path.join(bad, 'loose.ts')],
      });
      const source = readFileSync(path.join(bad, 'loose.ts'), 'utf8').split('\n');
      const line = source.findIndex((l) => l.includes('return routes;')) + 1;
      expect(out.errors.join('\n')).toContain(
        `loose.ts:${line}: make must return an object literal for the generator to read it`,
      );
    } finally {
      removeDir(bad);
    }
  });

  it('a module without routers is an error', () => {
    const bad = copyFixture('bad');
    try {
      const out = generate({
        project: path.join(bad, 'tsconfig.json'),
        routers: [path.join(bad, 'empty.ts')],
      });
      expect(out.errors.join('\n')).toMatch(/exports no router/);
    } finally {
      removeDir(bad);
    }
  });
});
