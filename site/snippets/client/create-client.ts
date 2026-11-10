import { createClient, httpLink } from '@rpc-effect/client';

import { appRouter } from '@/router';

declare const getToken: () => Promise<string>;

// #region create
export const client = createClient(appRouter, {
  link: httpLink({ url: 'https://api.example.com/rpc' }),
  // Sent with every call; a function is evaluated once per call.
  headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
});
// #endregion create

// #region calls
await client.health(); // no input: no argument
const post = await client.post.byId({ id: 1 }); // Post
const page = await client.post.list({ cursor: null }); // PostPage
const created = await client.post.create({ title: 'Hello' }); // Post

// Subscriptions are async iterables.
for await (const p of client.post.onCreated()) {
  console.log(p.title);
}
// #endregion calls

// #region lifecycle
// Connects lazily on the first call. Dispose to close connections.
await client.dispose(); // later calls fail with RpcTransportError

// Or scope it: `await using` calls Symbol.asyncDispose.
{
  await using scoped = createClient(appRouter, {
    link: httpLink({ url: 'https://api.example.com/rpc' }),
  });
  await scoped.health();
}
// #endregion lifecycle

void [post, page, created];
