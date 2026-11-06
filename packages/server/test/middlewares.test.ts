// Port of tRPC tests/server/middlewares.test.ts: middleware chaining, context, errors.
import { Context, Effect, Layer, Schema } from 'effect';
import { mutation, query, Router } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import { createCaller, Handlers, Middleware } from '../src/index.js';
import { rejection } from './fixtures.js';

class Session extends Context.Service<Session, { readonly userId: string }>()('Session') {}
class Role extends Context.Service<Role, { readonly admin: boolean }>()('Role') {}

class NotLoggedIn extends Schema.TaggedError<NotLoggedIn>()('NotLoggedIn', {}) {}
class NotAdmin extends Schema.TaggedError<NotAdmin>()('NotAdmin', { userId: Schema.String }) {}

class Authn extends Middleware.make<Authn, { provides: Session }>()('Authn', {
  error: NotLoggedIn,
}) {}
class Authz extends Middleware.make<Authz, { provides: Role }>()('Authz', { error: NotAdmin }) {}
class Timing extends Middleware.make<Timing>()('Timing') {}

// effect/rpc middleware added later wraps the middleware added before it, so it runs FIRST:
// here Timing (router level) runs first, then Authn, then Authz, then the handler.
const router = Router.make({
  publicGreeting: query({ success: Schema.String }),
  whoami: query({ success: Schema.String }).middleware(Authn),
  admin: {
    wipe: mutation({ success: Schema.String }).middleware(Authz).middleware(Authn),
  },
}).middleware(Timing);

const makeLayer = (log: Array<string>) => {
  const AuthnLive = Layer.succeed(Authn)(
    Authn.of((effect, { headers }) =>
      Effect.suspend(() => {
        log.push('authn');
        const userId = headers['authorization']?.replace('Bearer ', '');
        return userId === undefined
          ? Effect.fail(new NotLoggedIn())
          : Effect.provideService(effect, Session, { userId });
      }),
    ),
  );
  const AuthzLive = Layer.succeed(Authz)(
    Authz.of((effect, { headers }) =>
      Effect.suspend(() => {
        log.push('authz');
        const userId = headers['authorization']?.replace('Bearer ', '') ?? '';
        return userId === 'root'
          ? Effect.provideService(effect, Role, { admin: true })
          : Effect.fail(new NotAdmin({ userId }));
      }),
    ),
  );
  const TimingLive = Layer.succeed(Timing)(
    Timing.of((effect, { rpc }) =>
      Effect.ensuring(
        Effect.andThen(
          Effect.sync(() => log.push(`timing:start:${rpc._tag}`)),
          effect,
        ),
        Effect.sync(() => log.push(`timing:end:${rpc._tag}`)),
      ),
    ),
  );
  const HandlersLive = Handlers.make(router, {
    publicGreeting: () => Effect.succeed('hello'),
    whoami: () =>
      Effect.gen(function* () {
        const session = yield* Session;
        log.push('handler');
        return session.userId;
      }),
    admin: {
      wipe: () =>
        Effect.gen(function* () {
          const session = yield* Session;
          const role = yield* Role;
          log.push('handler');
          return `${session.userId}:${role.admin}`;
        }),
    },
  });
  return Layer.mergeAll(HandlersLive, AuthnLive, AuthzLive, TimingLive);
};

const setup = () => {
  const log: Array<string> = [];
  const caller = createCaller(router, { handlers: makeLayer(log) });
  return { log, caller };
};

describe('middlewares', () => {
  it('router-level middleware wraps every procedure', async () => {
    const { log, caller } = setup();
    try {
      expect(await caller.$promise.publicGreeting()).toBe('hello');
      expect(log).toEqual(['timing:start:publicGreeting', 'timing:end:publicGreeting']);
    } finally {
      await caller.dispose();
    }
  });

  it('middleware provides context to the handler', async () => {
    const { log, caller } = setup();
    try {
      const id = await caller.$promise.whoami(undefined, {
        headers: { authorization: 'Bearer ada' },
      });
      expect(id).toBe('ada');
      expect(log).toEqual(['timing:start:whoami', 'authn', 'handler', 'timing:end:whoami']);
    } finally {
      await caller.dispose();
    }
  });

  it('chains middleware: outermost first, each provides its own service', async () => {
    const { log, caller } = setup();
    try {
      const result = await caller.$promise.admin.wipe(undefined, {
        headers: { authorization: 'Bearer root' },
      });
      expect(result).toBe('root:true');
      expect(log).toEqual([
        'timing:start:admin.wipe',
        'authn',
        'authz',
        'handler',
        'timing:end:admin.wipe',
      ]);
    } finally {
      await caller.dispose();
    }
  });

  it('a failing middleware stops the chain with its typed error', async () => {
    const { log, caller } = setup();
    try {
      expect(await rejection(caller.$promise.admin.wipe())).toBeInstanceOf(NotLoggedIn);
      const notAdmin = await rejection(
        caller.$promise.admin.wipe(undefined, { headers: { authorization: 'Bearer ada' } }),
      );
      expect(notAdmin).toBeInstanceOf(NotAdmin);
      expect(notAdmin).toMatchObject({ userId: 'ada' });
      expect(log).not.toContain('handler');
    } finally {
      await caller.dispose();
    }
  });

  it('middleware errors are part of the Effect error type', async () => {
    const { caller } = setup();
    try {
      const error = await Effect.runPromise(Effect.flip(caller.admin.wipe()));
      expect(error._tag).toBe('NotLoggedIn');
    } finally {
      await caller.dispose();
    }
  });
});
