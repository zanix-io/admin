/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * @module
 *
 * `zanix-admin` — a centralized service for orchestrating triggers/templates across Zanix
 * business services — see this package's own README for the full design.
 *
 * This is a **library**, not a single deployable app — any team stands up its own admin service by
 * importing this package, either via {@link ZanixAdmin}'s reference `start()`/`stop()` (the
 * quickest path) or by wiring `createTriggersController()`/`createTemplatesController()` into its
 * own `@zanix/server`/`@zanix/core`-based bootstrap directly. See the README for both.
 */

import { start, stop } from 'modules/start.ts'

export { SERVICE_REGISTRY_ENV, ServiceRegistry } from 'modules/registry/registry.ts'
export type { ServiceRegistryEntry } from 'typings/registry.ts'

export {
  ADMIN_PROTOCOL_SUPPORTED_VERSIONS,
  ADMIN_PROTOCOL_VERSION,
  ADMIN_ROLE,
  ADMIN_TEMPLATES_ROLE,
  ADMIN_TRIGGERS_ROLE,
} from 'utils/constants.ts'
// Re-exported from `@zanix/server` (not defined here) so a business service's own admin
// controller can use the same header name without depending on this package.
export { ADMIN_PROTOCOL_HEADER } from '@zanix/server'

/**
 * Base CRUD layer behind `zanix-admin`'s own `/templates` API (and, via `@zanix/core`'s own
 * re-export, its built-in `/admin/templates`) — exported so a consuming app can extend or reuse it
 * to build its own custom templates API instead of duplicating the CRUD logic against
 * `@zanix/notifications`'s templates collection. See `@zanix/notifications`'s `docs/templates.md`
 * for the storage model this operates under.
 */
export { TemplatesAdminRepository } from 'modules/templates/templates.repository.ts'
export { TemplatesAdminService } from 'modules/templates/templates.service.ts'
/**
 * Request DTOs backing `zanix-admin`'s own `/templates` API (and, via `@zanix/core`'s own
 * re-export, its built-in `/admin/templates`) — exported alongside `TemplatesAdminRepository`/
 * `Service` so any consumer building a wire-compatible templates controller reuses this validation
 * contract instead of redefining it.
 */
export {
  CreateTemplateRTO,
  TemplateParamsRTO,
  UpdateTemplateRTO,
} from 'modules/templates/rtos/templates.rto.ts'
/**
 * `create`/`update` request DTOs backing both this package's own `/triggers` proxy and, via
 * `@zanix/core`'s own re-export, its built-in `/admin/triggers` — the same wire shape either way,
 * since a proxying request forwards this body to the target service's own admin API unchanged.
 */
export { CreateTriggerRTO, UpdateTriggerRTO } from 'modules/triggers/rtos/triggers.rto.ts'

/**
 * Data access and business logic for a business service's own persisted local triggers collection
 * (`@zanix/datamaster`'s `zanix-triggers`) — backs `createTriggersAdminController`'s
 * `/admin/triggers`, distinct from this package's own `/triggers` proxy/aggregator. Exported so a
 * consuming app can extend or reuse them to build its own custom triggers API instead of
 * duplicating the CRUD logic.
 */
export { TriggersAdminRepository } from 'modules/triggers/triggers.repository.ts'
export { TriggersAdminService } from 'modules/triggers/triggers.service.ts'
/** Route params RTO for `createTriggersAdminController`'s local `/admin/triggers/:model`. */
export { TriggerModelParamsRTO } from 'modules/triggers/rtos/local-triggers.rto.ts'
/**
 * Builds the admin CRUD controller for a business service's own local `/admin/triggers` — see its
 * own JSDoc for how this differs from `createTriggersController` above. Defaults to
 * `isInternal: true`, prefix fixed at `admin/triggers` (the wire-protocol contract
 * `TriggersAdminClient` hardcodes).
 */
export {
  createTriggersAdminController,
  type TriggersAdminControllerOptions,
} from 'modules/triggers/local-triggers.handler.ts'

