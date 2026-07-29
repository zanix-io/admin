# 🔀 Triggers Aggregator

`TriggersAggregator` wraps a [`ServiceRegistry`](./service-registry.md) with the actual
fan-out/proxy logic:

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

---

## `TriggersController` — the HTTP surface over the aggregator above

`TriggersController` is the actual `/triggers` route (`zanix-admin`'s public API surface, same as
[`TemplatesController`](./templates-api.md)), calling into whichever `TriggersAggregator` is
currently installed:

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
same as constructing one manually per the README's own [Basic Usage](../README.md#-basic-usage):

```typescript
import ZanixAdmin, { setTriggersAggregator, TriggersAggregator } from 'jsr:@zanix/admin@[version]'

setTriggersAggregator(new TriggersAggregator(registry, clientFactory)) // see the pluggable-auth example above

await ZanixAdmin.start()
```

Requires `ADMIN_ROLE`/`ADMIN_TRIGGERS_ROLE` (both defined in this package, and re-exported from
`@zanix/core` for a business service's own use) and accepts either a human admin's `type: 'user'`
token or a machine caller's `type: 'api'` one — same auth model as
[`TemplatesController`](./templates-api.md).

---

## 🔗 See also

- [Service Registry](./service-registry.md) — configuring the services `TriggersAggregator` fans out
  to and proxies against.
- [Templates API](./templates-api.md) — `zanix-admin`'s other, oppositely-owned API surface.
- [../README.md](../README.md) — package overview and quick start.
