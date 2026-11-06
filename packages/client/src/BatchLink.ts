/**
 * `httpBatchLink`: an HTTP link that sends the queries called in the same tick in one POST.
 *
 * It implements an `effect/rpc` `RpcClient.Protocol` over the same `HttpClient` as `httpLink`
 * (custom `fetch`, `headers`, non-2xx → `RpcTransportError`). The `@effect-trpc/server` HTTP
 * adapters already accept several requests in one body and stream the responses back by request
 * id, so batching needs no server option.
 *
 * @since 0.1.0
 */
import { ProcedureKind } from '@effect-trpc/core';
import { Context, Deferred, Effect, Exit, Layer, Stream } from 'effect';
import { HttpBody, HttpClient, HttpClientError, HttpClientRequest } from 'effect/http';
import { RpcClient, RpcClientError, RpcSerialization } from 'effect/rpc';
import type { Rpc, RpcGroup, RpcMessage } from 'effect/rpc';
import {
  assertAbsoluteUrl,
  httpClientLayer,
  Link,
  serializationLayer,
  type HttpLinkOptions,
} from './Link.js';

/**
 * Options of {@link httpBatchLink}: the {@link HttpLinkOptions} plus `maxItems`.
 *
 * @category options
 * @since 0.1.0
 */
export type HttpBatchLinkOptions = HttpLinkOptions & {
  /** Maximum number of calls in one POST (a positive integer); default: no limit. */
  readonly maxItems?: number | undefined;
};

/** A call sent by the batch protocol; completing `result` ends the protocol's `send`. */
interface Call {
  readonly clientId: number;
  readonly request: RpcMessage.RequestEncoded;
  readonly result: Deferred.Deferred<void, RpcClientError.RpcClientError>;
  state: 'pending' | 'done' | 'interrupted';
  post: Post | undefined;
}

/** The calls of one POST; completing `abort` aborts the request. */
interface Post {
  readonly calls: ReadonlyArray<Call>;
  readonly abort: Deferred.Deferred<void>;
}

/** Aborts a POST once none of its calls is pending and one of them was interrupted. */
const release = (post: Post | undefined): void => {
  if (
    post !== undefined &&
    post.calls.every((call) => call.state !== 'pending') &&
    post.calls.some((call) => call.state === 'interrupted')
  ) {
    Deferred.doneUnsafe(post.abort, Exit.void);
  }
};

/** Ends the `send` of a call that was not interrupted; the call no longer counts as waiting. */
const settle = (call: Call, exit: Exit.Exit<void, RpcClientError.RpcClientError>): void => {
  if (call.state === 'interrupted' || !Deferred.doneUnsafe(call.result, exit)) return;
  call.state = 'done';
  release(call.post);
};

const interrupt = (call: Call): void => {
  if (call.state !== 'pending') return;
  call.state = 'interrupted';
  release(call.post);
};

const protocolDefect = (message: string, cause?: unknown): RpcClientError.RpcClientError =>
  new RpcClientError.RpcClientError({
    reason: new RpcClientError.RpcClientDefect({ message, cause }),
  });

const transportError = (error: HttpClientError.HttpClientError): RpcClientError.RpcClientError =>
  new RpcClientError.RpcClientError({
    reason: HttpClientError.HttpClientErrorSchema.fromHttpClientError(error),
  });

/** Completes after a `setTimeout(0)`: the queries queued until then share a POST. */
const nextMacrotask = Effect.callback<void>((resume) => {
  const handle = setTimeout(() => resume(Effect.void), 0);
  return Effect.sync(() => clearTimeout(handle));
});

/**
 * The batching protocol: queries are queued and sent after a `setTimeout(0)` in POSTs of at most
 * `maxItems` calls; other requests get a POST each. As in `RpcClient.makeProtocolHttp`, a `send`
 * ends when its `Exit` arrives and fails when the POST fails or ends without it.
 */
