import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { ADMIN_APPLICATION, defineAdminMetadata } from '../../../mod.ts'

// `defineAdminMetadata` (this package's own admin-controller registration, called by `@zanix/core`'s
// `start()` — see its own JSDoc in `metadata.ts`) isn't exercised anywhere else in this suite: every
// other functional test registers its controller directly via `ProgramModule.defineApplication`,
// bypassing this function's own env-driven gating entirely. Its own file: registers real routes once
// per process (route paths can't be redefined on a second call — see `start.test.ts`'s own comment
// for the same constraint), so each env combination gets its own file.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'defineAdminMetadata() default env: registers /admin/triggers + its Discovery, skips /admin/templates and /admin/dlq',
  fn: async () => {
    await defineAdminMetadata()

    const [serverId] = await bootstrapServers({
      rest: { application: ADMIN_APPLICATION, id: 'metadata-defaults-test' },
    })
    assert(serverId, 'the admin REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

    const triggers = await fetch(`${baseUrl}/admin/triggers/list`)
    assertEquals(triggers.status, 401)
    await triggers.body?.cancel()

    const triggersDiscovery = await fetch(
      `${baseUrl}/.well-known/zanix/triggers`,
    )
    assertEquals(triggersDiscovery.status, 401)
    await triggersDiscovery.body?.cancel()

    // `TEMPLATES_MODEL_NAME` unset by default — the templates branch is never entered.
    const templates = await fetch(`${baseUrl}/admin/templates/list`)
    assertEquals(templates.status, 404)
    await templates.body?.cancel()

    const templatesDiscovery = await fetch(
      `${baseUrl}/.well-known/zanix/templates`,
    )
    assertEquals(templatesDiscovery.status, 404)
    await templatesDiscovery.body?.cancel()

    // `DLQ_MODEL_NAME` unset by default — the DLQ branch is never entered either, same opt-in
    // shape as templates (see `defineAdminMetadata`'s own doc for why DLQ isn't on-by-default).
    const dlq = await fetch(`${baseUrl}/admin/dlq/list`)
    assertEquals(dlq.status, 404)
    await dlq.body?.cancel()

    const dlqDiscovery = await fetch(`${baseUrl}/.well-known/zanix/dlq`)
    assertEquals(dlqDiscovery.status, 404)
    await dlqDiscovery.body?.cancel()

    await webServerManager.stop([serverId])
  },
})
