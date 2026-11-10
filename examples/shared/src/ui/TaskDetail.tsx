'use client';
/** One task's page: its details, or the typed error when it does not exist. */
import { useQuery } from '@tanstack/react-query';
import type { RpcOptionsProxy } from '@rpc-effect/tanstack-react-query';

import type { AppRouter } from '../domain';
import { ErrorAlert } from './errors';
import { useHydrated } from './useHydrated';
import { formatDate } from './format';
import { taskDetailOptions } from './options';

/** Props of {@link TaskDetail}. */
export interface TaskDetailProps {
  readonly rpc: RpcOptionsProxy<AppRouter>;
  readonly id: number;
}

/** A heading with the title, the details and `Overdue` when `task.isOverdue`. */
export function TaskDetail({ rpc, id }: TaskDetailProps) {
  const task = useQuery(taskDetailOptions(rpc, id));
  const hydrated = useHydrated();
  const { data } = task;
  return (
    <div data-hydrated={hydrated}>
      {task.error !== null && <ErrorAlert error={task.error} />}
      {task.error === null && data === undefined && <p>Loading task…</p>}
      {data !== undefined && (
        <article>
          <h1>{data.title}</h1>
          {data.isOverdue && <strong>Overdue</strong>}
          <p>{data.done ? 'Done' : 'Open'}</p>
          <p>Assigned to {data.assignee}</p>
          <p>Created {formatDate(data.createdAt)}</p>
          {data.dueAt !== undefined && <p>Due {formatDate(data.dueAt)}</p>}
        </article>
      )}
    </div>
  );
}
