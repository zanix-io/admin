import type { Notifiers, ZanixTemplateAttrs } from '@zanix/notifications'
import type { SyncCodeTemplateEntry, SyncCodeTemplatesResult } from './templates.repository.ts'

import { Interactor, ZanixInteractor } from '@zanix/server'
import { TemplatesAdminRepository } from './templates.repository.ts'

/**
 * Business logic behind `/admin/templates`/`/templates` — see `templates.handler.ts`.
 *
 * Exported so a consuming app can extend or reuse this as the base for its own custom templates
 * API instead of duplicating the CRUD logic against `TemplatesAdminRepository` directly.
 */
@Interactor()
export class TemplatesAdminService extends ZanixInteractor {
  private get repository(): TemplatesAdminRepository {
    return this.providers.get(TemplatesAdminRepository)
  }

  public list(channel?: Notifiers): Promise<ZanixTemplateAttrs[]> {
    return this.repository.list(channel)
  }

  public get(channel: Notifiers, name: string): Promise<ZanixTemplateAttrs> {
    return this.repository.get(channel, name)
  }

  public create(
    input: {
      channel: Notifiers
      name: string
      hbs: string
      description?: string
      availableVariables?: string[]
    },
    updatedBy: string,
  ): Promise<ZanixTemplateAttrs> {
    return this.repository.create(input, updatedBy)
  }

  public update(
    channel: Notifiers,
    name: string,
    changes: {
      hbs?: string
      active?: boolean
      description?: string
      availableVariables?: string[]
    },
    updatedBy: string,
  ): Promise<ZanixTemplateAttrs> {
    return this.repository.update(channel, name, changes, updatedBy)
  }

  public remove(channel: Notifiers, name: string, updatedBy: string): Promise<void> {
    return this.repository.remove(channel, name, updatedBy)
  }

  public syncCodeTemplates(
    entries: SyncCodeTemplateEntry[],
    updatedBy?: string,
  ): Promise<SyncCodeTemplatesResult> {
    return this.repository.syncCodeTemplates(entries, updatedBy)
  }
}
