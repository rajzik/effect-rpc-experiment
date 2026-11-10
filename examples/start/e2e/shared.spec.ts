import { sharedScenarios } from '@rpc-effect-examples/shared/e2e';

import { rpcUrl, test } from './fixtures';

sharedScenarios(test, { reset: rpcUrl });
