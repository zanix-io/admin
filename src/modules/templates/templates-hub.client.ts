import type {
  CreateTemplateInput,
  Notifiers,
  SyncCodeTemplatesResult,
  UpdateTemplateInput,
  ZanixTemplateAttrs,
} from '@zanix/notifications/templates-types'

import { ADMIN_PROTOCOL_HEADER, RestClient } from '@zanix/server'
import { ADMIN_PROTOCOL_VERSION } from 'utils/constants.ts'

/**
 * Thin HTTP client for `zanix-admin`'s own hub-side `/templates` API — CRUD (see
 * `@zanix/notifications/templates-api`'s `createTemplatesController`) plus this package's own
 * `sync` extension (`createTemplatesSyncController`), both composed by `defineAdminHubApp` under the
 * same prefix — this package owns the wire contract for its own hub routes (the routes and their
 * response shapes, even though the CRUD controller code itself is authored by
 * `@zanix/notifications`), the same reason `TemplatesAdminClient` lives here even though IT calls
 * out to a business service's own admin API. Whoever eventually calls this client (e.g.
 * `@zanix/console`) doesn't change who authors it — the wire-contract owner does.
 *
 * **Hub-facing, not service-facing** — unlike `TemplatesAdminClient` (which calls a business
 * SERVICE's own local `/admin/templates` API directly), this points `baseUrl` at `zanix-admin`'s own
 * hub deployment (`defineAdminHubApp`'s `/templates`), the CENTRAL templates collection itself (see
 * this package's own README, "Templates are centrally deployed through `zanix-admin`'s own hub
 * instance"). Don't confuse the two levels: constructing this with a business service's own
 * `adminBaseUrl` would hit that service's unrelated `/templates` route instead of the hub's.
 *
 * {@link sync} lets a hub operator (or an automated caller) trigger the same batch, upsert-aware
 * code→database pull the LOCAL, business-service-side `/admin/templates/sync`
 * (`metadata.ts`'s own `defineAdminMetadata`) already exposes — directly against the hub, without
 * needing local database access of its own. `serviceId` must already be registered in the hub's own
 * `ServiceRegistry`.
 *
 * Every request declares this client's own {@link ADMIN_PROTOCOL_VERSION} via
 * {@link ADMIN_PROTOCOL_HEADER} automatically — override it in `options.headers` only if you have a
 * specific reason to declare a different version.
 *
 * `name` is always `encodeURIComponent`-escaped before it's interpolated into the request path —
 * `RestClient` builds the final URL by plain string concatenation, so an unescaped `/`, `..`, `?`,
 * or `#` in `name` would otherwise land as extra path segments/query string on the hub's own
 * `/templates` route instead of a single opaque path component.
 *
 * Manages no credentials of its own, same as every other client in this package — `headers` is
 * always caller-supplied; construct with whatever credential the hub's own `AuthTokenValidation`
 * accepts (typically a human admin's `type: 'user'` token, or a machine caller's `type: 'api'` one).
 *
 * @requires @zanix/notifications
 *
 * @example
 * ```ts
 * const client = new TemplatesHubClient({
 *   baseUrl: 'http://admin-hub.internal:9000',
 *   headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
 * })
 * const templates = await client.list()
 * const { seeded, resynced } = await client.sync('billing')
 * ```
 */
export class TemplatesHubClient extends RestClient {
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

  /** Lists every template entry the hub has persisted centrally. */
  public list(): Promise<ZanixTemplateAttrs[]> {
    return this.http.get<ZanixTemplateAttrs[]>('/templates/list')
  }

  /** Gets a single template entry by `channel`/`name`. */
  public get(channel: Notifiers, name: string): Promise<ZanixTemplateAttrs> {
    return this.http.get<ZanixTemplateAttrs>(
      `/templates/${channel}/${encodeURIComponent(name)}`,
    )
  }

  /** Creates a new template entry. */
  public create(input: CreateTemplateInput): Promise<ZanixTemplateAttrs> {
    return this.http.post<ZanixTemplateAttrs>('/templates', {
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
      `/templates/${channel}/${encodeURIComponent(name)}`,
      { body: JSON.stringify(changes) },
    )
  }

  /** Deactivates a template entry by `channel`/`name` (soft delete, same as the local API). */
  public async remove(channel: Notifiers, name: string): Promise<void> {
    await this.http.delete(`/templates/${channel}/${encodeURIComponent(name)}`)
  }

  /**
   * Triggers a batch code→database sync on the hub, pulled from `serviceId`'s own
   * `/.well-known/zanix/templates`/`/.well-known/zanix/code-templates` Discovery snapshot — see
   * `createTemplatesSyncController`/`syncTemplatesFromRegisteredService`'s own docs for the full
   * two-resource preference order and reconciliation rules.
   */
  public sync(serviceId: string): Promise<SyncCodeTemplatesResult> {
    return this.http.post<SyncCodeTemplatesResult>('/templates/sync', {
      body: JSON.stringify({ serviceId }),
    })
  }
}
