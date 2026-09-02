# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [2.3.0] - 2026-09-01

### Added

- **`TemplatesHubClient.sync(serviceId)`** — `defineAdminHubApp` now composes `POST /templates/sync`
  (`createTemplatesSyncController`) alongside the CRUD controller under the hub's own `/templates`
  prefix, the same pair the LOCAL, business-service-side `/admin/templates` already exposes. Until
  now `ZanixAdminHub.start()` only ever wired the CRUD half for the hub, so a hub had no way to seed
  its central catalog from a registered service's own Discovery snapshot — only individual
  `POST
  /templates` CRUD calls worked. Closes #4.

### Fixed

- **`RegistryHubClient.list()`** now correctly `GET`s `/registry/list` again. v2.2.0's own "fix" for
  #1 (changing it to bare `/registry`) was itself wrong: `createRegistryController`'s `list()` is a
  bare `@Get()` with no path argument, and `@zanix/server` defaults an omitted path to the decorated
  method's own name (`'list'`), not the prefix root — this package's own `start.test.ts` already
  asserted `/registry/list` against a real running server, contradicting that "fix." Closes #5.
- **`DlqHubClient.list()`** (added in v2.2.0) had the identical bug, `GET`ting bare `/dlq` instead
  of the real `/dlq/list` — same root cause as `RegistryHubClient` above, never previously filed as
  its own issue.
- **`registerAdminHubModules`** (`admin-hub-app.ts`) now registers its entries (triggers/templates/
  dlq/registry/service-token) sequentially instead of via `Promise.all`, matching
  `registerAdminMetadataModules`'s own sequential registration in `metadata.ts`. Concurrent
  `ProgramModule.defineApplication(...)` scopes rely on `AsyncContext`, whose current implementation
  can misattribute a controller to the wrong Application under genuine concurrency — the likely
  cause of a hub sub-app intermittently missing from `/ready`'s `body.apps`, or one of its routes
  404ing instead of enforcing auth, shortly after `ZanixAdminHub.start()` already resolved.

## [2.2.0] - 2026-08-31

### Added

- **`DlqHubClient`** — the hub-facing thin HTTP client for `zanix-admin`'s own `/dlq` route
  (`createDlqController`), the missing counterpart to `TriggersHubClient`/`TemplatesHubClient`/
  `RegistryHubClient`. Same conventions as `TriggersHubClient` (`ADMIN_PROTOCOL_HEADER` stamping,
  `encodeURIComponent`-escaped `serviceId`/`id` path segments), but its own wire shape is NOT
  identical to `DlqAdminClient`'s (the service-facing client `dlq.client.ts` already exports):
  `list()` never accepts `DlqAdminClient.list()`'s own `DlqListQuery` filters — the hub's own
  `GET
  /dlq` always returns the full cross-service aggregation (`DlqAggregator.list()`'s
  Discovery-backed fan-out), each entry tagged with the `serviceId` it came from — and every other
  method takes a `serviceId` path segment `DlqAdminClient` never needs, since one hub instance
  proxies many services. `push`/`requeue`/`discard` still accept the same
  `DlqPushInput`/`DlqRequeueOptions`/ `DlqDiscardOptions` bodies as `DlqAdminClient`, since the hub
  forwards them unchanged to the resolved service's own `/admin/dlq`. Exported from both the root
  barrel and the `./client` subpath, alongside the other three hub clients.

### Fixed

