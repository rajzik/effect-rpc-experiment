import { Effect, Layer, ManagedRuntime } from 'effect';
import type { Scope } from 'effect';
import type { Router } from '@effect-trpc/core';
import type { Handlers } from '@effect-trpc/server';
import { MessagePortServer } from './MessagePortServer.js';
import type { ServeOptions } from './MessagePortServer.js';
import { defaultChannel } from './types.js';
import type { IpcMainEventLike, IpcMainLike, IpcMainListener } from './types.js';

/**
 * The request header carrying the `webContents.id` of the renderer that opened the connection.
 * Set by the main process (a value sent by the renderer is replaced), so handlers can trust it.
 */
export const senderIdHeader = 'x-effect-trpc-sender-id' as const;

/** Options of {@link MainRpcServer.layer}. */
export interface MainRpcServerOptions<LOut, LE, LR> extends ServeOptions<LOut, LE, LR> {
  /** Electron's `ipcMain` (or any object with the same `on` / `removeListener`). */
  readonly ipcMain: IpcMainLike;
  /** The IPC channel the preload bridge posts ports on. Defaults to `"effect-trpc"`. */
  readonly channel?: string | undefined;
  /**
   * Accepts or rejects a connection, e.g. by checking `event.senderFrame?.url`. Rejected ports
   * are closed. Defaults to accepting every renderer that can post on the channel.
   */
  readonly authorize?: ((event: IpcMainEventLike) => boolean) | undefined;
}

/** Options of {@link MainRpcServer.run}: the handlers layer must provide every requirement. */
export interface MainRpcServerRunOptions<R extends Router.Any, LE> extends Omit<
  MainRpcServerOptions<Handlers.Requirements<R>, LE, never>,
  'handlers'
> {
  readonly handlers: Layer.Layer<Handlers.Requirements<R>, LE>;
}

/** A running main-process server (see {@link MainRpcServer.run}). */
export interface RunningMainRpcServer {
  /** Stops listening on `ipcMain`, closes every connection and releases the handlers layer. */
  readonly dispose: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

type MainRequirements<R extends Router.Any, LOut, LR> =
  | LR
  | Exclude<Handlers.Requirements<R>, LOut>;

/**
 * Serves `router` to renderers in the current scope: every `MessagePort` posted on `channel`
 * (by `installPreloadBridge`) becomes one connection. Stops listening and closes all
 * connections when the scope closes.
 */
const make = <R extends Router.Any, LOut = never, LE = never, LR = never>(
  router: R,
  options: MainRpcServerOptions<LOut, LE, LR>,
): Effect.Effect<void, LE, Scope.Scope | MainRequirements<R, LOut, LR>> =>
  Effect.gen(function* () {
    const channel = options.channel ?? defaultChannel;
    const { ipcMain, authorize } = options;
    const server = yield* MessagePortServer.serve(router, options);
    const context = yield* Effect.context();
    const runFork = Effect.runForkWith(context);
    const listener: IpcMainListener = (event) => {
      const ports = event.ports;
      const port = ports[0];
      if (port === undefined) return;
      if (ports.length !== 1 || (authorize !== undefined && !authorize(event))) {
        for (const rejected of ports) rejected.close();
        return;
      }
      const senderId = event.sender?.id;
      runFork(
        server.attach(port, {
          headers: { [senderIdHeader]: senderId === undefined ? undefined : String(senderId) },
        }),
      );
    };
    ipcMain.on(channel, listener);
    yield* Effect.addFinalizer(() => Effect.sync(() => ipcMain.removeListener(channel, listener)));
  });

/** {@link make} as a layer, for composing into an Effect application. */
const layer = <R extends Router.Any, LOut = never, LE = never, LR = never>(
  router: R,
  options: MainRpcServerOptions<LOut, LE, LR>,
): Layer.Layer<never, LE, MainRequirements<R, LOut, LR>> =>
  Layer.effectDiscard(make(router, options));

/**
 * Starts the main-process server with a self-contained runtime (no Effect application needed).
 * Resolves once the handlers layer is built and `ipcMain` is listening; rejects when the layer
 * fails to build.
 *
 * ```ts
 * const server = await MainRpcServer.run(appRouter, { handlers: HandlersLive, ipcMain });
 * app.on('will-quit', () => void server.dispose());
 * ```
 */
const run = async <R extends Router.Any, LE = never>(
  router: R,
  options: MainRpcServerRunOptions<R, LE>,
): Promise<RunningMainRpcServer> => {
  const runtime = ManagedRuntime.make(layer(router, options));
  try {
    await runtime.context();
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
  let disposed: Promise<void> | undefined;
  const dispose = (): Promise<void> => (disposed ??= runtime.dispose());
  return { dispose, [Symbol.asyncDispose]: dispose };
};

/**
 * Reads the sender id (the renderer's `webContents.id`) from the headers a handler receives.
 *
 * ```ts
 * whoami: (_, { headers }) => Effect.succeed(MainRpcServer.senderId(headers))
 * ```
 */
const senderId = (headers: Readonly<Record<string, string | undefined>>): number | undefined => {
  const value = headers[senderIdHeader];
  if (value === undefined) return undefined;
  const id = Number(value);
  return Number.isInteger(id) ? id : undefined;
};

/** The main-process side: serves a router to renderers over `MessagePortMain`s. */
export const MainRpcServer = {
  make,
  layer,
  run,
  senderId,
  senderIdHeader,
} as const;
