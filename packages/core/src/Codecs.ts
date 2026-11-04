/**
 * JSON codecs for the payload, success, error and `Exit` of a compiled rpc.
 *
 * Every codec is `Schema.toCodecJson(...)` of the corresponding schema: encoding produces plain
 * JSON (safe for `JSON.stringify`, SSR dehydration, server actions, ...) and decoding restores
 * real `Schema.Class` / `Schema.TaggedError` instances. Codecs are memoized per rpc. Get the rpc
 * with `Router.getRpc(router, tag)`; the TanStack Query bridge and the server adapters use these
 * codecs to move values across JSON boundaries.
 *
 * The `*Sync` helpers throw a `SchemaError` on invalid input. They only support schemas without
 * encoding/decoding services (use the codecs with `Schema.encodeEffect` otherwise).
 *
 * @since 0.1.0
 */
import { Schema } from 'effect';
import type { Exit } from 'effect';
import { Rpc, RpcSchema } from 'effect/rpc';
import type { RpcMiddleware } from 'effect/rpc';

type Parts<R> =
  R extends Rpc.Rpc<
    infer _Tag,
    infer P,
    infer S,
    infer E,
    infer M extends RpcMiddleware.AnyService,
    infer _Requires
  >
    ? S extends RpcSchema.Stream<infer A, infer SE>
      ? { payload: P; success: A; exitSuccess: Schema.Void; error: E | SE | M['error'] }
      : { payload: P; success: S; exitSuccess: S; error: E | M['error'] }
    : {
        payload: Schema.Top;
        success: Schema.Top;
        exitSuccess: Schema.Top;
        error: Schema.Top;
      };

type CodecOf<S extends Schema.Top> = Schema.Codec<
  S['Type'],
  Schema.Json,
  S['DecodingServices'],
  S['EncodingServices']
>;

/**
 * The decoded payload type of an rpc (`unknown` for an erased `Rpc.Any`).
 *
 * **Example** (Reading a procedure's input type)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import type { Rpc } from 'effect/rpc';
 * import type { Codecs } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * type ById = Rpc.ExtractTag<Router.Rpcs<typeof appRouter>, 'post.byId'>;
 *
 * type Input = Codecs.PayloadType<ById>; // { readonly id: number }
 * ```
 *
 * @see {@link payload}
 * @category type-level
 * @since 0.1.0
 */
export type PayloadType<R> = Parts<R>['payload']['Type'];

/**
 * The decoded success type of an rpc; for streaming rpcs, the type of each element.
 *
 * **Example** (Reading a procedure's output type)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import type { Rpc } from 'effect/rpc';
 * import type { Codecs } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * type ById = Rpc.ExtractTag<Router.Rpcs<typeof appRouter>, 'post.byId'>;
 *
 * type Output = Codecs.SuccessType<ById>; // Post
 * ```
 *
 * @see {@link success}
 * @category type-level
 * @since 0.1.0
 */
export type SuccessType<R> = Parts<R>['success']['Type'];

/**
 * The success type carried by the rpc's `Exit` (`void` for streaming rpcs).
 *
 * **Example** (Reading the exit success type)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import type { Rpc } from 'effect/rpc';
 * import type { Codecs } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * type ById = Rpc.ExtractTag<Router.Rpcs<typeof appRouter>, 'post.byId'>;
 *
 * type Value = Codecs.ExitSuccessType<ById>; // Post
 * ```
 *
 * @see {@link exit}
 * @category type-level
 * @since 0.1.0
 */
export type ExitSuccessType<R> = Parts<R>['exitSuccess']['Type'];

/**
 * The typed error of an rpc: its error schema, stream errors and middleware errors.
 *
 * **Details**
 *
 * - Does not include the infrastructure errors (`RpcDefect`, ...); wrap it in `ClientError` for that.
 *
 * **Example** (Reading a procedure's typed error)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import type { Rpc } from 'effect/rpc';
 * import type { Codecs } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * type ById = Rpc.ExtractTag<Router.Rpcs<typeof appRouter>, 'post.byId'>;
 *
 * type Failure = Codecs.ErrorType<ById>; // PostNotFound
 * ```
 *
 * @see {@link error}
 * @category type-level
 * @since 0.1.0
 */
