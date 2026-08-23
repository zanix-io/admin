import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import {
  AUTH_HEADERS,
  bootstrapServers,
  Controller,
  Get,
  ProgramModule,
  webServerManager,
  ZanixController,
} from '@zanix/server'
import { AuthTokenValidation, createAppToken, jwtValidationGuard } from '@zanix/auth'
import { generateRSAKeys } from '@zanix/helpers'
import {
  ADMIN_AUTH_TYPES,
  ADMIN_DLQ_ROLE,
  ADMIN_ROLE,
  ADMIN_TEMPLATES_ROLE,
  ADMIN_TRIGGERS_ROLE,
} from 'utils/constants.ts'

// This session's real-world admin CRUD/Discovery routes all gate on
// `AuthTokenValidation`/`jwtValidationGuard({ permissions: [...], type: ADMIN_AUTH_TYPES })` — every
// existing functional test only proves the REJECTION paths (no token → 401, garbage token → 403),
// never that a genuine, correctly-signed `type: 'api'` credential with the right permissions is
// actually ACCEPTED. This test closes that gap for all six shapes at once (three CRUD-style routes
// via `@AuthTokenValidation`, three Discovery-style registrations via `defineDiscovery`'s own
// `guards` option) — mirroring the exact guard configuration each real file uses, without needing a
// live MongoDB, since these plain test routes never touch a repository.
stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "a real, signed type:'api' token with the right permissions passes every admin CRUD/Discovery guard shape",
  fn: async () => {
    Deno.env.set('REDIS_URI', 'redis://localhost:6379')
    await import('@zanix/datamaster/core') // registers the cache/KV infra jwtValidationGuard needs

    const { publicKey, privateKey } = await generateRSAKeys()
    Deno.env.set('JWK_PRI', btoa(privateKey))
    Deno.env.set('JWK_PUB', btoa(publicKey))

    const accessToken = await createAppToken({
      type: 'api',
      subject: 'test-service',
      // `verifyJWT` unconditionally rejects a token with no `exp` claim (`MISSING_TOKEN_EXPIRATION`)
      // — omitting `expiration` here produced exactly that, masked as a generic 403 by the guard's
      // own catch-all.
      expiration: '1h',
      payload: {
        permissions: [ADMIN_ROLE, ADMIN_TRIGGERS_ROLE, ADMIN_TEMPLATES_ROLE, ADMIN_DLQ_ROLE],
      },
    })

    await ProgramModule.defineApplication('admin-auth-type-api-check', () => {
      // Mirrors the CRUD guard `defineAdminMetadata()` builds for
      // `/admin/triggers`/`/admin/templates`/`/admin/dlq` exactly (same permissions/type shape),
      // even though those three now take it as an injected `guards`/`AuthTokenValidation` option
      // rather than hardcoding it.
      @Controller()
      class _CrudCheckController extends ZanixController {
        @Get('check/triggers-crud')
        @AuthTokenValidation({
          permissions: [ADMIN_ROLE, ADMIN_TRIGGERS_ROLE],
          type: ADMIN_AUTH_TYPES,
        })
        public triggersCrud() {
          return { ok: true }
        }

        @Get('check/templates-crud')
        @AuthTokenValidation({
          permissions: [ADMIN_ROLE, ADMIN_TEMPLATES_ROLE],
          type: ADMIN_AUTH_TYPES,
        })
        public templatesCrud() {
          return { ok: true }
        }

        @Get('check/dlq-crud')
        @AuthTokenValidation({
          permissions: [ADMIN_ROLE, ADMIN_DLQ_ROLE],
          type: ADMIN_AUTH_TYPES,
        })
        public dlqCrud() {
          return { ok: true }
        }
      }

      // Mirrors `metadata.ts`'s own three Discovery guards exactly.
      ProgramModule.defineDiscovery('check-triggers', {
        snapshot: () => Promise.resolve([]),
      }, {
        guards: [
          jwtValidationGuard({
            permissions: [ADMIN_ROLE, ADMIN_TRIGGERS_ROLE],
            type: ADMIN_AUTH_TYPES,
          }),
        ],
      })
      ProgramModule.defineDiscovery('check-templates', {
        snapshot: () => Promise.resolve([]),
      }, {
        guards: [
          jwtValidationGuard({
            permissions: [ADMIN_ROLE, ADMIN_TEMPLATES_ROLE],
            type: ADMIN_AUTH_TYPES,
          }),
        ],
      })
      ProgramModule.defineDiscovery('check-dlq', {
        snapshot: () => Promise.resolve([]),
      }, {
        guards: [
          jwtValidationGuard({
            permissions: [ADMIN_ROLE, ADMIN_DLQ_ROLE],
            type: ADMIN_AUTH_TYPES,
          }),
        ],
      })
    })

    const [serverId] = await bootstrapServers({
      rest: { application: 'admin-auth-type-api-check' },
    })
    assert(serverId, 'the check server should have started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the check server should be listening')
    // Not anchored — no `/{serverId}/` id-prefix segment, unlike an anchored server's own path.
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}`

    const paths = [
      'api/check/triggers-crud',
      'api/check/templates-crud',
      'api/check/dlq-crud',
      'api/.well-known/zanix/check-triggers',
      'api/.well-known/zanix/check-templates',
      'api/.well-known/zanix/check-dlq',
    ]
    const results = await Promise.all(
      paths.map(async (path) => {
        const res = await fetch(`${baseUrl}/${path}`, {
          headers: { [AUTH_HEADERS.api]: `Bearer ${accessToken}` },
        })
        await res.body?.cancel()
        return { path, status: res.status }
      }),
    )
    for (const { path, status } of results) {
      assertEquals(status, 200, `expected 200 for ${path}, got ${status}`)
    }

    await webServerManager.stop([serverId])
    Deno.env.delete('JWK_PRI')
    Deno.env.delete('JWK_PUB')
  },
})