const makeProtocol = (url: string, queries: ReadonlySet<string>, maxItems: number) =>
  RpcClient.Protocol.make((writeResponse) =>
    Effect.gen(function* () {
      const serialization = yield* RpcSerialization.RpcSerialization;
      const client = HttpClient.mapRequest(
        yield* HttpClient.HttpClient,
        HttpClientRequest.prependUrl(url),
      );
      // A batch serves several callers, so it runs in the link's context and scope.
      const context = yield* Effect.context();
      const scope = yield* Effect.scope;

      /** Sends the calls in one POST and routes each response message to its call. */
      const exchange = (calls: ReadonlyArray<Call>) =>
        Effect.gen(function* () {
          const parser = serialization.makeUnsafe();
          const encoded = parser.encode(calls.map((call) => call.request));
          const body =
            typeof encoded === 'string'
              ? HttpBody.text(encoded, serialization.contentType)
              : HttpBody.uint8Array(encoded ?? new Uint8Array(), serialization.contentType);
          const byId = new Map(calls.map((call) => [String(call.request.id), call]));
          const route = (message: RpcMessage.FromServerEncoded): Effect.Effect<void> => {
            // Only one RpcClient uses this protocol: a message for no request goes to its client.
            const call = 'requestId' in message ? byId.get(String(message.requestId)) : calls[0];
            if (call === undefined) return Effect.void;
            const write = writeResponse(call.clientId, message);
            if (message._tag !== 'Exit' || call.state !== 'pending') return write;
            // `done` before RpcClient sees the Exit, as it then interrupts the call's `send` (not an
            // abort); uninterruptible, so aborting the POST cannot drop the Exit.
            call.state = 'done';
            return Effect.uninterruptible(
              Effect.andThen(
                write,
                Effect.sync(() => settle(call, Exit.void)),
              ),
            );
          };
          const response = yield* client.post('', { body });
          // NDJSON is decoded while it streams; JSON is one document.
          const data: Stream.Stream<Uint8Array | string, HttpClientError.HttpClientError> =
            serialization.includesFraming ? response.stream : Stream.fromEffect(response.text);
          yield* Stream.runForEach(data, (chunk) =>
            Effect.try({
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- encoded server messages; `RpcClient.make` decodes them
              try: () => parser.decode(chunk) as ReadonlyArray<RpcMessage.FromServerEncoded>,
              catch: (cause) => protocolDefect('Error decoding HTTP response', cause),
            }).pipe(
              Effect.flatMap((messages) => Effect.forEach(messages, route, { discard: true })),
            ),
          );
        }).pipe(
          Effect.mapError((error) =>
            error._tag === 'HttpClientError' ? transportError(error) : error,
          ),
        );

      /** Runs one POST, then settles the calls it left pending with its failure. */
      const post = (calls: ReadonlyArray<Call>): Effect.Effect<void> => {
        const self: Post = { calls, abort: Deferred.makeUnsafe() };
        for (const call of calls) call.post = self;
        return exchange(calls).pipe(
          Effect.raceFirst(Deferred.await(self.abort)),
          Effect.onExit((exit) =>
            Effect.sync(() => {
              const failure = Exit.isSuccess(exit)
                ? Exit.fail(protocolDefect('HTTP response ended before RPC request completed'))
                : exit;
              for (const call of calls) settle(call, failure);
            }),
          ),
          Effect.ignore,
        );
      };

      let queue: Array<Call> = [];
      const flush = Effect.suspend(() => {
        const calls = queue.filter((call) => call.state === 'pending');
        queue = [];
        const posts: Array<Effect.Effect<void>> = [];
        for (let i = 0; i < calls.length; i += maxItems) {
          posts.push(post(calls.slice(i, i + maxItems)));
        }
        return Effect.forEach(posts, (effect) => Effect.forkIn(effect, scope), { discard: true });
      });
      const enqueue = (call: Call): Effect.Effect<void> =>
        Effect.suspend(() => {
          queue.push(call);
          if (queue.length > 1) return Effect.void;
          const flushLater = Effect.andThen(nextMacrotask, flush);
          return Effect.asVoid(Effect.forkIn(Effect.provideContext(flushLater, context), scope));
        });

      const send = (
        clientId: number,
        message: RpcMessage.FromClientEncoded,
      ): Effect.Effect<void, RpcClientError.RpcClientError> => {
        // Interrupts have no HTTP message: interrupting the call interrupts its `send`.
        if (message._tag !== 'Request') return Effect.void;
        const call: Call = {
          clientId,
          request: message,
          result: Deferred.makeUnsafe(),
          state: 'pending',
          post: undefined,
        };
        return (queries.has(message.tag) ? enqueue(call) : post([call])).pipe(
          Effect.andThen(Deferred.await(call.result)),
          Effect.onInterrupt(() => Effect.sync(() => interrupt(call))),
        );
      };

      return {
        send,
        supportsAck: false,
        supportsTransferables: false,
        codecFor: serialization.codecFor,
      };
    }),
  );

