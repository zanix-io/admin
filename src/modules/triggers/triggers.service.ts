import type { Triggers, TriggersModelAttrs } from '@zanix/database'

import { Interactor, ZanixInteractor } from '@zanix/server'
import { TriggersAdminRepository } from './triggers.repository.ts'

/**
 * Business logic behind a business service's own local `/admin/triggers` — see
 * `local-triggers.handler.ts`. Distinct from this package's own `/triggers` (a proxy/aggregator
 * over N services, see `triggers.handler.ts`/`TriggersAggregator`) — this one owns real persisted
 * data via `TriggersAdminRepository`.
 */
@Interactor()
export class TriggersAdminService extends ZanixInteractor {
  private get repository(): TriggersAdminRepository {
    return this.providers.get(TriggersAdminRepository)
  }

  public list(): Promise<TriggersModelAttrs[]> {
    return this.repository.list()
  }

  public get(model: string): Promise<TriggersModelAttrs> {
    return this.repository.get(model)
  }

  public create(model: string, active: boolean, triggers: Triggers): Promise<TriggersModelAttrs> {
    return this.repository.create(model, active, triggers)
  }

  public update(
    model: string,
    changes: { active?: boolean; triggers?: Triggers },
  ): Promise<TriggersModelAttrs> {
    return this.repository.update(model, changes)
  }

  public remove(model: string): Promise<void> {
    return this.repository.remove(model)
  }
}
