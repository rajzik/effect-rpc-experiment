/**
 * Vitest helpers for effect-trpc tests: `@effect/vitest` re-exports and {@link assertInstance}.
 *
 * `effectIt` / `effectExpect` are `it` / `expect` from `@effect/vitest`, re-exported so a test
 * file can drive the Effect client (`effectIt.effect(...)`, `effectIt.layer(...)`) with one
 * import. {@link assertInstance} checks that `Schema.Class` / `Schema.TaggedError` values that
 * crossed the wire are real instances and narrows them.
 *
 * @since 0.1.0
 */

/**
 * `effectIt` is `it` and `effectExpect` is `expect` from `@effect/vitest` (`effectIt.effect`,
 * `effectIt.layer`, `effectIt.live`, ...). Use them to run `Effect.gen` tests against
 * `ctx.effectClient` or a caller; see `test/effect-vitest.test.ts`.
 *
 * @since 0.1.0
 */
export { expect as effectExpect, it as effectIt } from '@effect/vitest';

/**
 * Asserts that `value` is an instance of `Cls` (e.g. a `Schema.Class` or `Schema.TaggedError`
 * that crossed the wire) and narrows it.
 *
 * **When to use**
 *
 * Use on values from a client call or a `catch` (typed `unknown`) to prove that decoding restored
 * the class, and to access its fields and methods without a cast.
 *
 * **Details**
 *
 * - Throws a `TypeError` with `message` or `expected an instance of <Cls.name>, got <actual>`,
 *   where `<actual>` is the constructor name, or `String(value)` for primitives and `null`.
 * - Inside `Effect.gen` the throw becomes a defect that fails the test.
 *
 * **Example** (Narrowing a rejected call's error)
 *
 * ```ts
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@rpc-effect/core';
 * import { Handlers } from '@rpc-effect/server';
 * import { assertInstance, testServerAndClient } from '@rpc-effect/test-utils';
 * import { expect, it } from '@effect/vitest';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 *
 * const appRouter = Router.make({
 *   user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
 * });
 * const HandlersLive = Handlers.make(appRouter, {
 *   user: { byId: ({ id }) => Effect.fail(new NotFound({ id })) },
 * });
 *
 * it('rejects with NotFound', async () => {
 *   await using ctx = await testServerAndClient(appRouter, { handlers: HandlersLive });
 *   const error = await ctx.client.user.byId({ id: 'ghost' }).catch((e: unknown) => e);
 *   assertInstance(error, NotFound);
 *   expect(error.id).toBe('ghost'); // narrowed to NotFound
 * });
 * ```
 *
 * @category testing
 * @since 0.1.0
 */
export const assertInstance: <A>(
  value: unknown,
  Cls: abstract new (...args: never) => A,
  message?: string,
) => asserts value is A = (value, Cls, message) => {
  if (!(value instanceof Cls)) {
    const actual =
      value === null || typeof value !== 'object'
        ? String(value)
        : (value.constructor?.name ?? 'Object');
    throw new TypeError(message ?? `expected an instance of ${Cls.name}, got ${actual}`);
  }
};
