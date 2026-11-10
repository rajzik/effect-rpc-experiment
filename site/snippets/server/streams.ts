import { Context, Effect, Layer, PubSub, Schedule, Schema, Stream } from 'effect';
import { mutation, Router, subscription } from '@rpc-effect/core';
import { createCaller, Handlers } from '@rpc-effect/server';

// #region define
class Tick extends Schema.Class<Tick>('Tick')({ n: Schema.Finite, at: Schema.Date }) {}
class TooFast extends Schema.TaggedError<TooFast>()('TooFast', { every: Schema.Finite }) {}

const router = Router.make({
  ticks: subscription({ payload: { every: Schema.Finite }, success: Tick, error: TooFast }),
  chat: {
    send: mutation({ payload: { text: Schema.String } }),
    messages: subscription({ success: Schema.String }),
  },
});
// #endregion define

// #region handlers
// A shared PubSub: mutations publish, subscriptions read.
class ChatHub extends Context.Service<ChatHub, PubSub.PubSub<string>>()('ChatHub') {}
const ChatLive = Layer.effect(ChatHub)(PubSub.unbounded<string>());

const HandlersLive = Handlers.make(
  router,
  Effect.gen(function* () {
    const hub = yield* ChatHub;
    return Handlers.of(router, {
      // A subscription handler returns a Stream; its failures must be declared errors.
      ticks: ({ every }) =>
        every < 100
          ? Stream.fail(new TooFast({ every }))
          : Stream.fromSchedule(Schedule.spaced(`${every} millis`)).pipe(
              Stream.map((n) => new Tick({ n, at: new Date() })),
            ),
      chat: {
        send: ({ text }) => PubSub.publish(hub, text).pipe(Effect.asVoid),
        messages: () => Stream.fromPubSub(hub),
      },
    });
  }),
).pipe(Layer.provide(ChatLive));
// #endregion handlers

// #region consume
const caller = createCaller(router, { handlers: HandlersLive });

// Promise API: an AsyncIterable. Breaking out of the loop cancels the stream on the server.
for await (const tick of caller.$promise.ticks({ every: 250 })) {
  if (tick.n >= 3) break;
}

// Effect API: a Stream.
const firstThree = caller.ticks({ every: 250 }).pipe(Stream.take(3), Stream.runCollect);
await Effect.runPromise(firstThree);
await caller.dispose();
// #endregion consume
