import type { BootstrapServerOptions, ServerID } from '@zanix/server'
import type { ServiceAuthClientOptions } from '@zanix/auth'
import type { ActivatedApps } from '@zanix/app/runtime'

import {
  bootstrapServers,
  closeAllConnections,
  createStartLifecycleGuard,
  DEFAULT_APPLICATION,
  ProgramModule,
  resolveApplicationServerId,
  resolvePreviousApplicationServerId,
  webServerManager,
} from '@zanix/server'
import { activateApps, bootstrapAppServer, deactivateApps } from '@zanix/app/runtime'

import logger from '@zanix/logger'
import { ADMIN_HUB_APPLICATION } from '../utils/constants.ts'
import type { TemplatesControllerOptions } from './templates/templates.handler.ts'
import type { TriggersControllerOptions } from './triggers/triggers.handler.ts'
import { checkServiceRegistryReachability } from './registry/reachability.ts'
import { defineAdminHubApp, getAdminHubSubApps } from './admin-hub-app.ts'
import type { AdminStartApplication } from './admin-hub-app.ts'

export type { AdminStartApplication } from './admin-hub-app.ts'

let servers: ServerID[] = []
let activated: ActivatedApps | undefined

/**
 * The signal-triggered shutdown wrapper registered by the most recently successful `start()` call —
 * same pattern `@zanix/core`'s own `start.ts` established (a fresh closure per call, `stop()` itself
 * removes the listeners rather than the wrapper removing itself, since `stop()` is also called
 * directly by app code/tests, not just from here). This package's own reason for needing it
 * independently of `@zanix/core`: {@link start} is a real, standalone deployable entrypoint in its
 * own right (see its own doc's "Reference deployable entrypoint" — a team can run `ZanixAdminHub` as
 * its own process, never going through `Zanix.start()` at all), so it must trap `SIGINT`/`SIGTERM`
 * on its own rather than relying on a caller that may not exist. `undefined` once removed (or before
 * the first successful `start()`) — `stop()` only calls `Deno.removeSignalListener` when this is
 * set, so calling `stop()` twice in a row is a safe no-op on this front, matching `markStopped()`'s
 * own idempotency. `createStartLifecycleGuard`'s own reentry guarantee (at most one `start()`
 * "running" per process without an intervening `stop()`) is what keeps registering/removing this
 * safe to repeat across many start/stop cycles in the same process without ever leaking a listener.
 */
let signalShutdown: (() => Promise<void>) | undefined

/**
 * Guards against overlapping/repeated `start()` calls — see `@zanix/server`'s
 * `createStartLifecycleGuard` for the exact races this covers and why. No `overlapNote`: unlike
 * `@zanix/core`'s own `start.ts`, this package has no `admin`-shaped option whose loss under a race
 * is worth calling out specifically.
 */
const lifecycleGuard = createStartLifecycleGuard({
  startLabel: 'ZanixAdminHub.start()',
  stopLabel: 'ZanixAdminHub.stop()',
  source: 'zanix-admin',
})

