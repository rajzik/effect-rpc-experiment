import { EventEmitter } from 'node:events';
import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import { Effect, Queue, Schema, Stream } from 'effect';

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Number,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  /** A method, to prove that values are real class instances. */
  shout(): string {
    return `${this.title.toUpperCase()}!`;
  }
}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Number,
}) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  reason: Schema.String,
}) {}

export const PostPage = Schema.Struct({
  items: Schema.Array(Post),
  nextCursor: Schema.NullOr(Schema.Number),
});

export const appRouter = Router.make({
  /** No input. */
  health: query({ success: Schema.Literal('ok') }),
  /** Dies (a defect). */
  boom: query({ success: Schema.String }),
  /** Never completes; counts starts and interruptions. */
  slow: query({ success: Schema.String }),
  post: {
    /** `id: 404` fails with `PostNotFound`, `id: 403` with `Forbidden`. */
    byId: query({
      payload: { id: Schema.Number },
      success: Post,
      error: Schema.Union([PostNotFound, Forbidden]),
    }),
    /** Cursor-paginated (cursor = index of the first item). */
    list: query({
      payload: {
        cursor: Schema.optional(Schema.NullOr(Schema.Number)),
        limit: Schema.optional(Schema.Number),
      },
      success: PostPage,
    }),
    /** All titles. */
    titles: query({ success: Schema.Array(Schema.String) }),
    /** Fails with `Forbidden` when the title is `"forbidden"`. */
    create: mutation({ payload: { title: Schema.String }, success: Post, error: Forbidden }),
    /** No input (tRPC issue 2540). Returns the number of posts. */
    reset: mutation({ success: Schema.Number }),
    /** Emits every created post. */
    onCreated: subscription({ success: Post }),
  },
  /** Emits `offset + n` for every `ctx.emit(n)`; never completes on its own. */
  events: subscription({ payload: { offset: Schema.Number }, success: Schema.Number }),
  /** Emits `0 .. n-1`, then fails with `PostNotFound` when `fail` is set, else completes. */
  ticks: subscription({
    payload: { n: Schema.Number, fail: Schema.optional(Schema.Boolean) },
    success: Schema.Number,
    error: PostNotFound,
  }),
});

export type AppRouter = typeof appRouter;

export const createdAt = new Date('2026-01-02T03:04:05.000Z');

export const makePost = (id: number, title = `Post ${id}`): Post =>
  new Post({ id, title, createdAt });

/** Mutable server state shared by every handler layer built from {@link makeFixture}. */
export interface FixtureState {
  readonly posts: Array<Post>;
  /** Payloads received by `post.list`. */
  readonly listCalls: Array<unknown>;
  /** Headers (`x-*`) received by `post.byId`. */
  readonly headers: Array<Record<string, string>>;
  /** `offset`s of `events` streams that were closed (interrupted). */
  readonly closed: Array<number>;
  readonly emitter: EventEmitter;
  readonly slow: { started: number; interrupted: number };
}

export const makeFixture = () => {
  const state: FixtureState = {
    posts: [makePost(1, 'Hello world'), makePost(2), makePost(3), makePost(4)],
    listCalls: [],
    headers: [],
    closed: [],
    emitter: new EventEmitter(),
    slow: { started: 0, interrupted: 0 },
  };
  const handlers = Handlers.make(appRouter, {
    health: () => Effect.succeed('ok' as const),
    boom: () => Effect.die(new Error('kaboom')),
    slow: () =>
      Effect.sync(() => {
        state.slow.started++;
      }).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            state.slow.interrupted++;
          }),
        ),
      ),
    post: {
      byId: ({ id }, { headers }) => {
        state.headers.push(
          Object.fromEntries(Object.entries(headers).filter(([key]) => key.startsWith('x-'))),
        );
        if (id === 404) return Effect.fail(new PostNotFound({ id }));
        if (id === 403) return Effect.fail(new Forbidden({ reason: 'private' }));
        const post = state.posts.find((p) => p.id === id);
        return post === undefined ? Effect.fail(new PostNotFound({ id })) : Effect.succeed(post);
      },
      list: (payload) =>
        Effect.sync(() => {
          state.listCalls.push(payload);
          const start = payload.cursor ?? 0;
          const end = start + (payload.limit ?? 1);
          return {
            items: state.posts.slice(start, end),
            nextCursor: end < state.posts.length ? end : null,
          };
        }),
      titles: () => Effect.sync(() => state.posts.map((p) => p.title)),
      create: ({ title }) =>
        title === 'forbidden'
          ? Effect.fail(new Forbidden({ reason: 'no' }))
          : Effect.sync(() => {
              const post = makePost(state.posts.length + 1, title);
              state.posts.push(post);
              state.emitter.emit('created', post);
              return post;
            }),
      reset: () => Effect.sync(() => state.posts.length),
      onCreated: () =>
        Stream.callback<Post>((queue) =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const listener = (post: Post): void => {
                Queue.offerUnsafe(queue, post);
              };
              state.emitter.on('created', listener);
              return listener;
            }),
            (listener) => Effect.sync(() => state.emitter.off('created', listener)),
          ),
        ),
    },
    events: ({ offset }) =>
      Stream.callback<number>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            const listener = (n: number): void => {
              Queue.offerUnsafe(queue, n + offset);
            };
            state.emitter.on('data', listener);
            return listener;
          }),
          (listener) =>
            Effect.sync(() => {
              state.emitter.off('data', listener);
              state.closed.push(offset);
            }),
        ),
      ),
    ticks: ({ n, fail }) =>
      Stream.range(0, n - 1).pipe(
        Stream.concat(fail === true ? Stream.fail(new PostNotFound({ id: n })) : Stream.empty),
      ),
  });
  return {
    state,
    handlers,
    /** Emits `n` to every open `events` stream. */
    emit: (n: number): void => {
      state.emitter.emit('data', n);
    },
    listenerCount: (): number => state.emitter.listenerCount('data'),
  };
};
