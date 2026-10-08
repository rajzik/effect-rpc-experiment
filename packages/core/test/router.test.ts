import { Context, Option, Schema } from 'effect';
import { RpcSchema } from 'effect/rpc';
import { describe, expect, it } from 'vite-plus/test';
import { isProcedureDef, ProcedureKind, query, Router, subscription } from '../src/index.js';
import {
  adminRouter,
  appRouter,
  AuthMiddleware,
  byId,
  health,
  LogMiddleware,
  Post,
  PostNotFound,
} from './fixtures.js';

describe('Router.make', () => {
  it('assigns dot-joined path tags, including 3-level nesting and nested routers', () => {
    expect([...appRouter.group.requests.keys()]).toEqual([
      'health',
      'post.byId',
      'post.create',
      'post.onPost',
      'admin.stats.count',
      'deep.a.b',
    ]);
    for (const [tag, rpc] of appRouter.group.requests) {
      expect(rpc._tag).toBe(tag);
    }
  });

  it('exposes procedure metadata (path, tag, kind, rpc)', () => {
    const info = appRouter.procedures.get('post.byId');
    expect(info?.path).toEqual(['post', 'byId']);
    expect(info?.tag).toBe('post.byId');
    expect(info?.kind).toBe('query');
    expect(info?.rpc).toBe(appRouter.group.requests.get('post.byId'));
    expect(appRouter.procedures.get('post.create')?.kind).toBe('mutation');
    expect(appRouter.procedures.get('post.onPost')?.kind).toBe('subscription');
    expect(appRouter.procedures.get('admin.stats.count')?.path).toEqual([
      'admin',
      'stats',
      'count',
    ]);
    expect([...appRouter.procedures.keys()]).toEqual([...appRouter.group.requests.keys()]);
  });

  it('annotates every compiled rpc with its ProcedureKind', () => {
    const kinds = Object.fromEntries(
      [...appRouter.group.requests].map(([tag, rpc]) => [
        tag,
        Context.get(rpc.annotations, ProcedureKind),
      ]),
    );
    expect(kinds).toEqual({
      health: 'query',
      'post.byId': 'query',
      'post.create': 'mutation',
      'post.onPost': 'subscription',
      'admin.stats.count': 'query',
      'deep.a.b': 'query',
    });
  });

  it('compiles schemas onto the rpc, subscriptions as stream rpcs', () => {
    const rpc = appRouter.procedures.get('post.byId')!.rpc;
    expect(rpc.successSchema).toBe(Post);
    expect(Schema.is(rpc.payloadSchema)({ id: 1 })).toBe(true);
    expect(Schema.is(rpc.errorSchema)(new PostNotFound({ id: 1 }))).toBe(true);
    const sub = appRouter.procedures.get('post.onPost')!.rpc;
    expect(RpcSchema.isStreamSchema(sub.successSchema)).toBe(true);
    expect(RpcSchema.isStreamSchema(rpc.successSchema)).toBe(false);
  });

  it('keeps the original record and does not mutate nested routers', () => {
    expect(appRouter.record.post.byId).toBe(byId);
    expect(appRouter.record.admin).toBe(adminRouter);
    expect([...adminRouter.group.requests.keys()]).toEqual(['stats.count']);
  });

  it('throws on keys containing "."', () => {
    expect(() => Router.make({ 'post.byId': health })).toThrow(/must not contain "\."/);
    expect(() => Router.make({ post: { 'a.b': health } })).toThrow(/at "post"/);
  });

  it('throws on empty or reserved keys and on invalid values', () => {
    expect(() => Router.make({ '': health })).toThrow(/non-empty/);
    for (const reserved of ['then', 'call', 'apply']) {
      expect(() => Router.make({ [reserved]: health })).toThrow(/reserved/);
    }
    expect(() => Router.make({ post: { bad: 42 } } as unknown as Router.Shape)).toThrow(
      /Invalid router entry at "post\.bad"/,
    );
  });

  it('allows the same definition under several paths', () => {
    const router = Router.make({ a: health, b: { c: health } });
    expect([...router.group.requests.keys()]).toEqual(['a', 'b.c']);
  });
});

