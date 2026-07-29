import type { BootstrapServerOptions, ServerID } from '@zanix/server'

import { bootstrapServers, webServerManager } from '@zanix/server'
import logger from '@zanix/logger'
import type { TemplatesControllerOptions } from './templates/templates.handler.ts'
import type { TriggersControllerOptions } from './triggers/triggers.handler.ts'

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
 *   thereby registering, via their `@Controller` decorator) each route; `false` skips that
 *   controller entirely. `bootstrapServers` below only ever serves what's registered here.
 */
async function defineAdminMetadata(
  triggers: false | TriggersControllerOptions,
  templates: false | TemplatesControllerOptions,
): Promise<void> {
  const imports: Promise<unknown>[] = [
    import('@zanix/datamaster/core'),
    import('@zanix/auth/core'),
    import('@zanix/notifications/core'),
  ]

  if (triggers !== false) {
    imports.push(
      import('./triggers/triggers.handler.ts').then(({ createTriggersController }) =>
        createTriggersController(triggers)
      ),
    )
  }
  if (templates !== false) {
    imports.push(
      import('./templates/templates.handler.ts').then(({ createTemplatesController }) =>
        createTemplatesController(templates)
      ),
    )
  }

  registeredControllers.push(...(await Promise.all(imports)))
}

/** Options accepted by {@link start}, alongside whatever `@zanix/server`'s `bootstrapServers` takes. */
export type StartOptions = BootstrapServerOptions & {
  /** Options for the triggers route, or `false` to skip registering it entirely. */
  triggers?: false | TriggersControllerOptions
  /** Options for the templates route, or `false` to skip registering it entirely. */
  templates?: false | TemplatesControllerOptions
}

/**
 * Reference deployable entrypoint for `zanix-admin` — a thin, ready-to-run bootstrap over the
 * triggers/templates controllers, for a team that wants to stand up an instance without wiring the
 * registration/bootstrap sequence by hand (see the README's "Basic Usage" for the equivalent manual
 * wiring). Not required: any app importing `@zanix/admin`'s `createTriggersController`/
 * `createTemplatesController` directly and bootstrapping them through its own `@zanix/server`/
 * `@zanix/core` setup works just as well — this is a convenience, not the only supported path.
 *
 * Both controllers default to `isInternal: true` (see `TriggersControllerOptions`/
 * `TemplatesControllerOptions`) — this bootstraps **both** an internal and a public REST server in
 * the same call (mirroring `@zanix/core`'s own `start.ts`) so either default is served correctly
 * regardless of which options a caller overrides; whichever call ends up with nothing to serve is a
 * harmless no-op (`bootstrapServers` never opens a listener for an empty route scope).
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
  const { triggers = {}, templates = {}, ...serverOptions } = options

  await defineAdminMetadata(triggers, templates)

  const publicServers = await bootstrapServers(serverOptions)
  const internalServers = await bootstrapServers({
    ...serverOptions,
    rest: { ...serverOptions.rest, isInternal: true },
  })

  servers = [...publicServers, ...internalServers]

  if (!servers.length) {
    logger.warn(
      "No server was started — no route was registered (unexpected for this package's own " +
        'built-in controllers; check that @zanix/admin was imported correctly).',
      'noSave',
    )
  }

  return servers
}

/** Stops every server {@link start} started. */
export const stop = (): Promise<void> => {
  return webServerManager.stop(servers)
}