- **`RegistryHubClient.list()`** now `GET`s `/registry` (the hub's own registry route root) instead
  of the nonexistent `/registry/list` — `createRegistryController` mounts `list()` as a bare
  `@Get()` at the prefix root, unlike the hub's other controllers. Closes #1.

## [2.1.0] - 2026-08-26

### Added

- **`ZanixAdminHub.start({ serviceToken: true })` / `defineAdminHubApp({ serviceToken: true })`** —
  opt-in composition of `POST /admin/service-token` (`createServiceExchangeController()`) directly
  under `ADMIN_HUB_APPLICATION`, the SAME Application `/triggers`/`/templates`/`/dlq`/`/registry`
  already register under. Closes a real gap found running `@zanix/console` end-to-end against a real
  `ZanixAdminHub` instance: `console`'s own `admin-hub-auth.ts` assumes ONE `ADMIN_HUB_BASE_URL`
  serves `/admin/service-token` alongside those other routes, but until now the only official way to
  compose that controller was `@zanix/core`'s
  `Zanix.start({ admin: true })`/`defineLocalAdminApp()`, under the DIFFERENT `ADMIN_APPLICATION` —
  a hub operator had to hand-compose `createServiceExchangeController()` themselves to make that
  single-base-URL assumption true. `false`/omitted (the default) keeps today's exact behavior
  unchanged — this hub composes no service-token endpoint at all unless explicitly opted into.
  Registered via the same `AdminHubModuleEntry`/`registerAdminHubModules` table `admin-hub-app.ts`
  already uses for `registry` (not a new "sub-app" — it declares no `operations`/`mcp` surface of
  its own, so it's never added to `HUB_SUB_APP_ENTRIES`). Deliberately NOT meant to be combined with
  anchoring (`ADMIN_SERVER_ID`/`ADMIN_HUB_SERVER_ID`) for the same purpose — see
  `StartOptions.serviceToken`'s own doc (`start.ts`) for why those solve different problems.

### Fixed

- **This package's own root `.` and `./hub` entry points unconditionally materialized `graphql`,
  `redis`, and `amqplib`**, none of which this package's own triggers/templates/DLQ composition
  needs. Three independent causes, all now fixed:
  - `TriggersAdminRepository`/`TriggersAdminService`/`createTriggersDiscoveryProvider` and
    `TemplatesAdminRepository`/`TemplatesAdminService`/`toSyncCodeTemplateEntries` were imported
    from the bare `@zanix/datamaster`/`@zanix/notifications` roots — both roots also bundle
    unrelated connectors/providers reaching `graphql`/`redis`/`amqplib`. Now imported from
    `@zanix/datamaster/triggers-api`/`@zanix/notifications/templates-api` instead — see each
    package's own CHANGELOG for the narrow exports this needed added there first.
  - `isTriggersResourceEnabled`/`CreateTriggerInput`/`TriggersModelAttrs`/`UpdateTriggerInput` and
    `isDlqResourceEnabled`/`Dlq*`/`DlqAdminService` were both imported through one combined
    `@zanix/database` alias pointed at the bare `@zanix/datamaster` root. Split into
    `@zanix/datamaster/database` and `@zanix/datamaster/dlq` — the two narrow subpaths that actually
    define them.
  - `admin-hub-app.ts`'s own `defineAdminHubMetadata` called `import('@zanix/datamaster/core')` and
    `import('@zanix/auth/core')` with LITERAL inline strings — Deno's static module-graph walker
    follows a literal dynamic `import()` argument the same as a static one, so both were resolved
    (and their npm packages materialized) merely by importing this file, whether or not
    `ZanixAdminHub.start()` was ever called. Routed through `DATAMASTER_CORE_SPECIFIER`/
    `AUTH_CORE_SPECIFIER` (`modules/lazy/specifiers.ts`) instead, matching the non-literal pattern
    `NOTIFICATIONS_CORE_SPECIFIER` already used right next to them.

## [2.0.0] - 2026-08-23

### Fixed

- `deno lint`'s own `@zanix/utils` plugin (`deno-zanix-plugin`) is now version-pinned (`^3.0.0`),
  matching every other `@zanix/utils` import in `deno.jsonc` — it used to resolve unpinned, so a
  lint run could silently pick up a newer, unreviewed plugin version.
- **`getLocalAdminSubApps()`/`getAdminHubSubApps()` no longer compose a resource's
  `operations`/`mcp` sub-app when that resource's own REST controller is disabled.** Previously each
  resource's operations/mcp surface was composed unconditionally, so e.g. `admin-dlq`'s own
  operations stayed reachable (`ctx.remote('admin-dlq')`) in a deployment that never set
  `DLQ_MODEL_NAME` and therefore never got a live `/admin/dlq` REST route, and `admin-hub-dlq`'s own
  operations stayed composed even when a caller explicitly passed `dlq: false` to
  `defineAdminHubApp`/`ZanixAdminHub.start()` — a reachable, auth-gated surface with no REST
  counterpart, failing only at call time instead of simply not existing. Both functions now read the
  same `isTriggersResourceEnabled`/ `isTemplatesResourceEnabled`/`isDlqResourceEnabled` gates (new
  `admin-resource-gates.ts`, a thin shared re-export over
  `@zanix/datamaster`'s/`@zanix/notifications`'s own `isXResourceEnabled()`) that
  `defineAdminMetadata`'s REST/Discovery registration already uses, so a resource's REST surface and
  its operations/mcp surface can never drift apart on which env signal gates them again.

### Removed

- **Breaking**: `createTriggersAdminController` and `createTemplatesController` (plus their
  associated types/RTOs — `TemplatesControllerInstance`/`Options`, `CreateTemplateRTO`,
  `TemplateParamsRTO`, `UpdateTemplateRTO`, `TriggerModelParamsRTO`) are no longer exported from
  this package. Import `createTriggersAdminController` from `@zanix/datamaster/triggers-api`, and
  `createTemplatesController` from `@zanix/notifications/templates-api` — each is owned and authored
  by the package that owns the underlying data, never by an aggregator like this one.

### Added

- `createTemplatesSyncController` (`POST /templates/sync`) — this package's own cross-service
  extension to the templates resource, mounted alongside `@zanix/notifications/templates-api`'s
  `createTemplatesController` under the same route prefix. Needs `ServiceRegistry`/cross-service
  Discovery, so it stays in this package, unlike the CRUD routes.
- `defineAdminMetadata` now also composes `/admin/dlq` (`@zanix/datamaster/dlq-api`'s
  `createDlqAdminController`) plus a `/.well-known/zanix/dlq` Discovery endpoint
  (`createDlqDiscoveryProvider`), gated by `ADMIN_ROLE`/the new `ADMIN_DLQ_ROLE`. Opt-in via
  `DLQ_MODEL_NAME` being set — deliberately not on-by-default like triggers, since
  `registerDLQModel()` is a standalone bootstrap call, never auto-run the way the triggers model is;
  see `defineAdminMetadata`'s own doc for the full reasoning. New `ADMIN_DLQ_ROLE`/
  `ADMIN_DLQ_APPLICATION_ENV` constants, exported from `mod.ts` alongside their triggers/templates
  counterparts. Requires `@zanix/datamaster`'s `dlq-api` subpath and `createDlqDiscoveryProvider`
  (published as of `@zanix/datamaster@1.5.0`).
- `createRegistryController` (`GET /registry`) — a single, read-only route reflecting the installed
  `ServiceRegistry`. Always composed by `defineAdminHubApp`, unconditionally — no `registry: false`
  opt-out the way `triggers`/`templates`/`dlq` each have, since `ServiceRegistry` always exists
  regardless of which of those three are enabled. Guarded by `ADMIN_ROLE` only — deliberately no
  dedicated `ADMIN_REGISTRY_ROLE`, since this isn't an individually-gateable resource the way the
  other three are.
- **`defineAdminHubApp`/`ZanixAdminHub.start()` also compose `/dlq` (new `createDlqController`)** —
  a proxy/aggregator over every registered service's own `/admin/dlq`, mirroring
  `createTriggersController`'s shape one domain over (never owns DLQ data itself). Backed by new
  `DlqAggregator`/`setDlqAggregator`/`getDlqAggregator`, `DlqAdminClient`, and RTOs
  (`PushDLQEntryRTO`/`RequeueDLQEntryRTO`/`DiscardDLQEntryRTO`/`DlqServiceParamsRTO`/
  `DlqServiceEntryParamsRTO`), all exported from `mod.ts`. On by default — opt out via `dlq: false`,
  the same shape as `triggers` (unlike `templates`, `createDlqController` bakes its own
  `ADMIN_ROLE`/`ADMIN_DLQ_ROLE` guard in, so it needs no guard-injection). New `ADMIN_DLQ_ROLE`,
  `ADMIN_HUB_DLQ_APPLICATION`/`ADMIN_DLQ_APPLICATION` constants. Also gets its own
  `operations`/`mcp` sub-app on both sides (`dlq/hub-dlq-app.ts`, `dlq/local-dlq-app.ts`), composed
  via `getAdminHubSubApps()`/`getLocalAdminSubApps()` alongside Triggers/Templates — only the
  read-only `list`/`get` operations opt into `mcp`, same reasoning as Triggers/Templates.
- Three new hub-facing HTTP clients — `TriggersHubClient`, `TemplatesHubClient`, `RegistryHubClient`
  — for calling `zanix-admin`'s OWN hub-side `/triggers`/`/templates`/`/registry` routes remotely
  (e.g. from an external ops UI like `@zanix/console`), distinct from the existing service-facing
  clients (`TriggersAdminClient`/`TemplatesAdminClient`/`DlqAdminClient`), which each call a
  business SERVICE's own local `/admin/<x>` API instead. `TemplatesHubClient` is CRUD-only — the hub
  composes no `POST /templates/sync` route today.

### Changed

- `TriggersAggregator`'s `list`/`get`/`create`/`update`/`remove` now log
  (`ADMIN_TRIGGERS_DISCOVERY_FAILED`/`ADMIN_TRIGGERS_PROXY_FAILED`, via `@zanix/logger`) which
  registered service's own Discovery/CRUD call actually failed before re-throwing — previously a
  failure surfaced only as the bare rejected error, losing which service in the fan-out (`list()`)
  or which proxy target (`get`/`create`/`update`/`remove`) was the culprit. Same shape
  `DlqAggregator` (new, above) ships with from the start. No change to the thrown error itself,
  purely additive diagnostics.
- `defineAdminMetadata`/`defineAdminHubMetadata` now build an explicit `guards`/`versionProtocol`
  config and pass it into `createTriggersAdminController`/ `createTemplatesController` — neither
  factory assumes an auth mechanism on its own anymore.
- **BREAKING: `/admin/templates` registration follows `@zanix/notifications`'s own selector-based
  rename.** `defineAdminMetadata()` now gates on `templatesBackendMode() === 'local'` instead of
  `Deno.env.get(TEMPLATES_MODEL_NAME) && !isDatabaseTemplatesDisabled()` — a bare
  `TEMPLATES_MODEL_NAME` with no `TEMPLATES_BACKEND=local` no longer registers the templates admin
  API (it never took effect in `@zanix/notifications` itself anymore either, so this closes a real
  drift between what this package gated on and what actually ran). Requires a `@zanix/notifications`
  version carrying its own `TEMPLATES_BACKEND` rename.

## [1.1.0] - 2026-08-17

### Added

- **Triggers/Templates `operations`/`mcp` moved to their own physically-separate Zanix App
  sub-modules** — `triggers/hub-triggers-app.ts`, `templates/hub-templates-app.ts` (hub side),
  `triggers/local-triggers-app.ts`, `templates/local-templates-app.ts` (local side), each with its
  own file, own addressable app identity (`ADMIN_HUB_TRIGGERS_APPLICATION`,
  `ADMIN_HUB_TEMPLATES_APPLICATION`, `ADMIN_TRIGGERS_APPLICATION`, `ADMIN_TEMPLATES_APPLICATION` —
  `utils/constants.ts`), instead of being merged directly into `defineAdminHubApp`'s/
  `defineLocalAdminApp`'s own `operations` field. `defineAdminHubApp`/`defineLocalAdminApp`
  themselves now declare no `operations` at all — they're pure composers.
  - **Breaking rename, safe for the same reason the earlier `service_id`→`serviceId` rename was**:
    this operations/mcp surface was only ever exercised by this package's own test suite, never a
    real external caller. `ctx.remote('admin-hub-triggers')`/`ctx.remote('admin-hub-templates')`
    reach the hub's own operations now (not `ctx.remote('admin-hub')`);
    `ctx.remote('admin-triggers')`/ `ctx.remote('admin-templates')` reach the local side's (not
    `ctx.remote('admin')`).
  - New `getAdminHubSubApps()`/`getLocalAdminSubApps()` (exported from `mod.ts`) return the list of
    sub-apps to activate alongside `defineAdminHubApp`/`defineLocalAdminApp` — a data table (an
    array of factory functions), not hardcoded call sites, so a future third sub-app (GQLIDE/
    Swagger `operations`) is added by extending one array, never by editing `start.ts`'s own
    composition/bootstrap logic.
  - `start.ts` (`ZanixAdminHub.start()`) and `@zanix/core`'s own `start.ts`
    (`Zanix.start({admin:
    true})`) both now `activateApps([...])` the expanded list and
    `bootstrapAppServer()` each sub-app's own Application — not just same-process `ctx.remote()`
    reachability, but real HTTP reachability for each sub-app's own `/__zanix-ops/<name>/...`
    dispatch route too, the necessary precondition for a future independent deploy (e.g.
    `bootstrapRemoteApp(defineHubTriggersApp())`) — not yet wired for actual standalone deployment,
    only the addressing/reachability groundwork.
  - **Real bug found and fixed while wiring the extra `bootstrapAppServer` calls**: naively reusing
    the parent app's own `id`/`globalPrefix` for each sub-app (reasoning that the
    operations-dispatch controller's own route path already bakes the app name in, so nothing could
    collide) was wrong. `WebServerManager`'s per-port dispatch table is keyed by `dispatchKey` (the
    anchored `serverID` when anchored, the raw `globalPrefix` otherwise), which is **never derived
    from the Application name** — two Applications sharing the exact same `id`/`globalPrefix` don't
    merge their routes under that key, the LATER `create()` call's handler (bound to ONE
    Application) silently replaces the earlier one's. This made `ADMIN_HUB_APPLICATION`'s own
    `/triggers`/`/templates`/ `ADMIN_APPLICATION`'s own
    `/admin/triggers`/`/admin/templates`/`/admin/service-token` controllers unreachable (404)
    whenever a sub-app registered after them on the same dispatch key — caught via `@zanix/core`'s
    own integration test suite (real HTTP fetches against both admin and its sub-apps together), not
    the unit-level `getLocalOperation` tests, which never exercise the real HTTP dispatch path.
    Fixed by giving each sub-app its own independent `id`
    (`resolveApplicationServerId(subAppName, 'rest')`, almost always unset in practice) and its own
    name as the `globalPrefix` fallback when unanchored — a distinct dispatch key regardless of how
    the parent app itself is configured.

