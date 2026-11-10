import { RpcSerialization } from 'effect/rpc';
import { serializationLayer, toWebHandler } from '@rpc-effect/server';
import { createClient, httpLink } from '@rpc-effect/client';

import { appRouter } from '@/router';
import { ServerLive } from '@/server';

// #region match
// Server and client must agree. The default on both sides is "ndjson".
const { handler } = await toWebHandler(appRouter, { handlers: ServerLive, serialization: 'json' });

const client = createClient(appRouter, {
  link: httpLink({ url: 'https://api.example.com/rpc', serialization: 'json' }),
});
// #endregion match

// #region custom
// Any RpcSerialization layer works, given to both sides, e.g. JSON-RPC 2.0 envelopes.
const jsonRpc = RpcSerialization.layerJsonRpc();
await toWebHandler(appRouter, { handlers: ServerLive, serialization: jsonRpc });
createClient(appRouter, {
  link: httpLink({ url: 'https://api.example.com/rpc', serialization: jsonRpc }),
});

// The same option values for a hand-wired effect/rpc server or client:
serializationLayer('json'); // RpcSerialization.layerJson
serializationLayer(undefined); // RpcSerialization.layerNdjson (the default)
// #endregion custom

void [handler, client];
