// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import { InternalError } from '@zanix/errors'
import logger from '@zanix/logger'
import { ServiceRegistry } from 'modules/registry/registry.ts'
import {
  type AggregatedDlqEntry,
  DlqAggregator,
  type DlqClientFactory,
  type DlqDiscoveryClientFactory,
  getDlqAggregator,
  setDlqAggregator,
} from 'modules/dlq/dlq.aggregator.ts'

console.error = () => {}

function fakeClient(
  overrides: Partial<Record<string, (...args: any[]) => any>> = {},
): any {
  return {
    get: overrides.get ?? (() => Promise.resolve({} as never)),
    push: overrides.push ?? (() => Promise.resolve({} as never)),
    requeue: overrides.requeue ?? (() => Promise.resolve({} as never)),
    discard: overrides.discard ?? (() => Promise.resolve({} as never)),
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

const DLQ_DEFAULTS = {
  processType: 'payment.process',
  origin: 'billing',
  payload: { orderId: 'o-1' },
  error: { name: 'Error', message: 'boom' },
  errorHistory: [] as never[],
  attempts: 1,
  status: 'pending' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

// Same fields, but `createdAt`/`updatedAt` as the ISO strings a real HTTP round-trip actually
// produces (`JSON.stringify`/`JSON.parse` always serialize a `Date` to a string) — used only by the
// two tests below that go through a real (stubbed) `fetch`, unlike every other test in this file,
// which hands `DLQ_DEFAULTS` straight to an in-memory fake client/discovery client with no
// serialization step in between.
const DLQ_WIRE_DEFAULTS = {
  ...DLQ_DEFAULTS,
  createdAt: DLQ_DEFAULTS.createdAt.toISOString(),
  updatedAt: DLQ_DEFAULTS.updatedAt.toISOString(),
}

Deno.test('DlqAggregator.list fans out via Discovery, tagged by serviceId', async () => {
  const calls: string[] = []
  const discoveryClientFactory: DlqDiscoveryClientFactory = (service) => {
    calls.push(service.serviceId)
    return fakeDiscoveryClient((resourceType: string) => {
      assertEquals(resourceType, 'dlq')
      return Promise.resolve(
        service.serviceId === 'billing'
          ? [{ _id: 'e1', ...DLQ_DEFAULTS }]
          : [{ _id: 'e2', ...DLQ_DEFAULTS }],
      )
    })
  }

  const aggregator = new DlqAggregator(registry, undefined, discoveryClientFactory)
  const result: AggregatedDlqEntry[] = await aggregator.list()

  assertEquals(calls, ['billing', 'inventory'])
  assertEquals(result, [
    { _id: 'e1', ...DLQ_DEFAULTS, serviceId: 'billing' },
    { _id: 'e2', ...DLQ_DEFAULTS, serviceId: 'inventory' },
  ])
})

Deno.test('DlqAggregator.list returns an empty array when nothing is registered', async () => {
  const aggregator = new DlqAggregator(new ServiceRegistry([]))

  assertEquals(await aggregator.list(), [])
})

Deno.test('DlqAggregator.get proxies only to the resolved service', async () => {
  const calls: string[] = []
  const clientFactory: DlqClientFactory = (service) => {
    return fakeClient({
      get: (id: string) => (
        calls.push(`${service.serviceId}:${id}`), Promise.resolve({ _id: id, ...DLQ_DEFAULTS })
      ),
    })
  }

  const aggregator = new DlqAggregator(registry, clientFactory)
  const result = await aggregator.get('inventory', 'e2')

  assertEquals(result, { _id: 'e2', ...DLQ_DEFAULTS })
  assertEquals(calls, ['inventory:e2'])
})

Deno.test({
  name:
    'DlqAggregator: both factories may return a Promise (e.g. an async, credential-exchanging factory) — list()/get() await it before using the client',
  fn: async () => {
    // deno-lint-ignore require-await
    const discoveryClientFactory: DlqDiscoveryClientFactory = async (service) =>
      fakeDiscoveryClient(() => Promise.resolve([{ _id: `${service.serviceId}-entry` }]))
    // deno-lint-ignore require-await
    const clientFactory: DlqClientFactory = async (service) =>
      fakeClient({
        get: () => Promise.resolve({ _id: `${service.serviceId}-entry` }),
      })

    const aggregator = new DlqAggregator(registry, clientFactory, discoveryClientFactory)

    const listed = await aggregator.list()
    assertEquals(listed.map((e) => e.serviceId).sort(), ['billing', 'inventory'])
    assertEquals(
      listed.map((e) => (e as never as { _id: string })._id).sort(),
      ['billing-entry', 'inventory-entry'],
    )

    const got = await aggregator.get('billing', 'e1')
    assertEquals(got, { _id: 'billing-entry' } as never)
  },
})

Deno.test('DlqAggregator.push forwards the given input', async () => {
  const calls: unknown[] = []
  const clientFactory: DlqClientFactory = () =>
    fakeClient({
      push: (...args: unknown[]) => (calls.push(args), Promise.resolve({ ok: true } as never)),
    })

  const aggregator = new DlqAggregator(registry, clientFactory)
  const result = await aggregator.push('billing', {
    processType: 'payment.process',
    origin: 'billing',
    payload: { orderId: 'o-1' },
    error: { name: 'Error', message: 'boom' },
  })

  assertEquals(result, { ok: true } as never)
  assertEquals(calls, [[{
    processType: 'payment.process',
    origin: 'billing',
    payload: { orderId: 'o-1' },
    error: { name: 'Error', message: 'boom' },
  }]])
})

Deno.test('DlqAggregator.requeue forwards id/options to the resolved service', async () => {
  const calls: unknown[] = []
  const clientFactory: DlqClientFactory = () =>
    fakeClient({
      requeue: (...args: unknown[]) => (calls.push(args), Promise.resolve({ ok: true })),
    })

  const aggregator = new DlqAggregator(registry, clientFactory)
  await aggregator.requeue('billing', 'e1', { resetAttempts: true })

  assertEquals(calls, [['e1', { resetAttempts: true }]])
})

Deno.test('DlqAggregator.discard forwards id/options to the resolved service', async () => {
  const calls: unknown[] = []
  const clientFactory: DlqClientFactory = () =>
    fakeClient({
      discard: (...args: unknown[]) => (calls.push(args), Promise.resolve({ ok: true })),
    })

  const aggregator = new DlqAggregator(registry, clientFactory)
  await aggregator.discard('billing', 'e1', { reason: 'stale' })

  assertEquals(calls, [['e1', { reason: 'stale' }]])
})

Deno.test('DlqAggregator.remove forwards id to the resolved service', async () => {
  const calls: unknown[] = []
  const clientFactory: DlqClientFactory = () =>
    fakeClient({
      remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()),
    })

  const aggregator = new DlqAggregator(registry, clientFactory)
  await aggregator.remove('billing', 'e1')

  assertEquals(calls, [['e1']])
})

Deno.test({
  name: 'DlqAggregator.get throws for an unregistered service, never calls a client',
  fn: async () => {
    let called = false
    const clientFactory: DlqClientFactory = () => {
      called = true
      return fakeClient()
    }

    const aggregator = new DlqAggregator(registry, clientFactory)

    // `get()` is `async` (its factory may need to `await` a real credential exchange), so a
    // synchronous failure like "unregistered service" now surfaces as a rejected Promise, not a
    // synchronous throw — `assertRejects`, not `assertThrows`.
    await assertRejects(
      () => aggregator.get('unknown-service', 'e1'),
      InternalError,
    )
    assertEquals(called, false)
  },
})

Deno.test({
  name: 'DlqAggregator defaults to an unauthenticated DlqAdminClient when no factory is given',
  fn: async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ _id: 'e1', ...DLQ_WIRE_DEFAULTS }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ) as never,
    )

    try {
      const aggregator = new DlqAggregator(registry)
      const result = await aggregator.get('billing', 'e1')

      assertEquals(result, { _id: 'e1', ...DLQ_WIRE_DEFAULTS } as never)
      assertEquals(fetchStub.calls.length, 1)
      assert(
        String(fetchStub.calls[0].args[0]).startsWith('http://billing.internal'),
      )
    } finally {
      fetchStub.restore()
    }
  },
})

