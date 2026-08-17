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
5. [Service Registry](#-service-registry)
6. [Triggers Aggregator](#-triggers-aggregator)
7. [Templates API](#-templates-api)
8. [Documentation](#-documentation)
9. [Contributing](#-contributing)
10. [Changelog](#-changelog)
11. [License](#-license)

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
- **Templates are centrally owned by `zanix-admin` itself.** Business services stop connecting to a
  templates database at all and call `zanix-admin`'s `/templates` API instead (see
  `@zanix/notifications`'s own `docs/templates.md`, "Mode C: remote-only templates").

`ZanixAdminHub.start()` is the reference deployable entrypoint — the quickest way to stand up a real
instance. It's a convenience, not the only supported path: an app that wires
`createTriggersController()`/`createTemplatesController()` into its own
`@zanix/server`/`@zanix/core`-based bootstrap directly (see [Basic Usage](#-basic-usage)) never
needs it at all.

Both are bound to the `'admin'` Application and anchored by default — this is `zanix-admin`'s own
admin/ops surface, not meant to be reachable by an arbitrary public caller — and both accept a
`prefix` override via the factory's own argument for manual wiring, plus an `application: 'main'`
override via `ZanixAdminHub.start({ triggers, templates })` for a deployment platform that genuinely
can't isolate an anchored server (wiring the factories manually instead means wrapping the call in
`ProgramModule.defineApplication(...)` yourself to get the same effect — see
[Basic Usage](#-basic-usage)).

---

## 📦 Installation

```ts
import ZanixAdminHub, {
  createTemplatesController,
  createTriggersController,
  ServiceRegistry,
  TriggersAggregator,
} from 'jsr:@zanix/admin@[version]'
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

await ZanixAdminHub.start() // requires MONGO_URI + TEMPLATES_MODEL_NAME/DATABASE_TEMPLATES for /templates
```

Requires a database connector configured (`MONGO_URI`, plus `TEMPLATES_MODEL_NAME` or
`DATABASE_TEMPLATES=true` for `/templates`), same as any `@zanix/core`-based service with DB-backed
templates. `ZanixAdminHub.stop()` stops whatever it started.

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
business-service-side CRUD, `/admin/triggers`/`/admin/templates`/`/admin/service-token`). A host
composing its own set of Zanix Apps via `@zanix/core`'s `apps` option or `activateApps` directly can
install either alongside its own apps, without going through `ZanixAdminHub`/`admin: true` at all:

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

**What actually happens, concretely**: `defineAdminHubApp()`'s own `/triggers`/`/templates` REST
surface used to also own the `operations`/`mcp` surface other apps/agents invoke via
`ctx.remote('admin-hub').call(...)`. That surface was extracted into its own, physically-separate
Zanix Apps — `defineHubTriggersApp()`/`defineHubTemplatesApp()` (hub side,
`src/modules/triggers/hub-triggers-app.ts`/`src/modules/templates/hub-templates-app.ts`), and
`defineLocalTriggersApp()`/`defineLocalTemplatesApp()` (local side, same shape) — each:

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
the current list of sub-app factories (`Array<() => ZanixAppDefinition>`), composed via ONE call:

```typescript
await activateApps([defineAdminHubApp(options), ...getAdminHubSubApps()])
```

`ZanixAdminHub.start()`/`@zanix/core`'s own `admin: true` option already do this internally — an
author consuming this package through either of those never has to call `getAdminHubSubApps()`
directly. It matters for anyone extending THIS package itself, or building their own package that
wants the same shape.

**Adding a third sub-app** (a template for any team replicating this pattern in their own package):

1. Write a new `defineXSubApp(): ZanixAppDefinition` factory — own `name`, `routes: false`, its own
   `operations`/`mcp`, reading whatever shared state it needs from an already-installed singleton
   (or the parent's own shared resources).
2. Add that factory to `HUB_SUB_APP_FACTORIES`/`LOCAL_SUB_APP_FACTORIES` (or your own package's
   equivalent list) — never by editing the parent app's own manifest body.
3. Nothing else changes: `getAdminHubSubApps()`'s callers keep working unmodified, since they only
   ever iterate the list, never a fixed arity.

This is deliberately NOT a generic "extension registry" with its own install/uninstall lifecycle —
it's a plain array of factory functions, composed through `activateApps()`'s own existing "list of
independent apps" contract. No new primitive was introduced to make this work; it's the same
composition mechanism every Zanix App already uses, applied to a package's own sub-apps instead of
to apps two different teams own.

---

## 🗂️ Service Registry

`ServiceRegistry` is the static list of known services `TriggersAggregator` fans out to and proxies
against — configure it in code (constructor entries), via the `ZANIX_ADMIN_SERVICES` env var, or
both.

See [`docs/service-registry.md`](./docs/service-registry.md) for the full configuration reference.

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

## 📝 Templates API

`TemplatesController` is `zanix-admin`'s templates CRUD API (`/templates`) — composed on top of
`@zanix/notifications`'s own `TemplatesAdminRepository`/`Service` (the real owner of the templates
schema), the same "compose, don't own" role this package already plays for triggers. It also exposes
a batch, upsert-aware `POST /templates/sync` that pulls a registered service's code templates via
its own Discovery endpoint, given just its `serviceId` — typically triggered by a caller with no
local database access of its own (e.g. `@zanix/notifications`'s `RemoteTemplateBackend` in Mode C).

See [`docs/templates-api.md`](./docs/templates-api.md) for the full CRUD/sync reference.

---

## 📚 Documentation

- [`docs/service-registry.md`](./docs/service-registry.md) — configuring the known-services list.
- [`docs/triggers-aggregator.md`](./docs/triggers-aggregator.md) — fan-out/proxy methods, routes,
  and pluggable per-service authentication.
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
