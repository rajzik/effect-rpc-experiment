import { Context, Effect, Schema, Stream } from 'effect';
import type { Headers } from 'effect/http';
import { RpcMiddleware } from 'effect/rpc';
import type { Rpc } from 'effect/rpc';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { mutation, Procedure, query, Router, subscription } from '../src/index.js';
import type {
  inferError,
  inferInput,
  inferKind,
  inferOutput,
  ProcedureDef,
  ProcedureWithHandler,
} from '../src/index.js';
import {
  AuthMiddleware,
  Forbidden,
  LogMiddleware,
  Post,
  PostNotFound,
  Unauthorized,
} from './fixtures.js';

class Database extends Context.Service<
  Database,
  { readonly findPost: (id: number) => Effect.Effect<Post, PostNotFound> }
>()('Database') {}

class Clock extends Context.Service<Clock, { readonly now: Effect.Effect<number> }>()('Clock') {}

class CurrentUser extends Context.Service<CurrentUser, { readonly id: string }>()('CurrentUser') {}

class ProvidesUser extends RpcMiddleware.Service<ProvidesUser, { provides: CurrentUser }>()(
  'ProvidesUser',
) {}

/** Exact type identity (robust for deep types such as `Rpc`). */
type Equals<A, B> =
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the standard identity check: `T` is deliberately unused so that only identical `A` / `B` compare equal
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const post = new Post({ id: 1, title: 'Hello', createdAt: new Date(0) });

const byId = Procedure.input({ id: Schema.Finite })
  .output(Post)
  .error(Schema.Union([PostNotFound, Forbidden]))
  .query(
    Effect.fn(function* ({ id }) {
      expectTypeOf(id).toEqualTypeOf<number>();
      const db = yield* Database;
      return yield* db.findPost(id);
    }),
  );

const legacyById = query({
  payload: { id: Schema.Finite },
  success: Post,
  error: Schema.Union([PostNotFound, Forbidden]),
});

const narrowsToAny = (u: unknown): void => {
  if (Procedure.hasHandler(u)) expectTypeOf(u).toEqualTypeOf<ProcedureWithHandler.Any>();
};

