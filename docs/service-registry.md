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

## 🔗 See also

- [Triggers Aggregator](./triggers-aggregator.md) — the main consumer of `ServiceRegistry`, fanning
  out/proxying against every registered entry.
- [../README.md](../README.md) — package overview and quick start.
