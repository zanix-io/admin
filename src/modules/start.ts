import type { BootstrapServerOptions, ServerID } from '@zanix/server'

import {
  bootstrapServers,
  DEFAULT_APPLICATION,
  guardSingleAdminRegistration,
  ProgramModule,
  releaseAdminRegistration,
  resolveAdminServerId,
  resolvePreviousAdminServerId,
  webServerManager,
} from '@zanix/server'

import logger from '@zanix/logger'
import { ADMIN_APPLICATION } from '../utils/constants.ts'
import type { TemplatesControllerOptions } from './templates/templates.handler.ts'
import type { TriggersControllerOptions } from './triggers/triggers.handler.ts'
import { checkServiceRegistryReachability } from './registry/reachability.ts'

let servers: ServerID[] = []

// Kept alive deliberately: a class produced by a factory and only ever referenced by a `Promise`'s
// resolved value has no other strong reference once that `Promise` is discarded —
// `@zanix/server`'s target registry resolves instances via a `WeakMap` keyed by class reference, so
// a garbage-collected class can silently stop dispatching. Costs nothing to just hold onto them.
const registeredControllers: unknown[] = []

/**
 * Registers `zanix-admin`'s own building blocks — side-effect imports/factory calls only, run once
 * per process, inside {@link start} rather than at this module's top level, so merely importing
 * `@zanix/admin` (e.g. for its types) never triggers connector registration or env var reads on its
 * own:
 *
 * - `@zanix/datamaster/core` / `@zanix/auth/core` / `@zanix/notifications/core` — the same
 *   zero-config connector/provider wiring any `@zanix/core`-based service gets from
 *   `Zanix.bootstrap()`: the Mongo connector the templates controller needs (via
 *   `TemplatesAdminRepository`), the session/auth infra `AuthTokenValidation`/`rateLimitGuard`
 *   need, and the `TemplateProvider` + templates model `TemplatesAdminService` reads through.
 * - `createTriggersController(triggers)` / `createTemplatesController(templates)` — building (and
 *   thereby registering, via their `@Controller` decorator) each route, wrapped in
 *   `ProgramModule.defineApplication(...)` so it's attributed to {@link ADMIN_APPLICATION} by
 *   default, or {@link DEFAULT_APPLICATION} (see `docs/HANDLERS.md`'s "Applications" section) when
 *   its own `application` option says so; `false` skips that controller entirely.
 *   `bootstrapServers` below only ever serves what's registered here.
 */
async function defineAdminMetadata(
  triggers: false | (TriggersControllerOptions & { application?: AdminStartApplication }),
  templates: false | (TemplatesControllerOptions & { application?: AdminStartApplication }),
): Promise<void> {
  const imports: Promise<unknown>[] = [
    import('@zanix/datamaster/core'),
    import('@zanix/auth/core'),
    import('@zanix/notifications/core'),
  ]

  if (triggers !== false) {
    const { application = ADMIN_APPLICATION, ...options } = triggers
    imports.push(
      import('./triggers/triggers.handler.ts').then(async ({ createTriggersController }) => {
        let controller: unknown
        await ProgramModule.defineApplication(application, () => {
          controller = createTriggersController(options)
        })
        return controller
      }),
    )
  }
  if (templates !== false) {
    const { application = ADMIN_APPLICATION, ...options } = templates
    imports.push(
      import('./templates/templates.handler.ts').then(async ({ createTemplatesController }) => {
        let controller: unknown
        await ProgramModule.defineApplication(application, () => {
          controller = createTemplatesController(options)
        })
        return controller
      }),
    )
  }

  registeredControllers.push(...(await Promise.all(imports)))
}

/**
 * The only two Applications {@link start} itself can ever actually serve — it bootstraps exactly
 * two servers, one per Application (see its own doc), never an arbitrary third one. Unlike
 * `BootstrapServerOptions[type].application` (any Application name, since that's forwarded as-is
 * to `bootstrapServers`), `triggers`/`templates`'s own `application` is restricted to this literal
 * union on purpose — accepting any string here would silently register a capability under an
 * Application {@link start} never activates a Runtime for, since it only ever calls
 * `bootstrapServers` for these two.
 */
export type AdminStartApplication = typeof DEFAULT_APPLICATION | typeof ADMIN_APPLICATION

/** Options accepted by {@link start}, alongside whatever `@zanix/server`'s `bootstrapServers` takes. */
export type StartOptions = BootstrapServerOptions & {
  /**
   * Options for the triggers route, or `false` to skip registering it entirely. `application:
   * 'main'` mounts it on the default Application's own public, unprefixed server instead of
   * {@link ADMIN_APPLICATION}'s own server (the default choice — anchored, id-prefixed, whenever
   * `ADMIN_SERVER_ID` is set) — see {@link start}'s own doc.
   */
  triggers?: false | (TriggersControllerOptions & { application?: AdminStartApplication })
  /**
   * Options for the templates route, or `false` to skip registering it entirely. `application:
   * 'main'` mounts it on the default Application's own public, unprefixed server instead of
   * {@link ADMIN_APPLICATION}'s own server (the default choice — anchored, id-prefixed, whenever
   * `ADMIN_SERVER_ID` is set) — see {@link start}'s own doc.
   */
  templates?: false | (TemplatesControllerOptions & { application?: AdminStartApplication })
  /**
   * Opt-in, fire-and-forget reachability check against every entry in the installed
   * `ServiceRegistry` (see {@link checkServiceRegistryReachability}) — catches a stale/typo'd
   * `adminBaseUrl` at startup instead of at first real use (`TriggersAggregator`'s calls have no
   * try/catch around their own network hop). Disabled by default. Never blocks or fails `start()`
   * itself — a temporarily-down peer only ever logs a warning, since every per-entry failure is
   * caught internally.
   */
  validateRegistry?: boolean
}

