import type { OperationDeclaration, ZanixAppDefinition } from '@zanix/app'
import type {
  DlqDiscardOptions,
  DlqListOptions,
  DlqPushInput,
  DlqRequeueOptions,
} from '@zanix/datamaster/dlq'

import { defineZanixApp } from '@zanix/app'
import { resolveTarget } from '@zanix/app/runtime'
import { DlqAdminService } from '@zanix/datamaster/dlq'
import { ADMIN_DLQ_APPLICATION } from '../../utils/constants.ts'

/**
 * This service's own persisted-DLQ (Dead Letter Queue) operations — `ctx.remote('admin-dlq').call(...)`/MCP
 * surface for `DlqAdminService`, the SAME business logic `@zanix/datamaster/dlq-api`'s
 * `createDlqAdminController`/`/admin/dlq` REST controller already calls, resolved here via
 * `resolveTarget` — the same pattern `local-triggers-app.ts`'s `localTriggersOperations` already
 * establishes for `TriggersAdminService`. `resolveTarget(ADMIN_DLQ_APPLICATION, ...)` scopes it by
 * THIS sub-app's own stable name, never omitted — see `localTriggersOperations`'s own doc for why
 * that's not merely a style choice.
 *
 * Purely additive — `/admin/dlq` itself (once wired on `defineLocalAdminApp`, a separate concern
 * from this sub-app) is completely untouched; this is a second way to reach the exact same
 * `DlqAdminService`, never a second implementation of it.
 *
 * `DlqAdminService` itself already excludes the lease-fenced worker-only primitives
 * (`claim`/`release`/`complete`/`fail` — see that class's own JSDoc for why: they're fenced by a
 * `leaseOwner` a specific worker process holds, not something an admin/agent has a real lease to
 * present), so every operation below is already a genuine admin/operator action. Even so, only
 * `getDlqEntry`/`listDlqEntries` (read-only) opt into `mcp` — `pushDlqEntry` registers a new
 * failure record, `requeueDlqEntry` schedules a retry that fires whatever business logic
 * reprocesses the entry, `discardDlqEntry` permanently closes one, and `removeDlqEntry` permanently
 * deletes one; giving an agent unrestricted access to any of those is a real risk (an agent
 * requeuing/discarding entries on its own initiative triggers real business side effects or
 * destroys audit history) that needs its own deliberate decision, not a default — the exact same
 * read-only-vs-mutation reasoning `localTriggersOperations`'s own doc applies to
 * `listTriggers`/`getTrigger` vs. trigger mutations, applied here to DLQ's own read/mutation split.
 */
export const localDlqOperations: Record<string, OperationDeclaration> = {
  listDlqEntries: {
    handler: (payload) => {
      const options = payload as DlqListOptions | undefined
      return resolveTarget(ADMIN_DLQ_APPLICATION, DlqAdminService).list(options)
    },
    mcp: { description: "Lists this service's own dead-letter queue entries." },
  },
  getDlqEntry: {
    handler: (payload) => {
      const { id } = payload as { id: string }
      return resolveTarget(ADMIN_DLQ_APPLICATION, DlqAdminService).get(id)
    },
    mcp: {
      description: 'Gets a single dead-letter queue entry by id.',
      inputSchema: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
  },
  pushDlqEntry: {
    handler: (payload) => {
      const input = payload as DlqPushInput
      return resolveTarget(ADMIN_DLQ_APPLICATION, DlqAdminService).push(input)
    },
  },
  requeueDlqEntry: {
    handler: (payload) => {
      const { id, ...options } = payload as { id: string } & DlqRequeueOptions
      return resolveTarget(ADMIN_DLQ_APPLICATION, DlqAdminService).requeue(id, options)
    },
  },
  discardDlqEntry: {
    handler: (payload) => {
      const { id, ...options } = payload as { id: string } & DlqDiscardOptions
      return resolveTarget(ADMIN_DLQ_APPLICATION, DlqAdminService).discard(id, options)
    },
  },
  removeDlqEntry: {
    handler: async (payload) => {
      const { id } = payload as { id: string }
      await resolveTarget(ADMIN_DLQ_APPLICATION, DlqAdminService).remove(id)
      return { deleted: id }
    },
  },
}

/**
 * The embedded, business-service-side DLQ `operations`/`mcp` surface, as its own
 * physically-separate Zanix App — same shape `defineLocalTriggersApp` already establishes, given
 * its own file and its own addressable identity (`ADMIN_DLQ_APPLICATION`), the necessary
 * precondition for a future independent deploy — not yet wired for standalone HTTP service (see
 * `getLocalAdminSubApps`'s own doc in `local-admin-app.ts`), only for same-process `ctx.remote()`
 * reachability today.
 *
 * `routes: false` — this sub-app owns no REST surface of its own. Declares no
 * `dependencies`/`resources` — `resolveTarget` reaches `DlqAdminService` through `@zanix/server`'s
 * own DI (`ProgramModule.getInteractors()`), not through this app's own resource graph.
 *
 * DLQ is now mirrored on both sides, the same shape Triggers/Templates already establish — see
 * `defineHubDlqApp` (`./hub-dlq-app.ts`), backed by `DlqAggregator`/`DlqAdminClient` (a
 * `ServiceRegistry`-driven remote fan-out to each registered service's own `/admin/dlq`, mirroring
 * `TriggersAggregator`/`TriggersAdminClient`).
 */
export function defineLocalDlqApp(): ZanixAppDefinition {
  return defineZanixApp({
    name: ADMIN_DLQ_APPLICATION,
    routes: false,
    operations: localDlqOperations,
  })
}
