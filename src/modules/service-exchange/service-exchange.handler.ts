import type { HandlerContext } from '@zanix/server'

import { Controller, Post, ZanixController } from '@zanix/server'
import { exchangeServiceCredential, type ServiceCredential } from '@zanix/auth'
import { ADMIN_VERSION_PROTOCOL } from '../protocol/version-protocol.ts'
import { ServiceExchangeRTO } from './service-exchange.rto.ts'

/** The instance shape {@link createServiceExchangeController} builds — see its own docs. */
export interface ServiceExchangeControllerInstance extends ZanixController {
  /** `POST /` — exchanges a signed service assertion for a short-lived credential. */
  exchange(
    ctx: HandlerContext<{ body: ServiceExchangeRTO }>,
  ): Promise<ServiceCredential>
}

/**
 * Machine-to-machine credential exchange — always registered under the `'admin'` Application (see
 * `docs/APPLICATIONS.md`), the HTTP route `@zanix/auth`'s
 * `docs/service-credential.md` deliberately leaves for whichever consumer needs it
 * (`@zanix/auth` exports the primitive, not a mounted endpoint, the same way it doesn't own any
 * other HTTP route). This is that route: a thin wrapper around `exchangeServiceCredential`, reused
 * as-is.
 *
 * **No role gate here, on purpose** — unlike `/admin/triggers`/`/admin/templates`, the caller has
 * no session yet at this point (the whole reason it's calling this endpoint is to *obtain* one).
 * Trust is established entirely by `exchangeServiceCredential`'s own verification against
 * `JWK_PUB_<serviceId>` — only a service with a registered public key is granted a token at all,
 * and only whatever `SERVICE_PERMISSIONS_<serviceId>`/`SERVICE_RATE_LIMIT_<serviceId>` the operator
 * configured for it, never anything the caller requests.
 *
 * A factory rather than a plain always-decorated class — the same reason every other controller in
 * this package is one: `@Controller`'s decorator runs (and thus registers the route) the moment
 * the class declaration executes, so a plain class reachable through this package's own `mod.ts`
 * would register `/admin/service-token` the instant *anything* imports `@zanix/admin`, for any
 * reason, regardless of whether that caller wanted it registered at all. Deferring the decorator to
 * an explicit call site (`@zanix/core`'s `defineAdminMetadata()`) keeps registration intentional.
 * No options today — always `prefix: 'admin/service-token'` — a zero-argument factory rather than
 * a speculative options bag.
 *
 * **This is the one authoritative definition of the `/admin/service-token` path** — 3 other sites
 * hardcode the same literal rather than importing a shared constant, deliberately: a route path is
 * business data expected to evolve alongside `@zanix/admin`'s own protocol, closer to
 * `ADMIN_PROTOCOL_VERSION`'s category than to a stable header name — `@zanix/auth` intentionally
 * owns no HTTP routes, so it can't be the shared home either, and neither `@zanix/server` (a route
 * path implies a permissions concept it deliberately has none of) nor `@zanix/notifications` (would
 * make it depend on `@zanix/admin`, an upward dependency) can host it. The 3 sites:
 * `registry/auth.ts`'s `createServiceRegistryAuthHeaders`, `registry/reachability.ts`'s
 * `checkServiceRegistryReachability`, and `@zanix/notifications`'s `remote-backend.ts`
 * (`RemoteTemplateBackendConfig.url`'s own doc) — all 3 already cross-reference back to this
 * function. Grep `'admin/service-token'` across the monorepo before renaming this prefix.
 *
 * @requires @zanix/auth
 */
export function createServiceExchangeController(): new (
  context: HandlerContext,
) => ServiceExchangeControllerInstance {
  @Controller({
    prefix: 'admin/service-token',
    versionProtocol: ADMIN_VERSION_PROTOCOL,
  })
  class _ServiceExchangeController extends ZanixController {
    @Post('', { Body: ServiceExchangeRTO })
    public exchange(
      ctx: HandlerContext<{ body: ServiceExchangeRTO }>,
    ): Promise<ServiceCredential> {
      return exchangeServiceCredential(ctx.payload.body.assertion)
    }
  }

  return _ServiceExchangeController
}
