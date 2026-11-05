import {
  failOnConsoleErrors,
  httpAdapter,
  resetData,
  TaskBoardPage,
} from '@effect-trpc-examples/shared/e2e';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ baseURL }) => {
  await resetData(new URL('/api/rpc', baseURL).href);
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
});

test('the sign-in route sets an httpOnly session cookie', async ({ page, context }) => {
  const errors = failOnConsoleErrors(page);
  await page.goto('/sign-in?user=grace');
  await expect(page.getByText('Signed in as grace')).toBeVisible();
  expect(await context.cookies()).toContainEqual(
    expect.objectContaining({ name: 'session', value: 'grace', httpOnly: true, path: '/' }),
  );
  errors.assertNone();
});

test('task page hydrates to a class: "Overdue" visible after hydration', async ({
  page,
  baseURL,
}) => {
  const errors = failOnConsoleErrors(page);
  const board = new TaskBoardPage(page, httpAdapter(page, baseURL!));
  await board.signIn('ada');
  // Task 9 is the seed's overdue task; `isOverdue` is a getter that only exists on a decoded
  // `Task` instance, so it shows up only if the dehydrated cache was revived into the class.
  await board.gotoTask(9);
  await expect(page.getByRole('heading', { name: 'Renew the TLS certificate' })).toBeVisible();
  await expect(page.getByText('Overdue')).toBeVisible();
  errors.assertNone();
});

test('server action as guest shows "Forbidden: guests cannot write"', async ({ page, baseURL }) => {
  const errors = failOnConsoleErrors(page);
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
  errors.assertNone();
});

test('GET /api/rpc → 405 with Allow: POST', async ({ request }) => {
  const response = await request.get('/api/rpc');
  expect(response.status()).toBe(405);
  expect(response.headers()['allow']).toBe('POST');
});