Deno.test({
  name: 'DlqAggregator.list defaults to an unauthenticated DiscoveryAdminClient',
  fn: async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              resourceType: 'dlq',
              generatedAt: '2026-01-01T00:00:00.000Z',
              items: [{ _id: 'e1', ...DLQ_WIRE_DEFAULTS }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ) as never,
    )

    try {
      const aggregator = new DlqAggregator(
        new ServiceRegistry([
          { serviceId: 'billing', adminBaseUrl: 'http://billing.internal' },
        ]),
      )
      const result = await aggregator.list()

      assertEquals(result, [{ _id: 'e1', ...DLQ_WIRE_DEFAULTS, serviceId: 'billing' }] as never)
      assertEquals(fetchStub.calls.length, 1)
      assert(
        String(fetchStub.calls[0].args[0]).startsWith(
          'http://billing.internal/.well-known/zanix/dlq',
        ),
      )
    } finally {
      fetchStub.restore()
    }
  },
})

Deno.test({
  name:
    "DlqAggregator.list logs (logger.error) and rethrows unchanged when one service's Discovery fetch fails",
  fn: async () => {
    const boom = new Error('network down')
    const discoveryClientFactory: DlqDiscoveryClientFactory = () =>
      fakeDiscoveryClient(() => Promise.reject(boom))
    const errorStub = stub(logger, 'error')

    try {
      const aggregator = new DlqAggregator(
        new ServiceRegistry([{ serviceId: 'billing', adminBaseUrl: 'http://billing.internal' }]),
        undefined,
        discoveryClientFactory,
      )

      const rejected = await assertRejects(() => aggregator.list())
      assertEquals(rejected, boom)

      assertEquals(errorStub.calls.length, 1)
      assertEquals(errorStub.calls[0].args[1], boom)
      const message = String(errorStub.calls[0].args[0])
      assert(message.includes('ADMIN_DLQ_DISCOVERY_FAILED'))
      assert(message.includes('billing'))
    } finally {
      errorStub.restore()
    }
  },
})

