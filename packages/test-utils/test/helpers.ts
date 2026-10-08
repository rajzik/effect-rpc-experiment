import { createConnection } from 'node:net';

/** Resolves `true` if a TCP connection to `localhost:port` succeeds, `false` if it is refused. */
export const canConnect = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = createConnection({ port, host: 'localhost' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });

/** A raw `effect/rpc` request message, as an `RpcClient` sends it. */
export const rawRequestBody = (tag: string, payload: unknown = null): string =>
  `${JSON.stringify({ _tag: 'Request', id: '1', tag, payload, headers: [] })}\n`;

/** Parses an NDJSON response body into its frames. */
export const readNdjson = async (response: Response): Promise<ReadonlyArray<unknown>> =>
  (await response.text())
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line));

/** Settles a promise into its rejection reason (or `undefined` when it resolves). */
export const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );
