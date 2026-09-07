// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from '@std/assert'
import { ServiceRegistry } from 'modules/registry/registry.ts'
import { fanOutDiscovery } from 'modules/discovery/discovery.fan-out.ts'

function fakeDiscoveryClient(snapshot: (...args: any[]) => any): any {
  return { snapshot } as never
}

const registry = new ServiceRegistry([
  { serviceId: 'billing', adminBaseUrl: 'http://billing.internal' },
  { serviceId: 'inventory', adminBaseUrl: 'http://inventory.internal' },
])

Deno.test('fanOutDiscovery fetches every registered service, tagged by serviceId', async () => {
  const result = await fanOutDiscovery<{ model: string }>(
    registry,
    (service) =>
      fakeDiscoveryClient(() => Promise.resolve([{ model: `${service.serviceId}-model` }])),
    'triggers',
    () => {},
  )

  assertEquals(result.map((r) => r.serviceId).sort(), ['billing', 'inventory'])
})

Deno.test('fanOutDiscovery returns an empty array when nothing is registered', async () => {
  const result = await fanOutDiscovery(
    new ServiceRegistry([]),
    () => fakeDiscoveryClient(() => Promise.resolve([])),
    'triggers',
    () => {},
  )

  assertEquals(result, [])
})

Deno.test('fanOutDiscovery (default, tolerant) calls onError and SKIPS a failing service, still returning the rest', async () => {
  const boom = new Error('network down')
  const errors: unknown[] = []

  const result = await fanOutDiscovery<{ model: string }>(
    registry,
    (service) =>
      service.serviceId === 'billing'
        ? fakeDiscoveryClient(() => Promise.reject(boom))
        : fakeDiscoveryClient(() => Promise.resolve([{ model: 'Item' }])),
    'triggers',
    (service, error) => errors.push([service.serviceId, error]),
  )

  assertEquals(result, [{ model: 'Item', serviceId: 'inventory' }])
  assertEquals(errors, [['billing', boom]])
})

Deno.test('fanOutDiscovery ({ strict: true }) rethrows the first failure unchanged, discarding the rest', async () => {
  const boom = new Error('network down')
  const errors: unknown[] = []

  const rejected = await assertRejects(
    () =>
      fanOutDiscovery<{ model: string }>(
        registry,
        (service) =>
          service.serviceId === 'billing'
            ? fakeDiscoveryClient(() => Promise.reject(boom))
            : fakeDiscoveryClient(() => Promise.resolve([{ model: 'Item' }])),
        'triggers',
        (service, error) => errors.push([service.serviceId, error]),
        { strict: true },
      ),
  )

  assertEquals(rejected, boom)
  assertEquals(errors, [['billing', boom]])
})

Deno.test('fanOutDiscovery awaits an async discoveryClientFactory before using the client', async () => {
  const result = await fanOutDiscovery<{ model: string }>(
    registry,
    (service) =>
      Promise.resolve(
        fakeDiscoveryClient(() => Promise.resolve([{ model: `${service.serviceId}-model` }])),
      ),
    'triggers',
    () => {},
  )

  assertEquals(result.map((r) => r.serviceId).sort(), ['billing', 'inventory'])
})
