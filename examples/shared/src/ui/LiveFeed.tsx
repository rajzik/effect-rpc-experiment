'use client';
/** The live feed: subscribes to `tasks.onChanged` and shows the latest change. */
import { useQueryClient } from '@tanstack/react-query';
import { useSubscription, type RpcOptionsProxy } from '@rpc-effect/tanstack-react-query';

import type { AppRouter } from '../domain';
import { useHydrated } from './useHydrated';

/** Props of {@link LiveFeed}. */
export interface LiveFeedProps {
  readonly rpc: RpcOptionsProxy<AppRouter>;
}

/**
 * A `status` reading `Live: <title>` after each change another client (or this one) makes; every
 * change also refreshes the task list.
 */
export function LiveFeed({ rpc }: LiveFeedProps) {
  const queryClient = useQueryClient();
  const hydrated = useHydrated();
  const live = useSubscription(
    rpc.tasks.onChanged.subscriptionOptions(undefined, {
      onData: (task) => {
        queryClient.setQueryData(rpc.tasks.byId.queryKey({ id: task.id }), task);
        void queryClient.invalidateQueries(rpc.tasks.list.pathFilter());
      },
    }),
  );
  return (
    <aside data-hydrated={hydrated}>
      <p role="status">
        {live.data === undefined ? 'Waiting for changes' : `Live: ${live.data.title}`}
      </p>
    </aside>
  );
}
