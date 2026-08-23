import type { ServiceRegistryEntry } from 'typings/registry.ts'

import { InternalError } from '@zanix/errors'

/**
 * Env var carrying the static service registry as a JSON array of {@link ServiceRegistryEntry} —
 * e.g. `[{"serviceId":"billing","adminBaseUrl":"http://billing.internal:30248/billing-rest"}]`.
 * Merged with whatever entries are passed directly to {@link ServiceRegistry}'s constructor —
 * on a `serviceId` collision, this env var's entry overrides the constructor one.
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
   * Builds the registry, seeding it with `entries` and then merging in whatever
   * {@link SERVICE_REGISTRY_ENV} provides.
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
      // No `cause` here, unlike `readFromEnv`'s own throw below — this is a lookup miss against
      // `#entries`, not a caught exception, so there's no underlying error to attach.
      throw new InternalError(
        `No registered service found for "${serviceId}".`,
        {
          code: 'UNKNOWN_SERVICE',
          meta: { source: 'zanix', serviceId },
        },
      )
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
 * Installs the process-wide {@link ServiceRegistry} instance — the deliberate, necessary
 * configuration point for BOTH ways this package supports initializing:
 *
 * 1. `ZanixAdminHub.start()` → `defineAdminHubApp()` → a real `@zanix/app` DI graph, where
 *    `ctx.resource('registry')` resolves this same instance (see `./resource-type.ts`'s
 *    `'service-registry'` resource factory, which calls this function as its own last step — so a
 *    Zanix App's `ctx.resource('registry')` and this module's {@link getServiceRegistry} always
 *    agree on the exact same instance, by construction, never two independently-built ones).
 * 2. Wiring `createTriggersController()`/`createTemplatesController()` directly into a caller's own
 *    `@zanix/core`/`@zanix/server` bootstrap, with no Zanix App, no manifest, and consequently no DI
 *    graph at all (see this package's own module doc, `mod.ts`) — for that path there is no
 *    `ctx.resource()` to resolve anything from, so this plain function is the ONLY configuration
 *    entrypoint available, not a fallback for a DI mechanism this path could use instead.
 *
 * `TriggersAggregator`/`syncTemplatesFromRegisteredService`/`checkServiceRegistryReachability` all
 * read the same installed instance via {@link getServiceRegistry}, so both paths above end up
 * sharing one registry rather than each holding an independent one that could drift out of sync.
 * Call once during startup; unset, {@link getServiceRegistry} falls back to a default instance
 * (entries from {@link SERVICE_REGISTRY_ENV} only).
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
    throw new InternalError(
      `${SERVICE_REGISTRY_ENV} is not a valid JSON array.`,
      {
        code: 'INVALID_SERVICE_REGISTRY',
        cause,
        meta: { source: 'zanix' },
      },
    )
  }
}
