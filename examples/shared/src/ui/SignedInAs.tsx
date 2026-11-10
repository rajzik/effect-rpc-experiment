'use client';
/** Shows who the session belongs to. */
import { useQuery } from '@tanstack/react-query';
import type { RpcOptionsProxy } from '@rpc-effect/tanstack-react-query';

import type { AppRouter } from '../domain';
import { sessionOptions } from './options';

/** Props of {@link SignedInAs}. */
export interface SignedInAsProps {
  readonly rpc: RpcOptionsProxy<AppRouter>;
}

/** `Signed in as <name>`, or `Not signed in` when `session.me` is `Unauthorized`. */
export function SignedInAs({ rpc }: SignedInAsProps) {
  const me = useQuery(sessionOptions(rpc));
  if (me.data !== undefined) return <p>Signed in as {me.data.name}</p>;
  if (me.error !== null) return <p>Not signed in</p>;
  return <p>Loading user…</p>;
}
