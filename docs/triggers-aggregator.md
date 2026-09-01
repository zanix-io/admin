# 🔀 Triggers Aggregator

`TriggersAggregator` wraps a [`ServiceRegistry`](./service-registry.md) with the actual
fan-out/proxy logic:

| Method                              | Behavior                                                                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `list()`                            | Fans out to **every** registered service's own `/.well-known/zanix/triggers` Discovery snapshot, tagged by `serviceId`. |
| `get(serviceId, model)`             | Proxies to the one resolved service's CRUD API.                                                                         |
| `create(serviceId, input)`          | Proxies to the one resolved service's CRUD API (`input` is `{model, active, triggers}`).                                |
| `update(serviceId, model, changes)` | Proxies to the one resolved service's CRUD API.                                                                         |
| `remove(serviceId, model)`          | Proxies to the one resolved service's CRUD API.                                                                         |

`list()` reads from Discovery rather than the CRUD API's own `/admin/triggers/list` — a read-only
operation goes through the read-only protocol; every other method mutates or targets a single entry,
so it stays on the CRUD API. See `@zanix/server`'s `docs/applications.md`'s "Discovery" section.

**Authentication is a pluggable seam.** The aggregator's constructor takes two independent
factories: `clientFactory` decides how each per-service `TriggersAdminClient` (CRUD) is built, and
`discoveryClientFactory` decides how each per-service `DiscoveryAdminClient` (`list()`'s Discovery
reads) is built — both default to unauthenticated, which only works against a service that doesn't
require credentials for that surface. Both may return a `Promise`, since attaching a real credential
is inherently async — `list()`/`get()`/`create()`/`update()`/`remove()` all `await` the factory's
own result before using the client.

