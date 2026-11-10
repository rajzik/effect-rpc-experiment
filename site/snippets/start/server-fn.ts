// A server function that calls a procedure in-process.
import { createServerFn } from '@tanstack/react-start';
import { createServerClient } from '@rpc-effect/start';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

const server = createServerClient(appRouter, { handlers: ServerLive });

export const getPostTitle = createServerFn({ method: 'GET' })
  .inputValidator((id: number) => id)
  .handler(async ({ data: id }) => {
    const post = await server.post.byId({ id });
    // The return value goes through Start's serializer, not the procedure's schemas:
    // return plain data, not the Post instance.
    return { id: post.id, title: post.title };
  });
