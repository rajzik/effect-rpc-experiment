// Route handler mounted on the root path (`path: '/'`): the root and every path below it reach the
// same endpoint, as for any other mount path.
import { describe, expect, test } from 'vite-plus/test';
import { createRouteHandler } from '../src/index.js';
import { appRouter, makeFixture } from './fixtures.js';

const rpcRequest = (url: string): Request =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/ndjson' },
    body: `${JSON.stringify({ _tag: 'Request', id: '1', tag: 'post.byId', payload: { id: 1 }, headers: [] })}\n`,
  });

/** The status and the NDJSON frames of a response. */
const outcome = async (url: string, response: Response) => ({
  url,
  status: response.status,
  frames: (await response.text())
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line)),
});

const success = (url: string) => ({
  url,
  status: 200,
  frames: expect.arrayContaining([
    expect.objectContaining({ _tag: 'Exit', exit: expect.objectContaining({ _tag: 'Success' }) }),
  ]),
});

describe('createRouteHandler with path "/"', () => {
  test('a POST to the root reaches the endpoint', async () => {
    const { handlers } = makeFixture();
    await using route = createRouteHandler(appRouter, { handlers, path: '/' });
    const url = 'http://localhost/';
    expect(await outcome(url, await route.POST(rpcRequest(url)))).toEqual(success(url));
  });

  test('a POST below the root reaches the same endpoint', async () => {
    const { handlers } = makeFixture();
    await using route = createRouteHandler(appRouter, { handlers, path: '/' });
    for (const url of ['http://localhost/ping', 'http://localhost/a/b/?batch=1']) {
      expect(await outcome(url, await route.POST(rpcRequest(url)))).toEqual(success(url));
    }
  });
});
