// A handler whose result keeps an unresolved type parameter: there is no schema for it.
import { Effect } from 'effect';
import { Procedure, Router } from '@rpc-effect/core';
import type { Tree } from './models.js';

declare const tree: <T>() => Tree<T>;

export const AppRouter = Router.make({
  generic: Procedure.query(<T>() => Effect.succeed(tree<T>())),
});
