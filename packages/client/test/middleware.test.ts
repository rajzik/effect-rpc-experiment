import { query, Router } from '@effect-trpc/core';
import { Effect, Layer, Schema } from 'effect';
import { Headers } from 'effect/http';
import { RpcMiddleware } from 'effect/rpc';
import { describe, expect, it } from 'vite-plus/test';
import { createClient, httpLink, localLink } from '../src/index.js';
import { Unauthorized } from './fixtures.js';
import { rejectionOf } from './helpers.js';

/** Middleware with a client-side half: the client attaches a token, the server checks it. */
class Token extends RpcMiddleware.Service<Token>()('Token', {
  error: Unauthorized,
  requiredForClient: true,
}) {}

const router = Router.make({
  secret: query({ success: Schema.String }).middleware(Token),
});

const TokenServer = Layer.succeed(Token)((effect, { headers }) =>
  headers['authorization'] === 'Bearer t0k3n' ? effect : Effect.fail(new Unauthorized()),
);

const tokenClient = (token: string) =>
  RpcMiddleware.layerClient(Token, ({ request, next }) =>
    next({ ...request, headers: Headers.set(request.headers, 'authorization', `Bearer ${token}`) }),
  );

const handlers = Layer.merge(
  router.group.toLayer({ secret: () => Effect.succeed('the secret') }),
  TokenServer,
);

describe('client middleware (requiredForClient)', () => {
  it('runs the middleware layer given to createClient', async () => {
    const client = createClient(router, {
      link: localLink({ handlers }),
      middleware: tokenClient('t0k3n'),
    });
    await expect(client.secret()).resolves.toBe('the secret');
    await client.dispose();
  });

  it('surfaces the middleware typed error', async () => {
    const client = createClient(router, {
      link: localLink({ handlers }),
      middleware: tokenClient('wrong'),
    });
    expect(await rejectionOf(client.secret())).toBeInstanceOf(Unauthorized);
    await client.dispose();
  });

  it('works with network links (middleware is applied before the transport)', async () => {
    const seen: Array<string> = [];
    const client = createClient(router, {
      link: httpLink({
        url: 'http://example.test/rpc',
        fetch: async (_input, init) => {
          seen.push(await new Response(init?.body ?? null).text());
          return new Response('', { status: 503 });
        },
      }),
      middleware: tokenClient('abc'),
    });
    await rejectionOf(client.secret());
    expect(seen.join('')).toContain('Bearer abc');
    await client.dispose();
  });
});
