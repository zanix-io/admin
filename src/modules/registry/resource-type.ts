import { registerResourceType } from '@zanix/app/runtime'
import type { CloseableResource } from '@zanix/app/runtime'
import { getServiceRegistry, ServiceRegistry, setServiceRegistry } from './registry.ts'
import type { ServiceRegistryEntry } from 'typings/registry.ts'

/**
 * Registers the `'service-registry'` resource type — the extension point `@zanix/app/runtime`'s
 * own `resource-types.ts` documents for "a host that wants a resource type this package has never
 * heard of" (this package, not `@zanix/app` itself: `@zanix/app` never depends on `@zanix/admin`,
 * so this type can't live pre-seeded there without creating a dependency cycle, since
 * `@zanix/admin` already depends on `@zanix/app` for `defineZanixApp`).
 *
 * This is the DI-graph side of the two initialization paths documented on {@link setServiceRegistry}
 * — a Zanix App (e.g. `defineAdminHubApp`) declaring `resources: {registry: {type:
 * 'service-registry', ...}}` reaches THIS factory via `ctx.resource('registry')`. The other
 * supported path (wiring `createTriggersController()`/`createTemplatesController()` directly into a
 * caller's own bootstrap, with no Zanix App/DI graph at all) never runs this factory and configures
 * {@link ServiceRegistry} by calling {@link setServiceRegistry} directly instead — both paths still
 * end up sharing the exact same installed instance, by construction, via the reuse rule below.
 *
 * No explicit `options.entries` (the common case — e.g. `defineAdminHubApp`'s own default
 * `resources.registry`) reuses whatever {@link getServiceRegistry} already resolves — a registry
 * installed ahead of time via {@link setServiceRegistry} (e.g. by the direct-wiring path above, or
 * by a previous resolution of this same resource) is never clobbered by this resource resolving;
 * `getServiceRegistry`'s own lazy default (env-var-only) applies otherwise. Explicit
 * `options.entries` builds and installs a fresh instance instead — a host overriding this slot
 * through `resources`/`uses` specifically wants THESE entries, not whatever happened to be
 * installed already.
 *
 * Either way, installs the result via {@link setServiceRegistry} — the single point both
 * initialization paths above install into — so `TriggersAggregator`/`TemplatesAdminService`, which
 * resolve the registry via {@link getServiceRegistry} rather than through a Zanix App's own
 * `ctx.resource()` (they run from plain functions/classic `@zanix/server` controllers that have no
 * DI graph to resolve from at all — see `templates-sync.handler.ts`'s `sync()` route), see the exact same
 * instance `ctx.resource('registry')` resolves to for any Zanix App declaring this slot. One
 * registry per process, reachable both ways by design — not two independently-built instances.
 *
 * {@link ServiceRegistry} itself has no `close()` — it's static, in-memory config with nothing to
 * release. The no-op below satisfies `CloseableResource` without adding a lifecycle method to the
 * real class for a need it doesn't have.
 *
 * A side-effecting module-level call, by design (same pattern as this package's own
 * `defineAdminMetadata`/`start.ts` side-effect imports) — importing this file for its side effect
 * is what makes `'service-registry'` resolvable by any Zanix App manifest that declares it; merely
 * importing `@zanix/admin` for its other exports never triggers this on its own unless something
 * imports this module specifically.
 */
registerResourceType('service-registry', (options) => {
  const entries = options.entries as ServiceRegistryEntry[] | undefined
  const registry = Object.assign(
    entries ? new ServiceRegistry(entries) : getServiceRegistry(),
    {
      close: (): void => {},
    },
  )

  setServiceRegistry(registry)
  return registry as ServiceRegistry & CloseableResource
})
