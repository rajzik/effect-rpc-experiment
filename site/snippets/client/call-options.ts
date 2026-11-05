import { createClient, httpLink } from '@effect-trpc/client';

import { appRouter } from '@/router';

const client = createClient(appRouter, {
  link: httpLink({ url: 'https://api.example.com/rpc', headers: { 'x-app': 'web' } }),
  headers: { 'x-tenant': 'default' },
});

// #region headers
// Per call. Headers from the link, `createClient`, `withHeaders` and the call are merged;
// the most specific value wins.
await client.post.byId({ id: 1 }, { headers: { 'x-trace-id': crypto.randomUUID() } });

// A client sharing the same connection, with extra headers.
const acme = client.withHeaders({ 'x-tenant': 'acme' });
await acme.post.create({ title: 'Hello' }, { headers: { authorization: 'Bearer ada' } });
// #endregion headers

// #region abort
const controller = new AbortController();
const pending = client.post.byId({ id: 1 }, { signal: controller.signal });
controller.abort(); // rejects with RpcInterrupted; the server handler is interrupted
await pending.catch(() => undefined);

// Timeouts are aborts.
await client.post.byId({ id: 1 }, { signal: AbortSignal.timeout(5_000) });

// Subscriptions: abort, or break out of the loop.
for await (const post of client.post.onCreated(undefined, { signal: controller.signal })) {
  if (post.id > 10) break; // cancels the stream on the server
}
// #endregion abort
