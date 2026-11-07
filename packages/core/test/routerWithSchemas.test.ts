// `Router.withSchemas`: the overlay the schema generator writes. It re-creates the inferred
// procedures of a router (or router service) with the generated schemas, without copying the
// module that defines them. Over a service it is a lazy service: nothing runs until it is built.
import { Cause, Context, Effect, Exit, Schema, Stream } from 'effect';
import { Headers } from 'effect/http';
import { Rpc, RpcMessage } from 'effect/rpc';
import { describe, expect, it } from 'vite-plus/test';
import { Procedure, query, Router } from '../src/index.js';
import { AuthMiddleware, Forbidden, LogMiddleware, Post, PostNotFound } from './fixtures.js';

const post = new Post({ id: 1, title: 'Hello', createdAt: new Date(0) });
const ctx = (rpc: Rpc.Any): Procedure.HandlerContext => ({
  client: new Rpc.ServerClient(0),
  requestId: RpcMessage.RequestId(1),
  headers: Headers.empty,
  rpc,
});

let makeRuns = 0;
class Admin extends Context.Service<Admin>()('Admin', {
  make: Effect.sync(() => {
    makeRuns += 1;
    return { count: Procedure.query(() => Effect.succeed(3)) };
  }),
}) {}

class App extends Context.Service<App>()('App', {
  make: Effect.succeed({
    byId: Procedure.input({ id: Schema.Finite }).query(({ id }) =>
      id === 1 ? Effect.succeed(post) : Effect.fail(new PostNotFound({ id })),
    ),
    first: Procedure.error(PostNotFound)
      .middleware(AuthMiddleware)
      .query(() => Effect.succeed(post)),
    legacy: query({ success: Schema.String }),
    feed: Procedure.subscription(() => Stream.make(post)),
    admin: Admin,
    guarded: Router.make({ ping: Procedure.query(() => Effect.succeed('pong')) }).middleware(
      LogMiddleware,
    ),
  }),
}) {}

const wrapped = Router.withSchemas(App, {
  byId: { output: Post, error: PostNotFound },
  first: { output: Post },
  feed: { output: Post },
  admin: { count: { output: Schema.Finite } },
  guarded: { ping: { output: Schema.String } },
});
const makeRunsAtImport = makeRuns;
const patched = Router.from(wrapped);

class Database extends Context.Service<Database, { readonly latest: Effect.Effect<Post> }>()(
  'Database',
) {}

let effectfulRuns = 0;
class DbRouter extends Context.Service<DbRouter>()('DbRouter', {
  make: Effect.gen(function* () {
    effectfulRuns += 1;
    const db = yield* Database;
    return { latest: Procedure.query(() => db.latest) };
  }),
}) {}

/** The defect `effect` died with (it must not fail with a typed error). */
const defectOf = async (effect: Effect.Effect<unknown, unknown>): Promise<unknown> => {
  const exit = await Effect.runPromiseExit(effect);
  if (!Exit.isFailure(exit)) throw new Error('expected a failure');
  expect(Cause.hasFails(exit.cause)).toBe(false);
  return Cause.squash(exit.cause);
};

