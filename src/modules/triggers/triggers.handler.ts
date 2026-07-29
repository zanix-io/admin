import type { HandlerContext } from '@zanix/server'
import type { TriggersModelAttrs } from '@zanix/database'

import { Controller, Delete, Get, Post, Put, ZanixController } from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import { ADMIN_ROLE, ADMIN_TRIGGERS_ROLE } from 'utils/constants.ts'
import { ADMIN_VERSION_PROTOCOL } from '../protocol/version-protocol.ts'
import { getTriggersAggregator } from './triggers.aggregator.ts'
import type { AggregatedTrigger } from './triggers.aggregator.ts'
import {
  CreateTriggerRTO,
  TriggerServiceModelParamsRTO,
  TriggerServiceParamsRTO,
  UpdateTriggerRTO,
} from './rtos/triggers.rto.ts'

const REQUIRED_ROLE = [ADMIN_ROLE, ADMIN_TRIGGERS_ROLE]
// Accepts either a human admin's user-shaped token or a machine caller's api-shaped one on the
// same route — see `@zanix/auth`'s `AuthTokenValidation({ type })` array support.
const AUTH_TYPES = ['user', 'api'] as const

/** Options accepted by {@link createTriggersController}. */
export interface TriggersControllerOptions {
  /**
   * Whether this route is only mounted on a server bootstrapped with a matching
   * `isInternal: true` (see `bootstrapServers`'s `BootstrapServerOptions[type].isInternal`).
   * Defaults to `true` — `zanix-admin`'s own admin/ops surface is not meant to be reachable by an
   * arbitrary public caller. Set to `false` if your deployment platform genuinely can't isolate an
   * internal server; `AuthTokenValidation` + the role gate remain the load-bearing protection
   * either way.
   */
  isInternal?: boolean
  /** The route prefix, e.g. `'triggers'` (default) for `/triggers`. */
  prefix?: string
}

/** The instance shape {@link createTriggersController} builds — see its own docs. */
export interface TriggersControllerInstance extends ZanixController {
  list(): Promise<AggregatedTrigger[]>
  get(ctx: HandlerContext<{ params: TriggerServiceModelParamsRTO }>): Promise<TriggersModelAttrs>
  create(
    ctx: HandlerContext<{ body: CreateTriggerRTO; params: TriggerServiceParamsRTO }>,
  ): Promise<TriggersModelAttrs>
  update(
    ctx: HandlerContext<{ body: UpdateTriggerRTO; params: TriggerServiceModelParamsRTO }>,
  ): Promise<TriggersModelAttrs>
  remove(
    ctx: HandlerContext<{ params: TriggerServiceModelParamsRTO }>,
  ): Promise<{ deleted: string }>
}

/**
 * Builds `zanix-admin`'s triggers API — HTTP surface for `TriggersAggregator`. Unlike
 * `TemplatesController`, this never owns any data itself: every route resolves the `serviceId`
 * from the request path and proxies straight to that business service's own `/admin/triggers`, via
 * whichever `TriggersAggregator` instance {@link getTriggersAggregator} resolves (installed with
 * `setTriggersAggregator`, or a sensible unauthenticated default).
 *
 * A factory rather than a plain class because `@Controller`'s `isInternal`/`prefix` are
 * decorator-time (static) config — `ZanixAdmin.start()` calls this once at boot with whatever
 * `options.triggers` it was given (see its own docs); an app wiring this manually can call it
 * directly instead.
 *
 * @requires @zanix/database
 * @requires @zanix/auth
 */
export function createTriggersController(
  options: TriggersControllerOptions = {},
): new (context: HandlerContext) => TriggersControllerInstance {
  const { isInternal = true, prefix = 'triggers' } = options

  @Controller({ prefix, isInternal, versionProtocol: ADMIN_VERSION_PROTOCOL })
  class _TriggersController extends ZanixController {
    @Get()
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public list(): Promise<AggregatedTrigger[]> {
      return getTriggersAggregator().list()
    }

    @Get(':serviceId/:model', { Params: TriggerServiceModelParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public get(
      ctx: HandlerContext<{ params: TriggerServiceModelParamsRTO }>,
    ): Promise<TriggersModelAttrs> {
      const { serviceId, model } = ctx.payload.params
      return getTriggersAggregator().get(serviceId, model)
    }

    @Post(':serviceId', { Body: CreateTriggerRTO, Params: TriggerServiceParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public create(
      ctx: HandlerContext<{ body: CreateTriggerRTO; params: TriggerServiceParamsRTO }>,
    ): Promise<TriggersModelAttrs> {
      const { serviceId } = ctx.payload.params
      const { model, active, triggers } = ctx.payload.body
      return getTriggersAggregator().create(serviceId, model, active, triggers)
    }

    @Put(':serviceId/:model', { Body: UpdateTriggerRTO, Params: TriggerServiceModelParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public update(
      ctx: HandlerContext<{ body: UpdateTriggerRTO; params: TriggerServiceModelParamsRTO }>,
    ): Promise<TriggersModelAttrs> {
      const { serviceId, model } = ctx.payload.params
      const { active, triggers } = ctx.payload.body
      return getTriggersAggregator().update(serviceId, model, { active, triggers })
    }

    @Delete(':serviceId/:model', { Params: TriggerServiceModelParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public async remove(
      ctx: HandlerContext<{ params: TriggerServiceModelParamsRTO }>,
    ): Promise<{ deleted: string }> {
      const { serviceId, model } = ctx.payload.params
      await getTriggersAggregator().remove(serviceId, model)
      return { deleted: model }
    }
  }

  return _TriggersController
}
