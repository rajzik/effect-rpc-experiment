import { httpAdapter, resetData, TaskBoardPage } from '@effect-trpc-examples/shared/e2e';

import { expect, rpcUrl, test } from './fixtures';

test.beforeEach(async () => {
  await resetData(rpcUrl);
});

test('SSR HTML for /tasks/1 contains the title (JS disabled)', async ({ request }) => {
  // The raw response of the server, before any script runs.
  const response = await request.get('/tasks/1');
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('Draft the launch plan');
});

test('SSR of /tasks/999 shows "Task #999 not found" after hydration (typed error survived)', async ({
  page,
  baseURL,
}) => {
  const board = new TaskBoardPage(page, httpAdapter(page, baseURL!));
  await board.gotoTask(999);
  await board.expectAlert('Task #999 not found');
});

test('client navigation from list to task issues POST /api/rpc', async ({ page, baseURL }) => {
  const board = new TaskBoardPage(page, httpAdapter(page, baseURL!));
  await board.gotoList();
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.isNavigationRequest()) documents.push(request.url());
  });
  // Opening the task in the browser is a client navigation: the loader calls the rpc endpoint.
  const call = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      /^\/api\/rpc\/?$/.test(new URL(request.url()).pathname) &&
      (request.postData() ?? '').includes('tasks.byId'),
  );
  await page.getByRole('link', { name: 'Open Publish the release notes' }).click();
  await call;
  await expect(page.getByRole('heading', { name: 'Publish the release notes' })).toBeVisible();
  await expect(page).toHaveURL(new URL('/tasks/12', baseURL).href);
  expect(documents).toEqual([]);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('SSR shows "Signed in as ada"', async ({ page, baseURL }) => {
    // The sign-in route sets the session cookie and redirects to the list.
    await page.goto('/sign-in?user=ada');
    await expect(page).toHaveURL(new URL('/', baseURL).href);
    // With JavaScript off, the page is exactly what the server rendered: the cookie reached
    // `Auth` through the route loader.
    const text = await page.locator('body').innerText();
    expect(text).toContain('Signed in as ada');
    expect(text).toContain('Publish the release notes');
  });
});
