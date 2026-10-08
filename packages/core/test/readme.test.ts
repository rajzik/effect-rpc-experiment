// Mirrors the example in README.md so the documentation stays correct.
import { Effect, Exit, Layer, Schema, Stream } from 'effect';
import { RpcMiddleware, RpcTest } from 'effect/rpc';
import { describe, expect, expectTypeOf, it } from 'vite-plus/test';
import {
  causeToClientError,
  Codecs,
  isClientInfrastructureError,
  mutation,
  query,
  Router,
  subscription,
} from '../src/index.js';
import type { ClientError, inferError, inferInput, inferOutput } from '../src/index.js';

class Post extends Schema.Class<Post>('Post')({
  id: Schema.Number,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  get slug() {
    return this.title.toLowerCase().replaceAll(' ', '-');
  }
}
class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}
class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  reason: Schema.String,
}) {}
class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {}) {}
class Auth extends RpcMiddleware.Service<Auth>()('Auth', { error: Unauthorized }) {}

const byId = query({
  payload: { id: Schema.Number },
  success: Post,
  error: Schema.Union([PostNotFound, Forbidden]),
});

const appRouter = Router.make({
  health: query({ success: Schema.Literal('ok') }),
  post: {
    byId,
    create: mutation({
      payload: { title: Schema.String },
      success: Post,
      error: Forbidden,
    }).middleware(Auth),
    onCreated: subscription({ success: Post }),
  },
});

const HandlersLive = appRouter.group.toLayer({
  health: () => Effect.succeed('ok' as const),
  'post.byId': ({ id }) =>
    id === 1
      ? Effect.succeed(new Post({ id, title: 'Hello', createdAt: new Date() }))
      : Effect.fail(new PostNotFound({ id })),
  'post.create': ({ title }) => Effect.succeed(new Post({ id: 2, title, createdAt: new Date() })),
  'post.onCreated': () => Stream.empty,
});

// Server side of the Auth middleware (a no-op here).
const AuthLive = Layer.succeed(Auth)(Auth.of((effect) => effect));

describe('README example', () => {
  it('infers procedure types', () => {
    expectTypeOf<inferInput<typeof byId>>().toEqualTypeOf<{ readonly id: number }>();
    expectTypeOf<inferOutput<typeof byId>>().toEqualTypeOf<Post>();
    expectTypeOf<inferError<typeof byId>>().toEqualTypeOf<PostNotFound | Forbidden>();
    expect([...appRouter.group.requests.keys()]).toEqual([
      'health',
      'post.byId',
      'post.create',
      'post.onCreated',
    ]);
  });

  it('classifies client errors', async () => {
    const program = Effect.gen(function* () {
      const client = yield* RpcTest.makeClient(appRouter.group);
      const exit = yield* Effect.exit(client['post.byId']({ id: 7 }));
      if (Exit.isSuccess(exit)) return 'success';
      const error = causeToClientError(exit.cause);
      expectTypeOf(error).toEqualTypeOf<ClientError<PostNotFound | Forbidden>>();
      if (isClientInfrastructureError(error)) return 'infrastructure';
      return error._tag === 'PostNotFound'
        ? `not found: ${error.id}` // error: PostNotFound
        : `forbidden: ${error.reason}`; // error: Forbidden
    });
    const result = await Effect.runPromise(
      program.pipe(Effect.scoped, Effect.provide(Layer.merge(HandlersLive, AuthLive))),
    );
    expect(result).toBe('not found: 7');
  });

  it('round-trips exits and values through JSON with Codecs', () => {
    const rpc = Router.getRpc(appRouter, 'post.byId');
    const encodedExit = JSON.stringify(
      Codecs.encodeExitSync(rpc, Exit.fail(new PostNotFound({ id: 7 }))),
    );
    expect(JSON.parse(encodedExit)).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Fail', error: { _tag: 'PostNotFound', id: 7 } }],
    });
    const exit = Codecs.decodeExitSync(rpc, JSON.parse(encodedExit));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(causeToClientError(Exit.isFailure(exit) ? exit.cause : null!)).toBeInstanceOf(
      PostNotFound,
    );

    const post = new Post({ id: 1, title: 'Hello World', createdAt: new Date(0) });
    const encodedPost = JSON.stringify(Codecs.encodeSuccessSync(rpc, post));
    const decoded = Codecs.decodeSuccessSync(rpc, JSON.parse(encodedPost));
    expect(decoded).toBeInstanceOf(Post);
    expect(decoded.slug).toBe('hello-world');
    expect(decoded.createdAt).toBeInstanceOf(Date);
  });
});
