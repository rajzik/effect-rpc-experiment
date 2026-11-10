# Installation

Install `effect` and the packages for the parts of your app that need them. Every package depends
on `@rpc-effect/core`, which depends on `effect`.

## By job

::: code-group

```sh [Server]
pnpm add effect @rpc-effect/core @rpc-effect/server
# a standalone Node server (optional peer of @rpc-effect/server/node):
pnpm add @effect/platform-node
```

```sh [Client]
pnpm add effect @rpc-effect/core @rpc-effect/client
```

```sh [React]
pnpm add effect @rpc-effect/core @rpc-effect/client @rpc-effect/tanstack-react-query \
  @tanstack/react-query react
```

```sh [Next.js]
pnpm add effect @rpc-effect/core @rpc-effect/server @rpc-effect/client \
  @rpc-effect/tanstack-react-query @rpc-effect/next @tanstack/react-query next react
```

```sh [TanStack Start]
pnpm add effect @rpc-effect/core @rpc-effect/server @rpc-effect/client \
  @rpc-effect/tanstack-react-query @rpc-effect/start \
  @tanstack/react-query @tanstack/react-start @tanstack/react-router react
```

```sh [Electron]
pnpm add effect @rpc-effect/core @rpc-effect/server @rpc-effect/client @rpc-effect/electron
pnpm add -D electron
```

```sh [Testing]
pnpm add -D @rpc-effect/test-utils @effect/vitest vitest
```

:::

npm, yarn and bun work the same way.

## Peer dependencies

| Package                            | Peers                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------- |
| `@rpc-effect/server`               | `@effect/platform-node` `^4.0.1`, optional: only `@rpc-effect/server/node` uses it |
| `@rpc-effect/tanstack-react-query` | `@tanstack/react-query` `^5.100.0`, `react` `>=18.2.0`                             |
| `@rpc-effect/next`                 | the above plus `next` `>=15.0.0`                                                   |
| `@rpc-effect/start`                | the above plus `@tanstack/react-start` and `@tanstack/react-router` `>=1.150.0`    |
| `@rpc-effect/electron`             | `electron` `>=30.0.0`                                                              |

## TypeScript

The packages are ESM with `.d.mts` types. Use `"moduleResolution": "Bundler"` or `"NodeNext"`
and `"strict": true`. `exactOptionalPropertyTypes` is supported.

Samples on this site import the router from `@/router` and its server implementation from
`@/server`. In your app that is the module the server and the client share, under whatever path
or alias you use. Both modules are shown in the [quick start](./quick-start).

## Editor support

Every export carries JSDoc with a summary, **When to use**, **Gotchas** and a type-checked
example, so hovering in your editor shows the same content as the [API reference](/api/).
