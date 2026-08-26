import type { OperationDeclaration } from '@zanix/app'
import type {
  CreateTemplateInput,
  UpdateTemplateInput,
  ZanixTemplateAttrs,
} from '@zanix/notifications/templates-types'
import type { NotifiersLike } from '../lazy/notifications-shim.ts'

import { resolveTarget } from '@zanix/app/runtime'
import { resolveTemplatesAdminService } from '../lazy/notifications-shim.ts'

/**
 * `TemplatesAdminService`'s mutating methods take an `updatedBy` audit-trail identity — normally
 * the caller's own HTTP session id (`ctx.session?.id`, see `@zanix/notifications/templates-api`'s
 * `templates.handler.ts`). An operation's
 * own `ctx` (`RuntimeContext`) never carries a user session (app-to-app, not user-scoped — see
 * `OperationDeclaration`'s own doc), so there is no equivalent identity to forward here. A fixed
 * sentinel distinguishes an operation-triggered change from an HTTP one in the same audit trail,
 * rather than silently reusing `'unknown'` (the HTTP side's own no-session fallback) for a case
 * that isn't actually the same "no session" situation.
 */
const OPERATION_UPDATED_BY = 'zanix-operation'

/**
 * Templates `operations` for one Zanix App, scoped to `appName` — reused as-is by BOTH
 * `defineAdminHubApp` and `defineLocalAdminApp`: unlike Triggers (a proxy on the hub side, real
 * persisted data on the local side — genuinely different business logic per side), Templates is
 * owned DIRECTLY by `TemplatesAdminService` in both deployments (the hub's own `/templates`
 * and a business service's own `/admin/templates` both call the exact same class — see
 * `@zanix/notifications/templates-api`'s `templates.handler.ts`'s own doc) — so the operations
 * built here are structurally identical
 * either way, differing only in which Application (`appName`) they resolve `TemplatesAdminService`
 * against via `resolveTarget`.
 *
 * `TemplatesAdminService` itself is resolved LAZILY (`resolveTemplatesAdminService`, see
 * `specifiers.ts`'s own doc) — `@zanix/notifications` reaches Handlebars unconditionally from
 * every subpath, so a deployment with templates disabled must never resolve it merely because this
 * module is reachable. Every handler below `await`s the resolution before calling `resolveTarget`,
 * which changes nothing observable: `resolveTarget`'s own DI lookup was already synchronous-fast,
 * not a source of real latency, so gating it behind one microtask has no practical cost for a
 * deployment that DOES use templates.
 *
 * Only `listTemplates`/`getTemplate` (read-only) opt into `mcp` — giving an agent unrestricted
 * write access to notification templates is a real risk (a misconfigured template can break an
 * entire notification channel) that needs its own deliberate decision, not a default.
 */
export function buildTemplatesOperations(
  appName: string,
): Record<string, OperationDeclaration> {
  return {
    listTemplates: {
      handler: async () => {
        const TemplatesAdminService = await resolveTemplatesAdminService()
        return resolveTarget(appName, TemplatesAdminService).list()
      },
      mcp: { description: 'Lists registered notification templates.' },
    },
    getTemplate: {
      handler: async (payload) => {
        const { channel, name } = payload as {
          channel: NotifiersLike
          name: string
        }
        const TemplatesAdminService = await resolveTemplatesAdminService()
        return resolveTarget(appName, TemplatesAdminService).get(channel, name)
      },
      mcp: {
        description: 'Gets a template by channel and name.',
        inputSchema: {
          type: 'object',
          required: ['channel', 'name'],
          properties: { channel: { type: 'string' }, name: { type: 'string' } },
        },
      },
    },
    createTemplate: {
      handler: async (payload): Promise<ZanixTemplateAttrs> => {
        const input = payload as CreateTemplateInput
        const TemplatesAdminService = await resolveTemplatesAdminService()
        return resolveTarget(appName, TemplatesAdminService).create(
          input,
          OPERATION_UPDATED_BY,
        )
      },
    },
    updateTemplate: {
      handler: async (payload): Promise<ZanixTemplateAttrs> => {
        const { channel, name, ...changes } = payload as
          & { channel: NotifiersLike; name: string }
          & UpdateTemplateInput
        const TemplatesAdminService = await resolveTemplatesAdminService()
        return resolveTarget(appName, TemplatesAdminService).update(
          channel,
          name,
          changes,
          OPERATION_UPDATED_BY,
        )
      },
    },
    removeTemplate: {
      handler: async (payload) => {
        const { channel, name } = payload as {
          channel: NotifiersLike
          name: string
        }
        const TemplatesAdminService = await resolveTemplatesAdminService()
        await resolveTarget(appName, TemplatesAdminService).remove(
          channel,
          name,
          OPERATION_UPDATED_BY,
        )
        return { deactivated: name }
      },
    },
  }
}
