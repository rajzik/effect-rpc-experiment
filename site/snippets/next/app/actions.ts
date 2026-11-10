// app/actions.ts
'use server';
import { createServerActionCaller, type InputAt } from '@rpc-effect/next';
import { headers } from 'next/headers';

import { appRouter, type AppRouter } from '@/router';
import { ServerLive } from '@/server';

const actions = createServerActionCaller(appRouter, {
  handlers: ServerLive,
  headers: async () => await headers(),
});

// Exported values of a 'use server' module must be async functions.
export async function createPost(input: InputAt<AppRouter, 'post.create'>) {
  return actions('post.create')(input); // resolves with the encoded Exit, never throws
}
