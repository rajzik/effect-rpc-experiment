'use server';
import { appRouter, type AppRouter } from '@rpc-effect-examples/shared';
import { createServerActionCaller, type InputAt } from '@rpc-effect/next';
import { headers } from 'next/headers';

import { ServerLive } from '@/server';

const actions = createServerActionCaller(appRouter, {
  handlers: ServerLive,
  headers: async () => await headers(),
});

// Exported values of a 'use server' module must be async functions.
export async function createTask(input: InputAt<AppRouter, 'tasks.create'>) {
  return actions('tasks.create')(input); // resolves with the encoded Exit, never throws
}