describe('Router.withSchemas', () => {
  it('sets the schemas of inferred procedures, keeping payload, kind and middleware', () => {
    const { byId, first, feed } = patched.record;
    expect(byId.successSchema).toBe(Post);
    expect(byId.errorSchema).toBe(PostNotFound);
    expect(byId.kind).toBe('query');
    expect(byId.payloadSchema.fields.id).toBe(Schema.Finite);
    expect(first.successSchema).toBe(Post);
    expect(first.errorSchema).toBe(PostNotFound); // the user's `.error` is kept
    expect(first.middlewares).toEqual([AuthMiddleware]);
    expect(feed.kind).toBe('subscription');
    expect(feed.successSchema).toBe(Post);
  });

  it('runs the original handler (no inference guard) with the new schemas', async () => {
    const { byId } = patched.record;
    expect(await Effect.runPromise(byId.handler({ id: 1 }, ctx(byId.toRpc('byId'))))).toBe(post);
    const failed = await Effect.runPromise(
      Effect.flip(byId.handler({ id: 2 }, ctx(byId.toRpc('byId')))),
    );
    expect(failed).toEqual(new PostNotFound({ id: 2 }));
    const items = await Effect.runPromise(
      Stream.runCollect(
        patched.record.feed.handler(undefined, ctx(patched.record.feed.toRpc('feed'))),
      ),
    );
    expect(Array.from(items)).toEqual([post]);
  });

  it('patches nested service routers and keeps router-level middleware', async () => {
    expect(patched.record.admin.record.count.successSchema).toBe(Schema.Finite);
    const { ping } = patched.record.guarded.record;
    expect(ping.successSchema).toBe(Schema.String);
    expect(ping.middlewares).toEqual([LogMiddleware]);
    expect(await Effect.runPromise(ping.handler(undefined, ctx(ping.toRpc('p'))))).toBe('pong');
  });

  it('compiles the same tags and keeps procedures it was not given', () => {
    expect([...patched.procedures.keys()]).toEqual([...Router.from(App).procedures.keys()]);
    expect(patched.record.legacy).toBe(Router.from(App).record.legacy);
  });

  it('over a service, returns a service with the same key and runs no make until built', () => {
    expect(makeRunsAtImport).toBe(0);
    expect(Router.isService(wrapped)).toBe(true);
    expect(wrapped.key).toBe(App.key);
    const before = makeRuns;
    expect(
      Router.isService(Router.withSchemas(App, { admin: { count: { output: Schema.Finite } } })),
    ).toBe(true);
    expect(makeRuns).toBe(before);
  });

  it('over a service, keeps its make (the value is the raw record) and memoizes its router', async () => {
    expect(wrapped.make).toBe(App.make);
    const { value } = await Effect.runPromise(Router.buildService(wrapped));
    expect(value.admin).toBe(Admin); // the class, as `Context.Service.Shape<typeof App>` types it
    expect(Router.from(wrapped)).toBe(patched);
  });

  it('withSchemas over an effectful service runs no make at import', async () => {
    const out = Router.withSchemas(DbRouter, { latest: { output: Post } });
    expect(effectfulRuns).toBe(0);
    expect(out.key).toBe(DbRouter.key);
    const { router } = await Effect.runPromise(
      Router.buildService(out).pipe(
        Effect.provideService(Database, { latest: Effect.succeed(post) }),
      ),
    );
    expect(effectfulRuns).toBe(1);
    const { latest } = router.record;
    expect(latest.successSchema).toBe(Post);
    expect(await Effect.runPromise(latest.handler(undefined, ctx(latest.toRpc('latest'))))).toBe(
      post,
    );
  });

  it('does not change the source router', async () => {
    const source = Router.from(App).record.byId;
    expect(source.successSchema).toBe(Schema.Void);
    const exit = await Effect.runPromiseExit(source.handler({ id: 1 }, ctx(source.toRpc('byId'))));
    expect(Exit.isFailure(exit)).toBe(true); // still guarded: no output schema
  });

  it('rejects schemas for paths that are not inferred procedures (a stale generated file)', async () => {
    const stale = (schemas: object) =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates a generated file older than the router
      Router.buildService(Router.withSchemas(App, schemas as never));
    expect(await defectOf(stale({ missing: { output: Post } }))).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/no procedure "missing"/) }),
    );
    expect(await defectOf(stale({ legacy: { output: Schema.String } }))).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/"legacy" has no handler/) }),
    );
    expect(await defectOf(stale({ admin: { nope: { output: Post } } }))).toEqual(
      expect.objectContaining({ message: expect.stringMatching(/no procedure "admin.nope"/) }),
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates a generated file older than the router
    const forced = Router.withSchemas(App, { missing: { output: Post } } as never);
    // `Router.from` builds it synchronously: the error names the stale path
    expect(() => Router.from(forced)).toThrow(
      'Router.withSchemas: no procedure "missing" in the router (is the generated file out of date?)',
    );
  });

  it('accepts a plain router', () => {
    const plain = Router.make({ hi: Procedure.query(() => Effect.succeed('hi')) });
    const out = Router.withSchemas(plain, { hi: { output: Schema.String } });
    expect(out.record.hi.successSchema).toBe(Schema.String);
  });

  it('`Forbidden` stays a valid extra error schema', () => {
    const out = Router.withSchemas(App, {
      byId: { output: Post, error: Schema.Union([PostNotFound, Forbidden]) },
    });
    expect(Router.from(out).record.byId.errorSchema.ast._tag).toBe('Union');
  });
});
