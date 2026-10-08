export { expect as effectExpect, it as effectIt } from '@effect/vitest';

/**
 * Asserts that `value` is an instance of `Cls` (e.g. a `Schema.Class` or `Schema.TaggedError`
 * that crossed the wire) and narrows it. Throws a descriptive `TypeError` otherwise; inside
 * `Effect.gen` the throw becomes a defect that fails the test.
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
