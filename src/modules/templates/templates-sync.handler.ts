import type { HandlerContext } from '@zanix/server'
import type { SyncCodeTemplatesResult } from '@zanix/notifications/templates-types'

import { Controller, Post, ZanixController } from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import { ADMIN_AUTH_TYPES, ADMIN_ROLE, ADMIN_TEMPLATES_ROLE } from 'utils/constants.ts'
import { ADMIN_VERSION_PROTOCOL } from '../protocol/version-protocol.ts'
import { syncTemplatesFromRegisteredService } from './templates-sync.ts'
import { SyncTemplatesRTO } from './rtos/templates.rto.ts'

const REQUIRED_ROLE = [ADMIN_ROLE, ADMIN_TEMPLATES_ROLE]
// Accepts either a human admin's user-shaped token or a machine caller's api-shaped one (e.g. a
// business service's `RemoteTemplateBackend`) — see `@zanix/auth`'s `AuthTokenValidation({ type })`
// array support.
const AUTH_TYPES = ADMIN_AUTH_TYPES

/** Options accepted by {@link createTemplatesSyncController}. */
export interface TemplatesSyncControllerOptions {
  /**
   * The route prefix `sync` is mounted under, e.g. `'templates'` (default) for `/templates/sync`.
   * Must match whatever prefix `@zanix/notifications/templates-api`'s `createTemplatesController`
   * is mounted at alongside this controller — both compose into ONE apparent `/templates` resource
   * from an external caller's point of view, even though they're two separate controller classes.
   */
  prefix?: string
}

/** The instance shape {@link createTemplatesSyncController} builds. */
export interface TemplatesSyncControllerInstance extends ZanixController {
  /** `POST /sync` — pulls `serviceId`'s own code templates via its Discovery endpoint. */
  sync(
    ctx: HandlerContext<{ body: SyncTemplatesRTO }>,
  ): Promise<SyncCodeTemplatesResult>
}

/**
 * Builds `zanix-admin`'s own cross-service extension to the templates resource — genuinely
 * aggregator-shaped (needs `ServiceRegistry`/Discovery to reach another registered service), unlike
 * the CRUD half of `/templates`, which is authored and owned by `@zanix/notifications`
 * (`@zanix/notifications/templates-api`'s `createTemplatesController`) and mounted alongside this
 * controller under the same prefix. See the "Local API vs Aggregator API" rule in the
 * `zanix-local-api-vs-aggregator` skill for why a single resource can have both a local-api half and
 * an aggregator-composed half, each owned by a different package.
 *
 * `POST sync` pulls a registered service's code templates via its own
 * `/.well-known/zanix/code-templates` Discovery endpoint (see
 * `@zanix/notifications`'s `defineCodeTemplatesDiscovery`) rather than accepting them as a
 * request body — a `RemoteTemplateBackend` triggers this by posting its own `serviceId`, not its
 * template contents.
 *
 * A factory rather than a plain class because `@Controller`'s `prefix` is decorator-time (static)
 * config — called once at boot, in the same `defineApplication(...)` scope
 * `@zanix/notifications/templates-api`'s `createTemplatesController` is mounted in for the same
 * prefix, so both attribute to the same Application/route table.
 *
 * @requires @zanix/notifications
 * @requires @zanix/auth
 */
export function createTemplatesSyncController(
  options: TemplatesSyncControllerOptions = {},
): new (context: HandlerContext) => TemplatesSyncControllerInstance {
  const { prefix = 'templates' } = options

  @Controller({
    prefix,
    versionProtocol: ADMIN_VERSION_PROTOCOL,
  })
  class _TemplatesSyncController extends ZanixController {
    // Batch upsert-aware sync, pulled from `serviceId`'s own `/.well-known/zanix/code-templates`
    // Discovery snapshot rather than a pushed request body — see this package's own
    // `syncTemplatesFromRegisteredService` (cross-service orchestration, not part of any DI-bound
    // `Interactor` since it never operates within a real request context of its own). Accepts the
    // same `AUTH_TYPES` as the CRUD half of this resource, so a machine (`type: 'api'`) caller works
    // exactly like a human admin does against the rest of this resource.
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

  return _TemplatesSyncController
}
