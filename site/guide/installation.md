# Installation

Install `effect` and the packages for the parts of your app that need them. Every package depends
on `@effect-trpc/core`, which depends on `effect`.

## By job

::: code-group

```sh [Server]
pnpm add effect @effect-trpc/core @effect-trpc/server
# a standalone Node server (optional peer of @effect-trpc/server/node):
pnpm add @effect/platform-node
```

```sh [Client]
pnpm add effect @effect-trpc/core @effect-trpc/client
```

```sh [React]
pnpm add effect @effect-trpc/core @effect-trpc/client @effect-trpc/tanstack-react-query \
  @tanstack/react-query react
```

```sh [Next.js]
pnpm add effect @effect-trpc/core @effect-trpc/server @effect-trpc/client \
  @effect-trpc/tanstack-react-query @effect-trpc/next @tanstack/react-query next react
```

```sh [TanStack Start]
pnpm add effect @effect-trpc/core @effect-trpc/server @effect-trpc/client \
  @effect-trpc/tanstack-react-query @effect-trpc/start \
  @tanstack/react-query @tanstack/react-start @tanstack/react-router react
```

```sh [Electron]
pnpm add effect @effect-trpc/core @effect-trpc/server @effect-trpc/client @effect-trpc/electron
pnpm add -D electron
```

```sh [Testing]
pnpm add -D @effect-trpc/test-utils @effect/vitest vitest
```

:::

npm, yarn and bun work the same way.

## Peer dependencies

| Package                             | Peers                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `@effect-trpc/server`               | `@effect/platform-node` `^4.0.1`, optional: only `@effect-trpc/server/node` uses it |
| `@effect-trpc/tanstack-react-query` | `@tanstack/react-query` `^5.100.0`, `react` `>=18.2.0`                              |
| `@effect-trpc/next`                 | the above plus `next` `>=15.0.0`                                                    |
| `@effect-trpc/start`                | the above plus `@tanstack/react-start` and `@tanstack/react-router` `>=1.150.0`     |
| `@effect-trpc/electron`             | `electron` `>=30.0.0`                                                               |

## TypeScript

The packages are ESM with `.d.mts` types. Use `"moduleResolution": "Bundler"` or `"NodeNext"`
and `"strict": true`. `exactOptionalPropertyTypes` is supported.

Samples on this site import the router from `@/router` and its server implementation from
`@/server`. In your app that is the module the server and the client share, under whatever path
or alias you use. Both modules are shown in the [quick start](./quick-start).

## Editor support

Every export carries JSDoc with a summary, **When to use**, **Gotchas** and a type-checked
example, so hovering in your editor shows the same content as the [API reference](/api/).
