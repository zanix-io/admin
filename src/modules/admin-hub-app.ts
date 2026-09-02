import type { ServiceAuthClientOptions } from '@zanix/auth'
import type { ZanixAppDefinition } from '@zanix/app'

import { defineZanixApp } from '@zanix/app'
import type { DEFAULT_APPLICATION } from '@zanix/server'
import { ProgramModule } from '@zanix/server'
import { jwtValidationGuard } from '@zanix/auth'
import type { TemplatesControllerOptions } from '@zanix/notifications/templates-types'
import {
  AUTH_CORE_SPECIFIER,
  DATAMASTER_CORE_SPECIFIER,
  NOTIFICATIONS_CORE_SPECIFIER,
  NOTIFICATIONS_TEMPLATES_API_SPECIFIER,
} from './lazy/specifiers.ts'
import {
  ADMIN_AUTH_TYPES,
  ADMIN_HUB_APPLICATION,
  ADMIN_ROLE,
  ADMIN_TEMPLATES_ROLE,
} from 'utils/constants.ts'
import { ADMIN_VERSION_PROTOCOL } from './protocol/version-protocol.ts'
import type { TriggersControllerOptions } from './triggers/triggers.handler.ts'
import type { ServiceRegistry } from './registry/registry.ts'
import { createServiceRegistryAuthHeaders } from './registry/auth.ts'
import { setTriggersAggregator, TriggersAggregator } from './triggers/triggers.aggregator.ts'
import { TriggersAdminClient } from './triggers/triggers.client.ts'
import { DlqAggregator, setDlqAggregator } from './dlq/dlq.aggregator.ts'
import { DlqAdminClient } from './dlq/dlq.client.ts'
import { DiscoveryAdminClient } from './discovery/discovery.client.ts'
import { setTemplatesDiscoveryClientFactory } from './templates/templates-sync.ts'
import { createTemplatesSyncController } from './templates/templates-sync.handler.ts'
import type { RegistryControllerOptions } from './registry/registry.handler.ts'
import { defineHubTriggersApp } from './triggers/hub-triggers-app.ts'
import { defineHubTemplatesApp } from './templates/hub-templates-app.ts'
import { defineHubDlqApp } from './dlq/hub-dlq-app.ts'
import type { DlqControllerOptions } from './dlq/dlq.handler.ts'
import './registry/resource-type.ts'

/**
 * Every additional Zanix App `ZanixAdminHub.start()`/a host composing `defineAdminHubApp` directly
 * should activate ALONGSIDE it — today, Triggers'/Templates'/DLQ's own `operations`/`mcp` surfaces,
 * each physically separated into their own file/app identity (`triggers/hub-triggers-app.ts`,
 * `templates/hub-templates-app.ts`, `dlq/hub-dlq-app.ts`) rather than declared inline on
 * `defineAdminHubApp` itself. A future fourth hub sub-app (e.g. GQLIDE/Swagger `operations`) is
 * added here, never by editing `defineAdminHubApp`'s own body — see `getAdminHubSubApps`'s own doc
 * for the composition contract. Each entry's `enabled` predicate reads the SAME
 * `triggers`/`templates`/`dlq` option {@link registerAdminHubModules} already gates that resource's
 * REST controller by, so a new entry here is never accidentally composed on a different signal.
 */
const HUB_SUB_APP_ENTRIES: Array<
  { factory: () => ZanixAppDefinition; enabled: (options: AdminHubSubAppOptions) => boolean }
> = [
  { factory: defineHubTriggersApp, enabled: (options) => options.triggers !== false },
  { factory: defineHubTemplatesApp, enabled: (options) => options.templates !== false },
  { factory: defineHubDlqApp, enabled: (options) => options.dlq !== false },
]

// `serviceToken` (below) is deliberately NOT a fourth entry here — this table exists exclusively
// for a resource's `operations`/`mcp` sub-app (its own physically-separate `ZanixAppDefinition`,
// `routes: false`), never for an arbitrary REST-only controller under `ADMIN_HUB_APPLICATION`.
// `createServiceExchangeController()` declares no `operations`/`mcp` surface of its own to extract —
// it's composed as one more {@link AdminHubModuleEntry} in `defineAdminHubMetadata`'s own table
// instead (below), the SAME mechanism `metadata.ts`'s local-side `defineAdminMetadata` already uses
// for this exact controller, just gated by an opt-in flag instead of being unconditional.

