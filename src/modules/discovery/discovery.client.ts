import { DISCOVERY_PROTOCOL_HEADER, DISCOVERY_PROTOCOL_VERSION, RestClient } from '@zanix/server'

/** The envelope shape every `/.well-known/zanix/{resourceType}` endpoint responds with. */
interface DiscoveryEnvelope<T> {
  resourceType: string
  generatedAt: string
  items: T[]
}

/**
 * Thin HTTP client for a registered service's own `/.well-known/zanix/{resourceType}` Discovery
 * endpoint — see `@zanix/server`'s `docs/HANDLERS.md`'s "Discovery" section. Used to fetch a
 * read-only snapshot from a service this package doesn't own the data for (`TriggersAggregator`'s
 * `list()`, and `TemplatesAdminService`'s `syncCodeTemplatesFromService`), rather than proxying
 * through that service's authenticated CRUD API for a plain read.
 *
 * Every request declares {@link DISCOVERY_PROTOCOL_VERSION} via {@link DISCOVERY_PROTOCOL_HEADER}
 * automatically — override it in `options.headers` only if you have a specific reason to declare a
 * different version. Construct one per target service, pointing `baseUrl` at that service's own
 * admin address and `headers` at whatever credential its Discovery guard accepts (typically the
 * same one its CRUD API already requires).
 *
 * @example
 * ```ts
 * const client = new DiscoveryAdminClient({
 *   baseUrl: 'http://billing.internal:30248/billing-rest',
 *   headers: { 'X-Znx-Authorization': `Bearer ${accessToken}` },
 * })
 * const triggers = await client.snapshot('triggers')
 * ```
 */
export class DiscoveryAdminClient extends RestClient {
  /** Creates the client, stamping every request with {@link DISCOVERY_PROTOCOL_VERSION}. */
  constructor(
    { headers, ...options }: NonNullable<ConstructorParameters<typeof RestClient>[0]> = {},
  ) {
    super({
      ...options,
      headers: { [DISCOVERY_PROTOCOL_HEADER]: String(DISCOVERY_PROTOCOL_VERSION), ...headers },
    })
  }

  /** Fetches the current snapshot for `resourceType`, unwrapped from its envelope. */
  public async snapshot<T>(resourceType: string): Promise<T[]> {
    const envelope = await this.http.get<DiscoveryEnvelope<T>>(`.well-known/zanix/${resourceType}`)
    return envelope.items
  }
}
