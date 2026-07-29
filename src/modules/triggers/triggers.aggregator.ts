import type { Triggers, TriggersModelAttrs } from '@zanix/database'
import type { ServiceRegistryEntry } from 'typings/registry.ts'

import { TriggersAdminClient } from './triggers.client.ts'
import { ServiceRegistry } from 'modules/registry/registry.ts'

/** A trigger entry fanned out from `list()`, tagged with which registered service it came from. */
export type AggregatedTrigger = TriggersModelAttrs & { serviceId: string }

/**
 * Builds the `TriggersAdminClient` used to call a given registered service — the pluggable seam
 * for attaching per-service auth (e.g. a cached `type: 'api'` token from `@zanix/auth`'s
 * `exchangeServiceCredential`). Defaults to an unauthenticated client, which only works against a
 * target that doesn't actually require a token — real deployments should always provide one.
 */
export type TriggersClientFactory = (service: ServiceRegistryEntry) => TriggersAdminClient

const defaultClientFactory: TriggersClientFactory = (service) =>
  new TriggersAdminClient({ baseUrl: service.adminBaseUrl })

/**
 * `zanix-admin`'s triggers **proxy/aggregator** — it never owns or duplicates any service's
 * `zanix-triggers` collection: `list()` fans out to every registered service's own
 * `/admin/triggers/list` and merges the results tagged by origin service; every
 * other operation resolves which service owns the given `model` (via the caller-supplied
 * `serviceId`) and proxies straight to that service's own API — this class never touches another
 * service's database directly.
 *
 * A single service failing during `list()`'s fan-out fails the whole call (via `Promise.all`) —
 * deliberately simple for now; a deployment that needs partial-failure tolerance (some services
 * unreachable, still show the rest) should catch per-service instead, e.g. by supplying a
 * `clientFactory` that already wraps failures into an empty result, or by composing its own
 * `Promise.allSettled` around `registry.list()` directly.
 */
export class TriggersAggregator {
  #registry: ServiceRegistry
  #createClient: TriggersClientFactory

  constructor(
    registry: ServiceRegistry,
    clientFactory: TriggersClientFactory = defaultClientFactory,
  ) {
    this.#registry = registry
    this.#createClient = clientFactory
  }

  /** Fans out to every registered service's own trigger list, tagged by origin `serviceId`. */
  public async list(): Promise<AggregatedTrigger[]> {
    const services = this.#registry.list()

    const perService = await Promise.all(services.map(async (service) => {
      const triggers = await this.#createClient(service).list()
      return triggers.map((trigger) => ({ ...trigger, serviceId: service.serviceId }))
    }))

    return perService.flat()
  }

  /** Gets a single trigger entry from the given service. */
  public get(serviceId: string, model: string): Promise<TriggersModelAttrs> {
    const service = this.#registry.get(serviceId)
    return this.#createClient(service).get(model)
  }

  /** Creates a trigger entry on the given service. */
  public create(
    serviceId: string,
    model: string,
    active: boolean,
    triggers: Triggers,
  ): Promise<TriggersModelAttrs> {
    const service = this.#registry.get(serviceId)
    return this.#createClient(service).create(model, active, triggers)
  }

  /** Updates a trigger entry on the given service. */
  public update(
    serviceId: string,
    model: string,
    changes: { active?: boolean; triggers?: Triggers },
  ): Promise<TriggersModelAttrs> {
    const service = this.#registry.get(serviceId)
    return this.#createClient(service).update(model, changes)
  }

  /** Deletes a trigger entry on the given service. */
  public remove(serviceId: string, model: string): Promise<void> {
    const service = this.#registry.get(serviceId)
    return this.#createClient(service).remove(model)
  }
}

let activeAggregator: TriggersAggregator | undefined

/**
 * Installs the {@link TriggersAggregator} instance `TriggersController` calls into — the seam an
 * app uses to supply its own {@link TriggersClientFactory} (real per-service auth) before
 * `Zanix.start()`. Call once during startup; unset, {@link getTriggersAggregator} falls back to a
 * default instance (registry from `ServiceRegistry`'s own env var only, unauthenticated client).
 */
export const setTriggersAggregator = (aggregator: TriggersAggregator): void => {
  activeAggregator = aggregator
}

/** Returns the installed {@link TriggersAggregator}, lazily building a default one if none was set. */
export const getTriggersAggregator = (): TriggersAggregator => {
  if (!activeAggregator) activeAggregator = new TriggersAggregator(new ServiceRegistry())
  return activeAggregator
}
