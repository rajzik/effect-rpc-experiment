/**
 * Serves an effect-trpc router from Electron's main process to its renderers.
 *
 * `MainRpcServer` listens on `ipcMain` for the `MessagePort`s that `installPreloadBridge`
 * (`@effect-trpc/electron/preload`) forwards, and turns each one into an `effect/rpc` client
 * connection of a `MessagePortServer`. Renderers call it through `rendererLink`
 * (`@effect-trpc/electron/renderer`) and `createClient` from `@effect-trpc/client`; handlers
 * come from `Handlers.make` in `@effect-trpc/server`.
 *
 * @since 0.1.0
 */
import { Effect, Layer, ManagedRuntime } from 'effect';
import type { Scope } from 'effect';
import type { Router } from '@effect-trpc/core';
import type { Handlers } from '@effect-trpc/server';
import { MessagePortServer } from './MessagePortServer.js';
import type { ServeOptions } from './MessagePortServer.js';
import { defaultChannel } from './types.js';
import type { IpcMainEventLike, IpcMainLike, IpcMainListener } from './types.js';

/**
 * The request header (`"x-effect-trpc-sender-id"`) carrying the `webContents.id` of the renderer
 * that opened the connection.
 *
 * **When to use**
 *
 * Use it in a test or a custom transport to name the header. In handlers and middleware prefer
 * `MainRpcServer.senderId(headers)`, which also parses the value.
 *
 * **Details**
 *
 * - Set by the main process on every request of a connection. A value the renderer sends under
 *   this name (any casing) is replaced, so handlers can trust it.
 * - Absent when the `IpcMainEvent` had no `sender`.
 *
 * **Example** (Showing that a renderer cannot spoof its sender id)
 *
 * ```ts
 * // renderer.ts (renderer process)
 * import { Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { createClient } from '@effect-trpc/client';
 * import { senderIdHeader } from '@effect-trpc/electron';
 * import { rendererLink } from '@effect-trpc/electron/renderer';
 *
 * const appRouter = Router.make({ whoami: query({ success: Schema.NullOr(Schema.Number) }) });
 * const client = createClient(appRouter, { link: rendererLink() });
 *
 * // The main process replaces the header: this still resolves to the real webContents.id.
 * const id = await client.whoami(undefined, { headers: { [senderIdHeader]: '99' } });
 * ```
 *
 * @see {@link MainRpcServer}
 * @category utils
 * @since 0.1.0
 */
export const senderIdHeader = 'x-effect-trpc-sender-id' as const;

/**
 * Options of {@link MainRpcServer.make} and {@link MainRpcServer.layer}.
 *
 * **Details**
 *
 * - Extends `ServeOptions`: `handlers`, `serialization` (default `RpcSerialization.json`),
 *   `disableTracing`, `spanPrefix`, `concurrency`.
 * - A posted event is ignored when it carries no port. It is rejected (every port closed) when it
 *   carries more than one port or `authorize` returns `false`.
 *
 * @see {@link MainRpcServerRunOptions}
 * @category options
 * @since 0.1.0
 */
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

/**
 * Options of {@link MainRpcServer.run}: like {@link MainRpcServerOptions}, but `handlers` is
 * required and must provide every requirement of the router (handlers and middleware).
 *
 * @category options
 * @since 0.1.0
 */
export interface MainRpcServerRunOptions<R extends Router.Any, LE> extends Omit<
  MainRpcServerOptions<Handlers.Requirements<R>, LE, never>,
  'handlers'
> {
  readonly handlers: Layer.Layer<Handlers.Requirements<R>, LE>;
}

