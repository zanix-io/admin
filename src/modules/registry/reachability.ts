import type { ServiceRegistry } from './registry.ts'

import { RestClient } from '@zanix/server'
import { HttpError } from '@zanix/errors'
import logger from '@zanix/logger'
import { getServiceRegistry } from './registry.ts'

/** One entry's classified reachability result — see {@link checkServiceRegistryReachability}. */
export type ReachabilityResult = {
  serviceId: string
  adminBaseUrl: string
  /**
   * `'ok'` — a live, correctly-anchored admin server answered (a 4xx from the intentionally-invalid
   * probe assertion, exactly as `/admin/service-token` is designed to). `'unreachable'` — a network
   * error or timeout; nothing answered at all. `'misconfigured'` — something answered, but not this
   * route (a 404) — a stale entry, wrong prefix, or wrong port. `'unexpected'` — any other response.
   */
  status: 'ok' | 'unreachable' | 'misconfigured' | 'unexpected'
  /** The real HTTP status code received, when one was — absent for `'unreachable'`. */
  httpStatus?: number
}

/**
 * Extracts the real HTTP status code a failed `RestClient` call actually received — `RestClient`
 * always throws `HttpError('BAD_REQUEST')` on any non-2xx response, so the real code only survives
 * in `error.cause.message`'s `"[HTTP <code>] <statusText>"` prefix. Exported (not just used here)
 * so `templates-sync.ts`'s own fallback logic can reuse it instead of a third hand-rolled copy —
 * `@zanix/notifications`'s `RemoteTemplateBackend` has an independent, package-local copy of this
 * same helper for the same reason, on the other side of the same exchange.
 */
export function realHttpStatus(error: unknown): number | undefined {
  if (!(error instanceof HttpError) || !(error.cause instanceof Error)) return undefined
  const match = error.cause.message.match(/^\[HTTP (\d+)\]/)
  return match ? Number(match[1]) : undefined
}

/**
 * Probes every entry in a {@link ServiceRegistry} to catch a stale/typo'd `adminBaseUrl` at deploy
 * time rather than at first real use — today, `TriggersAggregator`/`syncTemplatesFromRegisteredService`
 * have no try/catch around their own network hop, so a misconfigured entry surfaces as an uncaught
 * production error the first time something actually tries to use it.
 *
 * Reuses the existing, deliberately-safe `POST /admin/service-token` route (see
 * `createServiceExchangeController`'s own doc: "trust is established entirely by
 * `exchangeServiceCredential`'s own verification" — an intentionally-invalid assertion is
 * guaranteed a clean, typed 4xx, never a partial success or a mutation) — no new auth/guard concept
 * is introduced, and this never returns/infers a url/id the caller didn't already configure itself.
 *
 * Every per-entry failure is caught internally (`Promise.allSettled`) — this function itself can
 * never throw or hang its caller, and is safe to call fire-and-forget.
 *
 * @param options.registry Defaults to the installed {@link getServiceRegistry} instance.
 * @param options.timeoutMs Per-entry probe timeout, in milliseconds. Defaults to `3000`.
 * @returns One {@link ReachabilityResult} per registered entry, in `registry.list()`'s own order.
 */
export async function checkServiceRegistryReachability(
  options: { registry?: ServiceRegistry; timeoutMs?: number } = {},
): Promise<ReachabilityResult[]> {
  const { registry = getServiceRegistry(), timeoutMs = 3000 } = options

  // Every branch below returns a normal `ReachabilityResult` — this never rejects, so a plain
  // `Promise.all` (not `allSettled`) is enough; every per-entry failure is already caught here.
  const classified = await Promise.all(
    registry.list().map(async (entry): Promise<ReachabilityResult> => {
      const client = new RestClient({ baseUrl: entry.adminBaseUrl })
      try {
        await client.http.post('/admin/service-token', {
          body: JSON.stringify({ assertion: 'reachability-probe' }),
          signal: AbortSignal.timeout(timeoutMs),
        })
        // A 2xx here would mean the intentionally-invalid probe assertion was accepted — treated
        // the same as any other unexpected response, since it should never actually happen.
        return {
          serviceId: entry.serviceId,
          adminBaseUrl: entry.adminBaseUrl,
          status: 'unexpected',
        }
      } catch (error) {
        const httpStatus = realHttpStatus(error)
        if (httpStatus === 404) {
          return {
            serviceId: entry.serviceId,
            adminBaseUrl: entry.adminBaseUrl,
            status: 'misconfigured',
            httpStatus,
          }
        }
        if (httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500) {
          return {
            serviceId: entry.serviceId,
            adminBaseUrl: entry.adminBaseUrl,
            status: 'ok',
            httpStatus,
          }
        }
        return {
          serviceId: entry.serviceId,
          adminBaseUrl: entry.adminBaseUrl,
          status: httpStatus === undefined ? 'unreachable' : 'unexpected',
          httpStatus,
        }
      }
    }),
  )

  for (const result of classified) {
    if (result.status !== 'ok') {
      logger.warn(
        `ServiceRegistry entry "${result.serviceId}" (${result.adminBaseUrl}) is ${result.status}` +
          (result.httpStatus ? ` (HTTP ${result.httpStatus})` : '') + '.',
        'noSave',
      )
    }
  }

  return classified
}
