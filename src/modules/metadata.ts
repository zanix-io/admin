import type { DiscoveryProvider, MiddlewareGuard } from '@zanix/server'

import { ProgramModule } from '@zanix/server'
import { createTemplatesDiscoveryProvider } from '@zanix/notifications'
import { createDlqDiscoveryProvider, createTriggersDiscoveryProvider } from '@zanix/database'
import { createTriggersAdminController } from '@zanix/datamaster/triggers-api'
import { createDlqAdminController } from '@zanix/datamaster/dlq-api'
import { jwtValidationGuard } from '@zanix/auth'
import {
  ADMIN_APPLICATION,
  ADMIN_AUTH_TYPES,
  ADMIN_DLQ_APPLICATION_ENV,
  ADMIN_DLQ_ROLE,
  ADMIN_ROLE,
  ADMIN_TEMPLATES_APPLICATION_ENV,
  ADMIN_TEMPLATES_ROLE,
  ADMIN_TRIGGERS_APPLICATION_ENV,
  ADMIN_TRIGGERS_ROLE,
} from '../utils/constants.ts'
import {
  isDlqResourceEnabled,
  isTemplatesResourceEnabled,
  isTriggersResourceEnabled,
} from './admin-resource-gates.ts'
import { ADMIN_VERSION_PROTOCOL } from './protocol/version-protocol.ts'
import { createServiceExchangeController } from './service-exchange/service-exchange.handler.ts'
import { createTemplatesController } from '@zanix/notifications/templates-api'
import { createTemplatesSyncController } from './templates/templates-sync.handler.ts'

// Accepts either a human admin's user-shaped token or a machine caller's api-shaped one — a
// registered service's own aggregator/sync orchestration (`TriggersAggregator`,
// `syncTemplatesFromRegisteredService`) authenticates as `type: 'api'`, the same as the CRUD
// counterparts these Discovery endpoints sit alongside.
const DISCOVERY_AUTH_TYPES = ADMIN_AUTH_TYPES

/**
 * The default guard for any templates-shaped Discovery surface — `{@link ADMIN_ROLE}`/
 * `{@link ADMIN_TEMPLATES_ROLE}`, same as this package's own `/admin/templates` CRUD. Used below
 * for `/.well-known/zanix/templates`; also exported (see `../../mod.ts`) so `@zanix/core`'s own
 * `codeTemplatesDiscovery` option (`/.well-known/zanix/code-templates`) can require the same role
 * without re-inlining the `jwtValidationGuard(...)` construction — that route is a different
 * resource (this process's own in-code catalog, not this package's DB-backed records), but the
 * "who's allowed to read a template list" question is the same one either way.
 */
export function createTemplatesDiscoveryGuard(): MiddlewareGuard {
  return jwtValidationGuard({
    permissions: [ADMIN_ROLE, ADMIN_TEMPLATES_ROLE],
    type: DISCOVERY_AUTH_TYPES,
  })
}

// Kept alive deliberately: unlike a module-level `export class X {}` (always reachable through its
// own module's exports for the life of the process), a class produced by a factory and only ever
// referenced by a local variable has no other strong reference once that variable goes out of
// scope — `@zanix/server`'s target registry resolves instances via a `WeakMap` keyed by class
// reference (see `getTargetKey`), so a garbage-collected class silently stops dispatching, with no
// error at registration OR request time. Confirmed empirically: routes vanished from every server's
// route table (not just failed at request time) the moment nothing else held the created class.
const registeredAdminControllers: unknown[] = []

/**
 * One REST/Discovery-shaped resource {@link defineAdminMetadata} composes — the local-side
 * counterpart to `admin-hub-app.ts`'s own `AdminHubModuleEntry`/`registerAdminHubModules` table
 * (same shape, generalized here to also carry each resource's read-only Discovery endpoint, which
 * the hub side never needs to register since it consumes Discovery, never serves it). Adding a
 * fourth resource here means adding one entry to {@link defineAdminMetadata}'s own table, never
 * hand-writing a new `if (...) { await ProgramModule.defineApplication(...) { ... } }` block.
 */
