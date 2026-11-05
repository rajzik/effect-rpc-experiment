import { useQueryClient } from '@tanstack/react-query';
import { skipToken } from '@tanstack/react-query';
import { useSubscription } from '@effect-trpc/tanstack-react-query';

import { rpc as staticRpc } from './no-context';
import { useRpc } from './rpc';

// #region hook
export function LatestPost({ live }: { live: boolean }) {
  const rpc = useRpc();
  const queryClient = useQueryClient();
  const sub = useSubscription(
    rpc.post.onCreated.subscriptionOptions(live ? undefined : skipToken, {
      onData: (post) => queryClient.setQueryData(rpc.post.byId.queryKey({ id: post.id }), post),
      onError: (error) => console.error(error._tag),
    }),
  );
  // sub.status: 'idle' | 'connecting' | 'pending' | 'error'; sub.data: the last element
  switch (sub.status) {
    case 'idle':
      return <p>Paused</p>;
    case 'error':
      return <button onClick={() => sub.reset()}>Retry ({sub.error.message})</button>;
    default:
      return <p>Latest: {sub.data?.title ?? 'waiting…'}</p>;
  }
}
// #endregion hook

// #region imperative
// Outside React: subscribe() returns an unsubscribe function.
const controller = new AbortController();
const unsubscribe = staticRpc.post.onCreated.subscriptionOptions(undefined).subscribe({
  onData: (post) => console.log(post.title),
  signal: controller.signal,
});
unsubscribe(); // or controller.abort()
// #endregion imperative