Deno.test({
  name: 'DlqAggregator.get logs (logger.error) and rethrows unchanged when the proxy call fails',
  fn: async () => {
    const boom = new Error('service unreachable')
    const clientFactory: DlqClientFactory = () => fakeClient({ get: () => Promise.reject(boom) })
    const errorStub = stub(logger, 'error')

    try {
      const aggregator = new DlqAggregator(registry, clientFactory)

      const rejected = await assertRejects(() => aggregator.get('billing', 'e1'))
      assertEquals(rejected, boom)

      assertEquals(errorStub.calls.length, 1)
      assertEquals(errorStub.calls[0].args[1], boom)
      const message = String(errorStub.calls[0].args[0])
      assert(message.includes('ADMIN_DLQ_PROXY_FAILED'))
      assert(message.includes('billing'))
      assert(message.includes('e1'))
    } finally {
      errorStub.restore()
    }
  },
})

Deno.test({
  name: 'DlqAggregator.push logs (logger.error) and rethrows unchanged when the proxy call fails',
  fn: async () => {
    const boom = new Error('service unreachable')
    const clientFactory: DlqClientFactory = () => fakeClient({ push: () => Promise.reject(boom) })
    const errorStub = stub(logger, 'error')

    try {
      const aggregator = new DlqAggregator(registry, clientFactory)

      const rejected = await assertRejects(
        () =>
          aggregator.push('billing', {
            processType: 'payment.process',
            origin: 'billing',
            payload: { orderId: 'o-1' },
            error: { name: 'Error', message: 'boom' },
          }),
      )
      assertEquals(rejected, boom)

      assertEquals(errorStub.calls.length, 1)
      assertEquals(errorStub.calls[0].args[1], boom)
      assert(String(errorStub.calls[0].args[0]).includes('ADMIN_DLQ_PROXY_FAILED'))
    } finally {
      errorStub.restore()
    }
  },
})

Deno.test({
  name:
    'DlqAggregator.requeue logs (logger.error) and rethrows unchanged when the proxy call fails',
  fn: async () => {
    const boom = new Error('service unreachable')
    const clientFactory: DlqClientFactory = () =>
      fakeClient({ requeue: () => Promise.reject(boom) })
    const errorStub = stub(logger, 'error')

    try {
      const aggregator = new DlqAggregator(registry, clientFactory)

      const rejected = await assertRejects(() => aggregator.requeue('billing', 'e1'))
      assertEquals(rejected, boom)

      assertEquals(errorStub.calls.length, 1)
      assertEquals(errorStub.calls[0].args[1], boom)
      assert(String(errorStub.calls[0].args[0]).includes('ADMIN_DLQ_PROXY_FAILED'))
    } finally {
      errorStub.restore()
    }
  },
})

Deno.test({
  name:
    'DlqAggregator.discard logs (logger.error) and rethrows unchanged when the proxy call fails',
  fn: async () => {
    const boom = new Error('service unreachable')
    const clientFactory: DlqClientFactory = () =>
      fakeClient({ discard: () => Promise.reject(boom) })
    const errorStub = stub(logger, 'error')

    try {
      const aggregator = new DlqAggregator(registry, clientFactory)

      const rejected = await assertRejects(() => aggregator.discard('billing', 'e1'))
      assertEquals(rejected, boom)

      assertEquals(errorStub.calls.length, 1)
      assertEquals(errorStub.calls[0].args[1], boom)
      assert(String(errorStub.calls[0].args[0]).includes('ADMIN_DLQ_PROXY_FAILED'))
    } finally {
      errorStub.restore()
    }
  },
})

Deno.test({
  name: 'DlqAggregator.remove logs (logger.error) and rethrows unchanged when the proxy call fails',
  fn: async () => {
    const boom = new Error('service unreachable')
    const clientFactory: DlqClientFactory = () => fakeClient({ remove: () => Promise.reject(boom) })
    const errorStub = stub(logger, 'error')

    try {
      const aggregator = new DlqAggregator(registry, clientFactory)

      const rejected = await assertRejects(() => aggregator.remove('billing', 'e1'))
      assertEquals(rejected, boom)

      assertEquals(errorStub.calls.length, 1)
      assertEquals(errorStub.calls[0].args[1], boom)
      assert(String(errorStub.calls[0].args[0]).includes('ADMIN_DLQ_PROXY_FAILED'))
    } finally {
      errorStub.restore()
    }
  },
})

Deno.test('getDlqAggregator lazily builds a default instance when none was installed', () => {
  const aggregator = getDlqAggregator()

  assert(aggregator instanceof DlqAggregator)
})

Deno.test('setDlqAggregator installs the exact instance getDlqAggregator returns', () => {
  const installed = new DlqAggregator(registry)
  setDlqAggregator(installed)

  assertEquals(getDlqAggregator(), installed)
})
