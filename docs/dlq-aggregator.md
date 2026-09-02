# 🔀 DLQ Aggregator

`DlqAggregator` wraps a [`ServiceRegistry`](./service-registry.md) with the same fan-out/proxy logic
[`TriggersAggregator`](./triggers-aggregator.md) establishes, one domain over — DLQ (Dead Letter
Queue) entries:

| Method                             | Behavior                                                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `list()`                           | Fans out to **every** registered service's own `/.well-known/zanix/dlq` Discovery snapshot, tagged by `serviceId`. |
| `get(serviceId, id)`               | Proxies to the one resolved service's CRUD API.                                                                    |
| `push(serviceId, input)`           | Proxies to the one resolved service's CRUD API.                                                                    |
| `requeue(serviceId, id, options?)` | Proxies to the one resolved service's CRUD API.                                                                    |
| `discard(serviceId, id, options?)` | Proxies to the one resolved service's CRUD API.                                                                    |
| `remove(serviceId, id)`            | Proxies to the one resolved service's CRUD API.                                                                    |

`list()` reads from Discovery rather than the CRUD API's own `GET /admin/dlq` — a read-only
operation goes through the read-only protocol; every other method mutates or targets a single entry,
so it stays on the CRUD API. See `@zanix/server`'s `docs/applications.md`'s "Discovery" section.

**The Discovery snapshot is narrower than the full collection.** Unlike Triggers (few entries per
service), DLQ entries can be numerous and keep accumulating (no TTL/auto-purge). `list()` only
returns `'pending'`/`'claimed'`/`'failed'` entries (the actionable backlog), capped per status — see
`@zanix/datamaster`'s `createDlqDiscoveryProvider`, which authors the provider. A caller that wants
the _full_ paginated collection, including resolved (`'completed'`/`'discarded'`) history, uses
`DlqAdminClient.list()` against one named service directly instead — not exposed through the
aggregator's own `list()`.

**Deliberately excludes the lease-fenced worker-only primitives** (`claim`/`release`/`complete`/
`fail`) — same reasoning `DlqAdminService`'s own JSDoc gives: they're fenced by a `leaseOwner` a
specific worker process holds, not something a remote admin/agent has a real lease to present.

**Authentication is a pluggable seam**, same shape as `TriggersAggregator`. The constructor takes
two independent factories: `clientFactory` decides how each per-service `DlqAdminClient` (CRUD) is
built, and `discoveryClientFactory` decides how each per-service `DiscoveryAdminClient` (`list()`'s
Discovery reads) is built — both default to unauthenticated. Both may return a `Promise`.

**The common case has a ready-made shortcut.**
`ZanixAdminHub.start({ auth: { serviceId,
privateKey } })` installs an authenticated `DlqAggregator`
automatically, alongside `TriggersAggregator`'s — same credential, same
`createServiceRegistryAuthHeaders` adapter. Build the factories manually only when you need
something that shortcut doesn't cover — see
[`docs/triggers-aggregator.md`](./triggers-aggregator.md)'s own pluggable-auth example; the shape is
identical here, swapping `TriggersAdminClient`/`TriggersAggregator` for `DlqAdminClient`/
`DlqAggregator`.

```typescript
import {
  DiscoveryAdminClient,
  DlqAdminClient,
  DlqAggregator,
  ServiceRegistry,
} from 'jsr:@zanix/admin@[version]'

const dlq = new DlqAggregator(
  new ServiceRegistry([/* ... */]),
  async (service) =>
    new DlqAdminClient({
      baseUrl: service.adminBaseUrl,
      headers: await authHeaders(service), // see triggers-aggregator.md's own example
    }),
  async (service) =>
    new DiscoveryAdminClient({
      baseUrl: service.adminBaseUrl,
      headers: await authHeaders(service),
    }),
)
```

A single service failing during `list()`'s fan-out fails the whole call today (`Promise.all`) —
deliberately simple, same as `TriggersAggregator`.

---

## `createDlqController` — the HTTP surface over the aggregator above

