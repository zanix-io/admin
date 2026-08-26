import type {
  CreateTriggerInput,
  TriggersModelAttrs,
  UpdateTriggerInput,
} from '@zanix/datamaster/database'

import { ADMIN_PROTOCOL_HEADER, RestClient } from '@zanix/server'
import { ADMIN_PROTOCOL_VERSION } from 'utils/constants.ts'

/**
 * Thin HTTP client for a business service's own `/admin/triggers` API (see `@zanix/core`'s
 * `TriggersAdminController`) — this package owns the admin-protocol contract (see this package's
 * README "Admin APIs" section), so this is a single implementation of the request/response
 * contract, reused by `TriggersAggregator` (and anything else) instead of a hand-rolled HTTP client
 * that can drift from what the controller actually accepts.
 *
 * Construct one per target service, pointing `baseUrl` at that service's own admin address (host +
 * port + its internal path prefix — see `@zanix/core`'s `ADMIN_SERVER_ID`) and `headers` at
 * whatever credential that service's `AuthTokenValidation` accepts (typically a `type: 'api'`
 * token from `@zanix/auth`'s `exchangeServiceCredential`). Every request declares this client's own
 * {@link ADMIN_PROTOCOL_VERSION} via {@link ADMIN_PROTOCOL_HEADER} automatically — override it in
 * `options.headers` only if you have a specific reason to declare a different version.
 *
 * Does not (yet) inspect the `X-Znx-Admin-Protocol` response header — `RestClient`'s `http.*`
 * helpers only ever return the parsed body, not headers, so a caller that needs to check it today
 * has to fetch directly instead.
 *
 * `model` is always `encodeURIComponent`-escaped before it's interpolated into the request path —
 * `RestClient` builds the final URL by plain string concatenation, so an unescaped `/`, `..`, `?`,
 * or `#` in `model` would otherwise land as extra path segments/query string on the target
 * service's own admin API instead of a single opaque path component.
 *
 * @requires @zanix/datamaster/database
 *
 * @example
 * ```ts
 * const client = new TriggersAdminClient({
 *   baseUrl: 'http://billing.internal:30248/billing-rest',
 *   headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
 * })
 * const triggers = await client.list()
 * ```
 */
export class TriggersAdminClient extends RestClient {
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

  /** Lists every trigger configuration entry the target service has persisted. */
  public list(): Promise<TriggersModelAttrs[]> {
    return this.http.get<TriggersModelAttrs[]>('/admin/triggers/list')
  }

  /** Gets a single trigger configuration entry by `model`. */
  public get(model: string): Promise<TriggersModelAttrs> {
    return this.http.get<TriggersModelAttrs>(`/admin/triggers/${encodeURIComponent(model)}`)
  }

  /** Creates a new trigger configuration entry for `model`. */
  public create(input: CreateTriggerInput): Promise<TriggersModelAttrs> {
    return this.http.post<TriggersModelAttrs>('/admin/triggers', {
      body: JSON.stringify(input),
    })
  }

  /** Updates a trigger configuration entry's `active`/`triggers` fields. */
  public update(
    model: string,
    changes: UpdateTriggerInput,
  ): Promise<TriggersModelAttrs> {
    return this.http.put<TriggersModelAttrs>(
      `/admin/triggers/${encodeURIComponent(model)}`,
      { body: JSON.stringify(changes) },
    )
  }

  /** Deletes a trigger configuration entry by `model`. */
  public async remove(model: string): Promise<void> {
    await this.http.delete(`/admin/triggers/${encodeURIComponent(model)}`)
  }
}
