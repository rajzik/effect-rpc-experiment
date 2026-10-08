import { Effect } from 'effect';
import { effectExpect, effectIt } from '../src/index.js';
import { testServerAndClient } from '../src/index.js';
import { appRouter, HandlersLive, NotFound, User } from './fixtures.js';

effectIt.effect('re-exported @effect/vitest `it.effect` drives the Effect client', () =>
  Effect.gen(function* () {
    const ctx = yield* Effect.acquireRelease(
      Effect.promise(() => testServerAndClient(appRouter, { handlers: HandlersLive })),
      (acquired) => Effect.promise(() => acquired.dispose()),
    );
    const user = yield* ctx.effectClient.user.byId({ id: '1' });
    effectExpect(user).toBeInstanceOf(User);
    const error = yield* Effect.flip(ctx.effectClient.user.byId({ id: 'ghost' }));
    effectExpect(error).toBeInstanceOf(NotFound);
  }),
);
