import { httpAdapter, resetData, TaskBoardPage } from '@rpc-effect-examples/shared/e2e';

import { expect, rpcUrl, test } from './fixtures';

test.beforeEach(async () => {
  await resetData(rpcUrl);
});

test('SSR HTML for /tasks/1 renders the title as a heading (JS disabled)', async ({ request }) => {
  // The raw response of the server, before any script runs. The title alone would also match the
  // dehydrated payload, so assert the rendered heading element.
  const response = await request.get('/tasks/1');
  expect(response.status()).toBe(200);
  expect(await response.text()).toMatch(/<h1[^>]*>Draft the launch plan<\/h1>/);
});

test('SSR payload of /tasks/999 carries the encoded TaskNotFound (dehydrated query cache)', async ({
  request,
}) => {
  // The failed query travels in the dehydrated cache of the page, encoded with the procedure's
  // error schema. That is what `hydration.routerOptions` and the awaited loader prefetch put there.
  const response = await request.get('/tasks/999');
  expect(response.status()).toBe(200);
  const html = await response.text();
  const literal = /queryState:("(?:[^"\\]|\\.)*")/.exec(html)?.[1];
  expect(literal, 'the page carries a dehydrated query cache').toBeDefined();
  const state: unknown = JSON.parse(JSON.parse(literal!));
  expect(state).toMatchObject({
    queries: [
      {
        queryKey: [['tasks', 'byId'], { input: { id: 999 }, type: 'query' }],
        state: {
          status: 'error',
          error: {
            _tag: 'Failure',
            cause: [{ _tag: 'Fail', error: { _tag: 'TaskNotFound', id: 999 } }],
          },
        },
      },
    ],
  });
});

test('/tasks/999 shows the typed error from the dehydrated cache, without a client refetch', async ({
  page,
  baseURL,
}) => {
  const byIdCalls: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && (request.postData() ?? '').includes('tasks.byId')) {
      byIdCalls.push(request.postData() ?? '');
    }
  });
  const board = new TaskBoardPage(page, httpAdapter(page, baseURL!));
  // Waits for hydration: a mount-time refetch would be issued by now.
  await board.gotoTask(999);
  await board.expectAlert('Task #999 not found');
  // The failed prefetch travelled in the dehydrated cache and was decoded there: the client never
  // asked the endpoint for the task again.
  expect(byIdCalls).toEqual([]);
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

  test('/tasks/999 is server-rendered with "Task #999 not found" (not the loading state)', async ({
    page,
  }) => {
    await page.goto('/tasks/999');
    // With JavaScript off, the page is exactly what the server rendered: the errored query that
    // the loader prefetched must render as its typed error, not as "Loading task…".
    const text = await page.locator('body').innerText();
    expect(text).toContain('Task #999 not found');
    expect(text).not.toContain('Loading task');
  });
});
