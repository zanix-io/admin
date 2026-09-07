import type { ServiceRegistryEntry } from 'typings/registry.ts'
import type { ServiceRegistry } from 'modules/registry/registry.ts'
import type { DiscoveryAdminClient } from './discovery.client.ts'

/**
 * Builds the {@link DiscoveryAdminClient} {@link fanOutDiscovery} uses for one registered service —
 * the shared shape both `TriggersDiscoveryClientFactory` and `DlqDiscoveryClientFactory` alias.
 */
export type DiscoveryFanOutClientFactory = (
  service: ServiceRegistryEntry,
) => DiscoveryAdminClient | Promise<DiscoveryAdminClient>

/** Options controlling {@link fanOutDiscovery}'s per-service failure handling. */
export interface FanOutDiscoveryOptions {
  /**
   * When `true`, reverts to the old, strict `Promise.all` semantics: the first registered service
   * whose Discovery snapshot fails rejects the whole fan-out, discarding whatever the other
   * services already returned. Defaults to `false` — a failing service is logged (via `onError`)
   * and skipped, so the rest of the aggregate still comes back. That flips the default from "one
   * degraded service blacks out the whole aggregate" to "one degraded service is silently absent
   * from the aggregate," which is the safer default for ops-console visibility: a partial, mostly
   * correct picture beats a hard failure telling an operator nothing (see
   * `zanix-io/admin`'s aggregator fault-tolerance issue). `strict: true` is still the right choice
   * for a caller that genuinely needs all-or-nothing consistency.
   */
  strict?: boolean
}

/**
 * The one shared fan-out `TriggersAggregator.list()` and `DlqAggregator.list()` both call, instead
 * of each hand-rolling its own `Promise.all(services.map(...))` — the two were independently
 * duplicated verbatim before this helper existed. Fetches every `registry.list()` entry's own
 * `resourceType` Discovery snapshot (via `discoveryClientFactory`), tags each returned item with the
 * origin `serviceId`, and flattens the result.
 *
 * Any future aggregator built on the same Discovery-fan-out shape should call this too, rather than
 * hand-rolling a third copy of the same `Promise.all`/`Promise.allSettled` fan-out.
 *
 * @param registry - The service registry to fan out over.
 * @param discoveryClientFactory - Builds the per-service `DiscoveryAdminClient`.
 * @param resourceType - The `/.well-known/zanix/{resourceType}` snapshot to fetch from each service.
 * @param onError - Called (not swallowed) for each service whose snapshot fetch fails — the caller's
 * one chance to log which service was the culprit, since `strict: false` (the default) otherwise
 * discards that detail once the failure is skipped rather than rethrown.
 * @param options - See {@link FanOutDiscoveryOptions}.
 */
export async function fanOutDiscovery<T>(
  registry: ServiceRegistry,
  discoveryClientFactory: DiscoveryFanOutClientFactory,
  resourceType: string,
  onError: (service: ServiceRegistryEntry, error: unknown) => void,
  options: FanOutDiscoveryOptions = {},
): Promise<Array<T & { serviceId: string }>> {
  const services = registry.list()

  const fetchOne = async (service: ServiceRegistryEntry) => {
    try {
      const client = await discoveryClientFactory(service)
      const items = await client.snapshot<T>(resourceType)
      return items.map((item) => ({ ...item, serviceId: service.serviceId }))
    } catch (error) {
      onError(service, error)
      throw error
    }
  }

  if (options.strict) {
    const perService = await Promise.all(services.map(fetchOne))
    return perService.flat()
  }

  const settled = await Promise.allSettled(services.map(fetchOne))
  const perService: Array<T & { serviceId: string }>[] = []
  for (const result of settled) {
    // A rejection was already reported to `onError` inside `fetchOne` above — skip it here rather
    // than letting one degraded service discard every other service's own successful result.
    if (result.status === 'fulfilled') perService.push(result.value)
  }

  return perService.flat()
}
