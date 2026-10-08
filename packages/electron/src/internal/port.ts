import type { AnyPort, Frame, MessageEventLike, PortLike } from '../types.js';

/**
 * Frame sent (as a raw string, outside the rpc serialization) by either side right before it
 * closes its port, so the peer learns about the shutdown even where the platform does not emit
 * a `close` event (e.g. a renderer `MessagePort` whose peer was closed in the main process).
 */
export const closeFrame = '"@effect-trpc/electron/close"';

/** Frame the server sends when it attaches a port, so the client knows it is connected. */
export const readyFrame = '"@effect-trpc/electron/ready"';

const isWebPort = (port: AnyPort): port is PortLike =>
  typeof (port as Partial<PortLike>).addEventListener === 'function';

/**
 * Subscribes to the `message` and `close` events of a Web-style (`addEventListener`) or
 * EventEmitter-style (`on`, Electron `MessagePortMain`) port and starts it. Returns the
 * unsubscribe function. A received {@link closeFrame} is reported as `onClose`.
 */
export const listen = (
  port: AnyPort,
  onMessage: (data: unknown) => void,
  onClose: () => void,
): (() => void) => {
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    onClose();
  };
  const message = (event: unknown): void => {
    if (closed) return;
    const data = (event as MessageEventLike).data;
    if (data === closeFrame) close();
    else onMessage(data);
  };
  if (isWebPort(port)) {
    port.addEventListener('message', message);
    port.addEventListener('close', close);
    port.start();
    return () => {
      port.removeEventListener('message', message);
      port.removeEventListener('close', close);
    };
  }
  port.on('message', message);
  port.on('close', close);
  port.start();
  return () => {
    port.removeListener('message', message);
    port.removeListener('close', close);
  };
};

/** Posts a message, ignoring errors from an already closed / detached port. */
export const post = (port: AnyPort, data: Frame): void => {
  try {
    port.postMessage(data);
  } catch {
    // the peer is gone; the `close` handling fails pending calls
  }
};

/** Tells the peer we are closing (best effort), then closes the port. */
export const closePort = (port: AnyPort): void => {
  post(port, closeFrame);
  try {
    port.close();
  } catch {
    // already closed
  }
};