/** Body RTO for `/admin/service-token` — see `createServiceExchangeController`. */
export { ServiceExchangeRTO } from 'modules/service-exchange/service-exchange.rto.ts'
/**
 * Builds the machine-to-machine credential-exchange controller (`/admin/service-token`) — a thin
 * wrapper around `@zanix/auth`'s `exchangeServiceCredential`, reused as-is. Always
 * `isInternal: true`, no role gate (the caller has no session yet — the whole point of calling
 * this endpoint is to obtain one); trust comes entirely from `exchangeServiceCredential`'s own
 * `JWK_PUB_<serviceId>` verification. See `@zanix/auth`'s `docs/service-credential.md`.
 */
export {
  createServiceExchangeController,
  type ServiceExchangeControllerInstance,
} from 'modules/service-exchange/service-exchange.handler.ts'

/**
 * Thin HTTP clients for calling a business service's own `/admin/triggers`/`/admin/templates` API
 * remotely — the client-side counterpart of this package owning the admin-protocol contract (see
 * this README's "Admin APIs" section). `TriggersAggregator` uses `TriggersAdminClient` internally;
 * both are exported so any other caller reuses this single implementation of the request/response
 * contract instead of a hand-rolled client that can drift from what the controllers actually
 * accept.
 */
export { TriggersAdminClient } from 'modules/triggers/triggers.client.ts'
export { TemplatesAdminClient } from 'modules/templates/templates.client.ts'

export {
  type AggregatedTrigger,
  getTriggersAggregator,
  setTriggersAggregator,
  TriggersAggregator,
  type TriggersClientFactory,
} from 'modules/triggers/triggers.aggregator.ts'

/**
 * Builds `zanix-admin`'s triggers API — a proxy/aggregator over every registered service's own
 * `/admin/triggers`, never an owner of any trigger data itself. Reads/writes go through whichever
 * `TriggersAggregator` `setTriggersAggregator` installed (a sensible unauthenticated default is
 * used otherwise — see `getTriggersAggregator`). Defaults to `isInternal: true` — see
 * `TriggersControllerOptions` to change that or the route prefix.
 */
export {
  createTriggersController,
  type TriggersControllerInstance,
  type TriggersControllerOptions,
} from 'modules/triggers/triggers.handler.ts'

/**
 * Builds `zanix-admin`'s own templates API — the actual owner of the templates collection, unlike
 * triggers (a proxy). Requires a database connector to be configured (`MONGO_URI`,
 * `TEMPLATES_MODEL_NAME`/`DATABASE_TEMPLATES`, etc.), same as any `@zanix/core`-based service with
 * DB-backed templates — {@link ZanixAdmin.start} wires this automatically. Defaults to
 * `isInternal: true` — see `TemplatesControllerOptions` to change that or the route prefix.
 */
export {
  createTemplatesController,
  type TemplatesControllerInstance,
  type TemplatesControllerOptions,
} from 'modules/templates/templates.handler.ts'

/**
 * Reference deployable entrypoint — the quickest way to stand up a real `zanix-admin` instance:
 * registers `TriggersController`/`TemplatesController` and their supporting connectors/providers
 * (`@zanix/datamaster`'s Mongo/Redis/cache, `@zanix/auth`'s session infra, `@zanix/notifications`'s
 * `TemplateProvider`), then starts a REST server via `@zanix/server`'s `bootstrapServers`.
 *
 * Not required — an app that wires the controllers into its own bootstrap directly (see the
 * README's "Basic Usage") never needs this class at all.
 *
 * @example
 * ```ts
 * import ZanixAdmin, { setTriggersAggregator, TriggersAggregator } from 'jsr:@zanix/admin@[version]'
 *
 * setTriggersAggregator(new TriggersAggregator(registry, clientFactory)) // install real per-service auth first
 *
 * await ZanixAdmin.start()
 * ```
 */
export default class ZanixAdmin {
  /**
   * Registers this package's routes/connectors and starts a REST server for them.
   *
   * @param options - Forwarded as-is to `@zanix/server`'s `bootstrapServers` (port, cors, gzip,
   * `onCreate`, etc.).
   * @returns The `ServerID`s of whatever servers were actually started.
   */
  public static start = start

  /** Stops every server {@link ZanixAdmin.start} started. */
  public static stop = stop
}
