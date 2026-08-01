// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { ProgramModule } from '@zanix/server'
import { ServiceRegistry, setServiceRegistry } from 'modules/registry/registry.ts'
import { DiscoveryAdminClient } from 'modules/discovery/discovery.client.ts'
import {
  setTemplatesDiscoveryClientFactory,
  syncTemplatesFromRegisteredService,
  type TemplatesDiscoveryClientFactory,
} from 'modules/templates/templates-sync.ts'

Deno.test({
  name:
    "syncTemplatesFromRegisteredService pulls the service's Discovery snapshot, merges via TemplatesAdminRepository.syncCodeTemplates",
  fn: async () => {
    setServiceRegistry(
      new ServiceRegistry([{ serviceId: 'billing', adminBaseUrl: 'http://billing.internal' }]),
    )
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              resourceType: 'code-templates',
              generatedAt: '2026-01-01T00:00:00.000Z',
              items: [{ channel: 'email', name: 'generic', hbs: '<p>hi</p>', hash: 'h1' }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ) as never,
    )
    const syncCalls: unknown[] = []
    // `ProgramModule` itself is frozen (Object.freeze on the singleton) — stub the prototype
    // method instead of the frozen instance, since `stub()` assigning an own property onto a
    // frozen object throws (confirmed empirically this session).
    const providersStub = stub(
      Object.getPrototypeOf(ProgramModule),
      'getProviders',
      (() => ({
        get: (_cls: unknown) => ({
          syncCodeTemplates: (entries: unknown, updatedBy: unknown) => (
            syncCalls.push([entries, updatedBy]), Promise.resolve({ seeded: 1, resynced: 0 })
          ),
        }),
      })) as any,
    )

    try {
      const result = await syncTemplatesFromRegisteredService('billing', 'admin-1')

      assertEquals(result, { seeded: 1, resynced: 0 })
      assertEquals(syncCalls, [
        [[{ channel: 'email', name: 'generic', hbs: '<p>hi</p>', hash: 'h1' }], 'admin-1'],
      ])
      assertEquals(
        String(fetchStub.calls[0].args[0]),
        'http://billing.internal/.well-known/zanix/code-templates',
      )
    } finally {
      fetchStub.restore()
      providersStub.restore()
    }
  },
})

Deno.test({
  name: 'setTemplatesDiscoveryClientFactory installs a custom factory used by the sync',
  fn: async () => {
    setServiceRegistry(
      new ServiceRegistry([{ serviceId: 'billing', adminBaseUrl: 'http://billing.internal' }]),
    )

    const customFactory: TemplatesDiscoveryClientFactory = (service) =>
      new DiscoveryAdminClient({
        baseUrl: service.adminBaseUrl,
        headers: { 'X-Znx-Authorization': 'Bearer test-token' },
      })
    setTemplatesDiscoveryClientFactory(customFactory)

    let capturedHeaders: Record<string, string> | undefined
    const fetchStub = stub(
      globalThis,
      'fetch',
      (_url: unknown, init?: any) => {
        capturedHeaders = init?.headers
        return Promise.resolve(
          new Response(
            JSON.stringify({ resourceType: 'code-templates', generatedAt: '', items: [] }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ) as never
      },
    )
    const providersStub = stub(
      Object.getPrototypeOf(ProgramModule),
      'getProviders',
      (() => ({
        get: (_cls: unknown) => ({
          syncCodeTemplates: () => Promise.resolve({ seeded: 0, resynced: 0 }),
        }),
      })) as any,
    )

    try {
      await syncTemplatesFromRegisteredService('billing', 'admin-1')
      assertEquals(capturedHeaders?.['X-Znx-Authorization'], 'Bearer test-token')
    } finally {
      fetchStub.restore()
      providersStub.restore()
      setTemplatesDiscoveryClientFactory((service) =>
        new DiscoveryAdminClient({ baseUrl: service.adminBaseUrl })
      )
    }
  },
})
