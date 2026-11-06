import { query, Router } from '@effect-trpc/core';
import type { Effect, Layer, Stream } from 'effect';
import { Schema } from 'effect';
import { RpcMiddleware } from 'effect/rpc';
import type { Rpc } from 'effect/rpc';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import {
  createClient,
  httpLink,
  localLink,
  type Client,
  type ClientError,
  type ProcedureCallOptions,
  type RpcDefect,
  type RpcInterrupted,
  type RpcTransportError,
} from '../src/index.js';
import {
  appRouter,
  makeHandlers,
  type AppRouter,
  type Forbidden,
  type NotFound,
  type Unauthorized,
  type User,
} from './fixtures.js';

declare const client: Client<AppRouter>;

const partial = Router.make({ health: query({ success: Schema.Literal('ok') }) });
declare const partialHandlers: Layer.Layer<Rpc.ToHandler<Router.Rpcs<typeof partial>>>;

class Token extends RpcMiddleware.Service<Token>()('Token', { requiredForClient: true }) {}
const router = Router.make({ secret: query({ success: Schema.String }).middleware(Token) });
declare const tokenClient: Layer.Layer<RpcMiddleware.ForClient<Token>>;
type Rec = Router.Record<AppRouter>;

describe('Promise client types', () => {
  it('returns Promise<Output> for queries and mutations', () => {
    expectTypeOf(client.user.byId).returns.toEqualTypeOf<Promise<User>>();
    expectTypeOf(client.user.create).returns.toEqualTypeOf<Promise<User>>();
    expectTypeOf(client.health).returns.toEqualTypeOf<Promise<'ok'>>();
  });

  it('documents the rejection type as ClientError<E>', () => {
    expectTypeOf<Client.Error<Rec['user']['byId']>>().toEqualTypeOf<
      NotFound | Forbidden | RpcDefect | RpcTransportError | RpcInterrupted
    >();
    expectTypeOf<Client.Error<Rec['user']['byId']>>().toEqualTypeOf<
      ClientError<NotFound | Forbidden>
    >();
    expectTypeOf<Client.Error<Rec['whoami']>>().toEqualTypeOf<ClientError<Unauthorized>>();
    expectTypeOf<Client.Error<Rec['health']>>().toEqualTypeOf<ClientError<never>>();
  });

  it('checks inputs against the payload schema', () => {
    expectTypeOf(client.user.byId).parameter(0).toEqualTypeOf<{ readonly id: string }>();
    // @ts-expect-error - wrong field type
    void client.user.byId({ id: 1 });
    // @ts-expect-error - missing input
    void client.user.byId();
    // @ts-expect-error - unknown field
    void client.user.byId({ id: '1', extra: true });
    // @ts-expect-error - unknown procedure
    void client.user.nope;
  });

  it('allows calling void-payload procedures without arguments', () => {
    expectTypeOf(client.health).toBeCallableWith();
    expectTypeOf(client.user.reset).toBeCallableWith(undefined, {
      signal: new AbortController().signal,
    });
    expectTypeOf(client.health).parameter(1).toEqualTypeOf<ProcedureCallOptions | undefined>();
  });

  it('returns AsyncIterable<Output> for subscriptions', () => {
    expectTypeOf(client.ticks).returns.toEqualTypeOf<AsyncIterable<number>>();
    expectTypeOf(client.tickStream).parameter(0).toEqualTypeOf<{ readonly failAt: number }>();
  });

  it('exposes the client methods', () => {
    expectTypeOf(client.$router).toEqualTypeOf<AppRouter>();
    expectTypeOf(client.dispose).returns.toEqualTypeOf<Promise<void>>();
    expectTypeOf(client.withHeaders({ a: 'b' })).toEqualTypeOf<Client<AppRouter>>();
  });
});

describe('Effect client types', () => {
  it('has exactly E | RpcTransportError in the error channel and no requirements', () => {
    expectTypeOf(client.$effect.user.byId).returns.toEqualTypeOf<
      Effect.Effect<User, NotFound | Forbidden | RpcTransportError>
    >();
    expectTypeOf(client.$effect.whoami).returns.toEqualTypeOf<
      Effect.Effect<string, Unauthorized | RpcTransportError>
    >();
    expectTypeOf(client.$effect.health).returns.toEqualTypeOf<
      Effect.Effect<'ok', RpcTransportError>
    >();
    expectTypeOf<Client.Effect<AppRouter>>().toEqualTypeOf(client.$effect);
  });

  it('returns Streams for subscriptions', () => {
    expectTypeOf(client.$effect.ticks).returns.toEqualTypeOf<
      Stream.Stream<number, RpcTransportError>
    >();
    expectTypeOf(client.$effect.tickStream).returns.toEqualTypeOf<
      Stream.Stream<number, NotFound | RpcTransportError>
    >();
  });

  it('checks inputs', () => {
    expectTypeOf(client.$effect.user.create)
      .parameter(0)
      .toEqualTypeOf<{ readonly name: string }>();
    // @ts-expect-error - wrong payload
    void client.$effect.user.create({ title: 'x' });
    // @ts-expect-error - Effect calls take no signal
    void client.$effect.health(undefined, { signal: new AbortController().signal });
  });
});

describe('createClient option types', () => {
  it('requires the localLink handlers to implement the router', () => {
    expectTypeOf(
      createClient(appRouter, { link: localLink({ handlers: makeHandlers() }) }),
    ).toEqualTypeOf<Client<AppRouter>>();
    // @ts-expect-error - handlers for `user.byId`, `ticks`, ... and the `Auth` middleware are missing
    createClient(appRouter, { link: localLink({ handlers: partialHandlers }) });
    createClient(partial, { link: localLink({ handlers: partialHandlers }) });
    // network links fit any router
    createClient(partial, { link: httpLink({ url: 'http://localhost/rpc' }) });
  });

  it('requires a middleware layer for requiredForClient middleware', () => {
    const link = httpLink({ url: 'http://localhost/rpc' });
    // @ts-expect-error - `middleware` is required
    createClient(router, { link });
    expectTypeOf(
      createClient(router, { link, middleware: tokenClient }).secret,
    ).returns.toEqualTypeOf<Promise<string>>();
  });
});
