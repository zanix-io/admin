# 📝 Templates API

`TemplatesController` is `zanix-admin`'s templates CRUD API (`/templates`) — this package composes
it from `@zanix/notifications`'s own `TemplatesAdminRepository`/`TemplatesAdminService` (the actual
owner of the templates schema/collection), plus this package's own RTOs (validation contract) and
`versionProtocol` (protocol negotiation). Same shape as triggers: `zanix-admin` wires the HTTP
surface, the data owner authors the CRUD logic. `@zanix/core`'s own built-in `/admin/templates`
re-exports these exact same symbols rather than redefining them, so the wire shape is identical
either way.

```typescript
import ZanixAdminHub from 'jsr:@zanix/admin@[version]'

// Requires a database connector to be configured (MONGO_URI, TEMPLATES_MODEL_NAME, etc.), same as
// any @zanix/core-based service with DB-backed templates.
await ZanixAdminHub.start()
```

Requires `ADMIN_ROLE`/`ADMIN_TEMPLATES_ROLE` (both defined in this package, and re-exported from
`@zanix/core` for a business service's own use), and accepts either a human admin's `type: 'user'`
token or a machine caller's `type: 'api'` one — same as `@zanix/core`'s own admin APIs. Bound to the
`'admin'` Application, anchored (id-prefixed) whenever `ADMIN_SERVER_ID` is set — there is no
auto-generated anchored id — (see `createTemplatesController`/`ZanixAdminHub.start`'s own
`templates` option to change the route prefix, or `templates: { application: 'main' }` to mount it
on the default Application's unprefixed server instead). `AuthTokenValidation` and the role gate
remain the load-bearing protection either way.

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
// Body: { service_id: string }
// Response: { seeded: number; resynced: number }
```

`service_id` is looked up in the shared `ServiceRegistry` (see
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

## 🔗 See also

- [Triggers Aggregator](./triggers-aggregator.md) — `zanix-admin`'s other data-owner-composed API
  surface (`@zanix/datamaster` owns triggers' CRUD the same way `@zanix/notifications` owns
  templates').
- [Service Registry](./service-registry.md) — the `serviceId`-to-base-URL registry `sync` resolves
  against.
- [../README.md](../README.md) — package overview and quick start.
