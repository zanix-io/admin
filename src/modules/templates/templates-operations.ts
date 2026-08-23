import type { OperationDeclaration } from '@zanix/app'
import type {
  CreateTemplateInput,
  Notifiers,
  UpdateTemplateInput,
  ZanixTemplateAttrs,
} from '@zanix/notifications'

import { resolveTarget } from '@zanix/app/runtime'
import { TemplatesAdminService } from '@zanix/notifications'

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
 * owned DIRECTLY by {@link TemplatesAdminService} in both deployments (the hub's own `/templates`
 * and a business service's own `/admin/templates` both call the exact same class — see
 * `@zanix/notifications/templates-api`'s `templates.handler.ts`'s own doc) — so the operations
 * built here are structurally identical
 * either way, differing only in which Application (`appName`) they resolve `TemplatesAdminService`
 * against via `resolveTarget`.
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
      handler: () => resolveTarget(appName, TemplatesAdminService).list(),
      mcp: { description: 'Lists registered notification templates.' },
    },
    getTemplate: {
      handler: (payload) => {
        const { channel, name } = payload as {
          channel: Notifiers
          name: string
        }
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
      handler: (payload): Promise<ZanixTemplateAttrs> => {
        const input = payload as CreateTemplateInput
        return resolveTarget(appName, TemplatesAdminService).create(
          input,
          OPERATION_UPDATED_BY,
        )
      },
    },
    updateTemplate: {
      handler: (payload): Promise<ZanixTemplateAttrs> => {
        const { channel, name, ...changes } = payload as
          & { channel: Notifiers; name: string }
          & UpdateTemplateInput
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
          channel: Notifiers
          name: string
        }
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
