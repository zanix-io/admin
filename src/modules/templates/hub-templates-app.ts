import type { ZanixAppDefinition } from '@zanix/app'

import { defineZanixApp } from '@zanix/app'
import { ADMIN_HUB_TEMPLATES_APPLICATION } from '../../utils/constants.ts'
import { buildTemplatesOperations } from './templates-operations.ts'

/**
 * The hub's Templates `operations`/`mcp` surface, as its own physically-separate Zanix App — same
 * reasoning as `triggers/hub-triggers-app.ts`'s `defineHubTriggersApp`, mirrored for Templates.
 * Extracted from `defineAdminHubApp` (which still owns the actual `/templates` REST controller).
 *
 * `routes: false` — this sub-app owns no REST surface of its own; `/templates` stays on
 * `defineAdminHubApp`. `buildTemplatesOperations(ADMIN_HUB_TEMPLATES_APPLICATION)` resolves
 * `TemplatesAdminService` via `resolveTarget`, scoped by THIS sub-app's own name — a self-contained
 * DI resolution needing no `dependencies`/`resources` of its own.
 */
export function defineHubTemplatesApp(): ZanixAppDefinition {
  return defineZanixApp({
    name: ADMIN_HUB_TEMPLATES_APPLICATION,
    routes: false,
    operations: buildTemplatesOperations(ADMIN_HUB_TEMPLATES_APPLICATION),
  })
}
