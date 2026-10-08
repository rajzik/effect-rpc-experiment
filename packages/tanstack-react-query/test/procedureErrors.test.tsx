// @vitest-environment jsdom
// Port of trpc/packages/tanstack-react-query/test/procedureErrors.test.tsx: in effect-trpc the
// procedure error union is the set of `Schema.TaggedError` classes it declares, so `error` is
// `ClientError<E>` and can be narrowed by `_tag` / `instanceof`.
import { RpcDefect, type ClientError } from '@effect-trpc/core';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';
import { describe, expect, expectTypeOf, test } from 'vite-plus/test';
import { Forbidden, PostNotFound } from './fixtures.js';
import { testReactResource, waitFor } from './helpers.js';

const describeError = (error: ClientError<PostNotFound | Forbidden>): string => {
  switch (error._tag) {
    case 'PostNotFound':
      return `not found ${error.id}`;
    case 'Forbidden':
      return `forbidden ${error.reason}`;
    case '@effect-trpc/RpcDefect':
      return `defect ${error.message}`;
    case '@effect-trpc/RpcTransportError':
      return 'transport';
    case '@effect-trpc/RpcInterrupted':
      return 'interrupted';
  }
};

describe('procedure errors', () => {
  test('queryOptions surfaces the procedure error union as class instances', async () => {
    await using ctx = await testReactResource();
    const errors: Array<unknown> = [];

    function MyComponent({ id }: { id: number }) {
      const rpc = ctx.useRpc();
      const query = useQuery(rpc.post.byId.queryOptions({ id }));
      expectTypeOf(query.error).toEqualTypeOf<ClientError<PostNotFound | Forbidden> | null>();
      if (!query.error) return <>...</>;
      errors.push(query.error);
      return <pre>{describeError(query.error)}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent id={404} />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('not found 404');
    });
    expect(errors.at(-1)).toBeInstanceOf(PostNotFound);

    ctx.rerenderApp(utils, <MyComponent id={403} />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('forbidden private');
    });
    expect(errors.at(-1)).toBeInstanceOf(Forbidden);
  });

  test('a handler defect arrives as RpcDefect', async () => {
    await using ctx = await testReactResource();
    const errors: Array<unknown> = [];

    function MyComponent() {
      const rpc = ctx.useRpc();
      const query = useQuery(rpc.boom.queryOptions());
      expectTypeOf(query.error).toEqualTypeOf<ClientError<never> | null>();
      errors.push(query.error);
      return <pre>{query.error?._tag ?? '...'}</pre>;
    }

    const utils = ctx.renderApp(<MyComponent />);
    await waitFor(() => {
      expect(utils.container.textContent).toBe('@effect-trpc/RpcDefect');
    });
    const defect = errors.at(-1);
    expect(defect).toBeInstanceOf(RpcDefect);
    expect(defect).toMatchObject({ message: expect.stringContaining('kaboom') });
  });
});
