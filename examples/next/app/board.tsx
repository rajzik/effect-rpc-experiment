'use client';
import {
  LiveFeed,
  NewTaskForm,
  SignedInAs,
  TaskDetail,
  TaskList,
} from '@rpc-effect-examples/shared/ui';
import { appRouter } from '@rpc-effect-examples/shared';
import { useServerAction } from '@rpc-effect/next';
import Link from 'next/link';

import { useRpc } from '@/trpc/client';

import { createTask } from './actions';

/** The list page: the shared components over this app's rpc client; tasks are created by a server action. */
export function Board() {
  const rpc = useRpc();
  const create = useServerAction(createTask, { router: appRouter, path: 'tasks.create' });
  return (
    <main>
      <h1>Tasks</h1>
      <SignedInAs rpc={rpc} />
      <LiveFeed rpc={rpc} />
      <NewTaskForm rpc={rpc} submit={(title) => create.run({ title })} />
      <TaskList
        rpc={rpc}
        renderLink={(task, label, children) => (
          <Link href={`/tasks/${task.id}`} aria-label={label}>
            {children}
          </Link>
        )}
      />
    </main>
  );
}

/** The task page. */
export function TaskView({ id }: { id: number }) {
  const rpc = useRpc();
  return (
    <main>
      <TaskDetail rpc={rpc} id={id} />
      <Link href="/">Back to the list</Link>
    </main>
  );
}
