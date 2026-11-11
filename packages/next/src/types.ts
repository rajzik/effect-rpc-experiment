/**
 * Type-level helpers that look up a procedure of a router by its dot-joined path.
 *
 * Server actions are addressed by path strings (`actions('post.create')`,
 * `useServerAction(action, { path: 'post.create' })`), so `@rpc-effect/next` derives the input,
 * output and typed error of a path from the router's compiled `effect/rpc` rpcs. Use these types
 * to annotate the `'use server'` functions that wrap actions.
 *
 * @since 0.1.0
 */
import type { Codecs, ProcedureDef, Router } from '@rpc-effect/core';
import type { Schema } from 'effect';
import type { Rpc, RpcSchema } from 'effect/rpc';

type RecordOf<R> = R extends Router<infer Rec> ? Rec : R;

type DefAt<Rec, P extends string> = P extends `${infer Head}.${infer Tail}`
  ? Head extends keyof Rec
    ? DefAt<RecordOf<Rec[Head]>, Tail>
    : never
  : P extends keyof Rec
    ? Rec[P] extends ProcedureDef.Any
      ? Rec[P]
      : never
    : never;

/**
 * The procedure definition at a dot-joined path: `ProcedureAt<AppRouter, 'post.byId'>`.
 *
 * **Details**
 *
 * - Resolves to `never` when the path does not name a procedure (a namespace or a typo).
 *
 * @see {@link InputAt}
 * @category type-level
 * @since 0.1.0
 */
export type ProcedureAt<R extends Router.Any, P extends string> = DefAt<Router.Record<R>, P>;

type UnaryTag<X> =
  X extends Rpc.Rpc<infer Tag, infer _P, infer S, infer _E, infer _M, infer _Rq>
    ? S extends RpcSchema.Stream<infer _A, infer _SE>
      ? never
      : Tag
    : never;

/**
 * The paths of a router's queries and mutations: the paths a server action can call.
 *
 * **Details**
 *
 * - Subscriptions are excluded (they stream and cannot be server actions), so
 *   `createServerActionCaller(...)('ticks')` is a type error.
 *
 * @see {@link ServerActionCaller}
 * @category type-level
 * @since 0.1.0
 */
export type ActionPath<R extends Router.Any> = UnaryTag<Router.Rpcs<R>>;

/**
 * The compiled `effect/rpc` rpc of the procedure at path `P`.
 *
 * @category type-level
 * @since 0.1.0
 */
export type RpcAt<R extends Router.Any, P extends string> = Rpc.ExtractTag<Router.Rpcs<R>, P>;

/** The encoded side of a procedure's or rpc's payload schema. */
type PayloadEncoded<X> = X extends { readonly payloadSchema: infer S extends Schema.Top }
  ? S['Encoded']
  : never;

/**
 * The input of the procedure at path `P`: what a server action and its wrapper accept.
 *
 * **Details**
 *
 * - This is the payload schema's **encoded** side, what Next's Flight serializer can send
 *   (plain objects, `Date`s, ...): a `Schema.Class` payload is its plain fields object, which
 *   the server decodes back to the class. It is not the JSON form.
 *
 * @see {@link OutputAt}
 * @see {@link ErrorAt}
 * @category type-level
 * @since 0.1.0
 */
export type InputAt<R extends Router.Any, P extends string> = PayloadEncoded<RpcAt<R, P>>;

/**
 * The decoded output of the procedure at path `P` (class instances, `Date`s, ...).
 *
 * @see {@link InputAt}
 * @category type-level
 * @since 0.1.0
 */
export type OutputAt<R extends Router.Any, P extends string> = Codecs.ExitSuccessType<RpcAt<R, P>>;

/**
 * The typed error of the procedure at path `P`, including the errors of its middleware.
 *
 * **Details**
 *
 * - It does not include the infrastructure errors; a decoded action result fails with
 *   `ClientError<ErrorAt<R, P>>` (`E | RpcDefect | RpcTransportError | RpcInterrupted`).
 *
 * @see {@link InputAt}
 * @category type-level
 * @since 0.1.0
 */
export type ErrorAt<R extends Router.Any, P extends string> = Codecs.ErrorType<RpcAt<R, P>>;

/**
 * Call arguments of an action: the input is optional when the procedure accepts `undefined`.
 *
 * @category type-level
 * @since 0.1.0
 */
export type InputArgs<Input> = undefined extends Input ? [input?: Input] : [input: Input];

export type { PayloadEncoded, RecordOf };