/** Options accepted by {@link start}, alongside whatever `@zanix/server`'s `bootstrapServers` takes. */
export type StartOptions = BootstrapServerOptions & {
  /**
   * Options for the triggers route, or `false` to skip registering it entirely. `application:
   * 'main'` mounts it on the default Application's own public, unprefixed server instead of
   * {@link ADMIN_HUB_APPLICATION}'s own server (the default choice — anchored, id-prefixed, whenever
   * `ADMIN_HUB_SERVER_ID` is set) — see {@link start}'s own doc.
   */
  triggers?:
    | false
    | (TriggersControllerOptions & { application?: AdminStartApplication })
  /**
   * Options for the templates route, or `false` to skip registering it entirely. `application:
   * 'main'` mounts it on the default Application's own public, unprefixed server instead of
   * {@link ADMIN_HUB_APPLICATION}'s own server (the default choice — anchored, id-prefixed, whenever
   * `ADMIN_HUB_SERVER_ID` is set) — see {@link start}'s own doc.
   */
  templates?:
    | false
    | (TemplatesControllerOptions & { application?: AdminStartApplication })
  /**
   * Opt-in, fire-and-forget reachability check against every entry in the installed
   * `ServiceRegistry` (see {@link checkServiceRegistryReachability}) — catches a stale/typo'd
   * `adminBaseUrl` at startup instead of at first real use (`TriggersAggregator`'s calls have no
   * try/catch around their own network hop). Disabled by default. Never blocks or fails `start()`
   * itself — a temporarily-down peer only ever logs a warning, since every per-entry failure is
   * caught internally.
   */
  validateRegistry?: boolean
  /**
   * This hub's own identity for authenticating OUTBOUND to every registered service — when given,
   * `start()` installs a `TriggersAggregator`/`TemplatesDiscoveryClientFactory` that sign+exchange+
   * cache a real credential per target (via `@zanix/auth`'s `createServiceAuthClient`, adapted for
   * `ServiceRegistryEntry` by `createServiceRegistryAuthHeaders`) instead of the unauthenticated
   * default, which only works against a target that doesn't actually require one.
   *
   * This is the common-case shortcut — equivalent to calling `setTriggersAggregator`/
   * `setTemplatesDiscoveryClientFactory` yourself with `createServiceRegistryAuthHeaders`. Skip
   * this option and call those directly instead for a custom `ServiceRegistry`, partial-failure
   * tolerance, or different credentials for CRUD vs. Discovery reads — this option and a manual
   * `setTriggersAggregator` call are mutually exclusive: whichever runs LAST before the first real
   * `TriggersController`/`TemplatesController` request wins, so don't do both.
   */
  auth?: ServiceAuthClientOptions
}

/**
 * Reference deployable entrypoint for `zanix-admin` — a thin, ready-to-run bootstrap over the
 * triggers/templates controllers, for a team that wants to stand up an instance without wiring the
 * registration/bootstrap sequence by hand (see the README's "Basic Usage" for the equivalent manual
 * wiring). Not required: any app importing `@zanix/admin`'s `createTriggersController`/
 * `createTemplatesController` directly and bootstrapping them through its own `@zanix/server`/
 * `@zanix/core` setup works just as well — this is a convenience, not the only supported path.
 *
 * **Safe to run in the same process as `Zanix.start()` with its own `admin` option enabled** — this
 * package's two route sets are independent: `Zanix.start({ admin: true })` composes a business
 * service's own LOCAL admin CRUD (`/admin/triggers`, `/admin/templates`, `/admin/service-token`)
 * under `ADMIN_APPLICATION` (`../utils/constants.ts`), while this function composes its own central aggregator/proxy
 * (`/triggers`, `/templates`) under {@link ADMIN_HUB_APPLICATION} — two distinct Applications, so
 * neither's routes leak onto the other's server. `@zanix/server`'s boot-session isolation (see
 * `bootstrapServers`' own doc) further ensures that even firing both calls without an `await`
 * between them — e.g. `Zanix.start(opts); ZanixAdminHub.start(otherOpts)`, letting them register and
 * boot concurrently — can never wipe one sequence's not-yet-served routes out from under the other.
 * If both are anchored (`ADMIN_SERVER_ID` and `ADMIN_HUB_SERVER_ID` both set), each gets its own
 * stable prefix, so they can even share one port.
 *
 * Both controllers default to {@link ADMIN_HUB_APPLICATION} (see `docs/APPLICATIONS.md`), so by
 * default only that one server starts — anchored (id-prefixed) whenever
 * `ADMIN_HUB_SERVER_ID` is set, a plain unprefixed server otherwise (there is no auto-generated
 * anchored id). A "public" REST server (the default Application, always unprefixed) only gets
 * bootstrapped when `triggers`/`templates` is explicitly configured with `application: 'main'` —
 * see the `wantsPublicRoute` check in the implementation for why this isn't attempted
 * unconditionally.
 *
 * Only ever starts REST servers (the triggers/templates routes are REST-only) — a `graphql`/
 * `socket` entry in `options` is accepted (forwarded as-is to `bootstrapServers`) but has nothing
 * of this package's own to serve.
 *
 * A successful `start()` also traps `SIGINT`/`SIGTERM` automatically (no opt-out) — either signal
 * runs {@link stop} (draining HTTP requests via `Deno.serve()`'s own `.shutdown()`, then closing
 * connector connections), then exits cleanly. **Deliberately does NOT force the process down if
 * {@link stop} itself fails** — unlike `@zanix/core`'s own `Zanix.start()`, which owns the whole
 * process it runs in, this package is frequently just one participant sharing a process with an
 * unrelated, genuinely independent entrypoint (e.g. a business service's own `Zanix.start()` — see
 * `signalShutdown`'s own doc for why the two share no state). A `stop()` failure here logs the error
 * and leaves the process running rather than calling `Deno.exit()`, so this package's own cleanup
 * trouble can never take an otherwise-healthy co-located service down with it — an orchestrator's own
 * SIGKILL-after-grace-period is the correct backstop for a shutdown that didn't complete cleanly, not
 * this handler forcing it.
 *
 * @param options - `triggers`/`templates` configure (or, as `false`, skip) each built-in
 * controller; everything else is forwarded as-is to `@zanix/server`'s `bootstrapServers` (port,
 * cors, gzip, `onCreate`, etc. — see its own docs for the full shape).
 * @returns The `ServerID`s of whatever servers were actually started.
 */
