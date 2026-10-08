import {
  causeToClientError,
  Codecs,
  RpcDefect,
  RpcTransportError,
  type ClientError,
  type inferError,
  type inferInput,
  type inferOutput,
  type ProcedureDef,
  type ProcedureInfo,
  type Router,
} from '@effect-trpc/core';
import { createCaller, type Caller } from '@effect-trpc/server';
import { Cause, Effect, Exit, Schema } from 'effect';
import type { Layer } from 'effect';
import type { Headers } from 'effect/http';
import type { ActionPath, ErrorAt, InputArgs, InputAt, OutputAt, RecordOf } from './types.js';

/** One reason of an encoded `Cause` (see `Codecs.exit`). */
export type EncodedCauseReason =
  | { readonly _tag: 'Fail'; readonly error: Schema.Json }
  | { readonly _tag: 'Die'; readonly defect: Schema.Json }
  | { readonly _tag: 'Interrupt'; readonly fiberId: number | null };

/**
 * The JSON form of an `Exit` produced by `Codecs.exit(rpc)`: what a server action returns. It
 * is plain JSON, so React can send it from the server to the client unchanged.
 */
export type EncodedExit =
  | { readonly _tag: 'Success'; readonly value: Schema.Json }
  | { readonly _tag: 'Failure'; readonly cause: ReadonlyArray<EncodedCauseReason> };

/** Type-level only: the decoded success / error types of an {@link EncodedActionResult}. */
export interface ActionResultTypes<A, E> {
  readonly success: A;
  readonly error: E;
}

/**
 * The result of a {@link ServerAction}: an {@link EncodedExit} that remembers (at the type level
 * only) the procedure's decoded output `A` and typed error `E`. Decode it with
 * `decodeActionResult` / `unwrapActionResult` / `useServerAction`.
 */
export type EncodedActionResult<A, E> = EncodedExit & {
  /** Type-level only; never present at runtime. */
  readonly '~effect-trpc/action'?: ActionResultTypes<A, E> | undefined;
};

/**
 * A server action calling one procedure: `(input) => Promise<EncodedActionResult<A, E>>`. It never
 * rejects with a typed error — failures (typed errors, defects, interruption, invalid input) are
 * encoded into the result, because errors thrown by a server action lose their class and fields
 * on the way to the client (and their message in production).
 */
export type ServerAction<D extends ProcedureDef.Any> = (
  ...args: InputArgs<inferInput<D>>
) => Promise<EncodedActionResult<inferOutput<D>, inferError<D>>>;

/** The decoded output type of a server action (or of its encoded result). */
export type inferActionOutput<T> = T extends (
  ...args: ReadonlyArray<never>
) => PromiseLike<EncodedActionResult<infer A, infer _E>>
  ? A
  : T extends EncodedActionResult<infer A, infer _E>
    ? A
    : never;

/** The typed error of a server action (or of its encoded result), without `ClientError`. */
export type inferActionError<T> = T extends (
  ...args: ReadonlyArray<never>
) => PromiseLike<EncodedActionResult<infer _A, infer E>>
  ? E
  : T extends EncodedActionResult<infer _A, infer E>
    ? E
    : never;

/**
 * The error a decoded server action result fails with (what `unwrapActionResult` rejects with):
 * `ClientError<E>` — the procedure's typed errors or an infrastructure error.
 */
export type inferActionClientError<T> = ClientError<inferActionError<T>>;

/** The server actions of a router record, nested like the router. */
export type ServerActionRecord<Rec> = {
  readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
    ? Rec[K]['kind'] extends 'subscription'
      ? never
      : ServerAction<Rec[K]>
    : ServerActionRecord<RecordOf<Rec[K]>>;
};

/** The server action of the procedure at path `P` (same shape as {@link ServerAction}). */
export type ServerActionAt<R extends Router.Any, P extends string> = (
  ...args: InputArgs<InputAt<R, P>>
) => Promise<EncodedActionResult<OutputAt<R, P>, ErrorAt<R, P>>>;

/** Options of {@link createServerActionCaller}. */
export interface ServerActionCallerOptions<R extends Router.Any, LE = never> {
  /**
   * Layer providing every handler of the router and the server implementation of every
   * middleware it uses. Built lazily on the first action call.
   */
  readonly handlers: Layer.Layer<Caller.Requirements<R>, LE>;
  /**
   * Headers for every action call, visible to middleware and handlers (`ctx.headers`). Evaluated
   * once per call — pass Next's `headers()` here: `headers: async () => await headers()`.
   */
  readonly headers?: (() => Headers.Input | PromiseLike<Headers.Input>) | undefined;
}

