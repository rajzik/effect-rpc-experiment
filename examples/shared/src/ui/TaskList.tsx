'use client';
/**
 * The task list: an infinite query over `tasks.list`, a checkbox per task that toggles it and a
 * "Load more" button.
 */
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { RpcOptionsProxy } from '@effect-trpc/tanstack-react-query';
import type { ReactNode } from 'react';

import type { AppRouter, Task } from '../domain';
import { ErrorAlert } from './errors';
import { useHydrated } from './useHydrated';
import { formatDate } from './format';
import { taskListOptions } from './options';

/** Props of {@link TaskList}. */
export interface TaskListProps {
  readonly rpc: RpcOptionsProxy<AppRouter>;
  /** Renders the link to a task's page, so each framework can use its own router link. */
  readonly renderLink?: (task: Task, label: string, children: ReactNode) => ReactNode;
}

const defaultLink = (task: Task, label: string, children: ReactNode): ReactNode => (
  <a href={`/tasks/${task.id}`} aria-label={label}>
    {children}
  </a>
);

/** `list` named "Tasks" with a row per task, plus "Load more" while more pages exist. */
export function TaskList({ rpc, renderLink = defaultLink }: TaskListProps) {
  const queryClient = useQueryClient();
  const hydrated = useHydrated();
  const tasks = useInfiniteQuery(taskListOptions(rpc));
  const toggle = useMutation(
    rpc.tasks.toggle.mutationOptions({
      onSuccess: (task) => {
        queryClient.setQueryData(rpc.tasks.byId.queryKey({ id: task.id }), task);
        return queryClient.invalidateQueries(rpc.tasks.list.pathFilter());
      },
    }),
  );
  const items = tasks.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section>
      <ul aria-label="Tasks" data-hydrated={hydrated}>
        {items.map((task) => (
          <li key={task.id}>
            <label>
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => toggle.mutate({ id: task.id })}
              />{' '}
              {task.title}
            </label>{' '}
            {task.isOverdue && <strong>Overdue</strong>} <span>Assigned to {task.assignee}</span>{' '}
            <span>Created {formatDate(task.createdAt)}</span>{' '}
            {task.dueAt !== undefined && <span>Due {formatDate(task.dueAt)}</span>}{' '}
            {renderLink(task, `Open ${task.title}`, 'Details')}
          </li>
        ))}
      </ul>
      {tasks.isPending && <p>Loading tasks…</p>}
      {tasks.hasNextPage && (
        <button
          type="button"
          disabled={tasks.isFetchingNextPage}
          onClick={() => void tasks.fetchNextPage()}
        >
          Load more
        </button>
      )}
      <ErrorAlert error={tasks.error ?? toggle.error} />
    </section>
  );
}