/**
 * A running main-process server, returned by {@link MainRpcServer.run}.
 *
 * **Details**
 *
 * - `dispose()` is idempotent (later calls return the first promise) and also available as
 *   `Symbol.asyncDispose`, so `await using server = await MainRpcServer.run(...)` works.
 *
 * @category models
 * @since 0.1.0
 */
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
 *
 * **When to use**
 *
 * Use inside an Effect program that owns a `Scope`. Prefer {@link layer} to compose it into an
 * application layer, and {@link run} when the main process is not an Effect application.
 *
 * **Details**
 *
 * - Each accepted port gets the trusted `x-effect-trpc-sender-id` header (`event.sender.id`).
 * - Handler services not provided by `options.handlers` stay requirements of the effect.
 * - A defect in a handler fails only that call (`RpcDefect` in the renderer).
 *
 * **Example** (Serving from a scoped Effect program)
 *
 * ```ts
 * // main.ts (main process)
 * import { ipcMain } from 'electron';
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { MainRpcServer } from '@effect-trpc/electron/main';
 *
 * const appRouter = Router.make({ ping: query({ success: Schema.String }) });
 * const HandlersLive = Handlers.make(appRouter, { ping: () => Effect.succeed('pong') });
 *
 * const program = Effect.gen(function* () {
 *   yield* MainRpcServer.make(appRouter, { handlers: HandlersLive, ipcMain });
 *   return yield* Effect.never; // serve until the fiber is interrupted
 * });
 *
 * Effect.runFork(Effect.scoped(program));
 * ```
 *
 * @see {@link layer}
 * @see {@link run}
 * @since 0.1.0
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