interface AdminMetadataModuleEntry {
  /** Whether this resource is configured in this deployment — one of
   * {@link isTriggersResourceEnabled}/{@link isTemplatesResourceEnabled}/
   * {@link isDlqResourceEnabled} (`admin-resource-gates.ts`). `local-admin-app.ts`'s
   * `getLocalAdminSubApps()` calls the exact same three functions to decide which operations/mcp
   * sub-app to compose, so a resource's REST controller and its operations/mcp surface can never
   * gate on different signals again. */
  enabled: () => boolean
  /** The env var that overrides which Application this resource's controller(s)/Discovery register
   * under instead of {@link ADMIN_APPLICATION} (e.g. {@link ADMIN_TRIGGERS_APPLICATION_ENV}) — `''`
   * moves it onto the default Application's own unanchored Runtime, same meaning every existing
   * resource's own env var already has. */
  applicationEnv: string
  /** Builds and returns every controller this resource registers — called SYNCHRONOUSLY inside
   * this entry's own resolved `ProgramModule.defineApplication(...)` scope (see
   * {@link registerAdminMetadataModules}), so each `@Controller` attributes to the right
   * Application. Most resources return exactly one; templates returns two (CRUD + `sync` — see its
   * own entry below for why). */
  buildControllers(): unknown[]
  /** This resource's read-only `/.well-known/zanix/<resourceType>` Discovery endpoint, registered
   * in the same Application scope as its controller(s) above, gated by the same
   * {@link ADMIN_ROLE}/`<resource>` role its own CRUD controller requires. */
  discovery: {
    /** The Discovery resource type name (e.g. `'triggers'`) — the second segment of
     * `/.well-known/zanix/<resourceType>`. */
    resourceType: string
    /** Builds the provider — e.g. `@zanix/datamaster`'s `createTriggersDiscoveryProvider`, which
     * authors it; this package only composes it. */
    provider(): DiscoveryProvider<unknown>
    guards: MiddlewareGuard[]
  }
}

/**
 * Registers every ENABLED entry's controller(s) + Discovery endpoint, in declaration order —
 * sequentially (never concurrently: each entry opens its own
 * `ProgramModule.defineApplication(...)` scope, and these must resolve one at a time, the same
 * reason `@zanix/app`'s own `activateApps` never parallelizes its `registerApp` loop either). A
 * skipped (`enabled() === false`) entry contributes nothing — no Application scope opened, no
 * controller built, no Discovery registered; this is the ENTIRE mechanism behind a resource's REST
 * surface simply not
 * existing rather than existing-but-failing, the same property {@link isTriggersResourceEnabled}/
 * {@link isTemplatesResourceEnabled}/{@link isDlqResourceEnabled} already give
 * `getLocalAdminSubApps()` on the operations/mcp side.
 */
async function registerAdminMetadataModules(
  entries: AdminMetadataModuleEntry[],
): Promise<unknown[]> {
  const controllers: unknown[] = []
  for (const entry of entries) {
    if (!entry.enabled()) continue
    const application = Deno.env.get(entry.applicationEnv) || ADMIN_APPLICATION
    // deno-lint-ignore no-await-in-loop
    await ProgramModule.defineApplication(application, () => {
      controllers.push(...entry.buildControllers())
      ProgramModule.defineDiscovery(
        entry.discovery.resourceType,
        entry.discovery.provider(),
        { guards: entry.discovery.guards },
      )
    })
  }
  return controllers
}

/**
 * Registers this package's business-service-side admin controllers — `/admin/triggers` (a business
 * service's own local, persisted triggers CRUD — see {@link createTriggersAdminController}),
 * `/admin/templates` (this package's own DB-backed templates CRUD, mounted at a fixed
 * `admin/templates` prefix — see {@link createTemplatesController}), `/admin/dlq` (a business
 * service's own local, persisted Dead Letter Queue CRUD — see {@link createDlqAdminController}), and
 * `/admin/service-token` (machine-to-machine credential exchange — see
 * {@link createServiceExchangeController}). This is the counterpart a central `zanix-admin`
 * deployment (or a business's own ops tooling) calls *into* — distinct from this package's own
 * aggregator-side controllers (`createTriggersController`/`createTemplatesController` wired by
 * {@link start}), which call *out* to these.
 *
 * Triggers/templates/dlq are each one {@link AdminMetadataModuleEntry} passed to
 * {@link registerAdminMetadataModules} below — see that interface's own doc for the composition
 * contract, and each entry inline below for the resource-specific rationale (why triggers defaults
 * on and templates/dlq don't, why templates alone builds two controllers, etc.). The
 * service-credential exchange API (`/admin/service-token`) is the one controller NOT in that table —
 * it's always composed directly under {@link ADMIN_APPLICATION}, unconditionally, since it rejects
 * any caller without a registered `JWK_PUB_<serviceId>` regardless (see `@zanix/auth`'s
 * `docs/service-credential.md`).
 *
 * Called once by `@zanix/core`'s own `start()` when its `admin` option is enabled — a plain,
 * re-callable function rather than a cached side-effect import, deliberately: `@zanix/server`'s
 * route registry is wiped at the end of every finalized boot sequence, so a process that boots more
 * than once (e.g. one `deno test` run exercising many independent `Zanix.bootstrap()` cycles) needs
 * this to genuinely re-run its `@Controller` decorators each time, not just resolve a cached ES
 * module namespace that already ran once.
 *
 * Safe to run in the same process as {@link start} (`ZanixAdminHub`'s own reference bootstrap) —
 * see that function's own doc for why these two independent route sets never corrupt each other's
 * registration, even fired without a sequential `await` between them.
 */
