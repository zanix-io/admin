/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * @module
 *
 * `zanix-admin` — a centralized service for orchestrating triggers/templates across Zanix
 * business services — see this package's own README for the full design.
 *
 * This is a **library**, not a single deployable app — any team stands up its own admin service by
 * importing this package, either via {@link ZanixAdminHub}'s reference `start()`/`stop()` (the
 * quickest path) or by wiring `createTriggersController()`/`createTemplatesSyncController()` into
 * its own `@zanix/server`/`@zanix/core`-based bootstrap directly. See the README for both.
 */

export {
  getServiceRegistry,
  SERVICE_REGISTRY_ENV,
  ServiceRegistry,
  setServiceRegistry,
} from 'modules/registry/registry.ts'
export type { ServiceRegistryEntry } from 'typings/registry.ts'
export { checkServiceRegistryReachability } from 'modules/registry/reachability.ts'
export type { ReachabilityResult } from 'modules/registry/reachability.ts'
export { createServiceRegistryAuthHeaders } from 'modules/registry/auth.ts'
/** Re-exported so `createTemplatesDiscoveryProvider`'s own return type is nameable. */
export type { DiscoveryProvider } from '@zanix/server'

export {
  ADMIN_APPLICATION,
  ADMIN_DLQ_APPLICATION_ENV,
  ADMIN_DLQ_ROLE,
  ADMIN_HUB_APPLICATION,
  ADMIN_PROTOCOL_SUPPORTED_VERSIONS,
  ADMIN_PROTOCOL_VERSION,
  ADMIN_ROLE,
  ADMIN_TEMPLATES_APPLICATION_ENV,
  ADMIN_TEMPLATES_ROLE,
  ADMIN_TRIGGERS_APPLICATION_ENV,
  ADMIN_TRIGGERS_ROLE,
} from 'utils/constants.ts'

/**
 * Registers this package's business-service-side admin controllers (`/admin/triggers`,
 * `/admin/templates`, `/admin/dlq`, `/admin/service-token`) — the counterpart a central
 * `zanix-admin` deployment calls *into*. Called by `@zanix/core`'s own `start()`; see this symbol's
 * own doc for the full per-controller composition behavior and the three `*_APPLICATION` env var
 * overrides.
 */
export { defineAdminMetadata } from 'modules/metadata.ts'
/**
 * Builds this package's own central aggregator/proxy Zanix App (`/triggers`, `/templates`) — what
 * {@link ZanixAdminHub.start} activates internally; exported so a host that composes its own set of
 * Zanix Apps via `Zanix.start({ apps: {...} })`/`activateApps` directly can install this one
 * alongside its own, without going through {@link ZanixAdminHub} at all. See its own doc for the
 * options it accepts and the `'service-registry'` resource it declares.
 */
export {
  type AdminHubAppOptions,
  type AdminHubSubAppOptions,
  type AdminStartApplication,
  defineAdminHubApp,
  getAdminHubSubApps,
} from 'modules/admin-hub-app.ts'
/**
 * Builds this package's embedded, business-service-side admin Zanix App (`/admin/triggers`,
 * `/admin/templates`, `/admin/service-token`) — what `@zanix/core`'s own `admin: true` option
 * activates internally. Exported for the same direct-composition reason as
 * {@link defineAdminHubApp}.
 */
export { defineLocalAdminApp, getLocalAdminSubApps } from 'modules/local-admin-app.ts'
/**
 * The default guard (`ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE`) for any templates-shaped Discovery
 * surface — this package's own `/.well-known/zanix/templates` and `@zanix/core`'s
 * `codeTemplatesDiscovery` option (`/.well-known/zanix/code-templates`) both use it, so the two
 * don't drift out of sync on who's allowed to read a template list. See its own doc.
 */
export { createTemplatesDiscoveryGuard } from 'modules/metadata.ts'
// Re-exported from `@zanix/server` (not defined here) so a business service's own admin
// controller can use the same header name without depending on this package.
export { ADMIN_PROTOCOL_HEADER } from '@zanix/server'

