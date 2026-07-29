import { BaseRTO, IsString } from '@zanix/validator'

/** Request body for `POST /admin/service-token` — see `ServiceExchangeController`. */
export class ServiceExchangeRTO extends BaseRTO {
  @IsString({ expose: true })
  accessor assertion!: string
}
