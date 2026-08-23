# 📝 Templates API

The templates API (`/templates`) is actually TWO separate controllers composed under the same route
prefix: the CRUD half (`GET`/`POST`/`PUT`/`DELETE`) is authored and owned end-to-end by
`@zanix/notifications` (`@zanix/notifications/templates-api`'s `createTemplatesController` —
schema/collection, RTOs, and the HTTP surface itself), the same "local API lives with its domain"
shape `@zanix/datamaster` establishes for triggers; `zanix-admin` supplies the auth guard/protocol
config at composition time (the controller itself never assumes an auth mechanism — see its own
doc). The `sync` extension below, by contrast, IS genuinely authored by this package
(`createTemplatesSyncController`), since it needs `ServiceRegistry`/cross-service Discovery, a
concept `@zanix/notifications` deliberately doesn't know about. `@zanix/core`'s own built-in
`/admin/templates` composes the exact same pair, so the wire shape is identical either way.

```typescript
import ZanixAdminHub from 'jsr:@zanix/admin@[version]'

// Requires a database connector to be configured (MONGO_URI, TEMPLATES_BACKEND=local, plus
// TEMPLATES_MODEL_NAME if overriding the default collection name), same as any @zanix/core-based
// service with DB-backed templates — a bare TEMPLATES_MODEL_NAME with no TEMPLATES_BACKEND=local has
// no effect (see `defineAdminMetadata`'s own doc).
await ZanixAdminHub.start()
```

Requires `ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE` (both defined in this package, and re-exported from
`@zanix/core` for a business service's own use), and accepts either a human admin's `type: 'user'`
token or a machine caller's `type: 'api'` one — same as `@zanix/core`'s own admin APIs. Bound to the
`'admin-hub'` Application by default, anchored (id-prefixed) whenever `ADMIN_HUB_SERVER_ID` is set —
there is no auto-generated anchored id — (see `ZanixAdminHub.start`'s own `templates` option to
change the route prefix, or `templates: { application: 'main' }` to mount it on the default
Application's unprefixed server instead). The guard built at composition time is the load-bearing
protection either way.

---

## Batch code sync — `POST /templates/sync`

Alongside the CRUD routes above, `TemplatesController` also exposes `POST /templates/sync` (this
package's own `syncTemplatesFromRegisteredService` — cross-service orchestration, not part of
`TemplatesAdminService`, since it depends on the `ServiceRegistry`/Discovery-client concepts this
package owns, not `@zanix/notifications`) — a batch, upsert-aware endpoint for pulling a registered
service's current template set, rather than accepting it as a request body. Typically triggered by a
caller with **no local database access of its own**, e.g. `@zanix/notifications`'s
`RemoteTemplateBackend` (Mode C, see its own `docs/templates.md#mode-c-remote-only-templates`) — but
instead of pushing its templates as a payload, it just tells this endpoint _which registered
service_ to pull from:

```typescript
// Body: { serviceId: string }
// Response: { seeded: number; resynced: number }
```

`serviceId` is looked up in the shared `ServiceRegistry` (see
[Service Registry](./service-registry.md) — the same registry `TriggersAggregator` uses), resolving
that service's own base URL. This package then pulls from whichever of two Discovery resources that
service exposes, **preferring the richer one**:

1. **`/.well-known/zanix/templates`** — that service's own DB-backed Discovery (this package's own,
   only present when the target has `admin` + DB-backed templates enabled) — its real,
   currently-live content, including any manual edit. Tried first.
2. **`/.well-known/zanix/code-templates`** — `@zanix/notifications`'s own Discovery
   (`defineCodeTemplatesDiscovery`) — the static in-code catalog only. Used whenever resource 1
   specifically isn't reachable (not registered at all — the target has no DB-backed templates — or
   this service's own credentials aren't authorized for it) — present on any service using
   `@zanix/notifications`, regardless of whether it also has DB-backed templates.

