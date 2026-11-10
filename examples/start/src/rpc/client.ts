import { appRouter } from '@rpc-effect-examples/shared';
import { createBrowserClient, createServerClient, createStartHelpers } from '@rpc-effect/start';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';

import { ServerLive } from './server';

// Start's compiler removes the `.server()` branch, and with it `ServerLive`, from the browser build.
const makeClient = createIsomorphicFn()
  .server(() =>
    createServerClient(appRouter, {
      handlers: ServerLive,
      // In-process calls have no HTTP request of their own: hand over the page request's cookie,
      // so the `Auth` middleware sees the session in loaders. Evaluated once per call.
      headers: () => {
        const cookie = getRequestHeader('cookie');
        return cookie === undefined ? {} : { cookie };
      },
    }),
  )
  .client(() => createBrowserClient(appRouter, { url: '/api/rpc' }));

export const client = makeClient();

export const { rpc, RpcProvider, useRpc, hydration } = createStartHelpers(appRouter, { client });
