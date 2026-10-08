// @vitest-environment jsdom
// Port of trpc/packages/tanstack-react-query/test/mutationOptions.test.tsx (+ tRPC regression
// issue-2540: a mutation without input is callable with no argument).
import type { ClientError } from '@effect-trpc/core';
import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { describe, expect, expectTypeOf, test, vi } from 'vite-plus/test';
import { createRpcOptionsProxy } from '../src/index.js';
import { Forbidden, Post } from './fixtures.js';
import { testReactResource, waitFor } from './helpers.js';

describe.each(['userid-123', undefined])('mutationOptions with keyPrefix: %s', (keyPrefix) => {
  test('useMutation', async () => {
    await using ctx = await testReactResource({ keyPrefix });
    const calls: Array<string> = [];

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.create.mutationOptions({
        onMutate(variables) {
          expectTypeOf(variables).toEqualTypeOf<{ readonly title: string }>();
          calls.push('onMutate');
        },
        onSettled(data) {
          expectTypeOf(data).toEqualTypeOf<Post | undefined>();
          calls.push('onSettled');
        },
        onError(error) {
          expectTypeOf(error).toEqualTypeOf<ClientError<Forbidden>>();
          calls.push('onError');
        },
        onSuccess(data) {
          expectTypeOf(data).toEqualTypeOf<Post>();
          calls.push('onSuccess');
        },
      });
      expect(options.rpc.path).toBe('post.create');
      const mutation = useMutation(options);
      const { mutate } = mutation;
      React.useEffect(() => {
        mutate({ title: 'hello' });
      }, [mutate]);
      if (!mutation.data) return <>...</>;
      expectTypeOf(mutation.data).toEqualTypeOf<Post>();
      return <pre>{mutation.data.shout()}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('HELLO!');
    });
    expect(calls).toEqual(['onMutate', 'onSuccess', 'onSettled']);
  });

  test('useMutation with no opts', async () => {
    await using ctx = await testReactResource({ keyPrefix });
    const calls: Array<string> = [];

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.create.mutationOptions();
      expect(options.rpc.path).toBe('post.create');
      const mutation = useMutation(options);
      const { mutate } = mutation;
      React.useEffect(() => {
        calls.push('onMutate');
        mutate(
          { title: 'hello' },
          {
            onSettled: () => calls.push('onSettled'),
            onError: () => calls.push('onError'),
            onSuccess: (data) => {
              expectTypeOf(data).toEqualTypeOf<Post>();
              calls.push('onSuccess');
            },
          },
        );
      }, [mutate]);
      return <pre>{mutation.data?.title ?? '...'}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('hello');
    });
    expect(calls).toEqual(['onMutate', 'onSuccess', 'onSettled']);
  });

  test('optimistic update', async () => {
    await using ctx = await testReactResource({ keyPrefix });
    const calls: Array<string> = [];

    function MyComponent() {
      const rpc = ctx.useRpc();
      const queryClient = useQueryClient();
      const query = useQuery(rpc.post.titles.queryOptions());
      const mutation = useMutation(
        rpc.post.create.mutationOptions({
          async onMutate(variables) {
            calls.push('onMutate');
            const queryKey = rpc.post.titles.queryKey();
            await queryClient.cancelQueries({ queryKey });
            const previousData = queryClient.getQueryData(queryKey);
            expectTypeOf(previousData).toEqualTypeOf<ReadonlyArray<string> | undefined>();
            queryClient.setQueryData(queryKey, (old) => [...(old ?? []), variables.title]);
            return { previousData };
          },
          onError(_error, _variables, context) {
            calls.push('onError');
            queryClient.setQueryData(rpc.post.titles.queryKey(), context?.previousData);
          },
          onSettled() {
            calls.push('onSettled');
            return queryClient.invalidateQueries(rpc.post.titles.queryFilter());
          },
        }),
      );
      const { mutate } = mutation;
      const loaded = query.data !== undefined;
      React.useEffect(() => {
        if (loaded) mutate({ title: 'optimistic' });
      }, [loaded, mutate]);
      return <pre>{query.data?.join(',')}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('Hello world,Post 2,Post 3,Post 4,optimistic');
    });
    await waitFor(() => {
      expect(calls).toEqual(['onMutate', 'onSettled']);
    });
  });

  test('uses the proxy keyPrefix for mutationKey + mutation defaults', async () => {
    await using ctx = await testReactResource({ keyPrefix });
    const calls: Array<string> = [];
    const expectedKey = keyPrefix ? [[keyPrefix], ['post', 'create']] : [['post', 'create']];
    ctx.queryClient.setMutationDefaults(expectedKey, {
      onSuccess: () => {
        calls.push('defaultOnSuccess');
      },
    });

    function MyComponent() {
      const rpc = ctx.useRpc();
      const options = rpc.post.create.mutationOptions();
      expect(options.mutationKey).toEqual(expectedKey);
      expect(rpc.post.create.mutationKey()).toEqual(expectedKey);
      const mutation = useMutation(options);
      const { mutate } = mutation;
      React.useEffect(() => {
        mutate({ title: 'hello' });
      }, [mutate]);
      return <pre>{mutation.data?.title ?? '...'}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('hello');
    });
    expect(calls).toEqual(['defaultOnSuccess']);
  });
});