/**
 * Data access and business logic for this package's own templates collection — see
 * `@zanix/notifications`'s own `docs/templates.md` for the storage model this operates under.
 * Imported from `@zanix/notifications/templates-api`, not the root barrel: that root also bundles
 * unrelated connectors/providers reaching `graphql`/`redis`, which this package's own templates
 * composition never needs.
 */
export { TemplatesAdminRepository, TemplatesAdminService } from '@zanix/notifications/templates-api'
/** Re-exported so `syncTemplatesFromRegisteredService`'s own return type is nameable. */
export type { SyncCodeTemplatesResult } from '@zanix/notifications/templates-types'
/**
 * `POST /templates/sync` request DTO — see `createTemplatesSyncController`'s own doc.
 */
export { SyncTemplatesRTO } from 'modules/templates/rtos/templates.rto.ts'
/**
 * `create`/`update` request DTOs backing both this package's own `/triggers` proxy and, via
 * `@zanix/core`'s own re-export, its built-in `/admin/triggers` — the same wire shape either way,
 * since a proxying request forwards this body to the target service's own admin API unchanged.
 */
export { CreateTriggerRTO, UpdateTriggerRTO } from 'modules/triggers/rtos/triggers.rto.ts'
/**
 * Route params RTOs backing `createTriggersController`'s `/triggers/:serviceId[/:model]` routes —
 * re-exported so those routes' own return types stay nameable in the generated docs.
 */
export type {
  TriggerServiceModelParamsRTO,
  TriggerServiceParamsRTO,
} from 'modules/triggers/rtos/triggers.rto.ts'
/**
 * `push`/`requeue`/`discard` request DTOs backing both this package's own `/dlq` proxy and
 * `@zanix/datamaster`'s own built-in `/admin/dlq` — the same wire shape either way, same reasoning
 * as `CreateTriggerRTO`/`UpdateTriggerRTO` above.
 */
export {
  DiscardDlqEntryRTO,
  PushDlqEntryRTO,
  RequeueDlqEntryRTO,
} from 'modules/dlq/rtos/dlq.rto.ts'
// Deprecated aliases — `@zanix/datamaster` converged its own DLQ acronym casing from `DLQ` to
// `Dlq`; these re-export the exact same bindings under their old names for one deprecation window,
// same pattern as `@zanix/datamaster`'s own `[Unreleased]` CHANGELOG entry.
/** @deprecated Use {@link DiscardDlqEntryRTO} instead — this alias will be removed in a future
 * major release. */
export { DiscardDlqEntryRTO as DiscardDLQEntryRTO } from 'modules/dlq/rtos/dlq.rto.ts'
/** @deprecated Use {@link PushDlqEntryRTO} instead — this alias will be removed in a future major
 * release. */
export { PushDlqEntryRTO as PushDLQEntryRTO } from 'modules/dlq/rtos/dlq.rto.ts'
/** @deprecated Use {@link RequeueDlqEntryRTO} instead — this alias will be removed in a future
 * major release. */
export { RequeueDlqEntryRTO as RequeueDLQEntryRTO } from 'modules/dlq/rtos/dlq.rto.ts'
/**
 * Route params RTOs backing `createDlqController`'s `/dlq/:serviceId[/:id]` routes — re-exported so
 * those routes' own return types stay nameable in the generated docs.
 */
export type { DlqServiceEntryParamsRTO, DlqServiceParamsRTO } from 'modules/dlq/rtos/dlq.rto.ts'

/**
 * Data access and business logic for a business service's own persisted local triggers collection
 * (`zanix-triggers`), distinct from this package's own `/triggers` proxy/aggregator.
 */
export { TriggersAdminRepository, TriggersAdminService } from '@zanix/datamaster/triggers-api'

