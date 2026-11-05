import { Exit, Schema } from 'effect';
import { Codecs, query, Router } from '@effect-trpc/core';
import { createClient, localLink } from '@effect-trpc/client';

import { appRouter, Post, PostNotFound } from '@/router';
import { ServerLive } from '@/server';

// #region payloads
class Overloaded extends Schema.TaggedError<Overloaded>()('Overloaded', {}) {}

// `payload` takes struct fields or any schema; `success` and `error` take any schema.
export const examples = Router.make({
  fields: query({ payload: { id: Schema.Number, tags: Schema.Array(Schema.String) } }),
  schema: query({ payload: Schema.Struct({ q: Schema.String }), success: Schema.String }),
  union: query({
    payload: { id: Schema.Number },
    success: Schema.Union([Schema.String, Schema.Number]),
    error: Schema.Union([PostNotFound, Overloaded]),
  }),
});
// #endregion payloads

// #region roundtrip
const client = createClient(appRouter, { link: localLink({ handlers: ServerLive }) });
const post = await client.post.byId({ id: 1 });

post instanceof Post; // true, over every link (HTTP, WebSocket, in-process)
post.createdAt instanceof Date; // true: Schema.Date travels as an ISO string, decodes to a Date
post.slug; // class getters and methods work
// #endregion roundtrip

// #region codecs
const rpc = Router.getRpc(appRouter, 'post.byId');

// Success values: the JSON a server sends, and back to a class instance.
const json = JSON.stringify(Codecs.encodeSuccessSync(rpc, post));
// {"id":1,"title":"Hello Effect","createdAt":"2026-01-01T00:00:00.000Z"}
Codecs.decodeSuccessSync(rpc, JSON.parse(json)) instanceof Post; // true

// Whole exits, for a JSON boundary you own (a cache, a queue, a server action).
const encodedExit = Codecs.encodeExitSync(rpc, Exit.fail(new PostNotFound({ id: 7 })));
const exit = Codecs.decodeExitSync(rpc, encodedExit);
// Exit<Post, PostNotFound>: the failure is a PostNotFound instance again
// #endregion codecs

void exit;
await client.dispose();
