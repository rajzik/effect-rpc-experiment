// Server-only: read in `make`; the generated client module must never import this.
import { Context } from 'effect';
import type { Effect } from 'effect';

import type { Post, PostNotFound } from './models.js';

export class Database extends Context.Service<
  Database,
  {
    readonly find: (id: number) => Effect.Effect<Post, PostNotFound>;
    readonly count: Effect.Effect<number>;
  }
>()('Database') {}
