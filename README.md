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

Both default to `isInternal: true` — this is `zanix-admin`'s own admin/ops surface, not meant to be
reachable by an arbitrary public caller — and both accept an `isInternal`/`prefix` override
(`ZanixAdmin.start({ triggers, templates })`, or the factory's own argument for manual wiring) for a
deployment platform that genuinely can't isolate an internal server.

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

`ServiceRegistry` is a **static** list of known services — decided to be static config, at least
initially, so there is no dynamic self-registration yet. Configure it either in code (constructor
entries) or via the `ZANIX_ADMIN_SERVICES` env var (a JSON array of the same shape), or both — an
env entry overrides a constructor entry with the same `serviceId`:

```env
ZANIX_ADMIN_SERVICES=[{"serviceId":"billing","adminBaseUrl":"http://billing.internal:30248/billing-rest"}]
```

Each entry's `serviceId` should match how that service is known elsewhere — e.g. its own
`ADMIN_SERVER_ID` (see `@zanix/core`'s README) and its registered `JWK_PUB_<serviceId>` for
authenticating to it (see `@zanix/auth`'s `exchangeServiceCredential`).

---

## 🔀 Triggers Aggregator

`TriggersAggregator` wraps a `ServiceRegistry` with the actual fan-out/proxy logic:

| Method                              | Behavior                                                         |
| ----------------------------------- | ---------------------------------------------------------------- |
| `list()`                            | Fans out to **every** registered service, tagged by `serviceId`. |
| `get(serviceId, model)`             | Proxies to the one resolved service.                             |
| `create(serviceId, model, ...)`     | Proxies to the one resolved service.                             |
| `update(serviceId, model, changes)` | Proxies to the one resolved service.                             |
| `remove(serviceId, model)`          | Proxies to the one resolved service.                             |

**Authentication is a pluggable seam, not built in yet.** The aggregator's second constructor
argument, `clientFactory`, decides how each per-service `TriggersAdminClient` gets built — including
whatever credential header that service's `AuthTokenValidation` expects. Left unset, requests go out
with no credential at all, which only works against a service that doesn't require one:

```typescript
import { createServiceAssertion } from 'jsr:@zanix/auth@[version]'
import {
  ServiceRegistry,
  TriggersAdminClient,
  TriggersAggregator,
} from 'jsr:@zanix/admin@[version]'

const privateKey = Deno.env.get('ZANIX_ADMIN_PRIVATE_KEY')!
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

// The actual HTTP call to that service's own exchange endpoint (wrapping
// @zanix/auth's exchangeServiceCredential — see its own docs) is up to your app.
async function getAccessToken(serviceId: string, exchangeUrl: string): Promise<string> {
  const cached = tokenCache.get(serviceId)
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const assertion = await createServiceAssertion({ serviceId: 'zanix-admin', privateKey })
  const response = await fetch(exchangeUrl, {
    method: 'POST',
    body: JSON.stringify({ assertion }),
  })
  const { accessToken, expiresIn } = await response.json()
  tokenCache.set(serviceId, { token: accessToken, expiresAt: Date.now() + expiresIn * 1000 })
  return accessToken
}

const triggers = new TriggersAggregator(
  new ServiceRegistry([/* ... */]),
  async (service) =>
    new TriggersAdminClient({
      baseUrl: service.adminBaseUrl,
      headers: {
        'X-Znx-Authorization': `Bearer ${await getAccessToken(
          service.serviceId,
          `${service.adminBaseUrl}/auth/service-token`,
        )}`,
      },
    }),
)
```

A single service failing during `list()`'s fan-out fails the whole call today (`Promise.all`) —
deliberately simple for now; see `TriggersAggregator`'s own JSDoc for how to compose partial-failure
tolerance on top instead.

### `TriggersController` — the HTTP surface over the aggregator above

`TriggersController` is the actual `/triggers` route (`zanix-admin`'s public API surface, same as
`TemplatesController` below), calling into whichever `TriggersAggregator` is currently installed:

| Route                                | Behavior                                                     |
| ------------------------------------ | ------------------------------------------------------------ |
| `GET /triggers`                      | `list()` — fanned out across every service.                  |
| `GET /triggers/:serviceId/:model`    | `get(serviceId, model)`.                                     |
| `POST /triggers/:serviceId`          | `create(serviceId, body.model, body.active, body.triggers)`. |
| `PUT /triggers/:serviceId/:model`    | `update(serviceId, model, { active?, triggers? })`.          |
| `DELETE /triggers/:serviceId/:model` | `remove(serviceId, model)`.                                  |

Install a real (authenticated) aggregator with `setTriggersAggregator` **before**
`ZanixAdmin.start()` — left unset, the controller falls back to a default `TriggersAggregator` (a
registry read from `ZANIX_ADMIN_SERVICES` only, unauthenticated client) via `getTriggersAggregator`,
same as constructing one manually per [Basic Usage](#-basic-usage):

```typescript
import ZanixAdmin, { setTriggersAggregator, TriggersAggregator } from 'jsr:@zanix/admin@[version]'

setTriggersAggregator(new TriggersAggregator(registry, clientFactory)) // see the pluggable-auth example above

await ZanixAdmin.start()
```

Requires `ADMIN_ROLE`/`ADMIN_TRIGGERS_ROLE` (both defined in this package, and re-exported from
`@zanix/core` for a business service's own use) and accepts either a human admin's `type: 'user'`
token or a machine caller's `type: 'api'` one — same auth model as `TemplatesController`.

---

## 📝 Templates API

`TemplatesController` is `zanix-admin`'s **own** templates CRUD API (`/templates`) — unlike
triggers, this one owns the data, via this package's own `TemplatesAdminService` (data layer), RTOs
(validation contract), and `versionProtocol` (protocol negotiation, see below). `@zanix/core`'s own
built-in `/admin/templates` re-exports these exact same symbols rather than redefining them, so the
wire shape is identical either way — anything built against that contract (e.g.
`@zanix/notifications`'s `RemoteTemplateBackend`, in Mode C) works against this unmodified.

```typescript
import ZanixAdmin from 'jsr:@zanix/admin@[version]'

// Requires a database connector to be configured (MONGO_URI, TEMPLATES_MODEL_NAME, etc.), same as
// any @zanix/core-based service with DB-backed templates.
await ZanixAdmin.start()
```

Requires `ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE` (both defined in this package, and re-exported from
`@zanix/core` for a business service's own use), and accepts either a human admin's `type: 'user'`
token or a machine caller's `type: 'api'` one — same as `@zanix/core`'s own admin APIs. Defaults to
`isInternal: true` (see `createTemplatesController`/`ZanixAdmin.start`'s own `templates` option to
change that or the route prefix). `AuthTokenValidation` and the role gate remain the load-bearing
protection either way.

### Batch code sync — `POST /templates/sync`

Alongside the CRUD routes above, `TemplatesController` also exposes `POST /templates/sync`
(`TemplatesAdminRepository.syncCodeTemplates`) — a batch, upsert-aware endpoint for a caller with
**no local database access of its own**, e.g. `@zanix/notifications`'s `RemoteTemplateBackend` (Mode
C, see its own `docs/templates.md#mode-c-remote-only-templates`). It accepts the caller's full
current code-defined template set and reconciles it against this service's own database using the
same `planCodeSync` (`@zanix/helpers`) rules `LocalTemplateBackend` applies locally — seed a
brand-new `{channel,name}`, resync one nobody's edited directly since the last sync, leave a
manually-edited one alone, and flip an entry no longer in the given set to `source: 'database'`
(never delete it):

```typescript
// Body: { entries: [{ channel, name, hbs, hash }, ...] }
// Response: { seeded: number; resynced: number }
```

This is **additive**, not a replacement for `create()`/`update()` — those keep their existing
throw-on-conflict, human-facing CRUD semantics unchanged. It is also safe to call concurrently from
N replicas of the same business service: each seed is a single atomic
`updateOne(..., { upsert:
true })`, so two replicas racing the same brand-new `{channel,name}`
either both settle onto the same inserted row (only the one that actually performed the insert is
counted in `seeded`) or one hits the collection's unique `{channel,name}` index as a duplicate-key
error, which is caught and treated as "already seeded," never surfaced as a failure.

`TemplatesAdminClient.sync(entries)` POSTs to this same route for `@zanix/admin`'s own internal
callers — but `RemoteTemplateBackend` does **not** use it: it hand-rolls its own POST instead, since
importing `TemplatesAdminClient` from `@zanix/notifications` would be circular (`@zanix/admin`
already depends on `@zanix/notifications` for `ZanixTemplateAttrs`/`Notifiers`).

---

## 📚 Documentation

Find detailed documentation, guides, and examples at: 🔗
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
