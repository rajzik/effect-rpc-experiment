// renderer.ts — the page is an ordinary client.
import { createClient } from '@rpc-effect/client';
import { rendererLink } from '@rpc-effect/electron/renderer';

import { appRouter } from '@/router';

export const client = createClient(appRouter, { link: rendererLink() });

const post = await client.post.byId({ id: 1 }); // a Post instance; rejects with PostNotFound
for await (const created of client.post.onCreated()) console.log(created.title);
void post;

// It plugs into @rpc-effect/tanstack-react-query like any other client.
