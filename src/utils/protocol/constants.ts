/**
 * The current admin-protocol version this package stamps on responses and sends on its own
 * outgoing requests (`TriggersAdminClient`/`TemplatesAdminClient`). Bump only when the admin API's
 * request/response shapes change in a way a client needs to detect.
 */
export const ADMIN_PROTOCOL_VERSION = 1

/**
 * Every protocol version {@link adminProtocolGuard} still accepts on an incoming request's
 * declared version (oldest-first). Grows when {@link ADMIN_PROTOCOL_VERSION} is bumped and older
 * shapes are kept understood for a deprecation window; shrinks (dropping the oldest entry) only
 * once that window ends and nothing depends on it anymore.
 *
 * Deliberately a zero-import leaf file — kept import-free so a caller outside this package's own
 * dependency graph could, in principle, point a source-relative import straight at this one file
 * without pulling in the rest of `@zanix/admin`. In practice, a foreign package with an independent
 * release cadence (e.g. `@zanix/notifications`'s `RemoteTemplateBackend`) should still declare its
 * own protocol version by hand rather than import this constant — see that package's own comment
 * on why.
 */
export const ADMIN_PROTOCOL_SUPPORTED_VERSIONS: readonly number[] = [1]
