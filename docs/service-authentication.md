# 🔐 Service-to-Service Authentication

How one service authenticates itself against another service's `/admin/*` API — or against
`ZanixAdminHub`'s own `/triggers`/`/templates` aggregator — using nothing but a keypair and the
`/admin/service-token` endpoint every admin surface already exposes. No extra parameter on
`ZanixAdminHub.start()` or `ServiceRegistry` is needed for this — it's pure env-var configuration on
whichever side receives the call. This is `@zanix/auth`'s own service-credential exchange (see its
`docs/service-credential.md` for the full primitive); this page is the concrete, end-to-end walk
through it from this package's own routes.

---

## The flow, in three steps

1. **Sign a short-lived assertion** with your own service's private key —
   `createServiceAssertion({ serviceId, privateKey })` (from `@zanix/auth`). This key is **yours**,
   distinct from `@zanix/auth`'s own `JWK_PRI`/`JWK_PUB` pair — the receiving side never sees it,
   only verifies the signature against a public key it already trusts.
2. **Exchange it for a real access token** — `POST /admin/service-token` with `{ assertion }` on
   whichever service you're calling. It verifies the assertion against that service's own
   `JWK_PUB_<serviceId>` env var and, if valid, mints a `type: 'api'` access token. No role gate on
   this endpoint itself — trust is established entirely by key verification, since the caller has no
   session yet (the whole point of calling it is to get one).
3. **Call the real endpoint** with the minted token as `X-Znx-Authorization: Bearer <accessToken>`.

```typescript
import { createServiceAssertion } from 'jsr:@zanix/auth@[version]'

// Step 1 — sign, using YOUR OWN service's private key (not @zanix/auth's JWK_PRI).
// `privateKey` omitted — resolves JWK_PRI_billing automatically, see note below.
const assertion = await createServiceAssertion({ serviceId: 'billing' })

// Step 2 — exchange it against the target service's own admin server.
const response = await fetch(
  'http://target.internal:8000/admin/service-token',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assertion }),
  },
)
const { accessToken } = await response.json()

// Step 3 — call the real endpoint, authenticated.
await fetch('http://target.internal:8000/admin/triggers', {
  headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
})
```

The receiving side needs two env vars set for `billing` to be trusted at all:

```env
JWK_PUB_billing=<billing's RSA public key, base64>
SERVICE_PERMISSIONS_billing=zanix:admin:triggers
```

Without `SERVICE_PERMISSIONS_<serviceId>`, the exchange still succeeds (the assertion is valid) but
the minted token carries no permissions — every role-gated route still rejects it. Permissions are
**never** requested by the caller; only the receiving side's own env var grants them.

> ℹ️ **There is no separate private-key env var to invent per app.** Omitting `privateKey` resolves
> `JWK_PRI_billing` automatically — the exact mirror image of the `JWK_PUB_billing` env var above,
> one naming convention for both directions (see `@zanix/auth`'s `docs/service-credential.md` for
> the full explanation and `resolveServiceAssertionPrivateKey`). Either way, the value is
> **base64-encoded** — the same convention `JWK_PUB_billing` uses. `createServiceAssertion` decodes
> it internally before signing. Generate a keypair with `generateRSAKeys()` (from `@zanix/helpers`)
> and store `btoa(privateKey)`, not the raw multi-line PEM — a raw PEM contains characters (`-`,
> newlines) that aren't valid base64 and fails to decode.
>
> **Only PKCS#8 private keys are supported** (`-----BEGIN PRIVATE KEY-----`) — a PKCS#1 key
> (`-----BEGIN RSA PRIVATE KEY-----`, e.g. from `openssl genrsa`) fails to import.
> `generateRSAKeys()` already produces PKCS#8; convert an existing PKCS#1 key with
> `openssl pkcs8 -topk8 -nocrypt -in old.pem -out new.pem`. The matching public key
> (`JWK_PUB_<serviceId>`) must be SPKI (`-----BEGIN PUBLIC KEY-----`) — the default
> `generateRSAKeys()`/ `openssl rsa -pubout` format.

---

## Calling a business service's own local admin API

The most common case: one service's `TriggersAggregator`/`RemoteTemplateBackend`-style code needs to
reach another service's own `/admin/triggers`/`/admin/templates` (the embedded admin API from
`@zanix/core`'s `admin` option).

**If you're calling this from `ZanixAdminHub.start()` itself**, don't hand-roll any of the below —
pass `auth: { serviceId }` to `start()` instead (see
[`ZanixAdminHub.start({ auth })`](#zanixadminhubstart-auth-)), and it wires an authenticated
`TriggersAggregator`/`TemplatesDiscoveryClientFactory` for you automatically. The manual pattern
below is for building your own client factory outside of `start()` — e.g. a custom `RestClient`
subclass, or different credentials for CRUD vs. Discovery reads. Use
`TriggersAdminClient`/`TemplatesAdminClient` (this package's own HTTP clients — see
[Triggers Aggregator](./triggers-aggregator.md)) rather than hand-rolling `fetch` calls; they
already speak the right protocol version/headers:

```typescript
import { TriggersAdminClient } from 'jsr:@zanix/admin@[version]'
import { createServiceAssertion } from 'jsr:@zanix/auth@[version]'

async function getAccessToken(baseUrl: string): Promise<string> {
  // `privateKey` omitted — resolves JWK_PRI_zanix-admin automatically.
  const assertion = await createServiceAssertion({ serviceId: 'zanix-admin' })
  const res = await fetch(`${baseUrl}/admin/service-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assertion }),
  })
  const { accessToken } = await res.json()
  return accessToken
}

