import { taskDetailOptions } from '@rpc-effect-examples/shared/ui';

import { getQueryClient, HydrateClient, rpc } from '@/trpc/server';

import { TaskView } from '../../board';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  await getQueryClient().prefetchQuery(taskDetailOptions(rpc, id));
  return (
    <HydrateClient>
      <TaskView id={id} />
    </HydrateClient>
  );
}
