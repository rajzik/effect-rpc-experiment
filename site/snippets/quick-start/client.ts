// client.ts — call the server from any TypeScript code.
import { Effect } from 'effect';
import { createClient, httpLink } from '@effect-trpc/client';

import { appRouter, Post, PostNotFound } from '@/router';

const client = createClient(appRouter, {
  link: httpLink({
    url: 'http://localhost:3000/rpc', // absolute
    headers: { authorization: 'Bearer ada' }, // read by the Auth middleware
  }),
});

// #region promise
const post = await client.post.byId({ id: 1 });
post instanceof Post; // true: a decoded class instance
post.slug; // "hello-effect" (a getter on the class)
post.createdAt.getFullYear(); // 2026 (a real Date)

try {
  await client.post.byId({ id: 404 });
} catch (cause) {
  // ClientError<PostNotFound>: your error, or RpcDefect / RpcTransportError / RpcInterrupted
  if (cause instanceof PostNotFound) console.log(`no post #${cause.id}`);
}
// #endregion promise

// #region effect
const title = client.$effect.post.byId({ id: 404 }).pipe(
  Effect.map((p) => p.title),
  Effect.catchTag('PostNotFound', (e) => Effect.succeed(`missing #${e.id}`)),
); // Effect<string, RpcTransportError>
// #endregion effect

console.log(await Effect.runPromise(title));
await client.dispose();