### Documentation

- **README now documents the Triggers/Templates sub-app split (above) as the official Extension
  pattern reference** for the whole Zanix ecosystem — a new "Extension pattern reference" section
  explains what qualifies as an Extension (adding capability without replacing anything, as a
  separate Zanix App composed alongside a base one) versus an Override, walks through exactly how
  `defineHubTriggersApp()`/`defineHubTemplatesApp()`/their local-side counterparts are structured
  (own identity, `routes: false`, shared state via an already-installed singleton rather than their
  own `dependencies`/`resources`), and gives a step-by-step template for a third-party package
  wanting to replicate the same shape. Documentation only — no behavior change.

- `ZanixAdminHub.start()` now traps `SIGINT`/`SIGTERM` automatically (no opt-out) and drains its
  servers via `ZanixAdminHub.stop()` before exiting — same pattern `@zanix/core`'s own
  `Zanix.start()` already established. Needed independently here since `ZanixAdminHub` is a real
  standalone deployable entrypoint in its own right, not always run through `Zanix.start()`.
  `ZanixAdminHub.stop()` now also closes connector connections (`closeAllConnections()`) as its last
  step, for the (shared-process) case where something else in the same process registered one.
  Unlike `Zanix.start()` (which owns the whole process it runs in), a `stop()` failure during this
  signal-triggered shutdown does NOT force-exit the process — this package is frequently just one
  participant sharing a process with an unrelated, independent entrypoint (e.g. a business service's
  own `Zanix.start()`), and this package's own cleanup trouble must never take that service down
  with it; the error is logged instead, leaving an orchestrator's own SIGKILL-after-grace-period as
  the backstop.
