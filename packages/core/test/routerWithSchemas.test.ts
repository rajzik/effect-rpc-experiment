// `Router.withSchemas`: the overlay the schema generator writes. It re-creates the inferred
// procedures of a router (or router service) with the generated schemas, without copying the
// module that defines them.
import { Context, Effect, Exit, Schema, Stream } from 'effect';
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

const patched = Router.withSchemas(App, {
  byId: { output: Post, error: PostNotFound },
  first: { output: Post },
  feed: { output: Post },
  admin: { count: { output: Schema.Finite } },
  guarded: { ping: { output: Schema.String } },
});

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

  it('reuses the memoized make of the source service', () => {
    const before = makeRuns;
    Router.withSchemas(App, { admin: { count: { output: Schema.Finite } } });
    expect(makeRuns).toBe(before);
  });

  it('does not change the source router', async () => {
    const source = Router.from(App).record.byId;
    expect(source.successSchema).toBe(Schema.Void);
    const exit = await Effect.runPromiseExit(source.handler({ id: 1 }, ctx(source.toRpc('byId'))));
    expect(Exit.isFailure(exit)).toBe(true); // still guarded: no output schema
  });

  it('rejects schemas for paths that are not inferred procedures (a stale generated file)', () => {
    expect(() =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates a generated file older than the router
      Router.withSchemas(App, { missing: { output: Post } } as never),
    ).toThrow(/no procedure "missing"/);
    expect(() =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates a generated file older than the router
      Router.withSchemas(App, { legacy: { output: Schema.String } } as never),
    ).toThrow(/"legacy" has no handler/);
    expect(() =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates a generated file older than the router
      Router.withSchemas(App, { admin: { nope: { output: Post } } } as never),
    ).toThrow(/no procedure "admin.nope"/);
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
    expect(out.record.byId.errorSchema.ast._tag).toBe('Union');
  });
});
