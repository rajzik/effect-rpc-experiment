# @effect-trpc/electron

Typed RPC between Electron's main process and its renderers for
[effect-trpc](../../README.md) routers. Effect RPC runs over a `MessagePort` per renderer: the
renderer opens a `MessageChannel`, the preload script hands one end to the main process, and the
main process serves the router on it. Queries, mutations, subscriptions (with backpressure),
typed `Schema.TaggedError` failures, `Schema.Class` instances and cancellation all work like over
HTTP.

- **main**: `MainRpcServer.run(router, { handlers, ipcMain })` (or `.layer` / `.make` inside an
  Effect app)
- **preload**: `installPreloadBridge({ ipcRenderer })` (no Effect, sandbox friendly)
- **renderer**: `createClient(router, { link: rendererLink() })`

The package never imports `electron` at runtime. It only uses structural types (`IpcMainLike`,
`IpcRendererLike`, `PortLike`, `PortMainLike`, `WindowLike`) that Electron's real objects
satisfy. So it loads in a sandboxed renderer and in plain Node, where tests drive it with Node
`worker_threads` `MessageChannel` ports.

## Install

```sh
pnpm add @effect-trpc/electron @effect-trpc/client @effect-trpc/server @effect-trpc/core effect
```

## Setup (three files)

Define the router in a module that both processes can import. It holds only schemas, no
handlers:

```ts
// shared/router.ts
import { Schema } from 'effect';
import { query, Router, subscription } from '@effect-trpc/core';

export class User extends Schema.Class<User>('User')({ id: Schema.String, name: Schema.String }) {}
export class NotFound extends Schema.TaggedError<NotFound>()('NotFound', { id: Schema.String }) {}

export const appRouter = Router.make({
  user: { byId: query({ payload: { id: Schema.String }, success: User, error: NotFound }) },
  clock: subscription({ success: Schema.Number }),
});
```

**main.ts** (main process):

```ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { Effect, Schedule, Stream } from 'effect';
import { Handlers } from '@effect-trpc/server';
import { MainRpcServer } from '@effect-trpc/electron/main';
import { appRouter, NotFound, User } from './shared/router.js';

const HandlersLive = Handlers.make(appRouter, {
  user: {
    byId: ({ id }) =>
      id === '1'
        ? Effect.succeed(new User({ id, name: 'Ada' }))
        : Effect.fail(new NotFound({ id })),
  },
  clock: () => Stream.fromSchedule(Schedule.spaced('1 second')),
});

await app.whenReady();
const server = await MainRpcServer.run(appRouter, { handlers: HandlersLive, ipcMain });
app.on('will-quit', () => void server.dispose());

new BrowserWindow({
  webPreferences: {
    preload: `${import.meta.dirname}/preload.js`,
    contextIsolation: true,
    sandbox: true,
  },
}).loadFile('index.html');
```

**preload.ts**:

```ts
import { ipcRenderer } from 'electron';
import { installPreloadBridge } from '@effect-trpc/electron/preload';

installPreloadBridge({ ipcRenderer });
```

**renderer.tsx**:

```tsx
import { createClient } from '@effect-trpc/client';
import { rendererLink } from '@effect-trpc/electron/renderer';
import { appRouter } from './shared/router.js';

export const client = createClient(appRouter, { link: rendererLink() });

const user = await client.user.byId({ id: '1' }); // User instance, rejects with NotFound
for await (const now of client.clock()) console.log(now); // subscription
```

The client plugs into `@effect-trpc/tanstack-react-query` like any other link.

## How it works

1. On its first call, `rendererLink()` creates a `MessageChannel` and posts `port2` to its own
   window: `window.postMessage({ type: 'effect-trpc/connect', channel }, '*', [port2])`.
2. The preload bridge (in the isolated world) receives that message and forwards the port with
   `ipcRenderer.postMessage(channel, { type: 'effect-trpc/connect' }, [port])`. It only forwards
   messages whose `source` is the window itself (not an iframe) and whose `channel` matches.
3. `MainRpcServer` listens with `ipcMain.on(channel, ...)`. Each `MessagePortMain` it receives
   becomes one Effect RPC client connection, and frames are JSON strings.

Each `createClient` instance gets its own connection. `client.dispose()` closes it, which
interrupts that renderer's in-flight handlers and streams in the main process. If the main
process closes a port, or `server.dispose()` runs, pending calls reject with
`RpcTransportError` and later calls fail immediately. A defect in one handler fails only that call
(`RpcDefect`); the connection and every other renderer keep working. If the main process does not
acknowledge a connection within `connectTimeout` (default `10 seconds`, for example because the
bridge is missing or the channel differs), calls fail with `RpcTransportError` instead of hanging.

## Requirements and security

- **`contextIsolation: true`** (Electron's default) is required. The page cannot reach
  `ipcRenderer`, so the bridge runs in the preload script and only forwards ports. Nothing is
  exposed with `contextBridge`.
- **Sandboxed preloads** (`sandbox: true`) cannot `require` npm packages, so bundle the preload
  script. The bridge itself has no dependencies (no Effect).
- Any script running in the page can open a connection, just like any script can call a tRPC
  endpoint. Treat procedures as a public API: validate input with schemas and authorize in
  handlers or middleware.
- `MainRpcServer` sets the `x-effect-trpc-sender-id` request header to the renderer's
  `webContents.id`. A renderer cannot spoof this header because the server replaces it. Read it
  with `MainRpcServer.senderId(headers)` in a handler or middleware.
- `authorize: (event) => boolean` rejects connections, for example by origin:
  `authorize: (e) => e.senderFrame?.url.startsWith('app://') === true`.
- Use a custom `channel` on all three sides to run several independent servers.

## Effect API

```ts
// in an Effect application (handlers optional: missing services stay layer requirements)
const MainLive = MainRpcServer.layer(appRouter, { handlers: HandlersLive, ipcMain });

// read the sender (webContents.id) in a handler
const HandlersLive = Handlers.make(appRouter, {
  whoami: (_, { headers }) => Effect.succeed(MainRpcServer.senderId(headers) ?? null),
});
```

Generic building blocks, for utility processes, workers or custom handshakes:

- `MessagePortServer.serve(router, { handlers })`: an `Effect` (scoped) returning `{ attach }`.
  `attach(port, { headers })` serves one port (`PortLike` or `PortMainLike`).
- `MessagePortServer.make()`: the bare `RpcServer.Protocol` plus `attach`.
- `messagePortLink(port | () => port)`: a client `Link` over a port. Pass a factory to open one
  port per client.
- `messagePortProtocolClient(port)`: the bare `RpcClient.Protocol`.

All of them accept `serialization` (default `RpcSerialization.json`). Binary serializations send
`Uint8Array` frames.

## Entry points

| import                           | contents                                                                 |
| -------------------------------- | ------------------------------------------------------------------------ |
| `@effect-trpc/electron/main`     | `MainRpcServer`, `MessagePortServer`, main-process types                 |
| `@effect-trpc/electron/preload`  | `installPreloadBridge` only (no Effect: small sandboxed preload bundles) |
| `@effect-trpc/electron/renderer` | `rendererLink`, `messagePortLink`, `messagePortProtocolClient`           |
| `@effect-trpc/electron`          | everything                                                               |
