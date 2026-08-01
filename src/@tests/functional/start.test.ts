import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import ZanixAdmin from '../../../mod.ts'

// Only one `ZanixAdmin.start()` test per file: a route path can't be redefined once registered,
// and nothing un-registers routes between `Deno.test` blocks in the same file/process — see
// `start-public-override.test.ts` for the same constraint applied to a second scenario.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "ZanixAdmin.start() registers /triggers and /templates behind auth, bound to 'admin' by default",
  fn: async () => {
    // There is no auto-generated anchored id anymore — set one explicitly so both controllers
    // (defaulting to the `'admin'` Application) are reachable at a known, id-prefixed address.
    Deno.env.set('ADMIN_SERVER_ID', 'start-test')

    const servers = await ZanixAdmin.start()
    assert(servers.length > 0, 'an admin REST server should have been started')

    const info = webServerManager.info(servers[0])
    assert(info.addr, 'the started server should be listening')
    // Both controllers default to the `'admin'` Application, so they're only reachable under the
    // admin server's own id-anchored prefix (no `/api/`) — same convention core's own
    // `/admin/triggers`/`/admin/templates` use. `@Get()` with no path argument uses the method
    // name as its sub-path (`list`), same convention `TriggersAdminClient`/`TemplatesAdminClient`
    // already rely on for `/admin/triggers/list`/`/admin/templates/list`.
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${servers[0]}`

    const triggers = await fetch(`${baseUrl}/triggers/list`)
    assertEquals(triggers.status, 401)
    await triggers.body?.cancel()

    const templates = await fetch(`${baseUrl}/templates/list`)
    assertEquals(templates.status, 401)
    await templates.body?.cancel()

    Deno.env.delete('ADMIN_SERVER_ID')
    await ZanixAdmin.stop()
  },
})
