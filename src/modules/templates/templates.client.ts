import type {
  CreateTemplateInput,
  Notifiers,
  SyncCodeTemplatesResult,
  UpdateTemplateInput,
  ZanixTemplateAttrs,
} from '@zanix/notifications'

import { ADMIN_PROTOCOL_HEADER, RestClient } from '@zanix/server'
import { ADMIN_PROTOCOL_VERSION } from 'utils/constants.ts'

/**
 * Thin HTTP client for a business service's own `/admin/templates` API (see `@zanix/core`'s
 * `TemplatesAdminController`) — this package owns the admin-protocol contract (see this package's
 * README "Admin APIs" section), so this is a single implementation of the request/response
 * contract, reused by any caller instead of a hand-rolled HTTP client that can drift from what the
 * controller actually accepts.
 * `updatedBy` is never sent by this client — the target service infers it from the caller's own
 * authenticated session, same as `TemplatesAdminController` already does locally.
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
 * `name` is always `encodeURIComponent`-escaped before it's interpolated into the request path —
 * `RestClient` builds the final URL by plain string concatenation, so an unescaped `/`, `..`, `?`,
 * or `#` in `name` would otherwise land as extra path segments/query string on the target
 * service's own admin API instead of a single opaque path component.
 *
 * @requires @zanix/notifications
 *
 * @example
 * ```ts
 * const client = new TemplatesAdminClient({
 *   baseUrl: 'http://templates.internal:30248/templates-rest',
 *   headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
 * })
 * const templates = await client.list()
 * ```
 */
export class TemplatesAdminClient extends RestClient {
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

  /** Lists every template entry the target service has persisted. */
  public list(): Promise<ZanixTemplateAttrs[]> {
    return this.http.get<ZanixTemplateAttrs[]>('/admin/templates/list')
  }

  /** Gets a single template entry by `channel`/`name`. */
  public get(channel: Notifiers, name: string): Promise<ZanixTemplateAttrs> {
    return this.http.get<ZanixTemplateAttrs>(
      `/admin/templates/${channel}/${encodeURIComponent(name)}`,
    )
  }

  /** Creates a new template entry. */
  public create(input: CreateTemplateInput): Promise<ZanixTemplateAttrs> {
    return this.http.post<ZanixTemplateAttrs>('/admin/templates', {
      body: JSON.stringify(input),
    })
  }

  /** Updates a template entry's `hbs`/`active`/`description`/`availableVariables` fields. */
  public update(
    channel: Notifiers,
    name: string,
    changes: UpdateTemplateInput,
  ): Promise<ZanixTemplateAttrs> {
    return this.http.put<ZanixTemplateAttrs>(
      `/admin/templates/${channel}/${encodeURIComponent(name)}`,
      {
        body: JSON.stringify(changes),
      },
    )
  }

  /** Deactivates a template entry by `channel`/`name` (soft delete, same as the local API). */
  public async remove(channel: Notifiers, name: string): Promise<void> {
    await this.http.delete(`/admin/templates/${channel}/${encodeURIComponent(name)}`)
  }

  /**
   * Triggers a batch code→database sync, pulled from `serviceId`'s own
   * `/.well-known/zanix/code-templates` Discovery snapshot — see
   * `TemplatesAdminService.syncCodeTemplatesFromService`. Usable by `@zanix/admin`'s own internal
   * callers; NOT used by `@zanix/notifications`'s `RemoteTemplateBackend`, which hand-rolls its own
   * POST instead (importing this client from `@zanix/notifications` would be circular, since
   * `@zanix/admin` already depends on `@zanix/notifications` for `ZanixTemplateAttrs`/`Notifiers`).
   */
  public sync(serviceId: string): Promise<SyncCodeTemplatesResult> {
    return this.http.post<SyncCodeTemplatesResult>('/admin/templates/sync', {
      body: JSON.stringify({ serviceId }),
    })
  }
}
