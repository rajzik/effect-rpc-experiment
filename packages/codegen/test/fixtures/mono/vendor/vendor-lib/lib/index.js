import { Effect, Schema } from 'effect';

export class Money extends Schema.Class('Money')({
  cents: Schema.Finite,
  currency: Schema.String,
}) {}

export const price = (cents) => Effect.succeed(new Money({ cents, currency: 'EUR' }));
