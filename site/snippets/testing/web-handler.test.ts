import { describe, expect, it } from '@effect/vitest';
import { testWebHandler } from '@rpc-effect/test-utils';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

describe('the fetch handler', () => {
  it('serves the full HTTP wire format without a port', async () => {
    await using ctx = await testWebHandler(appRouter, { handlers: ServerLive, path: '/api/rpc' });

    // A Promise client whose fetch calls the handler directly.
    expect((await ctx.client.post.byId({ id: 1 })).title).toBe('Hello Effect');

    // Raw requests, for status codes and headers: other paths answer 404.
    const response = await ctx.fetch('/api/other', { method: 'POST' });
    expect(response.status).toBe(404);
  });
});
