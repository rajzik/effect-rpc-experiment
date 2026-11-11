// Handlers that return concrete instantiations of a generic recursive type: the hoisted and
// suspended schema annotations must keep the type arguments (and import the named ones).
import { Effect } from 'effect';
import { Procedure, Router } from '@rpc-effect/core';
import type { Label, Tree } from './models.js';

const words: Tree<string> = {
  value: 'root',
  children: [{ value: 'child', children: [{ value: 'leaf', children: [] }] }],
};
const labels: Tree<Label> = {
  value: { text: 'root' },
  children: [{ value: { text: 'leaf' }, children: [] }],
};

export const AppRouter = Router.make({
  words: Procedure.query(() => Effect.succeed(words)),
  labels: Procedure.query(() => Effect.succeed(labels)),
});
