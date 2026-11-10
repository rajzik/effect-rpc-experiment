import { TaskDetail, taskDetailOptions } from '@rpc-effect-examples/shared/ui';
import { createFileRoute, Link } from '@tanstack/react-router';

import { rpc, useRpc } from '../rpc/client';

export const Route = createFileRoute('/tasks/$id')({
  // `prefetchQuery` never throws: a missing task is dehydrated with its encoded error, so it
  // reaches the component as a `TaskNotFound` instance (a thrown loader error would go through
  // Start's serializer and lose its class).
  loader: async ({ context, params }) => {
    await context.queryClient.prefetchQuery(
      taskDetailOptions(rpc(context.queryClient), Number(params.id)),
    );
  },
  component: TaskPage,
});

function TaskPage() {
  const { id } = Route.useParams();
  return (
    <main>
      <TaskDetail rpc={useRpc()} id={Number(id)} />
      <Link to="/">Back to the list</Link>
    </main>
  );
}