const client = new TriggersAdminClient({
  baseUrl: 'http://billing.internal:8000/billing-rest',
  headers: {
    'X-Znx-Authorization': `Bearer ${await getAccessToken(
      'http://billing.internal:8000/billing-rest',
    )}`,
  },
})
const triggers = await client.list()
```

The target service needs `JWK_PUB_zanix-admin` and `SERVICE_PERMISSIONS_zanix-admin` (including
`zanix:admin` or `zanix:admin:triggers`/`zanix:admin:templates`) set for `zanix-admin`'s identity.

---

## `ZanixAdminHub.start({ auth })`

The built-in shortcut for the pattern above — `ZanixAdminHub`'s own outbound identity for
authenticating against every service in the `ServiceRegistry`:

```typescript
import ZanixAdminHub, { ServiceRegistry, setServiceRegistry } from 'jsr:@zanix/admin@[version]'

setServiceRegistry(
  new ServiceRegistry([
    {
      serviceId: 'billing',
      adminBaseUrl: 'http://billing.internal:8000/billing-rest',
    },
  ]),
)

await ZanixAdminHub.start({
  rest: { port: 9000 },
  validateRegistry: true,
  auth: {
    serviceId: 'zanix-admin-hub', // privateKey/keyId omitted — resolve JWK_PRI_/JWK_ID_zanix-admin-hub
    // keyId: 'v2',              // only if NOT reading it from JWK_ID_zanix-admin-hub
    // assertionExpiration: 60,  // optional
    // privateKey: ...,          // only if reading it from somewhere other than an env var
  },
})
```

To rotate this identity's key, register `JWK_PRI_zanix-admin-hub_v2`/`JWK_PUB_zanix-admin-hub_v2`
alongside the current ones, then flip `JWK_ID_zanix-admin-hub` to `v2` — a config change, not a code
change, with a real overlap window (see `@zanix/auth`'s
`docs/service-credential.md#-rotating-a-services-key`).

Every registered service needs `JWK_PUB_zanix-admin-hub` and `SERVICE_PERMISSIONS_zanix-admin-hub`
(granting `zanix:admin:triggers`/`zanix:admin:templates` as appropriate) set on **its own** process
— the exact same trust configuration as the manual pattern above, just automated: `start()`
internally signs+exchanges+caches a credential per target via `@zanix/auth`'s
`createServiceAuthClient` (adapted for `ServiceRegistryEntry` by
`createServiceRegistryAuthHeaders`), installing the resulting
`TriggersAggregator`/`TemplatesDiscoveryClientFactory` for you. Without `auth`, the hub's fan-out
calls go out unauthenticated — only viable against a target that doesn't actually require a token.

Skip this option and call `setTriggersAggregator`/`setTemplatesDiscoveryClientFactory` directly
instead (as shown in the previous section) for a custom `ServiceRegistry`, partial-failure
tolerance, or different credentials for CRUD vs. Discovery reads.

---

## Calling `ZanixAdminHub`'s own `/triggers`/`/templates`

The reverse direction — a caller (a deploy script, an ops tool, another service) reaching
`ZanixAdminHub`'s own aggregator endpoints — works exactly the same way, since `ZanixAdminHub`
always registers `/admin/service-token` too (via `defineAdminMetadata`'s own composition — see
`modules/metadata.ts`). Sign an assertion, exchange it against **the hub's own** address, then call
`/triggers`/`/templates` on the hub:

```typescript
// privateKey omitted — resolves JWK_PRI_ops-tool automatically.
const assertion = await createServiceAssertion({ serviceId: 'ops-tool' })
const { accessToken } = await (await fetch('http://hub.internal:3001/admin/service-token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ assertion }),
})).json()

await fetch('http://hub.internal:3001/triggers', {
  headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
})
```

The hub's own process needs `JWK_PUB_ops-tool` and `SERVICE_PERMISSIONS_ops-tool` (granting
`zanix:admin`/`zanix:admin:triggers`/`zanix:admin:templates` as appropriate) set — the exact same
mechanism as any other target, just configured on `ZanixAdminHub`'s own deployment instead of a
business service's. This is the opposite direction from
[`ZanixAdminHub.start({ auth })`](#zanixadminhubstart-auth-): that option only configures how the
hub authenticates **outbound** to each registered service — it has no effect on how an external
caller like `ops-tool` authenticates **inbound** to the hub, which always works this same way
regardless.

---

## Key rotation

Both sides support the same `keyId`-based rotation window `@zanix/auth`'s own
`exchangeServiceCredential` documents in full: register a new `JWK_PUB_<serviceId>_<keyId>`
alongside the old bare `JWK_PUB_<serviceId>`, switch `createServiceAssertion({ keyId: ... })` over,
then retire the old key once nothing still in flight could be signed with it. See `@zanix/auth`'s
`docs/service-credential.md` for the full runbook — this package's own routes don't add anything on
top of it.

---

## 🔗 See also

- `@zanix/auth`'s `docs/service-credential.md` — the full `createServiceAssertion`/
  `exchangeServiceCredential` contract this page walks through, including key rotation.
- [Service Registry](./service-registry.md) — `checkServiceRegistryReachability()` already probes
  `/admin/service-token` (with a deliberately-invalid assertion) to catch a stale `adminBaseUrl`
  before anything tries to authenticate against it for real.
- [Triggers Aggregator](./triggers-aggregator.md) — `TriggersAdminClient`'s own `headers` option is
  the seam this page's examples plug an access token into.
- [../README.md](../README.md) — package overview and quick start.