export type ErrorType<R> = Parts<R>['error']['Type'];

/**
 * The JSON codec type of an rpc's payload (what {@link payload} returns).
 *
 * **Example** (Annotating a payload codec)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import type { Rpc } from 'effect/rpc';
 * import type { Codecs } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * type ById = Rpc.ExtractTag<Router.Rpcs<typeof appRouter>, 'post.byId'>;
 *
 * declare const codec: Codecs.PayloadCodec<ById>;
 * ```
 *
 * @see {@link payload}
 * @category type-level
 * @since 0.1.0
 */
export type PayloadCodec<R> = CodecOf<Parts<R>['payload']>;

/**
 * The JSON codec type of an rpc's success value (the element for streaming rpcs).
 *
 * **Example** (Annotating a success codec)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import type { Rpc } from 'effect/rpc';
 * import type { Codecs } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * type ById = Rpc.ExtractTag<Router.Rpcs<typeof appRouter>, 'post.byId'>;
 *
 * declare const codec: Codecs.SuccessCodec<ById>;
 * ```
 *
 * @see {@link success}
 * @category type-level
 * @since 0.1.0
 */
export type SuccessCodec<R> = CodecOf<Parts<R>['success']>;

/**
 * The JSON codec type of an rpc's typed error (what {@link error} returns).
 *
 * **Example** (Annotating an error codec)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import type { Rpc } from 'effect/rpc';
 * import type { Codecs } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * type ById = Rpc.ExtractTag<Router.Rpcs<typeof appRouter>, 'post.byId'>;
 *
 * declare const codec: Codecs.ErrorCodec<ById>;
 * ```
 *
 * @see {@link error}
 * @category type-level
 * @since 0.1.0
 */
export type ErrorCodec<R> = CodecOf<Parts<R>['error']>;

/**
 * The JSON codec type of an rpc's `Exit` (what {@link exit} returns).
 *
 * **Example** (Annotating an exit codec)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import type { Rpc } from 'effect/rpc';
 * import type { Codecs } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * type ById = Rpc.ExtractTag<Router.Rpcs<typeof appRouter>, 'post.byId'>;
 *
 * declare const codec: Codecs.ExitCodec<ById>;
 * ```
 *
 * @see {@link exit}
 * @category type-level
 * @since 0.1.0
 */
export type ExitCodec<R> = Schema.Codec<
  Exit.Exit<ExitSuccessType<R>, ErrorType<R>>,
  Schema.Json,
  Parts<R>['exitSuccess']['DecodingServices'] | Parts<R>['error']['DecodingServices'],
  Parts<R>['exitSuccess']['EncodingServices'] | Parts<R>['error']['EncodingServices']
>;

type AnyCodec = Schema.Codec<unknown, Schema.Json>;

const memo = (build: (rpc: Rpc.AnyWithProps) => Schema.Top) => {
  const cache = new WeakMap<Rpc.Any, AnyCodec>();
  return (rpc: Rpc.Any): AnyCodec => {
    let codec = cache.get(rpc);
    if (codec === undefined) {
      codec = Schema.toCodecJson(build(rpc as Rpc.AnyWithProps)) as unknown as AnyCodec;
      cache.set(rpc, codec);
    }
    return codec;
  };
};

const errorSchemaOf = (rpc: Rpc.AnyWithProps): Schema.Top => {
  const failures = new Set<Schema.Top>([rpc.errorSchema]);
  if (RpcSchema.isStreamSchema(rpc.successSchema)) {
    failures.add(rpc.successSchema.error);
  }
  for (const middleware of rpc.middlewares) {
    failures.add(middleware.error);
  }
  return Schema.Union([...failures]);
};

