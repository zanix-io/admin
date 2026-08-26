/**
 * What's left of this package's own `@zanix/notifications` mirror, now that
 * `@zanix/notifications/templates-types` exists (a real, narrow subpath exposing
 * `ZanixTemplateAttrs`/`CreateTemplateInput`/`UpdateTemplateInput`/`SyncCodeTemplateEntry`/
 * `SyncCodeTemplatesResult`/`TemplatesControllerOptions`, confirmed free of Handlebars/Zod/Mongoose)
 * — every consumer of those types now imports the real thing directly instead of a hand-rolled
 * `*Like` copy; see `templates-operations.ts`/`templates-sync.ts`/`metadata.ts`/
 * `admin-hub-app.ts`/`start.ts`.
 *
 * What genuinely can't move to a real import: `TemplatesAdminService`/`TemplatesAdminRepository`
 * themselves — the real CRUD classes, which DO need Handlebars (syntax validation on
 * create/update) and Mongo, unconditionally, from every subpath that exposes them (root, `/core`,
 * `/templates-api`). Their own narrow shapes stay hand-declared here, and the lazy resolvers built
 * on them stay lazy — a deployment with templates disabled must never resolve either class merely
 * because this module is reachable. `NotifiersLike` also stays: it's only available for real via
 * `@zanix/notifications/connectors` (a separate subpath this package doesn't otherwise need), and a
 * 3-way literal union carries near-zero drift risk — not worth a third local link for.
 *
 * Update `TemplatesAdminServiceLike`/`TemplatesAdminRepositoryLike` by hand if
 * `@zanix/notifications` ever changes either class's real shape — a real, accepted duplication
 * cost, not accidental drift (same trade-off `@zanix/app`'s own `AsyncmqExports` narrow-interface
 * pattern makes).
 */

import type {
  CreateTemplateInput,
  SyncCodeTemplateEntry,
  SyncCodeTemplatesResult,
  UpdateTemplateInput,
  ZanixTemplateAttrs,
} from '@zanix/notifications/templates-types'

import { NOTIFICATIONS_SPECIFIER } from './specifiers.ts'

/** Local mirror of `@zanix/notifications`'s own `Notifiers` — see this file's own doc for why this
 * one alone stays hand-declared rather than imported from `@zanix/notifications/connectors`. */
export type NotifiersLike = 'email' | 'sms' | 'whatsapp'

/**
 * Local, narrow shape of `@zanix/notifications`'s own `TemplatesAdminService` — only the five
 * methods `templates-operations.ts` calls through `resolveTarget`.
 */
export interface TemplatesAdminServiceLike {
  list(): Promise<ZanixTemplateAttrs[]>
  get(channel: NotifiersLike, name: string): Promise<ZanixTemplateAttrs>
  create(input: CreateTemplateInput, updatedBy: string): Promise<ZanixTemplateAttrs>
  update(
    channel: NotifiersLike,
    name: string,
    changes: UpdateTemplateInput,
    updatedBy: string,
  ): Promise<ZanixTemplateAttrs>
  remove(channel: NotifiersLike, name: string, updatedBy: string): Promise<void>
}

/**
 * Local, narrow shape of `@zanix/notifications`'s own `TemplatesAdminRepository` — only the one
 * method `templates-sync.ts` calls via `ProgramModule.providers.get(...)`.
 */
export interface TemplatesAdminRepositoryLike {
  syncCodeTemplates(
    entries: SyncCodeTemplateEntry[],
    updatedBy?: string,
  ): Promise<SyncCodeTemplatesResult>
}

/** Resolves `TemplatesAdminService` lazily. Used by `templates-operations.ts`, gated the same way
 * `metadata.ts`'s own templates entry is (only reached once `isTemplatesResourceEnabled()` already
 * passed). */
export const resolveTemplatesAdminService = async (): Promise<
  new () => TemplatesAdminServiceLike
> => {
  const notifications = await import(NOTIFICATIONS_SPECIFIER) as {
    TemplatesAdminService: new () => TemplatesAdminServiceLike
  }
  return notifications.TemplatesAdminService
}

/** Resolves `TemplatesAdminRepository` + `toSyncCodeTemplateEntries` lazily. Used by
 * `templates-sync.ts`'s `syncTemplatesFromRegisteredService`/`pullTemplateEntries`. */
export const resolveTemplatesAdminRepositoryAndConverter = async (): Promise<{
  TemplatesAdminRepository: new () => TemplatesAdminRepositoryLike
  toSyncCodeTemplateEntries: (entries: ZanixTemplateAttrs[]) => SyncCodeTemplateEntry[]
}> => {
  const notifications = await import(NOTIFICATIONS_SPECIFIER) as {
    TemplatesAdminRepository: new () => TemplatesAdminRepositoryLike
    toSyncCodeTemplateEntries: (entries: ZanixTemplateAttrs[]) => SyncCodeTemplateEntry[]
  }
  return notifications
}