/**
 * {@link make} as a layer, for composing into an Effect application.
 *
 * **When to use**
 *
 * Use when the main process is (or contains) an Effect application. The server starts when the
 * layer is built and stops (listener removed, ports closed) when its scope closes.
 *
 * **Details**
 *
 * - `handlers` is optional: services the router's handlers need and the layer does not provide
 *   stay requirements of the returned layer, to be provided with `Layer.provide`.
 *
 * **Example** (Composing the server into an application layer)
 *
 * ```ts
 * // main.ts (main process)
 * import { app, ipcMain } from 'electron';
 * import { Effect, Fiber, Layer, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { MainRpcServer } from '@effect-trpc/electron/main';
 *
 * const appRouter = Router.make({
 *   whoami: query({ success: Schema.NullOr(Schema.Number) }),
 * });
 * const HandlersLive = Handlers.make(appRouter, {
 *   whoami: (_, { headers }) => Effect.succeed(MainRpcServer.senderId(headers) ?? null),
 * });
 *
 * const MainLive = MainRpcServer.layer(appRouter, { handlers: HandlersLive, ipcMain });
 *
 * const fiber = Effect.runFork(Layer.launch(MainLive));
 * app.on('will-quit', () => void Effect.runPromise(Fiber.interrupt(fiber)));
 * ```
 *
 * @see {@link make}
 * @since 0.1.0
 */
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
 * **When to use**
 *
 * The default for an Electron app whose main process is plain TypeScript. Prefer {@link layer}
 * when the main process already runs an Effect application.
 *
 * **Details**
 *
 * - `handlers` must provide every requirement of the router (a type error otherwise).
 * - `dispose()` removes the `ipcMain` listener, closes every connection (pending renderer calls
 *   reject with `RpcTransportError`, in-flight handlers are interrupted) and releases the
 *   handlers layer.
 *
 * **Gotchas**
 *
 * - Await `run` before the window loads its page. `ipcMain` does not buffer messages, so a port
 *   posted before the listener exists is lost and the renderer's calls fail with
 *   `RpcTransportError` after `connectTimeout` (10 seconds by default).
 * - Keep `contextIsolation: true` and do not expose anything with `contextBridge`; the preload
 *   bridge only forwards ports. Every script in the page can still connect, so treat procedures
 *   as a public API and use `authorize` or middleware to restrict access.
 *
 * **Example** (Starting the server and opening a window)
 *
 * ```ts
 * // main.ts (main process)
 * import { fileURLToPath } from 'node:url';
 * import { app, BrowserWindow, ipcMain } from 'electron';
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { MainRpcServer } from '@effect-trpc/electron/main';
 *
 * class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
 * class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}
 *
 * // In a real app the router lives in a module shared with the renderer.
 * const appRouter = Router.make({
 *   user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
 * });
 *
 * const HandlersLive = Handlers.make(appRouter, {
 *   user: {
 *     byId: ({ id }) =>
 *       id === '1'
 *         ? Effect.succeed(new User({ id, name: 'Ada' }))
 *         : Effect.fail(new NotFound({ id })),
 *   },
 * });
 *
 * await app.whenReady();
 * const server = await MainRpcServer.run(appRouter, {
 *   handlers: HandlersLive,
 *   ipcMain,
 *   // Only pages of the packaged app may connect.
 *   authorize: (event) => event.senderFrame?.url.startsWith('app://') === true,
 * });
 * app.on('will-quit', () => void server.dispose());
 *
 * const win = new BrowserWindow({
 *   webPreferences: {
 *     preload: fileURLToPath(new URL('./preload.js', import.meta.url)),
 *     contextIsolation: true,
 *     sandbox: true,
 *   },
 * });
 * await win.loadURL('app://bundle/index.html');
 * ```
 *
 * @see {@link layer}
 * @see {@link RunningMainRpcServer}
 * @since 0.1.0
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
 * **When to use**
 *
 * Use in a handler or middleware to know which window called, e.g. to look up its
 * `BrowserWindow` with `BrowserWindow.fromId` or `webContents.fromId`.
 *
 * **Details**
 *
 * - Returns `undefined` when the header is missing (not served by `MainRpcServer`, or no
 *   `sender` on the IPC event) or is not an integer.
 *
 * **Example** (Answering with the caller's window id)
 *
 * ```ts
 * // main.ts (main process)
 * import { Effect, Schema } from 'effect';
 * import { query, Router } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { MainRpcServer } from '@effect-trpc/electron/main';
 *
 * const appRouter = Router.make({ whoami: query({ success: Schema.NullOr(Schema.Number) }) });
 *
 * export const HandlersLive = Handlers.make(appRouter, {
 *   whoami: (_, { headers }) => Effect.succeed(MainRpcServer.senderId(headers) ?? null),
 * });
 * ```
 *
 * @see {@link senderIdHeader}
 * @since 0.1.0
 */
const senderId = (headers: Readonly<Record<string, string | undefined>>): number | undefined => {
  const value = headers[senderIdHeader];
  if (value === undefined) return undefined;
  const id = Number(value);
  return Number.isInteger(id) ? id : undefined;
};

/**
 * The main-process side: serves a router to renderers over `MessagePortMain`s.
 *
 * **When to use**
 *
 * Use in Electron's main process, imported from `@effect-trpc/electron/main`. Members: `run`
 * (Promise API, own runtime), `layer` / `make` (inside an Effect application), `senderId` (read
 * the caller's `webContents.id` in a handler) and `senderIdHeader`.
 *
 * **Details**
 *
 * - One connection per renderer client: each `createClient(router, { link: rendererLink() })`
 *   opens its own `MessageChannel`. Frames are JSON strings by default.
 * - When a connection's port closes (renderer `client.dispose()`, page reload, window closed),
 *   that connection's in-flight handlers and streams are interrupted; other renderers keep
 *   working.
 * - Handler defects fail only their call (`RpcDefect`); typed errors reach the renderer as the
 *   router's `Schema.TaggedError` instances.
 *
 * **Gotchas**
 *
 * - Use the same `channel` in `MainRpcServer`, `installPreloadBridge` and `rendererLink`.
 * - Never import this entry in a preload script or renderer: it pulls in Effect and the server.
 *
 * **Example** (Main process with a Promise-style lifecycle)
 *
 * ```ts
 * // main.ts (main process)
 * import { app, ipcMain } from 'electron';
 * import { Effect, Schedule, Schema, Stream } from 'effect';
 * import { query, Router, subscription } from '@effect-trpc/core';
 * import { Handlers } from '@effect-trpc/server';
 * import { MainRpcServer } from '@effect-trpc/electron/main';
 *
 * const appRouter = Router.make({
 *   whoami: query({ success: Schema.NullOr(Schema.Number) }),
 *   clock: subscription({ success: Schema.Number }),
 * });
 *
 * const HandlersLive = Handlers.make(appRouter, {
 *   whoami: (_, { headers }) => Effect.succeed(MainRpcServer.senderId(headers) ?? null),
 *   clock: () => Stream.fromSchedule(Schedule.spaced('1 second')),
 * });
 *
 * const server = await MainRpcServer.run(appRouter, { handlers: HandlersLive, ipcMain });
 * app.on('will-quit', () => void server.dispose());
 * ```
 *
 * @see {@link MainRpcServerOptions}
 * @see {@link MessagePortServer}
 * @category adapters
 * @since 0.1.0
 */
export const MainRpcServer = {
  make,
  layer,
  run,
  senderId,
  senderIdHeader,
} as const;
