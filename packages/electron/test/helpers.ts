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
export const within = <A>(promise: Promise<A>, ms = 2000): Promise<A> =>
  new Promise<A>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
