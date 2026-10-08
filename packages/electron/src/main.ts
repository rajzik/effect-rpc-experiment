// Main-process entry: `import { MainRpcServer } from '@effect-trpc/electron/main'`.
export {
  MainRpcServer,
  senderIdHeader,
  type MainRpcServerOptions,
  type MainRpcServerRunOptions,
  type RunningMainRpcServer,
} from './MainRpcServer.js';
export {
  MessagePortServer,
  type AttachOptions,
  type MessagePortServerOptions,
  type ServeOptions,
} from './MessagePortServer.js';
export {
  defaultChannel,
  type Frame,
  type AnyPort,
  type IpcMainEventLike,
  type IpcMainLike,
  type IpcMainListener,
  type MessageEventLike,
  type PortListener,
  type PortLike,
  type PortMainLike,
} from './types.js';
