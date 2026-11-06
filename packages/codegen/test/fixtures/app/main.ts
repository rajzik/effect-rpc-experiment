// A client entry for the bundler tests: it imports only the generated client contract.
import { createClient, httpLink } from '@effect-trpc/client';

import { AppRouter } from './router.client.gen.js';

export const client = createClient(AppRouter, { link: httpLink({ url: 'http://localhost/rpc' }) });
