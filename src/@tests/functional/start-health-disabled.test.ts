import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import ZanixAdminHub from '../../../mod.ts'

// Own file — same one-shot-registration constraint as `start.test.ts`.

stub(console, 'info')
stub(console, 'warn')

/**
 * Regression coverage for the same bug class found running a real consumer app against
 * `@zanix/core`'s embedded admin (`bootstrapAppServer` used to mangle `health` into an unrelated
 * object instead of forwarding it) — `ZanixAdminHub.start()` routes through the exact same
 * `bootstrapAppServer`, so this confirms the fix (and the `hasExplicitServerConfig` fix, since
 * `health: false` here names no server TYPE at all) also covers this entrypoint.
 */
Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'ZanixAdminHub.start({ health: false }): /health and /ready are disabled, real routes unaffected',
  fn: async () => {
    Deno.env.set('ADMIN_HUB_SERVER_ID', 'start-health-disabled-test')

    const servers = await ZanixAdminHub.start({ health: false })
    assert(servers.length > 0, 'an admin REST server should have been started')

    const info = webServerManager.info(servers[0])
    assert(info.addr, 'the started server should be listening')
    const base = `http://${info.addr.hostname}:${info.addr.port}`

    const health = await fetch(`${base}/health`)
    assertEquals(health.status, 404)
    await health.body?.cancel()

    const ready = await fetch(`${base}/ready`)
    assertEquals(ready.status, 404)
    await ready.body?.cancel()

    const triggers = await fetch(`${base}/${servers[0]}/triggers/list`)
    assertEquals(triggers.status, 401) // real route unaffected — still behind auth, still there
    await triggers.body?.cancel()

    Deno.env.delete('ADMIN_HUB_SERVER_ID')
    await ZanixAdminHub.stop()
  },
})
