// A third schema named `Input`, imported by c.ts, and `Schema` re-exported for b.ts.
import { Schema } from 'effect';

export { Schema };

export const Input = Schema.Struct({ flag: Schema.Boolean });
