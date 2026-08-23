import { BaseRTO, IsString } from '@zanix/validator'

/**
 * Body validation shared by this proxy's `POST`/`PUT /triggers/:serviceId[/:model]` and
 * `@zanix/datamaster`'s own local `/admin/triggers` — the same wire shape, since a proxying
 * request forwards this body to the target service's own admin API unchanged. Authored by
 * `@zanix/datamaster` (`@zanix/datamaster/triggers-api`, the real owner of this data); re-exported
 * here so this package's own proxy controller (`../triggers.handler.ts`) reuses the identical
 * validation instead of a hand-rolled copy that could drift.
 */
export { CreateTriggerRTO, UpdateTriggerRTO } from '@zanix/datamaster/triggers-api'

/** Route params for a service-scoped operation with no `model` yet (e.g. `POST /triggers/:serviceId`).
 * `serviceId` (camelCase) — safe now that `@zanix/server`'s router preserves a route param's own
 * NAME casing (previously required snake_case here, since a camelCase param name silently arrived
 * as `undefined`; see that fix's own changelog entry). */
export class TriggerServiceParamsRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor serviceId!: string
}

/** Route params for a single trigger entry on a given service. */
export class TriggerServiceModelParamsRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor serviceId!: string

  @IsString({ expose: true })
  accessor model!: string
}
