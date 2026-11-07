import { createClient, httpBatchLink } from '@effect-trpc/client';

import { appRouter } from '@/router';

// #region batch
const client = createClient(appRouter, {
  link: httpBatchLink({ url: 'https://api.example.com/rpc', maxItems: 10 }),
});

// Called in the same tick: one POST carries both queries.
const [post, page] = await Promise.all([client.post.byId({ id: 1 }), client.post.list({})]);
// #endregion batch

void [post, page];