/** What {@link createServerActionCaller} returns. */
export interface ServerActionCaller<R extends Router.Any> {
  /** The server action of a query or mutation: `actions('post.byId')`. */
  <const P extends ActionPath<R>>(path: P): ServerActionAt<R, P>;
  /** The same actions, nested like the router: `actions.nested.post.byId`. */
  readonly nested: ServerActionRecord<Router.Record<R>>;
  /** The in-process caller the actions run on (`createCaller(router, { handlers })`). */
  readonly caller: Caller<R>;
  /** Releases the handler layer. Later calls resolve with an interrupted result. */
  readonly dispose: () => Promise<void>;
}

const getInfo = (router: Router.Any, path: string): ProcedureInfo => {
  const info = router.procedures.get(path);
  if (info === undefined) throw new Error(`effect-trpc: no procedure at path "${path}"`);
  if (info.kind === 'subscription') {
    throw new Error(`effect-trpc: subscription "${path}" cannot be used as a server action`);
  }
  return info;
};

const messageOf = (u: unknown, fallback: string): string =>
  u instanceof Error ? u.message : typeof u === 'string' ? u : fallback;

/**
 * Only the message of a defect crosses the boundary: no stack trace, no `cause`, no arbitrary
 * server-side objects.
 */
const safeCause = <E>(cause: Cause.Cause<E>): Cause.Cause<E> =>
  Cause.fromReasons(
    cause.reasons.flatMap((reason): ReadonlyArray<Cause.Reason<E>> =>
      Cause.isDieReason(reason)
        ? Cause.die(new Error(messageOf(reason.defect, 'An unexpected error occurred'))).reasons
        : [reason],
    ),
  );

const encodeExit = (
  info: ProcedureInfo,
  exit: Exit.Exit<unknown, unknown>,
): EncodedActionResult<never, never> => {
  const safe = Exit.isSuccess(exit) ? exit : Exit.failCause(safeCause(exit.cause));
  try {
    return Codecs.encodeExitSync(info.rpc, safe) as EncodedExit;
  } catch {
    return Codecs.encodeExitSync(
      info.rpc,
      Exit.die(new Error(`effect-trpc: the result of "${info.tag}" could not be encoded`)),
    ) as EncodedExit;
  }
};

/**
 * Validates the input of an action: it comes from the network. Accepts the decoded type (plain
 * values, `Date`s, ...) and, for `Schema.Class` payloads, its plain-object encoded form.
 */
const decodeInput = (info: ProcedureInfo, input: unknown): Exit.Exit<unknown, unknown> => {
  const schema = info.rpc.payloadSchema;
  const asType = Schema.decodeUnknownExit(Schema.toType(schema) as Schema.Codec<unknown>)(input);
  if (Exit.isSuccess(asType)) return asType;
  const asEncoded = Schema.decodeUnknownExit(schema as Schema.Codec<unknown>)(input);
  return Exit.isSuccess(asEncoded) ? asEncoded : asType;
};

type EffectFn = (
  input: unknown,
  options?: { readonly headers?: Headers.Input | undefined },
) => Effect.Effect<unknown, unknown>;

const procedureOf = (caller: unknown, path: ReadonlyArray<string>): EffectFn =>
  path.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], caller) as EffectFn;

/**
 * Creates server actions for a router's queries and mutations (tRPC's
 * `experimental_createServerActionHandler`). Each action runs the procedure in-process (through
 * `createCaller`, so middleware runs) and resolves with the **encoded** `Exit`: success values,
 * typed errors and defects all cross the server → client boundary as JSON, and the client turns
 * them back into class instances with `decodeActionResult` / `unwrapActionResult` /
 * `useServerAction`.
 *
 * ```ts
 * // app/actions.ts
 * 'use server';
 * const actions = createServerActionCaller(appRouter, {
 *   handlers: HandlersLive,
 *   headers: async () => await headers(),
 * });
 * export async function createPost(input: { title: string }) {
 *   return actions('post.create')(input);
 * }
 * ```
 *
 * The input is validated with the procedure's payload schema (it comes from the network); an
 * invalid input resolves with a defect. Defects only keep their message.
 */
