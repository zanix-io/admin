import type { Model, Triggers, TriggersModelAttrs, ZanixMongoConnector } from '@zanix/database'

import { Provider, ZanixProvider } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import { triggersModelName } from '@zanix/database'

/**
 * Data access for `@zanix/datamaster`'s persisted triggers collection (`zanix-triggers` by
 * default, or `TRIGGERS_MODEL_NAME`). Backs a business service's own local `/admin/triggers` API —
 * see `triggers.service.ts`/`local-triggers.handler.ts`.
 */
@Provider()
export class TriggersAdminRepository extends ZanixProvider<{ database: ZanixMongoConnector }> {
  private async model(): Promise<Model<TriggersModelAttrs>> {
    await this.database.isReady
    return this.database.getModel<TriggersModelAttrs>(triggersModelName())
  }

  public async list(): Promise<TriggersModelAttrs[]> {
    const Model = await this.model()
    return Model.find({})
  }

  public async get(model: string): Promise<TriggersModelAttrs> {
    const Model = await this.model()
    const entry = await Model.findOne({ model })
    if (!entry) throw new HttpError('NOT_FOUND', { meta: { model } })
    return entry
  }

  public async create(
    model: string,
    active: boolean,
    triggers: Triggers,
  ): Promise<TriggersModelAttrs> {
    const Model = await this.model()
    const existing = await Model.findOne({ model })
    if (existing) {
      throw new HttpError('CONFLICT', {
        meta: { model, message: `A trigger configuration for model "${model}" already exists.` },
      })
    }
    return Model.create({ model, active, triggers, isDefault: false })
  }

  public async update(
    model: string,
    changes: { active?: boolean; triggers?: Triggers },
  ): Promise<TriggersModelAttrs> {
    const Model = await this.model()
    const entry = await Model.findOneAndUpdate({ model }, { $set: changes }, { new: true })
    if (!entry) throw new HttpError('NOT_FOUND', { meta: { model } })
    return entry
  }

  /**
   * Deletes a trigger configuration entry. Note: if the entry is `isDefault: true` (auto-seeded
   * from a model's static `extensions.triggers`), the deletion isn't durable — it gets re-seeded
   * from code the next time the app boots. This is existing `@zanix/datamaster` behavior, not
   * something this API can or should override.
   */
  public async remove(model: string): Promise<void> {
    const Model = await this.model()
    const result = await Model.deleteOne({ model })
    if (!result.deletedCount) throw new HttpError('NOT_FOUND', { meta: { model } })
  }
}
