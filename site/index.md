---
layout: home
title: effect-trpc
titleTemplate: Typed RPC for Effect v4

hero:
  name: effect-trpc
  text: Typed RPC for Effect v4
  tagline: Procedures declared once with Effect Schema. Typed errors and real class instances from the handler to the Promise client, the Effect client and TanStack Query.
  actions:
    - theme: brand
      text: Quick start
      link: /guide/quick-start
    - theme: alt
      text: API reference
      link: /api/

features:
  - title: Routers and procedures
    details: query, mutation and subscription over effect/rpc, nested into one router shared by server and client.
    link: /guide/concepts/routers
  - title: The error model
    details: Your Schema.TaggedError union plus three infrastructure errors, never mixed up. Narrow on _tag.
    link: /guide/concepts/errors
  - title: Server
    details: Handlers as Effects and Streams, middleware that provides services, fetch handlers, Node servers, in-process callers.
    link: /guide/server/handlers
  - title: TanStack React Query
    details: queryOptions, mutationOptions, infinite queries, subscriptions and Schema-aware SSR hydration.
    link: /guide/react-query/setup
  - title: Next.js, TanStack Start, Electron
    details: Route handlers, RSC prefetch, server actions with typed errors, loaders, MessagePort transport.
    link: /guide/frameworks/next
  - title: Advanced
    details: Auth end to end, multiple routers, live data, cancellation, custom links, migrating from tRPC.
    link: /guide/advanced/auth
---
