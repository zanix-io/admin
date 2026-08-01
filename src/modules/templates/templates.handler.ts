import type { HandlerContext } from '@zanix/server'
import type { SyncCodeTemplatesResult, ZanixTemplateAttrs } from '@zanix/notifications'

import { Controller, Delete, Get, Post, Put, ZanixController } from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import { TemplatesAdminService } from '@zanix/notifications'
import { ADMIN_AUTH_TYPES, ADMIN_ROLE, ADMIN_TEMPLATES_ROLE } from 'utils/constants.ts'
import { ADMIN_VERSION_PROTOCOL } from '../protocol/version-protocol.ts'
import { syncTemplatesFromRegisteredService } from './templates-sync.ts'
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
const AUTH_TYPES = ADMIN_AUTH_TYPES

/** Options accepted by {@link createTemplatesController}. */
export interface TemplatesControllerOptions {
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
 * section). `POST sync` pulls a registered service's code templates via its own
 * `/.well-known/zanix/code-templates` Discovery endpoint (see
 * `@zanix/notifications`'s `defineCodeTemplatesDiscovery`) rather than accepting them as a
 * request body — a `RemoteTemplateBackend` triggers this by posting its own `serviceId`, not its
 * template contents.
 *
 * A factory rather than a plain class because `@Controller`'s `prefix` is decorator-time (static)
 * config — called once at boot by either `ZanixAdmin.start()` (with whatever `options.templates`
 * it was given) or this package's own `defineAdminMetadata()` (called in turn by `@zanix/core`'s
 * `start()`, fixed at `prefix: 'admin/templates'`); an app wiring this manually can call it directly
 * instead. Which Application (see `@zanix/server`'s `docs/HANDLERS.md`'s "Applications" section)
 * this route belongs to is decided by whichever `defineApplication(...)` scope is active when this
 * call runs, not by an option here — see the caller's own docs (`ZanixAdmin.start()`'s
 * `templates.application`, or this package's own `ADMIN_TEMPLATES_APPLICATION` env var) for how that's
 * controlled.
 *
 * @requires @zanix/notifications
 * @requires @zanix/auth
 */
export function createTemplatesController(
  options: TemplatesControllerOptions = {},
): new (context: HandlerContext) => TemplatesControllerInstance {
  const { prefix = 'templates' } = options

  @Controller({
    prefix,
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

    // Batch upsert-aware sync, pulled from `serviceId`'s own `/.well-known/zanix/code-templates`
    // Discovery snapshot rather than a pushed request body — see this package's own
    // `syncTemplatesFromRegisteredService` (cross-service orchestration, not part of the DI-bound
    // `Interactor` since it never operates within a real request context of its own). Accepts the
    // same `AUTH_TYPES` as every other route here, so a machine (`type: 'api'`) caller works
    // exactly like a human admin does against the rest of this controller.
    @Post('sync', { Body: SyncTemplatesRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public sync(
      ctx: HandlerContext<{ body: SyncTemplatesRTO }>,
    ): Promise<SyncCodeTemplatesResult> {
      return syncTemplatesFromRegisteredService(
        ctx.payload.body.serviceId,
        ctx.session?.id ?? 'unknown',
      )
    }
  }

  return _TemplatesController
}
