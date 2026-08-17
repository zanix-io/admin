// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { HttpError } from '@zanix/errors'
import { ProgramModule } from '@zanix/server'
import { ServiceRegistry, setServiceRegistry } from 'modules/registry/registry.ts'
import { DiscoveryAdminClient } from 'modules/discovery/discovery.client.ts'
import {
  setTemplatesDiscoveryClientFactory,
  syncTemplatesFromRegisteredService,
  type TemplatesDiscoveryClientFactory,
} from 'modules/templates/templates-sync.ts'

/** A `fetch` mock that 404s `.well-known/zanix/templates` and only serves `code-templates` — the
 * common case (target has no DB-backed templates enabled), used by every test below that isn't
 * specifically exercising the new `'templates'`-preferred path. */
function codeTemplatesOnlyFetch(
  items: unknown[],
): (input: unknown, init?: any) => Promise<Response> {
  return (input: unknown, _?: any) => {
    const url = String(input)
    if (url.endsWith('/.well-known/zanix/templates')) {
      return Promise.resolve(new Response('not found', { status: 404 }))
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          resourceType: 'code-templates',
          generatedAt: '',
          items,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
  }
}

function stubSyncCodeTemplates(syncCalls: unknown[]) {
  // `ProgramModule` itself is frozen (Object.freeze on the singleton) — stub the prototype
  // method instead of the frozen instance, since `stub()` assigning an own property onto a
  // frozen object throws (confirmed empirically this session).
  return stub(
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
}

Deno.test({
  name:
    "syncTemplatesFromRegisteredService falls back to code-templates when the target has no DB-backed templates ('templates' 404s), merges via TemplatesAdminRepository.syncCodeTemplates",
  fn: async () => {
    setServiceRegistry(
      new ServiceRegistry([{
        serviceId: 'billing',
        adminBaseUrl: 'http://billing.internal',
      }]),
    )
    const fetchStub = stub(
      globalThis,
      'fetch',
      codeTemplatesOnlyFetch([{
        channel: 'email',
        name: 'generic',
        hbs: '<p>hi</p>',
        hash: 'h1',
      }]) as never,
    )
    const syncCalls: unknown[] = []
    const providersStub = stubSyncCodeTemplates(syncCalls)

    try {
      const result = await syncTemplatesFromRegisteredService(
        'billing',
        'admin-1',
      )

      assertEquals(result, { seeded: 1, resynced: 0 })
      assertEquals(syncCalls, [
        [
          [{ channel: 'email', name: 'generic', hbs: '<p>hi</p>', hash: 'h1' }],
          'admin-1',
        ],
      ])
      // Both resources are attempted, in order — 'templates' first (404s), 'code-templates' next.
      assertEquals(
        fetchStub.calls.map((call) => String(call.args[0])),
        [
          'http://billing.internal/.well-known/zanix/templates',
          'http://billing.internal/.well-known/zanix/code-templates',
        ],
      )
    } finally {
      fetchStub.restore()
      providersStub.restore()
    }
  },
})

Deno.test({
  name:
    "syncTemplatesFromRegisteredService prefers 'templates' (DB-backed, real content) over 'code-templates' when the target exposes it",
  fn: async () => {
    setServiceRegistry(
      new ServiceRegistry([{
        serviceId: 'billing',
        adminBaseUrl: 'http://billing.internal',
      }]),
    )
    const fetchStub = stub(
      globalThis,
      'fetch',
      ((input: unknown) => {
        const url = String(input)
        if (url.endsWith('/.well-known/zanix/code-templates')) {
          throw new Error(
            'code-templates should never be fetched when templates succeeds',
          )
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              resourceType: 'templates',
              generatedAt: '',
              items: [
                {
                  channel: 'email',
                  name: 'generic',
                  hbs: '<p>edited on the source service</p>',
                  hash: 'real-hash',
                  source: 'database',
                  active: true,
                  version: 3,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }) as never,
    )
    const syncCalls: unknown[] = []
    const providersStub = stubSyncCodeTemplates(syncCalls)

    try {
      await syncTemplatesFromRegisteredService('billing', 'admin-1')

      // Normalized down to the SyncCodeTemplateEntry shape — source/active/version don't survive,
      // since `syncCodeTemplates` treats every entry as this service's own authoritative default
      // regardless of how the ORIGIN classified it internally.
      assertEquals(syncCalls, [
        [
          [{
            channel: 'email',
            name: 'generic',
            hbs: '<p>edited on the source service</p>',
            hash: 'real-hash',
          }],
          'admin-1',
        ],
      ])
      assertEquals(fetchStub.calls.length, 1)
    } finally {
      fetchStub.restore()
      providersStub.restore()
    }
  },
})

Deno.test({
  name:
    "syncTemplatesFromRegisteredService: 'templates' entries with no own hbs (derived, renders through parent) or active:false are excluded from the pull",
  fn: async () => {
    setServiceRegistry(
      new ServiceRegistry([{
        serviceId: 'billing',
        adminBaseUrl: 'http://billing.internal',
      }]),
    )
    const fetchStub = stub(
      globalThis,
      'fetch',
      (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              resourceType: 'templates',
              generatedAt: '',
              items: [
                {
                  channel: 'email',
                  name: 'generic',
                  hbs: '<p>hi</p>',
                  hash: 'h1',
                  active: true,
                },
                // Derived — no own hbs, renders through `parent`.
                {
                  channel: 'email',
                  name: 'welcome',
                  parent: 'generic',
                  hash: 'h2',
                  active: true,
                },
                // Soft-deleted.
                {
                  channel: 'email',
                  name: 'old',
                  hbs: '<p>stale</p>',
                  hash: 'h3',
                  active: false,
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )) as never,
    )
    const syncCalls: unknown[] = []
    const providersStub = stubSyncCodeTemplates(syncCalls)

    try {
      await syncTemplatesFromRegisteredService('billing', 'admin-1')

      assertEquals(syncCalls, [
        [
          [{ channel: 'email', name: 'generic', hbs: '<p>hi</p>', hash: 'h1' }],
          'admin-1',
        ],
      ])
    } finally {
      fetchStub.restore()
      providersStub.restore()
    }
  },
})

Deno.test({
  name:
    "syncTemplatesFromRegisteredService: 'templates' succeeding with zero usable entries is respected as-is — never falls back to code-templates",
  fn: async () => {
    // A `200` with nothing usable (empty, or only content-less derived stubs) is deliberately
    // NOT treated as a reason to try `'code-templates'` too — it's indistinguishable, from here,
    // from a target that genuinely has zero active templates by its own choice (deleted them,
    // never populated them, doesn't want the central defaults imposed on it). Falling back in that
    // case would silently resurrect code content the target doesn't want synced. (It can also
    // happen transiently right after a Mode A/B target boots, before its own lazy
    // `LocalTemplateBackend` sync has run — that's an accepted, narrow race, not a reason to guess.)
    setServiceRegistry(
      new ServiceRegistry([{
        serviceId: 'billing',
        adminBaseUrl: 'http://billing.internal',
      }]),
    )
    const fetchStub = stub(
      globalThis,
      'fetch',
      ((input: unknown) => {
        const url = String(input)
        if (url.endsWith('/.well-known/zanix/code-templates')) {
          throw new Error(
            'code-templates should never be fetched when templates succeeds',
          )
        }
        // A derived-template stub with no own `hbs` — filtered out by `toSyncCodeTemplateEntries`,
        // leaving zero usable entries despite the 200.
        return Promise.resolve(
          new Response(
            JSON.stringify({
              resourceType: 'templates',
              generatedAt: '',
              items: [{
                channel: 'email',
                name: 'welcome',
                parent: 'generic',
                active: true,
              }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }) as never,
    )
    const syncCalls: unknown[] = []
    const providersStub = stubSyncCodeTemplates(syncCalls)

    try {
      await syncTemplatesFromRegisteredService('billing', 'admin-1')

      assertEquals(syncCalls, [[[], 'admin-1']])
      assertEquals(fetchStub.calls.length, 1)
    } finally {
      fetchStub.restore()
      providersStub.restore()
    }
  },
})

Deno.test({
  name:
    "syncTemplatesFromRegisteredService: 'templates' 401/403 (unauthorized for that specific resource) also falls back to code-templates",
  fn: async () => {
    setServiceRegistry(
      new ServiceRegistry([{
        serviceId: 'billing',
        adminBaseUrl: 'http://billing.internal',
      }]),
    )
    const fetchStub = stub(
      globalThis,
      'fetch',
      ((input: unknown) => {
        const url = String(input)
        if (url.endsWith('/.well-known/zanix/templates')) {
          return Promise.resolve(new Response('forbidden', { status: 403 }))
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              resourceType: 'code-templates',
              generatedAt: '',
              items: [{
                channel: 'sms',
                name: 'otp',
                hbs: 'code: {{code}}',
                hash: 'h9',
              }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }) as never,
    )
    const syncCalls: unknown[] = []
    const providersStub = stubSyncCodeTemplates(syncCalls)

    try {
      await syncTemplatesFromRegisteredService('billing', 'admin-1')
      assertEquals(syncCalls, [
        [
          [{ channel: 'sms', name: 'otp', hbs: 'code: {{code}}', hash: 'h9' }],
          'admin-1',
        ],
      ])
    } finally {
      fetchStub.restore()
      providersStub.restore()
    }
  },
})

Deno.test({
  name:
    "syncTemplatesFromRegisteredService: a genuine failure on 'templates' (e.g. 500/network error) propagates — never silently falls back",
  fn: async () => {
    setServiceRegistry(
      new ServiceRegistry([{
        serviceId: 'billing',
        adminBaseUrl: 'http://billing.internal',
      }]),
    )
    const fetchStub = stub(
      globalThis,
      'fetch',
      (() =>
        Promise.resolve(
          new Response('server exploded', { status: 500 }),
        )) as never,
    )
    const providersStub = stubSyncCodeTemplates([])

    try {
      await assertRejects(
        () => syncTemplatesFromRegisteredService('billing', 'admin-1'),
        HttpError,
      )
      // Only the 'templates' attempt happened — no fallback attempt for a non-404/401/403 failure.
      assertEquals(fetchStub.calls.length, 1)
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
      new ServiceRegistry([{
        serviceId: 'billing',
        adminBaseUrl: 'http://billing.internal',
      }]),
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
        // A single 200 (whichever resourceType is requested first — 'templates' — succeeds with
        // no items) is enough here; this test only cares about the forwarded auth header, not
        // which resource ends up being used.
        return Promise.resolve(
          new Response(
            JSON.stringify({
              resourceType: 'templates',
              generatedAt: '',
              items: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ) as never
      },
    )
    const providersStub = stubSyncCodeTemplates([])

    try {
      await syncTemplatesFromRegisteredService('billing', 'admin-1')
      assertEquals(
        capturedHeaders?.['X-Znx-Authorization'],
        'Bearer test-token',
      )
    } finally {
      fetchStub.restore()
      providersStub.restore()
      setTemplatesDiscoveryClientFactory((service) =>
        new DiscoveryAdminClient({ baseUrl: service.adminBaseUrl })
      )
    }
  },
})

Deno.test({
  name:
    'setTemplatesDiscoveryClientFactory: an ASYNC factory (e.g. one that signs+exchanges a real credential) is awaited before use',
  fn: async () => {
    setServiceRegistry(
      new ServiceRegistry([{
        serviceId: 'billing',
        adminBaseUrl: 'http://billing.internal',
      }]),
    )

    const asyncFactory: TemplatesDiscoveryClientFactory = async (service) => {
      await Promise.resolve() // simulates the real sign+exchange network hop
      return new DiscoveryAdminClient({
        baseUrl: service.adminBaseUrl,
        headers: { 'X-Znx-Authorization': 'Bearer async-token' },
      })
    }
    setTemplatesDiscoveryClientFactory(asyncFactory)

    let capturedHeaders: Record<string, string> | undefined
    const fetchStub = stub(
      globalThis,
      'fetch',
      (_url: unknown, init?: any) => {
        capturedHeaders = init?.headers
        // A single 200 (whichever resourceType is requested first — 'templates' — succeeds with
        // no items) is enough here; this test only cares about the forwarded auth header, not
        // which resource ends up being used.
        return Promise.resolve(
          new Response(
            JSON.stringify({
              resourceType: 'templates',
              generatedAt: '',
              items: [],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ) as never
      },
    )
    const providersStub = stubSyncCodeTemplates([])

    try {
      await syncTemplatesFromRegisteredService('billing', 'admin-1')
      assertEquals(
        capturedHeaders?.['X-Znx-Authorization'],
        'Bearer async-token',
      )
    } finally {
      fetchStub.restore()
      providersStub.restore()
      setTemplatesDiscoveryClientFactory((service) =>
        new DiscoveryAdminClient({ baseUrl: service.adminBaseUrl })
      )
    }
  },
})
