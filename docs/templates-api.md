# 📝 Templates API

`TemplatesController` is `zanix-admin`'s **own** templates CRUD API (`/templates`) — unlike
triggers, this one owns the data, via this package's own `TemplatesAdminService` (data layer), RTOs
(validation contract), and `versionProtocol` (protocol negotiation). `@zanix/core`'s own built-in
`/admin/templates` re-exports these exact same symbols rather than redefining them, so the wire
shape is identical either way — anything built against that contract (e.g. `@zanix/notifications`'s
`RemoteTemplateBackend`, in Mode C) works against this unmodified.

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

---

## Batch code sync — `POST /templates/sync`

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
`updateOne(..., { upsert: true })`, so two replicas racing the same brand-new `{channel,name}`
either both settle onto the same inserted row (only the one that actually performed the insert is
counted in `seeded`) or one hits the collection's unique `{channel,name}` index as a duplicate-key
error, which is caught and treated as "already seeded," never surfaced as a failure.

`TemplatesAdminClient.sync(entries)` POSTs to this same route for `@zanix/admin`'s own internal
callers — but `RemoteTemplateBackend` does **not** use it: it hand-rolls its own POST instead, since
importing `TemplatesAdminClient` from `@zanix/notifications` would be circular (`@zanix/admin`
already depends on `@zanix/notifications` for `ZanixTemplateAttrs`/`Notifiers`).

---

## 🔗 See also

- [Triggers Aggregator](./triggers-aggregator.md) — `zanix-admin`'s other, oppositely-owned API
  surface.
- [../README.md](../README.md) — package overview and quick start.
