# Zanix - Admin

[![Version](https://img.shields.io/jsr/v/@zanix/admin?color=blue&label=jsr)](https://jsr.io/@zanix/admin/versions)
[![Release](https://img.shields.io/github/v/release/zanix-io/admin?color=blue&label=git)](https://github.com/zanix-io/admin/releases)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

---

## 🧭 Table of Contents

1. [Description](#-description)
2. [Installation](#-installation)
3. [Basic Usage](#-basic-usage)
4. [Service Registry](#-service-registry)
5. [Triggers Aggregator](#-triggers-aggregator)
6. [Templates API](#-templates-api)
7. [Documentation](#-documentation)
8. [Contributing](#-contributing)
9. [Changelog](#-changelog)
10. [License](#-license)

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

`ZanixAdmin.start()` is the reference deployable entrypoint — the quickest way to stand up a real
instance. It's a convenience, not the only supported path: an app that wires
`createTriggersController()`/`createTemplatesController()` into its own
`@zanix/server`/`@zanix/core`-based bootstrap directly (see [Basic Usage](#-basic-usage)) never
needs it at all.

Both are bound to the `'admin'` Application and anchored by default — this is `zanix-admin`'s own
admin/ops surface, not meant to be reachable by an arbitrary public caller — and both accept a
`prefix` override via the factory's own argument for manual wiring, plus an `application: 'main'`
override via `ZanixAdmin.start({ triggers, templates })` for a deployment platform that genuinely
can't isolate an anchored server (wiring the factories manually instead means wrapping the call in
`ProgramModule.defineApplication(...)` yourself to get the same effect — see
[Basic Usage](#-basic-usage)).

---

## 📦 Installation

```ts
import ZanixAdmin, {
  createTemplatesController,
  createTriggersController,
  ServiceRegistry,
  TriggersAggregator,
} from 'jsr:@zanix/admin@[version]'
```

---

## 🚀 Basic Usage

### The quick path: `ZanixAdmin.start()`

Registers `TriggersController`/`TemplatesController` and their supporting connectors/providers
(`@zanix/datamaster`'s Mongo/Redis/cache, `@zanix/auth`'s session infra, `@zanix/notifications`'s
`TemplateProvider`), then starts a REST server:

```typescript
import ZanixAdmin, {
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

await ZanixAdmin.start() // requires MONGO_URI + TEMPLATES_MODEL_NAME/DATABASE_TEMPLATES for /templates
```

Requires a database connector configured (`MONGO_URI`, plus `TEMPLATES_MODEL_NAME` or
`DATABASE_TEMPLATES=true` for `/templates`), same as any `@zanix/core`-based service with DB-backed
templates. `ZanixAdmin.stop()` stops whatever it started.

### Manual wiring: using `TriggersAggregator` directly

For an app that builds its own bootstrap instead of using `ZanixAdmin.start()`:

```typescript
import { ServiceRegistry, TriggersAggregator } from 'jsr:@zanix/admin@[version]'

const registry = new ServiceRegistry([
  { serviceId: 'billing', adminBaseUrl: 'http://billing.internal:30248/billing-rest' },
  { serviceId: 'inventory', adminBaseUrl: 'http://inventory.internal:30248/inventory-rest' },
])

const triggers = new TriggersAggregator(registry)

const all = await triggers.list() // fanned out across every registered service, tagged by serviceId
const one = await triggers.get('billing', 'Invoice') // proxied straight to that service
```

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
