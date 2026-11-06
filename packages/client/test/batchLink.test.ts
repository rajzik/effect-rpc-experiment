import { mutation, query, Router, subscription } from '@effect-trpc/core';
import { Effect, Layer, Schema, Stream } from 'effect';
import { HttpRouter } from 'effect/http';
import { RpcSerialization, RpcServer } from 'effect/rpc';
import { describe, expect, it } from 'vite-plus/test';
import {
  createClient,
  httpBatchLink,
  RpcInterrupted,
  RpcTransportError,
  type HttpBatchLinkOptions,
} from '../src/index.js';
import { drain, rejectionOf, within } from './helpers.js';

class Item extends Schema.Class<Item>('Item')({ id: Schema.Finite }) {
  label(): string {
    return `item ${this.id}`;
  }
}

class Missing extends Schema.TaggedError<Missing>()('Missing', { id: Schema.Finite }) {}

const router = Router.make({
  /** Fails with `Missing` for a negative id. */
  item: query({ payload: { id: Schema.Finite }, success: Item, error: Missing }),
  /** Succeeds with "opened" once the test opens the gate. */
  gated: query({ success: Schema.String }),
  /** Never completes; the test observes its interruption on the server. */
  hang: query({ success: Schema.String }),
  /** Returns the `x-batch` request header. */
  header: query({ success: Schema.String }),
  add: mutation({ payload: { n: Schema.Finite }, success: Schema.Finite }),
  count: subscription({ payload: { n: Schema.Finite }, success: Schema.Finite }),
});

type Format = 'json' | 'ndjson';

const deferred = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve: () => resolve?.() };
};

const abortOf = (signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal === undefined) reject(new Error('no POST was sent'));
    else if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });

/** A top-level field of one NDJSON line. */
const field = (line: string, key: string): unknown => {
  const message: unknown = JSON.parse(line);
  return typeof message === 'object' && message !== null ? Reflect.get(message, key) : undefined;
};

const lines = (text: string): ReadonlyArray<string> =>
  text.split('\n').filter((line) => line !== '');

/** A fetch response hook: drops the `Exit` frame of the call to `tag` from an NDJSON response. */
const dropExitOf =
  (tag: string) =>
  async (request: Request, response: Response): Promise<Response> => {
    const sent = lines(await request.text()).find((line) => field(line, 'tag') === tag);
    const id = sent === undefined ? undefined : field(sent, 'id');
    const kept = lines(await response.text()).filter(
      (line) => field(line, '_tag') !== 'Exit' || field(line, 'requestId') !== id,
    );
    return new Response(kept.map((line) => `${line}\n`).join(''), {
      status: response.status,
      headers: response.headers,
    });
  };

/** Serves `router` with `toWebHandler` and calls it through a fetch double that records signals. */
const withClient = async (
  options: {
    readonly format?: Format;
    readonly link?: Partial<HttpBatchLinkOptions>;
    /** Rewrites the server's response before the link sees it. */
    readonly respond?: (request: Request, response: Response) => Promise<Response>;
  },
  test: (ctx: {
    readonly client: ReturnType<typeof createClient<typeof router>>;
    /** The `signal` of every fetch, in call order: one entry per POST. */
    readonly signals: ReadonlyArray<AbortSignal>;
    readonly open: () => void;
    readonly hangInterrupted: Promise<void>;
  }) => Promise<void>,
): Promise<void> => {
  const format = options.format ?? 'ndjson';
  const gate = deferred();
  const hangInterrupted = deferred();
  const handlers = router.group.toLayer({
    item: ({ id }) =>
      id < 0 ? Effect.fail(new Missing({ id })) : Effect.succeed(new Item({ id })),
    gated: () => Effect.promise(() => gate.promise).pipe(Effect.as('opened')),
    hang: () => Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(hangInterrupted.resolve))),
    header: (_, { headers }) => Effect.succeed(headers['x-batch'] ?? ''),
    add: ({ n }) => Effect.succeed(n + 1),
    count: ({ n }) => Stream.range(1, n),
  });
  const web = HttpRouter.toWebHandler(
    RpcServer.layerHttp({
      group: router.group,
      path: '/rpc',
      protocol: 'http',
      disableFatalDefects: true,
    }).pipe(
      Layer.provide(handlers),
      Layer.provide(format === 'json' ? RpcSerialization.layerJson : RpcSerialization.layerNdjson),
    ),
    { disableLogger: true },
  );
  const signals: Array<AbortSignal> = [];
  const { respond } = options;
  const fetch: typeof globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    signals.push(request.signal);
    return respond === undefined
      ? web.handler(request)
      : web.handler(request.clone()).then((response) => respond(request, response));
  };
  const client = createClient(router, {
    link: httpBatchLink({
      url: 'http://localhost/rpc',
      fetch,
      serialization: format,
      ...options.link,
    }),
  });
  try {
    await test({ client, signals, open: gate.resolve, hangInterrupted: hangInterrupted.promise });
  } finally {
    await client.dispose();
    await web.dispose();
  }
};

