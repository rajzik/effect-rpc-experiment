import {
  LiveFeed,
  NewTaskForm,
  sessionOptions,
  SignedInAs,
  taskListOptions,
  TaskList,
} from '@effect-trpc-examples/shared/ui';
import { createFileRoute, Link } from '@tanstack/react-router';

import { rpc, useRpc } from '../rpc/client';

export const Route = createFileRoute('/')({
  // Awaited, so the server-rendered HTML already contains the user and the tasks. The loader runs
  // in-process on the server (with the request's cookie) and over `/api/rpc` on client navigation.
  loader: async ({ context }) => {
    const api = rpc(context.queryClient);
    await Promise.all([
      context.queryClient.prefetchQuery(sessionOptions(api)),
      context.queryClient.prefetchInfiniteQuery(taskListOptions(api)),
    ]);
  },
  component: Board,
});

function Board() {
  const rpcOptions = useRpc();
  return (
    <main>
      <h1>Tasks</h1>
      <SignedInAs rpc={rpcOptions} />
      <LiveFeed rpc={rpcOptions} />
      <NewTaskForm rpc={rpcOptions} />
      <TaskList
        rpc={rpcOptions}
        renderLink={(task, label, children) => (
          <Link to="/tasks/$id" params={{ id: String(task.id) }} aria-label={label}>
            {children}
          </Link>
        )}
      />
    </main>
  );
}
