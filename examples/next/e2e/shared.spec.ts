import { sharedScenarios } from '@effect-trpc-examples/shared/e2e';

import { rpcUrl, test } from './fixtures';

sharedScenarios(test, { reset: rpcUrl });