/** Body RTO for `/admin/service-token` — see `createServiceExchangeController`. */
export { ServiceExchangeRTO } from 'modules/service-exchange/service-exchange.rto.ts'
/**
 * Builds the machine-to-machine credential-exchange controller (`/admin/service-token`) — a thin
 * wrapper around `@zanix/auth`'s `exchangeServiceCredential`, reused as-is. No role gate (the
 * caller has no session yet — the whole point of calling this endpoint is to obtain one); trust
 * comes entirely from `exchangeServiceCredential`'s own `JWK_PUB_<serviceId>` verification. See
 * `@zanix/auth`'s `docs/service-credential.md`.
 */
export {
  createServiceExchangeController,
  type ServiceExchangeControllerInstance,
} from 'modules/service-exchange/service-exchange.handler.ts'

/**
 * Thin HTTP clients for calling a business service's own `/admin/triggers`/`/admin/templates`/
 * `/admin/dlq` API remotely — the client-side counterpart of this package owning the
 * admin-protocol contract (see this README's "Admin APIs" section). `TriggersAggregator`/
 * `DlqAggregator` use `TriggersAdminClient`/`DlqAdminClient` internally; all are exported so any
 * other caller reuses this single implementation of the request/response contract instead of a
 * hand-rolled client that can drift from what the controllers actually accept.
 */
export { TriggersAdminClient } from 'modules/triggers/triggers.client.ts'
export { TemplatesAdminClient } from 'modules/templates/templates.client.ts'
export { DlqAdminClient } from 'modules/dlq/dlq.client.ts'
/** Query params `DlqAdminClient.list()` accepts — re-exported so that method's own signature stays
 * nameable in the generated docs. */
export type { DlqListQuery } from 'modules/dlq/dlq.client.ts'
/**
 * Thin HTTP client for a registered service's own `/.well-known/zanix/{resourceType}` Discovery
 * endpoint — see `@zanix/server`'s `docs/applications.md`'s "Discovery" section.
 * `TriggersAggregator.list()`/`syncTemplatesFromRegisteredService` both use this internally;
 * exported for the same reuse reason as `TriggersAdminClient`/`TemplatesAdminClient`.
 */
export { DiscoveryAdminClient } from 'modules/discovery/discovery.client.ts'

/**
 * Thin HTTP clients for calling `zanix-admin`'s OWN hub-side `/triggers`/`/templates`/`/registry`/
 * `/dlq` routes remotely — the hub-facing counterpart of the service-facing clients just above.
 * **Don't confuse the two levels**: `TriggersAdminClient`/`TemplatesAdminClient`/`DlqAdminClient`
 * each call a business SERVICE's own local `/admin/<x>` API; `TriggersHubClient`/`TemplatesHubClient`/
 * `RegistryHubClient`/`DlqHubClient` each call `zanix-admin`'s own central hub deployment instead
 * (e.g. `@zanix/console`, an external ops UI, is the intended caller — not this package's own
 * aggregators, which already talk to the hub in-process). `TemplatesHubClient` is CRUD-only — the hub
 * never composes `POST /templates/sync` (see that client's own doc for why). `DlqHubClient`'s own
 * `list()` never accepts `DlqAdminClient.list()`'s own filters — see that client's own doc for why.
 */
export { TriggersHubClient } from 'modules/triggers/triggers-hub.client.ts'
export { TemplatesHubClient } from 'modules/templates/templates-hub.client.ts'
export { RegistryHubClient } from 'modules/registry/registry-hub.client.ts'
export { DlqHubClient } from 'modules/dlq/dlq-hub.client.ts'

export {
  type AggregatedTrigger,
  getTriggersAggregator,
  setTriggersAggregator,
  TriggersAggregator,
  type TriggersClientFactory,
  type TriggersDiscoveryClientFactory,
} from 'modules/triggers/triggers.aggregator.ts'
export {
  type AggregatedDlqEntry,
  DlqAggregator,
  type DlqClientFactory,
  type DlqDiscoveryClientFactory,
  getDlqAggregator,
  setDlqAggregator,
} from 'modules/dlq/dlq.aggregator.ts'

