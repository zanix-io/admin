import {
  isDlqResourceEnabled as datamasterIsDlqResourceEnabled,
  isTriggersResourceEnabled as datamasterIsTriggersResourceEnabled,
} from '@zanix/database'
import { isTemplatesResourceEnabled as notificationsIsTemplatesResourceEnabled } from '@zanix/notifications'

/**
 * The single source of truth for "is this resource configured in this deployment" — one function
 * per resource. {@link defineAdminMetadata} (`metadata.ts`, REST/Discovery gating) and
 * {@link getLocalAdminSubApps} (`local-admin-app.ts`, operations/mcp gating) both call these
 * instead of re-deriving the condition inline, so the two surfaces can never drift apart the way
 * they did before this module existed (templates/dlq's operations/mcp sub-apps were composed
 * unconditionally while their REST controllers were already opt-in).
 *
 * Each is a thin re-export/adapter over the real owner package's own `isXResourceEnabled()` —
 * `@zanix/datamaster` (aliased `@zanix/database` in this package's own imports) owns triggers/dlq,
 * `@zanix/notifications` owns templates — not this package's own derived logic. This file exists
 * so `metadata.ts`/`local-admin-app.ts` share ONE import surface with a stable name/shape, even
 * though the two owner packages don't (and shouldn't) share one themselves — see each function's
 * own doc for exactly what it delegates to. Kept as a separate module rather than folded into
 * `metadata.ts` because `local-admin-app.ts` depends on it too, symmetrically; a "REST metadata"
 * file isn't the right owner for something a completely separate sub-app composition file needs
 * just as much.
 *
 * Evaluated fresh on every call, never cached — same reasoning `defineAdminMetadata`'s own doc
 * already gives for why it re-reads its env vars on every invocation rather than once at import
 * time (a process that boots more than once, e.g. a single `deno test` run exercising many
 * independent `Zanix.bootstrap()` cycles, needs each boot to see the environment as it is then).
 */

/** Triggers is on by default — re-exported as-is from `@zanix/datamaster`'s own
 * `isTriggersResourceEnabled()` (the inverse of that package's `isTriggersModelDisabled()`). */
export const isTriggersResourceEnabled: () => boolean = datamasterIsTriggersResourceEnabled

/** DLQ is opt-in — re-exported as-is from `@zanix/datamaster`'s own `isDlqResourceEnabled()`
 * (`true` once `DLQ_MODEL_NAME` is set; see that function's own doc for the known
 * "doesn't guarantee `registerDLQModel()` ran" gap this inherits, not introduces). */
export const isDlqResourceEnabled: () => boolean = datamasterIsDlqResourceEnabled

/** Templates is opt-in — `@zanix/notifications`'s own `isTemplatesResourceEnabled(mode)` takes an
 * explicit mode because "templates enabled" has no single meaning there (a `'remote'` deployment
 * has templates fully configured too, just not locally); this package's admin surface only ever
 * cares about the local, DB-backed case, so this partially applies `'local'` once here rather than
 * every call site re-stating it. */
export function isTemplatesResourceEnabled(): boolean {
  return notificationsIsTemplatesResourceEnabled('local')
}
