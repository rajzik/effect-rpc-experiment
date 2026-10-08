import type { Codecs, ProcedureDef, Router } from '@effect-trpc/core';
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

/** The procedure definition at a dot-joined path: `ProcedureAt<AppRouter, 'post.byId'>`. */
export type ProcedureAt<R extends Router.Any, P extends string> = DefAt<Router.Record<R>, P>;

type UnaryTag<X> =
  X extends Rpc.Rpc<infer Tag, infer _P, infer S, infer _E, infer _M, infer _Rq>
    ? S extends RpcSchema.Stream<infer _A, infer _SE>
      ? never
      : Tag
    : never;

/** The paths of a router's queries and mutations (subscriptions cannot be server actions). */
export type ActionPath<R extends Router.Any> = UnaryTag<Router.Rpcs<R>>;

/** The compiled rpc of the procedure at `P`. */
export type RpcAt<R extends Router.Any, P extends string> = Rpc.ExtractTag<Router.Rpcs<R>, P>;

/** The decoded input of the procedure at `P`. */
export type InputAt<R extends Router.Any, P extends string> = Codecs.PayloadType<RpcAt<R, P>>;

/** The decoded output of the procedure at `P`. */
export type OutputAt<R extends Router.Any, P extends string> = Codecs.ExitSuccessType<RpcAt<R, P>>;

/** The typed error of the procedure at `P` (including middleware errors). */
export type ErrorAt<R extends Router.Any, P extends string> = Codecs.ErrorType<RpcAt<R, P>>;

/** Call arguments: the input is optional when the procedure takes no input. */
export type InputArgs<Input> = undefined extends Input ? [input?: Input] : [input: Input];

export type { RecordOf };
