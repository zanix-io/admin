# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) and this project
adheres to [Semantic Versioning](http://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- `ZanixAdmin` (default export) — the reference deployable entrypoint: `ZanixAdmin.start(options?)`
  calls both factories above (`options.triggers`/`options.templates` configure or, as `false`, skip
  each one) plus registers their supporting connectors/providers (`@zanix/datamaster`'s
  Mongo/Redis/cache, `@zanix/auth`'s session infra, `@zanix/notifications`'s `TemplateProvider`+
  templates model), then starts **both** an internal and a public REST server in the same call
  (mirroring `@zanix/core`'s own `start.ts`) so either controller's default/overridden `isInternal`
  is served correctly regardless of which one a caller changes — the other bootstrap call is a
  harmless no-op when it has nothing to serve. `ZanixAdmin.stop()` stops whatever it started. A
  convenience, not required — an app wiring the controllers into its own bootstrap directly never
  needs this class.

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
