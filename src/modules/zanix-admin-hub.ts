/**
 * `ZanixAdminHub` on its own, apart from the root `.` barrel's own RTOs/`TriggersAdminRepository`/
 * `TriggersAdminService`/thin HTTP clients — this package's root `mod.ts` re-exports
 * `TemplatesAdminRepository`/`TemplatesAdminService` straight from `@zanix/notifications`'s bare
 * root, whose own `TemplateProvider` reaches Handlebars unconditionally (see
 * `specifiers.ts`'s own doc) — so a consumer reaching for ANYTHING in the root barrel,
 * `ZanixAdminHub` included, resolves that file's whole graph regardless of whether templates is
 * even configured. `start`/`stop` (this class's own implementation, `./start.ts`) already gate
 * their OWN `@zanix/notifications` dependency behind a lazy, non-literal `import()` — see
 * `metadata.ts`'s/`admin-hub-app.ts`'s own `resolveControllers`/`importController` — so importing
 * ONLY this subpath, never the root, is what actually lets a deployment with `templates: false`
 * (or `TEMPLATES_BACKEND` unset) skip Handlebars entirely. Root `.` still re-exports this same
 * class as its own default export — existing `import ZanixAdminHub from '@zanix/admin'` call sites
 * are unaffected; this subpath is for the caller that wants the "just the hub" shortcut and
 * nothing else the root barrel bundles alongside it.
 *
 * @module
 */

import { start, stop } from './start.ts'

/**
 * Reference deployable entrypoint — the quickest way to stand up a real `zanix-admin` instance:
 * registers `TriggersController`/`TemplatesController` and their supporting connectors/providers
 * (`@zanix/datamaster`'s Mongo/Redis/cache, `@zanix/auth`'s session infra, `@zanix/notifications`'s
 * `TemplateProvider`), then starts a REST server via `@zanix/server`'s `bootstrapServers`.
 *
 * Not required — an app that wires the controllers into its own bootstrap directly (see the
 * README's "Basic Usage") never needs this class at all.
 *
 * @example
 * ```ts
 * import ZanixAdminHub from 'jsr:@zanix/admin@[version]/hub'
 * import { setTriggersAggregator, TriggersAggregator } from 'jsr:@zanix/admin@[version]'
 *
 * setTriggersAggregator(new TriggersAggregator(registry, clientFactory)) // install real per-service auth first
 *
 * await ZanixAdminHub.start()
 * ```
 */
export default class ZanixAdminHub {
  /**
   * Registers this package's routes/connectors and starts a REST server for them.
   *
   * Also traps `SIGINT`/`SIGTERM` automatically (no opt-out) — either signal runs
   * {@link ZanixAdminHub.stop} before exiting, same as `@zanix/core`'s own `Zanix.start()`.
   *
   * @param options - Forwarded as-is to `@zanix/server`'s `bootstrapServers` (port, cors, gzip,
   * `onCreate`, etc.).
   * @returns The `ServerID`s of whatever servers were actually started.
   */
  public static start: typeof start = start

  /**
   * Stops every server {@link ZanixAdminHub.start} started, then closes connector connections.
   * Also called automatically on `SIGINT`/`SIGTERM` if {@link ZanixAdminHub.start} registered a
   * handler for them.
   */
  public static stop: typeof stop = stop
}
