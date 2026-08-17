import type { ServiceAuthClientOptions } from '@zanix/auth'
import type { ZanixAppDefinition } from '@zanix/app'

import { defineZanixApp } from '@zanix/app'
import type { DEFAULT_APPLICATION } from '@zanix/server'
import { ProgramModule } from '@zanix/server'
import { ADMIN_HUB_APPLICATION } from '../utils/constants.ts'
import type { TemplatesControllerOptions } from './templates/templates.handler.ts'
import type { TriggersControllerOptions } from './triggers/triggers.handler.ts'
import type { ServiceRegistry } from './registry/registry.ts'
import { createServiceRegistryAuthHeaders } from './registry/auth.ts'
import { setTriggersAggregator, TriggersAggregator } from './triggers/triggers.aggregator.ts'
import { TriggersAdminClient } from './triggers/triggers.client.ts'
import { DiscoveryAdminClient } from './discovery/discovery.client.ts'
import { setTemplatesDiscoveryClientFactory } from './templates/templates-sync.ts'
import { defineHubTriggersApp } from './triggers/hub-triggers-app.ts'
import { defineHubTemplatesApp } from './templates/hub-templates-app.ts'
import './registry/resource-type.ts'

/**
 * Every additional Zanix App `ZanixAdminHub.start()`/a host composing `defineAdminHubApp` directly
 * should activate ALONGSIDE it — today, Triggers'/Templates' own `operations`/`mcp` surfaces, each
 * physically separated into their own file/app identity (`triggers/hub-triggers-app.ts`,
 * `templates/hub-templates-app.ts`) rather than declared inline on `defineAdminHubApp` itself. A
 * future third hub sub-app (e.g. GQLIDE/Swagger `operations`) is added here, never by editing
 * `defineAdminHubApp`'s own body — see `getAdminHubSubApps`'s own doc for the composition contract.
 */
const HUB_SUB_APP_FACTORIES: Array<() => ZanixAppDefinition> = [
  defineHubTriggersApp,
  defineHubTemplatesApp,
]

/**
 * Every sub-app `defineAdminHubApp` composes alongside itself, in declaration order — always
 * activated together via ONE `activateApps([defineAdminHubApp(...), ...getAdminHubSubApps()])`
 * call (see `start.ts`'s own `startSequence`), so an app sharing a root resource with
 * `defineAdminHubApp` still resolves to the same instance (the same reason `activateApps` itself
 * takes a list, not one app at a time).
 *
 * Unconditional — like `defineAdminHubApp`'s own former `operations` field, these sub-apps'
 * `operations` are always registered regardless of the `triggers`/`templates` REST options (those
 * only control the REST controllers themselves, never this operations/mcp surface).
 *
 * Each sub-app declares no `dependencies`/`resources` of its own (see each factory's own doc), so
 * composing more of them costs nothing extra in resource-resolution complexity — only whatever
 * `bootstrapAppServer` calls `start.ts` adds for their own HTTP dispatch-route reachability.
 */
