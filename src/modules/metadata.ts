import type { MiddlewareGuard } from '@zanix/server'

import { ProgramModule } from '@zanix/server'
import {
  createTemplatesDiscoveryProvider,
  isDatabaseTemplatesDisabled,
  TEMPLATES_MODEL_ENV,
} from '@zanix/notifications'
import { createTriggersDiscoveryProvider, isTriggersModelDisabled } from '@zanix/database'
import { jwtValidationGuard } from '@zanix/auth'
import {
  ADMIN_APPLICATION,
  ADMIN_AUTH_TYPES,
  ADMIN_ROLE,
  ADMIN_TEMPLATES_APPLICATION_ENV,
  ADMIN_TEMPLATES_ROLE,
  ADMIN_TRIGGERS_APPLICATION_ENV,
  ADMIN_TRIGGERS_ROLE,
} from '../utils/constants.ts'
import { createServiceExchangeController } from './service-exchange/service-exchange.handler.ts'
import { createTriggersAdminController } from './triggers/local-triggers.handler.ts'
import { createTemplatesController } from './templates/templates.handler.ts'

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
 * Registers this package's business-service-side admin controllers — `/admin/triggers` (a business
 * service's own local, persisted triggers CRUD — see {@link createTriggersAdminController}),
 * `/admin/templates` (this package's own DB-backed templates CRUD, mounted at a fixed
 * `admin/templates` prefix — see {@link createTemplatesController}), and `/admin/service-token`
 * (machine-to-machine credential exchange — see {@link createServiceExchangeController}). This is
 * the counterpart a central `zanix-admin` deployment (or a business's own ops tooling) calls
 * *into* — distinct from this package's own aggregator-side controllers (`createTriggersController`/
 * `createTemplatesController` wired by {@link start}), which call *out* to these.
 *
 * Called once by `@zanix/core`'s own `start()` when its `admin` option is enabled — a plain,
 * re-callable function rather than a cached side-effect import, deliberately: `@zanix/server`'s
 * route registry is wiped at the end of every finalized boot sequence, so a process that boots more
 * than once (e.g. one `deno test` run exercising many independent `Zanix.bootstrap()` cycles) needs
 * this to genuinely re-run its `@Controller` decorators each time, not just resolve a cached ES
 * module namespace that already ran once.
 *
 * Each controller below registers itself inside its own `ProgramModule.defineApplication(name,
 * ...)` call (see `@zanix/server`'s `docs/HANDLERS.md`'s "Applications" section) — no outer, shared
 * wrap: every capability states its own Application explicitly, at its own registration site, rather
 * than inheriting one implicitly.
 *
 * - The triggers admin API (`/admin/triggers`) is registered unless `@zanix/datamaster`'s
 *   persisted triggers module was explicitly disabled (`TRIGGERS_MODEL_NAME=false`) — it's on by
 *   default. Composed under {@link ADMIN_APPLICATION} by default; {@link ADMIN_TRIGGERS_APPLICATION_ENV}
 *   overrides which Application it's composed under instead (e.g. `'main'` moves it onto the
 *   default Application's own unanchored Runtime). A read-only `/.well-known/zanix/triggers`
 *   Discovery endpoint (see `@zanix/server`'s `docs/HANDLERS.md`'s "Discovery" section) is
 *   registered alongside it, in the same Application scope, gated by the same {@link ADMIN_ROLE}/
 *   {@link ADMIN_TRIGGERS_ROLE} the CRUD controller itself requires — see `@zanix/datamaster`'s
 *   `createTriggersDiscoveryProvider`, which authors it (this package only composes it).
 * - The templates admin API (`/admin/templates`) is registered only once the caller has opted into
 *   DB-backed templates (`DATABASE_TEMPLATES=true` or `TEMPLATES_MODEL_NAME` set) — see
 *   `@zanix/notifications`'s `docs/templates.md` for the per-service vs. shared storage decision
 *   this depends on. Composed under {@link ADMIN_APPLICATION} by default;
 *   {@link ADMIN_TEMPLATES_APPLICATION_ENV} overrides which Application it's composed under the
 *   same way. A read-only `/.well-known/zanix/templates` Discovery endpoint (see `@zanix/server`'s
 *   `docs/HANDLERS.md`'s "Discovery" section) is registered alongside it, in the same Application
 *   scope, gated by the same {@link ADMIN_ROLE}/{@link ADMIN_TEMPLATES_ROLE} the CRUD controller
 *   itself requires — see `createTemplatesDiscoveryProvider`'s own doc.
 * - The service-credential exchange API (`/admin/service-token`) is always composed under
 *   {@link ADMIN_APPLICATION} — safe by default, since it rejects any caller without a registered
 *   `JWK_PUB_<serviceId>` regardless. See `@zanix/auth`'s `docs/service-credential.md`.
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

  if (!isTriggersModelDisabled()) {
    const triggersApplication = Deno.env.get(ADMIN_TRIGGERS_APPLICATION_ENV) || ADMIN_APPLICATION
    let controller: unknown
    await ProgramModule.defineApplication(triggersApplication, () => {
      controller = createTriggersAdminController()
      // Same role gate as the CRUD endpoint above — see `createTriggersDiscoveryProvider`'s own
      // doc (in `@zanix/datamaster`, the actual owner of this data) for why the provider lives
      // there rather than in this package.
      ProgramModule.defineDiscovery('triggers', createTriggersDiscoveryProvider(), {
        guards: [
          jwtValidationGuard({
            permissions: [ADMIN_ROLE, ADMIN_TRIGGERS_ROLE],
            type: DISCOVERY_AUTH_TYPES,
          }),
        ],
      })
    })
    controllers.push(controller)
  }

  if (Deno.env.get(TEMPLATES_MODEL_ENV) && !isDatabaseTemplatesDisabled()) {
    const templatesApplication = Deno.env.get(ADMIN_TEMPLATES_APPLICATION_ENV) || ADMIN_APPLICATION
    let controller: unknown
    await ProgramModule.defineApplication(templatesApplication, () => {
      controller = createTemplatesController({ prefix: 'admin/templates' })
      // Same role gate as the CRUD endpoint above — see `createTemplatesDiscoveryProvider`'s own
      // doc for why this reuses `TemplatesAdminRepository` rather than a second query path.
      ProgramModule.defineDiscovery('templates', createTemplatesDiscoveryProvider(), {
        guards: [createTemplatesDiscoveryGuard()],
      })
    })
    controllers.push(controller)
  }

  registeredAdminControllers.push(...controllers)
}