- **`AdminHubModuleEntry`/`registerAdminHubModules`** (internal, `admin-hub-app.ts`) — genericizes
  `defineAdminHubApp`'s controller registration into one data table instead of two hand-duplicated
  `if (x !== false) {...}` blocks (one per module). Adding a third hub-composable module (e.g. a
  future GQLIDE/Swagger surface) now means adding one entry here, never touching the registration
  loop itself. Purely an internal refactor — `defineAdminHubApp`'s own public options/behavior are
  unchanged, verified against the full functional test suite (triggers/templates enable/disable,
  application overrides, auth wiring).
- **Triggers/Templates now expose real `operations`** (`ctx.remote(...).call(...)`/MCP), reachable
  alongside both `defineAdminHubApp` and `defineLocalAdminApp` (via their own sub-apps — see the
  physically-separate sub-modules entry above) — a second, zero-network path to the exact same
  business logic each side's REST controllers already call, for another Zanix App co-located in the
  same process. On the hub side (`hubTriggersOperations`, `triggers/hub-triggers-app.ts`), Triggers
  operations proxy through the installed `TriggersAggregator`, same as the REST controller. On the
  local side (`localTriggersOperations`, `triggers/local-triggers-app.ts`), they call
  `TriggersAdminService` directly via `resolveTarget`. Templates operations
  (`buildTemplatesOperations`, the new `templates/templates-operations.ts`) are shared verbatim
  between both sides, since both deployments call the exact same `TemplatesAdminService` class. Only
  each side's `list`/`get` operations opt into `mcp` — mutating operations
  (`create`/`update`/`remove`) are deliberately excluded from MCP exposure, since giving an agent
  unrestricted write access to triggers/templates configuration is a real risk. Mutating Templates
  operations pass a fixed `'zanix-operation'` sentinel as the `updatedBy` audit-trail identity,
  since an operation's `RuntimeContext` never carries a user session (app-to-app, not user-scoped)
  the way an HTTP request's `ctx.session?.id` does.

### Changed

- **`defineAdminHubApp`'s `setup()` now always wires `TriggersAggregator`** (via
  `setTriggersAggregator`) against the DI-resolved `registry` (`ctx.resource('registry')`),
  regardless of whether `auth` is given. Previously this only ran inside `if (auth)`; the no-`auth`
  case relied entirely on `getTriggersAggregator()`'s own lazy default, which happened to work only
  because the `'service-registry'` resource factory also installs the same instance into
  `setServiceRegistry`'s global — a correct but implicit/order-dependent path. `authHeaders` (from
  `auth`) now only decides which client factory is used (authenticated, or `TriggersAggregator`'s
  own unauthenticated default) — never whether the aggregator gets wired at all. No behavior change
  for real deployments (the resolved instance was already identical either way), just removes an
  implicit dependency on lazy-default timing.
