import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { Controller, Get, webServerManager, ZanixController } from '@zanix/server'
import ZanixAdminHub from '../../../mod.ts'

// Its own file: `ZanixAdminHub.start()` registers routes once per process — see `start.test.ts`'s
// own comment for the same constraint.

// Simulates an unrelated business app's own public route already sitting in the shared,
// process-global route registry by the time `ZanixAdminHub.start()` runs (e.g. `Zanix.start()`
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
    'ZanixAdminHub.start() default (no explicit public triggers/templates) never serves a foreign public route left in the shared registry',
  fn: async () => {
    const servers = await ZanixAdminHub.start()

    // The admin Application server, plus one server per hub sub-app (`admin-hub-triggers`/
    // `admin-hub-templates`/`admin-hub-dlq` — see `admin-hub-app.ts`'s own doc) started — the
    // "public" bootstrap never ran, since none of triggers/templates/dlq was configured with
    // `application: 'main'`. `servers[0]` is still the real admin server (`start.ts`'s own return
    // order puts `adminServers` before the sub-apps'), sharing one port with the other three.
    assertEquals(
      servers.length,
      4,
      'the admin server and its three sub-app servers should start',
    )

    const info = webServerManager.info(servers[0])
    assert(info.addr, 'the admin server should be listening')

    // The foreign controller's own (public, default `api` prefix) route was never touched.
    const res = await fetch(
      `http://${info.addr.hostname}:${info.addr.port}/api/foreign-only`,
    )
    assertEquals(res.status, 404)
    await res.body?.cancel()

    await ZanixAdminHub.stop()
  },
})