const payloadCodec = memo((rpc) => rpc.payloadSchema);
const successCodec = memo((rpc) =>
  RpcSchema.isStreamSchema(rpc.successSchema) ? rpc.successSchema.success : rpc.successSchema,
);
const errorCodec = memo(errorSchemaOf);
const exitCodec = memo((rpc) => Rpc.exitSchema(rpc));

/**
 * Returns the JSON codec of the rpc's payload.
 *
 * **When to use**
 *
 * Use to encode a procedure's input for a JSON boundary (URL search params, a query key, a
 * server action) and decode it back with `Schema.decodeUnknownEffect` / `Schema.decodeUnknownSync`.
 * Prefer {@link encodePayloadSync} / {@link decodePayloadSync} for one-off synchronous calls.
 *
 * **Details**
 *
 * - `Schema.toCodecJson(rpc.payloadSchema)`; memoized per rpc (the same rpc returns the same
 *   codec instance).
 *
 * **Example** (Encoding a payload with the codec)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const codec = Codecs.payload(rpc);
 * const json = Schema.encodeSync(codec)({ id: 3 }); // { id: 3 }
 * const input = Schema.decodeUnknownSync(codec)(json); // { readonly id: number }
 * ```
 *
 * @see {@link encodePayloadSync}
 * @see {@link success}
 * @category codecs
 * @since 0.1.0
 */
export const payload = <R extends Rpc.Any>(rpc: R): PayloadCodec<R> => payloadCodec(rpc);

/**
 * Returns the JSON codec of the rpc's success value. For streaming rpcs (subscriptions): one element.
 *
 * **When to use**
 *
 * Use to serialize a procedure's output across a JSON boundary (SSR dehydration, a cache, a
 * server action) so that `Schema.Class` instances and `Date`s come back as real instances.
 *
 * **Details**
 *
 * - `Schema.toCodecJson` of the success schema; for a subscription this is the **element**
 *   schema (`RpcSchema.Stream`'s `success`), not the stream.
 * - Memoized per rpc.
 *
 * **Gotchas**
 *
 * - `JSON.parse(JSON.stringify(post))` is a plain object, not a `Post`; go through the codec.
 *
 * **Example** (Round-tripping a Schema.Class through JSON)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const codec = Codecs.success(rpc);
 * const post = new Post({ id: 1, title: 'Hello', createdAt: new Date(0) });
 * const text = JSON.stringify(Schema.encodeSync(codec)(post));
 * const decoded = Schema.decodeUnknownSync(codec)(JSON.parse(text));
 * decoded instanceof Post; // true, and decoded.createdAt is a Date
 * ```
 *
 * @see {@link encodeSuccessSync}
 * @see {@link exit}
 * @category codecs
 * @since 0.1.0
 */
export const success = <R extends Rpc.Any>(rpc: R): SuccessCodec<R> => successCodec(rpc);

/**
 * Returns the JSON codec of the rpc's typed error (error schema, stream error and middleware errors).
 *
 * **When to use**
 *
 * Use to serialize a procedure's declared failure, e.g. to pass a `Schema.TaggedError` from a
 * server action to the client and get the same class back.
 *
 * **Details**
 *
 * - The codec is `Schema.toCodecJson(Schema.Union([errorSchema, streamError?, ...middlewareErrors]))`.
 * - Infrastructure errors (`RpcDefect`, ...) are not part of it; they are not declared errors.
 * - Memoized per rpc.
 *
 * **Example** (Round-tripping a TaggedError)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const codec = Codecs.error(rpc);
 * const json = Schema.encodeSync(codec)(new PostNotFound({ id: 7 })); // { _tag: 'PostNotFound', id: 7 }
 * const error = Schema.decodeUnknownSync(codec)(json);
 * error instanceof PostNotFound; // true
 * ```
 *
 * @see {@link encodeErrorSync}
 * @category codecs
 * @since 0.1.0
 */
export const error = <R extends Rpc.Any>(rpc: R): ErrorCodec<R> => errorCodec(rpc);