export const defineAdminMetadata = async (): Promise<void> => {
  const controllers: unknown[] = []

  await ProgramModule.defineApplication(ADMIN_APPLICATION, () => {
    controllers.push(createServiceExchangeController())
  })

  controllers.push(
    ...await registerAdminMetadataModules([
      {
        // On by default, unlike templates/dlq below — `@zanix/datamaster`'s persisted triggers
        // module is resolved unconditionally inside `ZanixMongoConnector`'s own constructor
        // (`modelNameFromEnv(TRIGGERS_MODEL_ENV, ...)`), so "on unless explicitly disabled"
        // (`TRIGGERS_MODEL_NAME=false`) accurately reflects what already happened by the time this
        // function runs.
        enabled: isTriggersResourceEnabled,
        applicationEnv: ADMIN_TRIGGERS_APPLICATION_ENV,
        buildControllers: () => [
          createTriggersAdminController({
            guards: [
              jwtValidationGuard({
                permissions: [ADMIN_ROLE, ADMIN_TRIGGERS_ROLE],
                type: ADMIN_AUTH_TYPES,
              }),
            ],
            versionProtocol: ADMIN_VERSION_PROTOCOL,
          }),
        ],
        discovery: {
          resourceType: 'triggers',
          provider: createTriggersDiscoveryProvider,
          guards: [
            jwtValidationGuard({
              permissions: [ADMIN_ROLE, ADMIN_TRIGGERS_ROLE],
              type: DISCOVERY_AUTH_TYPES,
            }),
          ],
        },
      },
      {
        // Opt-in — `@zanix/notifications`'s own DB-backed templates module has no such
        // auto-registration; only once `TEMPLATES_BACKEND=local` is explicitly selected does this
        // deployment even have a local templates collection to serve. A bare `TEMPLATES_MODEL_NAME`
        // with no `TEMPLATES_BACKEND` has no effect, mirroring that package's own resolution
        // exactly (see `@zanix/notifications`'s `docs/templates.md`).
        enabled: isTemplatesResourceEnabled,
        applicationEnv: ADMIN_TEMPLATES_APPLICATION_ENV,
        // Two separate controllers, mounted under the same `admin/templates` prefix — the CRUD half
        // is authored and owned by `@zanix/notifications` (never assumes an auth mechanism itself,
        // hence the explicit `guards` here); `sync` is this package's own cross-service extension,
        // fully self-contained (bakes in its own `AuthTokenValidation`). See the "Local API vs
        // Aggregator API" rule in `zanix-local-api-vs-aggregator`.
        buildControllers: () => [
          createTemplatesController({
            prefix: 'admin/templates',
            guards: [
              jwtValidationGuard({
                permissions: [ADMIN_ROLE, ADMIN_TEMPLATES_ROLE],
                type: DISCOVERY_AUTH_TYPES,
              }),
            ],
            versionProtocol: ADMIN_VERSION_PROTOCOL,
          }),
          createTemplatesSyncController({ prefix: 'admin/templates' }),
        ],
        discovery: {
          resourceType: 'templates',
          provider: createTemplatesDiscoveryProvider,
          // Same role gate as the CRUD endpoint above — see `createTemplatesDiscoveryGuard`'s own
          // doc for why this reuses `TemplatesAdminRepository` rather than a second query path.
          guards: [createTemplatesDiscoveryGuard()],
        },
      },
      {
        // Opt-in, the same shape as templates above, deliberately NOT triggers' on-by-default shape
        // — `@zanix/database`'s own `registerDLQModel()` is a standalone call a host's bootstrap
        // (its own `*.defs.ts`) must make explicitly; nothing registers it as a side effect of
        // importing `DLQProvider`/`DLQAdminService` (see `registerDLQModel`'s own doc). Defaulting
        // `/admin/dlq` to on would register a live REST/Discovery surface in front of a model that
        // may never have actually been registered in a given deployment, failing at request time
        // instead of never existing. There's no exported "was DLQ registered" query this could check
        // instead, so `DLQ_MODEL_NAME` being set is used as the deployment's own opt-in signal — the
        // same role `TEMPLATES_BACKEND=local` plays for templates (known gap this mirrors from
        // templates' own shape, not a new one: a host that calls `registerDLQModel()` with no
        // `modelName`, relying on the built-in `zanix-dlq` default, must still set `DLQ_MODEL_NAME`
        // explicitly, even to that same default name, to get `/admin/dlq` registered here).
        enabled: isDlqResourceEnabled,
        applicationEnv: ADMIN_DLQ_APPLICATION_ENV,
        buildControllers: () => [
          createDlqAdminController({
            guards: [
              jwtValidationGuard({
                permissions: [ADMIN_ROLE, ADMIN_DLQ_ROLE],
                type: ADMIN_AUTH_TYPES,
              }),
            ],
            versionProtocol: ADMIN_VERSION_PROTOCOL,
          }),
        ],
        discovery: {
          resourceType: 'dlq',
          provider: createDlqDiscoveryProvider,
          guards: [
            jwtValidationGuard({
              permissions: [ADMIN_ROLE, ADMIN_DLQ_ROLE],
              type: DISCOVERY_AUTH_TYPES,
            }),
          ],
        },
      },
    ]),
  )

  registeredAdminControllers.push(...controllers)
}
