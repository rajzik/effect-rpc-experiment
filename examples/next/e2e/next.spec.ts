import { httpAdapter, resetData, TaskBoardPage } from '@effect-trpc-examples/shared/e2e';

import { expect, rpcUrl, test } from './fixtures';

test.beforeEach(async () => {
  await resetData(rpcUrl);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('SSR HTML contains task titles and "Signed in as ada" (request with JS disabled)', async ({
    page,
    baseURL,
  }) => {
    // The sign-in route sets the session cookie and redirects to the list.
    await page.goto('/sign-in?user=ada');
    await expect(page).toHaveURL(new URL('/', baseURL).href);
    // With JavaScript off, the page is exactly what the server rendered.
    const text = await page.locator('body').innerText();
    expect(text).toContain('Signed in as ada');
    expect(text).toContain('Publish the release notes');
    expect(text).toContain('Renew the TLS certificate');
  });

  test('/tasks/999 is server-rendered with "Task #999 not found" (not the loading state)', async ({
    page,
  }) => {
    await page.goto('/tasks/999');
    // With JavaScript off, the page is exactly what the server rendered: the errored query that
    // the page prefetched must render as its typed error, not as "Loading task…".
    const text = await page.locator('body').innerText();
    expect(text).toContain('Task #999 not found');
    expect(text).not.toContain('Loading task');
  });
});

test('the sign-in route sets an httpOnly session cookie', async ({ page, context }) => {
  await page.goto('/sign-in?user=grace');
  await expect(page.getByText('Signed in as grace')).toBeVisible();
  expect(await context.cookies()).toContainEqual(
    expect.objectContaining({ name: 'session', value: 'grace', httpOnly: true, path: '/' }),
  );
});

test('task page hydrates to a class: "Overdue" visible after hydration', async ({
  page,
  baseURL,
}) => {
  const board = new TaskBoardPage(page, httpAdapter(page, baseURL!));
  await board.signIn('ada');
  // Task 9 is the seed's overdue task; `isOverdue` is a getter that only exists on a decoded
  // `Task` instance, so it shows up only if the dehydrated cache was revived into the class.
  await board.gotoTask(9);
  await expect(page.getByRole('heading', { name: 'Renew the TLS certificate' })).toBeVisible();
  await expect(page.getByText('Overdue')).toBeVisible();
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

test('server action as guest shows "Forbidden: guests cannot write"', async ({ page, baseURL }) => {
  const board = new TaskBoardPage(page, httpAdapter(page, baseURL!));
  await board.signIn('guest');
  await board.gotoList();
  // The form posts a Next server action, not an rpc call.
  const action = page.waitForRequest(
    (request) => request.method() === 'POST' && request.headers()['next-action'] !== undefined,
  );
  await board.createTask('Guest attempt');
  await action;
  await board.expectAlert('Forbidden: guests cannot write');
});

test('GET /api/rpc → 405 with Allow: POST', async ({ request }) => {
  const response = await request.get('/api/rpc');
  expect(response.status()).toBe(405);
  expect(response.headers()['allow']).toBe('POST');
});
