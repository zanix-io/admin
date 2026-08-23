// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import type { HandlerContext } from '@zanix/server'
import { ProgramModule } from '@zanix/server'
import { createTemplatesSyncController } from 'modules/templates/templates-sync.handler.ts'
import { ServiceRegistry, setServiceRegistry } from 'modules/registry/registry.ts'

// Covers the one route genuinely owned by this package: the cross-service `sync` extension. The
// CRUD controller's own tests live in `@zanix/notifications`'s own
// `src/@tests/unit/templates/templates.handler.test.ts`.

const TemplatesSyncController = createTemplatesSyncController()

function fakeThis() {
  return new TemplatesSyncController({ id: 'test-ctx' } as never)
}

const handler = TemplatesSyncController.prototype

// `sync()` doesn't delegate to any DI-bound `interactor` (see `syncTemplatesFromRegisteredService`'s
// own tests, `templates-sync.test.ts`) — these two just confirm the route forwards
// `body.serviceId`/`session.id` into that standalone function correctly, using the same
// registry/fetch/providers stubbing seam its own dedicated test suite already exercises fully.
function withSyncEnv(updatedByCalls: unknown[][], fn: () => Promise<unknown>) {
  setServiceRegistry(
    new ServiceRegistry([{
      serviceId: 'billing',
      adminBaseUrl: 'http://billing.internal',
    }]),
  )
  const fetchStub = stub(
    globalThis,
    'fetch',
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            resourceType: 'code-templates',
            generatedAt: '',
            items: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ) as never,
  )
  const providersStub = stub(
    Object.getPrototypeOf(ProgramModule),
    'getProviders',
    (() => ({
      get: (_cls: unknown) => ({
        syncCodeTemplates: (entries: unknown, updatedBy: unknown) => (
          updatedByCalls.push([entries, updatedBy]), Promise.resolve({ seeded: 1, resynced: 0 })
        ),
      }),
    })) as any,
  )

  return fn().finally(() => {
    fetchStub.restore()
    providersStub.restore()
  })
}

Deno.test({
  name: 'TemplatesSyncController.sync forwards serviceId + session id, returns summary',
  fn: async () => {
    const calls: unknown[][] = []
    const ctx = {
      payload: { body: { serviceId: 'billing' } },
      session: { id: 'service-account-1' },
    } as HandlerContext<never>

    const result = await withSyncEnv(
      calls,
      () => handler.sync.call(fakeThis(), ctx),
    )

    assertEquals(result, { seeded: 1, resynced: 0 })
    assertEquals(calls[0][1], 'service-account-1')
  },
})

Deno.test("TemplatesSyncController.sync falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = { payload: { body: { serviceId: 'billing' } } } as HandlerContext<
    never
  >

  await withSyncEnv(calls, () => handler.sync.call(fakeThis(), ctx))

  assertEquals(calls[0][1], 'unknown')
})
