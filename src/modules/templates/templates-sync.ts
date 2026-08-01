import type { SyncCodeTemplateEntry, SyncCodeTemplatesResult } from '@zanix/notifications'
import type { ServiceRegistryEntry } from 'typings/registry.ts'

import { ProgramModule } from '@zanix/server'
import { TemplatesAdminRepository } from '@zanix/notifications'
import { DiscoveryAdminClient } from 'modules/discovery/discovery.client.ts'
import { getServiceRegistry } from 'modules/registry/registry.ts'

/**
 * Builds the `DiscoveryAdminClient` used to pull a given registered service's own code-templates
 * Discovery snapshot — the pluggable seam for attaching per-service auth (e.g. a cached `type: 'api'`
 * token from `@zanix/auth`'s `exchangeServiceCredential`). Defaults to an unauthenticated client,
 * which only works against a target that doesn't actually require a token — real deployments should
 * always provide one.
 */
export type TemplatesDiscoveryClientFactory = (
  service: ServiceRegistryEntry,
) => DiscoveryAdminClient

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
 * Pulls `serviceId`'s current code-defined template set from its own
 * `/.well-known/zanix/code-templates` Discovery snapshot (see `@zanix/notifications`'s
 * `defineCodeTemplatesDiscovery`), then merges it via `TemplatesAdminRepository.syncCodeTemplates`
 * — the pull-side counterpart of what a `RemoteTemplateBackend` used to push directly as a request
 * body. This is cross-service **orchestration** (resolving `serviceId` via the shared
 * `ServiceRegistry`, fetching over HTTP), not data access — the actual merge logic lives in
 * `@zanix/notifications`, the real owner of the templates collection; this package only wires the
 * two together, the same role it already plays composing `createTemplatesController`.
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
  const client = getTemplatesDiscoveryClientFactory()(service)
  const entries = await client.snapshot<SyncCodeTemplateEntry>('code-templates')
  return ProgramModule.providers.get(TemplatesAdminRepository).syncCodeTemplates(entries, updatedBy)
}
