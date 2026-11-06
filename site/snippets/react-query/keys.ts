import { queryClient, rpc } from './no-context';

// #region keys
rpc.post.byId.queryKey({ id: 1 }); // [["post","byId"], { input: { id: 1 }, type: "query" }]
rpc.post.list.infiniteQueryKey({}); // [["post","list"], { input: {}, type: "infinite" }]
rpc.post.pathKey(); // [["post"]]: every query under `post`
rpc.pathKey(); // []: every query of this router
rpc.post.create.mutationKey(); // [["post","create"]]
// #endregion keys

// #region filters
// Filters are `{ ...filters, queryKey }`, ready for any QueryClient method.
await queryClient.invalidateQueries(rpc.post.byId.queryFilter({ id: 1 }));
await queryClient.invalidateQueries(rpc.post.byId.queryFilter()); // every byId input
await queryClient.invalidateQueries(rpc.post.pathFilter()); // everything under post
queryClient.removeQueries(rpc.post.list.infiniteQueryFilter({}, { type: 'inactive' }));

// Typed cache access.
queryClient.setQueryData(rpc.post.byId.queryKey({ id: 1 }), (old) => old); // old: Post | undefined
// #endregion filters
