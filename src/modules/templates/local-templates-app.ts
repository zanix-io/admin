import type { ZanixAppDefinition } from '@zanix/app'

import { defineZanixApp } from '@zanix/app'
import { ADMIN_TEMPLATES_APPLICATION } from '../../utils/constants.ts'
import { buildTemplatesOperations } from './templates-operations.ts'

/**
 * The embedded, business-service-side Templates `operations`/`mcp` surface, as its own
 * physically-separate Zanix App — same reasoning as `triggers/local-triggers-app.ts`'s
 * `defineLocalTriggersApp`, mirrored for Templates. Extracted from `defineLocalAdminApp` (which
 * still owns the actual `/admin/templates` REST controller, via `defineAdminMetadata`).
 *
 * `routes: false` — this sub-app owns no REST surface of its own.
 * `buildTemplatesOperations(ADMIN_TEMPLATES_APPLICATION)` resolves `TemplatesAdminService` via `resolveTarget`, scoped by
 * THIS sub-app's own name — reused verbatim from the hub side's own `hub-templates-app.ts`, since
 * both deployments call the exact same `TemplatesAdminService` class (see
 * `buildTemplatesOperations`'s own doc).
 */
export function defineLocalTemplatesApp(): ZanixAppDefinition {
  return defineZanixApp({
    name: ADMIN_TEMPLATES_APPLICATION,
    routes: false,
    operations: buildTemplatesOperations(ADMIN_TEMPLATES_APPLICATION),
  })
}
