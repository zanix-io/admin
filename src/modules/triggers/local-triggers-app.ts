import type { OperationDeclaration, ZanixAppDefinition } from '@zanix/app'
import type { CreateTriggerInput, UpdateTriggerInput } from '@zanix/database'

import { defineZanixApp } from '@zanix/app'
import { resolveTarget } from '@zanix/app/runtime'
import { TriggersAdminService } from '@zanix/database'
import { ADMIN_TRIGGERS_APPLICATION } from '../../utils/constants.ts'

/**
 * This service's own persisted-triggers operations — `ctx.remote('admin-triggers').call(...)`/MCP
 * surface for `TriggersAdminService`, the SAME business logic `@zanix/datamaster/triggers-api`'s
 * `createTriggersAdminController`/`/admin/triggers` REST controller already calls, resolved here
 * via `resolveTarget` (the same DI
 * accessor `@zanix/app`'s own `AppSetupContext.resolve()` uses internally — an operation handler
 * has no `HandlerContext`/`this.interactor`, so this is how it reaches a DI-managed Interactor).
 * `resolveTarget(ADMIN_TRIGGERS_APPLICATION, ...)` scopes it by THIS sub-app's own stable name,
 * never omitted — `ProgramModule.getInteractors()` with no id leaks a permanent singleton under a
 * shared default key that's never cleaned up (confirmed against `@zanix/server`'s own
 * `getInteractor` implementation), so this is not merely a style choice.
 *
 * Purely additive — `/admin/triggers` itself is completely untouched; this is a second way to reach
 * the exact same `TriggersAdminService`, never a second implementation of it.
 *
 * Only `listTriggers`/`getTrigger` (read-only) opt into `mcp` — giving an agent unrestricted write access to a
 * service's own trigger configuration is a real risk (a misconfigured trigger fires real business
 * side effects) that needs its own deliberate decision, not a default (see the platform's own design
 * doc for this same reasoning applied to Templates).
 */
export const localTriggersOperations: Record<string, OperationDeclaration> = {
  listTriggers: {
    handler: () => resolveTarget(ADMIN_TRIGGERS_APPLICATION, TriggersAdminService).list(),
    mcp: { description: "Lists this service's own persisted triggers." },
  },
  getTrigger: {
    handler: (payload) => {
      const { model } = payload as { model: string }
      return resolveTarget(ADMIN_TRIGGERS_APPLICATION, TriggersAdminService)
        .get(model)
    },
    mcp: {
      description: "Gets this service's own trigger for a given model.",
      inputSchema: {
        type: 'object',
        required: ['model'],
        properties: { model: { type: 'string' } },
      },
    },
  },
  createTrigger: {
    handler: (payload) => {
      const { model, active, triggers } = payload as CreateTriggerInput
      return resolveTarget(ADMIN_TRIGGERS_APPLICATION, TriggersAdminService)
        .create({
          model,
          active,
          triggers,
        })
    },
  },
  updateTrigger: {
    handler: (payload) => {
      const { model, active, triggers } = payload as
        & { model: string }
        & UpdateTriggerInput
      return resolveTarget(ADMIN_TRIGGERS_APPLICATION, TriggersAdminService)
        .update(model, {
          active,
          triggers,
        })
    },
  },
  removeTrigger: {
    handler: async (payload) => {
      const { model } = payload as { model: string }
      await resolveTarget(ADMIN_TRIGGERS_APPLICATION, TriggersAdminService)
        .remove(model)
      return { deleted: model }
    },
  },
}

/**
 * The embedded, business-service-side Triggers `operations`/`mcp` surface, as its own
 * physically-separate Zanix App — extracted from `defineLocalAdminApp` (which still owns the
 * actual `/admin/triggers` REST controller, via `defineAdminMetadata`) so this capability has its
 * own file and its own addressable identity (`ADMIN_TRIGGERS_APPLICATION`), the necessary
 * precondition for a future independent deploy — not yet wired for standalone HTTP service (see
 * `getLocalAdminSubApps`'s own doc in `local-admin-app.ts`), only for same-process `ctx.remote()`
 * reachability today.
 *
 * `routes: false` — this sub-app owns no REST surface of its own. Declares no
 * `dependencies`/`resources` — `resolveTarget` reaches `TriggersAdminService` through
 * `@zanix/server`'s own DI (`ProgramModule.getInteractors()`), not through this app's own resource
 * graph.
 */
export function defineLocalTriggersApp(): ZanixAppDefinition {
  return defineZanixApp({
    name: ADMIN_TRIGGERS_APPLICATION,
    routes: false,
    operations: localTriggersOperations,
  })
}
