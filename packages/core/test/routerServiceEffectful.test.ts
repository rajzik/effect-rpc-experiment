import { Cause, Context, Effect, Exit, Ref, Schema } from 'effect';
import { describe, expect, it } from 'vite-plus/test';
import { Procedure, Router } from '../src/index.js';

class AppConfig extends Context.Service<AppConfig, { readonly prefix: string }>()('AppConfig') {}

class Database extends Context.Service<
  Database,
  { readonly title: (id: number) => Effect.Effect<string> }
>()('Database') {}

class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {}) {}

class PostRouter extends Context.Service<PostRouter>()('PostRouter', {
  make: Effect.gen(function* () {
    const db = yield* Database;
    return {
      byId: Procedure.input({ id: Schema.Finite })
        .output(Schema.String)
        .query(({ id }) => db.title(id)),
    };
  }),
}) {}

class AppRouter extends Context.Service<AppRouter>()('AppRouter', {
  make: Effect.gen(function* () {
    const cfg = yield* AppConfig;
    if (cfg.prefix === '') return yield* new ConfigError();
    return {
      health: Procedure.output(Schema.String).query(() => Effect.succeed(cfg.prefix)),
      post: PostRouter,
    };
  }),
}) {}

class PureRouter extends Context.Service<PureRouter>()('PureRouter', {
  make: Effect.succeed({ ping: Procedure.output(Schema.String).query(() => Effect.succeed('p')) }),
}) {}

class Counter extends Context.Service<Counter, Ref.Ref<number>>()('Counter') {}

class CountedRouter extends Context.Service<CountedRouter>()('CountedRouter', {
  make: Effect.gen(function* () {
    yield* Ref.update(yield* Counter, (n) => n + 1);
    return { x: Procedure.output(Schema.Finite).query(() => Effect.succeed(1)) };
  }),
}) {}

class TwiceRouter extends Context.Service<TwiceRouter>()('TwiceRouter', {
  make: Effect.succeed({ a: CountedRouter, b: { c: CountedRouter } }),
}) {}

const provideApp =
  (prefix: string) =>
  <A, E>(effect: Effect.Effect<A, E, AppConfig | Database>) =>
    effect.pipe(
      Effect.provideService(AppConfig, { prefix }),
      Effect.provideService(Database, { title: (id) => Effect.succeed(`post ${id}`) }),
    );

/** Runs `effect` and returns its defect, asserting it died (no typed failure). */
const defectOf = async (effect: Effect.Effect<unknown, unknown>): Promise<unknown> => {
  const exit = await Effect.runPromiseExit(effect);
  if (!Exit.isFailure(exit)) throw new Error('expected a failure');
  expect(Cause.hasDies(exit.cause)).toBe(true);
  expect(Cause.hasFails(exit.cause)).toBe(false);
  return Cause.squash(exit.cause);
};

describe('Router.buildService', () => {
  it('buildService runs make with provided services', async () => {
    const { router, value } = await Effect.runPromise(
      Router.buildService(AppRouter).pipe(provideApp('v1')),
    );
    expect(Router.isRouter(router)).toBe(true);
    expect([...router.procedures.keys()]).toEqual(['health', 'post.byId']);
    expect(value.post).toBe(PostRouter);
  });

  it('make runs once per run', async () => {
    const counts = await Effect.runPromise(
      Effect.gen(function* () {
        const counter = yield* Ref.make(0);
        const run = <A, E>(effect: Effect.Effect<A, E, Counter>) =>
          Effect.provideService(effect, Counter, counter);
        yield* run(Router.buildService(CountedRouter));
        yield* run(Router.buildService(CountedRouter));
        const twoRuns = yield* Ref.get(counter);
        yield* Ref.set(counter, 0);
        const { router } = yield* run(Router.buildService(TwiceRouter));
        expect([...router.procedures.keys()]).toEqual(['a.x', 'b.c.x']);
        expect(router.record.b.c).toBe(router.record.a);
        return [twoRuns, yield* Ref.get(counter)];
      }),
    );
    expect(counts).toEqual([2, 1]);
  });

  it('make failure', async () => {
    const error = await Effect.runPromise(
      Router.buildService(AppRouter).pipe(Effect.flip, provideApp('')),
    );
    expect(error).toBeInstanceOf(ConfigError);
  });

  it('a service that nests itself dies', async () => {
    class Loop extends Context.Service<Loop>()('LoopRouter', {
      make: Effect.suspend((): Effect.Effect<Router.ServiceShape> =>
        Effect.succeed({ loop: { again: Loop } }),
      ),
    }) {}
    const defect = await defectOf(Router.buildService(Loop));
    expect(defect).toBeInstanceOf(Error);
    expect(String(defect)).toMatch(/LoopRouter.*nests the service itself/);
  });

  it('a make that succeeds with a router or a non-record dies', async () => {
    class RouterMake extends Context.Service<RouterMake>()('RouterMakeRouter', {
      make: Effect.succeed(
        Router.make({ ping: Procedure.output(Schema.String).query(() => Effect.succeed('p')) }),
      ),
    }) {}
    class NumberMake extends Context.Service<NumberMake>()('NumberMakeRouter', {
      make: Effect.succeed(42),
    }) {}
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates a cast that hides the router result from the types
    expect(String(await defectOf(Router.buildService(RouterMake as never)))).toMatch(
      /RouterMakeRouter.*make must succeed with a record of procedures, not a router/,
    );
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates a cast that hides the non-record result from the types
    expect(String(await defectOf(Router.buildService(NumberMake as never)))).toMatch(
      /NumberMakeRouter.*make must succeed with a record of procedures$/,
    );
  });

  it('forced effectful class in Router.from throws', () => {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- simulates a cast that hides make's requirements from the types
    expect(() => Router.from(AppRouter as never)).toThrow(
      /"AppRouter".*router\.client\.gen\.ts.*Handlers\.fromService/,
    );
  });

  it('pure service via buildService equals Router.fromService tags', async () => {
    const { router } = await Effect.runPromise(Router.buildService(PureRouter));
    expect([...router.procedures.keys()]).toEqual([
      ...Router.fromService(PureRouter).procedures.keys(),
    ]);
  });

  it('runs make again for a router service already built by Router.fromService', async () => {
    let runs = 0;
    class Memo extends Context.Service<Memo>()('MemoRouter', {
      make: Effect.sync(() => {
        runs++;
        return { x: Procedure.output(Schema.Finite).query(() => Effect.succeed(1)) };
      }),
    }) {}
    class Outer extends Context.Service<Outer>()('MemoOuterRouter', {
      make: Effect.succeed({ a: Memo }),
    }) {}
    const router = Router.fromService(Memo);
    const built = await Effect.runPromise(Router.buildService(Memo));
    expect(built.router).not.toBe(router);
    expect(runs).toBe(2);
    // Nested resolution runs it again too.
    const outer = await Effect.runPromise(Router.buildService(Outer));
    expect(outer.router.record.a).not.toBe(router);
    expect(runs).toBe(3);
    expect(Router.fromService(Memo)).toBe(router); // the synchronous APIs keep their own build
  });
});
