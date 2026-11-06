# Electron example

The task board in Electron with `@effect-trpc/electron`: the server runs in the main process, each
window is a client connected over its own `MessagePort`. There are no cookies: the main process
opens one window per user (`ada`, then `guest`) and maps each window's `webContents.id` to its
user, which `MainRpcServer.senderId(headers)` reads in `resolveUser`.

## What it demonstrates

- **`MainRpcServer.run`** in `src/main.ts`, with `authorize` accepting only frames served from the
  renderer bundle.
- **A sandboxed preload** (`src/preload.ts`, bundled to a single CJS file) that only calls
  `installPreloadBridge`; nothing is exposed on `window`. `contextIsolation` and `sandbox` are on.
- **`rendererLink()`** in the renderer (`src/renderer/main.tsx`, a Vite app with hash routing) plus
  `@effect-trpc-examples/shared/ui`.
- **Connection lifecycle**: closing or destroying a window ends its server-side subscription.

## Files worth reading

`src/main.ts`, `src/preload.ts`, `src/renderer/main.tsx`, `vite.config.ts` (`vp pack` for main and
preload, Vite for the renderer), `e2e/fixtures.ts`, `e2e/electron.spec.ts`.

## Run

```sh
pnpm -C examples/electron example:build   # rm -rf dist, vp pack, vp build
pnpm -C examples/electron example:start   # electron . (two windows)
pnpm -C examples/electron example:test    # builds, then Playwright _electron
```

The suite launches the built files; with `EXAMPLES_TEST=1` the windows are hidden and a main-process
hook resets the data. The Electron binary downloads on first launch (it has no postinstall): fetch
it up front with `pnpm -C examples/electron exec install-electron`. On Linux a display is needed
(`xvfb-run -a`), and the renderer sandbox needs the `chrome-sandbox` helper to be setuid root;
without it the fixtures pass `--no-sandbox` in CI (or when `EXAMPLES_ELECTRON_NO_SANDBOX=1`) and the
test that checks the OS sandbox records a visible annotation instead of asserting. Electron reports
process sandboxing only on macOS and Windows.
