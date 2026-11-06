import { ipcMain } from 'electron';
import { Effect, Layer, Schema } from 'effect';
import { query, Router } from '@effect-trpc/core';
import { Handlers } from '@effect-trpc/server';
import { MainRpcServer } from '@effect-trpc/electron/main';

// #region sender
const router = Router.make({ whoami: query({ success: Schema.NullOr(Schema.Finite) }) });

// MainRpcServer sets the sender header to the renderer's webContents.id. The page cannot spoof
// it: the server replaces whatever the renderer sent.
const HandlersLive = Handlers.make(router, {
  whoami: (_, { headers }) => Effect.succeed(MainRpcServer.senderId(headers) ?? null),
});
// #endregion sender

// #region layer
// In an Effect application: a Layer instead of a Promise.
const MainLive = MainRpcServer.layer(router, { handlers: HandlersLive, ipcMain });
// Layer.launch(MainLive) …
// #endregion layer

void [MainLive, Layer];
