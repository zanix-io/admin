import { BaseRTO, IsString } from '@zanix/validator'

/**
 * Sync request body — identifies which registered service to pull the current code-defined
 * template set FROM (via its own `/.well-known/zanix/code-templates` Discovery snapshot), rather
 * than carrying the entries themselves — see `syncTemplatesFromRegisteredService`. The CRUD RTOs
 * validating `/templates`'s other routes live in `@zanix/notifications/templates-api`, alongside
 * the CRUD controller they validate.
 */
export class SyncTemplatesRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor serviceId!: string
}
