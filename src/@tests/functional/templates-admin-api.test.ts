import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { createTemplatesController } from 'modules/templates/templates.handler.ts'

// The real, full-HTTP-dispatch home for a business service's own `/admin/templates` — moved here
// from `@zanix/core`'s own functional tests, since this controller is fully owned and tested by
// this package now. Booted directly via `bootstrapServers`, not `ZanixAdmin.start()`, since that
// entrypoint calls this factory with its own default `prefix: 'templates'` (a different route, for
// `zanix-admin`'s own aggregator role — see `start.test.ts`), not `@zanix/core`'s
// `prefix: 'admin/templates'` — it's a `@zanix/core`-side concern to register this one at that path
// (see `core`'s `defineAdminMetadata`). Only the HTTP-dispatch/auth behavior is covered here; the
// CRUD-forwarding logic itself is unit-tested in `templates.handler.test.ts`. `core`'s own
// `TEMPLATES_MODEL_NAME` gating (whether to call this factory at all) isn't this package's concern
// either — it's tested in `core`'s own suite.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'TemplatesController (admin/templates prefix): internal-only, rejects unauthenticated',
  fn: async () => {
    createTemplatesController({ prefix: 'admin/templates' })
    const [serverId] = await bootstrapServers({ rest: { isInternal: true } })
    assert(serverId, 'the internal REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

    const unauthenticated = await fetch(`${baseUrl}/admin/templates/list`)
    assertEquals(unauthenticated.status, 401)
    await unauthenticated.body?.cancel()

    await webServerManager.stop([serverId])
  },
})
