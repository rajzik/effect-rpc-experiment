// The fixture router of the TanStack Start adapter tests.
import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import { QueryClient } from '@tanstack/react-query';
import { Effect, Schema, Stream } from 'effect';

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
  /** Dies (a defect). */
  boom: query({ success: Schema.String }),
  post: {
    /** `id: 404` (or any unknown id) fails with `PostNotFound`. */
    byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }),
    /** Cursor-paginated (cursor = index of the first item). */
    list: query({
      payload: {
        cursor: Schema.optional(Schema.NullOr(Schema.Number)),
        limit: Schema.optional(Schema.Number),
      },
      success: PostPage,
    }),
    /** Fails with `Forbidden` when the title is `"forbidden"`. */
    create: mutation({ payload: { title: Schema.String }, success: Post, error: Forbidden }),
  },
  /** Emits `count` posts. */
  feed: subscription({ payload: { count: Schema.Number }, success: Post }),
});

export type AppRouter = typeof appRouter;

export const createdAt = new Date('2026-01-02T03:04:05.000Z');

export const makePost = (id: number, title = `Post ${id}`): Post =>
  new Post({ id, title, createdAt });

/** A fresh handler layer with its own state; `state.built` counts layer constructions. */
export const makeFixture = () => {
  const state = {
    posts: [makePost(1, 'Hello world'), makePost(2), makePost(3)],
    built: 0,
    released: 0,
  };
  const handlers = Handlers.make(
    appRouter,
    Effect.gen(function* () {
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          state.built++;
        }),
        () =>
          Effect.sync(() => {
            state.released++;
          }),
      );
      return {
        boom: () => Effect.die(new Error('kaboom')),
        post: {
          byId: ({ id }: { readonly id: number }) => {
            const post = state.posts.find((p) => p.id === id);
            return post === undefined
              ? Effect.fail(new PostNotFound({ id }))
              : Effect.succeed(post);
          },
          list: (payload: {
            readonly cursor?: number | null | undefined;
            readonly limit?: number | undefined;
          }) =>
            Effect.sync(() => {
              const start = payload.cursor ?? 0;
              const end = start + (payload.limit ?? 1);
              return {
                items: state.posts.slice(start, end),
                nextCursor: end < state.posts.length ? end : null,
              };
            }),
          create: ({ title }: { readonly title: string }) =>
            title === 'forbidden'
              ? Effect.fail(new Forbidden({ reason: 'no' }))
              : Effect.sync(() => {
                  const post = makePost(state.posts.length + 1, title);
                  state.posts.push(post);
                  return post;
                }),
        },
        feed: ({ count }: { readonly count: number }) =>
          Stream.range(1, count).pipe(Stream.map((id) => makePost(id))),
      };
    }),
  );
  return { state, handlers };
};

export const makeQueryClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** A raw `effect/rpc` request message, as an `RpcClient` sends it (one NDJSON line). */
export const rpcBody = (tag: string, payload: unknown = null, id = '1'): string =>
  `${JSON.stringify({ _tag: 'Request', id, tag, payload, headers: [] })}\n`;

/** A raw rpc POST request. */
export const rpcRequest = (url: string, tag: string, payload?: unknown): Request =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/ndjson' },
    body: rpcBody(tag, payload),
  });

export interface Frame {
  readonly _tag: string;
  readonly values?: ReadonlyArray<unknown>;
  readonly exit?: unknown;
}

/** Parses an NDJSON response body into rpc frames. */
export const readFrames = async (response: Response): Promise<ReadonlyArray<Frame>> =>
  (await response.text())
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Frame);

/** The encoded exit of the single `Exit` frame. */
export const exitOf = (frames: ReadonlyArray<Frame>): unknown =>
  frames.find((frame) => frame._tag === 'Exit')?.exit;
