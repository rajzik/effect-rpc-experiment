import { Effect, Schema } from 'effect';

declare const Money_base: Schema.Class<
  Money,
  Schema.Struct<{ readonly cents: Schema.Finite; readonly currency: Schema.String }>,
  {}
>;
export declare class Money extends Money_base {}

export declare const price: (cents: number) => Effect.Effect<Money>;