/** The subset of {@link AdminHubAppOptions} that decides which hub sub-app
 * {@link getAdminHubSubApps} composes — same `false`-to-skip meaning those three options already
 * have for the REST side. */
export type AdminHubSubAppOptions = Pick<AdminHubAppOptions, 'triggers' | 'templates' | 'dlq'>

/**
 * Every sub-app `defineAdminHubApp` composes alongside itself, in declaration order — always
 * activated together via ONE `activateApps([defineAdminHubApp(options), ...
 * getAdminHubSubApps(options)])` call (see `start.ts`'s own `startSequence`, which passes the SAME
 * `{ triggers, templates, dlq }` to both), so an app sharing a root resource with
 * `defineAdminHubApp` still resolves to the same instance (the same reason `activateApps` itself
 * takes a list, not one app at a time).
 *
 * Conditional, mirroring `defineAdminHubApp`'s own REST-controller gating exactly — a resource's
 * `operations`/`mcp` sub-app is composed if and only if its REST controller would be too (`options.
 * <resource> !== false`). Before this, e.g. `admin-hub-dlq`'s own `operations` stayed composed even
 * when a caller passed `dlq: false`, a reachable (auth-gated) surface with no REST counterpart —
 * the exact same asymmetry `local-admin-app.ts`'s own `getLocalAdminSubApps()` had, fixed there
 * first (see that function's own doc). `options` defaults to `{}` — every field `undefined`, so
 * every sub-app is composed — matching `defineAdminHubApp()`'s own all-triggers/templates/dlq-on
 * default; a caller not passing `options` at all keeps today's behavior unchanged.
 *
 * Each sub-app declares no `dependencies`/`resources` of its own (see each factory's own doc), so
 * composing more of them costs nothing extra in resource-resolution complexity — only whatever
 * `bootstrapAppServer` calls `start.ts` adds for their own HTTP dispatch-route reachability.
 */
export function getAdminHubSubApps(
  options: AdminHubSubAppOptions = {},
): ZanixAppDefinition[] {
  return HUB_SUB_APP_ENTRIES
    .filter((entry) => entry.enabled(options))
    .map((entry) => entry.factory())
}

/**
 * The only two Applications {@link defineAdminHubApp} itself can ever compose a controller under —
 * `bootstrapAppServer` only ever serves this app's own Application ({@link ADMIN_HUB_APPLICATION}),
 * so accepting any string here would silently register a capability under an Application
 * `ZanixAdminHub.start()` never activates a Runtime for. `'main'` is handled separately, via
 * `start.ts`'s own `wantsPublicRoute` bootstrap.
 */
export type AdminStartApplication =
  | typeof DEFAULT_APPLICATION
  | typeof ADMIN_HUB_APPLICATION

/** Options {@link defineAdminHubApp} accepts — the subset of `StartOptions` (`start.ts`) that
 * shapes what this app registers, as opposed to how it's served. */
