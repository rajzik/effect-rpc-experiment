// Two routers, one QueryClient: each router gets a key prefix.
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Effect, Schema } from 'effect';
import { query, Router } from '@effect-trpc/core';
import { createClient, httpLink } from '@effect-trpc/client';
import { Handlers } from '@effect-trpc/server';
import { createHydrationHelpers, createRpcContext } from '@effect-trpc/tanstack-react-query';
import type { ReactNode } from 'react';

// #region routers
class Invoice extends Schema.Class<Invoice>('Invoice')({
  id: Schema.Number,
  cents: Schema.Number,
}) {}
class Ticket extends Schema.Class<Ticket>('Ticket')({ id: Schema.Number, title: Schema.String }) {}

// Both routers have an `item` procedure: without prefixes their keys would collide.
export const billingRouter = Router.make({
  item: query({ payload: { id: Schema.Number }, success: Invoice }),
});
export const supportRouter = Router.make({
  item: query({ payload: { id: Schema.Number }, success: Ticket }),
});
// #endregion routers

// #region context
const billing = createRpcContext<typeof billingRouter, { keyPrefix: true }>();
const support = createRpcContext<typeof supportRouter, { keyPrefix: true }>();

const queryClient = new QueryClient();
const billingClient = createClient(billingRouter, {
  link: httpLink({ url: 'https://billing.example.com/rpc' }),
});
const supportClient = createClient(supportRouter, {
  link: httpLink({ url: 'https://support.example.com/rpc' }),
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <billing.RpcProvider client={billingClient} queryClient={queryClient} keyPrefix="billing">
        <support.RpcProvider client={supportClient} queryClient={queryClient} keyPrefix="support">
          {children}
        </support.RpcProvider>
      </billing.RpcProvider>
    </QueryClientProvider>
  );
}

export function Dashboard() {
  const invoice = useQuery(billing.useRpc().item.queryOptions({ id: 1 })); // Invoice
  const ticket = useQuery(support.useRpc().item.queryOptions({ id: 1 })); // Ticket
  // keys: [["billing"], ["item"], {...}] and [["support"], ["item"], {...}]
  return (
    <p>
      {invoice.data?.cents} / {ticket.data?.title}
    </p>
  );
}
// #endregion context

// #region invalidate
export function useRefreshBilling() {
  const rpc = billing.useRpc();
  // pathKey() of a prefixed router matches only that router's queries.
  return () => queryClient.invalidateQueries({ queryKey: rpc.pathKey() });
}
// #endregion invalidate

// #region hydration
// SSR: one set of hydration helpers per router, each with its prefix.
export const billingHydration = createHydrationHelpers(billingRouter, { keyPrefix: 'billing' });
export const supportHydration = createHydrationHelpers(supportRouter, { keyPrefix: 'support' });
// #endregion hydration

export const BillingHandlers = Handlers.make(billingRouter, {
  item: ({ id }) => Effect.succeed(new Invoice({ id, cents: 1200 })),
});
