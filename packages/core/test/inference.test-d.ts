import { Schema } from 'effect';
import type { Stream } from 'effect';
import type { Rpc, RpcGroup } from 'effect/rpc';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { query, Router } from '../src/index.js';
import type {
  inferError,
  inferInput,
  inferKind,
  inferOutput,
  inferRouterErrors,
  inferRouterInputs,
  inferRouterOutputs,
  ProcedureInfo,
  ProcedureKind,
} from '../src/index.js';
import { appRouter, AuthMiddleware, byId } from './fixtures.js';
import type {
  create,
  Forbidden,
  health,
  onPost,
  Post,
  PostNotFound,
  Unauthorized,
} from './fixtures.js';

type AppRpcs = Router.Rpcs<typeof appRouter>;
type ByIdRpc = Rpc.ExtractTag<AppRpcs, 'post.byId'>;

describe('procedure inference', () => {
  it('query: input, output, error and kind are exact', () => {
    expectTypeOf<inferInput<typeof byId>>().toEqualTypeOf<{ readonly id: number }>();
    expectTypeOf<inferOutput<typeof byId>>().toEqualTypeOf<Post>();
    expectTypeOf<inferError<typeof byId>>().toEqualTypeOf<PostNotFound | Forbidden>();
    expectTypeOf<inferKind<typeof byId>>().toEqualTypeOf<'query'>();
  });

  it('mutation: input, output, error and kind are exact', () => {
    expectTypeOf<inferInput<typeof create>>().toEqualTypeOf<{ readonly title: string }>();
    expectTypeOf<inferOutput<typeof create>>().toEqualTypeOf<Post>();
    expectTypeOf<inferError<typeof create>>().toEqualTypeOf<Forbidden>();
    expectTypeOf<inferKind<typeof create>>().toEqualTypeOf<'mutation'>();
  });

  it('subscription: output is the element (chunk) type', () => {
    expectTypeOf<inferInput<typeof onPost>>().toEqualTypeOf<{ readonly since: number }>();
    expectTypeOf<inferOutput<typeof onPost>>().toEqualTypeOf<Post>();
    expectTypeOf<inferError<typeof onPost>>().toEqualTypeOf<Forbidden>();
    expectTypeOf<inferKind<typeof onPost>>().toEqualTypeOf<'subscription'>();
  });

  it('no payload means void input; no error means never', () => {
    expectTypeOf<inferInput<typeof health>>().toEqualTypeOf<void>();
    expectTypeOf<inferOutput<typeof health>>().toEqualTypeOf<'ok'>();
    expectTypeOf<inferError<typeof health>>().toEqualTypeOf<never>();
    const bare = query();
    expectTypeOf<inferInput<typeof bare>>().toEqualTypeOf<void>();
    expectTypeOf<inferOutput<typeof bare>>().toEqualTypeOf<void>();
  });

  it('middleware errors are part of inferError', () => {
    const guarded = byId.middleware(AuthMiddleware);
    expectTypeOf<inferError<typeof guarded>>().toEqualTypeOf<
      PostNotFound | Forbidden | Unauthorized
    >();
    expectTypeOf<inferOutput<typeof guarded>>().toEqualTypeOf<Post>();
  });

  it('ProcedureKind values are the three literals', () => {
    expectTypeOf<ProcedureKind.Value>().toEqualTypeOf<'query' | 'mutation' | 'subscription'>();
    expectTypeOf<ProcedureKind>().toEqualTypeOf<ProcedureKind.Value>();
    expectTypeOf<ProcedureInfo['kind']>().toEqualTypeOf<ProcedureKind.Value>();
  });
});

