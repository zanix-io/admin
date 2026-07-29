import type { HandlerContext } from '@zanix/server'

import { Controller, Delete, Get, Post, Put, ZanixController } from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import { ADMIN_ROLE, ADMIN_TRIGGERS_ROLE } from 'utils/constants.ts'
import { ADMIN_VERSION_PROTOCOL } from '../protocol/version-protocol.ts'
import { TriggersAdminService } from './triggers.service.ts'
import { CreateTriggerRTO, UpdateTriggerRTO } from './rtos/triggers.rto.ts'
import { TriggerModelParamsRTO } from './rtos/local-triggers.rto.ts'

const REQUIRED_ROLE = [ADMIN_ROLE, ADMIN_TRIGGERS_ROLE]
// Accepts either a human admin's user-shaped token or a machine caller's api-shaped one (e.g. a
// centralized `zanix-admin` service) on the same route — see `@zanix/auth`'s
// `AuthTokenValidation({ type })` array support.
const AUTH_TYPES = ['user', 'api'] as const

/** Options accepted by {@link createTriggersAdminController}. */
export interface TriggersAdminControllerOptions {
  /**
   * Whether this route is only mounted on a server bootstrapped with a matching
   * `isInternal: true` (see `bootstrapServers`'s `BootstrapServerOptions[type].isInternal`).
   * Defaults to `true` — this is an ops/admin surface, not part of the service's own public API.
   * Set to `false` only if your deployment platform genuinely can't isolate an internal server
   * and app-layer auth/authz (`AuthTokenValidation` + the role gate below) is the boundary you're
   * relying on instead.
   */
  isInternal?: boolean
}

/**
 * Builds the admin CRUD controller for a business service's own persisted triggers collection
 * (`@zanix/datamaster`'s `zanix-triggers`), requiring {@link ADMIN_ROLE} or
 * {@link ADMIN_TRIGGERS_ROLE} and accepting either a human admin's or a machine caller's token.
 * The route path itself (`admin/triggers`) is fixed, not configurable — it's the wire-protocol
 * contract `TriggersAdminClient` (and any other caller) hardcodes.
 *
 * A factory rather than a plain class because `@Controller`'s `isInternal` is decorator-time
 * (static) config — `@zanix/core`'s `defineAdminMetadata()` calls this once at boot with the value
 * resolved from `ADMIN_TRIGGERS_ISINTERNAL` (default `true`).
 *
 * Unlike this package's own `/triggers` (`createTriggersController`, a proxy/aggregator over N
 * services — see `triggers.handler.ts`), this controller's own CRUD logic
 * ({@link TriggersAdminService}) owns real persisted data directly — a business service's own
 * local triggers, not a fan-out to other services. Only the wire-protocol contract (roles, RTOs,
 * interceptor, guard) is shared between the two, not the business logic.
 *
 * @requires @zanix/datamaster
 * @requires @zanix/auth
 */
export function createTriggersAdminController(
  options: TriggersAdminControllerOptions = {},
): new (context: HandlerContext) => ZanixController<TriggersAdminService> {
  const { isInternal = true } = options

  @Controller({
    isInternal,
    prefix: 'admin/triggers',
    Interactor: TriggersAdminService,
    versionProtocol: ADMIN_VERSION_PROTOCOL,
  })
  class _TriggersAdminController extends ZanixController<TriggersAdminService> {
    @Get()
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public list() {
      return this.interactor.list()
    }

    @Get(':model', { Params: TriggerModelParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public get(ctx: HandlerContext<{ params: TriggerModelParamsRTO }>) {
      return this.interactor.get(ctx.payload.params.model)
    }

    @Post('', { Body: CreateTriggerRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public create(ctx: HandlerContext<{ body: CreateTriggerRTO }>) {
      const { model, active, triggers } = ctx.payload.body
      return this.interactor.create(model, active, triggers)
    }

    @Put(':model', { Body: UpdateTriggerRTO, Params: TriggerModelParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public update(
      ctx: HandlerContext<{ body: UpdateTriggerRTO; params: TriggerModelParamsRTO }>,
    ) {
      const { active, triggers } = ctx.payload.body
      return this.interactor.update(ctx.payload.params.model, { active, triggers })
    }

    @Delete(':model', { Params: TriggerModelParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public async remove(ctx: HandlerContext<{ params: TriggerModelParamsRTO }>) {
      await this.interactor.remove(ctx.payload.params.model)
      return { deleted: ctx.payload.params.model }
    }
  }

  return _TriggersAdminController
}