export const start = async (
  options: StartOptions = {},
): Promise<ServerID[]> => {
  lifecycleGuard.guardReentry()

  try {
    // The whole sequence below (composition + every `bootstrapServers()` call) runs under one
    // shared boot session (see `@zanix/server`'s `BootSessionContainer`) — so this call's own last
    // `bootstrapServers()` finalize preserves whichever Applications an independent,
    // concurrently-running sequence (e.g. `Zanix.start()` fired without an `await` in between)
    // currently owns, never wiping its not-yet-served routes.
    servers = await ProgramModule.runBootSession(() => startSequence(options))

    if (!servers.length) {
      logger.warn(
        "No server was started — no route was registered (unexpected for this package's own " +
          'built-in controllers; check that @zanix/admin was imported correctly).',
        'noSave',
      )
    }

    lifecycleGuard.markRunning()

    // See `signalShutdown`'s own doc for why this package traps its own signals rather than relying
    // on a caller (e.g. `@zanix/core`'s `Zanix.start()`) that may not be present at all.
    signalShutdown = async () => {
      logger.info(
        'Shutdown signal received, stopping ZanixAdminHub servers...',
        'noSave',
      )
      try {
        await stop()
        Deno.exit(0)
      } catch (error) {
        // Deliberately does NOT call `Deno.exit()` here — see `start()`'s own doc for why. This
        // package is frequently one of several independent participants sharing a process (e.g.
        // alongside `@zanix/core`'s own `Zanix.start()`, which has no knowledge of this failure and
        // must be free to keep running/exit on its own terms); a `stop()` failure scoped to THIS
        // package's own cleanup must never escalate into killing the whole process out from under
        // an unrelated, possibly still-healthy service. `stop()`'s own nested `try/finally` still
        // guarantees every server this package started gets torn down regardless of this error.
        logger.error(
          'ZanixAdminHub.stop() failed during signal-triggered shutdown — the process was left ' +
            "running (see start()'s own doc); an orchestrator's own SIGKILL-after-grace-period is " +
            'the expected backstop here',
          error,
        )
      }
    }
    Deno.addSignalListener('SIGINT', signalShutdown)
    Deno.addSignalListener('SIGTERM', signalShutdown)

    return servers
  } finally {
    lifecycleGuard.clearStarting()
  }
}

