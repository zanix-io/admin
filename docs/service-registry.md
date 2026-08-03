# 🗂️ Service Registry

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

## One shared registry, two consumers

`TriggersAggregator` (fanning out `/admin/triggers`/Discovery reads) and `TemplatesAdminService`
(pulling a service's `/.well-known/zanix/code-templates` Discovery snapshot for
`POST /templates/sync`) both resolve the **same** installed instance via `getServiceRegistry`,
rather than each holding an independent one that could drift out of sync — install it once with
`setServiceRegistry` before `ZanixAdminHub.start()`:

```typescript
import { ServiceRegistry, setServiceRegistry } from 'jsr:@zanix/admin@[version]'

setServiceRegistry(
  new ServiceRegistry([
    { serviceId: 'billing', adminBaseUrl: 'http://billing.internal:30248/billing-rest' },
  ]),
)
```

Left uninstalled, both consumers lazily build their own default instance the first time either one
needs it (entries from `ZANIX_ADMIN_SERVICES` only) — the same instance from then on, since the
first lazy build installs itself as the shared one.

---

## Reachability validation

A stale/typo'd `adminBaseUrl` is otherwise only discovered the first time something actually tries
to use it — `TriggersAggregator`'s and `syncTemplatesFromRegisteredService`'s calls have no
try/catch around their own network hop, so a config mistake surfaces as a production error deep in a
request, not as a clear signal at deploy time.

`checkServiceRegistryReachability()` probes every registered entry's
`{adminBaseUrl}/admin/service-token` with an intentionally-invalid credential — the same
deliberately-safe-to-probe route `/admin/service-token` already is (see
[Triggers Aggregator](./triggers-aggregator.md)'s own doc on trust being established entirely by
credential verification) — and classifies each result:

```typescript
import { checkServiceRegistryReachability } from 'jsr:@zanix/admin@[version]'

const results = await checkServiceRegistryReachability()
// [{ serviceId: 'billing', adminBaseUrl: '...', status: 'ok', httpStatus: 400 }, ...]
```

- **`'ok'`** — a live, correctly-anchored admin server answered.
- **`'unreachable'`** — a network error or timeout; nothing answered at all.
- **`'misconfigured'`** — something answered, but not this route (a 404) — a stale entry, wrong
  prefix, or wrong port.
- **`'unexpected'`** — any other response.

Every per-entry failure is caught internally (`Promise.all` over already-caught results) — this
function can never throw or hang its caller, and logs a warning for anything but `'ok'`.

`ZanixAdminHub.start()`'s own `validateRegistry` option (default `false`) calls this
fire-and-forget, right after its servers are already listening, so a temporarily-down registered
peer never fails or delays boot:

```typescript
await ZanixAdminHub.start({ validateRegistry: true })
```

For a deploy-pipeline smoke test instead of (or alongside) this, script against the returned array —
e.g. exit non-zero if any entry isn't `'ok'`.

---

## 🔗 See also

- [Triggers Aggregator](./triggers-aggregator.md) — fans out/proxies against every registered entry.
- [Templates API](./templates-api.md) — `POST /templates/sync` resolves `serviceId` against this
  same registry.
- [../README.md](../README.md) — package overview and quick start.
