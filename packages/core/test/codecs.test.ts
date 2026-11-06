import { Cause, Exit, Option, Schema } from 'effect';
import { describe, expect, it } from 'vite-plus/test';
import { Codecs, Router } from '../src/index.js';
import {
  appRouter,
  AuthMiddleware,
  Forbidden,
  getCause,
  getSuccess,
  Post,
  PostNotFound,
  samplePost,
  Unauthorized,
} from './fixtures.js';

const byIdRpc = Router.getRpc(appRouter, 'post.byId');
const onPostRpc = Router.getRpc(appRouter, 'post.onPost');

const viaJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('Codecs.exit', () => {
  it('round-trips a success with a Schema.Class through JSON', () => {
    const codec = Codecs.exit(byIdRpc);
    const json = viaJson(Schema.encodeSync(codec)(Exit.succeed(samplePost())));
    expect(json).toEqual({
      _tag: 'Success',
      value: { id: 1, title: 'Hello World', createdAt: '2026-01-02T03:04:05.000Z' },
    });
    const post = getSuccess(Schema.decodeUnknownSync(codec)(json));
    expect(post).toBeInstanceOf(Post);
    expect(post.describe()).toBe('#1 Hello World');
    expect(post.createdAt).toBeInstanceOf(Date);
  });

  it('round-trips a TaggedError failure to the same class', () => {
    const json = viaJson(Codecs.encodeExitSync(byIdRpc, Exit.fail(new PostNotFound({ id: 5 }))));
    const cause = getCause(Codecs.decodeExitSync(byIdRpc, json));
    const error = Option.getOrThrow(Cause.findErrorOption(cause));
    expect(error).toBeInstanceOf(PostNotFound);
    expect(error).toMatchObject({ _tag: 'PostNotFound', id: 5 });
  });

  it('round-trips a defect as Die', () => {
    const json = viaJson(Codecs.encodeExitSync(byIdRpc, Exit.die(new Error('kaput'))));
    const cause = getCause(Codecs.decodeExitSync(byIdRpc, json));
    expect(Cause.hasDies(cause)).toBe(true);
    const defect = Cause.squash(cause);
    expect(defect).toBeInstanceOf(Error);
    expect(defect).toMatchObject({ message: 'kaput' });
  });

  it('encodes a streaming exit with a void success', () => {
    expect(Codecs.encodeExitSync(onPostRpc, Exit.void)).toEqual({ _tag: 'Success', value: null });
    const failure = viaJson(
      Codecs.encodeExitSync(onPostRpc, Exit.fail(new Forbidden({ reason: 'no' }))),
    );
    expect(Cause.squash(getCause(Codecs.decodeExitSync(onPostRpc, failure)))).toBeInstanceOf(
      Forbidden,
    );
  });
});

describe('Codecs.success / payload / error', () => {
  it('success of a stream rpc is the element (chunk) codec', () => {
    const json = viaJson(Codecs.encodeSuccessSync(onPostRpc, samplePost()));
    expect(json).toEqual({ id: 1, title: 'Hello World', createdAt: '2026-01-02T03:04:05.000Z' });
    const post = Codecs.decodeSuccessSync(onPostRpc, json);
    expect(post).toBeInstanceOf(Post);
    expect(post.slug).toBe('hello-world');
  });

  it('success of a plain rpc round-trips class instances', () => {
    const decoded = Schema.decodeUnknownSync(Codecs.success(byIdRpc))(
      viaJson(Schema.encodeSync(Codecs.success(byIdRpc))(samplePost())),
    );
    expect(decoded).toBeInstanceOf(Post);
  });

  it('payload codec round-trips the input', () => {
    expect(
      Codecs.decodePayloadSync(byIdRpc, viaJson(Codecs.encodePayloadSync(byIdRpc, { id: 3 }))),
    ).toEqual({ id: 3 });
  });

  it('error codec covers rpc, stream and middleware errors', () => {
    const rpc = Router.getRpc(appRouter.middleware(AuthMiddleware), 'post.onPost');
    for (const error of [new Forbidden({ reason: 'x' }), new Unauthorized()]) {
      const decoded = Codecs.decodeErrorSync(rpc, viaJson(Codecs.encodeErrorSync(rpc, error)));
      expect(decoded).toBeInstanceOf(error.constructor);
    }
    expect(() => Codecs.decodeErrorSync(byIdRpc, { _tag: 'Unauthorized' })).toThrow(/PostNotFound/);
  });

  it('memoizes codecs per rpc', () => {
    expect(Codecs.exit(byIdRpc)).toBe(Codecs.exit(byIdRpc));
    expect(Codecs.success(byIdRpc)).toBe(Codecs.success(byIdRpc));
    expect(Codecs.payload(byIdRpc)).toBe(Codecs.payload(byIdRpc));
    expect(Codecs.error(byIdRpc)).toBe(Codecs.error(byIdRpc));
    expect(Codecs.exit(onPostRpc)).not.toBe(Codecs.exit(byIdRpc));
    const rebuilt = Router.make({ post: { byId: appRouter.record.post.byId } });
    expect(Codecs.exit(Router.getRpc(rebuilt, 'post.byId'))).not.toBe(Codecs.exit(byIdRpc));
  });
});
