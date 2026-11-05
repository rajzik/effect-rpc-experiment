import { expect } from 'vite-plus/test';

/** Returns the rejection of a promise, failing the test if it resolves. */
export const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
};

/** Collects an async iterable; returns the values and the thrown error (if any). */
export const drain = async <A>(
  iterable: AsyncIterable<A>,
): Promise<{ readonly values: ReadonlyArray<A>; readonly error: unknown }> => {
  const values: Array<A> = [];
  try {
    for await (const value of iterable) values.push(value);
  } catch (error) {
    return { values, error };
  }
  return { values, error: undefined };
};

/** Resolves when `promise` settles, or rejects after `ms` milliseconds. */
export const within = async <A>(promise: Promise<A>, ms = 2000): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timer);
  }
};

/** Asserts that `value` is an instance of `ctor` and returns it narrowed. */
export const instanceOf = <T>(value: unknown, ctor: abstract new (...args: never) => T): T => {
  expect(value).toBeInstanceOf(ctor);
  if (!(value instanceof ctor)) throw new Error(`Expected an instance of ${ctor.name}`);
  return value;
};
