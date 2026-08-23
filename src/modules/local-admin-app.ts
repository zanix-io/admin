import type { ZanixAppDefinition } from '@zanix/app'

import { defineZanixApp } from '@zanix/app'
import { ADMIN_APPLICATION } from '../utils/constants.ts'
import { defineAdminMetadata } from './metadata.ts'
import {
  isDlqResourceEnabled,
  isTemplatesResourceEnabled,
  isTriggersResourceEnabled,
} from './admin-resource-gates.ts'
import { defineLocalTriggersApp } from './triggers/local-triggers-app.ts'
import { defineLocalTemplatesApp } from './templates/local-templates-app.ts'
import { defineLocalDlqApp } from './dlq/local-dlq-app.ts'

/**
 * Every additional Zanix App `@zanix/core`'s `admin: true` option/a host composing
 * `defineLocalAdminApp` directly should activate ALONGSIDE it — today, Triggers'/Templates'/DLQ's
 * own `operations`/`mcp` surfaces, each physically separated into their own file/app identity
 * (`triggers/local-triggers-app.ts`, `templates/local-templates-app.ts`, `dlq/local-dlq-app.ts`)
 * rather than declared inline on `defineLocalAdminApp` itself. A future fourth local sub-app is
 * added here, never by editing `defineLocalAdminApp`'s own body — see `getLocalAdminSubApps`'s own
 * doc for the composition contract. DLQ has no hub-side counterpart yet — see
 * `dlq/local-dlq-app.ts`'s own doc for why.
 *
 * Each entry's `enabled` predicate is one of {@link isTriggersResourceEnabled}/
 * {@link isTemplatesResourceEnabled}/{@link isDlqResourceEnabled} (`admin-resource-gates.ts`) — the
 * exact same functions `defineAdminMetadata` (`metadata.ts`) reads to decide its own REST/Discovery
 * gating, so a new entry here is never accidentally composed on a different signal than its REST
 * counterpart.
 */
const LOCAL_SUB_APP_ENTRIES: Array<
  { factory: () => ZanixAppDefinition; enabled: () => boolean }
> = [
  { factory: defineLocalTriggersApp, enabled: isTriggersResourceEnabled },
  { factory: defineLocalTemplatesApp, enabled: isTemplatesResourceEnabled },
  { factory: defineLocalDlqApp, enabled: isDlqResourceEnabled },
]

/**
 * Every sub-app `defineLocalAdminApp` composes alongside itself, in declaration order — always
 * activated together via ONE `activateApps([defineLocalAdminApp(), ...getLocalAdminSubApps()])`
 * call (see `@zanix/core`'s own `start.ts`), so an app sharing a root resource with
 * `defineLocalAdminApp` still resolves to the same instance (the same reason `activateApps` itself
 * takes a list, not one app at a time).
 *
 * Conditional, mirroring `defineAdminMetadata`'s own REST-controller gating exactly (same env
 * signals, read via the same {@link isTriggersResourceEnabled}/{@link isTemplatesResourceEnabled}/
 * {@link isDlqResourceEnabled} functions) — a resource's `operations`/`mcp` sub-app is composed if
 * and only if its REST controller would be too. Before this, e.g. `admin-dlq`'s own `operations`
 * stayed composed even in a deployment that never set `DLQ_MODEL_NAME` and therefore never got a
 * live `/admin/dlq` REST route — a reachable (auth-gated) surface that could only ever fail at call
 * time, never simply not exist the way its REST counterpart already didn't. Re-evaluated on every
 * call (not cached), same reasoning as `defineAdminMetadata`'s own re-evaluation.
 *
 * Each sub-app declares no `dependencies`/`resources` of its own (see each factory's own doc), so
 * composing more of them costs nothing extra in resource-resolution complexity.
 */
export function getLocalAdminSubApps(): ZanixAppDefinition[] {
  return LOCAL_SUB_APP_ENTRIES
    .filter((entry) => entry.enabled())
    .map((entry) => entry.factory())
}

/**
 * The embedded, business-service-side admin Zanix App — `@zanix/core`'s own `admin: true` option
 * activates this instead of hand-rolling its own bootstrap/resource wiring. Registers exactly what
 * {@link defineAdminMetadata} already registers (`/admin/triggers`, `/admin/templates`,
 * `/admin/dlq`, `/admin/service-token`), unchanged — including each controller's own env-var-driven
 * Application override (`ADMIN_TRIGGERS_APPLICATION`/`ADMIN_TEMPLATES_APPLICATION`/
 * `ADMIN_DLQ_APPLICATION`): `ProgramModule.defineApplication` is documented as safe to nest, so a
 * controller redirected onto a different Application still registers correctly from inside this
 * app's own `setup`.
 *
 * Declares no `operations` of its own anymore — this service's own triggers/templates
 * `operations`/`mcp` view previously declared inline here now lives in its own
 * physically-separate sub-apps (`getLocalAdminSubApps`, above), composed alongside this one via
 * ONE `activateApps([...])` call rather than merged into this app's own manifest.
 * `ctx.remote('admin-triggers')`/`ctx.remote('admin-templates')` reach them now, not
 * `ctx.remote('admin')` — a deliberate rename, safe because this operations/mcp surface was only
 * ever exercised by this package's own test suite, never a real external caller (see `admin`'s own
 * CHANGELOG for the full migration note).
 *
 * No resources/dependencies of its own — unlike `defineAdminHubApp` (which reads a `ServiceRegistry`
 * to know which OTHER services to call), this side is the one BEING called into; it never needs to
 * know about other registered services.
 *
 * `routes: false` — {@link defineAdminMetadata} opens its own `ProgramModule.defineApplication(...)`
 * scope(s) explicitly, rather than relying on this app's own auto-prefix mount.
 */
export function defineLocalAdminApp(): ZanixAppDefinition {
  return defineZanixApp({
    name: ADMIN_APPLICATION,
    routes: false,
    setup: async () => {
      await defineAdminMetadata()
    },
  })
}
