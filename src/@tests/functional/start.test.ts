import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import ZanixAdminHub from '../../../mod.ts'

// Only one `ZanixAdminHub.start()` test per file: a route path can't be redefined once registered,
// and nothing un-registers routes between `Deno.test` blocks in the same file/process — see
// `start-public-override.test.ts` for the same constraint applied to a second scenario.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "ZanixAdminHub.start() registers /triggers and /templates behind auth, bound to 'admin-hub' by default",
  fn: async () => {
    // There is no auto-generated anchored id anymore — set one explicitly so both controllers
    // (defaulting to the `'admin-hub'` Application) are reachable at a known, id-prefixed address.
    // Its OWN env var, distinct from `@zanix/core`'s embedded admin's `ADMIN_SERVER_ID`.
    Deno.env.set('ADMIN_HUB_SERVER_ID', 'start-test')

    const servers = await ZanixAdminHub.start()
    assert(servers.length > 0, 'an admin REST server should have been started')

    const info = webServerManager.info(servers[0])
    assert(info.addr, 'the started server should be listening')
    // Both controllers default to the `'admin-hub'` Application, so they're only reachable under
    // the admin-hub server's own id-anchored prefix (no `/api/`) — same convention core's own
    // `/admin/triggers`/`/admin/templates` use for the (distinct) `'admin'` Application. `@Get()`
    // with no path argument uses the method name as its sub-path (`list`), same convention
    // `TriggersAdminClient`/`TemplatesAdminClient` already rely on for
    // `/admin/triggers/list`/`/admin/templates/list`.
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${servers[0]}`

    const triggers = await fetch(`${baseUrl}/triggers/list`)
    assertEquals(triggers.status, 401)
    await triggers.body?.cancel()

    const templates = await fetch(`${baseUrl}/templates/list`)
    assertEquals(templates.status, 401)
    await templates.body?.cancel()

    Deno.env.delete('ADMIN_HUB_SERVER_ID')
    await ZanixAdminHub.stop()
  },
})
