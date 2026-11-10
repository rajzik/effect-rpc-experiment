import { ipcMain } from 'electron';
import { Effect, Layer, Schema } from 'effect';
import { query, Router } from '@rpc-effect/core';
import { Handlers } from '@rpc-effect/server';
import { MainRpcServer } from '@rpc-effect/electron/main';

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
