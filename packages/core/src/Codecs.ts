/**
 * JSON codecs for the payload, success, error and `Exit` of an rpc.
 *
 * Every codec is `Schema.toCodecJson(...)` of the corresponding schema: encoding produces plain
 * JSON (safe for `JSON.stringify`, SSR dehydration, server actions, ...) and decoding restores
 * real `Schema.Class` / `Schema.TaggedError` instances. Codecs are memoized per rpc.
 *
 * The `*Sync` helpers throw a `SchemaError` on invalid input. They only support schemas without
 * encoding/decoding services (use the codecs with `Schema.encodeEffect` otherwise).
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

/** The decoded payload type of an rpc (`unknown` for an erased `Rpc.Any`). */
export type PayloadType<R> = Parts<R>['payload']['Type'];
/** The decoded success type of an rpc; for streaming rpcs, the type of each element. */
export type SuccessType<R> = Parts<R>['success']['Type'];
/** The success type carried by the rpc's `Exit` (`void` for streaming rpcs). */
export type ExitSuccessType<R> = Parts<R>['exitSuccess']['Type'];
/** The typed error of an rpc: its error schema, stream errors and middleware errors. */
export type ErrorType<R> = Parts<R>['error']['Type'];

/** JSON codec of an rpc's payload. */
export type PayloadCodec<R> = CodecOf<Parts<R>['payload']>;
/** JSON codec of an rpc's success value (the element for streaming rpcs). */
export type SuccessCodec<R> = CodecOf<Parts<R>['success']>;
/** JSON codec of an rpc's typed error. */
export type ErrorCodec<R> = CodecOf<Parts<R>['error']>;
/** JSON codec of an rpc's `Exit`. */
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

/** JSON codec of the rpc's payload. */
export const payload = <R extends Rpc.Any>(rpc: R): PayloadCodec<R> => payloadCodec(rpc);

/** JSON codec of the rpc's success value. For streaming rpcs (subscriptions): one element. */
export const success = <R extends Rpc.Any>(rpc: R): SuccessCodec<R> => successCodec(rpc);

/** JSON codec of the rpc's typed error (error schema, stream error and middleware errors). */
export const error = <R extends Rpc.Any>(rpc: R): ErrorCodec<R> => errorCodec(rpc);

/**
 * JSON codec of the rpc's `Exit` (`Rpc.exitSchema`). Encodes to
 * `{ _tag: "Success", value } | { _tag: "Failure", cause: [...] }`. For streaming rpcs the exit
 * success is `void` (elements travel separately).
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

/** Encodes a payload to JSON. */
export const encodePayloadSync = <R extends Rpc.Any>(rpc: R, value: PayloadType<R>): Schema.Json =>
  encoderOf(payloadCodec(rpc))(value);

/** Decodes a payload from JSON. */
export const decodePayloadSync = <R extends Rpc.Any>(rpc: R, json: unknown): PayloadType<R> =>
  decoderOf(payloadCodec(rpc))(json);

/** Encodes a success value (a stream element for subscriptions) to JSON. */
export const encodeSuccessSync = <R extends Rpc.Any>(rpc: R, value: SuccessType<R>): Schema.Json =>
  encoderOf(successCodec(rpc))(value);

/** Decodes a success value (a stream element for subscriptions) from JSON. */
export const decodeSuccessSync = <R extends Rpc.Any>(rpc: R, json: unknown): SuccessType<R> =>
  decoderOf(successCodec(rpc))(json);

/** Encodes a typed error to JSON. */
export const encodeErrorSync = <R extends Rpc.Any>(rpc: R, value: ErrorType<R>): Schema.Json =>
  encoderOf(errorCodec(rpc))(value);

/** Decodes a typed error from JSON. */
export const decodeErrorSync = <R extends Rpc.Any>(rpc: R, json: unknown): ErrorType<R> =>
  decoderOf(errorCodec(rpc))(json);

/** Encodes an `Exit` to JSON. */
export const encodeExitSync = <R extends Rpc.Any>(
  rpc: R,
  value: Exit.Exit<ExitSuccessType<R>, ErrorType<R>>,
): Schema.Json => encoderOf(exitCodec(rpc))(value);

/** Decodes an `Exit` from JSON. */
export const decodeExitSync = <R extends Rpc.Any>(
  rpc: R,
  json: unknown,
): Exit.Exit<ExitSuccessType<R>, ErrorType<R>> =>
  decoderOf(exitCodec(rpc))(json) as Exit.Exit<ExitSuccessType<R>, ErrorType<R>>;
