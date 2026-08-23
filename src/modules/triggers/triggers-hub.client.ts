import type { CreateTriggerInput, TriggersModelAttrs, UpdateTriggerInput } from '@zanix/database'
import type { AggregatedTrigger } from './triggers.aggregator.ts'

import { ADMIN_PROTOCOL_HEADER, RestClient } from '@zanix/server'
import { ADMIN_PROTOCOL_VERSION } from 'utils/constants.ts'

/**
 * Thin HTTP client for `zanix-admin`'s own hub-side `/triggers` proxy/aggregator (see
 * `createTriggersController`) — this package owns the wire contract for its own hub routes (the
 * routes, their RTOs, and their response shapes all live in this package), the same reason
 * `TriggersAdminClient` lives here even though IT calls out to a business service's own admin API
 * owned by a different package's data. Whoever eventually calls this client (e.g. `@zanix/console`)
 * doesn't change who authors it — the wire-contract owner does.
 *
 * **Hub-facing, not service-facing** — unlike `TriggersAdminClient` (which calls a business
 * SERVICE's own local `/admin/triggers` API directly), this points `baseUrl` at `zanix-admin`'s own
 * hub deployment (`defineAdminHubApp`'s `/triggers`), which itself fans out to/proxies every
 * registered service via `TriggersAggregator`. Don't confuse the two levels: constructing this with
 * a business service's own `adminBaseUrl` would hit that service's unrelated (and almost certainly
 * nonexistent) `/triggers` route instead of the hub's.
 *
 * Every request declares this client's own {@link ADMIN_PROTOCOL_VERSION} via
 * {@link ADMIN_PROTOCOL_HEADER} automatically — override it in `options.headers` only if you have a
 * specific reason to declare a different version.
 *
 * `serviceId`/`model` are always `encodeURIComponent`-escaped before they're interpolated into the
 * request path — `RestClient` builds the final URL by plain string concatenation, so an unescaped
 * `/`, `..`, `?`, or `#` in either would otherwise land as extra path segments/query string on the
 * hub's own `/triggers` route instead of a single opaque path component.
 *
 * Manages no credentials of its own, same as every other client in this package — `headers` is
 * always caller-supplied; construct with whatever credential the hub's own `AuthTokenValidation`
 * accepts (typically a human admin's `type: 'user'` token, or a machine caller's `type: 'api'` one).
 *
 * @requires @zanix/database
 *
 * @example
 * ```ts
 * const client = new TriggersHubClient({
 *   baseUrl: 'http://admin-hub.internal:9000',
 *   headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
 * })
 * const all = await client.list() // fanned out across every registered service, tagged by serviceId
 * const one = await client.get('billing', 'Invoice')
 * ```
 */
export class TriggersHubClient extends RestClient {
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

  /** Lists every trigger aggregated across every service this hub has registered. */
  public list(): Promise<AggregatedTrigger[]> {
    return this.http.get<AggregatedTrigger[]>('/triggers/list')
  }

  /** Gets a single trigger entry from `serviceId`, proxied through the hub. */
  public get(serviceId: string, model: string): Promise<TriggersModelAttrs> {
    return this.http.get<TriggersModelAttrs>(
      `/triggers/${encodeURIComponent(serviceId)}/${encodeURIComponent(model)}`,
    )
  }

  /** Creates a new trigger entry on `serviceId`, proxied through the hub. */
  public create(
    serviceId: string,
    input: CreateTriggerInput,
  ): Promise<TriggersModelAttrs> {
    return this.http.post<TriggersModelAttrs>(`/triggers/${encodeURIComponent(serviceId)}`, {
      body: JSON.stringify(input),
    })
  }

  /** Updates a trigger entry's `active`/`triggers` fields on `serviceId`, proxied through the hub. */
  public update(
    serviceId: string,
    model: string,
    changes: UpdateTriggerInput,
  ): Promise<TriggersModelAttrs> {
    return this.http.put<TriggersModelAttrs>(
      `/triggers/${encodeURIComponent(serviceId)}/${encodeURIComponent(model)}`,
      { body: JSON.stringify(changes) },
    )
  }

  /** Deletes a trigger entry from `serviceId`, proxied through the hub. */
  public async remove(serviceId: string, model: string): Promise<void> {
    await this.http.delete(
      `/triggers/${encodeURIComponent(serviceId)}/${encodeURIComponent(model)}`,
    )
  }
}
