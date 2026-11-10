// The client types of the generated contract: exact, from the generated schemas.
import { describe, expectTypeOf, it } from 'vite-plus/test';
import type { ClientError, Router } from '@rpc-effect/core';
import type { Client } from '@rpc-effect/client';
import type { AppRouter as ClientRouter } from './fixtures/app/router.client.gen.js';
import type { AppRouter as ServerRouter } from './fixtures/app/router.gen.js';
import type {
  __contract_AppRouter,
  __contract_PostRouter,
} from './fixtures/effectful/router.client.gen.js';
import type {
  Forbidden,
  Post,
  PostNotFound,
  Thread,
  Tree,
  Unauthorized,
} from './fixtures/app/models.js';

type C = Router.Record<typeof ClientRouter>;

describe('generated client contract types', () => {
  it('outputs and errors come from the inferred schemas', () => {
    expectTypeOf<Client.Output<C['post']['byId']>>().toEqualTypeOf<Post>();
    expectTypeOf<Client.Error<C['post']['byId']>>().toEqualTypeOf<ClientError<PostNotFound>>();
    // `DbError` is not a schema: not a typed error. `Unauthorized` comes from the Auth middleware.
    expectTypeOf<Client.Error<C['post']['create']>>().toEqualTypeOf<
      ClientError<Forbidden | Unauthorized>
    >();
    expectTypeOf<Client.Output<C['health']>>().toEqualTypeOf<'ok'>();
    expectTypeOf<Client.Output<C['data']['tree']>>().toEqualTypeOf<Tree>();
    expectTypeOf<Client.Output<C['data']['stats']>>().toEqualTypeOf<{
      readonly total: bigint;
      readonly tags: ReadonlySet<string>;
      readonly byAuthor: ReadonlyMap<string, number>;
      readonly counts: { readonly [x: string]: number };
      readonly latest: Date | undefined;
      readonly titles: Array<string>;
    }>();
    expectTypeOf<Client.Output<C['data']['ping']>>().toEqualTypeOf<void>();
    expectTypeOf<Client.Output<C['data']['thread']>>().toEqualTypeOf<Thread>();
    expectTypeOf<Client.Output<C['data']['archive']>>().toEqualTypeOf<{
      readonly archivedAt?: Date | null | undefined;
      readonly note: 'it\'s "quoted"';
    }>();
    expectTypeOf<Client.Output<C['admin']['count']>>().toEqualTypeOf<number>();
  });

  it('the client and server routers have the same procedures', () => {
    expectTypeOf<Router.Paths<typeof ClientRouter>>().toEqualTypeOf<
      Router.Paths<typeof ServerRouter>
    >();
  });

  it('the contract check of an Effect.gen router service is up to date', () => {
    expectTypeOf<typeof __contract_PostRouter>().toEqualTypeOf<'up to date'>();
    expectTypeOf<typeof __contract_AppRouter>().toEqualTypeOf<'up to date'>();
  });
});
