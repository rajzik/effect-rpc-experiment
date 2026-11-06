import type { Scope } from 'effect';
import { Layer } from 'effect';
import type { Effect } from 'effect';
import { describe, expectTypeOf, it } from 'vite-plus/test';
import { MainRpcServer, MessagePortServer } from '../src/index.js';
import type { IpcMainLike, RunningMainRpcServer } from '../src/index.js';
import { AppHandlers, AppRouter, plainRouter } from './service-fixtures.js';

declare const ipcMain: IpcMainLike;

describe('Electron with a router service (types)', () => {
  it('MainRpcServer accepts typeof Svc, like the Router.make equivalent', () => {
    expectTypeOf(MainRpcServer.run(AppRouter, { handlers: AppHandlers, ipcMain })).toEqualTypeOf<
      Promise<RunningMainRpcServer>
    >();
    expectTypeOf(MainRpcServer.layer(AppRouter, { handlers: AppHandlers, ipcMain })).toEqualTypeOf<
      Layer.Layer<never>
    >();
    // Without handlers, the requirements are those of the equivalent router.
    expectTypeOf(MainRpcServer.layer(AppRouter, { ipcMain })).toEqualTypeOf(
      MainRpcServer.layer(plainRouter, { ipcMain }),
    );
    expectTypeOf(MainRpcServer.make(AppRouter, { ipcMain })).toEqualTypeOf(
      MainRpcServer.make(plainRouter, { ipcMain }),
    );
    expectTypeOf(MainRpcServer.make(AppRouter, { handlers: AppHandlers, ipcMain })).toEqualTypeOf<
      Effect.Effect<void, never, Scope.Scope>
    >();
    // @ts-expect-error - the handlers of the service's procedures are required
    void MainRpcServer.run(AppRouter, { handlers: Layer.empty, ipcMain });
  });

  it('MessagePortServer.serve accepts typeof Svc', () => {
    expectTypeOf(MessagePortServer.serve(AppRouter)).toEqualTypeOf(
      MessagePortServer.serve(plainRouter),
    );
    expectTypeOf(MessagePortServer.serve(AppRouter, { handlers: AppHandlers })).toEqualTypeOf<
      Effect.Effect<MessagePortServer, never, Scope.Scope>
    >();
  });
});