/**
 * Returns the JSON codec of the rpc's `Exit` (`Rpc.exitSchema`).
 *
 * **When to use**
 *
 * Use to carry a whole call result (success, typed failure or defect) across a JSON boundary,
 * e.g. a server action that returns an `Exit` the client decodes with full fidelity.
 *
 * **Details**
 *
 * - Encodes to `{ _tag: "Success", value } | { _tag: "Failure", cause: [...] }`.
 * - Typed failures decode to the same `Schema.TaggedError` class; defects round-trip as `Die`.
 * - For streaming rpcs the exit success is `void` (elements travel separately; use
 *   {@link success} for them).
 * - Memoized per rpc.
 *
 * **Example** (Serializing a failed call)
 *
 * ```ts
 * import { Exit, Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const codec = Codecs.exit(rpc);
 * const json = Schema.encodeSync(codec)(Exit.fail(new PostNotFound({ id: 7 })));
 * // {"_tag":"Failure","cause":[{"_tag":"Fail","error":{"_tag":"PostNotFound","id":7}}]}
 * const exit = Schema.decodeUnknownSync(codec)(JSON.parse(JSON.stringify(json)));
 * // Exit<Post, PostNotFound>
 * ```
 *
 * @see {@link encodeExitSync}
 * @see {@link decodeExitSync}
 * @category codecs
 * @since 0.1.0
 */
export const exit = <R extends Rpc.Any>(rpc: R): ExitCodec<R> =>
  exitCodec(rpc) as unknown as ExitCodec<R>;

type Encode = (input: unknown) => Schema.Json;
type Decode = (input: unknown) => unknown;
const encoders = new WeakMap<AnyCodec, Encode>();
const decoders = new WeakMap<AnyCodec, Decode>();

const encoderOf = (codec: AnyCodec): Encode => {
  let encode = encoders.get(codec);
  if (encode === undefined) {
    const run = Schema.encodeSync(codec);
    encode = (input) => run(input);
    encoders.set(codec, encode);
  }
  return encode;
};

const decoderOf = (codec: AnyCodec): Decode => {
  let decode = decoders.get(codec);
  if (decode === undefined) {
    const run = Schema.decodeUnknownSync(codec);
    decode = (input) => run(input);
    decoders.set(codec, decode);
  }
  return decode;
};

/**
 * Encodes a payload to JSON.
 *
 * **When to use**
 *
 * Use to put a procedure's input into a JSON-only place (a query key, a URL, a form action).
 *
 * **Details**
 *
 * - Uses {@link payload} (memoized per rpc); the compiled encoder/decoder is cached too.
 *
 * **Gotchas**
 *
 * - Throws a `SchemaError` on invalid input.
 * - Only for schemas without encoding/decoding services; otherwise use the codec with
 *   `Schema.encodeEffect` / `Schema.decodeUnknownEffect`.
 *
 * **Example** (Encoding a payload)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const json = Codecs.encodePayloadSync(rpc, { id: 3 }); // { id: 3 }
 * ```
 *
 * @see {@link decodePayloadSync}
 * @category codecs
 * @since 0.1.0
 */
export const encodePayloadSync = <R extends Rpc.Any>(rpc: R, value: PayloadType<R>): Schema.Json =>
  encoderOf(payloadCodec(rpc))(value);

/**
 * Decodes a payload from JSON.
 *
 * **When to use**
 *
 * Use to restore a procedure's input from untrusted JSON (a request body, a URL).
 *
 * **Details**
 *
 * - Uses {@link payload} (memoized per rpc); the compiled encoder/decoder is cached too.
 *
 * **Gotchas**
 *
 * - Throws a `SchemaError` on invalid input.
 * - Only for schemas without encoding/decoding services; otherwise use the codec with
 *   `Schema.encodeEffect` / `Schema.decodeUnknownEffect`.
 *
 * **Example** (Decoding a payload)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const input = Codecs.decodePayloadSync(rpc, JSON.parse('{"id":3}'));
 * input.id; // 3
 * ```
 *
 * @see {@link encodePayloadSync}
 * @category codecs
 * @since 0.1.0
 */
export const decodePayloadSync = <R extends Rpc.Any>(rpc: R, json: unknown): PayloadType<R> =>
  decoderOf(payloadCodec(rpc))(json);

