import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { ADMIN_APPLICATION, defineAdminMetadata } from '../../../mod.ts'

// Covers `metadata.ts`'s `!isTriggersModelDisabled()` false branch — see
// `admin-metadata-defaults.test.ts`'s own comment for why this needs its own file/process.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'defineAdminMetadata() TRIGGERS_MODEL_NAME=false skips /admin/triggers entirely',
  fn: async () => {
    Deno.env.set('TRIGGERS_MODEL_NAME', 'false')
    await defineAdminMetadata()
    Deno.env.delete('TRIGGERS_MODEL_NAME')

    const [serverId] = await bootstrapServers({
      rest: { application: ADMIN_APPLICATION, id: 'metadata-triggers-disabled-test' },
    })
    assert(serverId, 'the admin REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

    const triggers = await fetch(`${baseUrl}/admin/triggers/list`)
    assertEquals(triggers.status, 404)
    await triggers.body?.cancel()

    const triggersDiscovery = await fetch(`${baseUrl}/.well-known/zanix/triggers`)
    assertEquals(triggersDiscovery.status, 404)
    await triggersDiscovery.body?.cancel()

    await webServerManager.stop([serverId])
  },
})
