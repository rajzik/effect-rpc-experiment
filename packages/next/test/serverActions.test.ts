// Server actions (tRPC `next/src/app-dir/{client,procedureErrors}.test.tsx`): the action resolves
// with an encoded Exit; the client decodes it to class instances with typed errors.
import { RpcDefect, RpcInterrupted, RpcTransportError } from '@effect-trpc/core';
import { Exit } from 'effect';
import { describe, expect, test } from 'vite-plus/test';
import {
  createServerActionCaller,
  decodeActionResult,
  unwrapActionResult,
  type EncodedExit,
} from '../src/index.js';
import { appRouter, Forbidden, makeFixture, Post, PostNotFound } from './fixtures.js';

/** What crosses the server → client boundary: plain JSON (React serializes it). */
const overTheWire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const setup = () => {
  const fixture = makeFixture();
  const actions = createServerActionCaller(appRouter, { handlers: fixture.handlers });
  return { ...fixture, actions };
};

describe('createServerActionCaller', () => {
  test('success: encoded Exit decodes to a Post instance', async () => {
    const { actions } = setup();
    const encoded = await actions('post.byId')({ id: 1 });
    expect(encoded).toEqual({
      _tag: 'Success',
      value: { id: 1, title: 'Hello world', createdAt: '2026-01-02T03:04:05.000Z' },
    });
    const exit = decodeActionResult(appRouter, 'post.byId', overTheWire(encoded));
    const post = Exit.isSuccess(exit) ? exit.value : undefined;
    expect(post).toBeInstanceOf(Post);
    expect(post?.shout()).toBe('HELLO WORLD!');
    await actions.dispose();
  });

  test('a Date in the input passes through (Schema codecs instead of a transformer)', async () => {
    const { actions } = setup();
    const at = new Date('2030-05-06T07:08:09.000Z');
    const post = await unwrapActionResult(
      appRouter,
      'post.create',
      actions('post.create')({ title: 'dated', at }),
    );
    expect(post).toBeInstanceOf(Post);
    expect(post.createdAt).toBeInstanceOf(Date);
    expect(post.createdAt.toISOString()).toBe(at.toISOString());
    await actions.dispose();
  });

  test('typed error: decodes to the TaggedError instance, unwrap rejects with it', async () => {
    const { actions } = setup();
    const encoded = overTheWire(await actions('post.byId')({ id: 404 }));
    expect(encoded).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Fail', error: { _tag: 'PostNotFound', id: 404 } }],
    });
    const exit = decodeActionResult(appRouter, 'post.byId', encoded);
    expect(Exit.isFailure(exit)).toBe(true);
    const error = await unwrapActionResult(appRouter, 'post.byId', encoded).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PostNotFound);
    expect(error).toMatchObject({ _tag: 'PostNotFound', id: 404 });

    const forbidden = await unwrapActionResult(
      appRouter,
      'post.create',
      actions('post.create')({ title: 'forbidden' }),
    ).catch((e: unknown) => e);
    expect(forbidden).toBeInstanceOf(Forbidden);
    await actions.dispose();
  });

  test('defect: becomes an RpcDefect that keeps only the message', async () => {
    const { actions } = setup();
    const encoded = overTheWire(await actions('boom')());
    expect(encoded).toEqual({
      _tag: 'Failure',
      cause: [{ _tag: 'Die', defect: { name: 'Error', message: 'kaboom' } }],
    });
    expect(JSON.stringify(encoded)).not.toContain('stack');
    const error = await unwrapActionResult(appRouter, 'boom', encoded).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcDefect);
    expect((error as RpcDefect).message).toBe('kaboom');
    await actions.dispose();
  });

  test('invalid input (from the network) is rejected by the payload schema', async () => {
    const { actions, state } = setup();
    const action = actions('post.byId') as (input: unknown) => Promise<EncodedExit>;
    const error = await unwrapActionResult(appRouter, 'post.byId', action({ id: 'one' })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcDefect);
    expect((error as RpcDefect).message).toContain('Invalid input for "post.byId"');
    expect(state.calls).toEqual([]);
    await actions.dispose();
  });

  test('headers() are forwarded to the procedure on every call', async () => {
    const fixture = makeFixture();
    let user = 'ada';
    const actions = createServerActionCaller(appRouter, {
      handlers: fixture.handlers,
      headers: async () => new Headers({ 'x-user': user }),
    });
    expect(await unwrapActionResult(appRouter, 'post.whoami', actions('post.whoami')())).toBe(
      'ada',
    );
    user = 'grace';
    expect(await unwrapActionResult(appRouter, 'post.whoami', actions('post.whoami')())).toBe(
      'grace',
    );
    await actions.dispose();
  });

  test('nested proxy form and memoized actions', async () => {
    const { actions } = setup();
    expect(actions.nested.post.byId).toBe(actions('post.byId'));
    expect(typeof actions.nested.post.count).toBe('function');
    const count = await unwrapActionResult(appRouter, 'post.count', actions.nested.post.count());
    expect(count).toBe(3);
    await actions.dispose();
  });

  test('subscriptions and unknown paths are programming errors', () => {
    const { actions } = setup();
    expect(() => (actions as (path: string) => unknown)('ticks')).toThrow(/subscription/);
    expect(() => (actions as (path: string) => unknown)('nope')).toThrow(/no procedure/);
  });

  test('a rejected action call becomes RpcTransportError; malformed results RpcDefect', async () => {
    const network = await unwrapActionResult(
      appRouter,
      'post.byId',
      Promise.reject(new TypeError('Failed to fetch')),
    ).catch((e: unknown) => e);
    expect(network).toBeInstanceOf(RpcTransportError);
    const malformed = decodeActionResult(appRouter, 'post.byId', {
      _tag: 'Success',
      value: { id: 'nope' },
    });
    expect(Exit.isFailure(malformed)).toBe(true);
    const error = await unwrapActionResult(appRouter, 'post.byId', {
      _tag: 'Success',
      value: { nope: true },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcDefect);
  });

  test('after dispose() calls resolve with an interrupted result', async () => {
    const { actions } = setup();
    await actions('post.count')();
    await actions.dispose();
    const error = await unwrapActionResult(appRouter, 'post.count', actions('post.count')()).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RpcInterrupted);
  });
});
