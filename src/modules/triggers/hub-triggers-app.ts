import type { OperationDeclaration, ZanixAppDefinition } from '@zanix/app'
import type { CreateTriggerInput, UpdateTriggerInput } from '@zanix/database'

import { defineZanixApp } from '@zanix/app'
import { ADMIN_HUB_TRIGGERS_APPLICATION } from '../../utils/constants.ts'
import { getTriggersAggregator } from './triggers.aggregator.ts'

/**
 * Triggers `operations` for the hub — `ctx.remote('admin-hub-triggers').call(...)`/MCP surface for
 * `TriggersAggregator`, the SAME proxy `/triggers`'s REST controller (`defineAdminHubApp`) already
 * calls (fanning out to whichever registered service owns `serviceId`, via real HTTP — never a
 * zero-network shortcut, since the hub structurally never runs in the same process as the services
 * it manages). Distinct from Templates (`buildTemplatesOperations`): Triggers is a genuine proxy
 * here, not data this app owns directly, so it needs its own `serviceId`-carrying shape, and reuses
 * `getTriggersAggregator()` (the same module-level singleton the REST controller already resolves
 * through) rather than `resolveTarget` — there is no DI-managed class to resolve on this side.
 *
 * Only `listTriggers`/`getTrigger` (read-only) opt into `mcp` — see `buildTemplatesOperations`'s own
 * doc for why mutations don't, by default.
 */
export const hubTriggersOperations: Record<string, OperationDeclaration> = {
  listTriggers: {
    handler: () => getTriggersAggregator().list(),
    mcp: {
      description: 'Lists triggers aggregated across every registered service.',
    },
  },
  getTrigger: {
    handler: (payload) => {
      const { serviceId, model } = payload as {
        serviceId: string
        model: string
      }
      return getTriggersAggregator().get(serviceId, model)
    },
    mcp: {
      description: 'Gets the trigger for a model on a given registered service.',
      inputSchema: {
        type: 'object',
        required: ['serviceId', 'model'],
        properties: {
          serviceId: { type: 'string' },
          model: { type: 'string' },
        },
      },
    },
  },
  createTrigger: {
    handler: (payload) => {
      const { serviceId, model, active, triggers } = payload as
        & { serviceId: string }
        & CreateTriggerInput
      return getTriggersAggregator().create(serviceId, {
        model,
        active,
        triggers,
      })
    },
  },
  updateTrigger: {
    handler: (payload) => {
      const { serviceId, model, active, triggers } = payload as
        & { serviceId: string; model: string }
        & UpdateTriggerInput
      return getTriggersAggregator().update(serviceId, model, {
        active,
        triggers,
      })
    },
  },
  removeTrigger: {
    handler: async (payload) => {
      const { serviceId, model } = payload as {
        serviceId: string
        model: string
      }
      await getTriggersAggregator().remove(serviceId, model)
      return { deleted: model }
    },
  },
}

/**
 * The hub's Triggers `operations`/`mcp` surface, as its own physically-separate Zanix App —
 * extracted from `defineAdminHubApp` (which still owns the actual `/triggers` REST controller) so
 * this capability has its own file and its own addressable identity
 * (`ADMIN_HUB_TRIGGERS_APPLICATION`), the necessary precondition for a future independent deploy
 * (e.g. `bootstrapRemoteApp(defineHubTriggersApp())`) — not yet wired for standalone HTTP service
 * (see `getAdminHubSubApps`'s own doc in `admin-hub-app.ts`), only for same-process `ctx.remote()`
 * reachability today.
 *
 * `routes: false` — this sub-app owns no REST surface of its own; `/triggers` stays on
 * `defineAdminHubApp`. Declares no `dependencies`/`resources` — `getTriggersAggregator()` reads an
 * already-installed module-level singleton (wired by `defineAdminHubApp`'s own `setup()`), so this
 * sub-app needs nothing from the DI graph itself.
 */
export function defineHubTriggersApp(): ZanixAppDefinition {
  return defineZanixApp({
    name: ADMIN_HUB_TRIGGERS_APPLICATION,
    routes: false,
    operations: hubTriggersOperations,
  })
}
