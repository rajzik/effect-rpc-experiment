// Branch gate node-1.2:N3 — core + server + client composed over real HTTP and the fetch handler.
// Imports the BUILT packages (dist) so it exercises the published surface, not source aliases.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { repoRoot } from './_run.mjs';

const load = async (name) => {
  const entry = resolve(repoRoot, 'packages', name, 'dist', 'index.mjs');
  if (!existsSync(entry))
    throw new Error(`missing build output for ${name}: run vp -C packages/${name} pack`);
  return import(pathToFileURL(entry).href);
};
const effectEntry = resolve(repoRoot, 'packages/core/node_modules/effect');
const { Schema, Effect, Stream } = await import(
  pathToFileURL(resolve(effectEntry, 'dist/index.js')).href
);

const core = await load('core');
const server = await load('server');
const client = await load('client');
const testUtils = await load('test-utils');

const assert = (cond, msg) => {
  if (!cond) {
    process.stdout.write(`[FAIL] ${msg}\n`);
    process.exit(1);
  }
  process.stdout.write(`ok - ${msg}\n`);
};

class User extends Schema.Class('User')({ id: Schema.String, createdAt: Schema.Date }) {
  greet() {
    return `hi ${this.id}`;
  }
}
class NotFound extends Schema.TaggedError()('NotFound', { id: Schema.String }) {}
class Forbidden extends Schema.TaggedError()('Forbidden', {}) {}

const router = core.Router.make({
  user: {
    byId: core.query({
      payload: { id: Schema.String },
      success: User,
      error: Schema.Union([NotFound, Forbidden]),
    }),
    create: core.mutation({ payload: { id: Schema.String }, success: User }),
    ticks: core.subscription({ payload: { n: Schema.Number }, success: Schema.Number }),
  },
});

const handlers = server.Handlers.make(router, {
  user: {
    byId: ({ id }) =>
      id === 'missing'
        ? Effect.fail(new NotFound({ id }))
        : id === 'boom'
          ? Effect.die(new Error('kaboom'))
          : Effect.succeed(new User({ id, createdAt: new Date(0) })),
    create: ({ id }) => Effect.succeed(new User({ id, createdAt: new Date(0) })),
    ticks: ({ n }) => Stream.fromIterable(Array.from({ length: n }, (_, i) => i)),
  },
});

// 1) Real HTTP via the shared test harness.
{
  const ctx = await testUtils.testServerAndClient(router, { handlers });
  try {
    const u = await ctx.client.user.byId({ id: 'a' });
    assert(
      u instanceof User && u.greet() === 'hi a' && u.createdAt instanceof Date,
      'HTTP: Schema.Class instance with method and Date',
    );
    const err = await ctx.client.user.byId({ id: 'missing' }).then(
      () => null,
      (e) => e,
    );
    assert(
      err instanceof NotFound && err._tag === 'NotFound' && err.id === 'missing',
      'HTTP: TaggedError instance on failure',
    );
    const defect = await ctx.client.user.byId({ id: 'boom' }).then(
      () => null,
      (e) => e,
    );
    assert(defect instanceof core.RpcDefect, 'HTTP: handler defect surfaces as RpcDefect');
    const after = await ctx.client.user.byId({ id: 'b' });
    assert(after instanceof User, 'HTTP: connection survives a defect');
    const ticks = [];
    for await (const t of ctx.client.user.ticks({ n: 3 })) ticks.push(t);
    assert(JSON.stringify(ticks) === '[0,1,2]', 'HTTP: subscription streams values in order');
    const eff = await Effect.runPromise(ctx.effectClient.user.byId({ id: 'c' }));
    assert(eff instanceof User, 'HTTP: Effect client returns instance');
  } finally {
    await ctx.dispose();
  }
}

// 2) Fetch web handler (Request -> Response), as used by Next.js / TanStack Start.
{
  const { handler, dispose } = await server.toWebHandler(router, { handlers, path: '/rpc' });
  try {
    const link = client.httpLink({
      url: 'http://effect-trpc.local/rpc',
      fetch: (input, init) => handler(new Request(input, init)),
    });
    const c = client.createClient(router, { link });
    const u = await c.user.byId({ id: 'web' });
    assert(
      u instanceof User && u.greet() === 'hi web',
      'web handler: Schema.Class instance through custom fetch',
    );
    const err = await c.user.byId({ id: 'missing' }).then(
      () => null,
      (e) => e,
    );
    assert(err instanceof NotFound, 'web handler: TaggedError instance');
    await c.dispose();
  } finally {
    await dispose();
  }
}

// 3) In-process caller.
{
  const caller = server.createCaller(router, { handlers });
  const u = await Effect.runPromise(caller.user.byId({ id: 'local' }));
  assert(u instanceof User, 'caller: Effect result is an instance');
  const err = await caller.$promise.user.byId({ id: 'missing' }).then(
    () => null,
    (e) => e,
  );
  assert(err instanceof NotFound, 'caller: promise rejects with TaggedError instance');
  await caller.dispose();
}

process.stdout.write('CORE INTEGRATION VERIFIED\n');
process.exit(0);
