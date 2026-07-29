/**
 * A single business service known to this `zanix-admin` instance — static config only; there is no
 * dynamic self-registration (a possible future addition, not built here).
 */
export type ServiceRegistryEntry = {
  /**
   * This service's stable identity — matches the `<serviceId>` suffix that service's own
   * `JWK_PUB_<serviceId>` env var registers `zanix-admin`'s public key under, and the one
   * `zanix-admin`'s own `SERVICE_PERMISSIONS_<serviceId>` (if it verifies inbound calls from it)
   * would use. Not required to look like anything in particular — matches whatever
   * `getServiceId()`/`ADMIN_SERVER_ID` that service was configured with.
   */
  serviceId: string
  /**
   * That service's own admin API base URL — host, port, and its internal path prefix (see
   * `@zanix/core`'s `ADMIN_SERVER_ID`), e.g. `http://billing.internal:30248/billing-rest`.
   */
  adminBaseUrl: string
}
