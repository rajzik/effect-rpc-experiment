// preload.ts — forwards MessagePorts from the page to the main process. Nothing else is exposed.
import { ipcRenderer } from 'electron';
import { installPreloadBridge } from '@effect-trpc/electron/preload';

installPreloadBridge({ ipcRenderer });
