/**
 * The renderer: the task board as a single page, routed by `location.hash` (`#/` is the list,
 * `#/tasks/<id>` a task), talking to the main process through `rendererLink`.
 */
import { appRouter } from '@effect-trpc-examples/shared';
import {
  LiveFeed,
  NewTaskForm,
  SignedInAs,
  TaskDetail,
  TaskList,
} from '@effect-trpc-examples/shared/ui';
import { createClient } from '@effect-trpc/client';
import { rendererLink } from '@effect-trpc/electron/renderer';
import { createRpcContext } from '@effect-trpc/tanstack-react-query';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';

const { RpcProvider, useRpc } = createRpcContext<typeof appRouter>();

const client = createClient(appRouter, { link: rendererLink() });
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
// Close the connection eagerly: the main process then ends this window's subscription at once.
addEventListener('pagehide', () => void client.dispose());

const subscribeToHash = (onChange: () => void) => {
  addEventListener('hashchange', onChange);
  return () => removeEventListener('hashchange', onChange);
};

function Board() {
  const rpc = useRpc();
  return (
    <main>
      <h1>Tasks</h1>
      <SignedInAs rpc={rpc} />
      <LiveFeed rpc={rpc} />
      <NewTaskForm rpc={rpc} />
      <TaskList
        rpc={rpc}
        renderLink={(task, label, children) => (
          <a href={`#/tasks/${task.id}`} aria-label={label}>
            {children}
          </a>
        )}
      />
    </main>
  );
}

function Task({ id }: { readonly id: number }) {
  const rpc = useRpc();
  return (
    <main>
      <a href="#/">Back to tasks</a>
      <TaskDetail rpc={rpc} id={id} />
    </main>
  );
}

function App() {
  const hash = useSyncExternalStore(subscribeToHash, () => location.hash);
  const id = /^#\/tasks\/(\d+)$/.exec(hash)?.[1];
  return id === undefined ? <Board /> : <Task id={Number(id)} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RpcProvider client={client} queryClient={queryClient}>
        <App />
      </RpcProvider>
    </QueryClientProvider>
  </StrictMode>,
);
