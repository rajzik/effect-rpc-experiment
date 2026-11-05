/**
 * `sharedScenarios`: the user-visible scenarios every example app must pass, registered on the
 * app's Playwright `test`.
 *
 * The app provides the `boards` fixture (see `httpBoards`) and says how to reset its data; the
 * scenarios do the rest through `TaskBoardPage`. The app's list page must render `SignedInAs`,
 * `NewTaskForm`, `LiveFeed` and `TaskList`; its task page a `TaskDetail`.
 */
import { expect, type TestType } from '@playwright/test';

import { seedTasks } from '../seed';
import type { Boards } from './boards';
import { resetData } from './reset';

/** What differs per app. */
export interface SharedScenarioOptions {
  /** How to reset the server's data before each test; see {@link resetData}. */
  readonly reset: string | (() => Promise<unknown>);
}

/** Seed tasks, newest first: what the list shows from the top. */
const seed = seedTasks().toReversed();
const newest = seed[0]?.title ?? '';
const overdue = seedTasks().find((task) => task.isOverdue);

/**
 * Registers the scenarios on `test`, which must provide the `boards` fixture:
 *
 * 1. a signed-in user sees the task list, with dates decoded from the wire;
 * 2. a task page shows the task; a missing id shows `Task #<id> not found`;
 * 3. a guest creating a task gets `Forbidden`; a member's task appears without reload;
 * 4. an empty title shows `ValidationFailed`;
 * 5. a toggle in one window shows up live in another, while the subscription stays open;
 * 6. `Load more` appends the next pages;
 * 7. isolation: data created by one test is gone in the next.
 */
export const sharedScenarios = <
  TestArgs extends { readonly boards: Boards },
  WorkerArgs extends object,
>(
  test: TestType<TestArgs, WorkerArgs>,
  options: SharedScenarioOptions,
): void => {
  test.describe('task board', () => {
    test.beforeEach(async () => {
      await resetData(options.reset);
    });

    test('1. a signed-in user sees the task list with real dates', async ({ boards }) => {
      const ada = await boards.open('ada');
      await ada.gotoList();
      await ada.expectSignedInAs('ada');
      await expect(ada.rows).toHaveCount(5);
      await expect(ada.row(newest)).toContainText('Created 2026-01-12');
      await expect(ada.row(overdue?.title ?? '')).toContainText('Overdue');
    });

    test('2. a task page shows the task, a missing id shows the typed error', async ({
      boards,
    }) => {
      const ada = await boards.open('ada');
      await ada.gotoTask(12);
      await expect(ada.page.getByRole('heading', { name: newest })).toBeVisible();
      await ada.gotoTask(999);
      await ada.expectAlert('Task #999 not found');
    });

    test('3. a guest cannot create a task, a member can without a reload', async ({ boards }) => {
      const guest = await boards.open('guest');
      await guest.gotoList();
      await guest.createTask('Guest task');
      await guest.expectAlert('Forbidden: guests cannot write');
      await expect(guest.row('Guest task')).toHaveCount(0);

      const ada = await boards.open('ada');
      await ada.gotoList();
      await ada.createTask('Ship the examples');
      await expect(ada.row('Ship the examples')).toBeVisible();
      await expect(ada.page.getByRole('textbox', { name: 'Title' })).toHaveValue('');
    });

    test('4. an empty title shows the validation error', async ({ boards }) => {
      const ada = await boards.open('ada');
      await ada.gotoList();
      await ada.createTask('   ');
      await ada.expectAlert('Title: must not be empty');
    });

    test('5. a toggle in one window shows up live in another', async ({ boards }) => {
      const observer = await boards.open('guest');
      const actor = await boards.open('ada');
      await observer.gotoList();
      await actor.gotoList();
      // The subscription attaches after the page rendered and a change before that is not
      // replayed, so toggle until the observer shows it. A transport that buffers the stream until
      // it ends never delivers: this fails after the timeout.
      await expect(async () => {
        await actor.toggle(newest);
        await observer.expectLive(newest, 2_000);
      }).toPass({ timeout: 15_000 });
    });

    test('6. load more appends the next page', async ({ boards }) => {
      const ada = await boards.open('ada');
      await ada.gotoList();
      await expect(ada.rows).toHaveCount(5);
      await expect(ada.row(seed[5]?.title ?? '')).toHaveCount(0);
      await ada.loadMore();
      await expect(ada.rows).toHaveCount(10);
      await expect(ada.row(seed[5]?.title ?? '')).toBeVisible();
      await ada.loadMore();
      await expect(ada.rows).toHaveCount(12);
      await expect(ada.page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
    });

    test.describe('7. isolation', () => {
      test.describe.configure({ mode: 'serial' });

      test('a test creates a task', async ({ boards }) => {
        const ada = await boards.open('ada');
        await ada.gotoList();
        await ada.createTask('Leaked task');
        await expect(ada.row('Leaked task')).toBeVisible();
      });

      test('the next test sees the seed data only', async ({ boards }) => {
        const ada = await boards.open('ada');
        await ada.gotoList();
        await expect(ada.rows.first()).toContainText(newest);
        await expect(ada.row('Leaked task')).toHaveCount(0);
      });
    });
  });
};
