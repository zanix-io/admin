import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { DEFAULT_APPLICATION, webServerManager } from '@zanix/server'
import ZanixAdminHub from '../../../mod.ts'

// Its own file: `ZanixAdminHub.start()` registers routes once per process (route paths can't be
// redefined on a second call, and nothing un-registers them between `Deno.test` blocks in the same
// file) — see `start.test.ts`'s own comment for the same constraint.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "ZanixAdminHub.start(): triggers: { application: 'main' } mounts /triggers on the public server",
  fn: async () => {
    const publicServers: string[] = []
    const servers = await ZanixAdminHub.start({
      triggers: { application: DEFAULT_APPLICATION },
      rest: { onCreate: (id) => publicServers.push(id) },
    })
    assert(servers.length > 0, 'at least one server should have been started')
    assert(
      publicServers.length > 0,
      'a public REST server should have started for /triggers',
    )

    const info = webServerManager.info(publicServers[0] as never)
    assert(info.addr, 'the public server should be listening')
    // Default `globalPrefix` for a public REST server is `api`.
    const res = await fetch(
      `http://${info.addr.hostname}:${info.addr.port}/api/triggers/list`,
    )
    assertEquals(res.status, 401)
    await res.body?.cancel()

    await ZanixAdminHub.stop()
  },
})