export interface AdminHubAppOptions {
  /** Options for the triggers route, or `false` to skip registering it entirely. */
  triggers?:
    | false
    | (TriggersControllerOptions & { application?: AdminStartApplication })
  /** Options for the templates route, or `false` to skip registering it entirely — governs both the
   * CRUD half (`@zanix/notifications/templates-api`'s `createTemplatesController`) and this
   * package's own `POST /templates/sync` extension (`createTemplatesSyncController`), always
   * composed together under the same resolved `prefix`. */
  templates?:
    | false
    | (TemplatesControllerOptions & { application?: AdminStartApplication })
  /** Options for the DLQ (Dead Letter Queue) route, or `false` to skip registering it entirely —
   * same shape as {@link triggers}: this route needs no default guards of its own to build (unlike
   * `templates`, `createDlqController` bakes its own `ADMIN_ROLE`/`ADMIN_DLQ_ROLE`
   * `AuthTokenValidation` in, the same way `createTriggersController` does), so it's composed
   * on-by-default here, mirroring `triggers` rather than `templates`' guard-injection shape. */
  dlq?:
    | false
    | (DlqControllerOptions & { application?: AdminStartApplication })
  /**
   * Opt-in — composes `createServiceExchangeController()` (`POST /admin/service-token`, machine-
   * to-machine credential exchange) directly under {@link ADMIN_HUB_APPLICATION}, the SAME
   * Application `/triggers`/`/templates`/`/dlq`/`/registry` already register under. `false`/omitted
   * (the default) keeps today's exact behavior — this hub composes no service-token endpoint at all,
   * same as before this option existed.
   *
   * This exists to close a real gap: without it, a caller wanting `/admin/service-token` reachable
   * under the SAME base URL as this hub's own routes had no official way to get it — only
   * `@zanix/core`'s `Zanix.start({ admin: true })`/`defineLocalAdminApp()` compose that controller,
   * under the DIFFERENT `ADMIN_APPLICATION` (a business service's own local admin surface, not this
   * hub's). Manually calling `createServiceExchangeController()` yourself inside your own
   * `ProgramModule.defineApplication(ADMIN_HUB_APPLICATION, ...)` scope remains equally valid — this
   * option is a thin convenience over exactly that, with no behavior of its own beyond it.
   *
   * **Not meant to be combined with anchoring (`ADMIN_SERVER_ID`/`ADMIN_HUB_SERVER_ID`) for the
   * SAME purpose.** Anchoring exists so `Zanix.start()` and `ZanixAdminHub.start()` can coexist as
   * two independent bootstrap sequences sharing one process/port (a distinct, edge-case scenario) —
   * it does not, by itself, put `/admin/service-token` under this hub's own base URL, since that
   * controller still only ever registers where `Zanix.start({ admin: true })` composes it
   * (`ADMIN_APPLICATION`). `serviceToken: true` IS the answer to "I want `/admin/service-token`
   * under my hub's own single base URL, one port, no anchoring, no second Application, no proxy."
   * Reach for both only if you genuinely need two independent bootstrap sequences in the same
   * process AND a service-token endpoint on this hub's side specifically — not as two ways to solve
   * the same single-base-URL problem.
   */
  serviceToken?: boolean
  /** See `StartOptions.auth`'s own doc (`start.ts`) for the full behavior this installs. */
  auth?: ServiceAuthClientOptions
}

// Kept alive deliberately: a class produced by a factory and only ever referenced by a `Promise`'s
// resolved value has no other strong reference once that `Promise` is discarded —
// `@zanix/server`'s target registry resolves instances via a `WeakMap` keyed by class reference, so
// a garbage-collected class can silently stop dispatching. Costs nothing to just hold onto them.
const registeredControllers: unknown[] = []

/**
 * One hub-composable admin module's own registration recipe — the contract a THIRD module
 * (GQLIDE, Swagger, ...) would implement to be registered by {@link defineAdminHubMetadata}
 * alongside triggers/templates/dlq, without editing that function's own internals. Generalizes what
 * used to be two hand-duplicated `if (x !== false) { ... }` blocks (one per module) into one data
 * table — adding a module means adding an entry here, never touching the registration loop.
 */
interface AdminHubModuleEntry<TOptions extends object> {
  /** This module's own options from `AdminHubAppOptions`, or `false` to skip it entirely — same
   * meaning `AdminHubAppOptions.triggers`/`.templates`/`.dlq` already have. */
  options: false | (TOptions & { application?: AdminStartApplication })
  /** Dynamically imports whichever module defines this controller factory, resolving to a
   * function that SYNCHRONOUSLY builds the controller (or, for an entry composing more than one
   * controller under the same prefix — e.g. `templates`'s CRUD + `sync` — an array of them) given
   * `options` (minus `application`) — called from inside `ProgramModule.defineApplication`'s own
   * synchronous scope callback (see {@link registerAdminHubModules}), so every controller it builds
   * attributes to the right Application. Never resolve/import eagerly outside this — `@Controller`
   * running outside an active `defineApplication` scope silently attributes to the wrong
   * Application. */
  importController(): Promise<(options: TOptions) => unknown | unknown[]>
}

