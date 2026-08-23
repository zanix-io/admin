import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { TEMPLATES_BACKEND_ENV, TEMPLATES_MODEL_ENV } from '@zanix/notifications'
import { ADMIN_APPLICATION, defineAdminMetadata } from '../../../mod.ts'

// Covers `metadata.ts`'s `templatesBackendMode() === 'local'` true branch — see
// `admin-metadata-defaults.test.ts`'s own comment for why this needs its own file/process.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'defineAdminMetadata() TEMPLATES_BACKEND=local registers /admin/templates + its Discovery',
  fn: async () => {
    Deno.env.set(TEMPLATES_BACKEND_ENV, 'local')
    Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix-templates-test')
    await defineAdminMetadata()
    Deno.env.delete(TEMPLATES_BACKEND_ENV)
    Deno.env.delete(TEMPLATES_MODEL_ENV)

    const [serverId] = await bootstrapServers({
      rest: {
        application: ADMIN_APPLICATION,
        id: 'metadata-templates-enabled-test',
      },
    })
    assert(serverId, 'the admin REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

    const templates = await fetch(`${baseUrl}/admin/templates/list`)
    assertEquals(templates.status, 401)
    await templates.body?.cancel()

    const templatesDiscovery = await fetch(
      `${baseUrl}/.well-known/zanix/templates`,
    )
    assertEquals(templatesDiscovery.status, 401)
    await templatesDiscovery.body?.cancel()

    await webServerManager.stop([serverId])
  },
})
