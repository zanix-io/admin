// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { InternalError } from '@zanix/errors'
import { ServiceRegistry } from 'modules/registry/registry.ts'
import {
  type AggregatedTrigger,
  getTriggersAggregator,
  setTriggersAggregator,
  TriggersAggregator,
  type TriggersClientFactory,
  type TriggersDiscoveryClientFactory,
} from 'modules/triggers/triggers.aggregator.ts'

console.error = () => {}

function fakeClient(overrides: Partial<Record<string, (...args: any[]) => any>> = {}): any {
  return {
    list: overrides.list ?? (() => Promise.resolve([])),
    get: overrides.get ?? (() => Promise.resolve({} as never)),
    create: overrides.create ?? (() => Promise.resolve({} as never)),
    update: overrides.update ?? (() => Promise.resolve({} as never)),
    remove: overrides.remove ?? (() => Promise.resolve()),
  } as never
}

function fakeDiscoveryClient(snapshot: (...args: any[]) => any): any {
  return { snapshot } as never
}

const registry = new ServiceRegistry([
  { serviceId: 'billing', adminBaseUrl: 'http://billing.internal' },
  { serviceId: 'inventory', adminBaseUrl: 'http://inventory.internal' },
])

const TRIGGER_DEFAULTS = { active: true, triggers: {}, isDefault: false }

Deno.test('TriggersAggregator.list fans out via Discovery, tagged by serviceId', async () => {
  const calls: string[] = []
  const discoveryClientFactory: TriggersDiscoveryClientFactory = (service) => {
    calls.push(service.serviceId)
    return fakeDiscoveryClient((resourceType: string) => {
      assertEquals(resourceType, 'triggers')
      return Promise.resolve(
        service.serviceId === 'billing'
          ? [{ model: 'Invoice', ...TRIGGER_DEFAULTS }]
          : [{ model: 'Item', ...TRIGGER_DEFAULTS }],
      )
    })
  }

  const aggregator = new TriggersAggregator(registry, undefined, discoveryClientFactory)
  const result: AggregatedTrigger[] = await aggregator.list()

  assertEquals(calls, ['billing', 'inventory'])
  assertEquals(result, [
    { model: 'Invoice', ...TRIGGER_DEFAULTS, serviceId: 'billing' },
    { model: 'Item', ...TRIGGER_DEFAULTS, serviceId: 'inventory' },
  ])
})

Deno.test('TriggersAggregator.list returns an empty array when nothing is registered', async () => {
  const aggregator = new TriggersAggregator(new ServiceRegistry([]))

  assertEquals(await aggregator.list(), [])
})

Deno.test('TriggersAggregator.get proxies only to the resolved service', async () => {
  const calls: string[] = []
  const clientFactory: TriggersClientFactory = (service) => {
    return fakeClient({
      get: (model: string) => (calls.push(`${service.serviceId}:${model}`),
        Promise.resolve({
          model,
          ...TRIGGER_DEFAULTS,
        })),
    })
  }

  const aggregator = new TriggersAggregator(registry, clientFactory)
  const result = await aggregator.get('inventory', 'Item')

  assertEquals(result, { model: 'Item', ...TRIGGER_DEFAULTS })
  assertEquals(calls, ['inventory:Item'])
})

Deno.test({
  name:
    'TriggersAggregator: both factories may return a Promise (e.g. an async, credential-exchanging factory) — list()/get() await it before using the client',
  fn: async () => {
    // deno-lint-ignore require-await
    const discoveryClientFactory: TriggersDiscoveryClientFactory = async (service) =>
      fakeDiscoveryClient(() => Promise.resolve([{ model: `${service.serviceId}-model` }]))
    // deno-lint-ignore require-await
    const clientFactory: TriggersClientFactory = async (service) =>
      fakeClient({ get: () => Promise.resolve({ model: `${service.serviceId}-model` }) })

    const aggregator = new TriggersAggregator(registry, clientFactory, discoveryClientFactory)

    const listed = await aggregator.list()
    assertEquals(listed.map((t) => t.serviceId).sort(), ['billing', 'inventory'])
    assertEquals(listed.map((t) => (t as never as { model: string }).model).sort(), [
      'billing-model',
      'inventory-model',
    ])

    const got = await aggregator.get('billing', 'Invoice')
    assertEquals(got, { model: 'billing-model' } as never)
  },
})

