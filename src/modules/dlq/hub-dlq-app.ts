import type { OperationDeclaration, ZanixAppDefinition } from '@zanix/app'
import type { DlqDiscardOptions, DlqPushInput, DlqRequeueOptions } from '@zanix/datamaster/dlq'

import { defineZanixApp } from '@zanix/app'
import { ADMIN_HUB_DLQ_APPLICATION } from '../../utils/constants.ts'
import { getDlqAggregator } from './dlq.aggregator.ts'

/**
 * DLQ (Dead Letter Queue) `operations` for the hub — `ctx.remote('admin-hub-dlq').call(...)`/MCP
 * surface for `DlqAggregator`, the SAME proxy `/dlq`'s REST controller (`defineAdminHubApp`)
 * already calls (fanning out to whichever registered service owns `serviceId`, via real HTTP —
 * never a zero-network shortcut, since the hub structurally never runs in the same process as the
 * services it manages). Same shape as `hubTriggersOperations`, one domain over: a genuine proxy
 * here, not data this app owns directly, so it reuses `getDlqAggregator()` (the same module-level
 * singleton the REST controller already resolves through) rather than `resolveTarget` — there is no
 * DI-managed class to resolve on this side.
 *
 * Only `listDlqEntries`/`getDlqEntry` (read-only) opt into `mcp` — same reasoning
 * `localDlqOperations`'s own doc (`../dlq/local-dlq-app.ts`) gives for the local side's identical
 * read/mutation split: `pushDlqEntry` registers a new failure record, `requeueDlqEntry` schedules a
 * retry that fires whatever business logic reprocesses the entry, `discardDlqEntry` permanently
 * closes one, and `removeDlqEntry` permanently deletes one — real side effects an agent shouldn't
 * trigger unilaterally by default.
 */
export const hubDlqOperations: Record<string, OperationDeclaration> = {
  listDlqEntries: {
    handler: () => getDlqAggregator().list(),
    mcp: {
      description: 'Lists dead-letter queue entries aggregated across every registered service.',
    },
  },
  getDlqEntry: {
    handler: (payload) => {
      const { serviceId, id } = payload as { serviceId: string; id: string }
      return getDlqAggregator().get(serviceId, id)
    },
    mcp: {
      description: 'Gets the dead-letter queue entry for an id on a given registered service.',
      inputSchema: {
        type: 'object',
        required: ['serviceId', 'id'],
        properties: {
          serviceId: { type: 'string' },
          id: { type: 'string' },
        },
      },
    },
  },
  pushDlqEntry: {
    handler: (payload) => {
      const { serviceId, ...input } = payload as
        & { serviceId: string }
        & DlqPushInput
      return getDlqAggregator().push(serviceId, input)
    },
  },
  requeueDlqEntry: {
    handler: (payload) => {
      const { serviceId, id, ...options } = payload as
        & { serviceId: string; id: string }
        & DlqRequeueOptions
      return getDlqAggregator().requeue(serviceId, id, options)
    },
  },
  discardDlqEntry: {
    handler: (payload) => {
      const { serviceId, id, ...options } = payload as
        & { serviceId: string; id: string }
        & DlqDiscardOptions
      return getDlqAggregator().discard(serviceId, id, options)
    },
  },
  removeDlqEntry: {
    handler: async (payload) => {
      const { serviceId, id } = payload as { serviceId: string; id: string }
      await getDlqAggregator().remove(serviceId, id)
      return { deleted: id }
    },
  },
}

/**
 * The hub's DLQ `operations`/`mcp` surface, as its own physically-separate Zanix App — extracted
 * from `defineAdminHubApp` (which still owns the actual `/dlq` REST controller) so this capability
 * has its own file and its own addressable identity (`ADMIN_HUB_DLQ_APPLICATION`), the necessary
 * precondition for a future independent deploy — not yet wired for standalone HTTP service (see
 * `getAdminHubSubApps`'s own doc in `admin-hub-app.ts`), only for same-process `ctx.remote()`
 * reachability today. Same shape as `defineHubTriggersApp`.
 *
 * `routes: false` — this sub-app owns no REST surface of its own; `/dlq` stays on
 * `defineAdminHubApp`. Declares no `dependencies`/`resources` — `getDlqAggregator()` reads an
 * already-installed module-level singleton (wired by `defineAdminHubApp`'s own `setup()`), so this
 * sub-app needs nothing from the DI graph itself.
 */
export function defineHubDlqApp(): ZanixAppDefinition {
  return defineZanixApp({
    name: ADMIN_HUB_DLQ_APPLICATION,
    routes: false,
    operations: hubDlqOperations,
  })
}