The actual `/dlq` route (`zanix-admin`'s public API surface), calling into whichever `DlqAggregator`
is currently installed:

| Route                              | Behavior                                                         |
| ---------------------------------- | ---------------------------------------------------------------- |
| `GET /dlq/list`                    | `list()` — fanned out across every service's Discovery snapshot. |
| `GET /dlq/:serviceId/:id`          | `get(serviceId, id)`.                                            |
| `POST /dlq/:serviceId`             | `push(serviceId, body)`.                                         |
| `POST /dlq/:serviceId/:id/requeue` | `requeue(serviceId, id, { resetAttempts? })`.                    |
| `POST /dlq/:serviceId/:id/discard` | `discard(serviceId, id, { reason? })`.                           |
| `DELETE /dlq/:serviceId/:id`       | `remove(serviceId, id)`.                                         |

`list()`'s route is a bare `@Get()` with no path argument — `@zanix/server` defaults an omitted path
to the decorated method's own name, so it lands at `/list` under the controller's `dlq` prefix, same
convention `/triggers/list`/`/templates/list`/`/registry/list` all follow.

Install a real (authenticated) aggregator with `setDlqAggregator` **before** `ZanixAdminHub.start()`
— left unset, the controller falls back to a default `DlqAggregator` (the shared `ServiceRegistry`
from `getServiceRegistry`, unauthenticated clients) via `getDlqAggregator`, same as
`TriggersController`'s own default:

```typescript
import ZanixAdminHub, { DlqAggregator, setDlqAggregator } from 'jsr:@zanix/admin@[version]'

setDlqAggregator(new DlqAggregator(registry, clientFactory)) // see the pluggable-auth example above

await ZanixAdminHub.start()
```

Requires `ADMIN_ROLE`/`ADMIN_DLQ_ROLE` (both defined in this package) and accepts either a human
admin's `type: 'user'` token or a machine caller's `type: 'api'` one — same auth model as
[`TriggersController`](./triggers-aggregator.md).

`defineAdminHubApp`'s own `AdminHubAppOptions.dlq` (or `ZanixAdminHub.start()`'s own `dlq` option)
accepts `false` to skip registering this route entirely — same shape as `triggers`/`templates`.

**`DlqHubClient`** is the thin HTTP client for calling this `/dlq` route from OUTSIDE the hub
process (e.g. an ops UI like `@zanix/console`) — don't confuse it with `DlqAdminClient` above, which
calls a business SERVICE's own local `/admin/dlq` instead. `list()` GETs `/dlq/list` and always
returns the full cross-service aggregation — the hub's own route never accepts
`DlqAdminClient.list()`'s own filters:

```typescript
import { DlqHubClient } from 'jsr:@zanix/admin@[version]'

const client = new DlqHubClient({
  baseUrl: 'http://admin-hub.internal:9000',
  headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
})
const all = await client.list() // fanned out across every registered service, tagged by serviceId
const one = await client.get('billing', '665f1a2b3c4d5e6f7a8b9c0d')
```

---

## `createDlqAdminController` — a business service's own local `/admin/dlq`

Owned and authored by `@zanix/datamaster` (`@zanix/datamaster/dlq-api`) — the actual owner of the
`zanix-dlq` collection also owns the local HTTP surface fronting it: whichever package owns the
underlying data authors that resource's local `/admin/<x>` CRUD surface, while an aggregator (like
`DlqAggregator` above) only ever proxies to it, never owns the data itself.

Don't confuse this with `createDlqController`/`DlqAggregator` above — it's the other side of the
same wire protocol. `createDlqAdminController` builds the CRUD controller a **business service
itself** exposes at a fixed `admin/dlq` prefix, backed directly by `DlqAdminService`. This is the
target `DlqAggregator`'s `DlqAdminClient` calls into on the other end of the wire — this controller
owns real persisted data, `DlqAggregator` never does.

```typescript
import { createDlqAdminController } from 'jsr:@zanix/datamaster@[version]/dlq-api'
import { jwtValidationGuard } from 'jsr:@zanix/auth@[version]'

// Registers /admin/dlq under whichever Application scope is active when this runs — see
// `@zanix/core`'s own `admin: true` option, which calls this automatically as part of
// `@zanix/admin`'s `defineAdminMetadata()`, gated by `DLQ_MODEL_NAME` (opt-in, same shape as
// templates — see `defineAdminMetadata`'s own doc for why).
createDlqAdminController({
  guards: [
    jwtValidationGuard({ permissions: [ADMIN_ROLE, ADMIN_DLQ_ROLE], type: ['user', 'api'] }),
  ],
})
```

---

## 🔗 See also

- [Service Registry](./service-registry.md) — configuring the services `DlqAggregator` fans out to
  and proxies against.
- [Triggers Aggregator](./triggers-aggregator.md) — the sibling this mirrors, one domain over.
- [../README.md](../README.md) — package overview and quick start.
