/**
 * Server actions with typed errors: run a router's procedures as Next.js server actions and
 * decode their results on the client.
 *
 * An error thrown by a server action reaches the client as a plain `Error` (class, fields and,
 * in production, message lost). So {@link createServerActionCaller}'s actions never throw a
 * procedure error: they resolve with the procedure's `Exit` encoded by `Codecs.exit(rpc)` (plain
 * JSON). {@link decodeActionResult}, {@link unwrapActionResult} and `useServerAction` decode it
 * back to class instances and `ClientError<E>` (`E | RpcDefect | RpcTransportError |
 * RpcInterrupted`). `createServerActionCaller` is server-only; the decoders work anywhere.
 *
 * @since 0.1.0
 */
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
  Router,
} from '@rpc-effect/core';
import { createCaller, type Caller } from '@rpc-effect/server';
import { Cause, Effect, Exit, Schema } from 'effect';
import type { Layer } from 'effect';
import type { Headers } from 'effect/http';
import type { ActionPath, ErrorAt, InputArgs, InputAt, OutputAt, RecordOf } from './types.js';

/**
 * One reason of an encoded `Cause` (see `Codecs.exit`): a typed failure (`Fail`, encoded with
 * the procedure's error schema), a defect (`Die`, message only) or an interruption.
 *
 * @see {@link EncodedExit}
 * @category codecs
 * @since 0.1.0
 */
export type EncodedCauseReason =
  | { readonly _tag: 'Fail'; readonly error: Schema.Json }
  | { readonly _tag: 'Die'; readonly defect: Schema.Json }
  | { readonly _tag: 'Interrupt'; readonly fiberId: number | null };

/**
 * The JSON form of an `Exit` produced by `Codecs.exit(rpc)`: what a server action returns. It
 * is plain JSON, so React can send it from the server to the client unchanged.
 *
 * **Details**
 *
 * - Success: `{ _tag: 'Success', value }` with `value` encoded by the success schema (a `Date`
 *   becomes an ISO string).
 * - Failure: `{ _tag: 'Failure', cause: [...] }`, e.g.
 *   `[{ _tag: 'Fail', error: { _tag: 'PostNotFound', id: 404 } }]`.
 *
 * @see {@link decodeActionResult}
 * @category codecs
 * @since 0.1.0
 */
export type EncodedExit =
  | { readonly _tag: 'Success'; readonly value: Schema.Json }
  | { readonly _tag: 'Failure'; readonly cause: ReadonlyArray<EncodedCauseReason> };

/**
 * Type-level only: the decoded success / error types of an {@link EncodedActionResult}.
 *
 * @category type-level
 * @since 0.1.0
 */
export interface ActionResultTypes<A, E> {
  readonly success: A;
  readonly error: E;
}

/**
 * The result of a {@link ServerAction}: an {@link EncodedExit} that remembers (at the type level
 * only) the procedure's decoded output `A` and typed error `E`. Decode it with
 * `decodeActionResult` / `unwrapActionResult` / `useServerAction`.
 *
 * **Gotchas**
 *
 * - Its `value` / `error` fields are the **encoded** JSON (ISO strings, plain objects), never
 *   class instances; do not read them directly in client code.
 *
 * @see {@link unwrapActionResult}
 * @category models
 * @since 0.1.0
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
 *
 * @see {@link createServerActionCaller}
 * @category models
 * @since 0.1.0
 */
export type ServerAction<D extends ProcedureDef.Any> = (
  ...args: InputArgs<inferInput<D>>
) => Promise<EncodedActionResult<inferOutput<D>, inferError<D>>>;

/**
 * The decoded output type of a server action (or of its encoded result):
 * `inferActionOutput<typeof createPost>` is `Post`.
 *
 * @category type-level
 * @since 0.1.0
 */
export type inferActionOutput<T> = T extends (
  ...args: ReadonlyArray<never>
) => PromiseLike<EncodedActionResult<infer A, infer _E>>
  ? A
  : T extends EncodedActionResult<infer A, infer _E>
    ? A
    : never;

/**
 * The typed error of a server action (or of its encoded result), without the infrastructure
 * errors of `ClientError`.
 *
 * @see {@link inferActionClientError}
 * @category type-level
 * @since 0.1.0
 */
export type inferActionError<T> = T extends (
  ...args: ReadonlyArray<never>
) => PromiseLike<EncodedActionResult<infer _A, infer E>>
  ? E
  : T extends EncodedActionResult<infer _A, infer E>
    ? E
    : never;

