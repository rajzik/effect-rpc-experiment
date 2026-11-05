// Stands in for TanStack Start's generated `src/routeTree.gen.ts`, so the Start samples
// type-check here. In an app, the router plugin writes this file.
import type {} from '@tanstack/react-start'; // loads the `server` route option (types only)

import { Route as rootRoute } from './routes/__root';
import { Route as RpcRouteImport } from './routes/api/rpc.$';
import { Route as DraftRouteImport } from './routes/drafts.$postId';
import { Route as PostRouteImport } from './routes/posts.$postId';

const RpcRoute = RpcRouteImport.update({
  id: '/api/rpc/$',
  path: '/api/rpc/$',
  getParentRoute: () => rootRoute,
} as never);
const PostRoute = PostRouteImport.update({
  id: '/posts/$postId',
  path: '/posts/$postId',
  getParentRoute: () => rootRoute,
} as never);
const DraftRoute = DraftRouteImport.update({
  id: '/drafts/$postId',
  path: '/drafts/$postId',
  getParentRoute: () => rootRoute,
} as never);

export const routeTree = rootRoute.addChildren([RpcRoute, PostRoute, DraftRoute]);

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/api/rpc/$': {
      id: '/api/rpc/$';
      path: '/api/rpc/$';
      fullPath: '/api/rpc/$';
      preLoaderRoute: typeof RpcRouteImport;
      parentRoute: typeof rootRoute;
    };
    '/posts/$postId': {
      id: '/posts/$postId';
      path: '/posts/$postId';
      fullPath: '/posts/$postId';
      preLoaderRoute: typeof PostRouteImport;
      parentRoute: typeof rootRoute;
    };
    '/drafts/$postId': {
      id: '/drafts/$postId';
      path: '/drafts/$postId';
      fullPath: '/drafts/$postId';
      preLoaderRoute: typeof DraftRouteImport;
      parentRoute: typeof rootRoute;
    };
  }
}
