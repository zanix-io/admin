import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { activateApps } from '@zanix/app/runtime'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { ADMIN_APPLICATION, defineLocalAdminApp } from '../../../mod.ts'

// `defineLocalAdminApp()` itself — the factory `@zanix/core`'s own `admin: true` option activates
// (see its own doc) — is deliberately never called by `local-admin-operations.test.ts` (see that
// file's own comment): it only ever exercises `getLocalAdminSubApps()` in isolation. This file
// covers the other half: a real `activateApps([...])` run proving `defineLocalAdminApp()`'s
// `setup()` really does call through to `defineAdminMetadata()`, registering the same
// `/admin/triggers` route `admin-metadata-defaults.test.ts` already asserts on when calling
// `defineAdminMetadata()` directly.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "defineLocalAdminApp(): a real activateApps([...]) run wires ADMIN_APPLICATION and registers defineAdminMetadata()'s routes",
  fn: async () => {
    const definition = defineLocalAdminApp()
    assertEquals(definition.definition.name, ADMIN_APPLICATION)
    assertEquals(definition.definition.routesPrefix, null)

    await activateApps([definition])

    const [serverId] = await bootstrapServers({
      rest: { application: ADMIN_APPLICATION, id: 'local-admin-app-definition-test' },
    })
    assert(serverId, 'the admin REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

    const triggers = await fetch(`${baseUrl}/admin/triggers/list`)
    assertEquals(triggers.status, 401)
    await triggers.body?.cancel()

    await webServerManager.stop([serverId])
  },
})
