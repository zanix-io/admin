import type {
  DLQDiscardOptions,
  DLQEntryAttrs,
  DLQPushInput,
  DLQRequeueOptions,
} from '@zanix/database'
import type { ServiceRegistryEntry } from 'typings/registry.ts'
import type { ServiceRegistry } from 'modules/registry/registry.ts'

import logger from '@zanix/logger'
import { DlqAdminClient } from './dlq.client.ts'
import { DiscoveryAdminClient } from 'modules/discovery/discovery.client.ts'
import { getServiceRegistry } from 'modules/registry/registry.ts'

/** A DLQ entry fanned out from `list()`, tagged with which registered service it came from. */
export type AggregatedDlqEntry = DLQEntryAttrs & { serviceId: string }

/**
 * Builds the `DlqAdminClient` used to call a given registered service — the pluggable seam for
 * attaching per-service auth (e.g. a cached `type: 'api'` token from `@zanix/auth`'s
 * `exchangeServiceCredential`/`createServiceAuthClient`). Defaults to an unauthenticated client,
 * which only works against a target that doesn't actually require a token — real deployments
 * should always provide one. May return a `Promise` — attaching a real credential is inherently
 * async (it has to sign+exchange, at least on a cache miss — see `createServiceAuthClient`), so
 * every call site in this class already `await`s the factory's own result before using the client.
 * Same shape as `TriggersAggregator`'s own `TriggersClientFactory`.
 */
export type DlqClientFactory = (
  service: ServiceRegistryEntry,
) => DlqAdminClient | Promise<DlqAdminClient>

/**
 * Builds the `DiscoveryAdminClient` `list()` uses to fetch a service's `/.well-known/zanix/dlq`
 * snapshot — the same pluggable-auth seam as {@link DlqClientFactory}, kept separate since a plain
 * read (Discovery) and a CRUD/mutation call may reasonably want different credentials. May return a
 * `Promise`, same reason as {@link DlqClientFactory}.
 */
export type DlqDiscoveryClientFactory = (
  service: ServiceRegistryEntry,
) => DiscoveryAdminClient | Promise<DiscoveryAdminClient>

const defaultClientFactory: DlqClientFactory = (service) =>
  new DlqAdminClient({ baseUrl: service.adminBaseUrl })

const defaultDiscoveryClientFactory: DlqDiscoveryClientFactory = (
  service,
) => new DiscoveryAdminClient({ baseUrl: service.adminBaseUrl })

/**
 * `zanix-admin`'s DLQ (Dead Letter Queue) **proxy/aggregator** — mirrors `TriggersAggregator`
 * exactly, one domain over: it never owns or duplicates any service's own persisted DLQ collection.
 * `list()` fans out to every registered service's own `/.well-known/zanix/dlq` Discovery snapshot
 * and merges the results tagged by origin service (a plain read, so it goes through Discovery
 * rather than the CRUD API — see `@zanix/server`'s `docs/applications.md`'s "Discovery" section;
 * note that snapshot is itself narrower than the full collection — only `'pending'`/`'claimed'`/
 * `'failed'` entries, capped per status — see `@zanix/datamaster`'s `createDlqDiscoveryProvider` for
 * why); every other operation resolves which service owns the given entry (via the caller-supplied
 * `serviceId`) and proxies straight to that service's own `/admin/dlq` CRUD API — this class never
 * touches another service's database directly.
 *
 * Deliberately excludes the lease-fenced worker-only primitives (`claim`/`release`/`complete`/
 * `fail`) — same reasoning `DLQAdminService`'s own JSDoc gives: they're fenced by a `leaseOwner` a
 * specific worker process holds, not something a remote admin/agent has a real lease to present.
 * Every method here maps 1:1 onto `DLQAdminService`'s own exposed subset
 * (`push`/`get`/`list`/`requeue`/`discard`/`remove`).
 *
 * A single service failing during `list()`'s fan-out fails the whole call (via `Promise.all`) —
 * deliberately simple for now; a deployment that needs partial-failure tolerance (some services
 * unreachable, still show the rest) should catch per-service instead, e.g. by supplying a
 * `discoveryClientFactory` that already wraps failures into an empty result, or by composing its
 * own `Promise.allSettled` around `registry.list()` directly.
 */
export class DlqAggregator {
  #registry: ServiceRegistry
  #createClient: DlqClientFactory
  #createDiscoveryClient: DlqDiscoveryClientFactory

  /**
   * Builds the aggregator against `registry`, defaulting `clientFactory`/`discoveryClientFactory`
   * to unauthenticated `DlqAdminClient`/`DiscoveryAdminClient` instances when not given.
   */
  constructor(
    registry: ServiceRegistry,
    clientFactory: DlqClientFactory = defaultClientFactory,
    discoveryClientFactory: DlqDiscoveryClientFactory = defaultDiscoveryClientFactory,
  ) {
    this.#registry = registry
    this.#createClient = clientFactory
    this.#createDiscoveryClient = discoveryClientFactory
  }

