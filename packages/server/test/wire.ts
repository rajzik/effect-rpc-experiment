// Helpers to speak the effect/rpc HTTP wire protocol by hand (what an RpcClient sends).
import { Exit } from 'effect';
import { Codecs, Router } from '@effect-trpc/core';
import type { WebHandler } from '../src/index.js';
import { appRouter } from './fixtures.js';

export interface RpcRequest {
  readonly tag: string;
  readonly payload?: unknown;
  readonly id?: string;
  readonly headers?: ReadonlyArray<readonly [string, string]>;
}

export interface Frame {
  readonly _tag: string;
  readonly requestId?: string;
  readonly values?: ReadonlyArray<unknown>;
  readonly exit?: unknown;
}

const toMessage = (request: RpcRequest, index: number) => ({
  _tag: 'Request',
  id: request.id ?? String(index + 1),
  tag: request.tag,
  payload: request.payload ?? null,
  headers: request.headers ?? [],
});

/** Builds a POST request carrying rpc request messages. */
export const rpcRequest = (
  requests: ReadonlyArray<RpcRequest>,
  options: {
    readonly format?: 'ndjson' | 'json';
    readonly headers?: Record<string, string>;
    readonly url?: string;
  } = {},
): Request => {
  const messages = requests.map(toMessage);
  const format = options.format ?? 'ndjson';
  return new Request(options.url ?? 'http://localhost/rpc', {
    method: 'POST',
    headers: { 'content-type': `application/${format}`, ...options.headers },
    body:
      format === 'ndjson'
        ? messages.map((m) => `${JSON.stringify(m)}\n`).join('')
        : JSON.stringify(messages),
  });
};

const isFrame = (u: unknown): u is Frame =>
  typeof u === 'object' && u !== null && '_tag' in u && typeof u._tag === 'string';

const toFrames = (values: ReadonlyArray<unknown>): ReadonlyArray<Frame> =>
  values.map((value) => {
    if (!isFrame(value)) throw new Error(`Not an rpc frame: ${JSON.stringify(value)}`);
    return value;
  });

const parseJson = (text: string): unknown => JSON.parse(text);

/** Parses an NDJSON or JSON response body into frames. */
export const readFrames = async (response: Response): Promise<ReadonlyArray<Frame>> => {
  const text = await response.text();
  if (response.headers.get('content-type')?.includes('ndjson') === true) {
    return toFrames(
      text
        .split('\n')
        .filter((line) => line.length > 0)
        .map(parseJson),
    );
  }
  const parsed = parseJson(text);
  return toFrames(Array.isArray(parsed) ? parsed : [parsed]);
};

/** Sends one request and returns its frames. */
export const call = async (
  web: WebHandler,
  request: RpcRequest,
  options?: Parameters<typeof rpcRequest>[1],
): Promise<ReadonlyArray<Frame>> => {
  const response = await web.handler(rpcRequest([request], options));
  if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
  return readFrames(response);
};

/** The encoded exit of the (single) Exit frame. */
export const exitFrame = (frames: ReadonlyArray<Frame>): unknown => {
  const exits = frames.filter((frame) => frame._tag === 'Exit');
  if (exits.length !== 1) throw new Error(`Expected one Exit frame, got ${JSON.stringify(frames)}`);
  return exits[0]?.exit;
};

/** Decodes the Exit frame of a `user.byId` call with the core codecs (instances!). */
export const decodeUserByIdExit = (frames: ReadonlyArray<Frame>) =>
  Codecs.decodeExitSync(Router.getRpc(appRouter, 'user.byId'), exitFrame(frames));

export { Exit };
