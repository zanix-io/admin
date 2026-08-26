import type {
  DlqDiscardOptions,
  DlqEntryAttrs,
  DlqListOptions,
  DlqPaginatedResult,
  DlqPushInput,
  DlqRequeueOptions,
} from '@zanix/datamaster/dlq'

import { ADMIN_PROTOCOL_HEADER, RestClient } from '@zanix/server'
import { ADMIN_PROTOCOL_VERSION } from 'utils/constants.ts'

/**
 * The subset of {@link DlqListOptions} `GET /admin/dlq` actually accepts as query params —
 * `sort`/`filter` are deliberately left off, mirroring `@zanix/datamaster`'s own `ListDlqEntriesRTO`
 * (the RTO validating this exact route server-side): a plain query string can't carry either
 * shape's full expressiveness. A caller that needs `sort`/`filter` already has direct access to
 * `DlqProvider`/`DlqAdminService` without going through HTTP.
 */
export type DlqListQuery = Pick<
  DlqListOptions,
  'processType' | 'status' | 'origin' | 'page' | 'limit'
>

/** Serializes {@link DlqListQuery} into a `?a=b&c=d`-shaped suffix, omitting `undefined` values —
 * `''` (no leading `?`) when every field is `undefined`. */
function buildDlqListQuery(options: DlqListQuery): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) params.set(key, String(value))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

/**
 * Thin HTTP client for a business service's own `/admin/dlq` API (see `@zanix/datamaster/dlq-api`'s
 * `createDlqAdminController`) — this package owns the admin-protocol contract (see this package's
 * README "Admin APIs" section), so this is a single implementation of the request/response
 * contract, reused by `DlqAggregator` (and anything else) instead of a hand-rolled HTTP client that
 * can drift from what the controller actually accepts. Same shape as `TriggersAdminClient`.
 *
 * Construct one per target service, pointing `baseUrl` at that service's own admin address (host +
 * port + its internal path prefix — see `@zanix/core`'s `ADMIN_SERVER_ID`) and `headers` at
 * whatever credential that service's `AuthTokenValidation` accepts (typically a `type: 'api'`
 * token from `@zanix/auth`'s `exchangeServiceCredential`). Every request declares this client's own
 * {@link ADMIN_PROTOCOL_VERSION} via {@link ADMIN_PROTOCOL_HEADER} automatically — override it in
 * `options.headers` only if you have a specific reason to declare a different version.
 *
 * `id` is always `encodeURIComponent`-escaped before it's interpolated into the request path —
 * `RestClient` builds the final URL by plain string concatenation, so an unescaped `/`, `..`, `?`,
 * or `#` in `id` would otherwise land as extra path segments/query string on the target service's
 * own admin API instead of a single opaque path component.
 *
 * **`DlqAggregator.list()` never calls this class's own {@link list} method** — it fans out through
 * `DiscoveryAdminClient.snapshot('dlq')` instead (a read-only operation goes through the read-only
 * protocol; see `DlqAggregator`'s own doc), same as `TriggersAdminClient.list()` is never called by
 * `TriggersAggregator.list()`. {@link list} is still a real, exercised part of this client's public
 * contract for any OTHER direct caller that wants the full paginated collection (not Discovery's
 * narrower `'pending'`/`'claimed'`/`'failed'`-only snapshot) from a single named service.
 *
 * @requires @zanix/datamaster/dlq
 *
 * @example
 * ```ts
 * const client = new DlqAdminClient({
 *   baseUrl: 'http://billing.internal:30248/billing-rest',
 *   headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
 * })
 * const entry = await client.get('665f1a2b3c4d5e6f7a8b9c0d')
 * ```
 */
export class DlqAdminClient extends RestClient {
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
   * Lists the target service's own persisted DLQ entries, paginated — the full collection (subject
   * to `options`' own filters/paging), unlike `DlqAggregator.list()`'s narrower Discovery snapshot.
   * See {@link DlqListQuery} for which filters this route actually accepts.
   */
  public list(options: DlqListQuery = {}): Promise<DlqPaginatedResult> {
    return this.http.get<DlqPaginatedResult>(`/admin/dlq${buildDlqListQuery(options)}`)
  }

  /** Gets a single DLQ entry by `id`. */
  public get(id: string): Promise<DlqEntryAttrs> {
    return this.http.get<DlqEntryAttrs>(`/admin/dlq/${encodeURIComponent(id)}`)
  }

  /** Pushes a new DLQ entry. */
  public push(input: DlqPushInput): Promise<DlqEntryAttrs> {
    return this.http.post<DlqEntryAttrs>('/admin/dlq', {
      body: JSON.stringify(input),
    })
  }

  /** Requeues a DLQ entry, moving it back to `'pending'`. */
  public requeue(
    id: string,
    options?: DlqRequeueOptions,
  ): Promise<DlqEntryAttrs> {
    return this.http.post<DlqEntryAttrs>(
      `/admin/dlq/${encodeURIComponent(id)}/requeue`,
      { body: JSON.stringify(options ?? {}) },
    )
  }

  /** Discards a DLQ entry, permanently closing it. */
  public discard(
    id: string,
    options?: DlqDiscardOptions,
  ): Promise<DlqEntryAttrs> {
    return this.http.post<DlqEntryAttrs>(
      `/admin/dlq/${encodeURIComponent(id)}/discard`,
      { body: JSON.stringify(options ?? {}) },
    )
  }

  /** Deletes a DLQ entry by `id`. */
  public async remove(id: string): Promise<void> {
    await this.http.delete(`/admin/dlq/${encodeURIComponent(id)}`)
  }
}
