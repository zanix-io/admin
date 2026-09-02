import type {
  DlqDiscardOptions,
  DlqEntryAttrs,
  DlqPushInput,
  DlqRequeueOptions,
} from '@zanix/datamaster/dlq'
import type { AggregatedDlqEntry } from './dlq.aggregator.ts'

import { ADMIN_PROTOCOL_HEADER, RestClient } from '@zanix/server'
import { ADMIN_PROTOCOL_VERSION } from 'utils/constants.ts'

/**
 * Thin HTTP client for `zanix-admin`'s own hub-side `/dlq` proxy/aggregator (see
 * `createDlqController`) — this package owns the wire contract for its own hub routes (the routes,
 * their RTOs, and their response shapes all live in this package), the same reason `DlqAdminClient`
 * lives here even though IT calls out to a business service's own admin API owned by a different
 * package's data. Whoever eventually calls this client (e.g. `@zanix/console`) doesn't change who
 * authors it — the wire-contract owner does. Same shape as `TriggersHubClient`, one domain over.
 *
 * `list()` calls `/dlq/list`, not bare `/dlq` — `createDlqController`'s own `list()` method is a bare
 * `@Get()` with no path argument, and `@zanix/server`'s `@Get()` defaults an omitted path to the
 * decorated method's own name (`'list'`), same convention `TriggersHubClient`'s `/triggers/list` and
 * `TemplatesHubClient`'s `/templates/list` already follow — confirmed against a real running server
 * in `start.test.ts`, not assumed from the route's own doc comment.
 *
 * **Hub-facing, not service-facing** — unlike `DlqAdminClient` (which calls a business SERVICE's own
 * local `/admin/dlq` API directly), this points `baseUrl` at `zanix-admin`'s own hub deployment
 * (`defineAdminHubApp`'s `/dlq`), which itself fans out to/proxies every registered service via
 * `DlqAggregator`. Don't confuse the two levels: constructing this with a business service's own
 * `adminBaseUrl` would hit that service's unrelated (and almost certainly nonexistent) `/dlq/list`
 * route instead of the hub's.
 *
 * **The wire shape is NOT identical to `DlqAdminClient`'s** — the hub's own `/dlq` route never
 * accepts `DlqAdminClient`'s `list()` filters (`processType`/`status`/`origin`/`page`/`limit`):
 * {@link list} always returns the FULL cross-service aggregation (`DlqAggregator.list()`'s own
 * Discovery-backed fan-out — see its own doc for why it's narrower than the full persisted
 * collection: only `'pending'`/`'claimed'`/`'failed'` entries, capped per status), each entry tagged
 * with the `serviceId` it came from. Every other operation instead needs a `serviceId` path segment
 * `DlqAdminClient` never takes, since one hub instance proxies many services; `push`/`requeue`/
 * `discard` still accept the exact same `DlqPushInput`/`DlqRequeueOptions`/`DlqDiscardOptions`
 * bodies as `DlqAdminClient`, since the hub forwards those bodies to the target service's own
 * `/admin/dlq` unchanged (see `DlqServiceParamsRTO`/`DlqServiceEntryParamsRTO`).
 *
 * Every request declares this client's own {@link ADMIN_PROTOCOL_VERSION} via
 * {@link ADMIN_PROTOCOL_HEADER} automatically — override it in `options.headers` only if you have a
 * specific reason to declare a different version.
 *
 * `serviceId`/`id` are always `encodeURIComponent`-escaped before they're interpolated into the
 * request path — `RestClient` builds the final URL by plain string concatenation, so an unescaped
 * `/`, `..`, `?`, or `#` in either would otherwise land as extra path segments/query string on the
 * hub's own `/dlq` route instead of a single opaque path component.
 *
 * Manages no credentials of its own, same as every other client in this package — `headers` is
 * always caller-supplied; construct with whatever credential the hub's own `AuthTokenValidation`
 * accepts (typically a human admin's `type: 'user'` token, or a machine caller's `type: 'api'` one).
 *
 * @requires @zanix/datamaster/dlq
 *
 * @example
 * ```ts
 * const client = new DlqHubClient({
 *   baseUrl: 'http://admin-hub.internal:9000',
 *   headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
 * })
 * const all = await client.list() // fanned out across every registered service, tagged by serviceId
 * const one = await client.get('billing', '665f1a2b3c4d5e6f7a8b9c0d')
 * ```
 */
export class DlqHubClient extends RestClient {
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

  /**
   * Lists every dead-letter queue entry aggregated across every service this hub has registered —
   * no filters, unlike `DlqAdminClient.list()`'s own `DlqListQuery` (see this class's own doc for
   * why the hub's own route never accepts one).
   */
  public list(): Promise<AggregatedDlqEntry[]> {
    return this.http.get<AggregatedDlqEntry[]>('/dlq/list')
  }

  /** Gets a single dead-letter queue entry by `id` from `serviceId`, proxied through the hub. */
  public get(serviceId: string, id: string): Promise<DlqEntryAttrs> {
    return this.http.get<DlqEntryAttrs>(
      `/dlq/${encodeURIComponent(serviceId)}/${encodeURIComponent(id)}`,
    )
  }

  /** Pushes a new dead-letter queue entry onto `serviceId`, proxied through the hub. */
  public push(serviceId: string, input: DlqPushInput): Promise<DlqEntryAttrs> {
    return this.http.post<DlqEntryAttrs>(`/dlq/${encodeURIComponent(serviceId)}`, {
      body: JSON.stringify(input),
    })
  }

  /** Requeues a dead-letter queue entry on `serviceId`, moving it back to `'pending'`, proxied
   * through the hub. */
  public requeue(
    serviceId: string,
    id: string,
    options?: DlqRequeueOptions,
  ): Promise<DlqEntryAttrs> {
    return this.http.post<DlqEntryAttrs>(
      `/dlq/${encodeURIComponent(serviceId)}/${encodeURIComponent(id)}/requeue`,
      { body: JSON.stringify(options ?? {}) },
    )
  }

  /** Discards a dead-letter queue entry on `serviceId`, permanently closing it, proxied through the
   * hub. */
  public discard(
    serviceId: string,
    id: string,
    options?: DlqDiscardOptions,
  ): Promise<DlqEntryAttrs> {
    return this.http.post<DlqEntryAttrs>(
      `/dlq/${encodeURIComponent(serviceId)}/${encodeURIComponent(id)}/discard`,
      { body: JSON.stringify(options ?? {}) },
    )
  }

  /** Deletes a dead-letter queue entry from `serviceId`, proxied through the hub. */
  public async remove(serviceId: string, id: string): Promise<void> {
    await this.http.delete(
      `/dlq/${encodeURIComponent(serviceId)}/${encodeURIComponent(id)}`,
    )
  }
}
