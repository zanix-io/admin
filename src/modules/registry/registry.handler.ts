import type { HandlerContext } from '@zanix/server'

import { Controller, Get, ZanixController } from '@zanix/server'
import { AuthTokenValidation } from '@zanix/auth'
import { ADMIN_AUTH_TYPES, ADMIN_ROLE } from 'utils/constants.ts'
import { ADMIN_VERSION_PROTOCOL } from '../protocol/version-protocol.ts'
import { getServiceRegistry } from './registry.ts'
import type { ServiceRegistryEntry } from 'typings/registry.ts'

// Accepts either a human admin's user-shaped token or a machine caller's api-shaped one on the
// same route — see `@zanix/auth`'s `AuthTokenValidation({ type })` array support.
const AUTH_TYPES = ADMIN_AUTH_TYPES

/** Options accepted by {@link createRegistryController}. */
export interface RegistryControllerOptions {
  /** The route prefix, e.g. `'registry'` (default) for `/registry`. */
  prefix?: string
}

/** The instance shape {@link createRegistryController} builds — see its own docs. */
export interface RegistryControllerInstance extends ZanixController {
  /** `GET /` — lists every service registered on this hub instance. */
  list(): Promise<ServiceRegistryEntry[]>
}

/**
 * Builds `zanix-admin`'s Service Registry read API — a single, read-only route reflecting whichever
 * `ServiceRegistry` instance {@link getServiceRegistry} resolves (installed with
 * `setServiceRegistry`, or a sensible env-var-only default). Unlike `createTriggersController`/
 * `createDlqController`, this owns no proxy/aggregation logic at all: `ServiceRegistry` is already
 * in-process, static config (see its own doc — entries merge once at construction, never change at
 * runtime), so there is nothing to fan out to and nothing to reconcile. `list()` is the only method
 * exposed — `ServiceRegistry` itself has no create/update/delete surface to mirror.
 *
 * Deliberately guarded by only `{@link ADMIN_ROLE}` — no dedicated `ADMIN_REGISTRY_ROLE` the way
 * `createTriggersController`/`createTemplatesController`/`createDlqController` each gate behind
 * their own resource-specific role. Those three are optional, individually-gateable resources (a
 * deployment can disable any one of them); the registry is core hub info that exists whenever the
 * hub itself does, so it isn't given its own opt-out role to match.
 *
 * A factory rather than a plain class because `@Controller`'s `prefix` is decorator-time (static)
 * config — `defineAdminHubApp` calls this once at boot, unconditionally (no `registry: false`
 * opt-out — see that function's own doc for why); an app wiring this manually can call it directly
 * instead. Which Application (see `@zanix/server`'s `docs/applications.md`) this route belongs to is
 * decided by whichever `defineApplication(...)` scope is active when this call runs, not by an
 * option here.
 *
 * @requires @zanix/auth
 */
export function createRegistryController(
  options: RegistryControllerOptions = {},
): new (context: HandlerContext) => RegistryControllerInstance {
  const { prefix = 'registry' } = options

  @Controller({ prefix, versionProtocol: ADMIN_VERSION_PROTOCOL })
  class _RegistryController extends ZanixController {
    @Get()
    @AuthTokenValidation({ permissions: [ADMIN_ROLE], type: AUTH_TYPES })
    public list(): Promise<ServiceRegistryEntry[]> {
      return Promise.resolve(getServiceRegistry().list())
    }
  }

  return _RegistryController
}
