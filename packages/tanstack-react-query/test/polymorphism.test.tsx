// @vitest-environment jsdom
// Port of trpc/packages/tanstack-react-query/test/polymorphism.test.tsx: a router factory mounted
// several times, and components written once against the abstract options proxy of the factory.
import { createClient, localLink } from '@effect-trpc/client';
import { mutation, query, Router } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Effect, Schema } from 'effect';
import * as React from 'react';
import { describe, expect, test } from 'vite-plus/test';
import { createRpcContext, type RpcOptionsProxy } from '../src/index.js';
import { waitFor } from './helpers.js';

class ExportStatus extends Schema.Class<ExportStatus>('ExportStatus')({
  id: Schema.Number,
  name: Schema.String,
  ready: Schema.Boolean,
}) {}

/** A router factory: the same procedures over different data sources. */
const makeExportRouter = () =>
  Router.make({
    start: mutation({ payload: { name: Schema.String }, success: ExportStatus }),
    list: query({ success: Schema.Array(ExportStatus) }),
  });
type ExportRouter = ReturnType<typeof makeExportRouter>;

const issues = makeExportRouter();
const discussions = Router.merge(
  makeExportRouter(),
  Router.make({ pin: mutation({ payload: { id: Schema.Number }, success: Schema.Void }) }),
);
const appRouter = Router.make({ github: { issues, discussions } });
type AppRouter = typeof appRouter;

const makeExportHandlers = () => {
  const exports: Array<ExportStatus> = [];
  return {
    start: ({ name }: { readonly name: string }) =>
      Effect.sync(() => {
        const status = new ExportStatus({ id: exports.length + 1, name, ready: false });
        exports.push(status);
        return status;
      }),
    // every listing marks the pending exports as ready
    list: () =>
      Effect.sync(() => {
        const listed = [...exports];
        exports.splice(
          0,
          exports.length,
          ...exports.map((e) => new ExportStatus({ id: e.id, name: e.name, ready: true })),
        );
        return listed;
      }),
  };
};

const handlers = Handlers.make(appRouter, {
  github: {
    issues: makeExportHandlers(),
    discussions: { ...makeExportHandlers(), pin: () => Effect.void },
  },
});

const { RpcProvider, useRpc } = createRpcContext<AppRouter>();

/** Written once against the factory's proxy type. */
function ExportPanel({ route, label }: { route: RpcOptionsProxy<ExportRouter>; label: string }) {
  const queryClient = useQueryClient();
  const list = useQuery(route.list.queryOptions());
  const start = useMutation(
    route.start.mutationOptions({
      onSuccess: () => queryClient.invalidateQueries(route.pathFilter()),
    }),
  );
  return (
    <div>
      <button data-testid={`start-${label}`} onClick={() => start.mutate({ name: label })}>
        start
      </button>
      <pre data-testid={`list-${label}`}>
        {list.data?.map((e) => `${e.name}:${e.ready ? 'ready' : 'working'}`).join(',') ?? '...'}
      </pre>
    </div>
  );
}

function Page() {
  const rpc = useRpc();
  return (
    <>
      <ExportPanel route={rpc.github.issues} label="issues" />
      {/* a factory instance merged with extra procedures still fits the abstract interface */}
      <ExportPanel route={rpc.github.discussions} label="discussions" />
    </>
  );
}

describe('polymorphism', () => {
  test('components written against the abstract proxy of a router factory', async () => {
    const client = createClient(appRouter, { link: localLink({ handlers }) });
    const queryClient = new QueryClient();
    const utils = render(
      <QueryClientProvider client={queryClient}>
        <RpcProvider client={client} queryClient={queryClient}>
          <Page />
        </RpcProvider>
      </QueryClientProvider>,
    );
    const text = (label: string) => utils.getByTestId(`list-${label}`).textContent;
    try {
      await waitFor(() => {
        expect(text('issues')).toBe('');
        expect(text('discussions')).toBe('');
      });
      await act(async () => {
        fireEvent.click(utils.getByTestId('start-issues'));
      });
      await waitFor(() => {
        expect(text('issues')).toBe('issues:working');
      });
      // only the issues path was invalidated
      expect(text('discussions')).toBe('');
      await act(async () => {
        await queryClient.invalidateQueries({ queryKey: [['github', 'issues']] });
      });
      await waitFor(() => {
        expect(text('issues')).toBe('issues:ready');
      });
      await act(async () => {
        fireEvent.click(utils.getByTestId('start-discussions'));
      });
      await waitFor(() => {
        expect(text('discussions')).toBe('discussions:working');
      });
    } finally {
      cleanup();
      queryClient.clear();
      await client.dispose();
    }
  });
});