/**
 * Encodes a success value (a stream element for subscriptions) to JSON.
 *
 * **When to use**
 *
 * Use to serialize a procedure's output, e.g. to embed it in server-rendered HTML.
 *
 * **Details**
 *
 * - Uses {@link success} (memoized per rpc); the compiled encoder/decoder is cached too.
 *
 * **Gotchas**
 *
 * - Throws a `SchemaError` on invalid input.
 * - Only for schemas without encoding/decoding services; otherwise use the codec with
 *   `Schema.encodeEffect` / `Schema.decodeUnknownEffect`.
 *
 * **Example** (Encoding a Schema.Class)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const post = new Post({ id: 1, title: 'Hello World', createdAt: new Date(0) });
 * JSON.stringify(Codecs.encodeSuccessSync(rpc, post));
 * // {"id":1,"title":"Hello World","createdAt":"1970-01-01T00:00:00.000Z"}
 * ```
 *
 * @see {@link decodeSuccessSync}
 * @category codecs
 * @since 0.1.0
 */
export const encodeSuccessSync = <R extends Rpc.Any>(rpc: R, value: SuccessType<R>): Schema.Json =>
  encoderOf(successCodec(rpc))(value);

/**
 * Decodes a success value (a stream element for subscriptions) from JSON.
 *
 * **When to use**
 *
 * Use to restore a procedure's output from JSON as real instances (`Schema.Class`, `Date`).
 *
 * **Details**
 *
 * - Uses {@link success} (memoized per rpc); the compiled encoder/decoder is cached too.
 *
 * **Gotchas**
 *
 * - Throws a `SchemaError` on invalid input.
 * - Only for schemas without encoding/decoding services; otherwise use the codec with
 *   `Schema.encodeEffect` / `Schema.decodeUnknownEffect`.
 *
 * **Example** (Restoring a Schema.Class instance)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const post = Codecs.decodeSuccessSync(
 *   rpc,
 *   JSON.parse('{"id":1,"title":"Hello","createdAt":"1970-01-01T00:00:00.000Z"}'),
 * );
 * post instanceof Post; // true; post.createdAt is a Date
 * ```
 *
 * @see {@link encodeSuccessSync}
 * @category codecs
 * @since 0.1.0
 */
export const decodeSuccessSync = <R extends Rpc.Any>(rpc: R, json: unknown): SuccessType<R> =>
  decoderOf(successCodec(rpc))(json);

/**
 * Encodes a typed error to JSON.
 *
 * **When to use**
 *
 * Use to serialize a declared `Schema.TaggedError` (including stream and middleware errors).
 *
 * **Details**
 *
 * - Uses {@link error} (memoized per rpc); the compiled encoder/decoder is cached too.
 *
 * **Gotchas**
 *
 * - Throws a `SchemaError` on invalid input.
 * - Only for schemas without encoding/decoding services; otherwise use the codec with
 *   `Schema.encodeEffect` / `Schema.decodeUnknownEffect`.
 *
 * **Example** (Encoding a TaggedError)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const json = Codecs.encodeErrorSync(rpc, new PostNotFound({ id: 7 }));
 * // { _tag: 'PostNotFound', id: 7 }
 * ```
 *
 * @see {@link decodeErrorSync}
 * @category codecs
 * @since 0.1.0
 */
export const encodeErrorSync = <R extends Rpc.Any>(rpc: R, value: ErrorType<R>): Schema.Json =>
  encoderOf(errorCodec(rpc))(value);

/**
 * Decodes a typed error from JSON.
 *
 * **When to use**
 *
 * Use to restore a declared error from JSON as an instance of its `Schema.TaggedError` class.
 *
 * **Details**
 *
 * - Uses {@link error} (memoized per rpc); the compiled encoder/decoder is cached too.
 *
 * **Gotchas**
 *
 * - Throws a `SchemaError` on invalid input.
 * - Only for schemas without encoding/decoding services; otherwise use the codec with
 *   `Schema.encodeEffect` / `Schema.decodeUnknownEffect`.
 *
 * **Example** (Restoring a TaggedError)
 *
 * ```ts
 * import { Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const error = Codecs.decodeErrorSync(rpc, { _tag: 'PostNotFound', id: 7 });
 * error instanceof PostNotFound; // true
 * ```
 *
 * @see {@link encodeErrorSync}
 * @category codecs
 * @since 0.1.0
 */
