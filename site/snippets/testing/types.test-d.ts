// errors.test-d.ts — type tests run with `vitest --typecheck` (or `vp test`).
import { describe, expectTypeOf, it } from '@effect/vitest';
import type { ClientError } from '@effect-trpc/core';
import type { Client } from '@effect-trpc/client';
import type { inferProxyError } from '@effect-trpc/tanstack-react-query';

import type { AppRouter, Forbidden, Post, PostNotFound, Unauthorized } from '@/router';

import type { rpc } from '../react-query/no-context';

describe('error types', () => {
  it('byId rejects with PostNotFound or an infrastructure error', () => {
    expectTypeOf<Client.Error<AppRouter['record']['post']['byId']>>().toEqualTypeOf<
      ClientError<PostNotFound>
    >();
  });

  it('create includes the Auth middleware error', () => {
    expectTypeOf<Client.Error<AppRouter['record']['post']['create']>>().toEqualTypeOf<
      ClientError<Forbidden | Unauthorized>
    >();
  });

  it('useQuery errors match', () => {
    expectTypeOf<inferProxyError<typeof rpc.post.byId>>().toEqualTypeOf<
      ClientError<PostNotFound>
    >();
  });

  it('outputs are classes', () => {
    expectTypeOf<Client.Output<AppRouter['record']['post']['byId']>>().toEqualTypeOf<Post>();
  });
});
