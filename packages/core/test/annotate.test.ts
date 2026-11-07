// `.annotate(key, value)`: tRPC's `.meta()`. Annotations reach the compiled rpc
// (`rpc.annotations`), where middleware reads them.
import { Context, Effect, Schema } from 'effect';
import type { RpcMiddleware } from 'effect/rpc';
import { describe, expect, it } from 'vite-plus/test';
import { Procedure, ProcedureKind, query, Router } from '../src/index.js';
import type { ProcedureDef } from '../src/index.js';
import { AuthMiddleware, LogMiddleware } from './fixtures.js';

const Roles = Context.Reference<ReadonlyArray<string>>('test/Roles', { defaultValue: () => [] });
const Audit = Context.Reference<boolean>('test/Audit', { defaultValue: () => false });

type AnyDef = ProcedureDef<
  ProcedureKind,
  Schema.Top,
  Schema.Top,
  Schema.Top,
  RpcMiddleware.AnyService
>;

const annotations = (def: AnyDef) => Router.getRpc(Router.make({ x: def }), 'x').annotations;

describe('annotate', () => {
  it('carries a definition annotation into the compiled rpc', () => {
    const def = query({ success: Schema.String }).annotate(Roles, ['admin']);
    expect(Context.get(annotations(def), Roles)).toEqual(['admin']);
    expect(Context.get(annotations(def), ProcedureKind)).toBe('query');
  });

  it('returns a new definition and leaves the original untouched', () => {
    const plain = query({ success: Schema.String });
    const annotated = plain.annotate(Roles, ['admin']);
    expect(annotated).not.toBe(plain);
    expect(Context.get(annotations(plain), Roles)).toEqual([]);
  });

  it('gives a Context.Reference default when the key is not set', () => {
    const def = query({ success: Schema.String }).annotate(Roles, ['admin']);
    expect(Context.get(annotations(def), Audit)).toBe(false);
  });

  it('replaces an earlier value of the same key', () => {
    const def = query({ success: Schema.String })
      .annotate(Roles, ['a'])
      .annotate(Audit, true)
      .annotate(Roles, ['b']);
    expect(Context.get(annotations(def), Roles)).toEqual(['b']);
    expect(Context.get(annotations(def), Audit)).toBe(true);
  });

  it('never changes the kind: ProcedureKind is applied after user annotations', () => {
    const def = query({ success: Schema.String }).annotate(ProcedureKind, 'mutation');
    expect(Context.get(annotations(def), ProcedureKind)).toBe('query');
    const built = Procedure.annotate(ProcedureKind, 'subscription').mutation(() => Effect.void);
    expect(Context.get(annotations(built), ProcedureKind)).toBe('mutation');
  });

  it('carries annotations of procedures in nested records', () => {
    const router = Router.make({
      a: { b: query({ success: Schema.String }).annotate(Roles, ['x']) },
    });
    expect(Context.get(Router.getRpc(router, 'a.b').annotations, Roles)).toEqual(['x']);
  });

  it('keeps annotations through definition and router middleware', () => {
    const def = query({ success: Schema.String })
      .annotate(Roles, ['admin'])
      .middleware(LogMiddleware);
    expect(Context.get(annotations(def), Roles)).toEqual(['admin']);
    const router = Router.make({ x: def }).middleware(AuthMiddleware);
    expect(Context.get(Router.getRpc(router, 'x').annotations, Roles)).toEqual(['admin']);
  });

  it('is a starting step of the builder', () => {
    const def = Procedure.annotate(Roles, ['admin']).query(() => Effect.void);
    expect(Context.get(annotations(def), Roles)).toEqual(['admin']);
    expect(Context.get(annotations(def), ProcedureKind)).toBe('query');
  });

  it('is a step of the builder after other steps, kept by the terminal', () => {
    const def = Procedure.output(Schema.String)
      .annotate(Roles, ['admin'])
      .query(() => Effect.succeed('ok'));
    expect(Context.get(annotations(def), Roles)).toEqual(['admin']);
  });

  it('keeps builder annotations through middleware before and after the terminal', () => {
    const def = Procedure.annotate(Roles, ['admin'])
      .middleware(LogMiddleware)
      .annotate(Audit, true)
      .mutation(() => Effect.void)
      .middleware(AuthMiddleware);
    expect(Context.get(annotations(def), Roles)).toEqual(['admin']);
    expect(Context.get(annotations(def), Audit)).toBe(true);
    expect(Context.get(annotations(def), ProcedureKind)).toBe('mutation');
  });

  it('keeps the handler when a builder procedure is annotated', () => {
    const def = Procedure.query(() => Effect.void).annotate(Roles, ['admin']);
    expect(Procedure.hasHandler(def)).toBe(true);
    expect(Context.get(annotations(def), Roles)).toEqual(['admin']);
  });

  it('keeps annotations through Router.withSchemas', () => {
    const router = Router.withSchemas(
      Router.make({
        x: Procedure.annotate(Roles, ['admin']).query(() => Effect.succeed('ok')),
      }),
      { x: { output: Schema.String } },
    );
    const rpc = Router.getRpc(router, 'x');
    expect(rpc.successSchema).toBe(Schema.String);
    expect(Context.get(rpc.annotations, Roles)).toEqual(['admin']);
  });
});
