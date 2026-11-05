# Electron

`@effect-trpc/electron` runs the server in the main process and the client in a renderer, over a
`MessagePort` per client. Nothing is exposed on `window`: the preload script only forwards ports.

| Entry point                      | Process  | Use                                   |
| -------------------------------- | -------- | ------------------------------------- |
| `@effect-trpc/electron/main`     | main     | `MainRpcServer`                       |
| `@effect-trpc/electron/preload`  | preload  | `installPreloadBridge`                |
| `@effect-trpc/electron/renderer` | renderer | `rendererLink`                        |
| `@effect-trpc/electron`          | any      | everything, plus generic port helpers |

## Three files

<<< @/snippets/electron/main.ts [main.ts]

<<< @/snippets/electron/preload.ts [preload.ts]

<<< @/snippets/electron/renderer.ts [renderer.ts]

## How it works

1. On its first call, `rendererLink()` creates a `MessageChannel` and posts one end to its own
   window.
2. The preload bridge, in the isolated world, forwards that port to the main process with
   `ipcRenderer.postMessage`. It forwards only messages from the window itself (not iframes) on the
   expected channel.
3. `MainRpcServer` receives the port with `ipcMain.on(channel, …)`. Each port is one `effect/rpc`
   client connection. Frames are JSON strings.

Each `createClient` instance gets its own connection. `client.dispose()` closes it and interrupts
that renderer's in-flight handlers and streams. A defect in one handler fails only that call.

## Security

- **`contextIsolation: true`** is required (it is Electron's default). The page cannot reach
  `ipcRenderer`, and nothing is exposed through `contextBridge`.
- **Sandboxed preloads** cannot `require` npm packages: bundle the preload script. The bridge has no
  dependencies.
- **Any script in the page can open a connection**, as any script can call an HTTP endpoint. Treat
  procedures as a public API: validate with schemas, authorize in middleware.
- **Who is calling.** The server sets the `senderIdHeader` (`"x-effect-trpc-sender-id"`) to the
  renderer's `webContents.id`, replacing whatever the renderer sent. Read it with
  `MainRpcServer.senderId(headers)`, which also parses it:

<<< @/snippets/electron/sender.ts#sender

- **`authorize`** rejects connections, for example by origin (see `main.ts` above). The main process
  closes the ports of a rejected connection, and of one that transfers more than one port.
- **`channel`**: use a custom channel on all three sides to run several independent servers.

## Failure modes

| What happens                                                                    | Client sees                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| a handler dies                                                                  | `RpcDefect` for that call only                               |
| the main process closes the port, or `server.dispose()`                         | pending calls: `RpcTransportError`; later calls fail at once |
| no acknowledgement within `connectTimeout` (10s): missing bridge, wrong channel | `RpcTransportError` instead of hanging                       |

## Effect API and generic ports

<<< @/snippets/electron/sender.ts#layer

For utility processes, workers and custom handshakes, serve and call any `MessagePort`:

<<< @/snippets/electron/ports.ts

`MessagePortServer.make()` and `messagePortProtocolClient(port)` give the bare `effect/rpc`
protocols. All of these accept `serialization` (default JSON). Binary serializations send
`Uint8Array` frames.

See also: [`MainRpcServer`](/api/electron-main#mainrpcserver),
[`installPreloadBridge`](/api/electron-preload#installpreloadbridge),
[`rendererLink`](/api/electron-renderer#rendererlink),
[`MessagePortServer`](/api/electron#messageportserver).
