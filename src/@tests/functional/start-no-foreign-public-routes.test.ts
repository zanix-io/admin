import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { Controller, Get, webServerManager, ZanixController } from '@zanix/server'
import ZanixAdmin from '../../../mod.ts'

// Its own file: `ZanixAdmin.start()` registers routes once per process — see `start.test.ts`'s
// own comment for the same constraint.

// Simulates an unrelated business app's own public route already sitting in the shared,
// process-global route registry by the time `ZanixAdmin.start()` runs (e.g. `Zanix.start()`
// called unawaited in the same process) — see `start.ts`'s `wantsPublicRoute` guard.
@Controller()
class _ForeignBusinessAppController extends ZanixController {
  @Get('foreign-only')
  public probe() {
    return "not admin's route"
  }
}

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'ZanixAdmin.start() default (no explicit public triggers/templates) never serves a foreign public route left in the shared registry',
  fn: async () => {
    const servers = await ZanixAdmin.start()

    // Only the admin Application server started — the "public" bootstrap never ran, since neither
    // triggers nor templates was configured with `application: 'main'`.
    assertEquals(servers.length, 1, 'only the admin server should have started')

    const info = webServerManager.info(servers[0])
    assert(info.addr, 'the admin server should be listening')

    // The foreign controller's own (public, default `api` prefix) route was never touched.
    const res = await fetch(`http://${info.addr.hostname}:${info.addr.port}/api/foreign-only`)
    assertEquals(res.status, 404)
    await res.body?.cancel()

    await ZanixAdmin.stop()
  },
})
