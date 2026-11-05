// The demo router's server side. Samples import it as `@/server`: handlers plus the Auth
// middleware implementation, merged into the one layer every adapter takes as `handlers`.
import { Effect, Layer, Stream } from 'effect';
import { Handlers } from '@effect-trpc/server';

import {
  appRouter,
  Auth,
  CurrentUser,
  Forbidden,
  Post,
  PostNotFound,
  PostPage,
  Unauthorized,
} from '@/router';

const posts = [
  new Post({ id: 1, title: 'Hello Effect', createdAt: new Date('2026-01-01') }),
  new Post({ id: 2, title: 'Typed errors', createdAt: new Date('2026-02-01') }),
  new Post({ id: 3, title: 'Schema classes', createdAt: new Date('2026-03-01') }),
];

export const HandlersLive = Handlers.make(appRouter, {
  health: () => Effect.succeed('ok' as const),
  post: {
    byId: ({ id }) => {
      const post = posts.find((p) => p.id === id);
      return post ? Effect.succeed(post) : Effect.fail(new PostNotFound({ id }));
    },
    list: ({ cursor }) => {
      const start = cursor ?? 0;
      const items = posts.slice(start, start + 2);
      const next = start + 2 < posts.length ? start + 2 : null;
      return Effect.succeed(new PostPage({ items, nextCursor: next }));
    },
    create: ({ title }) =>
      Effect.gen(function* () {
        const user = yield* CurrentUser; // provided by Auth
        if (user.name === 'guest') return yield* new Forbidden({ reason: 'guests cannot post' });
        return new Post({ id: posts.length + 1, title, createdAt: new Date() });
      }),
    onCreated: () => Stream.fromIterable(posts),
  },
});

// Reads `authorization: Bearer <name>`; no header → Unauthorized.
export const AuthLive = Layer.succeed(Auth)(
  Auth.of((effect, { headers }) => {
    const name = headers['authorization']?.replace(/^Bearer /, '');
    return name === undefined
      ? Effect.fail(new Unauthorized())
      : Effect.provideService(effect, CurrentUser, { name });
  }),
);

export const ServerLive = Layer.mergeAll(HandlersLive, AuthLive);