describe('Procedure builder types', () => {
  it('handler payload is inferred from input', () => {
    Procedure.input({ id: Schema.Finite }).query((payload) => {
      expectTypeOf(payload).toEqualTypeOf<{ readonly id: number }>();
      return Effect.void;
    });
    Procedure.input(Schema.String).mutation((payload) => {
      expectTypeOf(payload).toEqualTypeOf<string>();
      return Effect.void;
    });
    Procedure.query((payload) => {
      expectTypeOf(payload).toEqualTypeOf<void>();
      return Effect.void;
    });
    Procedure.input({ since: Schema.Finite })
      .output(Post)
      .subscription(({ since }) => {
        expectTypeOf(since).toEqualTypeOf<number>();
        return Stream.make(post);
      });
  });

  it('handler context is the effect/rpc handler context', () => {
    Procedure.query((_payload, ctx) => {
      expectTypeOf(ctx).toEqualTypeOf<Procedure.HandlerContext>();
      expectTypeOf(ctx.headers).toEqualTypeOf<Headers.Headers>();
      expectTypeOf(ctx.rpc).toEqualTypeOf<Rpc.Any>();
      expectTypeOf(ctx.client).toEqualTypeOf<Rpc.ServerClient>();
      return Effect.void;
    });
  });

  it('wrong success type is rejected', () => {
    const builder = Procedure.input({ id: Schema.Finite }).output(Post);
    // @ts-expect-error -- a string is not a Post
    builder.query(() => Effect.succeed('not a post'));
    // @ts-expect-error -- a Stream of strings is not a Stream of Posts
    builder.subscription(() => Stream.make('not a post'));
    // @ts-expect-error -- a query handler must return an Effect, not a Stream
    builder.query(() => Stream.make(post));
    expectTypeOf(builder.query(() => Effect.succeed(post)).handler).returns.toEqualTypeOf<
      Effect.Effect<Post>
    >();
  });

  it('undeclared error is rejected', () => {
    // @ts-expect-error -- Unauthorized is not declared
    Procedure.error(PostNotFound).query(() => Effect.fail(new Unauthorized()));
    // @ts-expect-error -- no error declared: the default is Never
    Procedure.mutation(() => Effect.fail(new PostNotFound({ id: 1 })));
    // @ts-expect-error -- Unauthorized is not declared
    Procedure.output(Post).subscription(() => Stream.fail(new Unauthorized()));
    const declared = Procedure.error(PostNotFound).query(() =>
      Effect.fail(new PostNotFound({ id: 1 })),
    );
    expectTypeOf(declared.handler).returns.toEqualTypeOf<Effect.Effect<void, PostNotFound>>();
  });

  it('middleware errors are allowed', () => {
    const guarded = Procedure.output(Post)
      .error(PostNotFound)
      .middleware(AuthMiddleware)
      .query(() => (Math.random() > 0.5 ? Effect.fail(new Unauthorized()) : Effect.succeed(post)));
    expectTypeOf<inferError<typeof guarded>>().toEqualTypeOf<PostNotFound | Unauthorized>();
    Procedure.output(Post)
      .middleware(AuthMiddleware)
      .subscription(() => Stream.fail(new Unauthorized()));
    // @ts-expect-error -- LogMiddleware declares no error
    Procedure.middleware(LogMiddleware).query(() => Effect.fail(new Unauthorized()));
  });

  it('R is recorded', () => {
    expectTypeOf<Procedure.HandlerRequirements<typeof byId>>().toEqualTypeOf<Database>();
    const noServices = Procedure.query(() => Effect.void);
    expectTypeOf<Procedure.HandlerRequirements<typeof noServices>>().toEqualTypeOf<never>();
    const two = Procedure.output(Schema.Finite).mutation(
      Effect.fn(function* () {
        const clock = yield* Clock;
        yield* Database;
        return yield* clock.now;
      }),
    );
    expectTypeOf<Procedure.HandlerRequirements<typeof two>>().toEqualTypeOf<Database | Clock>();
    // a plain definition has no handler, hence no requirements
    expectTypeOf<Procedure.HandlerRequirements<typeof legacyById>>().toEqualTypeOf<never>();
  });

  it('infers requirements from a Stream handler', () => {
    const feed = Procedure.output(Post)
      .error(PostNotFound)
      .subscription(() => Stream.fromEffect(Database.use((db) => db.findPost(1))));
    expectTypeOf<Procedure.HandlerRequirements<typeof feed>>().toEqualTypeOf<Database>();
  });

  it('inferInput/Output/Error equal those of the equivalent query({...})', () => {
    expectTypeOf<inferInput<typeof byId>>().toEqualTypeOf<inferInput<typeof legacyById>>();
    expectTypeOf<inferOutput<typeof byId>>().toEqualTypeOf<inferOutput<typeof legacyById>>();
    expectTypeOf<inferError<typeof byId>>().toEqualTypeOf<inferError<typeof legacyById>>();
    expectTypeOf<inferKind<typeof byId>>().toEqualTypeOf<'query'>();
    expectTypeOf<
      Equals<
        ProcedureDef.ToRpc<typeof byId, 'post.byId'>,
        ProcedureDef.ToRpc<typeof legacyById, 'post.byId'>
      >
    >().toEqualTypeOf<true>();

    const create = Procedure.input({ title: Schema.String })
      .output(Post)
      .error(Forbidden)
      .mutation(() => Effect.succeed(post));
    const legacyCreate = mutation({
      payload: { title: Schema.String },
      success: Post,
      error: Forbidden,
    });
    expectTypeOf<
      Equals<ProcedureDef.ToRpc<typeof create, 'c'>, ProcedureDef.ToRpc<typeof legacyCreate, 'c'>>
    >().toEqualTypeOf<true>();
    expectTypeOf<inferKind<typeof create>>().toEqualTypeOf<'mutation'>();

    const onPost = Procedure.input({ since: Schema.Finite })
      .output(Post)
      .error(Forbidden)
      .subscription(() => Stream.make(post));
    const legacyOnPost = subscription({
      payload: { since: Schema.Finite },
      success: Post,
      error: Forbidden,
    });
    expectTypeOf<
      Equals<ProcedureDef.ToRpc<typeof onPost, 's'>, ProcedureDef.ToRpc<typeof legacyOnPost, 's'>>
    >().toEqualTypeOf<true>();
    expectTypeOf<inferOutput<typeof onPost>>().toEqualTypeOf<Post>();

    const viaMiddleware = Procedure.output(Post)
      .middleware(AuthMiddleware)
      .query(() => Effect.succeed(post));
    const legacyViaMiddleware = query({ success: Post }).middleware(AuthMiddleware);
    expectTypeOf<
      Equals<
        ProcedureDef.ToRpc<typeof viaMiddleware, 'm'>,
        ProcedureDef.ToRpc<typeof legacyViaMiddleware, 'm'>
      >
    >().toEqualTypeOf<true>();
    expectTypeOf<inferError<typeof viaMiddleware>>().toEqualTypeOf<Unauthorized>();
  });

  it('defaults are Void / Void / Never', () => {
    const bare = Procedure.query(() => Effect.void);
    expectTypeOf(bare).toEqualTypeOf<
      ProcedureWithHandler<'query', Schema.Void, Schema.Void, Schema.Never, never, never, never>
    >();
    const legacy = query();
    expectTypeOf<
      Equals<ProcedureDef.ToRpc<typeof bare, 'x'>, ProcedureDef.ToRpc<typeof legacy, 'x'>>
    >().toEqualTypeOf<true>();
  });

  it('middleware keeps the handler type (procedure, AddMiddleware and router)', () => {
    const after = byId.middleware(AuthMiddleware);
    expectTypeOf<
      Equals<typeof after, ProcedureDef.AddMiddleware<typeof byId, typeof AuthMiddleware>>
    >().toEqualTypeOf<true>();
    expectTypeOf<
      Equals<
        typeof after,
        ProcedureWithHandler<
          'query',
          Schema.Struct<{ id: typeof Schema.Finite }>,
          typeof Post,
          Schema.Union<readonly [typeof PostNotFound, typeof Forbidden]>,
          typeof AuthMiddleware,
          never,
          Database
        >
      >
    >().toEqualTypeOf<true>();
    expectTypeOf<Procedure.HandlerRequirements<typeof after>>().toEqualTypeOf<Database>();
    expectTypeOf(after.handler).toBeFunction();
    expectTypeOf<inferError<typeof after>>().toEqualTypeOf<
      PostNotFound | Forbidden | Unauthorized
    >();

    const router = Router.make({ post: { byId }, health: query({ success: Schema.String }) });
    const guarded = router.middleware(LogMiddleware);
    expectTypeOf<
      Procedure.HandlerRequirements<typeof guarded.record.post.byId>
    >().toEqualTypeOf<Database>();
    expectTypeOf(guarded.record.post.byId.handler).toBeFunction();
    expectTypeOf(guarded.record.health).not.toHaveProperty('handler');
    expectTypeOf<Router.Paths<typeof guarded>>().toEqualTypeOf<'post.byId' | 'health'>();
  });

  it('records the middleware-provided services as requirements of the handler', () => {
    const me = Procedure.output(Schema.String)
      .middleware(ProvidesUser)
      .query(
        Effect.fn(function* () {
          const user = yield* CurrentUser;
          return user.id;
        }),
      );
    // Requirements are recorded as written; removing middleware-provided services is the
    // server's job (Handlers.fromService), like Handlers.make does today.
    expectTypeOf<Procedure.HandlerRequirements<typeof me>>().toEqualTypeOf<CurrentUser>();
  });

  it('builder procedures are ProcedureWithHandler.Any and hasHandler narrows', () => {
    const guardedQuery = Procedure.input({ id: Schema.Finite })
      .output(Post)
      .error(PostNotFound)
      .middleware(AuthMiddleware)
      .query(({ id }) => Effect.succeed(new Post({ id, title: 't', createdAt: new Date(0) })))
      .middleware(LogMiddleware);
    const guardedFeed = Procedure.output(Schema.Finite)
      .middleware(AuthMiddleware)
      .subscription(() => Stream.make(1, 2))
      .middleware(LogMiddleware);
    expectTypeOf(guardedQuery).toExtend<ProcedureWithHandler.Any>();
    expectTypeOf(guardedFeed).toExtend<ProcedureWithHandler.Any>();
    expectTypeOf(legacyById).not.toExtend<ProcedureWithHandler.Any>();

    narrowsToAny(guardedQuery);
    const def: ProcedureDef.Any = legacyById;
    if (Procedure.hasHandler(def)) {
      expectTypeOf(def).toExtend<ProcedureWithHandler.Any>();
    }
  });
});
