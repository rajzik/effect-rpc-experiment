// The annotation key and middleware of the annotated router.
import { Context } from 'effect';
import { RpcMiddleware } from 'effect/rpc';

export const Roles = Context.Reference<ReadonlyArray<string>>('Roles', { defaultValue: () => [] });

export class Log extends RpcMiddleware.Service<Log>()('Log') {}
