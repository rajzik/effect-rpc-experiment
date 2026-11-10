/**
 * The preload script: forwards the `MessagePort` a renderer opens to the main process. It exposes
 * nothing to the page (no `contextBridge`), runs sandboxed and is bundled into one file.
 */
import { installPreloadBridge } from '@rpc-effect/electron/preload';
import { ipcRenderer } from 'electron';

installPreloadBridge({ ipcRenderer });