Deno.test('TriggersAggregator.create forwards model/active/triggers', async () => {
  const calls: unknown[] = []
  const clientFactory: TriggersClientFactory = () =>
    fakeClient({
      create: (...args: unknown[]) => (calls.push(args), Promise.resolve({ ok: true } as never)),
    })

  const aggregator = new TriggersAggregator(registry, clientFactory)
  const result = await aggregator.create('billing', {
    model: 'Invoice',
    active: true,
    triggers: { pre: [] } as never,
  })

  assertEquals(result, { ok: true } as never)
  assertEquals(calls, [[{ model: 'Invoice', active: true, triggers: { pre: [] } }]])
})

Deno.test('TriggersAggregator.update forwards model/changes to the resolved service', async () => {
  const calls: unknown[] = []
  const clientFactory: TriggersClientFactory = () =>
    fakeClient({
      update: (...args: unknown[]) => (calls.push(args), Promise.resolve({ ok: true })),
    })

  const aggregator = new TriggersAggregator(registry, clientFactory)
  await aggregator.update('billing', 'Invoice', { active: false })

  assertEquals(calls, [['Invoice', { active: false }]])
})

Deno.test('TriggersAggregator.remove forwards model to the resolved service', async () => {
  const calls: unknown[] = []
  const clientFactory: TriggersClientFactory = () =>
    fakeClient({
      remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()),
    })

  const aggregator = new TriggersAggregator(registry, clientFactory)
  await aggregator.remove('billing', 'Invoice')

  assertEquals(calls, [['Invoice']])
})

Deno.test({
  name: 'TriggersAggregator.get throws for an unregistered service, never calls a client',
  fn: async () => {
    let called = false
    const clientFactory: TriggersClientFactory = () => {
      called = true
      return fakeClient()
    }

    const aggregator = new TriggersAggregator(registry, clientFactory)

    // `get()` is `async` (its factory may need to `await` a real credential exchange), so a
    // synchronous failure like "unregistered service" now surfaces as a rejected Promise, not a
    // synchronous throw — `assertRejects`, not `assertThrows`.
    await assertRejects(() => aggregator.get('unknown-service', 'Invoice'), InternalError)
    assertEquals(called, false)
  },
})

Deno.test({
  name:
    'TriggersAggregator defaults to an unauthenticated TriggersAdminClient when no factory is given',
  fn: async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response(JSON.stringify({ model: 'Invoice', ...TRIGGER_DEFAULTS }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ) as never,
    )

    try {
      const aggregator = new TriggersAggregator(registry)
      const result = await aggregator.get('billing', 'Invoice')

      assertEquals(result, { model: 'Invoice', ...TRIGGER_DEFAULTS })
      assertEquals(fetchStub.calls.length, 1)
      assert(String(fetchStub.calls[0].args[0]).startsWith('http://billing.internal'))
    } finally {
      fetchStub.restore()
    }
  },
})

Deno.test({
  name: 'TriggersAggregator.list defaults to an unauthenticated DiscoveryAdminClient',
  fn: async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              resourceType: 'triggers',
              generatedAt: '2026-01-01T00:00:00.000Z',
              items: [{ model: 'Invoice', ...TRIGGER_DEFAULTS }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ) as never,
    )

    try {
      const aggregator = new TriggersAggregator(
        new ServiceRegistry([
          { serviceId: 'billing', adminBaseUrl: 'http://billing.internal' },
        ]),
      )
      const result = await aggregator.list()

      assertEquals(result, [{ model: 'Invoice', ...TRIGGER_DEFAULTS, serviceId: 'billing' }])
      assertEquals(fetchStub.calls.length, 1)
      assert(
        String(fetchStub.calls[0].args[0]).startsWith(
          'http://billing.internal/.well-known/zanix/triggers',
        ),
      )
    } finally {
      fetchStub.restore()
    }
  },
})

Deno.test('getTriggersAggregator lazily builds a default instance when none was installed', () => {
  const aggregator = getTriggersAggregator()

  assert(aggregator instanceof TriggersAggregator)
})

Deno.test('setTriggersAggregator installs the exact instance getTriggersAggregator returns', () => {
  const installed = new TriggersAggregator(registry)
  setTriggersAggregator(installed)

  assertEquals(getTriggersAggregator(), installed)
})
