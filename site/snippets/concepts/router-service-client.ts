// The client module: imports the router module only, never the server module.
import { createClient, httpLink } from '@effect-trpc/client';

import { Post, PostNotFound } from '@/router';
import { AppRouter } from './router-service';

// #region client
const client = createClient(AppRouter, {
  link: httpLink({ url: 'http://localhost:3000/rpc' }),
});

const post = await client.post.byId({ id: 1 });
post instanceof Post; // true: the client evaluates `make` to get the schemas
post.slug; // "hello-effect"

try {
  await client.post.byId({ id: 404 });
} catch (cause) {
  if (cause instanceof PostNotFound) console.log(`no post #${cause.id}`);
}
// #endregion client
