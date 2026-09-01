/**
 * The ONE place `@zanix/notifications`'s (bare root, `./core`, `./templates-api`),
 * `@zanix/datamaster`'s (`./core`), and `@zanix/auth`'s (`./core`) real, versioned `jsr:`
 * specifiers are written down for lazy, RUNTIME-gated resolution — `metadata.ts`'s
 * `defineAdminMetadata`, `admin-hub-app.ts`'s `defineAdminHubMetadata`, and `notifications-shim.ts`'s
 * own resolvers all read their constant from here instead of inlining the string, so a real version
 * bump is a one-line change here. Only the specifier strings live in this file — the narrow local
 * types/resolver functions built on top of them live in `notifications-shim.ts` (types shared by
 * more than one consumer) or directly in whichever single file uses them, never here; see
 * `@zanix/core`'s own identically-scoped `lazy-specifiers.ts` for the same convention.
 *
 * DELIBERATELY absent from `deno.jsonc`'s own top-level `imports` map: with `nodeModulesDir: "auto"`,
 * Deno's npm-compatibility layer installs an `npm:`-backed package for every alias a `deno.json`
 * DECLARES in its `imports` map, regardless of whether reachable code actually imports it — a bare
 * alias declared there is, on its own, enough to trigger the install. Templates is opt-in
 * (`TEMPLATES_BACKEND` unset by default — see `admin-resource-gates.ts`'s `isTemplatesResourceEnabled`),
 * so a deployment that never configures it must never pay for Handlebars (reached unconditionally
 * through `@zanix/notifications`'s own `TemplateProvider`/compiled template registries, from EVERY
 * subpath this package touches — root, `/core`, and `/templates-api` alike all reach the same
 * DB-backed template storage integration) merely by importing `@zanix/admin`.
 *
 * Every `const specifier = SOME_CONSTANT` two-step at each call site (never `import(SOME_CONSTANT)`
 * inline) is deliberate, not incidental: Deno's own module graph builder only follows a dynamic
 * `import()` whose argument it can resolve as a literal at parse time — routing it through a
 * variable keeps a consumer that never triggers the matching gate out of that graph entirely.
 */

/** `@zanix/notifications`'s bare root — `createTemplatesDiscoveryProvider`, `TemplatesAdminService`,
 * `TemplatesAdminRepository`, `toSyncCodeTemplateEntries`. Floor pinned at `1.0.0` to match this
 * package's own `/templates-env`/`/templates-api`/`/templates-types` pins — a lower floor here
 * would resolve a genuinely different `TemplatesAdminService`/`TemplatesAdminRepository` module
 * instance than those subpaths do whenever a local development link is in play, since a literal
 * version-ranged specifier and a raw local-path override only converge on the same linked checkout
 * when their version ranges actually overlap. */
export const NOTIFICATIONS_SPECIFIER = 'jsr:@zanix/notifications@^1.0.0'

/** `@zanix/notifications`'s `./templates-api` subpath — `createTemplatesController`. Same floor as
 * `NOTIFICATIONS_SPECIFIER` above, same reasoning. */
export const NOTIFICATIONS_TEMPLATES_API_SPECIFIER = 'jsr:@zanix/notifications@^1.0.0/templates-api'

/** `@zanix/notifications`'s `./core` subpath — zero-config Mongo/`TemplateProvider` registration,
 * side-effect only (no export this package reads by name). Same floor as `NOTIFICATIONS_SPECIFIER`
 * above, same reasoning. */
export const NOTIFICATIONS_CORE_SPECIFIER = 'jsr:@zanix/notifications@^1.0.0/core'

/** `@zanix/datamaster`'s `./core` subpath — zero-config Mongo/Redis connector registration,
 * side-effect only (no export this package reads by name). Same reasoning as
 * `NOTIFICATIONS_CORE_SPECIFIER` above: a bare `import('@zanix/datamaster/core')` literal would be
 * statically reachable (and so `redis`/`mongoose`-materializing) merely by importing
 * `admin-hub-app.ts`, whether or not `ZanixAdminHub.start()` is ever actually called. */
export const DATAMASTER_CORE_SPECIFIER = 'jsr:@zanix/datamaster@^1.9.0/core'

/** `@zanix/auth`'s `./core` subpath — zero-config session/auth connector registration, side-effect
 * only (no export this package reads by name). Same reasoning as `NOTIFICATIONS_CORE_SPECIFIER`
 * above. */
export const AUTH_CORE_SPECIFIER = 'jsr:@zanix/auth@^1.0.0/core'
