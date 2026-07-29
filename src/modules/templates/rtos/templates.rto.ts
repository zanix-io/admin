import type { Notifiers } from '@zanix/notifications'

import { BaseRTO, IsArray, IsBoolean, IsEnum, IsString, ValidateNested } from '@zanix/validator'
import { NOTIFIER_CHANNELS } from '@zanix/notifications'

export class TemplateParamsRTO extends BaseRTO {
  @IsEnum(NOTIFIER_CHANNELS, { expose: true })
  accessor channel!: Notifiers

  @IsString({ expose: true })
  accessor name!: string
}

export class CreateTemplateRTO extends BaseRTO {
  @IsEnum(NOTIFIER_CHANNELS, { expose: true })
  accessor channel!: Notifiers

  @IsString({ expose: true })
  accessor name!: string

  @IsString({ expose: true })
  accessor hbs!: string

  @IsString({ optional: true, expose: true })
  accessor description: string | undefined

  @IsArray({ optional: true, expose: true })
  accessor availableVariables: string[] | undefined
}

export class UpdateTemplateRTO extends BaseRTO {
  @IsString({ optional: true, expose: true })
  accessor hbs: string | undefined

  @IsBoolean({ optional: true, expose: true })
  accessor active: boolean | undefined

  @IsString({ optional: true, expose: true })
  accessor description: string | undefined

  @IsArray({ optional: true, expose: true })
  accessor availableVariables: string[] | undefined
}

/** A single code-defined template entry, as submitted to `POST /templates/sync` — see `SyncTemplatesRTO`. */
export class SyncTemplateEntryRTO extends BaseRTO {
  @IsEnum(NOTIFIER_CHANNELS, { expose: true })
  accessor channel!: Notifiers

  @IsString({ expose: true })
  accessor name!: string

  @IsString({ expose: true })
  accessor hbs!: string

  @IsString({ expose: true })
  accessor hash!: string
}

/** Batch sync request body — a caller's full current code-defined template set (see `TemplatesAdminRepository.syncCodeTemplates`). */
export class SyncTemplatesRTO extends BaseRTO {
  @ValidateNested(SyncTemplateEntryRTO, { each: true })
  accessor entries!: SyncTemplateEntryRTO[]
}