/**
 * The error a decoded server action result fails with (what `unwrapActionResult` rejects with):
 * `ClientError<E>` — the procedure's typed errors or an infrastructure error
 * (`RpcDefect | RpcTransportError | RpcInterrupted`).
 *
 * @category type-level
 * @since 0.1.0
 */
export type inferActionClientError<T> = ClientError<inferActionError<T>>;

/**
 * The server actions of a router record, nested like the router (subscriptions map to `never`).
 *
 * @see {@link ServerActionCaller}
 * @category type-level
 * @since 0.1.0
 */
export type ServerActionRecord<Rec> = {
  readonly [K in keyof Rec]: Rec[K] extends ProcedureDef.Any
    ? Rec[K]['kind'] extends 'subscription'
      ? never
      : ServerAction<Rec[K]>
    : ServerActionRecord<RecordOf<Rec[K]>>;
};

/**
 * The server action of the procedure at path `P` (same shape as {@link ServerAction}).
 *
 * @category type-level
 * @since 0.1.0
 */
export type ServerActionAt<R extends Router.Any, P extends string> = (
  ...args: InputArgs<InputAt<R, P>>
) => Promise<EncodedActionResult<OutputAt<R, P>, ErrorAt<R, P>>>;

/**
 * Options of {@link createServerActionCaller}. `handlers` is required.
 *
 * @see {@link createServerActionCaller}
 * @category options
 * @since 0.1.0
 */
export interface ServerActionCallerOptions<R extends Router.Any, LE = never> {
  /**
   * Layer providing every handler of the router and the server implementation of every
   * middleware it uses. Built lazily on the first action call.
   */
  readonly handlers: Layer.Layer<Caller.Requirements<R>, LE>;
  /**
   * Headers for every action call, visible to middleware and handlers (`ctx.headers`). Evaluated
   * once per call — pass Next's `headers()` here: `headers: async () => await headers()`. If it
   * throws or rejects, the call resolves with a defect.
   */
  readonly headers?: (() => Headers.Input | PromiseLike<Headers.Input>) | undefined;
}

/**
 * What {@link createServerActionCaller} returns: a function from a path to its server action,
 * plus the nested form, the underlying caller and `dispose`.
 *
 * @see {@link createServerActionCaller}
 * @category models
 * @since 0.1.0
 */
export interface ServerActionCaller<R extends Router.Any> {
  /**
   * The server action of a query or mutation: `actions('post.byId')`. Memoized per path. Throws
   * synchronously for an unknown path or a subscription.
   */
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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the rpc's exit codec encodes to the `EncodedExit` shape; `Schema.Json` is its erased type
    return Codecs.encodeExitSync(info.rpc, safe) as EncodedExit;
  } catch {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- as above: the exit codec encodes to `EncodedExit`
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
  const asType = Schema.decodeUnknownExit(Schema.toType(schema))(input);
  if (Exit.isSuccess(asType)) return asType;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `Rpc.AnyWithProps` erases the payload schema to `Schema.Top`; procedure payload schemas are decoded without services everywhere (the rpc codecs in `@rpc-effect/core` assume the same)
  const asEncoded = Schema.decodeUnknownExit(schema as Schema.Codec<unknown>)(input);
  return Exit.isSuccess(asEncoded) ? asEncoded : asType;
};

type EffectFn = (
  input: unknown,
  options?: { readonly headers?: Headers.Input | undefined },
) => Effect.Effect<unknown, unknown>;

const procedureOf = (caller: unknown, path: ReadonlyArray<string>): EffectFn =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `path` comes from `router.procedures` and the caller implements every procedure path, so each node is a namespace and the leaf the procedure's effect function
  path.reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], caller) as EffectFn;

