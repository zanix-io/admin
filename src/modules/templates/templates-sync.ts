import type {
  SyncCodeTemplateEntry,
  SyncCodeTemplatesResult,
  ZanixTemplateAttrs,
} from '@zanix/notifications'
import type { ServiceRegistryEntry } from 'typings/registry.ts'

import { ProgramModule } from '@zanix/server'
import { TemplatesAdminRepository, toSyncCodeTemplateEntries } from '@zanix/notifications'
import { DiscoveryAdminClient } from 'modules/discovery/discovery.client.ts'
import { getServiceRegistry } from 'modules/registry/registry.ts'
import { realHttpStatus } from 'modules/registry/reachability.ts'

/**
 * Builds the `DiscoveryAdminClient` used to pull a given registered service's own templates
 * Discovery snapshot — the pluggable seam for attaching per-service auth (e.g. a cached `type: 'api'`
 * token from `@zanix/auth`'s `exchangeServiceCredential`/`createServiceAuthClient`). Defaults to an
 * unauthenticated client, which only works against a target that doesn't actually require a token —
 * real deployments should always provide one. May return a `Promise` — attaching a real credential
 * is inherently async (see `createServiceAuthClient`); `syncTemplatesFromRegisteredService` already
 * `await`s the factory's own result before using the client. Used for both `'templates'` (DB-backed,
 * preferred) and `'code-templates'` (fallback) reads — see `syncTemplatesFromRegisteredService`'s own
 * doc.
 */
export type TemplatesDiscoveryClientFactory = (
  service: ServiceRegistryEntry,
) => DiscoveryAdminClient | Promise<DiscoveryAdminClient>

const defaultClientFactory: TemplatesDiscoveryClientFactory = (service) =>
  new DiscoveryAdminClient({ baseUrl: service.adminBaseUrl })

let activeClientFactory: TemplatesDiscoveryClientFactory = defaultClientFactory

/**
 * Installs the {@link TemplatesDiscoveryClientFactory} {@link syncTemplatesFromRegisteredService}
 * uses to pull a registered service's code-templates snapshot. Call once during startup; unset,
 * requests go out unauthenticated (only works against a target that doesn't require a token).
 */
export const setTemplatesDiscoveryClientFactory = (
  factory: TemplatesDiscoveryClientFactory,
): void => {
  activeClientFactory = factory
}

/** Returns the installed {@link TemplatesDiscoveryClientFactory}, or the unauthenticated default. */
export const getTemplatesDiscoveryClientFactory = (): TemplatesDiscoveryClientFactory =>
  activeClientFactory

/**
 * Pulls `serviceId`'s current template set, preferring its **real, current content** over its
 * static code defaults when available, then merges it via `TemplatesAdminRepository.syncCodeTemplates`
 * — the pull-side counterpart of what a `RemoteTemplateBackend` used to push directly as a request
 * body. This is cross-service **orchestration** (resolving `serviceId` via the shared
 * `ServiceRegistry`, fetching over HTTP), not data access — the actual merge logic lives in
 * `@zanix/notifications`, the real owner of the templates collection; this package only wires the
 * two together, the same role it already plays composing `createTemplatesController`.
 *
 * Two possible sources, tried in order (see {@link pullTemplateEntries}):
 * 1. **`'templates'`** — `serviceId`'s own DB-backed Discovery snapshot (this package's own
 *    `/.well-known/zanix/templates`, only present when that service has `admin` + DB-backed
 *    templates enabled) — the real, currently-live content, including any manual edit. A strict
 *    superset of source 2 below, so preferred whenever reachable.
 * 2. **`'code-templates'`** — `@zanix/notifications`'s own `/.well-known/zanix/code-templates`
 *    (`defineCodeTemplatesDiscovery`) — the static in-code catalog only, present on any service
 *    using `@zanix/notifications` regardless of whether it has DB-backed templates at all. Always
 *    reachable if the target supports Mode C sync in the first place; the fallback of source 1.
 *
 * Either way, entries are merged through the exact same `syncCodeTemplates` — its contract (seed
 * additively, never overwrite this service's own manual edit) doesn't depend on where the entries
 * originated, so pulling "real" content from source 1 needs no separate merge algorithm: it's simply
 * treated as this service's own authoritative defaults, the same as source 2 always has been.
 *
 * Resolves `TemplatesAdminRepository` directly via `ProgramModule.providers` (a `@Provider`,
 * globally resolvable) rather than through `TemplatesAdminService` (an `@Interactor`, scoped to a
 * real request context this plain function doesn't have) — the same reach-in pattern
 * `createTemplatesDiscoveryProvider` already uses for its own snapshot.
 *
 * @throws {InternalError} If `serviceId` isn't registered — see `ServiceRegistry.get`.
 */
export async function syncTemplatesFromRegisteredService(
  serviceId: string,
  updatedBy?: string,
): Promise<SyncCodeTemplatesResult> {
  const service = getServiceRegistry().get(serviceId)
  const client = await getTemplatesDiscoveryClientFactory()(service)
  const entries = await pullTemplateEntries(client)
  return ProgramModule.providers.get(TemplatesAdminRepository)
    .syncCodeTemplates(
      entries,
      updatedBy as never,
    )
}

/**
 * Prefers `'templates'` (DB-backed, real current content) over `'code-templates'` (static code
 * defaults) — see {@link syncTemplatesFromRegisteredService}'s own doc for why. Falls back to
 * `'code-templates'` whenever `'templates'` specifically isn't reachable — not registered at all
 * (`404`, the target has no DB-backed templates enabled), or this caller's credentials aren't
 * authorized for it specifically (`401`/`403` — `'templates'` is guard-gated by
 * `ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE`, unlike `'code-templates'`, which defaults to no guard at
 * all). Any other failure (network error, timeout, `5xx`) propagates as-is, uncaught — that
 * indicates a genuine outage that would fail the fallback attempt too, so masking it here would
 * only hide a real problem, not route around one.
 *
 * Deliberately does **not** treat a successful-but-empty `'templates'` response as a reason to try
 * `'code-templates'` too, even though that can happen transiently (a Mode A/B target's own
 * `LocalTemplateBackend` sync is lazy — only runs on that service's first `resolve()`/`preload()`
 * call — so its collection can briefly be empty right after boot). An empty `200` is
 * indistinguishable, from here, from a target that genuinely has zero active templates by its own
 * choice (deleted them, never populated them, deliberately doesn't want the central defaults
 * imposed on it); falling back in that case would silently resurrect code content the target
 * doesn't want synced. `'templates'`, once it exists at all for a target, is always treated as the
 * authoritative answer — empty included.
 *
 * Deliberately does **not** inspect any `ZanixTemplateAttrs` field itself (which one carries
 * content, which means "skip me") — that's `@zanix/notifications`'s own contract, not something
 * this package should know or decide; {@link toSyncCodeTemplateEntries} (exported by the actual
 * data owner) does that translation, this function only picks which resource to ask for.
 */
async function pullTemplateEntries(
  client: DiscoveryAdminClient,
): Promise<SyncCodeTemplateEntry[]> {
  try {
    const entries = await client.snapshot<ZanixTemplateAttrs>('templates')
    return toSyncCodeTemplateEntries(entries)
  } catch (error) {
    const status = realHttpStatus(error)
    if (status !== 404 && status !== 401 && status !== 403) throw error
  }

  return await client.snapshot<SyncCodeTemplateEntry>('code-templates')
}
