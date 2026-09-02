import type { ServiceRegistryEntry } from 'typings/registry.ts'

import { ADMIN_PROTOCOL_HEADER, RestClient } from '@zanix/server'
import { ADMIN_PROTOCOL_VERSION } from 'utils/constants.ts'

/**
 * Thin HTTP client for `zanix-admin`'s own hub-side `GET /registry/list` (see
 * `createRegistryController`) — this package owns the wire contract for its own hub routes (the
 * route, its RTOs, and its response shape all live in this package), the same reason
 * `TriggersAdminClient`/`TemplatesAdminClient` live here even though they call OUT to a business
 * service's own admin API owned by a different package's data.
 *
 * `list()` calls `/registry/list`, not bare `/registry` — `createRegistryController`'s own `list()`
 * method is a bare `@Get()` with no path argument, and `@zanix/server`'s `@Get()` defaults an
 * omitted path to the decorated method's own name (`'list'`), same convention every other hub
 * controller's `list()` route already follows (`TriggersHubClient`'s `/triggers/list`,
 * `TemplatesHubClient`'s `/templates/list`, `DlqHubClient`'s `/dlq/list`) — confirmed against a real
 * running server in `start.test.ts`, not assumed from the route's own doc comment.
 *
 * **Hub-facing, not service-facing** — unlike `TriggersAdminClient`/`TemplatesAdminClient`/
 * `DlqAdminClient` (which each call a business SERVICE's own local `/admin/<x>` API), this points
 * `baseUrl` at `zanix-admin`'s own hub deployment (`defineAdminHubApp`'s `/registry`) — the address
 * a central admin/ops tool (e.g. `@zanix/console`) reaches to inspect which services this hub
 * instance currently knows about. Don't confuse the two levels: constructing this with a business
 * service's own `adminBaseUrl` (a `ServiceRegistryEntry`'s own field) would hit that service's
 * unrelated (and almost certainly nonexistent) `/registry/list` route instead of the hub's.
 *
 * Every request declares this client's own {@link ADMIN_PROTOCOL_VERSION} via
 * {@link ADMIN_PROTOCOL_HEADER} automatically — override it in `options.headers` only if you have a
 * specific reason to declare a different version.
 *
 * Manages no credentials of its own, same as every other client in this package — `headers` is
 * always caller-supplied; construct with whatever credential the hub's own `AuthTokenValidation`
 * accepts (typically a human admin's `type: 'user'` token, or a machine caller's `type: 'api'` one).
 *
 * @example
 * ```ts
 * const client = new RegistryHubClient({
 *   baseUrl: 'http://admin-hub.internal:9000',
 *   headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
 * })
 * const services = await client.list()
 * ```
 */
export class RegistryHubClient extends RestClient {
  /** Creates the client, stamping every request with {@link ADMIN_PROTOCOL_VERSION}. */
  constructor(
    options: NonNullable<ConstructorParameters<typeof RestClient>[0]> = {},
  ) {
    const { headers, ...opts } = typeof options === 'string' ? { contextId: options } : options
    super({
      ...opts,
      headers: {
        [ADMIN_PROTOCOL_HEADER]: String(ADMIN_PROTOCOL_VERSION),
        ...headers,
      },
    })
  }

  /** Lists every service registered on this hub instance. */
  public list(): Promise<ServiceRegistryEntry[]> {
    return this.http.get<ServiceRegistryEntry[]>('/registry/list')
  }
}