/**
 * Reference deployable entrypoint for `zanix-admin` — a thin, ready-to-run bootstrap over the
 * triggers/templates controllers, for a team that wants to stand up an instance without wiring the
 * registration/bootstrap sequence by hand (see the README's "Basic Usage" for the equivalent manual
 * wiring). Not required: any app importing `@zanix/admin`'s `createTriggersController`/
 * `createTemplatesController` directly and bootstrapping them through its own `@zanix/server`/
 * `@zanix/core` setup works just as well — this is a convenience, not the only supported path.
 *
 * **Never call this in the same process as `Zanix.start()` with its own `admin` option enabled**
 * — both independently call `bootstrapServers()` against the same process-global metadata
 * registry, and running both corrupts it (one's cleanup can wipe routes/resolvers the other
 * registered before they're ever served). A runtime guard (`guardSingleAdminRegistration`)
 * throws if you do; use one or the other per process.
 *
 * Both controllers default to {@link ADMIN_APPLICATION} (see `docs/HANDLERS.md`'s "Applications"
 * section), so by default only that one server starts — anchored (id-prefixed) whenever
 * `ADMIN_SERVER_ID` is set, a plain unprefixed server otherwise (there is no auto-generated
 * anchored id). A "public" REST server (the default Application, always unprefixed) only gets
 * bootstrapped when `triggers`/`templates` is explicitly configured with `application: 'main'` —
 * see the `wantsPublicRoute` check in the implementation for why this isn't attempted
 * unconditionally.
 *
 * Only ever starts REST servers (the triggers/templates routes are REST-only) — a `graphql`/
 * `socket` entry in `options` is accepted (forwarded as-is to `bootstrapServers`) but has nothing
 * of this package's own to serve.
 *
 * @param options - `triggers`/`templates` configure (or, as `false`, skip) each built-in
 * controller; everything else is forwarded as-is to `@zanix/server`'s `bootstrapServers` (port,
 * cors, gzip, `onCreate`, etc. — see its own docs for the full shape).
 * @returns The `ServerID`s of whatever servers were actually started.
 */
export const start = async (
  options: StartOptions = {},
): Promise<ServerID[]> => {
  guardSingleAdminRegistration('admin')

  const { triggers = {}, templates = {}, validateRegistry = false, ...serverOptions } = options

  await defineAdminMetadata(triggers, templates)

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

  // `id`/`previousId` mirror `@zanix/core`'s own `start.ts` — both resolve them from the same
  // `ADMIN_SERVER_ID`/`ADMIN_SERVER_ID_PREVIOUS` env vars via the same shared helpers, so a caller
  // of either gets the same behavior (previously only `@zanix/core`'s did; this one got a fresh
  // random id every restart). Leaving `ADMIN_SERVER_ID` unset gives a plain, unprefixed admin
  // server — there is no auto-generated anchored id.
  const adminId = serverOptions.rest?.id ?? resolveAdminServerId('rest')
  const adminServers = await bootstrapServers({
    ...serverOptions,
    rest: {
      ...serverOptions.rest,
      id: adminId,
      previousId: serverOptions.rest?.previousId ?? resolvePreviousAdminServerId('rest'),
      application: ADMIN_APPLICATION,
      // Unanchored (no `adminId`), this server would otherwise fall back to `bootstrapServers`'s
      // own generic `'api'` default — the SAME default a "public" server (`wantsPublicRoute`
      // above) uses. Sharing a port with no `ADMIN_SERVER_ID` set would then silently collide:
      // the second `create()` call's handler would clobber the first's at the same dispatch key.
      // Giving this server its own distinct default prefix keeps it safe to share a port with a
      // public server even without opting into anchoring — only applied when unanchored; an
      // anchored server's own id is already enough to avoid the collision, and an explicit caller
      // `globalPrefix` (if any) always wins regardless.
      globalPrefix: serverOptions.rest?.globalPrefix ?? (adminId ? undefined : 'admin'),
    },
  })

  servers = [...publicServers, ...adminServers]

  if (!servers.length) {
    logger.warn(
      "No server was started — no route was registered (unexpected for this package's own " +
        'built-in controllers; check that @zanix/admin was imported correctly).',
      'noSave',
    )
  }

  // Fire-and-forget, after every server is already listening — a temporarily-down registered peer
  // must never fail or delay this bootstrap; every per-entry failure is already caught internally.
  if (validateRegistry) checkServiceRegistryReachability()

  return servers
}

/** Stops every server {@link start} started. */
export const stop = async (): Promise<void> => {
  await webServerManager.stop(servers)
  releaseAdminRegistration('admin')
}
