import type { HandlerContext } from '@zanix/server'
import type { DLQEntryAttrs } from '@zanix/database'

import { Controller, Delete, Get, Post, ZanixController } from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import { ADMIN_AUTH_TYPES, ADMIN_DLQ_ROLE, ADMIN_ROLE } from 'utils/constants.ts'
import { ADMIN_VERSION_PROTOCOL } from '../protocol/version-protocol.ts'
import { getDlqAggregator } from './dlq.aggregator.ts'
import type { AggregatedDlqEntry } from './dlq.aggregator.ts'
import {
  DiscardDLQEntryRTO,
  DlqServiceEntryParamsRTO,
  DlqServiceParamsRTO,
  PushDLQEntryRTO,
  RequeueDLQEntryRTO,
} from './rtos/dlq.rto.ts'

const REQUIRED_ROLE = [ADMIN_ROLE, ADMIN_DLQ_ROLE]
// Accepts either a human admin's user-shaped token or a machine caller's api-shaped one on the
// same route — see `@zanix/auth`'s `AuthTokenValidation({ type })` array support.
const AUTH_TYPES = ADMIN_AUTH_TYPES

/** Options accepted by {@link createDlqController}. */
export interface DlqControllerOptions {
  /** The route prefix, e.g. `'dlq'` (default) for `/dlq`. */
  prefix?: string
}

/** The instance shape {@link createDlqController} builds — see its own docs. */
export interface DlqControllerInstance extends ZanixController {
  /** `GET /` — lists DLQ entries aggregated across every registered service. */
  list(): Promise<AggregatedDlqEntry[]>
  /** `GET /:serviceId/:id` — proxies to that specific registered service's own DLQ entry. */
  get(
    ctx: HandlerContext<{ params: DlqServiceEntryParamsRTO }>,
  ): Promise<DLQEntryAttrs>
  /** `POST /:serviceId` — pushes a new DLQ entry onto that specific registered service. */
  push(
    ctx: HandlerContext<
      { body: PushDLQEntryRTO; params: DlqServiceParamsRTO }
    >,
  ): Promise<DLQEntryAttrs>
  /** `POST /:serviceId/:id/requeue` — requeues a DLQ entry on that specific registered service. */
  requeue(
    ctx: HandlerContext<
      { body: RequeueDLQEntryRTO; params: DlqServiceEntryParamsRTO }
    >,
  ): Promise<DLQEntryAttrs>
  /** `POST /:serviceId/:id/discard` — discards a DLQ entry on that specific registered service. */
  discard(
    ctx: HandlerContext<
      { body: DiscardDLQEntryRTO; params: DlqServiceEntryParamsRTO }
    >,
  ): Promise<DLQEntryAttrs>
  /** `DELETE /:serviceId/:id` — removes a DLQ entry from that specific registered service. */
  remove(
    ctx: HandlerContext<{ params: DlqServiceEntryParamsRTO }>,
  ): Promise<{ deleted: string }>
}

/**
 * Builds `zanix-admin`'s DLQ (Dead Letter Queue) API — HTTP surface for `DlqAggregator`. Unlike
 * `TemplatesController`, this never owns any data itself: every route resolves the `serviceId` from
 * the request path and proxies straight to that business service's own `/admin/dlq`, via whichever
 * `DlqAggregator` instance {@link getDlqAggregator} resolves (installed with `setDlqAggregator`, or
 * a sensible unauthenticated default). Same shape as `createTriggersController`, one domain over.
 *
 * A factory rather than a plain class because `@Controller`'s `prefix` is decorator-time (static)
 * config — `defineAdminHubApp` calls this once at boot with whatever `options.dlq` it was given
 * (see its own docs); an app wiring this manually can call it directly instead. Which Application
 * (see `@zanix/server`'s `docs/applications.md`) this route belongs to is decided by whichever
 * `defineApplication(...)` scope is active when this call runs, not by an option here.
 *
 * @requires @zanix/database
 * @requires @zanix/auth
 */
export function createDlqController(
  options: DlqControllerOptions = {},
): new (context: HandlerContext) => DlqControllerInstance {
  const { prefix = 'dlq' } = options

  @Controller({ prefix, versionProtocol: ADMIN_VERSION_PROTOCOL })
  class _DlqController extends ZanixController {
    @Get()
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public list(): Promise<AggregatedDlqEntry[]> {
      return getDlqAggregator().list()
    }

    @Get(':serviceId/:id', { Params: DlqServiceEntryParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public get(
      ctx: HandlerContext<{ params: DlqServiceEntryParamsRTO }>,
    ): Promise<DLQEntryAttrs> {
      const { serviceId, id } = ctx.payload.params
      return getDlqAggregator().get(serviceId, id)
    }

    @Post(':serviceId', {
      Body: PushDLQEntryRTO,
      Params: DlqServiceParamsRTO,
    })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public push(
      ctx: HandlerContext<
        { body: PushDLQEntryRTO; params: DlqServiceParamsRTO }
      >,
    ): Promise<DLQEntryAttrs> {
      const { serviceId } = ctx.payload.params
      const { processType, origin, processId, payload, error, maxAttempts, metadata } =
        ctx.payload.body
      return getDlqAggregator().push(serviceId, {
        processType,
        origin,
        processId,
        payload,
        error,
        maxAttempts,
        metadata,
      })
    }

    @Post(':serviceId/:id/requeue', {
      Body: RequeueDLQEntryRTO,
      Params: DlqServiceEntryParamsRTO,
    })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public requeue(
      ctx: HandlerContext<
        { body: RequeueDLQEntryRTO; params: DlqServiceEntryParamsRTO }
      >,
    ): Promise<DLQEntryAttrs> {
      const { serviceId, id } = ctx.payload.params
      return getDlqAggregator().requeue(serviceId, id, {
        resetAttempts: ctx.payload.body.resetAttempts,
      })
    }

    @Post(':serviceId/:id/discard', {
      Body: DiscardDLQEntryRTO,
      Params: DlqServiceEntryParamsRTO,
    })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public discard(
      ctx: HandlerContext<
        { body: DiscardDLQEntryRTO; params: DlqServiceEntryParamsRTO }
      >,
    ): Promise<DLQEntryAttrs> {
      const { serviceId, id } = ctx.payload.params
      return getDlqAggregator().discard(serviceId, id, {
        reason: ctx.payload.body.reason,
      })
    }

    @Delete(':serviceId/:id', { Params: DlqServiceEntryParamsRTO })
    @AuthTokenValidation({ permissions: REQUIRED_ROLE, type: AUTH_TYPES })
    public async remove(
      ctx: HandlerContext<{ params: DlqServiceEntryParamsRTO }>,
    ): Promise<{ deleted: string }> {
      const { serviceId, id } = ctx.payload.params
      await getDlqAggregator().remove(serviceId, id)
      return { deleted: id }
    }
  }

  return _DlqController
}