const queryTags = <Rpcs extends Rpc.Any>(group: RpcGroup.RpcGroup<Rpcs>): ReadonlySet<string> =>
  new Set(
    Array.from(group.requests.values())
      .filter((rpc) => Context.get(rpc.annotations, ProcedureKind) === 'query')
      .map((rpc) => rpc._tag),
  );

/**
 * A link over HTTP (`fetch`) that sends the queries called in the same tick in one POST (tRPC's
 * `httpBatchLink`). Responses stream back per call with NDJSON, so each call settles as soon as
 * its own result arrives.
 *
 * **When to use**
 *
 * Use instead of {@link httpLink} when a page fires many queries at once (e.g. several
 * `useQuery` hooks) and one request per query is too many. Prefer {@link httpLink} when calls
 * set response headers or cookies, and {@link wsLink} for many concurrent subscriptions.
 *
 * **Details**
 *
 * - Queries called before a `setTimeout(0)` scheduled by the first queued query share a POST;
 *   with `maxItems` the batch is split into POSTs of at most that many calls.
 * - Mutations and subscriptions are not batched: each gets its own POST, like {@link httpLink}.
 * - The options of {@link httpLink} apply per POST: a `headers` function runs once per POST,
 *   and a non-2xx response or a network error fails every call of the POST with
 *   `RpcTransportError`. A typed failure or defect only fails its own call.
 * - Rpc headers (`createClient({ headers })`, `withHeaders`, per-call `headers`) travel with
 *   each call, so calls with different headers still share a POST.
 * - Aborting a call (`signal`, fiber interruption) rejects it at once with `RpcInterrupted`;
 *   the POST goes on for the other calls. Once no call of the POST is left waiting, a POST with
 *   an aborted call is aborted, so aborting every call of a POST aborts it at once.
 * - Works with every `@effect-trpc/server` HTTP adapter; no server option is needed.
 *
 * **Gotchas**
 *
 * - The calls of a batch share one HTTP response: headers and cookies a handler sets apply to
 *   all of them and only if set before the first response chunk is written. Keep a `login`
 *   mutation (never batched) for cookies.
 * - The server keeps running an aborted call until its POST is aborted (when the last other
 *   call of the POST has settled); its handler is interrupted then, not at the abort.
 * - With `serialization: 'json'` the server answers only when every call of the POST has
 *   finished, so one slow (or aborted but still running) query holds back the others. Keep the
 *   default `"ndjson"`.
 * - `url` must be absolute `http:` / `https:` and `maxItems` a positive integer; otherwise the
 *   link throws when it is created.
 *
 * **Example** (Two queries in one request)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { createClient, httpBatchLink } from '@effect-trpc/client';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post }) },
 * });
 *
 * const client = createClient(appRouter, {
 *   link: httpBatchLink({ url: 'http://localhost:3000/rpc', maxItems: 10 }),
 * });
 *
 * // Called in the same tick: one POST carries both queries.
 * const [first, second] = await Promise.all([
 *   client.post.byId({ id: 1 }),
 *   client.post.byId({ id: 2 }),
 * ]);
 * ```
 *
 * @see {@link HttpBatchLinkOptions}
 * @see {@link httpLink}
 * @category links
 * @since 0.1.0
 */
export const httpBatchLink = (options: HttpBatchLinkOptions): Link => {
  const url = String(options.url);
  assertAbsoluteUrl('httpBatchLink', url, ['http', 'https']);
  const maxItems = options.maxItems ?? Number.POSITIVE_INFINITY;
  if (options.maxItems !== undefined && !(Number.isInteger(maxItems) && maxItems > 0)) {
    throw new Error(`httpBatchLink: maxItems must be a positive integer, got ${maxItems}`);
  }
  const transport = Layer.mergeAll(
    httpClientLayer('httpBatchLink', options),
    serializationLayer(options.serialization),
  );
  return Link.make((group) =>
    Link.fromProtocol(
      Layer.effect(RpcClient.Protocol)(makeProtocol(url, queryTags(group), maxItems)).pipe(
        Layer.provide(transport),
      ),
    ).makeClient(group),
  );
};
