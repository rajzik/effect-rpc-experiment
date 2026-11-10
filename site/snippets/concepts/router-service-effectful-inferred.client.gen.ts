import { Schema } from 'effect';
import { query, Router } from '@rpc-effect/core';
import { createClient, httpLink } from '@rpc-effect/client';

import { Forbidden, Post, PostNotFound } from '@/router';

// #region client
// router.client.gen.ts (clients and every synchronous API): schemas only, no handlers, no import
// of the router module, so `make` and its services never reach the client.
export const AppRouter = Router.make({
  byId: query({ payload: { id: Schema.Finite }, success: Post, error: PostNotFound }),
  status: query({
    success: Schema.Struct({ motd: Schema.String, readOnly: Schema.Boolean }),
    error: Forbidden,
  }),
});

// client.ts
const client = createClient(AppRouter, { link: httpLink({ url: 'http://localhost:3000/rpc' }) });
const status = await client.status(); // { motd: string; readOnly: boolean }
// #endregion client

export { status };