describe('router inference', () => {
  it('Router.Rpcs has literal dot-joined tags', () => {
    expectTypeOf<Rpc.Tag<AppRpcs>>().toEqualTypeOf<
      'health' | 'post.byId' | 'post.create' | 'post.onPost' | 'admin.stats.count' | 'deep.a.b'
    >();
    expectTypeOf<Router.Paths<typeof appRouter>>().toEqualTypeOf<Rpc.Tag<AppRpcs>>();
    expectTypeOf<ByIdRpc['_tag']>().toEqualTypeOf<'post.byId'>();
  });

  it('compiled rpcs carry the exact payload, success and error', () => {
    expectTypeOf<Rpc.Payload<ByIdRpc>>().toEqualTypeOf<{ readonly id: number }>();
    expectTypeOf<Rpc.Success<ByIdRpc>>().toEqualTypeOf<Post>();
    expectTypeOf<Rpc.Error<ByIdRpc>>().toEqualTypeOf<PostNotFound | Forbidden>();
    type HealthRpc = Rpc.ExtractTag<AppRpcs, 'health'>;
    expectTypeOf<Rpc.Payload<HealthRpc>>().toEqualTypeOf<void>();
    type CountRpc = Rpc.ExtractTag<AppRpcs, 'admin.stats.count'>;
    expectTypeOf<Rpc.Success<CountRpc>>().toEqualTypeOf<number>();
    expectTypeOf<Rpc.Payload<CountRpc>>().toEqualTypeOf<void>();
  });

  it('subscriptions compile to stream rpcs', () => {
    type OnPostRpc = Rpc.ExtractTag<AppRpcs, 'post.onPost'>;
    expectTypeOf<Rpc.Success<OnPostRpc>>().toEqualTypeOf<Stream.Stream<Post, Forbidden>>();
    expectTypeOf<Rpc.Error<OnPostRpc>>().toEqualTypeOf<never>();
  });

  it('group, record and getRpc are typed from the record', () => {
    expectTypeOf(appRouter.group).toEqualTypeOf<RpcGroup.RpcGroup<AppRpcs>>();
    expectTypeOf<Router.Record<typeof appRouter>['post']['byId']>().toEqualTypeOf<typeof byId>();
    expectTypeOf(Router.getRpc(appRouter, 'post.byId')).toEqualTypeOf<ByIdRpc>();
    // @ts-expect-error unknown tags are rejected
    Router.getRpc(appRouter, 'post.nope');
  });

  it('router.middleware adds the middleware error to every rpc', () => {
    const guarded = appRouter.middleware(AuthMiddleware);
    type GuardedById = Rpc.ExtractTag<Router.Rpcs<typeof guarded>, 'post.byId'>;
    expectTypeOf<Rpc.Error<GuardedById>>().toEqualTypeOf<PostNotFound | Forbidden | Unauthorized>();
    type GuardedCount = Rpc.ExtractTag<Router.Rpcs<typeof guarded>, 'admin.stats.count'>;
    expectTypeOf<Rpc.Error<GuardedCount>>().toEqualTypeOf<Unauthorized>();
    expectTypeOf<Router.Paths<typeof guarded>>().toEqualTypeOf<Router.Paths<typeof appRouter>>();
  });

  it('merge and readonly (as const) records keep exact paths', () => {
    const a = Router.make({ x: query({ success: Schema.String }) } as const);
    const b = Router.make({ y: { z: query({ payload: { n: Schema.Number } }) } });
    const merged = Router.merge(a, b);
    expectTypeOf<Router.Paths<typeof merged>>().toEqualTypeOf<'x' | 'y.z'>();
    type Z = Rpc.ExtractTag<Router.Rpcs<typeof merged>, 'y.z'>;
    expectTypeOf<Rpc.Payload<Z>>().toEqualTypeOf<{ readonly n: number }>();
  });

  it('handlers for router.group.toLayer are typed per tag', () => {
    type Handlers = RpcGroup.HandlersFrom<AppRpcs>;
    expectTypeOf<Parameters<Handlers['post.byId']>[0]>().toEqualTypeOf<{ readonly id: number }>();
  });

  it('inferRouterInputs / Outputs / Errors mirror the nested record', () => {
    type Inputs = inferRouterInputs<typeof appRouter>;
    type Outputs = inferRouterOutputs<typeof appRouter>;
    type Errors = inferRouterErrors<typeof appRouter>;
    expectTypeOf<Inputs['post']['byId']>().toEqualTypeOf<{ readonly id: number }>();
    expectTypeOf<Inputs['health']>().toEqualTypeOf<void>();
    expectTypeOf<Outputs['post']['onPost']>().toEqualTypeOf<Post>();
    expectTypeOf<Outputs['admin']['stats']['count']>().toEqualTypeOf<number>();
    expectTypeOf<Outputs['deep']['a']['b']>().toEqualTypeOf<string>();
    expectTypeOf<Errors['post']['byId']>().toEqualTypeOf<PostNotFound | Forbidden>();
    expectTypeOf<keyof Inputs>().toEqualTypeOf<'health' | 'post' | 'admin' | 'deep'>();
  });

  it('Schema.Class payloads are kept as-is (not treated as struct fields)', () => {
    class NewPost extends Schema.Class<NewPost>('NewPost')({ title: Schema.String }) {}
    const def = query({ payload: NewPost, success: Schema.Number });
    expectTypeOf<inferInput<typeof def>>().toEqualTypeOf<NewPost>();
    const router = Router.make({ def });
    type DefRpc = Rpc.ExtractTag<Router.Rpcs<typeof router>, 'def'>;
    expectTypeOf<Rpc.Payload<DefRpc>>().toEqualTypeOf<NewPost>();
  });
});
