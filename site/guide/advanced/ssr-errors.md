# Typed errors through SSR

A typed error is a class instance. Every boundary that serializes it with plain JSON (or a framework
serializer that does not know your schemas) turns it into a plain object or a plain `Error`. This
page lists each boundary and what keeps the class.

| Boundary                                | Keeps the class?                           | How                                                                |
| --------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `httpLink` / `wsLink` response          | yes                                        | the procedure's error schema                                       |
| TanStack Query cache, SSR hydration     | yes, with the helpers                      | `createHydrationHelpers` encodes errors with `Codecs.exit`         |
| Next.js `HydrateClient`                 | yes, for queries that failed before render | `await` the prefetch for pages that must show typed errors         |
| Next.js streamed query that fails later | no: React serializes a plain `Error`       | await the prefetch instead                                         |
| Next.js server action                   | yes                                        | actions resolve with the encoded `Exit`; `useServerAction` decodes |
| TanStack Start loader **throw**         | no: Start's serializer                     | `prefetchQuery` in the loader, narrow in the component             |
| TanStack Start query cache              | yes                                        | `hydration.routerOptions(queryClient)`                             |
| your own cache / queue / cookie         | only with codecs                           | `Codecs.encodeExitSync` / `decodeExitSync`                         |

## The pattern

1. On the server, let the query fail in the cache: `prefetchQuery` (it never throws), or an awaited
   prefetch in RSC.
2. Dehydrate with the effect-trpc helpers (the framework adapters do this for you).
3. In the component, read `query.error` and narrow on `_tag`.

Next.js:

```tsx
// app/post/[id]/page.tsx
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await getQueryClient().prefetchQuery(rpc.post.byId.queryOptions({ id: Number(id) }));
  return (
    <HydrateClient>
      <PostView id={Number(id)} />
    </HydrateClient>
  );
}
```

TanStack Start: see [typed errors in loaders](../frameworks/start#typed-errors).

## What crosses, what doesn't

- A dehydrated `RpcDefect` keeps its message and drops its `cause`, so no server internals reach the
  HTML.
- Server-action defects keep their message only (no stack, no `cause`).
- Your `TaggedError` fields are encoded with their schema, so put in them only what the client may
  see.

See also: [SSR hydration](../react-query/hydration), [schemas and serialization](../concepts/schemas).
