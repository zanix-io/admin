import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { DLQ_MODEL_ENV } from '@zanix/database'
import { ADMIN_APPLICATION, defineAdminMetadata } from '../../../mod.ts'

// Covers `metadata.ts`'s `Deno.env.get(DLQ_MODEL_ENV)` true branch — DLQ's own opt-in gate,
// deliberately shaped like templates' (not triggers' on-by-default-unless-disabled shape) since
// `registerDLQModel()` is a standalone bootstrap call, never auto-run the way the triggers model
// is (see `defineAdminMetadata`'s own doc for the full reasoning). See
// `admin-metadata-defaults.test.ts`'s own comment for why this needs its own file/process.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'defineAdminMetadata() DLQ_MODEL_NAME set registers /admin/dlq + its Discovery',
  fn: async () => {
    Deno.env.set(DLQ_MODEL_ENV, 'zanix-dlq-test')
    await defineAdminMetadata()
    Deno.env.delete(DLQ_MODEL_ENV)

    const [serverId] = await bootstrapServers({
      rest: {
        application: ADMIN_APPLICATION,
        id: 'metadata-dlq-enabled-test',
      },
    })
    assert(serverId, 'the admin REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

    const dlq = await fetch(`${baseUrl}/admin/dlq/list`)
    assertEquals(dlq.status, 401)
    await dlq.body?.cancel()

    const dlqDiscovery = await fetch(`${baseUrl}/.well-known/zanix/dlq`)
    assertEquals(dlqDiscovery.status, 401)
    await dlqDiscovery.body?.cancel()

    await webServerManager.stop([serverId])
  },
})
