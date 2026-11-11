// Chained `Router.withSchemas` overlays: a later overlay keeps the schemas of the earlier ones it
// does not replace, over a router service as over a plain router, at nested paths too.
import { Context, Effect, Schema } from 'effect';
import { Procedure, Router } from '@rpc-effect/core';
import { Handlers } from '@rpc-effect/server';
import { describe, expect, it } from 'vite-plus/test';
import { testServerAndClient } from '../src/index.js';

class Missing extends Schema.TaggedError<Missing>()('Missing', {}) {}

const procedures = {
  a: Procedure.query(() => Effect.succeed('first')),
  b: Procedure.query(() => Effect.succeed(2)),
  nested: {
    c: Procedure.query(() => Effect.succeed(true)),
    d: Procedure.query(() => Effect.fail(new Missing())),
  },
};

class App extends Context.Service<App>()('App', { make: Effect.succeed(procedures) }) {}

const firstSchemas = {
  a: { output: Schema.String },
  nested: { c: { output: Schema.Boolean }, d: { output: Schema.String } },
};
const secondSchemas = { b: { output: Schema.Finite }, nested: { d: { error: Missing } } };

const service = Router.withSchemas(Router.withSchemas(App, firstSchemas), secondSchemas);
const plain = Router.withSchemas(
  Router.withSchemas(Router.make(procedures), firstSchemas),
  secondSchemas,
);

describe('chained Router.withSchemas', () => {
  it.each([
    ['a router service', Router.from(service), Handlers.fromService(service)],
    ['a router', plain, Handlers.fromProcedures(plain)],
  ])('over %s keeps the earlier schemas', async (_, router, handlers) => {
    await using ctx = await testServerAndClient(router, { handlers });
    expect(await ctx.client.a()).toBe('first');
    expect(await ctx.client.b()).toBe(2);
    expect(await ctx.client.nested.c()).toBe(true);
    expect(await ctx.client.nested.d().catch((e: unknown) => e)).toBeInstanceOf(Missing);
    expect(router.record.nested.d.successSchema).toBe(Schema.String);
  });
});
