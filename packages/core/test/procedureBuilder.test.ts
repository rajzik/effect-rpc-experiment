import { Context, Effect, Exit, Schema, Stream } from 'effect';
import { Headers } from 'effect/http';
import { Rpc, RpcMessage } from 'effect/rpc';
import { describe, expect, it } from 'vite-plus/test';
import { Procedure, ProcedureKind, query, Router, subscription } from '../src/index.js';
import type { ProcedureDef } from '../src/index.js';
import {
  AuthMiddleware,
  Forbidden,
  LogMiddleware,
  Post,
  PostNotFound,
  Unauthorized,
} from './fixtures.js';

const ctx = (rpc: Rpc.AnyWithProps): Procedure.HandlerContext => ({
  client: new Rpc.ServerClient(0),
  requestId: RpcMessage.RequestId(1),
  headers: Headers.empty,
  rpc,
});

const samePlan = (a: Rpc.AnyWithProps, b: Rpc.AnyWithProps): void => {
  expect(a._tag).toBe(b._tag);
  expect(a.successSchema).toBe(b.successSchema);
  expect(a.errorSchema).toBe(b.errorSchema);
  expect(a.middlewares).toEqual(b.middlewares);
  expect(Context.get(a.annotations, ProcedureKind)).toBe(Context.get(b.annotations, ProcedureKind));
};

const PostById = Schema.Struct({ id: Schema.Finite });
const post = new Post({ id: 1, title: 'Hello', createdAt: new Date(0) });
const handler = () => Effect.succeed(post);