  /**
   * Fans out to every registered service's own `/.well-known/zanix/dlq` Discovery snapshot, tagged
   * by origin `serviceId`. A read-only operation, so it goes through Discovery rather than the CRUD
   * API's own `GET /admin/dlq` — see this class's own doc.
   */
  public async list(): Promise<AggregatedDlqEntry[]> {
    const services = this.#registry.list()

    const perService = await Promise.all(services.map(async (service) => {
      try {
        const client = await this.#createDiscoveryClient(service)
        const entries = await client.snapshot<DLQEntryAttrs>('dlq')
        return entries.map((entry) => ({
          ...entry,
          serviceId: service.serviceId,
        }))
      } catch (error) {
        // Logged (not swallowed) — see this class's own doc: a single service failing here fails
        // the whole `Promise.all` fan-out, so this is the only chance to record WHICH service was
        // the culprit before the aggregate rejection loses that detail.
        logger.error(
          `[ADMIN_DLQ_DISCOVERY_FAILED] Failed to fetch the dead-letter queue Discovery snapshot ` +
            `from registered service "${service.serviceId}" (${service.adminBaseUrl}).`,
          error,
        )
        throw error
      }
    }))

    return perService.flat()
  }

  /** Gets a single DLQ entry from the given service. */
  public async get(serviceId: string, id: string): Promise<DLQEntryAttrs> {
    const service = this.#registry.get(serviceId)
    try {
      const client = await this.#createClient(service)
      return await client.get(id)
    } catch (error) {
      logger.error(
        `[ADMIN_DLQ_PROXY_FAILED] Failed to get dead-letter queue entry "${id}" from registered ` +
          `service "${serviceId}" (${service.adminBaseUrl}).`,
        error,
      )
      throw error
    }
  }

  /** Pushes a new DLQ entry onto the given service. */
  public async push(
    serviceId: string,
    input: DLQPushInput,
  ): Promise<DLQEntryAttrs> {
    const service = this.#registry.get(serviceId)
    try {
      const client = await this.#createClient(service)
      return await client.push(input)
    } catch (error) {
      logger.error(
        `[ADMIN_DLQ_PROXY_FAILED] Failed to push a dead-letter queue entry (processType ` +
          `"${input.processType}") onto registered service "${serviceId}" ` +
          `(${service.adminBaseUrl}).`,
        error,
      )
      throw error
    }
  }

  /** Requeues a DLQ entry on the given service. */
  public async requeue(
    serviceId: string,
    id: string,
    options?: DLQRequeueOptions,
  ): Promise<DLQEntryAttrs> {
    const service = this.#registry.get(serviceId)
    try {
      const client = await this.#createClient(service)
      return await client.requeue(id, options)
    } catch (error) {
      logger.error(
        `[ADMIN_DLQ_PROXY_FAILED] Failed to requeue dead-letter queue entry "${id}" on registered ` +
          `service "${serviceId}" (${service.adminBaseUrl}).`,
        error,
      )
      throw error
    }
  }

  /** Discards a DLQ entry on the given service. */
  public async discard(
    serviceId: string,
    id: string,
    options?: DLQDiscardOptions,
  ): Promise<DLQEntryAttrs> {
    const service = this.#registry.get(serviceId)
    try {
      const client = await this.#createClient(service)
      return await client.discard(id, options)
    } catch (error) {
      logger.error(
        `[ADMIN_DLQ_PROXY_FAILED] Failed to discard dead-letter queue entry "${id}" on registered ` +
          `service "${serviceId}" (${service.adminBaseUrl}).`,
        error,
      )
      throw error
    }
  }

  /** Deletes a DLQ entry from the given service. */
  public async remove(serviceId: string, id: string): Promise<void> {
    const service = this.#registry.get(serviceId)
    try {
      const client = await this.#createClient(service)
      await client.remove(id)
    } catch (error) {
      logger.error(
        `[ADMIN_DLQ_PROXY_FAILED] Failed to remove dead-letter queue entry "${id}" from registered ` +
          `service "${serviceId}" (${service.adminBaseUrl}).`,
        error,
      )
      throw error
    }
  }
}

let activeAggregator: DlqAggregator | undefined

/**
 * Installs the {@link DlqAggregator} instance the hub's DLQ controller/`operations` call into — the
 * seam an app uses to supply its own {@link DlqClientFactory}/{@link DlqDiscoveryClientFactory}
 * (real per-service auth) before `Zanix.start()`. Call once during startup; unset,
 * {@link getDlqAggregator} falls back to a default instance (the shared {@link getServiceRegistry}
 * registry, unauthenticated clients). Same shape as `setTriggersAggregator`.
 */
export const setDlqAggregator = (aggregator: DlqAggregator): void => {
  activeAggregator = aggregator
}

/** Returns the installed {@link DlqAggregator}, lazily building a default one if none was set. */
export const getDlqAggregator = (): DlqAggregator => {
  if (!activeAggregator) {
    activeAggregator = new DlqAggregator(getServiceRegistry())
  }
  return activeAggregator
}