/** `createServerActionCaller` for a router. */
const createServerActionCallerFor = <R extends Router.Any, LE = never>(
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
            : yield* Effect.promise(async () => await options.headers?.());
        // oxlint-disable-next-line effecttsgo/any-unknown-in-error-context -- the router-generic dispatcher erases each procedure's typed errors; `encodeExit` encodes them with the procedure's own codec
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

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `Object.defineProperties` below completes the function with `nested`, `caller` and `dispose`
  const self = ((path: string) => actionAt(path)) as unknown as {
    -readonly [K in keyof ServerActionCaller<R>]: ServerActionCaller<R>[K];
  };
  Object.defineProperties(self, {
    nested: { value: nestedProxy([]), enumerable: true },
    caller: { value: caller, enumerable: true },
    dispose: { value: () => caller.dispose(), enumerable: true },
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `self` now has every member, and `actionAt` serves exactly the action paths `ServerActionCaller<R>` accepts
  return self as ServerActionCaller<R>;
};

/** `createServerActionCaller` for a router or a router service: normalises the input with `Router.from`. */
const createServerActionCallerFromInput = (
  input: Router.Input,
  options: ServerActionCallerOptions<Router.Any>,
): unknown => {
  const router: Router.Any = Router.from(input);
  return createServerActionCallerFor(router, options);
};

/**
 * Creates server actions for a router's queries and mutations (tRPC's
 * `experimental_createServerActionHandler`).
 *
 * **When to use**
 *
 * Use it in a `'use server'` module when client components should call procedures as Next.js
 * server actions (forms, progressive enhancement) and still get typed errors. Prefer
 * `createNextRpcClient` + `useRpc().x.mutationOptions()` for mutations that go through the route
 * handler and TanStack Query, and `createRscHelpers` for reads in server components.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 * - Each action runs the procedure in-process (through `createCaller`, so middleware runs) and
 *   resolves with the **encoded** `Exit`: success values, typed errors and defects all cross
 *   the server → client boundary as JSON.
 * - The client decodes it with `useServerAction`, `unwrapActionResult` or
 *   `decodeActionResult`, getting class instances and `ClientError<E>`.
 * - The input comes from the network, so it is validated with the procedure's payload schema
 *   (the decoded type or its encoded JSON form are accepted); invalid input resolves with a
 *   defect.
 * - Defects keep only their message (no stack, no `cause`). A result that cannot be encoded
 *   becomes a defect too.
 * - `actions(path)` and `actions.nested.a.b` return the same memoized function. The handler layer
 *   is built lazily on the first call; after `dispose()` calls resolve with an interrupted
 *   result (`RpcInterrupted` once decoded).
 *
 * **Gotchas**
 *
 * - A `'use server'` module may only export async functions: keep `actions` module-private and
 *   export one `async function` wrapper per action (this also names the action).
 * - Server-only: never import this module's handlers into client components; client components
 *   import only the exported action functions.
 * - Never `throw` the result or rethrow a procedure error from the action; it would arrive as a
 *   plain `Error`.
 * - `actions('a.subscription')` and unknown paths throw synchronously; subscriptions cannot be
 *   actions.
 *
 * **Example** (app/actions.ts, a `'use server'` module)
 *
 * ```ts
 * // app/actions.ts — server only
 * 'use server';
 * import { mutation, Router } from '@rpc-effect/core';
 * import { createServerActionCaller, type InputAt } from '@rpc-effect/next';
 * import { Handlers } from '@rpc-effect/server';
 * import { Effect, Schema } from 'effect';
 *
 * // In the app: `import { headers } from 'next/headers'`.
 * declare const headers: () => Promise<Headers>;
 *
 * // server/router.ts (shared) and server/handlers.ts (server only) in a real app
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
 *   reason: Schema.String,
 * }) {}
 * const appRouter = Router.make({
 *   post: {
 *     create: mutation({ payload: { title: Schema.String }, success: Post, error: Forbidden }),
 *   },
 * });
 * type AppRouter = typeof appRouter;
 * const HandlersLive = Handlers.make(appRouter, {
 *   post: {
 *     create: ({ title }, { headers }) =>
 *       headers['x-user'] === undefined
 *         ? Effect.fail(new Forbidden({ reason: 'sign in first' }))
 *         : Effect.succeed(new Post({ id: 2, title })),
 *   },
 * });
 *
 * // Module-private: a 'use server' file may only export async functions.
 * const actions = createServerActionCaller(appRouter, {
 *   handlers: HandlersLive,
 *   headers: async () => await headers(), // evaluated once per call
 * });
 *
 * export async function createPost(input: InputAt<AppRouter, 'post.create'>) {
 *   return actions('post.create')(input);
 * }
 * ```
 *
 * @see {@link useServerAction} to call the action from a client component
 * @see {@link unwrapActionResult}
 * @see {@link decodeActionResult}
 * @category constructors
 * @since 0.1.0
 */
export const createServerActionCaller: {
  <R extends Router.Any, LE = never>(
    router: R,
    options: ServerActionCallerOptions<R, LE>,
  ): ServerActionCaller<R>;
  <X extends Router.Input, LE = never>(
    router: X,
    options: ServerActionCallerOptions<Router.Of<X>, LE>,
  ): ServerActionCaller<Router.Of<X>>;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  createServerActionCallerFromInput as unknown as typeof createServerActionCaller;

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

/** `decodeActionResult` for a router. */
const decodeActionResultFor = <R extends Router.Any, const P extends ActionPath<R>>(
  router: R,
  path: P,
  encoded: EncodedExit,
): Exit.Exit<OutputAt<R, P>, ClientError<ErrorAt<R, P>>> => {
  const result = decodeResult(router, path, encoded);
  const exit: Exit.Exit<unknown, unknown> = result.ok
    ? Exit.succeed(result.value)
    : Exit.fail(result.error);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, effecttsgo/unsafe-effect-type-assertion -- decoded by the exit codec of the procedure at `path`, so the value and error have its types
  return exit as Exit.Exit<OutputAt<R, P>, ClientError<ErrorAt<R, P>>>;
};

/** `decodeActionResult` for a router or a router service: normalises the input with `Router.from`. */
const decodeActionResultFromInput = (
  input: Router.Input,
  path: ActionPath<Router.Any>,
  encoded: EncodedExit,
): unknown => {
  const router: Router.Any = Router.from(input);
  return decodeActionResultFor(router, path, encoded);
};

/**
 * Decodes the result of a server action back to an `Exit` of class instances:
 * `Exit<Post, ClientError<PostNotFound>>`.
 *
 * **When to use**
 *
 * Use it when you want to branch on success / failure without `try` / `catch` (e.g. in a form
 * `action` or an Effect program). Prefer `useServerAction` in components and
 * `unwrapActionResult` when a rejected promise is what you want.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 * - Typed errors are the procedure's `TaggedError` instances; defects become `RpcDefect`
 *   (message only), interruption `RpcInterrupted`.
 * - A malformed result (wrong shape for the procedure's schemas) becomes an `RpcDefect`.
 *
 * **Gotchas**
 *
 * - `path` must be the procedure the action called: the result is decoded with that
 *   procedure's schemas. An unknown or subscription path throws.
 * - It takes the awaited result; a rejected action call (network failure) is not handled here.
 *   Use `unwrapActionResult` / `useServerAction` to turn that into `RpcTransportError`.
 *
 * **Example** (Branching on the decoded Exit in a client component)
 *
 * ```ts
 * // app/new-post.tsx — client code ('use client')
 * import { mutation, Router } from '@rpc-effect/core';
 * import { decodeActionResult, type ServerActionAt } from '@rpc-effect/next';
 * import { Exit, Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
 *   reason: Schema.String,
 * }) {}
 * const appRouter = Router.make({
 *   post: {
 *     create: mutation({ payload: { title: Schema.String }, success: Post, error: Forbidden }),
 *   },
 * });
 * // `import { createPost } from './actions'` in the app ('use server').
 * declare const createPost: ServerActionAt<typeof appRouter, 'post.create'>;
 *
 * export async function submit(title: string): Promise<string> {
 *   const exit = decodeActionResult(appRouter, 'post.create', await createPost({ title }));
 *   if (Exit.isSuccess(exit)) return `Created ${exit.value.title}`;
 *   const error = exit.cause.reasons[0];
 *   return error !== undefined && error._tag === 'Fail' && error.error._tag === 'Forbidden'
 *     ? `Forbidden: ${error.error.reason}`
 *     : 'Something went wrong';
 * }
 * ```
 *
 * @see {@link unwrapActionResult}
 * @see {@link useServerAction}
 * @category codecs
 * @since 0.1.0
 */
export const decodeActionResult: {
  <R extends Router.Any, const P extends ActionPath<R>>(
    router: R,
    path: P,
    encoded: EncodedExit,
  ): Exit.Exit<OutputAt<R, P>, ClientError<ErrorAt<R, P>>>;
  <X extends Router.Input, const P extends ActionPath<Router.Of<X>>>(
    router: X,
    path: P,
    encoded: EncodedExit,
  ): Exit.Exit<OutputAt<Router.Of<X>, P>, ClientError<ErrorAt<Router.Of<X>, P>>>;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  decodeActionResultFromInput as unknown as typeof decodeActionResult;

/** `unwrapActionResult` for a router. */
const unwrapActionResultFor = async <R extends Router.Any, const P extends ActionPath<R>>(
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
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- decoded by the success codec of the procedure at `path`
  if (result.ok) return result.value as OutputAt<R, P>;
  throw result.error;
};

/** `unwrapActionResult` for a router or a router service: normalises the input with `Router.from`. */
const unwrapActionResultFromInput = (
  input: Router.Input,
  path: ActionPath<Router.Any>,
  encoded: EncodedExit | PromiseLike<EncodedExit>,
): unknown => {
  const router: Router.Any = Router.from(input);
  return unwrapActionResultFor(router, path, encoded);
};

/**
 * Awaits and decodes the result of a server action: resolves with the output (class instances)
 * or rejects with a `ClientError<E>` instance — like a client call.
 *
 * **When to use**
 *
 * Use it where a rejecting promise fits: as a TanStack `mutationFn`, in event handlers with
 * `try` / `catch`, or in tests. Prefer `useServerAction` for component state and
 * `decodeActionResult` to branch without exceptions.
 *
 * **Details**
 *
 * - `router` is a `Router.make` router or a router service class (`Router.Input`); a service is
 *   normalised with `Router.from` (its `make` runs once per process) and typed as `Router.Of<X>`.
 * - Accepts the result or the action's promise.
 * - A rejected action call (the server action request itself failed) rejects with
 *   `RpcTransportError`; a typed error rejects with the procedure's `TaggedError` instance;
 *   defects with `RpcDefect` (also for malformed results); interruption with `RpcInterrupted`.
 *
 * **Gotchas**
 *
 * - `path` must be the procedure the action called: its schemas decode the result.
 * - The rejection type is not tracked by `Promise`; narrow with `instanceof` or annotate the
 *   catch variable as `inferActionClientError<typeof action>`.
 *
 * **Example** (A TanStack mutation backed by a server action, client code)
 *
 * ```ts
 * // app/new-post.tsx — client code ('use client')
 * import { mutation, Router } from '@rpc-effect/core';
 * import {
 *   unwrapActionResult,
 *   type inferActionClientError,
 *   type ServerActionAt,
 * } from '@rpc-effect/next';
 * import { useMutation } from '@tanstack/react-query';
 * import { Schema } from 'effect';
 *
 * class Post extends Schema.Class<Post>('Post')({ id: Schema.Number, title: Schema.String }) {}
 * class Forbidden extends Schema.TaggedError<Forbidden>()('Forbidden', {
 *   reason: Schema.String,
 * }) {}
 * const appRouter = Router.make({
 *   post: {
 *     create: mutation({ payload: { title: Schema.String }, success: Post, error: Forbidden }),
 *   },
 * });
 * declare const createPost: ServerActionAt<typeof appRouter, 'post.create'>;
 *
 * export function useCreatePost() {
 *   return useMutation({
 *     // Resolves with a Post instance or rejects with Forbidden | RpcDefect | ...
 *     mutationFn: (title: string) =>
 *       unwrapActionResult(appRouter, 'post.create', createPost({ title })),
 *     onError: (error) => {
 *       const typed = error as inferActionClientError<typeof createPost>;
 *       if (typed._tag === 'Forbidden') console.warn(typed.reason);
 *     },
 *   });
 * }
 * ```
 *
 * @see {@link decodeActionResult}
 * @see {@link useServerAction}
 * @category codecs
 * @since 0.1.0
 */
export const unwrapActionResult: {
  <R extends Router.Any, const P extends ActionPath<R>>(
    router: R,
    path: P,
    encoded: EncodedExit | PromiseLike<EncodedExit>,
  ): Promise<OutputAt<R, P>>;
  <X extends Router.Input, const P extends ActionPath<Router.Of<X>>>(
    router: X,
    path: P,
    encoded: EncodedExit | PromiseLike<EncodedExit>,
  ): Promise<OutputAt<Router.Of<X>, P>>;
} =
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both overloads normalise the input with `Router.from` and continue with that router, which is what the implementation does; checking the overloads against it structurally instantiates `Router.Of<Router.Input>`, which is too deep
  unwrapActionResultFromInput as unknown as typeof unwrapActionResult;

export { decodeResult as decodeActionResultInternal };
export type { ErrorAt, OutputAt };