**The common case has a ready-made shortcut — don't hand-roll the sign/exchange/cache plumbing
below.** `ZanixAdminHub.start({ auth: { serviceId, privateKey } })` installs an authenticated
`TriggersAggregator` automatically via `@zanix/auth`'s `createServiceAuthClient` (adapted here by
`createServiceRegistryAuthHeaders`) — see `docs/service-authentication.md`'s
[`ZanixAdminHub.start({ auth })`](./service-authentication.md#zanixadminhubstart-auth-) section.
Build the factories manually, as below, only when you need something that shortcut doesn't cover: a
custom `ServiceRegistry`, partial-failure tolerance, or different credentials for CRUD vs. Discovery
reads.

```typescript
import { createServiceAssertion } from 'jsr:@zanix/auth@[version]'
import {
  DiscoveryAdminClient,
  ServiceRegistry,
  TriggersAdminClient,
  TriggersAggregator,
} from 'jsr:@zanix/admin@[version]'

const privateKey = Deno.env.get('ZANIX_ADMIN_PRIVATE_KEY')! // base64-encoded PEM
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

// The actual HTTP call to that service's own exchange endpoint (wrapping
// @zanix/auth's exchangeServiceCredential — see its own docs) is up to your app.
async function getAccessToken(
  serviceId: string,
  exchangeUrl: string,
): Promise<string> {
  const cached = tokenCache.get(serviceId)
  if (cached && cached.expiresAt > Date.now()) return cached.token

  const assertion = await createServiceAssertion({
    serviceId: 'zanix-admin',
    privateKey,
  })
  const response = await fetch(exchangeUrl, {
    method: 'POST',
    body: JSON.stringify({ assertion }),
  })
  const { accessToken, expiresIn } = await response.json()
  tokenCache.set(serviceId, {
    token: accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  })
  return accessToken
}

const authHeaders = async (
  service: { serviceId: string; adminBaseUrl: string },
) => ({
  'X-Znx-Authorization': `Bearer ${await getAccessToken(
    service.serviceId,
    // Always `/admin/service-token` — `createServiceExchangeController`'s own fixed prefix,
    // regardless of the target service's own `server.rest.globalPrefix` (a completely separate
    // Application/server from its embedded admin one — see `docs/applications.md`).
    `${service.adminBaseUrl}/admin/service-token`,
  )}`,
})

const triggers = new TriggersAggregator(
  new ServiceRegistry([/* ... */]),
  async (service) =>
    new TriggersAdminClient({
      baseUrl: service.adminBaseUrl,
      headers: await authHeaders(service),
    }),
  // Third, independent factory for list()'s Discovery reads — same credential here, but it
  // doesn't have to be: a deployment could leave this one unauthenticated while still requiring
  // auth for CRUD, or vice versa.
  async (service) =>
    new DiscoveryAdminClient({
      baseUrl: service.adminBaseUrl,
      headers: await authHeaders(service),
    }),
)
```

A single service failing during `list()`'s fan-out fails the whole call today (`Promise.all`) —
deliberately simple for now; see `TriggersAggregator`'s own JSDoc for how to compose partial-failure
tolerance on top instead.

---

## `TriggersController` — the HTTP surface over the aggregator above

`TriggersController` is the actual `/triggers` route (`zanix-admin`'s public API surface, same as
[`TemplatesController`](./templates-api.md)), calling into whichever `TriggersAggregator` is
currently installed:

| Route                                | Behavior                                                         |
| ------------------------------------ | ---------------------------------------------------------------- |
| `GET /triggers`                      | `list()` — fanned out across every service's Discovery snapshot. |
| `GET /triggers/:serviceId/:model`    | `get(serviceId, model)`.                                         |
| `POST /triggers/:serviceId`          | `create(serviceId, body.model, body.active, body.triggers)`.     |
| `PUT /triggers/:serviceId/:model`    | `update(serviceId, model, { active?, triggers? })`.              |
| `DELETE /triggers/:serviceId/:model` | `remove(serviceId, model)`.                                      |

Install a real (authenticated) aggregator with `setTriggersAggregator` **before**
`ZanixAdminHub.start()` — left unset, the controller falls back to a default `TriggersAggregator`
(the shared `ServiceRegistry` from `getServiceRegistry`, unauthenticated clients) via
`getTriggersAggregator`, same as constructing one manually per the README's own
[Basic Usage](../README.md#-basic-usage):

```typescript
import ZanixAdminHub, {
  setTriggersAggregator,
  TriggersAggregator,
} from 'jsr:@zanix/admin@[version]'

setTriggersAggregator(new TriggersAggregator(registry, clientFactory)) // see the pluggable-auth example above

await ZanixAdminHub.start()
```

Requires `ADMIN_ROLE`/`ADMIN_TRIGGERS_ROLE` (both defined in this package, and re-exported from
`@zanix/core` for a business service's own use) and accepts either a human admin's `type: 'user'`
token or a machine caller's `type: 'api'` one — same auth model as
[`TemplatesController`](./templates-api.md).

**`TriggersHubClient`** is the thin HTTP client for calling this `/triggers` route from OUTSIDE the
hub process (e.g. an ops UI like `@zanix/console`) — don't confuse it with `TriggersAdminClient`
above, which calls a business SERVICE's own local `/admin/triggers` instead:

```typescript
import { TriggersHubClient } from 'jsr:@zanix/admin@[version]'

const client = new TriggersHubClient({
  baseUrl: 'http://admin-hub.internal:9000',
  headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
})
const all = await client.list() // fanned out across every registered service, tagged by serviceId
```

---

## `createTriggersAdminController` — a business service's own local `/admin/triggers`

Owned and authored by `@zanix/datamaster` (`@zanix/datamaster/triggers-api`) — the actual owner of
the `zanix-triggers` collection also owns the local HTTP surface fronting it: whichever package owns
the underlying data authors that resource's local `/admin/<x>` CRUD surface, while an aggregator
(like `TriggersAggregator` above) only ever proxies to it, never owns the data itself.

Don't confuse this with `createTriggersController`/`TriggersAggregator` above — it's the other side
of the same wire protocol. `createTriggersAdminController` builds the CRUD controller a **business
service itself** exposes at a fixed `admin/triggers` prefix, backed directly by
`TriggersAdminService`/`TriggersAdminRepository`. This is the target `TriggersAggregator`'s
`TriggersAdminClient` calls into on the other end of the wire — this controller owns real persisted
data, `TriggersAggregator` never does.

`@zanix/datamaster` never assumes an auth mechanism itself (it doesn't depend on `@zanix/auth`) —
the controller factory accepts `guards`/`versionProtocol` as options instead, supplied by whichever
package composes it:

```typescript
import { createTriggersAdminController } from 'jsr:@zanix/datamaster@[version]/triggers-api'
import { jwtValidationGuard } from 'jsr:@zanix/auth@[version]'

// Registers /admin/triggers under whichever Application scope is active when this runs — see
// `@zanix/core`'s own `admin: true` option, which calls this automatically as part of
// `@zanix/admin`'s `defineAdminMetadata()`.
createTriggersAdminController({
  guards: [
    jwtValidationGuard({ permissions: [ADMIN_ROLE, ADMIN_TRIGGERS_ROLE], type: ['user', 'api'] }),
  ],
})
```

`@zanix/admin`'s own `defineAdminMetadata()` builds this exact guard — the same `ADMIN_ROLE`/
`ADMIN_TRIGGERS_ROLE` gate and `type: 'user'`/`type: 'api'` token acceptance as `TriggersController`
above — only the underlying business logic differs (real CRUD vs. proxy). Registered under the
`'admin'` Application by default; `ADMIN_TRIGGERS_APPLICATION` overrides which Application it's
composed under instead (e.g. `'main'`).

---

## 🔗 See also

- [Service Registry](./service-registry.md) — configuring the services `TriggersAggregator` fans out
  to and proxies against.
- [Templates API](./templates-api.md) — `zanix-admin`'s other data-owner-composed API surface
  (`@zanix/notifications` owns templates' CRUD the same way `@zanix/datamaster` owns triggers').
- [../README.md](../README.md) — package overview and quick start.
