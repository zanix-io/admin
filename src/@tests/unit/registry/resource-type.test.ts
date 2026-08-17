import { assert, assertEquals, assertStrictEquals } from '@std/assert'
import { getResourceFactory } from '@zanix/app/runtime'
import { getServiceRegistry, setServiceRegistry } from 'modules/registry/registry.ts'
import { ServiceRegistry } from 'modules/registry/registry.ts'
import '../../../modules/registry/resource-type.ts'

console.error = () => {}

function getFactory() {
  const factory = getResourceFactory('service-registry')
  assert(factory, "'service-registry' must be registered")
  return factory
}

Deno.test({
  name:
    'service-registry resource type: no explicit entries reuses whatever getServiceRegistry() already resolves — never clobbers a pre-installed registry',
  fn: async () => {
    const preInstalled = new ServiceRegistry([
      { serviceId: 'billing', adminBaseUrl: 'http://billing.internal' },
    ])
    setServiceRegistry(preInstalled)

    const resolved = await getFactory()({})

    assertStrictEquals(resolved, preInstalled)
    assert((resolved as unknown as ServiceRegistry).has('billing'))
  },
})

Deno.test({
  name:
    'service-registry resource type: explicit options.entries builds and installs a fresh instance instead of reusing the current singleton',
  fn: async () => {
    const preInstalled = new ServiceRegistry([
      { serviceId: 'billing', adminBaseUrl: 'http://billing.internal' },
    ])
    setServiceRegistry(preInstalled)

    const resolved = await getFactory()({
      entries: [{
        serviceId: 'inventory',
        adminBaseUrl: 'http://inventory.internal',
      }],
    })

    assert(
      (resolved as unknown) !== preInstalled,
      'a fresh instance must be built, not the pre-installed one',
    )
    assert((resolved as unknown as ServiceRegistry).has('inventory'))
    assertStrictEquals(
      getServiceRegistry(),
      resolved,
      'the fresh instance replaces the singleton',
    )
  },
})

Deno.test({
  name:
    'service-registry resource type: the resolved instance satisfies CloseableResource with a no-op close()',
  fn: async () => {
    const resolved = await getFactory()({
      entries: [{
        serviceId: 'billing',
        adminBaseUrl: 'http://billing.internal',
      }],
    })

    await (resolved as unknown as { close(): Promise<void> | void }).close()
    assertEquals(
      typeof (resolved as unknown as { close: unknown }).close,
      'function',
    )
  },
})
