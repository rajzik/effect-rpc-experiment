import { mutation, Router } from '@rpc-effect/core';
import { Handlers } from '@rpc-effect/server';
import { Effect, Schema } from 'effect';

/** A `Schema.Class` payload with a method: Next's Flight serializer cannot send its instances. */
export class NoteInput extends Schema.Class<NoteInput>('NoteInput')({
  title: Schema.String,
  at: Schema.Date,
}) {
  upper(): string {
    return `${this.title.toUpperCase()} @ ${this.at.toISOString()}`;
  }
}

export const noteRouter = Router.make({
  note: { create: mutation({ payload: NoteInput, success: Schema.String }) },
});

/** The handler calls the payload's method, so it only works on a decoded `NoteInput`. */
export const noteHandlers = Handlers.make(noteRouter, {
  note: { create: (input) => Effect.sync(() => input.upper()) },
});
