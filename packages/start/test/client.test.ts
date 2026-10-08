// `createIsomorphicClient`: in-process on the server, `httpLink` in the browser.
import type { Client } from '@effect-trpc/client';
import { afterEach, describe, expect, test, vi } from 'vite-plus/test';
import {
  createBrowserClient,
  createIsomorphicClient,
  createServerClient,
  createStartHandler,
  getBaseUrl,
  getRpcUrl,
} from '../src/index.js';
import { appRouter, type AppRouter, makeFixture, Post, PostNotFound } from './fixtures.js';

const disposables: Array<{ readonly dispose: () => Promise<void> }> = [];
const track = <A extends { readonly dispose: () => Promise<void> }>(value: A): A => {
  disposables.push(value);
  return value;
};

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(disposables.splice(0).map((d) => d.dispose()));
});

/** A fetch spy routed into a Start handler. */
const makeFetch = () => {
  const handler = track(createStartHandler(appRouter, { handlers: makeFixture().handlers }));
  const urls: Array<string> = [];
  const fetch = vi.fn<typeof globalThis.fetch>((input, init) => {
    const request = new Request(input, init);
    urls.push(request.url);
    return handler({ request });
  });
  return { fetch, urls };
};

const expectInstances = async (client: Client<AppRouter>) => {
  const post = await client.post.byId({ id: 1 });
  expect(post).toBeInstanceOf(Post);
  expect(post.shout()).toBe('HELLO WORLD!');
  const error = await client.post.byId({ id: 404 }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(PostNotFound);
  expect((error as PostNotFound)._tag).toBe('PostNotFound');
};

describe('createIsomorphicClient', () => {
  test('isServer: true runs the handlers in-process (fetch is never called)', async () => {
    const { fetch } = makeFetch();
    const client = track(
      createIsomorphicClient(appRouter, {
        server: { handlers: makeFixture().handlers },
        client: { url: 'http://x/api/rpc', fetch },
        isServer: true,
      }),
    );
    await expectInstances(client);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('isServer: false calls the server route over httpLink', async () => {
    const { fetch, urls } = makeFetch();
    const client = track(
      createIsomorphicClient(appRouter, {
        server: { handlers: makeFixture().handlers },
        client: { url: 'http://x/api/rpc', fetch },
        isServer: false,
      }),
    );
    await expectInstances(client);
    expect(fetch).toHaveBeenCalledTimes(2);
    // (the effect/rpc HTTP client may append a `/`; the handler's catch-all rewrite absorbs it)
    expect(urls.map((url) => url.replace(/\/$/, ''))).toEqual([
      'http://x/api/rpc',
      'http://x/api/rpc',
    ]);
  });

  test('defaults isServer to typeof window === "undefined" (node → in-process)', async () => {
    const { fetch } = makeFetch();
    const client = track(
      createIsomorphicClient(appRouter, {
        server: { handlers: makeFixture().handlers },
        client: { url: 'http://x/api/rpc', fetch },
      }),
    );
    expect(await client.post.byId({ id: 2 })).toBeInstanceOf(Post);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('server and browser clients stream subscriptions', async () => {
    const { fetch } = makeFetch();
    const server = track(createServerClient(appRouter, { handlers: makeFixture().handlers }));
    const browser = track(createBrowserClient(appRouter, { url: 'http://x/api/rpc', fetch }));
    for (const client of [server, browser]) {
      const posts: Array<Post> = [];
      for await (const post of client.feed({ count: 2 })) posts.push(post);
      expect(posts.map((p) => p.shout())).toEqual(['POST 1!', 'POST 2!']);
    }
  });
});

describe('getBaseUrl / relative urls', () => {
  test('resolves relative urls against the server origin during SSR', async () => {
    vi.stubEnv('PUBLIC_URL', '');
    vi.stubEnv('URL', '');
    vi.stubEnv('VERCEL_URL', '');
    vi.stubEnv('PORT', '4321');
    expect(getBaseUrl()).toBe('http://localhost:4321');
    expect(getRpcUrl().href).toBe('http://localhost:4321/api/rpc');
    expect(getRpcUrl('/rpc', { serverOrigin: 'https://app.dev/' }).href).toBe(
      'https://app.dev/rpc',
    );
    vi.stubEnv('VERCEL_URL', 'my-app.vercel.app');
    expect(getBaseUrl()).toBe('https://my-app.vercel.app');
    vi.stubEnv('PUBLIC_URL', 'https://example.com/');
    expect(getBaseUrl()).toBe('https://example.com');
    expect(getRpcUrl('https://other.dev/api/rpc').href).toBe('https://other.dev/api/rpc');

    const { fetch, urls } = makeFetch();
    const client = track(
      createBrowserClient(appRouter, { fetch, serverOrigin: 'https://start.local' }),
    );
    expect(await client.post.byId({ id: 3 })).toBeInstanceOf(Post);
    expect(urls.map((url) => url.replace(/\/$/, ''))).toEqual(['https://start.local/api/rpc']);
  });

  test('uses window.location.origin in the browser', () => {
    vi.stubGlobal('window', { location: { origin: 'https://browser.example' } });
    try {
      expect(getBaseUrl({ serverOrigin: 'https://ignored' })).toBe('https://browser.example');
      expect(getRpcUrl().href).toBe('https://browser.example/api/rpc');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
