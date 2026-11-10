import { sharedScenarios } from '@rpc-effect-examples/shared/e2e';

import { resetShared, sharedTest } from './fixtures';

// Window 1 is `ada`, window 2 is `guest`: signing in is choosing the window of that user.
sharedScenarios(sharedTest, { reset: resetShared });
