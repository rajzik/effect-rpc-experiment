import { createClient, localLink, type Client } from '@effect-trpc/client';
import { testServerAndClient } from '@effect-trpc/test-utils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, type RenderResult } from '@testing-library/react';
import * as React from 'react';
import { createRpcContext, createRpcOptionsProxy, type RpcOptionsProxy } from '../src/index.js';
import { appRouter, makeFixture, type AppRouter } from './fixtures.js';

/** Feature flags for an optional key prefix (`boolean` when it may or may not be set). */
export type PrefixFlags<P extends string | undefined> = {
  readonly keyPrefix: [P] extends [string] ? true : [P] extends [undefined] ? false : boolean;
};

export const makeQueryClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

/**
 * The React test harness (tRPC's `testReactResource`): a fixture router served over `localLink`
 * (or a real HTTP server), a `QueryClient`, a typed context and render helpers. Dispose it with
 * `await using`.
 */
export const testReactResource = async <const P extends string | undefined = undefined>(
  opts: { readonly keyPrefix?: P; readonly transport?: 'local' | 'http' } = {},
) => {
  type Flags = PrefixFlags<P>;
  const fixture = makeFixture();
  const server =
    opts.transport === 'http'
      ? await testServerAndClient(appRouter, { handlers: fixture.handlers })
      : undefined;
  const client: Client<AppRouter> =
    server?.client ?? createClient(appRouter, { link: localLink({ handlers: fixture.handlers }) });
  const queryClient = makeQueryClient();
  const keyPrefix = opts.keyPrefix as any;
  const { RpcProvider, useRpc, useRpcClient } = createRpcContext<AppRouter, Flags>();
  const keyPrefixProps: { keyPrefix?: string } = keyPrefix === undefined ? {} : { keyPrefix };
  // `keyPrefix` is optional or required depending on `P`: erase that for the generic harness.
  const Provider = RpcProvider as unknown as React.FC<{
    readonly client: Client<AppRouter>;
    readonly queryClient: QueryClient;
    readonly keyPrefix?: string;
    readonly children?: React.ReactNode;
  }>;
  const optionsProxy: RpcOptionsProxy<AppRouter, Flags> = createRpcOptionsProxy<AppRouter, Flags>({
    client,
    queryClient,
    keyPrefix,
  } as any);

  const wrap = (ui: React.ReactNode): React.ReactElement => (
    <QueryClientProvider client={queryClient}>
      <Provider client={client} queryClient={queryClient} {...keyPrefixProps}>
        {ui}
      </Provider>
    </QueryClientProvider>
  );

  return {
    ...fixture,
    client,
    queryClient,
    useRpc,
    useRpcClient,
    optionsProxy,
    renderApp: (ui: React.ReactNode): RenderResult => render(wrap(ui)),
    rerenderApp: (result: RenderResult, ui: React.ReactNode): void => result.rerender(wrap(ui)),
    [Symbol.asyncDispose]: async (): Promise<void> => {
      cleanup();
      queryClient.clear();
      await client.dispose();
      await server?.dispose();
    },
  };
};

/** Polls `assertion` until it passes (like `vi.waitFor`, but wrapped in React's `act`). */
export { waitFor } from '@testing-library/react';
