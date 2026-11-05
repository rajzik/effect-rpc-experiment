/**
 * `resetData`: puts the server back to its seed data, so every test starts from the same state.
 */
import { createClient, httpLink } from '@effect-trpc/client';

import { appRouter } from '../domain';

/**
 * Resets the server's data through `testing.reset` (which needs `EXAMPLES_TEST=1` on the server).
 *
 * `target` says how to reach it:
 * - a string: the absolute URL of the app's rpc endpoint, e.g. `http://localhost:3000/api/rpc`;
 *   the procedure is called over HTTP like any client would;
 * - a function: your own way to call it, for apps without an HTTP endpoint (the Electron suite
 *   calls it through the renderer's client).
 */
export const resetData = async (target: string | (() => Promise<unknown>)): Promise<void> => {
  if (typeof target === 'function') {
    await target();
    return;
  }
  const client = createClient(appRouter, { link: httpLink({ url: target }) });
  try {
    await client.testing.reset();
  } finally {
    await client.dispose();
  }
};
