import type { Cause, Exit, Option } from 'effect';
import type { RpcClientError } from 'effect/rpc';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import {
  causeToClientError,
  exitToClientError,
  isClientInfrastructureError,
} from '../src/index.js';
import type {
  ClientError,
  ClientInfrastructureError,
  RpcDefect,
  RpcInterrupted,
  RpcTransportError,
} from '../src/index.js';
import type { Forbidden, PostNotFound } from './fixtures.js';

describe('ClientError', () => {
  it('is exactly E plus the three infrastructure errors', () => {
    expectTypeOf<ClientError<PostNotFound | Forbidden>>().toEqualTypeOf<
      PostNotFound | Forbidden | RpcDefect | RpcTransportError | RpcInterrupted
    >();
    expectTypeOf<ClientError<never>>().toEqualTypeOf<ClientInfrastructureError>();
  });

  it('infrastructure errors have literal tags', () => {
    expectTypeOf<RpcDefect['_tag']>().toEqualTypeOf<'@effect-trpc/RpcDefect'>();
    expectTypeOf<RpcTransportError['_tag']>().toEqualTypeOf<'@effect-trpc/RpcTransportError'>();
    expectTypeOf<RpcInterrupted['_tag']>().toEqualTypeOf<'@effect-trpc/RpcInterrupted'>();
    expectTypeOf<RpcDefect['message']>().toEqualTypeOf<string>();
  });

  it('causeToClientError removes RpcClientError from the domain error', () => {
    const cause = null! as Cause.Cause<PostNotFound | RpcClientError.RpcClientError>;
    expectTypeOf(causeToClientError(cause)).toEqualTypeOf<ClientError<PostNotFound>>();
    const plain = null! as Cause.Cause<Forbidden>;
    expectTypeOf(causeToClientError(plain)).toEqualTypeOf<ClientError<Forbidden>>();
  });

  it('exitToClientError returns an optional ClientError', () => {
    const exit = null! as Exit.Exit<number, Forbidden | RpcClientError.RpcClientError>;
    expectTypeOf(exitToClientError(exit)).toEqualTypeOf<Option.Option<ClientError<Forbidden>>>();
  });

  it('isClientInfrastructureError narrows a ClientError to E', () => {
    const error = null! as ClientError<PostNotFound>;
    if (isClientInfrastructureError(error)) {
      expectTypeOf(error).toEqualTypeOf<RpcDefect | RpcTransportError | RpcInterrupted>();
    } else {
      expectTypeOf(error).toEqualTypeOf<PostNotFound>();
    }
  });
});