async function startSequence(options: StartOptions): Promise<ServerID[]> {
  const {
    triggers = {},
    templates = {},
    validateRegistry = false,
    auth,
    ...serverOptions
  } = options

  // Composition (registering controllers under their own Application, resolving/installing the
  // `'service-registry'` resource, wiring `auth` if given) — see `defineAdminHubApp`'s own doc.
  // `getAdminHubSubApps()` (Triggers/Templates' own physically-separate operations/mcp sub-apps —
  // see `admin-hub-app.ts`'s own doc) activates alongside it in the SAME call, so a future sub-app
  // sharing a root resource with `defineAdminHubApp` still resolves to the same instance.
  // `activateApps` runs `onStart` too, but none of these apps declare one.
  const hubSubApps = getAdminHubSubApps()
  activated = await activateApps([
    defineAdminHubApp({ triggers, templates, auth }),
    ...hubSubApps,
  ])

  // Only attempt the "public" bootstrap when the caller explicitly opted `triggers`/`templates`
  // out of the admin-Application/anchored default — the only way this package could ever have a
  // legitimate public route of its own. Previously this ran unconditionally (with `finalize: false`, as
  // defense-in-depth) on the theory that it would normally find nothing to serve — but
  // `bootstrapServers`'s own route-scope check matches ANY public route currently in the shared,
  // process-global registry, regardless of which package registered it. If this ever ran in the
  // same process as another orchestrator that also contributes public routes (e.g. an app
  // mistakenly calling this alongside its own `@zanix/core` `Zanix.start()`, unawaited — see this
  // module's own doc comment: that combination isn't the intended usage), it could accidentally
  // start serving that foreign public route itself, and — not being the sequence's last call —
  // never purge the registry afterward either, so the route could get served twice. Skipping the
  // call entirely by default removes that risk outright rather than merely mitigating it.
  const wantsPublicRoute = (triggers !== false && triggers.application === DEFAULT_APPLICATION) ||
    (templates !== false && templates.application === DEFAULT_APPLICATION)

  const publicServers = wantsPublicRoute
    ? await bootstrapServers(serverOptions, { finalize: false })
    : []

  // `id`/`previousId` mirror `@zanix/core`'s own `start.ts` — both resolve them from an
  // env var via the same shared helper, so a caller of either gets the same behavior (previously
  // only `@zanix/core`'s did; this one got a fresh random id every restart). Uses its own
  // `ADMIN_HUB_SERVER_ID`/`ADMIN_HUB_SERVER_ID_PREVIOUS` env vars, distinct from the embedded local
  // admin's `ADMIN_SERVER_ID` (see `ADMIN_HUB_APPLICATION`'s own doc) — so both can be anchored at
  // once without colliding on the same prefix if they ever share a port. Leaving it unset gives a
  // plain, unprefixed admin server — there is no auto-generated anchored id.
  const adminId = serverOptions.rest?.id ??
    resolveApplicationServerId(ADMIN_HUB_APPLICATION, 'rest')
  const adminRest = {
    ...serverOptions.rest,
    id: adminId,
    previousId: serverOptions.rest?.previousId ??
      resolvePreviousApplicationServerId(ADMIN_HUB_APPLICATION, 'rest'),
    // Unanchored (no `adminId`), this server would otherwise fall back to `bootstrapServers`'s
    // own generic `'api'` default — the SAME default a "public" server (`wantsPublicRoute`
    // above) uses. Sharing a port with no `ADMIN_HUB_SERVER_ID` set would then silently collide:
    // the second `create()` call's handler would clobber the first's at the same dispatch key.
    // Giving this server its own distinct default prefix keeps it safe to share a port with a
    // public server even without opting into anchoring — only applied when unanchored; an
    // anchored server's own id is already enough to avoid the collision, and an explicit caller
    // `globalPrefix` (if any) always wins regardless.
    globalPrefix: serverOptions.rest?.globalPrefix ??
      (adminId ? undefined : 'admin-hub'),
  }

  // Not the last bootstrap call anymore whenever `hubSubApps` is non-empty (see below) — never
  // purges route metadata other Applications in this same boot session still need.
  const adminServers = await bootstrapAppServer(
    ADMIN_HUB_APPLICATION,
    { ...serverOptions, rest: adminRest },
    hubSubApps.length === 0,
  )

  // Serves each hub sub-app's own auto-registered `/__zanix-ops/<name>/...` operations-dispatch
  // route (see `registerRemoteDispatchRoutes`) — without this, a sub-app's `operations` would be
  // reachable via same-process `ctx.remote()` (zero-network, no server needed) but NOT over real
  // HTTP from another process, defeating the whole point of giving it its own addressable app
  // identity.
  //
  // Deliberately does NOT reuse `adminRest`'s own `id`/`globalPrefix` — `WebServerManager`'s per-
  // port dispatch table is keyed by `dispatchKey` (the anchored `serverID` when anchored, the raw
  // `globalPrefix` otherwise — see `compileRuntime`'s own doc), which is NEVER derived from the
  // Application name itself. Two Applications sharing the exact same `id`/`globalPrefix` combo
  // don't merge their routes under that key — the LATER `create()` call's handler (bound to ONE
  // Application) silently replaces the earlier one's, clobbering it entirely (a real bug this
  // fixes: it previously made `ADMIN_HUB_APPLICATION`'s own `/triggers`/`/templates` controllers
  // unreachable whenever they shared a dispatch key with a sub-app registered after them). Each
  // sub-app instead resolves its OWN independent `id` (`resolveApplicationServerId(subAppName,
  // 'rest')`, almost always unset in practice) and falls back to its OWN name as `globalPrefix`
  // when unanchored — a distinct dispatch key from the hub's own and from every other sub-app's,
  // safe to share the same port with regardless of how the hub itself is configured.
  const subAppServers: ServerID[] = []
  for (const [index, { definition }] of hubSubApps.entries()) {
    const subId = resolveApplicationServerId(definition.name, 'rest')
    // deno-lint-ignore no-await-in-loop
    const started = await bootstrapAppServer(
      definition.name,
      {
        ...serverOptions,
        rest: {
          ...serverOptions.rest,
          id: subId,
          previousId: resolvePreviousApplicationServerId(
            definition.name,
            'rest',
          ),
          globalPrefix: subId ? undefined : definition.name,
        },
      },
      index === hubSubApps.length - 1,
    )
    subAppServers.push(...started)
  }

  // Fire-and-forget, after every server is already listening — a temporarily-down registered peer
  // must never fail or delay this bootstrap; every per-entry failure is already caught internally.
  if (validateRegistry) checkServiceRegistryReachability()

  return [...publicServers, ...adminServers, ...subAppServers]
}

