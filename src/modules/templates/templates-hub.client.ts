import type {
  CreateTemplateInput,
  Notifiers,
  UpdateTemplateInput,
  ZanixTemplateAttrs,
} from '@zanix/notifications'

import { ADMIN_PROTOCOL_HEADER, RestClient } from '@zanix/server'
import { ADMIN_PROTOCOL_VERSION } from 'utils/constants.ts'

/**
 * Thin HTTP client for `zanix-admin`'s own hub-side `/templates` CRUD API (see
 * `@zanix/notifications/templates-api`'s `createTemplatesController`, composed by
 * `defineAdminHubApp`) — this package owns the wire contract for its own hub routes (the routes and
 * their response shapes, even though the CRUD controller code itself is authored by
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
 * **CRUD only — deliberately no `sync()`.** `POST /templates/sync` (`createTemplatesSyncController`)
 * is composed only on the LOCAL, business-service-side `/admin/templates` prefix (`metadata.ts`'s
 * own `defineAdminMetadata`), not on this hub-side `/templates` prefix (`defineAdminHubApp` only
 * ever wires `createTemplatesController`, the CRUD half, for the hub) — confirmed by reading both
 * composition sites directly, not assumed. Adding a `sync()` method here would call a hub route that
 * doesn't exist today; if a future change wires `POST /templates/sync` onto the hub too, this class
 * gains the matching method then, not before.
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
}