- **Investigated eliminating `ServiceRegistry`'s process-wide `getServiceRegistry`/
  `setServiceRegistry` singleton** in favor of `@zanix/app`'s DI resource system throughout, or
  `@zanix/server`'s `@Provider`/`ProgramModule.providers`. Concluded neither is a real improvement,
  and made no further code change beyond the aggregator-wiring fix above:
  - `@Provider`/`ProgramModule.providers` auto-instantiates via a bare `new Target(context)` with no
    way to register an already-built, `entries`-configured instance — not viable for a
    manifest-configurable registry.
  - `setServiceRegistry` being public isn't an accidental leak: this package documents (`mod.ts`)
    wiring `createTriggersController()`/`createTemplatesController()` directly into a caller's own
    `@zanix/core`/`@zanix/server` bootstrap with no Zanix App/DI graph at all — for that path,
    `setServiceRegistry` is the ONLY configuration entrypoint there is, not a workaround for a DI
    mechanism that path could use instead.
  - The global is therefore the correct, necessary shape for supporting both initialization paths
    (`ZanixAdminHub.start()`'s DI graph, and direct controller wiring) against one shared instance —
    `resource-type.ts` already reuses the installed instance rather than ever creating a second one.
    `registry.ts`/`resource-type.ts`'s doc comments were rewritten to state this explicitly, so
    neither reads as a temporary or accidental mechanism.

### Fixed

- **Breaking (internal wire shape):** Triggers' route params (`TriggerServiceParamsRTO`/
  `TriggerServiceModelParamsRTO`, `triggers.handler.ts`'s route patterns) renamed `service_id` →
  `serviceId`. The snake_case naming was a workaround for a real `@zanix/server` bug (a route
  param's own NAME was silently lowercased — see that package's own changelog), not a deliberate
  convention; now that the router preserves param-name casing, it's inconsistent with Templates' own
  `serviceId` (already camelCase) to keep it. The actual URL segments a caller sends
  (`/triggers/:serviceId/:model`) are unchanged — this only renames the internal route-pattern/RTO
  property, never the positional path structure itself.
- `TemplatesAdminClient.sync()` sent `{service_id: serviceId}` (snake_case) in its POST body while
  the server-side `SyncTemplatesRTO` expects `serviceId` (camelCase) — a real mismatch, though this
  client is never called anywhere in this package's own production code today (an external-consumer
  library export). Now sends `{serviceId}`, matching the RTO.
- `ZanixAdminHub.start({ triggers: false, templates: false })` now starts one server (previously
  zero) and never warns "no server was started". `defineAdminHubApp` always declares non-empty
  `operations` (see Added, above) regardless of the `triggers`/`templates` REST options, and
  `@zanix/app`'s `registerRemoteDispatchRoutes` registers a real `/__zanix-ops/admin-hub/...`
  controller for any app with non-empty `operations` — so a server now starts to serve that route
  even with both REST controllers skipped. This is an intentional consequence of adding
  `operations`, not a regression; `start-no-routes.test.ts`'s assertions were updated to match.

## [1.0.0] - 2026-08-03

Requires `@zanix/server@^3.0.0` or later (the Application/`anchored`/`Runtime` model this release's
own factories and `ZanixAdminHub.start()` depend on, and the new Discovery mechanism
`createTemplatesDiscoveryProvider()` builds on).

### Added

- `ZanixAdminHub.start()` now guards against a second call overlapping a first one still in flight
  (e.g. called twice back to back without `await`ing the first) — mirrors `@zanix/core`'s own
  `isStarting` guard on `Zanix.start()`. Previously, two overlapping `ZanixAdminHub.start()` calls
  would race against the same process-wide route/DI/discovery registries `bootstrapServers` mutates,
  silently corrupting state instead of throwing.
- `ZanixAdminHub.start()` now also guards against a second call issued **after** a previous one
  already finished successfully, without an intervening `ZanixAdminHub.stop()` — a DIFFERENT race
  than the one above: it's deliberately a no-op when the SAME owner re-acquires it. Mirrors
  `@zanix/core`'s own `isRunning` guard, so both packages behave the same way. At most one running
  `ZanixAdminHub` server per process, always — call `stop()` before starting again. Both guards are
  now implemented via `@zanix/server`'s new shared `createStartLifecycleGuard` (extracted after
  `@zanix/core`'s `start.ts` was found hand-rolling an identical pair of module-level booleans) —
  same behavior, one fewer place to keep the two packages in sync by hand.
- **`createTemplatesDiscoveryGuard()`** — the default `ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE` guard for
  any templates-shaped Discovery surface, extracted from this package's own
  `/.well-known/zanix/templates` registration so `@zanix/core`'s `codeTemplatesDiscovery` option
  (`/.well-known/zanix/code-templates`) can require the same role without re-inlining the
  `jwtValidationGuard(...)` construction (and risking drift if this package's own convention ever
  changes).
- New `docs/service-authentication.md` — a concrete, end-to-end example of a business service
  authenticating itself (`createServiceAssertion` → `POST /admin/service-token` →
  `X-Znx-Authorization`) against another service's local admin API or against `ZanixAdminHub`'s own
  `/triggers`/`/templates`.
- **`ZanixAdminHub.start({ auth })`** — a new, optional `auth?: ServiceAuthClientOptions` start
  option (`{serviceId, privateKey?, keyId?, assertionExpiration?}` — `privateKey`/`keyId` both
  optional, resolving `JWK_PRI_<serviceId>[_<keyId>]`/`JWK_ID_<serviceId>` automatically when
  omitted, via `@zanix/auth`'s new `resolveServiceAssertionPrivateKey`/
  `resolveServiceAssertionKeyId`) that installs a fully authenticated `TriggersAggregator` and
  `TemplatesDiscoveryClientFactory` for every registered service, using `@zanix/auth`'s new
  `createServiceAuthClient` under the hood. Without it, the hub's fan-out calls to each registered
  service's own `/admin/triggers`/`/.well-known/zanix/*` go out unauthenticated, which only works if
  the target doesn't actually require a token — the exact gap behind "the hub's own request succeeds
  but its internal fan-out to a registered service 401s."