describe('Procedure builder', () => {
  it('builder procedures compile to the same rpc as query({...})', () => {
    const built = Procedure.input(PostById)
      .output(Post)
      .error(PostNotFound)
      .query(() => Effect.succeed(post));
    const legacy = query({ payload: PostById, success: Post, error: PostNotFound });
    const a = built.toRpc('post.byId');
    const b = legacy.toRpc('post.byId');
    samePlan(a, b);
    expect(a.payloadSchema).toBe(b.payloadSchema);
    expect(Context.get(a.annotations, ProcedureKind)).toBe('query');
    expect(built.kind).toBe('query');

    // Struct fields are wrapped in Schema.Struct, exactly like `query({ payload: fields })`.
    const fromFields = Procedure.input({ id: Schema.Finite }).query(() => Effect.void);
    const legacyFields = query({ payload: { id: Schema.Finite } });
    const fieldsRpc = fromFields.toRpc('x');
    expect(Schema.isSchema(fieldsRpc.payloadSchema)).toBe(true);
    expect(fieldsRpc.payloadSchema.ast._tag).toBe(legacyFields.toRpc('x').payloadSchema.ast._tag);
    expect(fromFields.payloadSchema.fields.id).toBe(Schema.Finite);
  });

  it('mutation and subscription terminals compile like mutation() / subscription()', () => {
    const created = Procedure.input(PostById)
      .output(Post)
      .mutation(() => Effect.succeed(post));
    expect(created.kind).toBe('mutation');
    expect(Context.get(created.toRpc('post.create').annotations, ProcedureKind)).toBe('mutation');

    const built = Procedure.input(PostById)
      .output(Post)
      .error(PostNotFound)
      .subscription(() => Stream.make(post));
    const legacy = subscription({ payload: PostById, success: Post, error: PostNotFound });
    const a = built.toRpc('post.onPost');
    const b = legacy.toRpc('post.onPost');
    expect(built.kind).toBe('subscription');
    expect(a._tag).toBe(b._tag);
    expect(a.payloadSchema).toBe(b.payloadSchema);
    expect(a.errorSchema).toBe(b.errorSchema);
    expect(Context.get(a.annotations, ProcedureKind)).toBe('subscription');
    expect(Rpc.exitSchema(a).ast._tag).toBe(Rpc.exitSchema(b).ast._tag);
  });

  it('defaults are Void / Void / Never', () => {
    const bare = Procedure.query(() => Effect.void);
    expect(bare.payloadSchema).toBe(Schema.Void);
    expect(bare.successSchema).toBe(Schema.Void);
    expect(bare.errorSchema).toBe(Schema.Never);
    expect(bare.middlewares).toEqual([]);
    const legacy = query();
    samePlan(bare.toRpc('x'), legacy.toRpc('x'));
    expect(bare.toRpc('x').payloadSchema).toBe(legacy.toRpc('x').payloadSchema);
  });

  it('keeps the handler on the procedure and runs it with the payload and context', async () => {
    const byId = Procedure.input({ id: Schema.Finite })
      .output(Post)
      .error(PostNotFound)
      .query(
        Effect.fn(function* ({ id }) {
          if (id !== 1) return yield* new PostNotFound({ id });
          return post;
        }),
      );
    const rpc = byId.toRpc('post.byId');
    expect(await Effect.runPromise(byId.handler({ id: 1 }, ctx(rpc)))).toBe(post);
    const failed = await Effect.runPromiseExit(byId.handler({ id: 2 }, ctx(rpc)));
    expect(Exit.isFailure(failed)).toBe(true);
    expect(await Effect.runPromise(Effect.flip(byId.handler({ id: 2 }, ctx(rpc))))).toEqual(
      new PostNotFound({ id: 2 }),
    );

    const counter = Procedure.input({ upTo: Schema.Finite })
      .output(Schema.Finite)
      .subscription(({ upTo }) => Stream.range(1, upTo));
    const chunk = await Effect.runPromise(
      Stream.runCollect(counter.handler({ upTo: 3 }, ctx(counter.toRpc('count')))),
    );
    expect(Array.from(chunk)).toEqual([1, 2, 3]);
  });

  it('middleware() keeps the handler (before and after the terminal)', () => {
    const before = Procedure.input(PostById).output(Post).middleware(AuthMiddleware).query(handler);
    expect(before.handler).toBe(handler);
    expect(before.middlewares).toEqual([AuthMiddleware]);
    expect(before.toRpc('x').middlewares).toEqual(
      query({ payload: PostById, success: Post }).middleware(AuthMiddleware).toRpc('x').middlewares,
    );

    const after = Procedure.input(PostById).output(Post).query(handler).middleware(AuthMiddleware);
    expect(after.handler).toBe(handler);
    expect(after.middlewares).toEqual([AuthMiddleware]);
    expect(Procedure.hasHandler(after)).toBe(true);

    const both = before.middleware(LogMiddleware);
    expect(both.handler).toBe(handler);
    expect(both.middlewares).toEqual([AuthMiddleware, LogMiddleware]);
  });

  it('router.middleware() keeps the handlers of builder procedures', () => {
    const router = Router.make({
      post: { byId: Procedure.input(PostById).output(Post).query(handler) },
      health: query({ success: Schema.Literal('ok') }),
    });
    const guarded = router.middleware(AuthMiddleware);
    expect(guarded.record.post.byId.handler).toBe(handler);
    expect(guarded.record.post.byId.middlewares).toEqual([AuthMiddleware]);
    expect(Procedure.hasHandler(guarded.record.health)).toBe(false);
    expect([...guarded.group.requests.keys()]).toEqual(['post.byId', 'health']);
  });

  it('is immutable: every step returns a new builder and procedures are frozen', () => {
    const base = Procedure.input(PostById);
    const withOutput = base.output(Post);
    expect(withOutput).not.toBe(base);
    const plain = base.query(() => Effect.void);
    expect(plain.successSchema).toBe(Schema.Void);
    const typed = withOutput.query(() => Effect.succeed(post));
    expect(typed.successSchema).toBe(Post);
    expect(Object.isFrozen(typed)).toBe(true);
    expect(Object.isFrozen(base)).toBe(true);
    // Calling `error` again replaces the previous error schema.
    const replaced = Procedure.error(PostNotFound)
      .error(Unauthorized)
      .query(() => Effect.void);
    expect(replaced.errorSchema).toBe(Unauthorized);
  });

  it('hasHandler tells builder procedures from query({...}) definitions', () => {
    const legacy: ProcedureDef.Any = query();
    expect(Procedure.hasHandler(legacy)).toBe(false);
    expect(Object.hasOwn(legacy, 'handler')).toBe(false);
    expect(Procedure.hasHandler(Procedure.query(() => Effect.void))).toBe(true);
    expect(Procedure.hasHandler({ handler: () => Effect.void })).toBe(false);
  });
});

