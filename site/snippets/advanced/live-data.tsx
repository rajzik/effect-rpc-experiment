// Live data: one WebSocket for every call and subscription, with connection state in the UI.
import { createServer } from 'node:http';
import { useQueryClient } from '@tanstack/react-query';
import { Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { NodeHttpServer } from '@effect/platform-node';
import { createClient, wsLink } from '@effect-trpc/client';
import { layerHttp } from '@effect-trpc/server';
import { useSubscription, type RpcConnectionState } from '@effect-trpc/tanstack-react-query';
import { useState } from 'react';

import { appRouter, type PostNotFound } from '@/router';
import { ServerLive } from '@/server';

import { useRpc } from '../react-query/rpc';

// #region server
// server.ts: a WebSocket endpoint next to the HTTP one.
export const Server = HttpRouter.serve(
  Layer.mergeAll(
    layerHttp(appRouter, { handlers: ServerLive, path: '/rpc' }),
    layerHttp(appRouter, { handlers: ServerLive, path: '/ws', protocol: 'websocket' }),
  ),
).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 })));
// #endregion server

// #region client
// Queries, mutations and subscriptions all share the socket.
export const client = createClient(appRouter, {
  link: wsLink({ url: 'ws://localhost:3000/ws', retryTransientErrors: true }),
});
// #endregion client

// #region component
export function LiveFeed() {
  const rpc = useRpc();
  const queryClient = useQueryClient();
  const [connection, setConnection] = useState<RpcConnectionState<unknown>['state']>('idle');
  const sub = useSubscription(
    rpc.post.onCreated.subscriptionOptions(undefined, {
      onConnectionStateChange: ({ state }) => setConnection(state),
      onData: (post) => {
        // Seed the detail query and refresh the list.
        queryClient.setQueryData(rpc.post.byId.queryKey({ id: post.id }), post);
        void queryClient.invalidateQueries(rpc.post.list.pathFilter());
      },
    }),
  );
  return (
    <aside>
      <span data-state={connection}>{connection}</span>
      {sub.status === 'error' && <button onClick={() => sub.reset()}>Reconnect</button>}
      <p>Latest: {sub.data?.title ?? '—'}</p>
    </aside>
  );
}
// #endregion component

export type _ = PostNotFound;