/**
 * Registers every ENABLED entry's controller(s) (`entry.options !== false`), each inside its own
 * resolved `ProgramModule.defineApplication(...)` scope — nestable (see that function's own doc)
 * inside the outer `defineApplication(ADMIN_HUB_APPLICATION, ...)` scope `AppContainer.registerApp`
 * already opened for this call, so a controller attributes to {@link ADMIN_HUB_APPLICATION} by
 * default, or {@link DEFAULT_APPLICATION} when its own `application` option says so. An entry whose
 * `importController` builds more than one controller (see {@link AdminHubModuleEntry}'s own doc)
 * returns them as an array, flattened one level here so every caller still gets a flat list. Returns
 * only the controllers actually built (skipped/`false` entries contribute nothing) — callers keep
 * them alive the same way `defineAdminHubMetadata` already did (see {@link registeredControllers}'s
 * own doc for why).
 *
 * Registered sequentially (never concurrently, e.g. via `Promise.all`) — each entry opens its own
 * `ProgramModule.defineApplication(...)` scope, and these must resolve one at a time, the same
 * reason `registerAdminMetadataModules` (`metadata.ts`) and `@zanix/app`'s own `activateApps` never
 * parallelize their own registration loops either: concurrent `defineApplication` scopes rely on
 * `AsyncContext`, whose current implementation can misattribute a controller to the wrong
 * Application under genuine concurrency (see `ProgramModule.defineApplication`'s own doc), which
 * would surface as a hub sub-app intermittently missing from `/ready`, or its route 404ing instead
 * of enforcing auth.
 */
async function registerAdminHubModules(
  // deno-lint-ignore no-explicit-any
  entries: AdminHubModuleEntry<any>[],
): Promise<unknown[]> {
  const results: (unknown | unknown[])[] = []
  for (const entry of entries) {
    if (entry.options === false) continue

    const { application = ADMIN_HUB_APPLICATION, ...controllerOptions } = entry.options
    // deno-lint-ignore no-await-in-loop
    const createController = await entry.importController()

    let controller: unknown | unknown[] = undefined
    // deno-lint-ignore no-await-in-loop
    await ProgramModule.defineApplication(application, () => {
      controller = createController(controllerOptions)
    })
    results.push(controller)
  }

  return results.flat().filter((controller) => controller !== undefined)
}

/**
 * `zanix-admin`'s own central aggregator/proxy — the Zanix App `ZanixAdminHub.start()` activates
 * (see `start.ts`), and that any other host can compose directly via `Zanix.start({ apps: {
 * 'admin-hub': defineAdminHubApp(options) } })` without going through `ZanixAdminHub` at all.
 *
 * Also always registers `GET /registry` (`createRegistryController`) — read-only, reflecting the
 * same `ServiceRegistry` instance this app installs below, with no `options.registry` toggle to
 * disable it (see `createRegistryController`'s own doc for why). Optionally also registers
 * `POST /admin/service-token` (`createServiceExchangeController`) when `options.serviceToken` is
 * `true` — `false`/omitted by default, so this stays exactly today's behavior unless explicitly
 * opted into (see {@link AdminHubAppOptions.serviceToken}'s own doc).
 *
 * A factory, not a pre-built constant, because — unlike a typical Zanix App — which
 * controllers/Application/credentials this one registers is a per-deployment decision
 * (`triggers`/`templates`/`dlq`/`serviceToken`/`auth`), not fixed at author time; same pattern
 * `@zanix/space`'s own `defineSpaceApp()` already establishes for a manifest whose shape depends on
 * caller-supplied options.
 *
 * Declares one dependency, `registry` (type `'service-registry'`, registered by this package's own
 * `./registry/resource-type.ts` side-effect import above) — the same {@link ServiceRegistry}
 * `TriggersAggregator`/`TemplatesAdminService` resolve via the module-level
 * `getServiceRegistry()`/`setServiceRegistry()` singleton, since this resource type's factory
 * installs the constructed instance there too. A host that wants a different/shared registry
 * overrides it via `uses`/root `resources`, same as any other Zanix App dependency.
 *
 * `routes: false` — each controller manages its own `ProgramModule.defineApplication(...)` scope
 * explicitly (below), rather than relying on this app's own auto-prefix mount.
 *
 * Declares no `operations` of its own anymore — the aggregated triggers/templates/dlq `operations`/
 * `mcp` view previously declared inline here now lives in its own physically-separate sub-apps
 * (`getAdminHubSubApps`, above), composed alongside this one via ONE `activateApps([...])` call
 * (see `start.ts`'s own `startSequence`) rather than merged into this app's own manifest.
 * `ctx.remote('admin-hub-triggers')`/`ctx.remote('admin-hub-templates')`/`ctx.remote('admin-hub-dlq')`
 * reach them now, not `ctx.remote('admin-hub')` — a deliberate rename, safe because this
 * operations/mcp surface was only ever exercised by this package's own test suite, never a real
 * external caller (see `admin`'s own CHANGELOG for the full migration note).
 */
