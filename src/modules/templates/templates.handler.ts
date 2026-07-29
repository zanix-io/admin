import type { HandlerContext } from '@zanix/server'
import type { ZanixTemplateAttrs } from '@zanix/notifications'
import type { SyncCodeTemplatesResult } from './templates.repository.ts'

import { Controller, Delete, Get, Post, Put, ZanixController } from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import { ADMIN_ROLE, ADMIN_TEMPLATES_ROLE } from 'utils/constants.ts'
import { ADMIN_VERSION_PROTOCOL } from '../protocol/version-protocol.ts'
import { TemplatesAdminService } from './templates.service.ts'
import {
  CreateTemplateRTO,
  SyncTemplatesRTO,
  TemplateParamsRTO,
  UpdateTemplateRTO,
} from './rtos/templates.rto.ts'

const REQUIRED_ROLE = [ADMIN_ROLE, ADMIN_TEMPLATES_ROLE]
// Accepts either a human admin's user-shaped token or a machine caller's api-shaped one (e.g. a
// business service's `RemoteTemplateBackend`) — see `@zanix/auth`'s `AuthTokenValidation({ type })`
// array support.
const AUTH_TYPES = ['user', 'api'] as const

/** Options accepted by {@link createTemplatesController}. */
export interface TemplatesControllerOptions {
  /**
   * Whether this route is only mounted on a server bootstrapped with a matching
   * `isInternal: true` (see `bootstrapServers`'s `BootstrapServerOptions[type].isInternal`).
   * Defaults to `true` — `zanix-admin`'s own admin/ops surface is not meant to be reachable by an
   * arbitrary public caller. Set to `false` if your deployment platform genuinely can't isolate an
   * internal server; `AuthTokenValidation` + the role gate remain the load-bearing protection
   * either way.
   */
  isInternal?: boolean
  /** The route prefix, e.g. `'templates'` (default) for `/templates`. */
  prefix?: string
}

/** The instance shape {@link createTemplatesController} builds — see its own docs. */
export interface TemplatesControllerInstance extends ZanixController<TemplatesAdminService> {
  list(): Promise<ZanixTemplateAttrs[]>
  get(
    ctx: HandlerContext<{ params: TemplateParamsRTO }>,
  ): Promise<ZanixTemplateAttrs & Record<string, unknown>>
  create(
    ctx: HandlerContext<{ body: CreateTemplateRTO }>,
  ): Promise<ZanixTemplateAttrs & Record<string, unknown>>
  update(
    ctx: HandlerContext<{ body: UpdateTemplateRTO; params: TemplateParamsRTO }>,
  ): Promise<ZanixTemplateAttrs & Record<string, unknown>>
  remove(ctx: HandlerContext<{ params: TemplateParamsRTO }>): Promise<{ deactivated: string }>
  sync(ctx: HandlerContext<{ body: SyncTemplatesRTO }>): Promise<SyncCodeTemplatesResult>
}

/**
 * Builds `zanix-admin`'s own templates API — unlike triggers (`TriggersAggregator`, a proxy),
 * `zanix-admin` is the actual **owner** of the templates collection here, via this package's own
 * `TemplatesAdminService` (data layer), RTOs (validation contract), and `adminProtocolInterceptor`
 * — the same wire shape `@zanix/core`'s own built-in `/admin/templates` exposes for any business
 * service (it re-exports these same symbols from this package — see its README's "Admin APIs"
 * section), so anything built against that contract (e.g. `@zanix/notifications`'s
 * `RemoteTemplateBackend`) works against this unmodified.
 *
 * A factory rather than a plain class because `@Controller`'s `isInternal`/`prefix` are
 * decorator-time (static) config — `ZanixAdmin.start()` calls this once at boot with whatever
 * `options.templates` it was given (see its own docs); an app wiring this manually can call it
 * directly instead.
 *
 * @requires @zanix/notifications
 * @requires @zanix/auth
 */
export function createTemplatesController(
  options: TemplatesControllerOptions = {},
): new (context: HandlerContext) => TemplatesControllerInstance {
  const { isInternal = true, prefix = 'templates' } = options

  @Controller({
    prefix,
    isInternal,
    Interactor: TemplatesAdminService,
    versionProtocol: ADMIN_VERSION_PROTOCOL,
  })
  class _TemplatesController extends ZanixController<TemplatesAdminService> {
    @Get()
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public list(): Promise<ZanixTemplateAttrs[]> {
      return this.interactor.list()
    }

    // `& Record<string, unknown>` below: `ZanixTemplateAttrs` is a plain `interface` with no index
    // signature of its own, which `deno check` won't accept as-is for a method's return type here —
    // `ZanixController`'s handler-prototype constraint requires assignability to `HandlerResponse`
    // (itself `Record<string, unknown> | ...`), and an `interface` (unlike an object type literal)
    // isn't structurally compatible with an indexed type without one. The intersection satisfies
    // that check without losing `ZanixTemplateAttrs`'s own field types for callers.
    @Get(':channel/:name', { Params: TemplateParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public async get(
      ctx: HandlerContext<{ params: TemplateParamsRTO }>,
    ): Promise<ZanixTemplateAttrs & Record<string, unknown>> {
      const { channel, name } = ctx.payload.params
      return { ...(await this.interactor.get(channel, name)) }
    }

    @Post('', { Body: CreateTemplateRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public async create(
      ctx: HandlerContext<{ body: CreateTemplateRTO }>,
    ): Promise<ZanixTemplateAttrs & Record<string, unknown>> {
      return { ...(await this.interactor.create(ctx.payload.body, ctx.session?.id ?? 'unknown')) }
    }

    @Put(':channel/:name', { Body: UpdateTemplateRTO, Params: TemplateParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public async update(
      ctx: HandlerContext<{ body: UpdateTemplateRTO; params: TemplateParamsRTO }>,
    ): Promise<ZanixTemplateAttrs & Record<string, unknown>> {
      const { channel, name } = ctx.payload.params
      return {
        ...(await this.interactor.update(
          channel,
          name,
          ctx.payload.body,
          ctx.session?.id ?? 'unknown',
        )),
      }
    }

    @Delete(':channel/:name', { Params: TemplateParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public async remove(
      ctx: HandlerContext<{ params: TemplateParamsRTO }>,
    ): Promise<{ deactivated: string }> {
      const { channel, name } = ctx.payload.params
      await this.interactor.remove(channel, name, ctx.session?.id ?? 'unknown')
      return { deactivated: name }
    }

    // Batch upsert-aware sync for a caller with no local database access of its own (e.g.
    // `@zanix/notifications`'s `RemoteTemplateBackend`) — see `TemplatesAdminRepository.syncCodeTemplates`.
    // Accepts the same `AUTH_TYPES` as every other route here, so a machine (`type: 'api'`) caller
    // works exactly like a human admin does against the rest of this controller.
    @Post('sync', { Body: SyncTemplatesRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public sync(
      ctx: HandlerContext<{ body: SyncTemplatesRTO }>,
    ): Promise<SyncCodeTemplatesResult> {
      return this.interactor.syncCodeTemplates(
        ctx.payload.body.entries,
        ctx.session?.id ?? 'unknown',
      )
    }
  }

  return _TemplatesController
}
