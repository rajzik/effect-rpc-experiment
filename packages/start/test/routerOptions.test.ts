// `hydration.routerOptions(queryClient)` with a mixed cache: the router's queries cross the
// TanStack Router hand-off Schema-encoded, other queries keep their values for the router's own
// serializer.
import type { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, test } from 'vite-plus/test';
import { createServerClient, createStartHelpers } from '../src/index.js';
import {
  appRouter,
  createdAt,
  makeFixture,
  makeQueryClient,
  Post,
  PostNotFound,
} from './fixtures.js';

const clients: Array<{ readonly dispose: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.dispose()));
});

const makeHelpers = () => {
  const client = createServerClient(appRouter, { handlers: makeFixture().handlers });
  clients.push(client);
  return createStartHelpers(appRouter, { client });
};

type Helpers = ReturnType<typeof makeHelpers>;

const clock = new Date('2026-03-04T05:06:07.000Z');

/** A server cache with a post, a failed post query and the given non-rpc entries. */
const serverCache = async (
  { rpc }: Helpers,
  other: ReadonlyArray<readonly [string, unknown]>,
): Promise<QueryClient> => {
  const queryClient = makeQueryClient();
  await queryClient.ensureQueryData(rpc(queryClient).post.byId.queryOptions({ id: 1 }));
  await queryClient.prefetchQuery(rpc(queryClient).post.byId.queryOptions({ id: 404 }));
  for (const [key, value] of other) queryClient.setQueryData([key], value);
  return queryClient;
};

const expectRpcQueriesDecoded = ({ rpc }: Helpers, queryClient: QueryClient) => {
  const post = queryClient.getQueryData(rpc(queryClient).post.byId.queryKey({ id: 1 }));
  expect(post).toBeInstanceOf(Post);
  expect(post?.shout()).toBe('HELLO WORLD!');
  expect(post?.createdAt).toEqual(createdAt);
  const failed = queryClient.getQueryState(rpc(queryClient).post.byId.queryKey({ id: 404 }));
  expect(failed?.status).toBe('error');
  expect(failed?.error).toBeInstanceOf(PostNotFound);
};

describe('hydration.routerOptions with non-rpc queries in the cache', () => {
  test('a Date under a non-rpc key stays a Date; rpc data and errors are decoded', async () => {
    const helpers = makeHelpers();
    const serverQc = await serverCache(helpers, [['external-clock', clock]]);
    const payload = helpers.hydration.routerOptions(serverQc).dehydrate();
    // Only the rpc queries go into the JSON string.
    expect(payload.queryState).toContain('Hello world');
    expect(payload.queryState).not.toContain('external-clock');

    const browserQc = makeQueryClient();
    helpers.hydration.routerOptions(browserQc).hydrate(payload);
    const hydratedClock = browserQc.getQueryData(['external-clock']);
    expect(hydratedClock).toBeInstanceOf(Date);
    expect(hydratedClock).toEqual(clock);
    expectRpcQueriesDecoded(helpers, browserQc);
  });

  test('a bigint under a non-rpc key is dehydrated; the payload survives a lossless clone', async () => {
    const helpers = makeHelpers();
    const serverQc = await serverCache(helpers, [
      ['external-counter', 1n],
      ['external-clock', clock],
    ]);
    // A stand-in for the router's serializer (seroval), which also carries `Date` and `bigint`.
    const payload = structuredClone(helpers.hydration.routerOptions(serverQc).dehydrate());

    const browserQc = makeQueryClient();
    helpers.hydration.routerOptions(browserQc).hydrate(payload);
    expect(browserQc.getQueryData(['external-counter'])).toBe(1n);
    expect(browserQc.getQueryData(['external-clock'])).toEqual(clock);
    expectRpcQueriesDecoded(helpers, browserQc);
  });
});
