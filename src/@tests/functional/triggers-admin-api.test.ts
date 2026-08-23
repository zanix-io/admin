import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { createTriggersAdminController } from '@zanix/datamaster/triggers-api'
import { jwtValidationGuard } from '@zanix/auth'
import { ADMIN_AUTH_TYPES, ADMIN_ROLE, ADMIN_TRIGGERS_ROLE } from 'utils/constants.ts'
import { ADMIN_VERSION_PROTOCOL } from 'modules/protocol/version-protocol.ts'

// The real, full-HTTP-dispatch home for a business service's own `/admin/triggers`. The CRUD
// controller itself (`@zanix/datamaster/triggers-api`'s `createTriggersAdminController`) is
// guard-agnostic by design — it never assumes an auth mechanism (see its own doc) — so this test
// builds the exact same guard/protocol `defineAdminMetadata()` builds (see `modules/metadata.ts`)
// and passes it in directly, the same narrow-scope shape the original (pre-migration) version of
// this test already used, rather than calling the whole `defineAdminMetadata()` — that function
// also registers `/admin/service-token` and conditionally `/admin/templates`, neither of which this
// test is about, and going through it pulls in unrelated global env-var state (`TEMPLATES_MODEL_ENV`,
// `TRIGGERS_MODEL_NAME`) that other test files in this same suite mutate. Only the HTTP-dispatch/auth
// behavior is covered here; the CRUD-forwarding logic itself is unit-tested in `@zanix/datamaster`'s
// own `local-triggers.handler.test.ts`.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'TriggersAdminController: admin Application only, rejects unauthenticated/invalid requests',
  fn: async () => {
    await ProgramModule.defineApplication('admin', () => {
      createTriggersAdminController({
        guards: [
          jwtValidationGuard({
            permissions: [ADMIN_ROLE, ADMIN_TRIGGERS_ROLE],
            type: ADMIN_AUTH_TYPES,
          }),
        ],
        versionProtocol: ADMIN_VERSION_PROTOCOL,
      })
    })
    const [serverId] = await bootstrapServers({
      rest: { application: 'admin', id: 'triggers-admin-api-test' },
    })
    assert(serverId, 'the admin REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

    const unauthenticated = await fetch(`${baseUrl}/admin/triggers/list`)
    assertEquals(unauthenticated.status, 401)
    await unauthenticated.body?.cancel()

    // Also accepts a machine (`type: 'api'`) caller, not just a human one — see
    // `ADMIN_AUTH_TYPES`/`jwtValidationGuard({ type: ['user', 'api'] })` above. A garbage
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
