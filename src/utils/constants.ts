/**
 * Grants access to every admin API this package owns (`/admin/triggers`, `/admin/templates`,
 * `/admin/dlq`, and any `@zanix/core`-based service exposing the same admin protocol). Combine
 * with {@link ADMIN_TRIGGERS_ROLE}/{@link ADMIN_TEMPLATES_ROLE}/{@link ADMIN_DLQ_ROLE} when a
 * caller should only reach one of the three APIs.
 *
 * ```ts
 * await authProvider.session.generateTokens(adminUser, { permissions: [ADMIN_ROLE] })
 * ```
 */
export const ADMIN_ROLE = 'zanix:admin'

/** Grants access to the triggers admin API (`/admin/triggers`) only. */
export const ADMIN_TRIGGERS_ROLE = 'zanix:admin:triggers'

/** Grants access to the templates admin API (`/admin/templates`) only. */
export const ADMIN_TEMPLATES_ROLE = 'zanix:admin:templates'

/** Grants access to the DLQ (Dead Letter Queue) admin API (`/admin/dlq`) only. */
export const ADMIN_DLQ_ROLE = 'zanix:admin:dlq'

export { ADMIN_PROTOCOL_SUPPORTED_VERSIONS, ADMIN_PROTOCOL_VERSION } from './protocol/constants.ts'

/**
 * Default Application `defineAdminMetadata`'s (`modules/metadata.ts`) built-in controllers
 * (`/admin/triggers`, `/admin/templates`, `/admin/service-token`) compose under — a business
 * service's own LOCAL admin API, embedded via `@zanix/core`'s `admin` option. See
 * `@zanix/core`'s `docs/admin-apis.md`'s "Scope" section for what sharing this Application with an
 * app's own routes implies. Distinct from {@link ADMIN_HUB_APPLICATION}, which
 * `ZanixAdminHub.start()`'s own aggregator routes compose under — the two are independent route
 * sets that may safely coexist in one process.
 */
export const ADMIN_APPLICATION = 'admin'

/**
 * Default Application `ZanixAdminHub.start()`'s own `defineAdminMetadata` (`modules/start.ts`)
 * composes its triggers/templates aggregator controllers under — distinct from
 * {@link ADMIN_APPLICATION}, which is reserved for the embedded, business-service-side admin API.
 * These are two conceptually different route sets (a business service's own local CRUD vs. this
 * package's central aggregator/proxy) that happen to share a package — giving them distinct
 * Application names keeps their route registries logically distinguishable, and (together with
 * `@zanix/server`'s boot-session isolation) lets both coexist safely in the same process, even
 * without a sequential `await` between `Zanix.start({ admin: true })` and `ZanixAdminHub.start()`.
 */
export const ADMIN_HUB_APPLICATION = 'admin-hub'

/**
 * Own Zanix App identity for the hub's Triggers `operations`/`mcp` surface
 * ({@link ADMIN_HUB_APPLICATION}'s own physically-separate sub-module — see
 * `triggers/hub-triggers-app.ts`) — distinct from {@link ADMIN_HUB_APPLICATION} so this sub-app can, in
 * principle, be activated/addressed (`ctx.remote(...)`) and eventually deployed independently of
 * the hub's own REST controllers, which stay registered under {@link ADMIN_HUB_APPLICATION} itself.
 * Never a REST route prefix on its own — `routes: false`; only the auto-registered
 * `/__zanix-ops/admin-hub-triggers/...` dispatch controller (see `registerRemoteDispatchRoutes`)
 * uses this name, baked directly into its own path independent of anchoring/`globalPrefix`.
 */
export const ADMIN_HUB_TRIGGERS_APPLICATION = 'admin-hub-triggers'

/** Same reasoning as {@link ADMIN_HUB_TRIGGERS_APPLICATION}, for the hub's Templates `operations`
 * sub-module (`templates/hub-templates-app.ts`). */
export const ADMIN_HUB_TEMPLATES_APPLICATION = 'admin-hub-templates'

/** Same reasoning as {@link ADMIN_HUB_TRIGGERS_APPLICATION}, for the hub's DLQ (Dead Letter Queue)
 * `operations` sub-module (`dlq/hub-dlq-app.ts`) — backed by `DlqAggregator`, the same
 * `ServiceRegistry`-driven remote fan-out shape {@link ADMIN_HUB_TRIGGERS_APPLICATION} already
 * establishes for Triggers. */
export const ADMIN_HUB_DLQ_APPLICATION = 'admin-hub-dlq'

/** Own Zanix App identity for the embedded, business-service-side Triggers `operations`/`mcp`
 * surface ({@link ADMIN_APPLICATION}'s own physically-separate sub-module — see
 * `triggers/local-triggers-app.ts`) — same reasoning as {@link ADMIN_HUB_TRIGGERS_APPLICATION},
 * mirrored on the local side. */
export const ADMIN_TRIGGERS_APPLICATION = 'admin-triggers'

/** Same reasoning as {@link ADMIN_TRIGGERS_APPLICATION}, for the local Templates `operations`
 * sub-module (`templates/local-templates-app.ts`). */
export const ADMIN_TEMPLATES_APPLICATION = 'admin-templates'

/**
 * Own Zanix App identity for the embedded, business-service-side DLQ (Dead Letter Queue)
 * `operations`/`mcp` surface ({@link ADMIN_APPLICATION}'s own physically-separate sub-module — see
 * `dlq/local-dlq-app.ts`) — same reasoning as {@link ADMIN_TRIGGERS_APPLICATION}. The hub-side
 * counterpart is {@link ADMIN_HUB_DLQ_APPLICATION}, backed by `DlqAggregator`/`DlqAdminClient` —
 * DLQ is now mirrored on both sides, the same shape Triggers/Templates already establish.
 */
export const ADMIN_DLQ_APPLICATION = 'admin-dlq'

/**
 * Env var overriding which Application `/admin/triggers` is composed under — defaults to
 * {@link ADMIN_APPLICATION} (see `@zanix/core`'s `docs/admin-apis.md`'s "Scope" section); set to `'main'` (or any
 * other Application name) to rebind this one capability onto a different Application's Runtime
 * instead, e.g. because your deployment platform genuinely can't isolate the admin server. See
 * `createTriggersAdminController`.
 */
export const ADMIN_TRIGGERS_APPLICATION_ENV = 'ADMIN_TRIGGERS_APPLICATION'

/**
 * Env var overriding which Application `/admin/templates` is composed under — defaults to
 * {@link ADMIN_APPLICATION} — same caveat as {@link ADMIN_TRIGGERS_APPLICATION_ENV}. See
 * `createTemplatesController`.
 */
export const ADMIN_TEMPLATES_APPLICATION_ENV = 'ADMIN_TEMPLATES_APPLICATION'

/**
 * Env var overriding which Application `/admin/dlq` is composed under — defaults to
 * {@link ADMIN_APPLICATION} — same caveat as {@link ADMIN_TRIGGERS_APPLICATION_ENV}. See
 * `createDlqAdminController` (`@zanix/datamaster/dlq-api`).
 */
export const ADMIN_DLQ_APPLICATION_ENV = 'ADMIN_DLQ_APPLICATION'

// Accepts either a human admin's user-shaped token or a machine caller's api-shaped one — a
// registered service's own aggregator/sync orchestration  authenticates as `type: 'api'`,
// the same as the CRUD counterparts these Discovery endpoints sit alongside.
export const ADMIN_AUTH_TYPES = ['user', 'api'] as const