- `createServiceRegistryAuthHeaders(options)` — the thin `@zanix/admin`-specific adapter between
  `@zanix/auth`'s generic `createServiceAuthClient` and this package's own `ServiceRegistryEntry`
  (`{serviceId, adminBaseUrl}`), resolving each service's exchange URL as
  `` `${service.adminBaseUrl}/admin/service-token` `` — the fixed route
  `createServiceExchangeController` always mounts under, regardless of the target's own
  `globalPrefix`. `ZanixAdminHub.start({ auth })` is built on top of this; exported directly for
  callers who need to build their own client factories instead of using the `auth` start option.

- `ZanixAdminHub.start()` now calls `@zanix/server`'s `guardSingleAdminRegistration` — running it in
  the same process as `@zanix/core`'s `Zanix.start()` with its own `admin` option enabled now throws
  a clear `InternalError` instead of silently corrupting shared route/resolver metadata (both
  independently call `bootstrapServers()` against the same process-global registry). See this
  module's own doc comment.
- **`defineAdminMetadata(owner)`** — this package now owns the composition logic for the
  business-service-side admin controllers it builds (`/admin/triggers`, `/admin/templates`,
  `/admin/service-token`), previously duplicated inline inside `@zanix/core`'s own
  `defineAdminMetadata()`. `@zanix/core`'s own function is now a one-line delegate to this. Exported
  alongside the new `ADMIN_APPLICATION`/`ADMIN_TRIGGERS_APPLICATION_ENV`/
  `ADMIN_TEMPLATES_APPLICATION_ENV` constants it reads. A plain, re-callable function rather than a
  cached side-effect import (`@zanix/admin/core`) on purpose — `@zanix/server`'s route registry is
  wiped at the end of every finalized boot sequence, so this needs to genuinely re-run its
  `@Controller` decorators on every call within one process (a real requirement `@zanix/core`'s own
  test suite exercises, calling `Zanix.bootstrap({ admin: true })` independently across many test
  files in one `deno test` run), not resolve an already-evaluated ES module namespace.