export const createServerActionCaller = <R extends Router.Any, LE = never>(
  router: R,
  options: ServerActionCallerOptions<R, LE>,
): ServerActionCaller<R> => {
  const caller = createCaller(router, { handlers: options.handlers });
  const cache = new Map<string, (input?: unknown) => Promise<EncodedExit>>();

  const run = async (info: ProcedureInfo, input: unknown): Promise<EncodedExit> => {
    const decoded = decodeInput(info, input);
    if (Exit.isFailure(decoded)) {
      const issue = messageOf(Cause.squash(decoded.cause), 'invalid input');
      return encodeExit(info, Exit.die(new Error(`Invalid input for "${info.tag}": ${issue}`)));
    }
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const headers =
          options.headers === undefined
            ? undefined
            : yield* Effect.tryPromise({
                try: async () => await options.headers?.(),
                catch: (cause) => cause,
              }).pipe(Effect.orDie);
        return yield* procedureOf(caller, info.path)(
          decoded.value,
          headers === undefined ? undefined : { headers },
        );
      }),
    );
    return encodeExit(info, exit);
  };

  const actionAt = (path: string): ((input?: unknown) => Promise<EncodedExit>) => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    const info = getInfo(router, path);
    const action = async (input?: unknown): Promise<EncodedExit> => await run(info, input);
    cache.set(path, action);
    return action;
  };

  // Router nodes are proxies; procedure leaves are the (memoized) actions themselves.
  const nestedProxy = (path: ReadonlyArray<string>): unknown =>
    new Proxy(
      {},
      {
        get: (_target, key) => {
          if (typeof key !== 'string' || key === 'then') return undefined;
          const next = [...path, key];
          return router.procedures.has(next.join('.'))
            ? actionAt(next.join('.'))
            : nestedProxy(next);
        },
      },
    );

  const self = ((path: string) => actionAt(path)) as unknown as {
    -readonly [K in keyof ServerActionCaller<R>]: ServerActionCaller<R>[K];
  };
  Object.defineProperties(self, {
    nested: { value: nestedProxy([]), enumerable: true },
    caller: { value: caller, enumerable: true },
    dispose: { value: () => caller.dispose(), enumerable: true },
  });
  return self as ServerActionCaller<R>;
};

type DecodedResult<A, E> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: ClientError<E> };

const decodeResult = (
  router: Router.Any,
  path: string,
  encoded: unknown,
): DecodedResult<unknown, unknown> => {
  const info = getInfo(router, path);
  let exit: Exit.Exit<unknown, unknown>;
  try {
    exit = Codecs.decodeExitSync(info.rpc, encoded);
  } catch (cause) {
    return {
      ok: false,
      error: new RpcDefect({
        message: `effect-trpc: malformed server action result for "${path}"`,
        cause,
      }),
    };
  }
  return Exit.isSuccess(exit)
    ? { ok: true, value: exit.value }
    : { ok: false, error: causeToClientError(exit.cause) };
};

/**
 * Decodes the result of a server action back to an `Exit` of class instances:
 * `Exit<Post, ClientError<PostNotFound>>`. Typed errors are the procedure's `TaggedError`
 * instances; defects become `RpcDefect`, interruption `RpcInterrupted`. A malformed result also
 * becomes an `RpcDefect`.
 */
export const decodeActionResult = <R extends Router.Any, const P extends ActionPath<R>>(
  router: R,
  path: P,
  encoded: EncodedExit,
): Exit.Exit<OutputAt<R, P>, ClientError<ErrorAt<R, P>>> => {
  const result = decodeResult(router, path, encoded);
  const exit: Exit.Exit<unknown, unknown> = result.ok
    ? Exit.succeed(result.value)
    : Exit.fail(result.error);
  return exit as Exit.Exit<OutputAt<R, P>, ClientError<ErrorAt<R, P>>>;
};

/**
 * Awaits and decodes the result of a server action: resolves with the output (class instances)
 * or rejects with a `ClientError<E>` instance — like a client call. A rejected action call (the
 * server action request itself failed) rejects with `RpcTransportError`.
 *
 * ```ts
 * const post = await unwrapActionResult(appRouter, 'post.create', createPost({ title }));
 * ```
 */
export const unwrapActionResult = async <R extends Router.Any, const P extends ActionPath<R>>(
  router: R,
  path: P,
  encoded: EncodedExit | PromiseLike<EncodedExit>,
): Promise<OutputAt<R, P>> => {
  let value: EncodedExit;
  try {
    value = await encoded;
  } catch (cause) {
    throw new RpcTransportError({
      message: messageOf(cause, 'The server action request failed'),
      cause,
    });
  }
  const result = decodeResult(router, path, value);
  if (result.ok) return result.value as OutputAt<R, P>;
  throw result.error;
};

export { decodeResult as decodeActionResultInternal };
export type { ErrorAt, OutputAt };
