/**
 * `TaskBoardPage`: a page object over the task board's UI, written against accessible roles and
 * texts only, so the same object drives the web apps and the Electron window.
 *
 * Everything that differs per app (how a user signs in, how to reach the list and a task) is a
 * {@link TaskBoardAdapter}; `httpAdapter` covers the web apps. Every method waits for the visible
 * state it expects, never for a fixed time.
 */
import { expect, type Locator, type Page } from '@playwright/test';

/** What differs between the apps: signing in and reaching the two pages. */
export interface TaskBoardAdapter {
  /** Makes the next requests of this page belong to user `name`. */
  readonly signIn: (name: string) => Promise<void>;
  /** Opens the list page (task list, new-task form, live feed, signed-in-as). */
  readonly gotoList: () => Promise<void>;
  /** Opens the page of task `id` (a `TaskDetail`). */
  readonly gotoTask: (id: number) => Promise<void>;
}

/**
 * The adapter of the web apps: signs in with the cookie `session=<name>`, the list is `/` and a
 * task is `/tasks/<id>`. Spread it to override one member, e.g. `signIn` through a sign-in route.
 */
export const httpAdapter = (page: Page, baseURL: string): TaskBoardAdapter => ({
  signIn: async (name) => {
    await page.context().addCookies([{ name: 'session', value: name, url: baseURL }]);
  },
  gotoList: async () => {
    await page.goto(new URL('/', baseURL).href);
  },
  gotoTask: async (id) => {
    await page.goto(new URL(`/tasks/${id}`, baseURL).href);
  },
});

/** Drives the task board's UI. */
export class TaskBoardPage {
  readonly page: Page;
  readonly #adapter: TaskBoardAdapter;

  constructor(page: Page, adapter: TaskBoardAdapter) {
    this.page = page;
    this.#adapter = adapter;
  }

  /** The `Tasks` list. */
  get list(): Locator {
    return this.page.getByRole('list', { name: 'Tasks' });
  }

  /** One row per loaded task. */
  get rows(): Locator {
    return this.list.getByRole('listitem');
  }

  /** The row of the task titled `title` (its checkbox is named by the title). */
  row(title: string): Locator {
    return this.rows.filter({
      has: this.page.getByRole('checkbox', { name: title, exact: true }),
    });
  }

  /** Signs in as `name`; call before `gotoList` / `gotoTask`. */
  async signIn(name: string): Promise<void> {
    await this.#adapter.signIn(name);
  }

  /** The new-task form. */
  get form(): Locator {
    return this.page.locator('form[data-hydrated]');
  }

  /**
   * Waits until React has hydrated `target`: the components set `data-hydrated="true"` once they
   * are interactive. Server-rendered HTML is visible (and clickable) before that, but a click then
   * reaches no handler: a form would submit natively and a checkbox would flip without a call.
   */
  async #hydrated(target: Locator): Promise<void> {
    await expect(target).toHaveAttribute('data-hydrated', 'true');
  }

  /** Opens the list page and waits until its tasks rendered and its components are hydrated. */
  async gotoList(): Promise<void> {
    await this.#adapter.gotoList();
    await expect(this.rows.first()).toBeVisible();
    await this.#hydrated(this.list);
    await this.#hydrated(this.form);
    await this.#hydrated(this.page.locator('aside[data-hydrated]'));
  }

  /**
   * Opens the page of task `id` and waits until it is hydrated; wait for its content with
   * `expectAlert` or the page's text.
   */
  async gotoTask(id: number): Promise<void> {
    await this.#adapter.gotoTask(id);
    await this.#hydrated(this.page.locator('[data-hydrated]').first());
  }

  /** Types `title` into the form and presses `Create`; does not wait for the result. */
  async createTask(title: string): Promise<void> {
    await this.#hydrated(this.form);
    await this.page.getByRole('textbox', { name: 'Title' }).fill(title);
    await this.page.getByRole('button', { name: 'Create' }).click();
  }

  /**
   * Toggles the task titled `title` and waits until its checkbox shows the new state.
   *
   * The checkbox is controlled by the query data, so once hydrated it can only change after the
   * `tasks.toggle` call succeeded and the data was updated: the new state proves the server
   * committed the change. Hydration is awaited first, because before it a click would flip the
   * native checkbox without sending anything.
   */
  async toggle(title: string): Promise<void> {
    await this.#hydrated(this.list);
    const checkbox = this.row(title).getByRole('checkbox');
    const wasDone = await checkbox.isChecked();
    await checkbox.click();
    await expect(checkbox).toBeChecked({ checked: !wasDone });
  }

  /** Presses `Load more` and waits until more rows are shown. */
  async loadMore(): Promise<void> {
    await this.#hydrated(this.list);
    const before = await this.rows.count();
    await this.page.getByRole('button', { name: 'Load more' }).click();
    await expect.poll(async () => await this.rows.count()).toBeGreaterThan(before);
  }

  /** Waits for an alert containing `text` (typed errors render as alerts). */
  async expectAlert(text: string): Promise<void> {
    // Filter instead of `getByRole('alert', { name })`: frameworks add their own empty alerts
    // (Next.js' route announcer) which must not make the locator ambiguous.
    await expect(this.page.getByRole('alert').filter({ hasText: text })).toBeVisible();
  }

  /** Waits for `Signed in as <name>`. */
  async expectSignedInAs(name: string): Promise<void> {
    await expect(this.page.getByText(`Signed in as ${name}`)).toBeVisible();
  }

  /** Waits for the live feed to show `Live: <title>` (default: within 5 seconds). */
  async expectLive(title: string, timeout = 5_000): Promise<void> {
    await expect(this.page.getByRole('status').filter({ hasText: `Live: ${title}` })).toBeVisible({
      timeout,
    });
  }
}
