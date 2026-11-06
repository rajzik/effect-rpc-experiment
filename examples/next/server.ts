/** Server-only: the handlers, with the session read from the `session` cookie. */
// oxlint-disable-next-line import/no-unassigned-import -- Next's marker: bundling this into client code fails the build
import 'server-only';
import { cookieUser, makeServerLive } from '@effect-trpc-examples/shared/server';

export const ServerLive = makeServerLive({ resolveUser: cookieUser });
