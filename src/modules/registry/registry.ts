import type { ServiceRegistryEntry } from 'typings/registry.ts'

import { InternalError } from '@zanix/errors'

/**
 * Env var carrying the static service registry as a JSON array of {@link ServiceRegistryEntry} —
 * e.g. `[{"serviceId":"billing","adminBaseUrl":"http://billing.internal:30248/billing-rest"}]`.
 * Merged with (and overridden by, on a `serviceId` collision) whatever entries are passed directly
 * to {@link ServiceRegistry}'s constructor.
 */
export const SERVICE_REGISTRY_ENV = 'ZANIX_ADMIN_SERVICES'

/**
 * The static registry of business services this `zanix-admin` instance knows about — decided to be
 * static config, at least initially. No dynamic self-registration; entries come from
 * {@link SERVICE_REGISTRY_ENV} and/or the constructor, and never change at runtime.
 *
 * @example
 * ```ts
 * const registry = new ServiceRegistry([
 *   { serviceId: 'billing', adminBaseUrl: 'http://billing.internal:30248/billing-rest' },
 * ])
 * const billing = registry.get('billing')
 * ```
 */
export class ServiceRegistry {
  #entries = new Map<string, ServiceRegistryEntry>()

  /**
   * @param entries - Service entries known upfront. Entries from {@link SERVICE_REGISTRY_ENV} are
   * added after these, so an env-configured entry overrides a same-`serviceId` one passed here.
   */
  constructor(entries: ServiceRegistryEntry[] = []) {
    for (const entry of [...entries, ...readFromEnv()]) {
      this.#entries.set(entry.serviceId, entry)
    }
  }

  /**
   * Looks up a registered service by its `serviceId`.
   * @throws {InternalError} If no entry is registered for `serviceId`.
   */
  public get(serviceId: string): ServiceRegistryEntry {
    const entry = this.#entries.get(serviceId)

    if (!entry) {
      throw new InternalError(`No registered service found for "${serviceId}".`, {
        code: 'UNKNOWN_SERVICE',
        meta: { source: 'zanix', serviceId },
      })
    }

    return entry
  }

  /** Whether `serviceId` is registered, without throwing. */
  public has(serviceId: string): boolean {
    return this.#entries.has(serviceId)
  }

  /** Every registered entry. */
  public list(): ServiceRegistryEntry[] {
    return [...this.#entries.values()]
  }
}

let activeRegistry: ServiceRegistry | undefined

/**
 * Installs the {@link ServiceRegistry} instance shared by every consumer that needs to know about
 * registered business services — `TriggersAggregator` (fanning out `/admin/triggers`/Discovery
 * reads) and `TemplatesAdminService` (pulling a service's own code-templates Discovery snapshot)
 * both resolve the same installed instance via {@link getServiceRegistry}, rather than each holding
 * an independent one that could drift out of sync. Call once during startup; unset,
 * {@link getServiceRegistry} falls back to a default instance (entries from
 * {@link SERVICE_REGISTRY_ENV} only).
 */
export const setServiceRegistry = (registry: ServiceRegistry): void => {
  activeRegistry = registry
}

/** Returns the installed {@link ServiceRegistry}, lazily building a default one if none was set. */
export const getServiceRegistry = (): ServiceRegistry => {
  if (!activeRegistry) activeRegistry = new ServiceRegistry()
  return activeRegistry
}

function readFromEnv(): ServiceRegistryEntry[] {
  const raw = Deno.env.get(SERVICE_REGISTRY_ENV)
  if (!raw) return []

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) throw new Error('not an array')
    return parsed
  } catch (cause) {
    throw new InternalError(`${SERVICE_REGISTRY_ENV} is not a valid JSON array.`, {
      code: 'INVALID_SERVICE_REGISTRY',
      cause,
      meta: { source: 'zanix' },
    })
  }
}
