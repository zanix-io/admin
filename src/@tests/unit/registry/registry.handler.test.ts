import { assertEquals } from '@std/assert'
import { createRegistryController } from 'modules/registry/registry.handler.ts'
import { ServiceRegistry, setServiceRegistry } from 'modules/registry/registry.ts'

const RegistryController = createRegistryController()
const controller = new RegistryController({ id: 'test-ctx' } as never)

Deno.test('RegistryController.list forwards to the installed ServiceRegistry', async () => {
  setServiceRegistry(
    new ServiceRegistry([
      { serviceId: 'billing', adminBaseUrl: 'http://billing.internal:30248/billing-rest' },
      { serviceId: 'inventory', adminBaseUrl: 'http://inventory.internal:30248/inventory-rest' },
    ]),
  )

  const result = await controller.list()

  assertEquals(result, [
    { serviceId: 'billing', adminBaseUrl: 'http://billing.internal:30248/billing-rest' },
    { serviceId: 'inventory', adminBaseUrl: 'http://inventory.internal:30248/inventory-rest' },
  ])
})

Deno.test('RegistryController.list reflects an empty registry as an empty array', async () => {
  setServiceRegistry(new ServiceRegistry([]))

  const result = await controller.list()

  assertEquals(result, [])
})
