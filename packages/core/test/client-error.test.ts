import { Cause, Exit, Option, Schema } from 'effect';
import { RpcClientError } from 'effect/rpc';
import { describe, expect, it } from 'vite-plus/test';
import {
  causeToClientError,
  exitToClientError,
  isClientInfrastructureError,
  isRpcClientError,
  RpcDefect,
  RpcInterrupted,
  RpcTransportError,
} from '../src/index.js';
import { Forbidden, PostNotFound } from './fixtures.js';

const transportError = () =>
  new RpcClientError.RpcClientError({
    reason: new RpcClientError.RpcClientDefect({ message: 'socket closed', cause: 'ECONNRESET' }),
  });

describe('causeToClientError', () => {
  it('returns the same instance for Fail(E)', () => {
    const error = new PostNotFound({ id: 1 });
    expect(causeToClientError(Cause.fail(error))).toBe(error);
  });

  it('maps Fail(RpcClientError) to RpcTransportError keeping the original as cause', () => {
    const original = transportError();
    const error = causeToClientError(Cause.fail(original));
    expect(error).toBeInstanceOf(RpcTransportError);
    expect(error._tag).toBe('@effect-trpc/RpcTransportError');
    expect(error).toHaveProperty('cause', original);
    expect(error).toHaveProperty('message', original.message);
  });

  it('maps Die(Error) to RpcDefect with the error message', () => {
    const defect = new Error('boom');
    const error = causeToClientError(Cause.die(defect));
    expect(error).toBeInstanceOf(RpcDefect);
    expect(error).toHaveProperty('message', 'boom');
    expect(error).toHaveProperty('cause', defect);
  });

  it('maps Die(non-error) to RpcDefect with String(defect)', () => {
    const error = causeToClientError(Cause.die(404));
    expect(error).toBeInstanceOf(RpcDefect);
    expect(error).toHaveProperty('message', '404');
  });

  it('maps interruption-only causes to RpcInterrupted', () => {
    const error = causeToClientError(Cause.interrupt());
    expect(error).toBeInstanceOf(RpcInterrupted);
    expect(error._tag).toBe('@effect-trpc/RpcInterrupted');
  });

  it('prefers typed failures over defects over interruption', () => {
    const typed = new Forbidden({ reason: 'x' });
    const mixed = Cause.combine(
      Cause.combine(Cause.interrupt(), Cause.die('dead')),
      Cause.fail(typed),
    );
    expect(causeToClientError(mixed)).toBe(typed);
    const dieAndInterrupt = Cause.combine(Cause.interrupt(), Cause.die('dead'));
    expect(causeToClientError(dieAndInterrupt)).toBeInstanceOf(RpcDefect);
  });
});

describe('exitToClientError / guards', () => {
  it('returns none for success and the client error for failure', () => {
    expect(Option.isNone(exitToClientError(Exit.succeed(1)))).toBe(true);
    const error = new PostNotFound({ id: 9 });
    expect(exitToClientError(Exit.fail(error))).toEqual(Option.some(error));
  });

  it('isClientInfrastructureError recognizes only infrastructure errors, also after JSON', () => {
    expect(isClientInfrastructureError(new RpcInterrupted())).toBe(true);
    expect(isClientInfrastructureError(new RpcDefect({ message: 'x', cause: null }))).toBe(true);
    expect(isClientInfrastructureError(new RpcTransportError({ message: 'x', cause: null }))).toBe(
      true,
    );
    expect(isClientInfrastructureError(JSON.parse(JSON.stringify(new RpcInterrupted())))).toBe(
      true,
    );
    expect(isClientInfrastructureError(new PostNotFound({ id: 1 }))).toBe(false);
    expect(isClientInfrastructureError('RpcDefect')).toBe(false);
    expect(isClientInfrastructureError(null)).toBe(false);
  });

  it('isRpcClientError recognizes effect/rpc client errors', () => {
    expect(isRpcClientError(transportError())).toBe(true);
    expect(isRpcClientError(new RpcTransportError({ message: 'x', cause: null }))).toBe(false);
    expect(isRpcClientError(undefined)).toBe(false);
  });

  it('infrastructure errors are themselves serializable schema errors', () => {
    const codec = Schema.toCodecJson(Schema.Union([RpcDefect, RpcTransportError, RpcInterrupted]));
    const defect = new RpcDefect({ message: 'boom', cause: new Error('boom') });
    const json = JSON.parse(JSON.stringify(Schema.encodeSync(codec)(defect)));
    const decoded = Schema.decodeUnknownSync(codec)(json);
    expect(decoded).toBeInstanceOf(RpcDefect);
    expect(decoded).toHaveProperty('message', 'boom');
    expect(decoded).toHaveProperty('cause', expect.any(Error));
    const interrupted = Schema.decodeUnknownSync(codec)(
      JSON.parse(JSON.stringify(Schema.encodeSync(codec)(new RpcInterrupted()))),
    );
    expect(interrupted).toBeInstanceOf(RpcInterrupted);
  });
});