export const decodeErrorSync = <R extends Rpc.Any>(rpc: R, json: unknown): ErrorType<R> =>
  decoderOf(errorCodec(rpc))(json);

/**
 * Encodes an `Exit` to JSON.
 *
 * **When to use**
 *
 * Use to return a full call result (success, typed failure or defect) from a JSON-only boundary.
 *
 * **Details**
 *
 * - Uses {@link exit} (memoized per rpc); the compiled encoder/decoder is cached too.
 *
 * **Gotchas**
 *
 * - Throws a `SchemaError` on invalid input.
 * - Only for schemas without encoding/decoding services; otherwise use the codec with
 *   `Schema.encodeEffect` / `Schema.decodeUnknownEffect`.
 *
 * **Example** (Encoding a failure exit)
 *
 * ```ts
 * import { Exit, Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const json = Codecs.encodeExitSync(rpc, Exit.fail(new PostNotFound({ id: 7 })));
 * // { _tag: 'Failure', cause: [{ _tag: 'Fail', error: { _tag: 'PostNotFound', id: 7 } }] }
 * ```
 *
 * @see {@link decodeExitSync}
 * @category codecs
 * @since 0.1.0
 */
export const encodeExitSync = <R extends Rpc.Any>(
  rpc: R,
  value: Exit.Exit<ExitSuccessType<R>, ErrorType<R>>,
): Schema.Json => encoderOf(exitCodec(rpc))(value);

/**
 * Decodes an `Exit` from JSON.
 *
 * **When to use**
 *
 * Use on the receiving side of {@link encodeExitSync}; combine with `exitToClientError` to get a
 * `ClientError`.
 *
 * **Details**
 *
 * - Uses {@link exit} (memoized per rpc); the compiled encoder/decoder is cached too.
 *
 * **Gotchas**
 *
 * - Throws a `SchemaError` on invalid input.
 * - Only for schemas without encoding/decoding services; otherwise use the codec with
 *   `Schema.encodeEffect` / `Schema.decodeUnknownEffect`.
 *
 * **Example** (Decoding an exit back to class instances)
 *
 * ```ts
 * import { Exit, Schema } from 'effect';
 * import { Codecs, query, Router } from '@effect-trpc/core';
 *
 * class Post extends Schema.Class<Post>('Post')({
 *   id: Schema.Number,
 *   title: Schema.String,
 *   createdAt: Schema.Date,
 * }) {}
 * class PostNotFound extends Schema.TaggedError<PostNotFound>()('PostNotFound', {
 *   id: Schema.Number,
 * }) {}
 *
 * const appRouter = Router.make({
 *   post: { byId: query({ payload: { id: Schema.Number }, success: Post, error: PostNotFound }) },
 * });
 * const rpc = Router.getRpc(appRouter, 'post.byId');
 *
 * const text = JSON.stringify(Codecs.encodeExitSync(rpc, Exit.fail(new PostNotFound({ id: 7 }))));
 * const exit = Codecs.decodeExitSync(rpc, JSON.parse(text)); // Exit<Post, PostNotFound>
 * if (Exit.isFailure(exit)) {
 *   // the failure is a real PostNotFound instance again
 * }
 * ```
 *
 * @see {@link encodeExitSync}
 * @see {@link exit}
 * @category codecs
 * @since 0.1.0
 */
export const decodeExitSync = <R extends Rpc.Any>(
  rpc: R,
  json: unknown,
): Exit.Exit<ExitSuccessType<R>, ErrorType<R>> =>
  decoderOf(exitCodec(rpc))(json) as Exit.Exit<ExitSuccessType<R>, ErrorType<R>>;
