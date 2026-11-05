/**
 * The seed data: the tasks every fresh store (and every `testing.reset`) starts from. Plain data
 * with no server state, so the Playwright scenarios import it to know what to expect.
 */
import { Task } from './domain';

const titles = [
  'Draft the launch plan',
  'Review open pull requests',
  'Write the changelog',
  'Triage the bug backlog',
  'Update the onboarding guide',
  'Plan the team offsite',
  'Audit npm dependencies',
  'Prepare the demo script',
  'Renew the TLS certificate',
  'Archive old tickets',
  'Record the walkthrough video',
  'Publish the release notes',
];

/** The id of the one overdue seed task. */
export const OVERDUE_TASK_ID = 9;

/** Twelve tasks, ids 1 to 12: the first two done, task 9 overdue. */
export const seedTasks = (): ReadonlyArray<Task> =>
  titles.map((title, index) => {
    const id = index + 1;
    return new Task({
      id,
      title,
      done: id <= 2,
      assignee: id % 2 === 0 ? 'ada' : 'grace',
      createdAt: new Date(Date.UTC(2026, 0, id)),
      dueAt:
        id === OVERDUE_TASK_ID
          ? new Date(Date.UTC(2020, 0, 1))
          : id % 3 === 0
            ? new Date(Date.UTC(2099, 0, 1))
            : undefined,
    });
  });
