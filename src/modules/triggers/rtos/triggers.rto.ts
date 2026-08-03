import type { CreateTriggerInput, Triggers, UpdateTriggerInput } from '@zanix/database'

import { BaseRTO, Expose, IsBoolean, IsString } from '@zanix/validator'

/** Route params for a service-scoped operation with no `model` yet (e.g. `POST /triggers/:service_id`). */
export class TriggerServiceParamsRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor service_id!: string
}

/** Route params for a single trigger entry on a given service. */
export class TriggerServiceModelParamsRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor service_id!: string

  @IsString({ expose: true })
  accessor model!: string
}

/**
 * Body validation shared by this proxy's `POST /triggers/:service_id` and `@zanix/core`'s own
 * local `POST /admin/triggers` — the same wire shape, since a proxying request forwards this body
 * to the target service's own admin API unchanged.
 */
export class CreateTriggerRTO extends BaseRTO implements CreateTriggerInput {
  @IsString({ expose: true })
  accessor model!: string

  @IsBoolean({ optional: true, expose: true })
  accessor active: boolean = true

  /** Same shape as a model's static `extensions.triggers` — not deeply validated here, only
   * passed through; `@zanix/datamaster` owns the trigger-action schema itself. */
  @Expose()
  accessor triggers!: Triggers
}

/** Body validation shared by this proxy's `PUT /triggers/:service_id/:model` and `@zanix/core`'s
 * own local `PUT /admin/triggers/:model` — see {@link CreateTriggerRTO}. */
export class UpdateTriggerRTO extends BaseRTO implements UpdateTriggerInput {
  @IsBoolean({ optional: true, expose: true })
  accessor active: boolean | undefined

  @Expose({ optional: true })
  accessor triggers: Triggers | undefined
}