export function defineAdminHubApp(
  options: AdminHubAppOptions = {},
): ZanixAppDefinition {
  const { triggers = {}, templates = {}, dlq = {}, serviceToken = false, auth } = options

  return defineZanixApp({
    name: ADMIN_HUB_APPLICATION,
    routes: false,
    dependencies: { registry: { type: 'service-registry', required: true } },
    resources: { registry: { type: 'service-registry', options: {} } },
    setup: async (ctx) => {
      // Always wired here — regardless of `auth` — so the aggregator ALWAYS resolves against the
      // registry `ctx.resource('registry')` gave THIS activation (manifest-configured `entries`
      // included), rather than leaving the no-`auth` case to fall through to
      // `getTriggersAggregator()`'s own lazy default (which previously only worked because the
      // `'service-registry'` resource factory happened to also install the same instance into a
      // separate global `getServiceRegistry()` singleton reads from). `authHeaders` only decides
      // which CLIENT factory is used (authenticated vs. `TriggersAggregator`'s own unauthenticated
      // default, passed as `undefined`) — never whether the aggregator gets wired at all.
      const registry = ctx.resource('registry') as ServiceRegistry
      const authHeaders = auth ? createServiceRegistryAuthHeaders(auth) : undefined

      setTriggersAggregator(
        new TriggersAggregator(
          registry,
          authHeaders
            ? async (service) =>
              new TriggersAdminClient({
                baseUrl: service.adminBaseUrl,
                headers: await authHeaders(service),
              })
            : undefined,
          authHeaders
            ? async (service) =>
              new DiscoveryAdminClient({
                baseUrl: service.adminBaseUrl,
                headers: await authHeaders(service),
              })
            : undefined,
        ),
      )

      // Same reasoning as `setTriggersAggregator` above, one domain over — always wired regardless
      // of `auth`, reusing the exact same `registry`/`authHeaders` already resolved for Triggers.
      setDlqAggregator(
        new DlqAggregator(
          registry,
          authHeaders
            ? async (service) =>
              new DlqAdminClient({
                baseUrl: service.adminBaseUrl,
                headers: await authHeaders(service),
              })
            : undefined,
          authHeaders
            ? async (service) =>
              new DiscoveryAdminClient({
                baseUrl: service.adminBaseUrl,
                headers: await authHeaders(service),
              })
            : undefined,
        ),
      )

      if (authHeaders) {
        setTemplatesDiscoveryClientFactory(
          async (service) =>
            new DiscoveryAdminClient({
              baseUrl: service.adminBaseUrl,
              headers: await authHeaders(service),
            }),
        )
      }

      await defineAdminHubMetadata(triggers, templates, dlq, serviceToken)
    },
  })
}

/**
 * Registers `zanix-admin`'s own building blocks for THIS activation:
 *
 * - `@zanix/datamaster/core` / `@zanix/auth/core` / `@zanix/notifications/core` — the same
 *   zero-config connector/provider wiring any `@zanix/core`-based service gets from
 *   `Zanix.bootstrap()`: the Mongo connector the templates controller needs (via
 *   `TemplatesAdminRepository`), the session/auth infra `AuthTokenValidation`/`rateLimitGuard`
 *   need, and the `TemplateProvider` + templates model `TemplatesAdminService` reads through.
 * - Every hub module ({@link AdminHubModuleEntry}) this deployment enabled — today `triggers`/
 *   `templates`/`dlq`, via {@link registerAdminHubModules}, plus `registry` (always enabled, no
 *   `false` entry — see `createRegistryController`'s own doc) and `serviceToken` (opt-in, `false` by
 *   default — see {@link AdminHubAppOptions.serviceToken}'s own doc). `start.ts`'s own
 *   `bootstrapAppServer`/`bootstrapServers` calls only ever serve what's registered here.
 */
