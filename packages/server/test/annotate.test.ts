// tRPC `.meta()` parity: middleware reads a procedure's annotations from `rpc.annotations`.
import { Context, Effect, Layer, Schema } from 'effect';
import { Procedure, Router } from '@effect-trpc/core';
import { describe, expect, it } from 'vite-plus/test';
import { createCaller, Handlers, Middleware } from '../src/index.js';
import { Forbidden, rejection } from './fixtures.js';

const Roles = Context.Reference<ReadonlyArray<string>>('test/Roles', { defaultValue: () => [] });

class RequireRoles extends Middleware.make<RequireRoles>()('RequireRoles', { error: Forbidden }) {}

// The caller's roles come from the `x-roles` header; the required ones from the procedure.
const RequireRolesLive = Layer.succeed(RequireRoles)(
  RequireRoles.of((effect, { rpc, headers }) => {
    const granted = (headers['x-roles'] ?? '').split(',');
    const missing = Context.get(rpc.annotations, Roles).filter((role) => !granted.includes(role));
    return missing.length === 0
      ? effect
      : Effect.fail(new Forbidden({ reason: `missing ${missing.join(',')}` }));
  }),
);

const router = Router.make({
  open: Procedure.output(Schema.String).query(() => Effect.succeed('open')),
  admin: Procedure.annotate(Roles, ['admin'])
    .output(Schema.String)
    .query(() => Effect.succeed('admin')),
  late: Procedure.output(Schema.String)
    .query(() => Effect.succeed('late'))
    .annotate(Roles, ['admin']),
}).middleware(RequireRoles);

const setup = () =>
  createCaller(router, {
    handlers: Layer.mergeAll(Handlers.fromProcedures(router), RequireRolesLive),
  });

describe('annotate (meta) in middleware', () => {
  it('an unannotated procedure passes', async () => {
    const caller = setup();
    try {
      expect(await caller.$promise.open()).toBe('open');
    } finally {
      await caller.dispose();
    }
  });

  it('an annotated procedure fails with the middleware error without the role', async () => {
    const caller = setup();
    try {
      const builder = await rejection(caller.$promise.admin());
      expect(builder).toBeInstanceOf(Forbidden);
      expect(builder).toMatchObject({ reason: 'missing admin' });
      expect(await rejection(caller.$promise.late())).toBeInstanceOf(Forbidden);
    } finally {
      await caller.dispose();
    }
  });

  it('an annotated procedure passes when the role is granted', async () => {
    const caller = setup();
    try {
      const headers = { 'x-roles': 'admin' };
      expect(await caller.$promise.admin(undefined, { headers })).toBe('admin');
      expect(await caller.$promise.late(undefined, { headers })).toBe('late');
    } finally {
      await caller.dispose();
    }
  });
});