- **`createTemplatesDiscoveryProvider()`** — alongside `/admin/templates`, `defineAdminMetadata()`
  now also registers a read-only `/.well-known/zanix/templates` Discovery endpoint (see
  `@zanix/server@^3.0.0`'s new Discovery mechanism), gated by the same `ADMIN_ROLE`/
  `ADMIN_TEMPLATES_ROLE` the CRUD controller already requires. Reuses `TemplatesAdminRepository`'s
  own `list()` rather than a second, independent query path — see this function's own doc for the
  ownership caveat that follows from that choice (the schema is `@zanix/notifications`'s domain, but
  this package still authors the CRUD/discovery data-access layer itself, mirroring triggers' own
  shape). `stream()`-based pagination for a large templates collection is deliberately not built yet
  — this ships `snapshot()` only, matching the confirmed-small-resource scope of this round.

### Fixed

- **`syncTemplatesFromRegisteredService` (`POST /admin/templates/sync` / `POST /templates/sync`) now
  prefers a registered service's own DB-backed `/.well-known/zanix/templates` (real, currently-live
  content, including manual edits) over its static `/.well-known/zanix/code-templates` catalog when
  the target exposes both.** Previously it _always_ pulled `code-templates` only, even when the
  target had genuinely richer, hand-edited content available via its own admin/DB-templates —
  silently ignoring it. Falls back to `code-templates` whenever `templates` specifically isn't
  reachable (not registered at all, or this caller isn't authorized for it — `401`/`403`) — any
  other failure (network error, `5xx`) still propagates uncaught, same as before. New exported
  `realHttpStatus` (`modules/registry/reachability.ts`) backs the fallback decision, replacing a
  second private copy that would otherwise have been needed here.
- **`TriggersClientFactory`/`TriggersDiscoveryClientFactory`/`TemplatesDiscoveryClientFactory` now
  actually support an async factory**, as `docs/triggers-aggregator.md`'s own documented pattern for
  attaching per-service auth already showed (`async (service) => new
  TriggersAdminClient(...)`).
  Previously these types were synchronous-only and several call sites
  (`TriggersAggregator.list`/`get`/`create`/`update`/`remove`, `syncTemplatesFromRegisteredService`)
  used the factory's return value without `await`ing it first — an async factory's `Promise` was
  passed straight to methods like `.snapshot(...)` instead of the resolved client, so the documented
  authenticated-factory pattern never actually worked. Factory types now accept `T | Promise<T>`,
  and every call site awaits the result before use.

- `ZanixAdminHub.start()` no longer runs its defensive "public" bootstrap unless
  `triggers`/`templates` was explicitly configured with `application: 'main'` — previously it ran
  unconditionally with `finalize: false`, which could accidentally pick up and start serving an
  unrelated business app's own public routes if `ZanixAdminHub.start()` ran in the same process as
  that app's own bootstrap (e.g. `Zanix.start()` called unawaited).

### Changed (breaking)

- **`ZanixAdminHub.start()`'s own controllers now compose under a new `ADMIN_HUB_APPLICATION`
  (`'admin-hub'`) Application, not `ADMIN_APPLICATION` (`'admin'`).** Previously both this package's
  standalone hub AND `@zanix/core`'s embedded local admin (`defineAdminMetadata` in
  `modules/metadata.ts`) composed under the same `'admin'` Application — a real naming collision
  between two conceptually independent route sets (a business service's own local CRUD vs. this
  package's central aggregator/proxy) that happened to share a package. `AdminStartApplication` (the
  literal union `triggers`/`templates`'s own `application` option accepts) changed to match:
  `typeof DEFAULT_APPLICATION | typeof ADMIN_HUB_APPLICATION`.
- **`ZanixAdminHub.start()`'s internal server now pins its stable id via its own
  `ADMIN_HUB_SERVER_ID`/ `ADMIN_HUB_SERVER_ID_PREVIOUS` env vars**, not the shared
  `ADMIN_SERVER_ID`/ `ADMIN_SERVER_ID_PREVIOUS` `@zanix/core`'s embedded admin uses — previously
  both read the exact same env var, so co-locating them anchored both under the literal identical
  prefix. Both go through `@zanix/server`'s new generic
  `resolveApplicationServerId(application, type)`/
  `resolvePreviousApplicationServerId(application, type)` (replacing the removed
  `resolveAdminServerId`/`resolvePreviousAdminServerId`), which derives the env var name from the
  Application itself, so any future Application gets the same capability without a new hand-written
  function/env-var pair.

- **`isInternal` removed from `createTriggersController`/`createTemplatesController`/
  `createTriggersAdminController`'s own options entirely** — which Application a built controller
  belongs to is resolved from ambient composition context instead (see `@zanix/server`'s
  `ProgramModule.defineApplication`), never a factory option. `createTriggersAdminController` no
  longer takes an options argument at all (it was the only field it ever accepted).
- **`ZanixAdminHub.start()`'s `triggers`/`templates` options: `isInternal: false` →
  `application: 'main'`.** Both controllers are composed under the `'admin'` Application and served
  by its own anchored server by default; `triggers: { application: 'main' }`/
  `templates: { application: 'main' }` composes that one controller under the default Application
  instead, served by `ZanixAdminHub.start()`'s own unanchored "public" bootstrap — the same behavior
  the old `isInternal: false` provided, renamed to describe what it actually does (a
  Runtime-rebinding, not a visibility toggle). Typed as `AdminStartApplication` (the literal union
  of the only two Applications this function can ever actually activate a Runtime for), not a bare
  `string` — unlike `BootstrapServerOptions[type].application`, which forwards straight to
  `bootstrapServers` and so accepts any Application name.
- `ZanixAdminHub.start()`'s internal server now honors `ADMIN_SERVER_ID` for a stable id across
  restarts, the same way `@zanix/core`'s own `start()` always has — previously it always got a fresh
  random id, unusable for an external caller needing a stable address (e.g. registering this service
  in `ZanixAdminHub`'s own `ServiceRegistry`). Both now go through the same `resolveAdminServerId`
  helper in `@zanix/server`, so they can't drift out of sync again.

### Removed

- **`guardSingleAdminRegistration`/`releaseAdminRegistration`** (added in `0.3.0`) — the
  cross-package mutual-exclusion guard between `@zanix/core`'s embedded `admin` option and this
  package's own `ZanixAdminHub.start()`. It's no longer needed, and turned out to be overly
  conservative: the two route sets never actually collide (distinct paths, and now distinct
  Applications — see above), and `@zanix/server`'s new boot-session isolation
  (`BootSessionContainer`, preserving whichever Applications a DIFFERENT, still-in-flight `start()`
  sequence currently owns from `finalize` cleanup) makes it safe for both to register and boot
  concurrently, even fired without a sequential `await` between them — the one real risk the guard
  existed to prevent. `defineAdminMetadata`'s `owner` parameter (only ever used to identify the
  caller to this guard) is removed along with it — it's now called with no arguments.

## [0.1.1] - 2026-07-28

### Changed

- Split the README's Service Registry/Triggers Aggregator/Templates API sections out into dedicated
  `docs/` guides (`docs/service-registry.md`, `docs/triggers-aggregator.md`,
  `docs/templates-api.md`), cross-linked to each other and back to the README, to keep the top-level
  README skimmable.

## [0.1.0] - 2026-07-28

### Added

- Initial package scaffold: `ServiceRegistry` (static service registry, config via constructor
  entries and/or `ZANIX_ADMIN_SERVICES`) and `TriggersAggregator` (fans out `list()` across every
  registered service tagged by `serviceId`; proxies `get`/`create`/`update`/`remove` to the resolved
  service — never owns or duplicates a service's own triggers collection).
- `createTemplatesController(options?)` — builds `zanix-admin`'s own `/templates` CRUD API. Unlike
  triggers, `zanix-admin` is the actual owner of this data — via this package's own
  `TemplatesAdminService`/RTOs and a `versionProtocol` config (same wire shape as a business
  service's own `/admin/templates`, which now depends on this package for these instead of the other
  way around — see `Changed` below). Defaults to `isInternal: true` (this is an ops/admin surface,
  not part of a public API) and `prefix: 'templates'`; both configurable via `options`. A factory
  (not a plain class) because `@Controller`'s `isInternal`/`prefix` are decorator-time config.
- This package now owns the shared admin domain in full: `ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE`/
  `ADMIN_TRIGGERS_ROLE`, `ADMIN_PROTOCOL_VERSION`/`ADMIN_PROTOCOL_HEADER`/
  `ADMIN_PROTOCOL_SUPPORTED_VERSIONS`, `TemplatesAdminService`/`Repository` +
  `CreateTemplateRTO`/`TemplateParamsRTO`/ `UpdateTemplateRTO`, `TriggersAdminService`/`Repository`
  (a business service's own local, single- service triggers CRUD — distinct from this package's own
  `/triggers` aggregator/proxy) + `TriggerModelParamsRTO`/`CreateTriggerRTO`/`UpdateTriggerRTO`,
  `createTriggersAdminController` + `createServiceExchangeController` (the
  `/admin/triggers`/`/admin/service-token` controllers a business service registers locally) +
  `ServiceExchangeRTO`, and `TemplatesAdminClient`/`TriggersAdminClient` — all exported from this
  package's `mod.ts`. `@zanix/core` re-exports the same symbols unchanged for its own built-in
  `/admin/templates`/`/admin/triggers`/`/admin/service-token`, rather than defining them itself.
- `createServiceExchangeController()` was converted from a plain, always-decorated `@Controller`
  class (as it existed in `@zanix/core` before this move) to a zero-argument factory, matching every
  other controller this package builds — a plain class reachable through this package's own `mod.ts`
  would register `/admin/service-token` the instant _anything_ imports `@zanix/admin`, for any
  reason, since a class-level decorator runs at module-evaluation time regardless of intent.
- **Real admin-protocol negotiation**, not just a version constant and a response-header stamp: all
  four controllers this package builds configure `@zanix/server`'s generic `versionProtocol`
  `@Controller` option with this package's own `ADMIN_PROTOCOL_HEADER`/`ADMIN_PROTOCOL_VERSION`/
  `ADMIN_PROTOCOL_SUPPORTED_VERSIONS` — it reads a caller's own declared `X-Znx-Admin-Protocol`
  request header, validates it against `ADMIN_PROTOCOL_SUPPORTED_VERSIONS`, and rejects an
  unrecognized one with `400 Bad Request` rather than silently guessing — the resolved version is
  then what the response header actually reflects, not a hardcoded constant. Absent header (every
  caller today) defaults to `ADMIN_PROTOCOL_VERSION`, so nothing existing breaks.
  `TriggersAdminClient`/`TemplatesAdminClient` (this package's own outbound clients, released in
  lockstep with the registry) now send `ADMIN_PROTOCOL_VERSION` on every request by default. Rolling
  out a future version bump follows the same expand-before-contract discipline as `@zanix/auth`'s
  service-credential key rotation: add the new version to `ADMIN_PROTOCOL_SUPPORTED_VERSIONS` before
  any caller declares it, only drop an old one after a safe window. (Originally shipped as a
  hand-rolled `adminProtocolGuard`/`adminProtocolInterceptor` pair, superseded by `@zanix/server`'s
  generic `versionProtocol` option before this package's first release — see `Changed` below.)
- `createTriggersController(options?)` — builds the HTTP surface over `TriggersAggregator`:
  `GET /triggers` (fan-out `list()`), `GET/PUT/DELETE /triggers/:serviceId/:model`,
  `POST /triggers/:serviceId`. Same auth model, and same `isInternal: true`/`prefix: 'triggers'`
  defaults (configurable via `options`), as `createTemplatesController`. Calls into whichever
  `TriggersAggregator` is installed via the new `setTriggersAggregator`/`getTriggersAggregator` pair
  — a sensible unauthenticated default is used if the app never installs one, but a real deployment
  should always call `setTriggersAggregator` with a `clientFactory` that attaches actual per-service
  auth (see the pluggable-auth example in the README).
- `ZanixAdminHub` (default export) — the reference deployable entrypoint:
  `ZanixAdminHub.start(options?)` calls both factories above (`options.triggers`/`options.templates`
  configure or, as `false`, skip each one) plus registers their supporting connectors/providers
  (`@zanix/datamaster`'s Mongo/Redis/cache, `@zanix/auth`'s session infra, `@zanix/notifications`'s
  `TemplateProvider`+ templates model), then starts **both** an internal and a public REST server in
  the same call (mirroring `@zanix/core`'s own `start.ts`) so either controller's default/overridden
  `isInternal` is served correctly regardless of which one a caller changes — the other bootstrap
  call is a harmless no-op when it has nothing to serve. `ZanixAdminHub.stop()` stops whatever it
  started. A convenience, not required — an app wiring the controllers into its own bootstrap
  directly never needs this class.

### Changed

- **The hand-rolled `adminProtocolGuard`/`adminProtocolInterceptor` pair is gone** — deleted along
  with the two files defining them — replaced by `@zanix/server`'s new, generic `versionProtocol`
  `@Controller` option (see `Added` above), the same mechanism any other consumer library can now
  use for its own protocol. All four controllers this package builds configure it with
  `ADMIN_PROTOCOL_HEADER`/`ADMIN_PROTOCOL_VERSION`/`ADMIN_PROTOCOL_SUPPORTED_VERSIONS` instead of
  stacking a separate `@Guard`/`@Interceptor` pair. Neither function was ever a public export this
  package shipped in a release — this is an internal simplification, not a breaking change for any
  real consumer.
- **This package no longer depends on `@zanix/core`.** It previously imported
  `TemplatesAdminService`/RTOs/`adminProtocolInterceptor`/roles from `@zanix/core` to build its own
  `/templates` controller — an inverted dependency inconsistent with every other Zanix library (none
  of which depend on `@zanix/core`; it depends on them), and the cause of `TemplatesController`
  duplicating `@zanix/core`'s `/admin/templates` controller almost verbatim. These now live here
  instead (see `Added` above), and `@zanix/core` depends on this package to build its own
  `/admin/templates`/`/admin/triggers` — the same direction as its other dependencies. No behavior
  change for consumers of either package.
- `TemplatesAdminRepository.create()`/`update()` now reject a syntactically invalid `hbs` before
  persisting it, via `@zanix/notifications`'s new `assertValidHandlebarsSyntax` — previously an
  invalid template was accepted silently and only discovered the first time
  `TemplateProvider.resolve()` tried to actually send it (and even then, downgraded to a misleading
  "Template not found" rather than a validation error).
- `TemplateParamsRTO`/`CreateTemplateRTO`'s channel enum now imports `@zanix/notifications`'s
  `NOTIFIER_CHANNELS` instead of a locally hand-copied `['email', 'sms', 'whatsapp']` array —
  removes a drift risk against that package's own schema, which hardcoded the same values
  independently.
- `UpdateTemplateRTO.active` now uses `@IsBoolean` instead of a bare `@Expose` — the latter only
  enforced presence/optionality, never the value's type, so a non-boolean `active` (e.g. the string
  `"yes"`) previously passed validation.
