import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { bootstrapServers, ProgramModule, webServerManager } from '@zanix/server'
import { createTemplatesController } from '@zanix/notifications/templates-api'
import { createTemplatesSyncController } from 'modules/templates/templates-sync.handler.ts'
import { jwtValidationGuard } from '@zanix/auth'
import { ADMIN_AUTH_TYPES, ADMIN_ROLE, ADMIN_TEMPLATES_ROLE } from 'utils/constants.ts'
import { ADMIN_VERSION_PROTOCOL } from 'modules/protocol/version-protocol.ts'

// The real, full-HTTP-dispatch home for a business service's own `/admin/templates` — two separate
// controllers mounted under the same prefix, matching exactly how `modules/metadata.ts`'s
// `defineAdminMetadata()` composes them in production: the CRUD half
// (`@zanix/notifications/templates-api`'s `createTemplatesController`, guard-agnostic by design —
// see its own doc) with an explicit guard built here, and this package's own `sync` extension
// (`createTemplatesSyncController`, still fully self-contained). Built manually here (narrow scope)
// rather than via the whole `defineAdminMetadata()`, to avoid pulling in unrelated global env-var
// state (`TRIGGERS_MODEL_NAME`, etc.) other test files in this same suite mutate. Only the
// HTTP-dispatch/auth behavior is covered here; the CRUD-forwarding logic itself is unit-tested in
// `@zanix/notifications`'s own `templates.handler.test.ts`, and the `sync`-forwarding logic in this
// package's own `templates-sync.handler.test.ts`.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'TemplatesController (admin/templates prefix): admin Application only, rejects unauthenticated',
  fn: async () => {
    await ProgramModule.defineApplication('admin', () => {
      createTemplatesController({
        prefix: 'admin/templates',
        guards: [
          jwtValidationGuard({
            permissions: [ADMIN_ROLE, ADMIN_TEMPLATES_ROLE],
            type: ADMIN_AUTH_TYPES,
          }),
        ],
        versionProtocol: ADMIN_VERSION_PROTOCOL,
      })
      createTemplatesSyncController({ prefix: 'admin/templates' })
    })
    const [serverId] = await bootstrapServers({
      rest: { application: 'admin', id: 'templates-admin-api-test' },
    })
    assert(serverId, 'the admin REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${serverId}`

    const unauthenticated = await fetch(`${baseUrl}/admin/templates/list`)
    assertEquals(unauthenticated.status, 401)
    await unauthenticated.body?.cancel()

    // The `sync` extension is mounted alongside the CRUD controller, under the same prefix, and
    // keeps its own independent `AuthTokenValidation` gate — also rejects unauthenticated.
    const unauthenticatedSync = await fetch(`${baseUrl}/admin/templates/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceId: 'billing' }),
    })
    assertEquals(unauthenticatedSync.status, 401)
    await unauthenticatedSync.body?.cancel()

    await webServerManager.stop([serverId])
  },
})
