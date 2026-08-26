import { BaseRTO, IsString } from '@zanix/validator'

/**
 * Body validation shared by this proxy's `POST /dlq/:serviceId`,
 * `POST /dlq/:serviceId/:id/requeue`, and `POST /dlq/:serviceId/:id/discard`, and
 * `@zanix/datamaster`'s own local `/admin/dlq` — the same wire shape, since a proxying request
 * forwards this body to the target service's own admin API unchanged. Authored by
 * `@zanix/datamaster` (`@zanix/datamaster/dlq-api`, the real owner of this data); re-exported here
 * so this package's own proxy controller (`../dlq.handler.ts`) reuses the identical validation
 * instead of a hand-rolled copy that could drift — same pattern `triggers.rto.ts` already
 * establishes for `CreateTriggerRTO`/`UpdateTriggerRTO`.
 */
export { DiscardDlqEntryRTO, PushDlqEntryRTO, RequeueDlqEntryRTO } from '@zanix/datamaster/dlq-api'

/** Route params for a service-scoped operation with no entry `id` yet (`POST /dlq/:serviceId`).
 * Mirrors `TriggerServiceParamsRTO`'s own role. */
export class DlqServiceParamsRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor serviceId!: string
}

/** Route params for a single DLQ entry on a given service (`GET/POST/DELETE
 * /dlq/:serviceId/:id[...]`). Mirrors `TriggerServiceModelParamsRTO`'s own role, `id` instead of
 * `model` since a DLQ entry is addressed by its persisted `_id`, not a model name. */
export class DlqServiceEntryParamsRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor serviceId!: string

  @IsString({ expose: true })
  accessor id!: string
}
