// renderer.ts — the page is an ordinary client.
import { createClient } from '@effect-trpc/client';
import { rendererLink } from '@effect-trpc/electron/renderer';

import { appRouter } from '@/router';

export const client = createClient(appRouter, { link: rendererLink() });

const post = await client.post.byId({ id: 1 }); // a Post instance; rejects with PostNotFound
for await (const created of client.post.onCreated()) console.log(created.title);
void post;

// It plugs into @effect-trpc/tanstack-react-query like any other client.