export function getAdminHubSubApps(): ZanixAppDefinition[] {
  return HUB_SUB_APP_FACTORIES.map((define) => define())
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
  /** Options for the templates route, or `false` to skip registering it entirely. */
  templates?:
    | false
    | (TemplatesControllerOptions & { application?: AdminStartApplication })
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
 * alongside triggers/templates, without editing that function's own internals. Generalizes what
 * used to be two hand-duplicated `if (x !== false) { ... }` blocks (one per module) into one data
 * table — adding a module means adding an entry here, never touching the registration loop.
 */
interface AdminHubModuleEntry<TOptions extends object> {
  /** This module's own options from `AdminHubAppOptions`, or `false` to skip it entirely — same
   * meaning `AdminHubAppOptions.triggers`/`.templates` already have. */
  options: false | (TOptions & { application?: AdminStartApplication })
  /** Dynamically imports whichever module defines this controller factory, resolving to a
   * function that SYNCHRONOUSLY builds the controller given `options` (minus `application`) —
   * called from inside `ProgramModule.defineApplication`'s own synchronous scope callback (see
   * {@link registerAdminHubModules}), so the controller's `@Controller` decorator attributes to
   * the right Application. Never resolve/import eagerly outside this — `@Controller` running
   * outside an active `defineApplication` scope silently attributes to the wrong Application. */
  importController(): Promise<(options: TOptions) => unknown>
}

/**
 * Registers every ENABLED entry's controller (`entry.options !== false`), each inside its own
 * resolved `ProgramModule.defineApplication(...)` scope — nestable (see that function's own doc)
 * inside the outer `defineApplication(ADMIN_HUB_APPLICATION, ...)` scope `AppContainer.registerApp`
 * already opened for this call, so a controller attributes to {@link ADMIN_HUB_APPLICATION} by
 * default, or {@link DEFAULT_APPLICATION} when its own `application` option says so. Returns only
 * the controllers actually built (skipped/`false` entries contribute nothing) — callers keep them
 * alive the same way `defineAdminHubMetadata` already did (see {@link registeredControllers}'s own
 * doc for why).
 */
async function registerAdminHubModules(
  // deno-lint-ignore no-explicit-any
  entries: AdminHubModuleEntry<any>[],
): Promise<unknown[]> {
  const results = await Promise.all(entries.map(async (entry) => {
    if (entry.options === false) return undefined

    const { application = ADMIN_HUB_APPLICATION, ...controllerOptions } = entry.options
    const createController = await entry.importController()

    let controller: unknown
    await ProgramModule.defineApplication(application, () => {
      controller = createController(controllerOptions)
    })
    return controller
  }))

  return results.filter((controller) => controller !== undefined)
}

/**
 * `zanix-admin`'s own central aggregator/proxy — the Zanix App `ZanixAdminHub.start()` activates
 * (see `start.ts`), and that any other host can compose directly via `Zanix.start({ apps: {
 * 'admin-hub': defineAdminHubApp(options) } })` without going through `ZanixAdminHub` at all.
 *
 * A factory, not a pre-built constant, because — unlike a typical Zanix App — which
 * controllers/Application/credentials this one registers is a per-deployment decision
 * (`triggers`/`templates`/`auth`), not fixed at author time; same pattern `@zanix/space`'s own
 * `defineSpaceApp()` already establishes for a manifest whose shape depends on caller-supplied
 * options.
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
 * Declares no `operations` of its own anymore — the aggregated triggers/templates `operations`/
 * `mcp` view previously declared inline here now lives in its own physically-separate sub-apps
 * (`getAdminHubSubApps`, above), composed alongside this one via ONE `activateApps([...])` call
 * (see `start.ts`'s own `startSequence`) rather than merged into this app's own manifest.
 * `ctx.remote('admin-hub-triggers')`/`ctx.remote('admin-hub-templates')` reach them now, not
 * `ctx.remote('admin-hub')` — a deliberate rename, safe because this operations/mcp surface was
 * only ever exercised by this package's own test suite, never a real external caller (see
 * `admin`'s own CHANGELOG for the full migration note).
 */
export function defineAdminHubApp(
  options: AdminHubAppOptions = {},
): ZanixAppDefinition {
  const { triggers = {}, templates = {}, auth } = options

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

      if (authHeaders) {
        setTemplatesDiscoveryClientFactory(
          async (service) =>
            new DiscoveryAdminClient({
              baseUrl: service.adminBaseUrl,
              headers: await authHeaders(service),
            }),
        )
      }

      await defineAdminHubMetadata(triggers, templates)
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
 *   `templates`, via {@link registerAdminHubModules}. `start.ts`'s own `bootstrapAppServer`/
 *   `bootstrapServers` calls only ever serve what's registered here.
 */
async function defineAdminHubMetadata(
  triggers:
    | false
    | (TriggersControllerOptions & { application?: AdminStartApplication }),
  templates:
    | false
    | (TemplatesControllerOptions & { application?: AdminStartApplication }),
): Promise<void> {
  const [, , , controllers] = await Promise.all([
    import('@zanix/datamaster/core'),
    import('@zanix/auth/core'),
    import('@zanix/notifications/core'),
    registerAdminHubModules([
      {
        options: triggers,
        importController: () =>
          import('./triggers/triggers.handler.ts').then((m) => m.createTriggersController),
      },
      {
        options: templates,
        importController: () =>
          import('./templates/templates.handler.ts').then((m) => m.createTemplatesController),
      },
    ]),
  ])

  registeredControllers.push(...controllers)
}
