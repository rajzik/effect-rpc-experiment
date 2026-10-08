// Port of trpc/packages/tanstack-react-query/test/utils.test.ts
import { skipToken } from '@tanstack/react-query';
import { describe, expect, it } from 'vite-plus/test';
import { getMutationKey, getQueryKey, QueryKeys, readQueryKey } from '../src/index.js';

describe('getQueryKey', () => {
  it('creates a query key', () => {
    expect(
      getQueryKey({ prefix: undefined, path: ['a', 'b'], input: 'input value', type: 'query' }),
    ).toEqual([['a', 'b'], { input: 'input value', type: 'query' }]);
  });

  it('creates a query key with prefix', () => {
    expect(
      getQueryKey({ path: ['a', 'b'], input: 'input value', type: 'query', prefix: 'prefix' }),
    ).toEqual([['prefix'], ['a', 'b'], { input: 'input value', type: 'query' }]);
  });

  it('creates a router key', () => {
    expect(getQueryKey({ prefix: undefined, path: ['a', 'b'], type: 'any' })).toEqual([['a', 'b']]);
    expect(getQueryKey({ prefix: undefined, path: [], type: 'any' })).toEqual([]);
  });

  it('creates a router key with prefix', () => {
    expect(getQueryKey({ path: ['a', 'b'], type: 'any', prefix: 'prefix' })).toEqual([
      ['prefix'],
      ['a', 'b'],
    ]);
  });

  it('creates an infinite query key', () => {
    expect(
      getQueryKey({ prefix: undefined, path: ['a', 'b'], input: 1, type: 'infinite' }),
    ).toEqual([['a', 'b'], { input: 1, type: 'infinite' }]);
    expect(
      getQueryKey({
        prefix: undefined,
        path: ['a', 'b'],
        input: { cursor: 1, direction: 'forward', q: 'x' },
        type: 'infinite',
      }),
    ).toEqual([['a', 'b'], { input: { q: 'x' }, type: 'infinite' }]);
  });

  it('creates an infinite query key with prefix', () => {
    expect(getQueryKey({ path: ['a', 'b'], input: 1, type: 'infinite', prefix: 'prefix' })).toEqual(
      [['prefix'], ['a', 'b'], { input: 1, type: 'infinite' }],
    );
  });

  it('omits skipToken and undefined inputs and splits dotted paths', () => {
    expect(
      getQueryKey({ prefix: undefined, path: ['a.b'], input: skipToken, type: 'query' }),
    ).toEqual([['a', 'b'], { type: 'query' }]);
    expect(
      getQueryKey({ prefix: undefined, path: ['a'], input: undefined, type: 'query' }),
    ).toEqual([['a'], { type: 'query' }]);
  });

  it('creates mutation keys', () => {
    expect(getMutationKey({ prefix: undefined, path: ['a', 'b'] })).toEqual([['a', 'b']]);
    expect(getMutationKey({ prefix: 'prefix', path: ['a', 'b'] })).toEqual([
      ['prefix'],
      ['a', 'b'],
    ]);
  });
});

describe('readQueryKey', () => {
  it('reads a simple query key', () => {
    expect(readQueryKey([['a', 'b'], { input: 'input value', type: 'query' }])).toEqual({
      type: 'unprefixed',
      prefix: undefined,
      path: ['a', 'b'],
      args: { input: 'input value', type: 'query' },
    });
  });

  it('reads a simple prefixed query key', () => {
    expect(readQueryKey([['prefix'], ['a', 'b'], { input: 'input value', type: 'query' }])).toEqual(
      {
        type: 'prefixed',
        prefix: ['prefix'],
        path: ['a', 'b'],
        args: { input: 'input value', type: 'query' },
      },
    );
  });

  it('parses arbitrary keys, rejecting foreign ones', () => {
    expect(QueryKeys.parseQueryKey([['a', 'b'], { input: 1, type: 'query' }])).toEqual({
      prefix: undefined,
      path: ['a', 'b'],
      input: 1,
      type: 'query',
    });
    expect(QueryKeys.parseQueryKey([['p'], ['a'], { type: 'infinite' }])).toEqual({
      prefix: 'p',
      path: ['a'],
      input: undefined,
      type: 'infinite',
    });
    expect(QueryKeys.parseQueryKey(['todos', { type: 'query' }])).toBeUndefined();
    expect(QueryKeys.parseQueryKey([['a']])).toBeUndefined();
    expect(QueryKeys.parseQueryKey([['a'], { input: 1 }])).toBeUndefined();
  });
});
