# Zanix - Admin

[![Version](https://img.shields.io/jsr/v/@zanix/admin?color=blue&label=jsr)](https://jsr.io/@zanix/admin/versions)
[![Release](https://img.shields.io/github/v/release/zanix-io/admin?color=blue&label=git)](https://github.com/zanix-io/admin/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

## 🧭 Table of Contents

1. [Description](#-description)
2. [Installation](#-installation)
3. [Basic Usage](#-basic-usage)
4. [Extension pattern reference — how Triggers/Templates are composed](#-extension-pattern-reference--how-triggerstemplates-are-composed)
5. [Hub clients — calling zanix-admin itself from outside](#-hub-clients--calling-zanix-admin-itself-from-outside)
6. [Service Registry](#-service-registry)
7. [Triggers Aggregator](#-triggers-aggregator)
8. [DLQ Aggregator](#-dlq-aggregator)
9. [Templates API](#-templates-api)
10. [Documentation](#-documentation)
11. [Contributing](#-contributing)
12. [Changelog](#-changelog)
13. [License](#-license)

---

## 🧩 Description

**Zanix Admin** is the library behind `zanix-admin`, a centralized service for orchestrating
`/admin/triggers`/`/admin/templates` across a fleet of `@zanix/core`-based business services — see
`@zanix/core`'s own README, "Admin APIs" section, for what each business service exposes locally.

**This is a library, not a single deployable app.** Every `@zanix/core`-based business service is
just a thin app on top of that library; the same pattern applies here — any team stands up its own
`zanix-admin` instance by importing `@zanix/admin` and wiring a small entrypoint, rather than
sharing one hardcoded deployment.

**Triggers and templates are handled the opposite way from each other, on purpose:**

- **Triggers stay owned per-service.** `zanix-admin` is a **proxy/aggregator**, never an owner —
  each business service keeps its own persisted triggers collection. `zanix-admin` never touches
  another service's database directly; every read/write goes through that service's own
  `/admin/triggers` API (see this package's own `TriggersAdminClient`, also re-exported from
  `@zanix/core` for a business service's own use).
- **Templates are centrally deployed through `zanix-admin`'s own hub instance.** Business services
  stop connecting to a templates database at all and call `zanix-admin`'s `/templates` API instead
  (see `@zanix/notifications`'s own `docs/templates.md`, "Mode C: remote-only templates"). The CRUD
  controller code itself is authored by `@zanix/notifications`
  (`@zanix/notifications/templates-api`, the actual owner of the templates schema/collection,
  whether deployed centrally through this package's hub or embedded per-service) — this package only
  composes it, plus a genuinely cross-service extension on top (`POST /templates/sync`), the same
  "local API vs aggregator API" shape triggers already establishes.

`ZanixAdminHub.start()` is the reference deployable entrypoint — the quickest way to stand up a real
instance. It's a convenience, not the only supported path: an app that wires
`createTriggersController()`/`createTemplatesSyncController()` (this package) and
`createTemplatesController()` (`@zanix/notifications/templates-api`) into its own
`@zanix/server`/`@zanix/core`-based bootstrap directly (see [Basic Usage](#-basic-usage)) never
needs it at all.

Both are bound to the `'admin-hub'` Application by default (via `ZanixAdminHub.start()`) and
anchored whenever `ADMIN_HUB_SERVER_ID` is set — this is `zanix-admin`'s own admin/ops surface, not
meant to be reachable by an arbitrary public caller — and both accept a `prefix` override via the
factory's own argument for manual wiring, plus an `application: 'main'` override via
`ZanixAdminHub.start({ triggers, templates })` for a deployment platform that genuinely can't
isolate an anchored server (wiring the factories manually instead means wrapping the call in
`ProgramModule.defineApplication(...)` yourself to get the same effect — see
[Basic Usage](#-basic-usage)).

---

## 📦 Installation

```ts
import ZanixAdminHub, {
  createTemplatesSyncController,
  createTriggersController,
  ServiceRegistry,
  TriggersAggregator,
} from 'jsr:@zanix/admin@[version]'
import { createTemplatesController } from 'jsr:@zanix/notifications@[version]/templates-api'
```

---

## 🚀 Basic Usage

### The quick path: `ZanixAdminHub.start()`

Registers `TriggersController`/`TemplatesController` and their supporting connectors/providers
(`@zanix/datamaster`'s Mongo/Redis/cache, `@zanix/auth`'s session infra, `@zanix/notifications`'s
`TemplateProvider`), then starts a REST server:

```typescript
import ZanixAdminHub, {
  ServiceRegistry,
  setTriggersAggregator,
  TriggersAdminClient,
  TriggersAggregator,
} from 'jsr:@zanix/admin@[version]'
import { createServiceAssertion } from 'jsr:@zanix/auth@[version]'

// Install real per-service auth before starting — see "Triggers Aggregator" below for the full
// pluggable-auth example. Left unset, requests go out unauthenticated (only works against a
// target that doesn't require a token).
setTriggersAggregator(
  new TriggersAggregator(
    new ServiceRegistry(), // reads ZANIX_ADMIN_SERVICES
    (service) => new TriggersAdminClient({ baseUrl: service.adminBaseUrl }),
  ),
)

await ZanixAdminHub.start() // requires MONGO_URI + TEMPLATES_BACKEND=local for /templates
```

Requires a database connector configured (`MONGO_URI`, plus `TEMPLATES_BACKEND=local` — a bare
`TEMPLATES_MODEL_NAME` alone has no effect) for `/templates`, same as any `@zanix/core`-based
service with DB-backed templates. `ZanixAdminHub.stop()` stops whatever it started.

`ZanixAdminHub.start()` also traps `SIGINT`/`SIGTERM` automatically (no opt-out) and runs
`ZanixAdminHub.stop()` before exiting — this is a real standalone deployable service, so it drains
in-flight requests on its own the same way `@zanix/core`'s `Zanix.start()` does for a business
service, without needing to be run through it. Unlike `Zanix.start()`, a `stop()` failure during
this shutdown never force-exits the process — this package is often just one participant sharing a
process with an unrelated entrypoint (e.g. a business service's own `Zanix.start()`), so it only
logs the error instead of risking taking that service down too.

### Manual wiring: using `TriggersAggregator` directly

For an app that builds its own bootstrap instead of using `ZanixAdminHub.start()`:

```typescript
import { ServiceRegistry, TriggersAggregator } from 'jsr:@zanix/admin@[version]'

const registry = new ServiceRegistry([
  {
    serviceId: 'billing',
    adminBaseUrl: 'http://billing.internal:30248/billing-rest',
  },
  {
    serviceId: 'inventory',
    adminBaseUrl: 'http://inventory.internal:30248/inventory-rest',
  },
])

const triggers = new TriggersAggregator(registry)

const all = await triggers.list() // fanned out across every registered service, tagged by serviceId
const one = await triggers.get('billing', 'Invoice') // proxied straight to that service
```

### Composing this package's own Zanix Apps directly

`ZanixAdminHub.start()` and `@zanix/core`'s own `admin: true` option are both thin wrappers over two
`@zanix/app` manifests this package exports directly — `defineAdminHubApp(options)` (the central
aggregator/proxy, `/triggers`/`/templates`) and `defineLocalAdminApp()` (the embedded,
business-service-side CRUD, `/admin/triggers`/`/admin/templates`/`/admin/dlq`/`/admin/service-token`
— `/admin/dlq` is opt-in via `DLQ_MODEL_NAME`, unlike triggers' on-by-default shape; see
`defineAdminMetadata`'s own doc for why). A host composing its own set of Zanix Apps via
`@zanix/core`'s `apps` option or `activateApps` directly can install either alongside its own apps,
without going through `ZanixAdminHub`/`admin: true` at all:

```typescript
import Zanix from 'jsr:@zanix/core@[version]'
import { defineAdminHubApp } from 'jsr:@zanix/admin@[version]'

await Zanix.start({
  apps: {
    'admin-hub': {
      definition: defineAdminHubApp({ auth: { serviceId: 'zanix-admin-hub' } }),
      server: { rest: { port: 9000 } },
    },
  },
})
```

`defineAdminHubApp` declares one dependency, `registry` (type `'service-registry'`) — override it
via the host's own `resources`/`uses` to share a single `ServiceRegistry` instance across this app
and others in the same process, instead of relying solely on `setServiceRegistry`.

---

## 🧬 Extension pattern reference — how Triggers/Templates are composed

This package is the reference example, in the whole Zanix ecosystem, of the **Extension** pattern
for customizing a Zanix App without forking it: adding capability that doesn't replace anything
already there, as one or more SEPARATE Zanix Apps composed alongside a base app, rather than a
change bolted onto the base app's own manifest. (Contrast with **Override** — replacing a piece of
existing behavior, via `resources`/`uses`, `registerCoreProviderSlot`, or `@zanix/app`'s
`behaviors`/`ctx.behavior()` — a different question this pattern doesn't answer.)

**What actually happens, concretely**: `defineAdminHubApp()`'s own `/triggers`/`/templates`/`/dlq`
REST surface used to also own the `operations`/`mcp` surface other apps/agents invoke via
`ctx.remote('admin-hub').call(...)`. That surface was extracted into its own, physically-separate
Zanix Apps — `defineHubTriggersApp()`/`defineHubTemplatesApp()`/`defineHubDlqApp()` (hub side,
`src/modules/triggers/hub-triggers-app.ts`/`src/modules/templates/hub-templates-app.ts`/
`src/modules/dlq/hub-dlq-app.ts`), and `defineLocalTriggersApp()`/`defineLocalTemplatesApp()`/
`defineLocalDlqApp()` (local side, same shape, `src/modules/dlq/local-dlq-app.ts` for DLQ) — each:

- Has its **own** `name` (its own Application/route-dispatch identity) and its **own**
  `routes:
  false` — a sub-app owns no REST surface of its own; the REST controller stays on the
  parent (`defineAdminHubApp`/`defineLocalAdminApp`), only the `operations`/`mcp` invocation surface
  moved.
- Declares its own `operations`, ADDING a new invocation surface — never editing or replacing
  anything the parent already exposes.
- Shares state with the parent WITHOUT owning any `dependencies`/`resources` of its own — each
  sub-app reads an already-installed module-level singleton the parent's own `setup()` wires (e.g.
  `getTriggersAggregator()`), so composing more sub-apps costs nothing extra in resource-resolution
  complexity. A sub-app needing real DI-managed state instead would share it via the parent's own
  `uses`/root resources, memoized the same way any two apps sharing a resource already are.

**How they're actually activated — always together, never separately**: `getAdminHubSubApps()`/
`getLocalAdminSubApps()` (`src/modules/admin-hub-app.ts`/`src/modules/local-admin-app.ts`) return
the current list of already-built sub-apps (`ZanixAppDefinition[]`), composed via ONE call.
`getAdminHubSubApps(options)` takes the SAME `{ triggers, templates, dlq }` subset already passed to
`defineAdminHubApp(options)` — pass the identical object to both calls, or a sub-app whose REST
controller was disabled composes anyway (`getLocalAdminSubApps()` stays zero-arg — it reads the
deployment's own env vars directly instead):

```typescript
await activateApps([defineAdminHubApp(options), ...getAdminHubSubApps(options)])
```

`ZanixAdminHub.start()`/`@zanix/core`'s own `admin: true` option already do this internally — an
author consuming this package through either of those never has to call `getAdminHubSubApps()`
directly. It matters for anyone extending THIS package itself, or building their own package that
wants the same shape.

DLQ (Dead Letter Queue) is mirrored on both sides, the same shape Triggers/Templates already
establish: `defineLocalDlqApp()` (`getLocalAdminSubApps()`) on the business-service side, and
`defineHubDlqApp()` (`getAdminHubSubApps()`) on the hub side, backed by `DlqAggregator`/
`DlqAdminClient` — a `ServiceRegistry`-driven remote fan-out to every registered service's own
`/admin/dlq`, mirroring `TriggersAggregator`/`TriggersAdminClient`. See
[DLQ Aggregator](#-dlq-aggregator) below.

**Adding a third sub-app** (a template for any team replicating this pattern in their own package):

1. Write a new `defineXSubApp(): ZanixAppDefinition` factory — own `name`, `routes: false`, its own
   `operations`/`mcp`, reading whatever shared state it needs from an already-installed singleton
   (or the parent's own shared resources).
2. Add `{ factory: defineXSubApp, enabled: ... }` to `HUB_SUB_APP_ENTRIES`/`LOCAL_SUB_APP_ENTRIES`
   (or your own package's equivalent table) — never by editing the parent app's own manifest body.
   `enabled` must read the exact same signal that resource's REST controller is already gated by.
3. Nothing else changes: `getAdminHubSubApps()`'s callers keep working unmodified, since they only
   ever iterate the list, never a fixed arity.

This is deliberately NOT a generic "extension registry" with its own install/uninstall lifecycle —
it's a plain array of factory functions, composed through `activateApps()`'s own existing "list of
independent apps" contract. No new primitive was introduced to make this work; it's the same
composition mechanism every Zanix App already uses, applied to a package's own sub-apps instead of
to apps two different teams own.

---

## 🌐 Hub clients — calling `zanix-admin` itself from outside

`TriggersHubClient`/`TemplatesHubClient`/`RegistryHubClient` are thin HTTP clients for calling THIS
package's own hub-side `/triggers`/`/templates`/`/registry` routes remotely — e.g. from an external
ops UI like `@zanix/console`, not yet built. **Don't confuse these with the service-facing clients**
above (`TriggersAdminClient`/`TemplatesAdminClient`/`DlqAdminClient`), which each call a business
SERVICE's own local `/admin/<x>` API instead — the two levels point at different processes entirely:

```typescript
import { RegistryHubClient, TriggersHubClient } from 'jsr:@zanix/admin@[version]'

// Points at the HUB's own base URL, not any one registered service's.
const triggers = new TriggersHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
const registry = new RegistryHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
```

`@zanix/admin` owns the wire contract for its own hub routes (the routes, their RTOs, and their
response shapes), the same reason `TriggersAdminClient` already lives here even though it calls out
to a business service's own admin API — whoever eventually calls a client doesn't change who authors
it. `TemplatesHubClient` is CRUD-only — the hub never composes `POST /templates/sync` (see
[`docs/templates-api.md`](./docs/templates-api.md) for why).

---

## 🗂️ Service Registry

`ServiceRegistry` is the static list of known services `TriggersAggregator` fans out to and proxies
against — configure it in code (constructor entries), via the `ZANIX_ADMIN_SERVICES` env var, or
both. `defineAdminHubApp` always composes a read-only `GET /registry` (`createRegistryController`)
reflecting it — unlike `/triggers`/`/templates`/`/dlq`, there is no `registry: false` opt-out, since
the registry always exists regardless of which of those three are enabled.

See [`docs/service-registry.md`](./docs/service-registry.md) for the full configuration reference,
including `GET /registry` and `RegistryHubClient`.

---

## 🔀 Triggers Aggregator

`TriggersAggregator` wraps a `ServiceRegistry` with the actual fan-out/proxy logic behind
`zanix-admin`'s `/triggers` API (`TriggersController`) — `list()` fans out to every registered
service's own Discovery snapshot, `get`/`create`/`update`/`remove` proxy to the one resolved
service's CRUD API. Authentication is a pluggable seam (the constructor's `clientFactory`/
`discoveryClientFactory` arguments), not built in yet.

See [`docs/triggers-aggregator.md`](./docs/triggers-aggregator.md) for the full method/route
reference and a real pluggable-auth example.

---

## 🔀 DLQ Aggregator

`DlqAggregator` wraps a `ServiceRegistry` with the same fan-out/proxy logic behind `zanix-admin`'s
`/dlq` API (`createDlqController`), one domain over from `TriggersAggregator`: `list()` fans out to
every registered service's own Discovery snapshot (narrower than the full collection — only
`'pending'`/`'claimed'`/`'failed'` entries, capped per status — see `@zanix/datamaster`'s
`createDlqDiscoveryProvider`), `get`/`push`/`requeue`/`discard`/`remove` proxy to the one resolved
service's CRUD API. Authentication is the same pluggable seam (`clientFactory`/
`discoveryClientFactory`), and `ZanixAdminHub.start({ auth })` installs an authenticated instance
automatically alongside `TriggersAggregator`'s.

Deliberately excludes the lease-fenced worker-only primitives (`claim`/`release`/`complete`/`fail`)
— same reasoning `DlqAdminService`'s own JSDoc gives.

See [`docs/dlq-aggregator.md`](./docs/dlq-aggregator.md) for the full method/route reference.

---

## 📝 Templates API

The templates CRUD API (`/templates`) is authored and owned by `@zanix/notifications`
(`@zanix/notifications/templates-api`'s `createTemplatesController`) — the real owner of the
templates schema, the same "local API lives with its domain" shape `@zanix/datamaster` establishes
for triggers. This package composes a batch, upsert-aware `POST /templates/sync` extension of its
own on top (`createTemplatesSyncController`), mounted under the same prefix, that pulls a registered
service's code templates via its own Discovery endpoint, given just its `serviceId` — typically
triggered by a caller with no local database access of its own (e.g. `@zanix/notifications`'s
`RemoteTemplateBackend` in Mode C). `sync` is genuinely this package's own concern — it needs
`ServiceRegistry`/cross-service discovery, a concept `@zanix/notifications` deliberately doesn't
know about — mounted alongside the CRUD controller under the same prefix.

See [`docs/templates-api.md`](./docs/templates-api.md) for the full CRUD/sync reference.

---

## 📚 Documentation

- [`docs/service-registry.md`](./docs/service-registry.md) — configuring the known-services list.
- [`docs/triggers-aggregator.md`](./docs/triggers-aggregator.md) — fan-out/proxy methods, routes,
  and pluggable per-service authentication.
- [`docs/dlq-aggregator.md`](./docs/dlq-aggregator.md) — DLQ's own fan-out/proxy methods and routes,
  the same shape one domain over.
- [`docs/templates-api.md`](./docs/templates-api.md) — CRUD routes and the batch `/templates/sync`
  endpoint.
- [`docs/service-authentication.md`](./docs/service-authentication.md) — end-to-end example of a
  service authenticating against another service's admin API or against `ZanixAdminHub` itself.

Find other Zanix libraries' own docs at: 🔗
[https://github.com/zanix-io](https://github.com/zanix-io)

---

## 🤝 Contributing

Contributions are always welcome! To get started:

1. Open an issue for bug reports or feature requests.
2. Fork the repository and create a feature branch.
3. Implement your changes following the project's guidelines.
4. Add or update tests as needed.
5. Submit a pull request with a clear and descriptive summary.

---

## 🕒 Changelog

Check the [`CHANGELOG`](./CHANGELOG.md) for a complete version history and release notes.

---

## 📜 License

This project is licensed under the **MIT License**. See [`LICENSE`](./LICENSE) for more information.