describe('mutations', () => {
  test('a typed failure arrives as the TaggedError instance', async () => {
    await using ctx = await testReactResource();

    function MyComponent() {
      const rpc = ctx.useRpc();
      const mutation = useMutation(rpc.post.create.mutationOptions());
      const { mutate } = mutation;
      React.useEffect(() => {
        mutate({ title: 'forbidden' });
      }, [mutate]);
      expectTypeOf(mutation.error).toEqualTypeOf<ClientError<Forbidden> | null>();
      const error = mutation.error;
      if (error === null) return <>...</>;
      switch (error._tag) {
        case 'Forbidden':
          return <pre>{`forbidden:${error.reason}:${String(error instanceof Forbidden)}`}</pre>;
        default:
          return <pre>{error._tag}</pre>;
      }
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('forbidden:no:true');
    });
  });

  test('regression issue-2540: a mutation without input can be called without argument', async () => {
    await using ctx = await testReactResource();

    function MyComponent() {
      const rpc = ctx.useRpc();
      const mutation = useMutation(rpc.post.reset.mutationOptions());
      const { mutate, mutateAsync } = mutation;
      React.useEffect(() => {
        mutate();
        void mutateAsync(undefined);
      }, [mutate, mutateAsync]);
      expectTypeOf(mutation.data).toEqualTypeOf<number | undefined>();
      return <pre>{mutation.data ?? '...'}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('4');
    });
  });

  test('overrides.mutations.onSuccess wraps every onSuccess (e.g. invalidate everything)', async () => {
    await using ctx = await testReactResource();
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const calls: Array<string> = [];
    const rpc = createRpcOptionsProxy({
      client: ctx.client,
      queryClient: () => queryClient,
      overrides: {
        mutations: {
          onSuccess: async (opts) => {
            calls.push(`override:${String(opts.meta['source'])}`);
            await opts.originalFn();
            await opts.queryClient.invalidateQueries();
          },
        },
      },
    });
    const options = rpc.post.create.mutationOptions({
      meta: { source: 'test' },
      onSuccess: (data) => {
        calls.push(`original:${data.title}`);
      },
    });
    const post = await queryClient
      .getMutationCache()
      .build(queryClient, options)
      .execute({ title: 'x' });
    expect(post).toBeInstanceOf(Post);
    expect(calls).toEqual(['override:test', 'original:x']);
    expect(invalidate).toHaveBeenCalledTimes(1);
    queryClient.clear();
  });
});
