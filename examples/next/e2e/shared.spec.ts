import { httpBoards, sharedScenarios, type Boards } from '@effect-trpc-examples/shared/e2e';
import { test as base } from '@playwright/test';

const test = base.extend<{ boards: Boards }>({
  boards: async ({ browser, baseURL }, use) => {
    const web = httpBoards(browser, baseURL!);
    await use(web.boards);
    await web.dispose();
  },
});

sharedScenarios(test, { reset: 'http://localhost:3200/api/rpc' });
