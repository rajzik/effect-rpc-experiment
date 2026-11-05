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

  /** Opens the list page and waits for the first tasks to render. */
  async gotoList(): Promise<void> {
    await this.#adapter.gotoList();
    await expect(this.rows.first()).toBeVisible();
  }

  /** Opens the page of task `id`; wait for its content with `expectAlert` or the page's text. */
  async gotoTask(id: number): Promise<void> {
    await this.#adapter.gotoTask(id);
  }

  /** Types `title` into the form and presses `Create`; does not wait for the result. */
  async createTask(title: string): Promise<void> {
    await this.page.getByRole('textbox', { name: 'Title' }).fill(title);
    await this.page.getByRole('button', { name: 'Create' }).click();
  }

  /** Toggles the task titled `title` and waits until its checkbox shows the new state. */
  async toggle(title: string): Promise<void> {
    const checkbox = this.row(title).getByRole('checkbox');
    const wasDone = await checkbox.isChecked();
    await checkbox.click();
    await expect(checkbox).toBeChecked({ checked: !wasDone });
  }

  /** Presses `Load more` and waits until more rows are shown. */
  async loadMore(): Promise<void> {
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