/**
 * Also called automatically on `SIGINT`/`SIGTERM` (see {@link start}'s own doc) — the very first
 * thing this does is remove those signal listeners, if `start()` registered any, so a second signal
 * (or a second, direct `stop()` call) never re-triggers this teardown.
 *
 * Runs this app's own `onStop` (none declared today) and closes its resolved resources (the
 * `'service-registry'` instance — a no-op `close()`, see `./registry/resource-type.ts`), then stops
 * every server {@link start} started — same ordering `Zanix.stop()`/`ZanixAppDefinition.serve()`'s
 * own `stop()` already guarantee elsewhere in this ecosystem. `closeAllConnections()` closes last,
 * only after the HTTP servers themselves have finished draining in-flight requests — this package
 * never creates connectors of its own, but the process it runs in may (e.g. a service sharing this
 * process also uses `@zanix/datamaster`/`@zanix/auth`), and `ProgramModule`'s connector registry is
 * process-wide, not scoped per app — same reasoning `@zanix/core`'s own `stop()` already applies.
 */
export const stop = async (): Promise<void> => {
  if (signalShutdown) {
    Deno.removeSignalListener('SIGINT', signalShutdown)
    Deno.removeSignalListener('SIGTERM', signalShutdown)
    signalShutdown = undefined
  }

  lifecycleGuard.markStopped()
  try {
    if (activated) await deactivateApps(activated)
  } finally {
    try {
      await webServerManager.stop(servers)
    } finally {
      await closeAllConnections()
    }
  }
}
