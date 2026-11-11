// Three nested routers, each with a different schema named `Input`.
import { Router } from '@rpc-effect/core';

import { ARouter } from './a.js';
import { BRouter } from './b.js';
import { CRouter } from './c.js';

export const AppRouter = Router.make({ a: ARouter, b: BRouter, c: CRouter });
