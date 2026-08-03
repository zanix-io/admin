import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { DATABASE_TEMPLATES_ENV, TEMPLATES_MODEL_ENV } from '@zanix/notifications'
import { ADMIN_APPLICATION, defineAdminMetadata } from '../../../mod.ts'

// Covers `metadata.ts`'s `Deno.env.get(TEMPLATES_MODEL_ENV) && !isDatabaseTemplatesDisabled()`
// "model set but DB templates explicitly disabled" branch (first operand true, second false) — see
// `admin-metadata-defaults.test.ts`'s own comment for why this needs its own file/process.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'defineAdminMetadata() DATABASE_TEMPLATES=false skips /admin/templates even with TEMPLATES_MODEL_NAME set',
  fn: async () => {
    Deno.env.set(TEMPLATES_MODEL_ENV, 'zanix-templates-test')
    Deno.env.set(DATABASE_TEMPLATES_ENV, 'false')
    await defineAdminMetadata()
    Deno.env.delete(TEMPLATES_MODEL_ENV)
    Deno.env.delete(DATABASE_TEMPLATES_ENV)

    const [serverId] = await bootstrapServers({
      rest: { application: ADMIN_APPLICATION, id: 'metadata-templates-db-disabled-test' },
    })
    assert(serverId, 'the admin REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

    const templates = await fetch(`${baseUrl}/admin/templates/list`)
    assertEquals(templates.status, 404)
    await templates.body?.cancel()

    await webServerManager.stop([serverId])
  },
})
