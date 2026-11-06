import type {
  inferError,
  inferInput,
  inferKind,
  inferOutput,
  inferRouterErrors,
  inferRouterInputs,
  inferRouterOutputs,
  Router,
} from '@effect-trpc/core';
import type { Client } from '@effect-trpc/client';

import type { AppRouter } from '@/router';

// #region procedure
type ById = AppRouter['record']['post']['byId'];

type ByIdInput = inferInput<ById>; // { readonly id: number }
type ByIdOutput = inferOutput<ById>; // Post
type ByIdError = inferError<ById>; // PostNotFound
type ByIdKind = inferKind<ById>; // "query"

type CreateError = inferError<AppRouter['record']['post']['create']>; // Forbidden | Unauthorized (from Auth)
type Created = inferOutput<AppRouter['record']['post']['onCreated']>; // Post (the stream element)
// #endregion procedure

// #region router
type Inputs = inferRouterInputs<AppRouter>;
type Outputs = inferRouterOutputs<AppRouter>;
type Errors = inferRouterErrors<AppRouter>;

type ListInput = Inputs['post']['list']; // { readonly cursor?: number | null }
type ListOutput = Outputs['post']['list']; // PostPage
type AllErrors = Errors['post'][keyof Errors['post']];

type Paths = Router.Paths<AppRouter>; // "health" | "post.byId" | "post.list" | …
// #endregion router

// #region client
type CallError = Client.Error<ById>; // ClientError<PostNotFound>
type CallInput = Client.Input<ById>;
type CallOutput = Client.Output<ById>;
// #endregion client

export type All = [
  ByIdInput,
  ByIdOutput,
  ByIdError,
  ByIdKind,
  CreateError,
  Created,
  ListInput,
  ListOutput,
  AllErrors,
  Paths,
  CallError,
  CallInput,
  CallOutput,
];
