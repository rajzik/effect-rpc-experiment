/**
 * The hooks middleware: a server-only `RpcMiddleware` that `layerHttp` and `createCaller` add last
 * to the served group, so it wraps every user middleware. It provides the request context of
 * `Handlers.withContext` (the {@link RequestContext} service, when the handlers layer has it) and
 * calls the `onError` server option.
 *
 * @internal
 * @since 0.1.0
 */
import { Cause, Context, Effect, Layer, Option } from 'effect';
import { RpcMiddleware } from 'effect/rpc';
import type { Rpc, RpcGroup } from 'effect/rpc';
import type { ServerOptions } from '../Http.js';

/**
 * Set by `Handlers.withContext`: the effect building the services of one call, with what it
 * needs already provided.
 *
 * @internal
 * @since 0.1.0
 */
export class RequestContext extends Context.Service<
  RequestContext,
  Effect.Effect<Context.Context<never>>
>()('@effect-trpc/server/RequestContext') {}

/** The hooks middleware: no error, provides nothing. */
class Hooks extends RpcMiddleware.Service<Hooks>()('@effect-trpc/server/Hooks') {}

/**
 * Adds the hooks middleware to `group`. Returns the group to serve and the layer implementing the
 * middleware, which reads {@link RequestContext} from what it is built with (the handlers layer).
 *
 * @internal
 * @since 0.1.0
 */
export const withHooks = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  { onError }: Pick<ServerOptions, 'onError'>,
): {
  readonly group: RpcGroup.RpcGroup<Rpcs>;
  readonly layer: Layer.Layer<never>;
} => ({
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the rpcs are the same plus `Hooks`, which `layer` implements (and which no caller of this needs to see)
  group: group.middleware(Hooks) as unknown as RpcGroup.RpcGroup<Rpcs>,
  layer: Layer.effect(Hooks)(
    Effect.map(Effect.serviceOption(RequestContext), (requestContext) =>
      Hooks.of((effect, { rpc, headers }) => {
        // The request context runs in the call's fiber, so it sees the request.
        const provided = Option.isNone(requestContext)
          ? effect
          : Effect.flatMap(requestContext.value, (services) =>
              Effect.provideContext(effect, services),
            );
        if (onError === undefined) return provided;
        return Effect.onError(provided, (cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : // A failing, dying or throwing hook must not change the response.
              Effect.ignoreCause(Effect.suspend(() => onError({ path: rpc._tag, cause, headers }))),
        );
      }),
    ),
  ),
});
