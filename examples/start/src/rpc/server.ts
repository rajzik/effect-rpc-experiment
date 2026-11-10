/**
 * Server-only: the handlers, with the session read from the `session` cookie.
 *
 * Not `src/server.ts`: Start treats that path as the custom server entry.
 */
import { cookieUser, makeServerLive } from '@rpc-effect-examples/shared/server';

export const ServerLive = makeServerLive({ resolveUser: cookieUser });