describe.each(['ndjson', 'json'] as const)('httpBatchLink (%s)', (format) => {
  it('sends same-tick queries in one POST and decodes each result', () =>
    withClient({ format }, async ({ client, signals }) => {
      const items = await Promise.all([
        client.item({ id: 1 }),
        client.item({ id: 2 }),
        client.item({ id: 3 }),
      ]);
      expect(signals).toHaveLength(1);
      for (const item of items) expect(item).toBeInstanceOf(Item);
      expect(items.map((item) => item.label())).toEqual(['item 1', 'item 2', 'item 3']);
    }));

  it('fails only the query whose handler failed', () =>
    withClient({ format }, async ({ client, signals }) => {
      const [first, missing, last] = await Promise.all([
        client.item({ id: 1 }),
        rejectionOf(client.item({ id: -1 })),
        client.item({ id: 2 }),
      ]);
      expect(signals).toHaveLength(1);
      expect(missing).toBeInstanceOf(Missing);
      expect(missing).toMatchObject({ id: -1 });
      expect([first.label(), last.label()]).toEqual(['item 1', 'item 2']);
    }));

  it('sends each mutation in its own POST', () =>
    withClient({ format }, async ({ client, signals }) => {
      await expect(Promise.all([client.add({ n: 1 }), client.add({ n: 2 })])).resolves.toEqual([
        2, 3,
      ]);
      expect(signals).toHaveLength(2);
    }));

  it('streams a subscription in its own POST', () =>
    withClient({ format }, async ({ client, signals }) => {
      const [counted, item] = await Promise.all([
        drain(client.count({ n: 3 })),
        client.item({ id: 1 }),
      ]);
      expect(counted).toEqual({ values: [1, 2, 3], error: undefined });
      expect(item).toBeInstanceOf(Item);
      expect(signals).toHaveLength(2);
    }));

  it('evaluates the headers function once per POST', () => {
    let calls = 0;
    const headers = () => ({ 'x-batch': String(++calls) });
    return withClient({ format, link: { headers } }, async ({ client, signals }) => {
      const values = await Promise.all([client.header(), client.header(), client.header()]);
      expect(values).toEqual(['1', '1', '1']);
      expect(calls).toBe(1);
      expect(signals).toHaveLength(1);
    });
  });

  it('keeps per-call headers apart within one POST', () =>
    withClient({ format }, async ({ client, signals }) => {
      const values = await Promise.all([
        client.header(undefined, { headers: { 'x-batch': 'a' } }),
        client.header(undefined, { headers: { 'x-batch': 'b' } }),
      ]);
      expect(values).toEqual(['a', 'b']);
      expect(signals).toHaveLength(1);
    }));
});