describe('Router.merge', () => {
  it('merges routers with disjoint keys', () => {
    const merged = Router.merge(Router.make({ health }), Router.make({ post: { byId } }));
    expect([...merged.group.requests.keys()]).toEqual(['health', 'post.byId']);
    expect(merged.record.post.byId).toBe(byId);
  });

  it('throws when top-level keys collide', () => {
    expect(() =>
      Router.merge(Router.make({ post: { byId } }), Router.make({ post: { health } })),
    ).toThrow(/duplicate key "post"/);
  });
});

describe('middleware', () => {
  it('router.middleware applies to every rpc, including nested routers', () => {
    const protectedRouter = appRouter.middleware(AuthMiddleware);
    expect(protectedRouter.procedures.size).toBe(appRouter.procedures.size);
    for (const rpc of protectedRouter.group.requests.values()) {
      expect([...rpc.middlewares]).toEqual([AuthMiddleware]);
    }
    for (const rpc of appRouter.group.requests.values()) {
      expect(rpc.middlewares.size).toBe(0);
    }
    expect(
      Context.get(protectedRouter.procedures.get('post.create')!.rpc.annotations, ProcedureKind),
    ).toBe('mutation');
  });

  it('def.middleware applies to one procedure, before router middleware', () => {
    const router = Router.make({ a: health.middleware(LogMiddleware), b: health }).middleware(
      AuthMiddleware,
    );
    expect([...router.procedures.get('a')!.rpc.middlewares]).toEqual([
      LogMiddleware,
      AuthMiddleware,
    ]);
    expect([...router.procedures.get('b')!.rpc.middlewares]).toEqual([AuthMiddleware]);
  });

  it('definitions are immutable: middleware returns a new definition', () => {
    const withLog = health.middleware(LogMiddleware);
    expect(withLog).not.toBe(health);
    expect(health.middlewares).toEqual([]);
    expect(withLog.middlewares).toEqual([LogMiddleware]);
    expect(Object.isFrozen(health)).toBe(true);
    expect(withLog.kind).toBe('query');
  });
});

describe('Router.getByPath / isRouter / definitions', () => {
  it('finds procedures by path segments', () => {
    const found = Router.getByPath(appRouter, ['admin', 'stats', 'count']);
    expect(Option.isSome(found) && found.value.tag).toBe('admin.stats.count');
    expect(Option.isNone(Router.getByPath(appRouter, ['post']))).toBe(true);
    expect(Option.isNone(Router.getByPath(appRouter, ['post', 'missing']))).toBe(true);
    expect(Option.isNone(Router.getByPath(appRouter, ['post.byId']))).toBe(true);
    expect(Option.isNone(Router.getByPath(appRouter, []))).toBe(true);
  });

  it('getRpc returns the compiled rpc for a tag and throws for unknown tags', () => {
    const rpc = Router.getRpc(appRouter, 'post.byId');
    expect(rpc._tag).toBe('post.byId');
    expect(rpc).toBe(appRouter.procedures.get('post.byId')?.rpc);
    const getRpcUntyped: (router: Router.Any, tag: string) => unknown = Router.getRpc as never;
    expect(() => getRpcUntyped(appRouter, 'nope')).toThrow(/Unknown procedure "nope"/);
  });

  it('recognizes routers and definitions', () => {
    expect(Router.isRouter(appRouter)).toBe(true);
    expect(Router.isRouter(appRouter.record)).toBe(false);
    expect(Router.isRouter(null)).toBe(false);
    expect(isProcedureDef(byId)).toBe(true);
    expect(isProcedureDef(appRouter)).toBe(false);
  });

  it('builders default to void payload / void success / never error', () => {
    const def = query();
    expect(def.kind).toBe('query');
    expect(def.payloadSchema).toBe(Schema.Void);
    expect(def.successSchema).toBe(Schema.Void);
    expect(def.errorSchema).toBe(Schema.Never);
    const sub = subscription({ success: Schema.Number });
    expect(sub.kind).toBe('subscription');
    expect(sub.payloadSchema).toBe(Schema.Void);
  });

  it('accepts a payload schema as well as struct fields', () => {
    const def = query({ payload: Schema.Struct({ id: Schema.Number }) });
    const router = Router.make({ def });
    expect(Schema.is(router.procedures.get('def')!.rpc.payloadSchema)({ id: 1 })).toBe(true);
  });
});
