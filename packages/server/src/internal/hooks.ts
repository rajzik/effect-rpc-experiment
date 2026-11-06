/**
 * The hooks middleware: a server-only `RpcMiddleware` implementing the hook options of the HTTP
 * adapters (`onError`). `layerHttp` adds it last to the served group, so it wraps every user
 * middleware, and provides its implementation; without hook options the group is served as is.
 *
 * @internal
 * @since 0.1.0
 */
import { Cause, Effect, Layer } from 'effect';
import type { Headers } from 'effect/http';
import { RpcMiddleware } from 'effect/rpc';
import type { Rpc, RpcGroup } from 'effect/rpc';

/**
 * The server options implemented by the hooks middleware (`ServerOptions` in `Http.ts`).
 *
 * @internal
 * @since 0.1.0
 */
export interface HooksOptions {
  readonly onError?:
    | ((info: {
        readonly path: string;
        readonly cause: Cause.Cause<unknown>;
        readonly headers: Headers.Headers;
      }) => Effect.Effect<void>)
    | undefined;
}

/** The hooks middleware: no error, provides nothing. */
class Hooks extends RpcMiddleware.Service<Hooks>()('@effect-trpc/server/Hooks') {}

/**
 * Adds the hooks middleware to `group` when a hook option is set. Returns the group to serve and
 * the layer implementing the middleware; without hook options, `group` itself and an empty layer.
 *
 * @internal
 * @since 0.1.0
 */
export const withHooks = (
  group: RpcGroup.RpcGroup<Rpc.Any>,
  options: HooksOptions,
): { readonly group: RpcGroup.RpcGroup<Rpc.Any>; readonly layer: Layer.Layer<never> } => {
  const { onError } = options;
  if (onError === undefined) return { group, layer: Layer.empty };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- `Rpc.Any` is erased, so adding a middleware to it computes `never`; the rpcs are the same plus `Hooks`, which `layer` implements
    group: group.middleware(Hooks) as unknown as RpcGroup.RpcGroup<Rpc.Any>,
    layer: Layer.succeed(Hooks)((effect, { rpc, headers }) =>
      Effect.onError(effect, (cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : // A failing, dying or throwing hook must not change the response.
            Effect.ignoreCause(Effect.suspend(() => onError({ path: rpc._tag, cause, headers }))),
      ),
    ),
  };
};
