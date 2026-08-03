import type { ServiceAuthClientOptions, ServiceAuthHeaders } from '@zanix/auth'
import type { ServiceRegistryEntry } from 'typings/registry.ts'

import { createServiceAuthClient } from '@zanix/auth'

/**
 * Builds the `(service) => Promise<headers>` function {@link TriggersClientFactory}/
 * {@link TriggersDiscoveryClientFactory}/`TemplatesDiscoveryClientFactory`'s own `headers` option
 * expects — the thin adapter between `@zanix/auth`'s generic
 * {@link createServiceAuthClient} (which knows nothing about a `ServiceRegistryEntry`, or any
 * other consumer's own shape) and this package's own registered-service concept. Owns exactly one
 * convention: the exchange endpoint is always `{adminBaseUrl}/admin/service-token` —
 * `createServiceExchangeController`'s own fixed prefix, regardless of the target's own business
 * server's `globalPrefix` (a separate Application/server entirely — see `@zanix/server`'s
 * `docs/HANDLERS.md#applications`).
 *
 * `options` identifies THIS caller's own identity (e.g. `ZanixAdminHub` itself, or a business
 * service calling another one directly) — never the target's. See `docs/service-authentication.md`
 * for the full flow this plugs into.
 *
 * @example
 * ```ts
 * const authHeaders = createServiceRegistryAuthHeaders({ serviceId: 'zanix-admin-hub', privateKey })
 *
 * setTriggersAggregator(new TriggersAggregator(
 *   getServiceRegistry(),
 *   async (service) => new TriggersAdminClient({ baseUrl: service.adminBaseUrl, headers: await authHeaders(service) }),
 *   async (service) => new DiscoveryAdminClient({ baseUrl: service.adminBaseUrl, headers: await authHeaders(service) }),
 * ))
 * ```
 */
export function createServiceRegistryAuthHeaders(
  options: ServiceAuthClientOptions,
): (service: ServiceRegistryEntry) => Promise<ServiceAuthHeaders> {
  const auth = createServiceAuthClient(options)
  return (service) => auth(service.serviceId, `${service.adminBaseUrl}/admin/service-token`)
}