async function defineAdminHubMetadata(
  triggers:
    | false
    | (TriggersControllerOptions & { application?: AdminStartApplication }),
  templates:
    | false
    | (TemplatesControllerOptions & { application?: AdminStartApplication }),
  dlq:
    | false
    | (DlqControllerOptions & { application?: AdminStartApplication }),
  serviceToken: boolean,
): Promise<void> {
  const [, , , controllers] = await Promise.all([
    import(DATAMASTER_CORE_SPECIFIER),
    import(AUTH_CORE_SPECIFIER),
    import(NOTIFICATIONS_CORE_SPECIFIER),
    registerAdminHubModules([
      {
        options: triggers,
        importController: () =>
          import('./triggers/triggers.handler.ts').then((m) => m.createTriggersController),
      },
      {
        // Same shape as `triggers` above (never `templates`' guard-injection) — `createDlqController`
        // already bakes its own `ADMIN_ROLE`/`ADMIN_DLQ_ROLE` `AuthTokenValidation` in, so this
        // deployment option is only ever `false` or route-shaping (`prefix`/`application`).
        options: dlq,
        importController: () => import('./dlq/dlq.handler.ts').then((m) => m.createDlqController),
      },
      {
        // `@zanix/notifications/templates-api`'s `createTemplatesController` never assumes an auth
        // mechanism (see its own doc) — defaults to a real `ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE` guard
        // here, so this route is never public by accident. Spreading the caller's own `templates`
        // LAST lets it override `guards`/`versionProtocol` explicitly (including opting into no
        // guard at all, via `guards: []`) without losing that safe-by-default posture for anyone
        // who doesn't.
        options: templates === false ? false : {
          guards: [
            jwtValidationGuard({
              permissions: [ADMIN_ROLE, ADMIN_TEMPLATES_ROLE],
              type: ADMIN_AUTH_TYPES,
            }),
          ],
          versionProtocol: ADMIN_VERSION_PROTOCOL,
          ...templates,
        },
        // Two controllers, mounted under the SAME resolved prefix — the CRUD half (authored by
        // `@zanix/notifications`, needs its own explicit `guards`, see above) and `POST sync`
        // (this package's own cross-service extension, fully self-contained: bakes in its own
        // `AuthTokenValidation`, takes only `prefix`) — same composition `metadata.ts`'s local-side
        // `defineAdminMetadata` already uses for `admin/templates`, mirrored here for the hub's own
        // `/templates` so a hub can seed its catalog from a registered service's Discovery snapshot
        // the same way a business service's own embedded admin already can. `prefix` is resolved
        // once here (defaulting the same way `createTemplatesController` itself does) so both
        // controllers always land on the exact same route, even when a caller overrides it.
        importController: async () => {
          const templatesApi = await import(NOTIFICATIONS_TEMPLATES_API_SPECIFIER) as {
            createTemplatesController: (options: TemplatesControllerOptions) => unknown
          }
          return (options: TemplatesControllerOptions) => {
            const { prefix = 'templates', ...rest } = options
            return [
              templatesApi.createTemplatesController({ prefix, ...rest }),
              createTemplatesSyncController({ prefix }),
            ]
          }
        },
      },
      {
        // Never `false` — unlike triggers/templates/dlq, `ServiceRegistry` always exists regardless
        // of which of those three are enabled (see `createRegistryController`'s own doc for why this
        // resource has no individual opt-out), so this entry's `options` is a fixed `{}` rather than
        // derived from any `AdminHubAppOptions` field.
        options: {} as RegistryControllerOptions & { application?: AdminStartApplication },
        importController: () =>
          import('./registry/registry.handler.ts').then((m) => m.createRegistryController),
      },
      {
        // Opt-in, `false` by default (unlike `registry` above) — see
        // `AdminHubAppOptions.serviceToken`'s own doc for the full rationale. `createServiceExchangeController`
        // takes no options at all (always `prefix: 'admin/service-token'`), so this entry's `options`
        // is a fixed `{}` when enabled, the same shape `registry`'s own entry already uses.
        options: serviceToken
          ? {} as Record<string, never> & { application?: AdminStartApplication }
          : false,
        importController: () =>
          import('./service-exchange/service-exchange.handler.ts').then((m) =>
            m.createServiceExchangeController
          ),
      },
    ]),
  ])

  registeredControllers.push(...controllers)
}