Either way, the fetched entries are reconciled against this service's own database using the same
`planCodeSync` (`@zanix/helpers`) rules `LocalTemplateBackend` applies locally — seed a brand-new
`{channel,name}`, resync one nobody's edited directly since the last sync, leave a manually-edited
one alone, and flip an entry no longer in the fetched set to `source: 'database'` (never delete it).
This merge doesn't care which of the two resources the entries came from — pulling a target's real,
DB-backed content is simply treated as this service's own authoritative default, the same way its
code catalog always has been.

This is **additive**, not a replacement for `create()`/`update()` — those keep their existing
throw-on-conflict, human-facing CRUD semantics unchanged. It is also safe to call concurrently from
N replicas of the same business service: each seed is a single atomic
`updateOne(..., { upsert: true })`, so two replicas racing the same brand-new `{channel,name}`
either both settle onto the same inserted row (only the one that actually performed the insert is
counted in `seeded`) or one hits the collection's unique `{channel,name}` index as a duplicate-key
error, which is caught and treated as "already seeded," never surfaced as a failure.

`TemplatesAdminClient.sync(serviceId)` POSTs to this same route for `@zanix/admin`'s own internal
callers — but `RemoteTemplateBackend` does **not** use it: it hand-rolls its own POST instead, since
importing `TemplatesAdminClient` from `@zanix/notifications` would be circular (`@zanix/admin`
already depends on `@zanix/notifications` for `ZanixTemplateAttrs`/`Notifiers`). Either way, the
central service must have `RemoteTemplateBackend`'s own `serviceId` registered in its
`ServiceRegistry` first, mapped to a base URL reachable for that service's own Discovery endpoint.

---

## `TemplatesHubClient` — calling `/templates` from outside the hub

`TemplatesHubClient` is the thin HTTP client for calling this hub's own `/templates` CRUD routes
from OUTSIDE the hub process (e.g. an ops UI like `@zanix/console`) — don't confuse it with
`TemplatesAdminClient`, which calls a business SERVICE's own local `/admin/templates` instead:

```typescript
import { TemplatesHubClient } from 'jsr:@zanix/admin@[version]'

const client = new TemplatesHubClient({
  baseUrl: 'http://admin-hub.internal:9000',
  headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
})
const templates = await client.list()
```

**CRUD only — no `sync()`.** `POST /templates/sync` is composed only on the LOCAL,
business-service-side `/admin/templates` prefix (`defineAdminMetadata`), not on this hub-side
`/templates` prefix — `defineAdminHubApp` only ever wires the CRUD half for the hub. A future change
wiring `sync` onto the hub too would add a matching method to this client then, not before.

---

## `createTemplatesDiscoveryGuard` — one guard, shared by two Discovery endpoints

`createTemplatesDiscoveryGuard()` builds the default `ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE` guard this
package's own `/.well-known/zanix/templates` Discovery endpoint (above) requires. It's exported so
`@zanix/core`'s own `codeTemplatesDiscovery` option — the static, in-code catalog exposed at
`/.well-known/zanix/code-templates` — can require the exact same role, rather than re-inlining an
equivalent `jwtValidationGuard(...)` call that could quietly drift out of sync with this one over
time:

```typescript
import { createTemplatesDiscoveryGuard } from 'jsr:@zanix/admin@[version]'

// Passed as `codeTemplatesDiscovery`'s own guard option — see `@zanix/core`'s README.
const guard = createTemplatesDiscoveryGuard()
```

The two Discovery resources are different data (this package's own live, DB-backed records vs. a
business service's static in-code catalog), but "who's allowed to read a template list" is the same
question either way.

---

## 🔗 See also

- [Triggers Aggregator](./triggers-aggregator.md) — `zanix-admin`'s other data-owner-composed API
  surface (`@zanix/datamaster` owns triggers' CRUD the same way `@zanix/notifications` owns
  templates').
- [Service Registry](./service-registry.md) — the `serviceId`-to-base-URL registry `sync` resolves
  against.
- [../README.md](../README.md) — package overview and quick start.