/**
 * Builds `zanix-admin`'s triggers API — a proxy/aggregator over every registered service's own
 * `/admin/triggers`, never an owner of any trigger data itself. Reads/writes go through whichever
 * `TriggersAggregator` `setTriggersAggregator` installed (a sensible unauthenticated default is
 * used otherwise — see `getTriggersAggregator`). See `TriggersControllerOptions` to change the
 * route prefix; which Application this route belongs to is decided by whichever
 * `defineApplication(...)` scope is active when the caller invokes this factory.
 */
export {
  createTriggersController,
  type TriggersControllerInstance,
  type TriggersControllerOptions,
} from 'modules/triggers/triggers.handler.ts'
/**
 * Builds `zanix-admin`'s DLQ (Dead Letter Queue) API — a proxy/aggregator over every registered
 * service's own `/admin/dlq`, never an owner of any DLQ data itself. Same shape as
 * `createTriggersController`, one domain over — see `setDlqAggregator`/`getDlqAggregator`.
 */
export {
  createDlqController,
  type DlqControllerInstance,
  type DlqControllerOptions,
} from 'modules/dlq/dlq.handler.ts'
/**
 * Builds `zanix-admin`'s Service Registry read API (`GET /registry`) — a single read-only route
 * reflecting whichever `ServiceRegistry` `setServiceRegistry`/{@link getServiceRegistry} resolves.
 * Always composed by `defineAdminHubApp` (no `false` opt-out) — see its own doc for why.
 */
export {
  createRegistryController,
  type RegistryControllerInstance,
  type RegistryControllerOptions,
} from 'modules/registry/registry.handler.ts'

/**
 * Builds `zanix-admin`'s own cross-service extension to the templates resource (`POST
 * /templates/sync`) — a batch, upsert-aware endpoint that pulls a registered service's current
 * template set via its own Discovery endpoint, given just its `serviceId`. Meant to be mounted
 * alongside `@zanix/notifications`'s own templates CRUD controller
 * (`@zanix/notifications/templates-api`), under the same route prefix, composing into ONE apparent
 * `/templates` resource from an external caller's point of view. See
 * `TemplatesSyncControllerOptions` to change the route prefix.
 */
export {
  createTemplatesSyncController,
  type TemplatesSyncControllerInstance,
  type TemplatesSyncControllerOptions,
} from 'modules/templates/templates-sync.handler.ts'

/**
 * Pulls a registered service's current code-defined template set from its own
 * `/.well-known/zanix/code-templates` Discovery snapshot, then merges it into this service's own
 * templates collection — the pull-side orchestration behind `POST /templates/sync` (see
 * `createTemplatesSyncController`'s own doc). Cross-service orchestration, not data access — the
 * actual merge logic lives in `@zanix/notifications`'s `TemplatesAdminRepository.syncCodeTemplates`,
 * which this only calls into.
 */
export {
  getTemplatesDiscoveryClientFactory,
  setTemplatesDiscoveryClientFactory,
  syncTemplatesFromRegisteredService,
  type TemplatesDiscoveryClientFactory,
} from 'modules/templates/templates-sync.ts'

/**
 * Reference deployable entrypoint — see `modules/zanix-admin-hub.ts`'s own doc for the full
 * rationale. Re-exported here so an existing `import ZanixAdminHub from '@zanix/admin'` call site
 * keeps working unchanged; a caller that wants ONLY this class (not the RTOs/`TriggersAdminService`/
 * thin HTTP clients this root barrel also bundles, which reach `@zanix/notifications/templates-api`
 * — and transitively Handlebars — unconditionally) should import `@zanix/admin/hub` instead.
 */
export { default } from 'modules/zanix-admin-hub.ts'