const defectMessage = async (effect: Effect.Effect<unknown, unknown>): Promise<string> => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error('expected a defect');
  const reason = exit.cause.reasons.find((r) => r._tag === 'Die');
  if (reason === undefined) throw new Error('expected a defect');
  return reason.defect instanceof Error ? reason.defect.message : String(reason.defect);
};

describe('inference mode (no `.output`)', () => {
  it('a value returned without an output schema is a defect naming the fix', async () => {
    const inferred = Procedure.input({ id: Schema.Finite }).query(({ id }) =>
      Effect.succeed(new Post({ id, title: 't', createdAt: new Date(0) })),
    );
    expect(inferred.successSchema).toBe(Schema.Void);
    const message = await defectMessage(inferred.handler({ id: 1 }, ctx(inferred.toRpc('p'))));
    expect(message).toMatch(/no output schema/);
    expect(message).toMatch(/\.output\(/);
    expect(message).toMatch(/generate/);
  });

  it('a void handler still succeeds', async () => {
    const bare = Procedure.mutation(() => Effect.void);
    expect(await Effect.runPromise(bare.handler(undefined, ctx(bare.toRpc('b'))))).toBeUndefined();
  });

  it('failures pass through unchanged (they become defects at the rpc boundary)', async () => {
    const failing = Procedure.query(() => Effect.fail(new Forbidden({ reason: 'no' })));
    const error = await Effect.runPromise(
      Effect.flip(failing.handler(undefined, ctx(failing.toRpc('f')))),
    );
    expect(error).toEqual(new Forbidden({ reason: 'no' }));
  });

  it('subscription elements without an output schema are a defect', async () => {
    const feed = Procedure.subscription(() => Stream.make(post));
    const message = await defectMessage(
      Stream.runCollect(feed.handler(undefined, ctx(feed.toRpc('s')))),
    );
    expect(message).toMatch(/no output schema/);
    const ticks = Procedure.subscription(() => Stream.make(undefined, undefined));
    const chunk = await Effect.runPromise(
      Stream.runCollect(ticks.handler(undefined, ctx(ticks.toRpc('t')))),
    );
    expect(Array.from(chunk)).toEqual([undefined, undefined]);
  });
});

describe('`.inferred({ output, error })`', () => {
  it('compiles to the same rpc as `.output(...).error(...)` and does not wrap the handler', async () => {
    const inferred = Procedure.input(PostById)
      .inferred({ output: Post, error: PostNotFound })
      .query(handler);
    const explicit = Procedure.input(PostById).output(Post).error(PostNotFound).query(handler);
    samePlan(inferred.toRpc('p'), explicit.toRpc('p'));
    expect(inferred.handler).toBe(handler);
    expect(await Effect.runPromise(inferred.handler({ id: 1 }, ctx(inferred.toRpc('p'))))).toBe(
      post,
    );
  });

  it('only replaces the schemas it is given', () => {
    const outputOnly = Procedure.error(PostNotFound).inferred({ output: Post }).query(handler);
    expect(outputOnly.successSchema).toBe(Post);
    expect(outputOnly.errorSchema).toBe(PostNotFound);
    const errorOnly = Procedure.inferred({ error: Forbidden }).mutation(() => Effect.void);
    expect(errorOnly.successSchema).toBe(Schema.Void);
    expect(errorOnly.errorSchema).toBe(Forbidden);
  });

  it('keeps middleware and the handler through `.middleware` after the terminal', () => {
    const guarded = Procedure.inferred({ output: Post })
      .middleware(AuthMiddleware)
      .query(handler)
      .middleware(LogMiddleware);
    expect(guarded.middlewares).toEqual([AuthMiddleware, LogMiddleware]);
    expect(guarded.successSchema).toBe(Post);
    expect(guarded.handler).toBe(handler);
  });

  it('`.output` after inference mode turns the runtime guard off', async () => {
    const explicit = Procedure.input(PostById).output(Post).query(handler);
    expect(explicit.handler).toBe(handler);
  });
});
