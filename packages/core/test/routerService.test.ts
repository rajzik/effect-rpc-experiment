import { Context, Effect, Schema } from 'effect';
import { describe, expect, it } from 'vite-plus/test';
import { Procedure, query, Router } from '../src/index.js';
import type { RouterService } from '../src/index.js';
import { LogMiddleware, Post, PostNotFound } from './fixtures.js';

const post = new Post({ id: 1, title: 'Hello', createdAt: new Date(0) });

class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.succeed({
    health: query({ success: Schema.Literal('ok') }),
    post: {
      byId: Procedure.input({ id: Schema.Finite })
        .output(Post)
        .error(PostNotFound)
        .query(({ id }) =>
          id === 1 ? Effect.succeed(post) : Effect.fail(new PostNotFound({ id })),
        ),
      create: Procedure.input({ title: Schema.String })
        .output(Post)
        .mutation(({ title }) =>
          Effect.succeed(new Post({ id: 2, title, createdAt: new Date(0) })),
        ),
    },
  }),
}) {}

class AdminRouter extends Context.Service<AdminRouter>()('AdminRouter', {
  make: Effect.succeed({ x: Procedure.output(Schema.Finite).query(() => Effect.succeed(1)) }),
}) {}

describe('Router.fromService', () => {
  it('fromService builds the router from make', () => {
    const router = Router.fromService(AppRouter);
    expect(Router.isRouter(router)).toBe(true);
    expect([...router.procedures.keys()]).toEqual(['health', 'post.byId', 'post.create']);
    expect(router.procedures.get('post.create')?.kind).toBe('mutation');
    expect([...router.group.requests.keys()]).toEqual(['health', 'post.byId', 'post.create']);
    expect(Procedure.hasHandler(router.record.post.byId)).toBe(true);
  });

  it('make runs once per class', () => {
    let runs = 0;
    class Counted extends Context.Service<Counted>()('Counted', {
      make: Effect.sync(() => {
        runs++;
        return { ping: query({ success: Schema.String }) };
      }),
    }) {}
    const a = Router.fromService(Counted);
    const b = Router.fromService(Counted);
    const c = Router.from(Counted);
    const nested = Router.make({ counted: Counted });
    const nestedAgain = Router.make({ again: Counted });
    expect(runs).toBe(1);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(nested.record.counted).toBe(a);
    expect(nestedAgain.record.again).toBe(a);
  });

  it('Router.make nests a service', () => {
    const router = Router.make({ health: query({ success: Schema.String }), admin: AdminRouter });
    expect([...router.procedures.keys()]).toEqual(['health', 'admin.x']);
    expect(Router.isRouter(router.record.admin)).toBe(true);
    expect(router.record.admin).toBe(Router.fromService(AdminRouter));
    expect(router.procedures.get('admin.x')?.rpc._tag).toBe('admin.x');
  });

  it('a service nested in a plain record resolves to a router', () => {
    const router = Router.make({ ns: { admin: AdminRouter } });
    expect([...router.procedures.keys()]).toEqual(['ns.admin.x']);
    expect(router.record.ns.admin).toBe(Router.fromService(AdminRouter));
  });

  it("a service's make may nest routers and services", () => {
    const legacy = Router.make({ count: query({ success: Schema.Finite }) });
    class Outer extends Context.Service<Outer>()('Outer', {
      make: Effect.succeed({
        admin: AdminRouter,
        legacy,
        deep: { admin: AdminRouter },
        own: Procedure.query(() => Effect.void),
      }),
    }) {}
    const router = Router.fromService(Outer);
    expect([...router.procedures.keys()]).toEqual([
      'admin.x',
      'legacy.count',
      'deep.admin.x',
      'own',
    ]);
    expect(router.record.admin).toBe(Router.fromService(AdminRouter));
    expect(router.record.legacy).toBe(legacy);
    expect(Router.isRouter(router.record.deep.admin)).toBe(true);
  });

  it('a router can nest the service that nests it the other way round', () => {
    const inner = Router.make({ admin: AdminRouter });
    class Wrapper extends Context.Service<Wrapper>()('Wrapper', {
      make: Effect.succeed({ inner }),
    }) {}
    const outer = Router.make({ wrapper: Wrapper });
    expect([...outer.procedures.keys()]).toEqual(['wrapper.inner.admin.x']);
  });

  it('router.middleware keeps resolved services', () => {
    const router = Router.make({ admin: AdminRouter }).middleware(LogMiddleware);
    expect([...router.procedures.keys()]).toEqual(['admin.x']);
    expect([...(router.procedures.get('admin.x')?.rpc.middlewares ?? [])]).toContain(LogMiddleware);
    expect(Procedure.hasHandler(router.record.admin.record.x)).toBe(true);
  });

  it('fromService throws a clear error for an async make', async () => {
    let sideEffects = 0;
    class Slow extends Context.Service<Slow>()('SlowRouter', {
      make: Effect.sleep('10 millis').pipe(
        Effect.map(() => {
          sideEffects++;
          return { ping: query({ success: Schema.String }) };
        }),
      ),
    }) {}
    const run = () => Router.fromService(Slow);
    expect(run).toThrow(/SlowRouter/);
    expect(run).toThrow(/make must not require services or be asynchronous/);
    expect(run).not.toThrow(/AsyncFiber/);
    await new Promise((resolve) => setTimeout(resolve, 50));
    // the fibers started by the failed synchronous runs were interrupted
    expect(sideEffects).toBe(0);
  });

  it('fromService throws a clear error for a make that fails or reads a service', () => {
    class Db extends Context.Service<Db, { readonly ok: boolean }>()('Db') {}
    class Failing extends Context.Service<Failing>()('FailingRouter', {
      make: Effect.fail('boom'),
    }) {}
    class NeedsDb extends Context.Service<NeedsDb>()('NeedsDbRouter', {
      make: Effect.gen(function* () {
        yield* Db;
        return { ping: query({ success: Schema.String }) };
      }),
    }) {}
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates a cast that hides the failure from the types
    expect(() => Router.fromService(Failing as unknown as RouterService.Any)).toThrow(
      /FailingRouter.*make must not require services or be asynchronous/,
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates a cast that hides the requirement from the types
    expect(() => Router.fromService(NeedsDb as unknown as RouterService.Any)).toThrow(
      /NeedsDbRouter.*make must not require services or be asynchronous/,
    );
  });

  it('fromService rejects a service that nests itself', () => {
    class Loop extends Context.Service<Loop>()('LoopRouter', {
      make: Effect.suspend((): Effect.Effect<Router.ServiceShape> =>
        Effect.succeed({ loop: { again: Loop } }),
      ),
    }) {}
    expect(() => Router.fromService(Loop)).toThrow(/LoopRouter.*nests the service itself/);
  });

  it('a failed make is not memoized', () => {
    let runs = 0;
    class Flaky extends Context.Service<Flaky>()('FlakyRouter', {
      make: Effect.suspend((): Effect.Effect<Router.ServiceShape> =>
        ++runs === 1
          ? Effect.die('first run fails')
          : Effect.succeed({ ping: query({ success: Schema.String }) }),
      ),
    }) {}
    expect(() => Router.fromService(Flaky)).toThrow(/FlakyRouter/);
    expect([...Router.fromService(Flaky).procedures.keys()]).toEqual(['ping']);
    expect(runs).toBe(2);
  });

  it('fromService rejects a make that does not succeed with a record', () => {
    class NotARecord extends Context.Service<NotARecord>()('NotARecord', {
      make: Effect.succeed(42),
    }) {}
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates a cast that hides the wrong success type
    expect(() => Router.fromService(NotARecord as unknown as RouterService.Any)).toThrow(
      /NotARecord.*make must succeed with a record of procedures/,
    );
  });
});

describe('Router.isService', () => {
  it('recognises router services only', () => {
    class Plain extends Context.Service<Plain, { readonly n: number }>()('Plain') {}
    expect(Router.isService(AppRouter)).toBe(true);
    expect(Router.isService(AdminRouter)).toBe(true);
    expect(Router.isService(Plain)).toBe(false);
    expect(Router.isService(Router.fromService(AppRouter))).toBe(false);
    expect(Router.isService({ make: Effect.succeed({}) })).toBe(false);
    expect(Router.isService(query({ success: Schema.String }))).toBe(false);
    expect(Router.isService(undefined)).toBe(false);
    expect(Router.isService(Date)).toBe(false);
  });
});

describe('Router.from', () => {
  it('returns routers unchanged and resolves services', () => {
    const router = Router.make({ health: query({ success: Schema.String }) });
    expect(Router.from(router)).toBe(router);
    expect(Router.from(AppRouter)).toBe(Router.fromService(AppRouter));
  });

  it('throws for anything else', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- untyped JavaScript callers can pass anything
    const notARouter = { health: query({ success: Schema.String }) } as unknown as Router.Input;
    expect(() => Router.from(notARouter)).toThrow(
      /expected a router \(Router\.make\) or a router service/,
    );
  });
});
