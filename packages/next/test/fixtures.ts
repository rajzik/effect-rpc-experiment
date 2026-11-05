import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import type { DehydratedState } from '@tanstack/react-query';
import { Effect, Layer, Schema, Stream } from 'effect';

export class Post extends Schema.Class<Post>('Post')({
  id: Schema.Finite,
  title: Schema.String,
  createdAt: Schema.Date,
}) {
  /** A method, to prove that values are real class instances. */
  shout(): string {
    return `${this.title.toUpperCase()}!`;
  }
}

export class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
  id: Schema.Finite,
}) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
  reason: Schema.String,
}) {}

export const PostPage = Schema.Struct({
  items: Schema.Array(Post),
  nextCursor: Schema.NullOr(Schema.Finite),
});

export const appRouter = Router.make({
  /** Dies (a defect). */
  boom: query({ success: Schema.String }),
  post: {
    /** `id: 404` (or any unknown id) fails with `PostNotFound`. */
    byId: query({ payload: { id: Schema.Finite }, success: Post, error: PostNotFound }),
    /** Cursor-paginated (cursor = index of the first item). */
    list: query({
      payload: {
        cursor: Schema.optional(Schema.NullOr(Schema.Finite)),
        limit: Schema.optional(Schema.Finite),
      },
      success: PostPage,
    }),
    /** Fails with `Forbidden` when the title is `"forbidden"`; `at` sets `createdAt`. */
    create: mutation({
      payload: { title: Schema.String, at: Schema.optional(Schema.Date) },
      success: Post,
      error: Forbidden,
    }),
    /** No input: the number of posts. */
    count: mutation({ success: Schema.Finite }),
    /** Echoes the `x-user` header (to check header forwarding). */
    whoami: query({ success: Schema.String }),
  },
  /** Emits `0 .. n-1`. */
  ticks: subscription({ payload: { n: Schema.Finite }, success: Schema.Finite }),
});

export type AppRouter = typeof appRouter;

export const createdAt = new Date('2026-01-02T03:04:05.000Z');

export const makePost = (id: number, title = `Post ${id}`, at = createdAt): Post =>
  new Post({ id, title, createdAt: at });

/** Counters of the handler layer: how often it was built and released, and the calls made. */
export interface FixtureState {
  readonly posts: Array<Post>;
  readonly builds: { count: number; released: number };
  readonly calls: Array<string>;
}

export const makeFixture = () => {
  const state: FixtureState = {
    posts: [makePost(1, 'Hello world'), makePost(2), makePost(3)],
    builds: { count: 0, released: 0 },
    calls: [],
  };
  const record = (tag: string) =>
    Effect.sync(() => {
      state.calls.push(tag);
    });
  const routes = Handlers.make(appRouter, {
    boom: () => Effect.die(new Error('kaboom')),
    post: {
      byId: ({ id }) =>
        record('post.byId').pipe(
          Effect.andThen(() => {
            const post = state.posts.find((p) => p.id === id);
            return post === undefined
              ? Effect.fail(new PostNotFound({ id }))
              : Effect.succeed(post);
          }),
        ),
      list: ({ cursor, limit }) =>
        record('post.list').pipe(
          Effect.map(() => {
            const start = cursor ?? 0;
            const end = start + (limit ?? 1);
            return {
              items: state.posts.slice(start, end),
              nextCursor: end < state.posts.length ? end : null,
            };
          }),
        ),
      create: ({ title, at }) =>
        title === 'forbidden'
          ? Effect.fail(new Forbidden({ reason: 'no' }))
          : record('post.create').pipe(
              Effect.map(() => {
                const post = makePost(state.posts.length + 1, title, at ?? createdAt);
                state.posts.push(post);
                return post;
              }),
            ),
      count: () => Effect.sync(() => state.posts.length),
      whoami: (_, { headers }) => Effect.succeed(headers['x-user'] ?? 'anonymous'),
    },
    ticks: ({ n }) => Stream.range(0, n - 1),
  });
  // Count builds and releases of the handler layer (lazy construction / dispose).
  const lifecycle = Layer.effectDiscard(
    Effect.acquireRelease(
      Effect.sync(() => {
        state.builds.count++;
      }),
      () =>
        Effect.sync(() => {
          state.builds.released++;
        }),
    ),
  );
  const handlers = Layer.merge(routes, lifecycle);
  return { state, handlers };
};

const isDehydratedState = (value: unknown): value is DehydratedState =>
  typeof value === 'object' &&
  value !== null &&
  'queries' in value &&
  Array.isArray(value.queries) &&
  'mutations' in value &&
  Array.isArray(value.mutations);

/** A `DehydratedState` serialized like an RSC / SSR payload (JSON) and parsed back. */
export const dehydratedOverTheWire = (state: DehydratedState): DehydratedState => {
  const parsed: unknown = JSON.parse(JSON.stringify(state));
  if (!isDehydratedState(parsed)) throw new Error('not a DehydratedState');
  return parsed;
};
