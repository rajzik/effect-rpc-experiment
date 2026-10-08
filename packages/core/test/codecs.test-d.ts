import type { Exit, Schema } from 'effect';
import type { Rpc } from 'effect/rpc';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { Codecs, Router } from '../src/index.js';
import { appRouter, AuthMiddleware } from './fixtures.js';
import type { Forbidden, Post, PostNotFound, Unauthorized } from './fixtures.js';

type AppRpcs = Router.Rpcs<typeof appRouter>;
type ByIdRpc = Rpc.ExtractTag<AppRpcs, 'post.byId'>;
type OnPostRpc = Rpc.ExtractTag<AppRpcs, 'post.onPost'>;
declare const byIdRpc: ByIdRpc;
declare const onPostRpc: OnPostRpc;

describe('Codecs types', () => {
  it('exit codec decodes to the typed Exit and encodes to Json', () => {
    const codec = Codecs.exit(byIdRpc);
    expectTypeOf<(typeof codec)['Type']>().toEqualTypeOf<
      Exit.Exit<Post, PostNotFound | Forbidden>
    >();
    expectTypeOf<(typeof codec)['Encoded']>().toEqualTypeOf<Schema.Json>();
    expectTypeOf(Codecs.decodeExitSync(byIdRpc, null)).toEqualTypeOf<
      Exit.Exit<Post, PostNotFound | Forbidden>
    >();
  });

  it('stream rpcs: success is the element, exit success is void', () => {
    expectTypeOf<ReturnType<typeof Codecs.success<OnPostRpc>>['Type']>().toEqualTypeOf<Post>();
    expectTypeOf(Codecs.decodeSuccessSync(onPostRpc, null)).toEqualTypeOf<Post>();
    expectTypeOf(Codecs.decodeExitSync(onPostRpc, null)).toEqualTypeOf<
      Exit.Exit<void, Forbidden>
    >();
  });

  it('payload and error codecs are typed', () => {
    expectTypeOf(Codecs.decodePayloadSync(byIdRpc, null)).toEqualTypeOf<{ readonly id: number }>();
    expectTypeOf(Codecs.decodeErrorSync(byIdRpc, null)).toEqualTypeOf<PostNotFound | Forbidden>();
    // @ts-expect-error the payload must match the schema
    Codecs.encodePayloadSync(byIdRpc, { id: 'x' });
  });

  it('middleware errors are included', () => {
    const guarded = Router.getRpc(appRouter.middleware(AuthMiddleware), 'post.byId');
    expectTypeOf(Codecs.decodeErrorSync(guarded, null)).toEqualTypeOf<
      PostNotFound | Forbidden | Unauthorized
    >();
  });

  it('erased rpcs decode to unknown', () => {
    const info = appRouter.procedures.get('post.byId')!;
    expectTypeOf(Codecs.decodeSuccessSync(info.rpc, null)).toEqualTypeOf<unknown>();
  });
});
