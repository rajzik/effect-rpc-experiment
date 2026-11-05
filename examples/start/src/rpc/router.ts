import { query, Router } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import { Effect, Schema } from 'effect';

export const appRouter = Router.make({
  ping: query({ success: Schema.String }),
});

export const ServerLive = Handlers.make(appRouter, {
  ping: () => Effect.succeed('pong'),
});
