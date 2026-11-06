import { Context, Effect, Layer } from 'effect';
import { Procedure } from '@effect-trpc/core';
import type { Router } from '@effect-trpc/core';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { createClient, localLink } from '../src/index.js';
import type { Client, CreateClientOptions } from '../src/index.js';
import { AppHandlers, AppRouter, plainRouter } from './service-fixtures.js';
import type { Post, PostNotFound } from './service-fixtures.js';

declare const plain: Client<typeof plainRouter>;

/** Generic code over `Router.Any` keeps `Client<R>` (the first overload). */
const forRouter = <R extends Router.Any>(router: R, options: CreateClientOptions<R>): Client<R> =>
  createClient(router, options);
/** Generic code over `Router.Input` gets `Client<Router.Of<X>>` (the second overload). */
const forInput = <X extends Router.Input>(
  input: X,
  options: CreateClientOptions<Router.Of<X>>,
): Client<Router.Of<X>> => createClient(input, options);

describe('createClient with a router service (types)', () => {
  it('accepts typeof Svc and infers the client of Router.Of<typeof Svc>', () => {
    const client = createClient(AppRouter, { link: localLink({ handlers: AppHandlers }) });
    expectTypeOf(client).toEqualTypeOf<Client<Router.Of<typeof AppRouter>>>();
    expectTypeOf(client.$router).toEqualTypeOf<Router.Of<typeof AppRouter>>();
  });

  it('infers the same calls as the Router.make equivalent', () => {
    const client = createClient(AppRouter, { link: localLink({ handlers: AppHandlers }) });
    expectTypeOf(client.post.byId).toEqualTypeOf<typeof plain.post.byId>();
    expectTypeOf(client.post.byId).returns.toEqualTypeOf<Promise<Post>>();
    expectTypeOf(client.health).toEqualTypeOf<typeof plain.health>();
    expectTypeOf(client.post.titles).toEqualTypeOf<typeof plain.post.titles>();
    expectTypeOf(client.$effect.post.byId).toEqualTypeOf<typeof plain.$effect.post.byId>();
    expectTypeOf(client.$effect.post.titles).toEqualTypeOf<typeof plain.$effect.post.titles>();
    expectTypeOf<Client.Error<typeof client.$router.record.post.byId>>().toEqualTypeOf<
      Client.Error<typeof plainRouter.record.post.byId>
    >();
    expectTypeOf<
      Extract<
        Client.Error<typeof client.$router.record.post.byId>,
        { readonly _tag: 'PostNotFound' }
      >
    >().toEqualTypeOf<PostNotFound>();
  });

  it('Client<Router.Of<typeof Svc>> annotates a service client', () => {
    const client: Client<Router.Of<typeof AppRouter>> = createClient(AppRouter, {
      link: localLink({ handlers: AppHandlers }),
    });
    expectTypeOf(client.post.byId).returns.toEqualTypeOf<Promise<Post>>();
    expectTypeOf(client.$router).toEqualTypeOf<Router.Of<typeof AppRouter>>();
  });

  it('generic code keeps its types: Router.Any stays Client<R>, Router.Input maps with Router.Of', () => {
    expectTypeOf(
      forRouter(plainRouter, { link: localLink({ handlers: AppHandlers }) }),
    ).toEqualTypeOf<Client<typeof plainRouter>>();
    expectTypeOf(forInput(AppRouter, { link: localLink({ handlers: AppHandlers }) })).toEqualTypeOf<
      Client<Router.Of<typeof AppRouter>>
    >();
  });

  it('type queries on the instantiated createClient compile', () => {
    // `ReturnType<typeof createClient>` (uninstantiated) hits TS2589 because of the overloads:
    // instantiate it with a router type, or use `Client<R>` / `CreateClientOptions<R>`.
    expectTypeOf<ReturnType<typeof createClient<typeof plainRouter>>>().toEqualTypeOf<
      Client<typeof plainRouter>
    >();
    expectTypeOf<Parameters<typeof createClient<typeof plainRouter>>[1]>().toEqualTypeOf<
      CreateClientOptions<typeof plainRouter>
    >();
    // For a router service, instantiate with its router type `Router.Of<typeof Svc>`.
    type AppRouterOf = Router.Of<typeof AppRouter>;
    expectTypeOf<ReturnType<typeof createClient<AppRouterOf>>>().toEqualTypeOf<
      Client<AppRouterOf>
    >();
  });

  it('rejects a router service whose make needs services', () => {
    class Config extends Context.Service<Config, { readonly url: string }>()('Config') {}
    class NeedsConfig extends Context.Service<NeedsConfig>()('NeedsConfig', {
      make: Effect.gen(function* () {
        yield* Config;
        return { ok: Procedure.query(() => Effect.void) };
      }),
    }) {}
    expectTypeOf(NeedsConfig).not.toExtend<Router.Input>();
    // @ts-expect-error - make must be Effect<Record, never, never>: read services inside handlers
    createClient(NeedsConfig, { link: localLink({ handlers: Layer.empty }) }); // oxlint-disable-line effecttsgo/missing-effect-context -- the service is passed on purpose to prove the compile error
  });

  it('a link missing handlers is still a type error', () => {
    expectTypeOf(plainHandlersMissing).not.toExtend<typeof AppHandlers>();
    // @ts-expect-error -- the handlers of the service's procedures are required
    createClient(AppRouter, { link: localLink({ handlers: plainHandlersMissing }) });
  });
});

declare const plainHandlersMissing: import('effect').Layer.Layer<never>;
