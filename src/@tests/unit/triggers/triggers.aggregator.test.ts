// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertThrows } from '@std/assert'
import { stub } from '@std/testing/mock'
import { InternalError } from '@zanix/errors'
import { ServiceRegistry } from 'modules/registry/registry.ts'
import {
  type AggregatedTrigger,
  getTriggersAggregator,
  setTriggersAggregator,
  TriggersAggregator,
  type TriggersClientFactory,
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

const registry = new ServiceRegistry([
  { serviceId: 'billing', adminBaseUrl: 'http://billing.internal' },
  { serviceId: 'inventory', adminBaseUrl: 'http://inventory.internal' },
])

const TRIGGER_DEFAULTS = { active: true, triggers: {}, isDefault: false }

Deno.test('TriggersAggregator.list fans out, tagging results by serviceId', async () => {
  const calls: string[] = []
  const clientFactory: TriggersClientFactory = (service) => {
    calls.push(service.serviceId)
    return fakeClient({
      list: () =>
        Promise.resolve(
          service.serviceId === 'billing'
            ? [{ model: 'Invoice', ...TRIGGER_DEFAULTS }]
            : [{ model: 'Item', ...TRIGGER_DEFAULTS }],
        ),
    })
  }

  const aggregator = new TriggersAggregator(registry, clientFactory)
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

Deno.test('TriggersAggregator.create forwards model/active/triggers', async () => {
  const calls: unknown[] = []
  const clientFactory: TriggersClientFactory = () =>
    fakeClient({
      create: (...args: unknown[]) => (calls.push(args), Promise.resolve({ ok: true } as never)),
    })

  const aggregator = new TriggersAggregator(registry, clientFactory)
  const result = await aggregator.create('billing', 'Invoice', true, { pre: [] } as never)

  assertEquals(result, { ok: true } as never)
  assertEquals(calls, [['Invoice', true, { pre: [] }]])
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

Deno.test('TriggersAggregator.get throws for an unregistered service, never calls a client', () => {
  let called = false
  const clientFactory: TriggersClientFactory = () => {
    called = true
    return fakeClient()
  }

  const aggregator = new TriggersAggregator(registry, clientFactory)

  assertThrows(() => {
    aggregator.get('unknown-service', 'Invoice')
  }, InternalError)
  assertEquals(called, false)
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

Deno.test('getTriggersAggregator lazily builds a default instance when none was installed', () => {
  const aggregator = getTriggersAggregator()

  assert(aggregator instanceof TriggersAggregator)
})

Deno.test('setTriggersAggregator installs the exact instance getTriggersAggregator returns', () => {
  const installed = new TriggersAggregator(registry)
  setTriggersAggregator(installed)

  assertEquals(getTriggersAggregator(), installed)
})
