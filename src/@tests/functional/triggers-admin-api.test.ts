import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { bootstrapServers, webServerManager } from '@zanix/server'
import { createTriggersAdminController } from 'modules/triggers/local-triggers.handler.ts'

// The real, full-HTTP-dispatch home for a business service's own `/admin/triggers` — moved here
// from `@zanix/core`'s own functional tests, since this controller is fully owned and tested by
// this package now. Booted directly via `bootstrapServers`, not `ZanixAdmin.start()`, since that
// entrypoint wires this package's own `/triggers` aggregator (`triggers.handler.ts`), not this
// per-service controller — it's a `@zanix/core`-side concern to register this one (see `core`'s
// `defineAdminMetadata`). Only the HTTP-dispatch/auth behavior is covered here; the CRUD-forwarding
// logic itself is unit-tested in `local-triggers.handler.test.ts`.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'TriggersAdminController: internal-only, rejects unauthenticated/invalid requests',
  fn: async () => {
    createTriggersAdminController()
    const [serverId] = await bootstrapServers({ rest: { isInternal: true } })
    assert(serverId, 'the internal REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

    const unauthenticated = await fetch(`${baseUrl}/admin/triggers/list`)
    assertEquals(unauthenticated.status, 401)
    await unauthenticated.body?.cancel()

    // Also accepts a machine (`type: 'api'`) caller, not just a human one — see
    // `AUTH_TYPES`/`AuthTokenValidation({ type: ['user', 'api'] })` on the controller. A garbage
    // `X-Znx-Authorization` value gets rejected too, but via the `api` path (403, signature/shape
    // failure) rather than the `user` path's "missing token" 401 — proving this header is actually
    // being inspected, not silently ignored.
    const invalidApiToken = await fetch(`${baseUrl}/admin/triggers/list`, {
      headers: { 'X-Znx-Authorization': 'Bearer not-a-real-token' },
    })
    assertEquals(invalidApiToken.status, 403)
    await invalidApiToken.body?.cancel()

    await webServerManager.stop([serverId])
  },
})
