import type { CreateTriggerInput, TriggersModelAttrs, UpdateTriggerInput } from '@zanix/database'
import type { ServiceRegistryEntry } from 'typings/registry.ts'
import type { ServiceRegistry } from 'modules/registry/registry.ts'

import { TriggersAdminClient } from './triggers.client.ts'
import { DiscoveryAdminClient } from 'modules/discovery/discovery.client.ts'
import { getServiceRegistry } from 'modules/registry/registry.ts'

/** A trigger entry fanned out from `list()`, tagged with which registered service it came from. */
export type AggregatedTrigger = TriggersModelAttrs & { serviceId: string }

/**
 * Builds the `TriggersAdminClient` used to call a given registered service — the pluggable seam
 * for attaching per-service auth (e.g. a cached `type: 'api'` token from `@zanix/auth`'s
 * `exchangeServiceCredential`/`createServiceAuthClient`). Defaults to an unauthenticated client,
 * which only works against a target that doesn't actually require a token — real deployments
 * should always provide one. May return a `Promise` — attaching a real credential is inherently
 * async (it has to sign+exchange, at least on a cache miss — see `createServiceAuthClient`), so
 * every call site in this class already `await`s the factory's own result before using the client.
 */
export type TriggersClientFactory = (
  service: ServiceRegistryEntry,
) => TriggersAdminClient | Promise<TriggersAdminClient>

/**
 * Builds the `DiscoveryAdminClient` `list()` uses to fetch a service's `/.well-known/zanix/triggers`
 * snapshot — the same pluggable-auth seam as {@link TriggersClientFactory}, kept separate since a
 * plain read (Discovery) and a CRUD/mutation call may reasonably want different credentials. May
 * return a `Promise`, same reason as {@link TriggersClientFactory}.
 */
export type TriggersDiscoveryClientFactory = (
  service: ServiceRegistryEntry,
) => DiscoveryAdminClient | Promise<DiscoveryAdminClient>

const defaultClientFactory: TriggersClientFactory = (service) =>
  new TriggersAdminClient({ baseUrl: service.adminBaseUrl })

const defaultDiscoveryClientFactory: TriggersDiscoveryClientFactory = (
  service,
) => new DiscoveryAdminClient({ baseUrl: service.adminBaseUrl })

/**
 * `zanix-admin`'s triggers **proxy/aggregator** — it never owns or duplicates any service's
 * `zanix-triggers` collection: `list()` fans out to every registered service's own
 * `/.well-known/zanix/triggers` Discovery snapshot and merges the results tagged by origin
 * service (a plain read, so it goes through Discovery rather than the CRUD API — see
 * `@zanix/server`'s `docs/APPLICATIONS.md`'s "Discovery" section); every other operation resolves
 * which service owns the given `model` (via the caller-supplied `serviceId`) and proxies straight
 * to that service's own `/admin/triggers` CRUD API — this class never touches another service's
 * database directly.
 *
 * A single service failing during `list()`'s fan-out fails the whole call (via `Promise.all`) —
 * deliberately simple for now; a deployment that needs partial-failure tolerance (some services
 * unreachable, still show the rest) should catch per-service instead, e.g. by supplying a
 * `discoveryClientFactory` that already wraps failures into an empty result, or by composing its
 * own `Promise.allSettled` around `registry.list()` directly.
 */
export class TriggersAggregator {
  #registry: ServiceRegistry
  #createClient: TriggersClientFactory
  #createDiscoveryClient: TriggersDiscoveryClientFactory

  /**
   * Builds the aggregator against `registry`, defaulting `clientFactory`/`discoveryClientFactory`
   * to unauthenticated `TriggersAdminClient`/`DiscoveryAdminClient` instances when not given.
   */
  constructor(
    registry: ServiceRegistry,
    clientFactory: TriggersClientFactory = defaultClientFactory,
    discoveryClientFactory: TriggersDiscoveryClientFactory = defaultDiscoveryClientFactory,
  ) {
    this.#registry = registry
    this.#createClient = clientFactory
    this.#createDiscoveryClient = discoveryClientFactory
  }

  /**
   * Fans out to every registered service's own `/.well-known/zanix/triggers` Discovery snapshot,
   * tagged by origin `serviceId`. A read-only operation, so it goes through Discovery rather than
   * the CRUD API's `/admin/triggers/list` — see this class's own doc.
   */
  public async list(): Promise<AggregatedTrigger[]> {
    const services = this.#registry.list()

    const perService = await Promise.all(services.map(async (service) => {
      const client = await this.#createDiscoveryClient(service)
      const triggers = await client.snapshot<TriggersModelAttrs>('triggers')
      return triggers.map((trigger) => ({
        ...trigger,
        serviceId: service.serviceId,
      }))
    }))

    return perService.flat()
  }

  /** Gets a single trigger entry from the given service. */
  public async get(
    serviceId: string,
    model: string,
  ): Promise<TriggersModelAttrs> {
    const service = this.#registry.get(serviceId)
    const client = await this.#createClient(service)
    return client.get(model)
  }

  /** Creates a trigger entry on the given service. */
  public async create(
    serviceId: string,
    input: CreateTriggerInput,
  ): Promise<TriggersModelAttrs> {
    const service = this.#registry.get(serviceId)
    const client = await this.#createClient(service)
    return client.create(input)
  }

  /** Updates a trigger entry on the given service. */
  public async update(
    serviceId: string,
    model: string,
    changes: UpdateTriggerInput,
  ): Promise<TriggersModelAttrs> {
    const service = this.#registry.get(serviceId)
    const client = await this.#createClient(service)
    return client.update(model, changes)
  }

  /** Deletes a trigger entry on the given service. */
  public async remove(serviceId: string, model: string): Promise<void> {
    const service = this.#registry.get(serviceId)
    const client = await this.#createClient(service)
    return client.remove(model)
  }
}

let activeAggregator: TriggersAggregator | undefined

/**
 * Installs the {@link TriggersAggregator} instance `TriggersController` calls into — the seam an
 * app uses to supply its own {@link TriggersClientFactory}/{@link TriggersDiscoveryClientFactory}
 * (real per-service auth) before `Zanix.start()`. Call once during startup; unset,
 * {@link getTriggersAggregator} falls back to a default instance (the shared
 * {@link getServiceRegistry} registry, unauthenticated clients).
 */
export const setTriggersAggregator = (aggregator: TriggersAggregator): void => {
  activeAggregator = aggregator
}

/** Returns the installed {@link TriggersAggregator}, lazily building a default one if none was set. */
export const getTriggersAggregator = (): TriggersAggregator => {
  if (!activeAggregator) {
    activeAggregator = new TriggersAggregator(getServiceRegistry())
  }
  return activeAggregator
}