describe('httpBatchLink limits, errors and abort', () => {
  it('splits a batch into POSTs of at most maxItems calls', () =>
    withClient({ link: { maxItems: 2 } }, async ({ client, signals }) => {
      const items = await Promise.all([
        client.item({ id: 1 }),
        client.item({ id: 2 }),
        client.item({ id: 3 }),
      ]);
      expect(items.map((item) => item.label())).toEqual(['item 1', 'item 2', 'item 3']);
      expect(signals).toHaveLength(2);
    }));

  it('validates url and maxItems when the link is created', () => {
    expect(() => httpBatchLink({ url: '/rpc' })).toThrow(
      /httpBatchLink: url must be an absolute URL/,
    );
    for (const maxItems of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => httpBatchLink({ url: 'http://localhost/rpc', maxItems })).toThrow(
        /httpBatchLink: maxItems must be a positive integer/,
      );
    }
  });

  it('fails every query of the POST with RpcTransportError on a non-2xx response', async () => {
    let fetches = 0;
    const client = createClient(router, {
      link: httpBatchLink({
        url: 'http://localhost/rpc',
        fetch: () => {
          fetches++;
          return Promise.resolve(new Response('upstream down', { status: 502 }));
        },
      }),
    });
    const errors = await Promise.all([
      rejectionOf(client.item({ id: 1 })),
      rejectionOf(client.item({ id: 2 })),
      rejectionOf(client.header()),
    ]);
    for (const error of errors) expect(error).toBeInstanceOf(RpcTransportError);
    expect(fetches).toBe(1);
    await client.dispose();
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('no token');
      },
    ],
    ['rejects', () => Promise.reject(new Error('no token'))],
  ])(
    'fails every call of the POST with RpcTransportError when headers() %s, without a fetch',
    (_name, headers) =>
      withClient({ link: { headers } }, async ({ client, signals }) => {
        const errors = await Promise.all([
          rejectionOf(client.item({ id: 1 })),
          rejectionOf(client.item({ id: 2 })),
          rejectionOf(client.header()),
        ]);
        for (const error of errors) expect(error).toBeInstanceOf(RpcTransportError);
        expect(signals).toHaveLength(0);
      }),
  );

  it('fails only the call whose Exit is missing from the response', () =>
    withClient({ respond: dropExitOf('header') }, async ({ client, signals }) => {
      const [first, missing, last] = await Promise.all([
        client.item({ id: 1 }),
        rejectionOf(client.header()),
        client.item({ id: 2 }),
      ]);
      expect(signals).toHaveLength(1);
      expect(missing).toBeInstanceOf(RpcTransportError);
      expect(missing).toMatchObject({
        message: 'RpcClientDefect: HTTP response ended before RPC request completed',
      });
      expect([first.label(), last.label()]).toEqual(['item 1', 'item 2']);
    }));

  it('interrupts an aborted query and keeps the POST running for the others', () =>
    withClient({}, async ({ client, signals, open, hangInterrupted }) => {
      const controller = new AbortController();
      const hung = rejectionOf(client.hang(undefined, { signal: controller.signal }));
      const gated = client.gated();
      // The first response proves the POST is streaming before the abort.
      expect(await within(client.item({ id: 1 }))).toBeInstanceOf(Item);
      expect(signals).toHaveLength(1);
      controller.abort();
      expect(await within(hung)).toBeInstanceOf(RpcInterrupted);
      expect(signals[0]?.aborted).toBe(false);
      open();
      expect(await within(gated)).toBe('opened');
      // Every call is settled: the POST is aborted, which ends the aborted call on the server.
      await within(abortOf(signals[0]));
      await within(hangInterrupted);
    }));

  it('aborts the POST when every call in it is aborted', () =>
    withClient({}, async ({ client, signals, hangInterrupted }) => {
      const first = new AbortController();
      const second = new AbortController();
      const hung = rejectionOf(client.hang(undefined, { signal: first.signal }));
      const gated = rejectionOf(client.gated(undefined, { signal: second.signal }));
      await within(
        (async () => {
          while (signals.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
        })(),
      );
      first.abort();
      expect(await within(hung)).toBeInstanceOf(RpcInterrupted);
      expect(signals[0]?.aborted).toBe(false);
      second.abort();
      expect(await within(gated)).toBeInstanceOf(RpcInterrupted);
      await within(abortOf(signals[0]));
      await within(hangInterrupted);
      expect(signals).toHaveLength(1);
    }));
});
