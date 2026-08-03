# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
