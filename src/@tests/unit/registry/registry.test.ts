import { assert, assertEquals, assertFalse, assertThrows } from '@std/assert'
import { InternalError } from '@zanix/errors'
import { SERVICE_REGISTRY_ENV, ServiceRegistry } from 'modules/registry/registry.ts'

console.error = () => {}

Deno.test('ServiceRegistry.get returns a registered entry', () => {
  const registry = new ServiceRegistry([
    {
      serviceId: 'billing',
      adminBaseUrl: 'http://billing.internal:30248/billing-rest',
    },
  ])

  assertEquals(registry.get('billing'), {
    serviceId: 'billing',
    adminBaseUrl: 'http://billing.internal:30248/billing-rest',
  })
})

Deno.test('ServiceRegistry.get throws InternalError for an unregistered serviceId', () => {
  const registry = new ServiceRegistry([])

  assertThrows(
    () => registry.get('unknown'),
    InternalError,
    'No registered service found',
  )
})

Deno.test('ServiceRegistry.has reflects registration without throwing', () => {
  const registry = new ServiceRegistry([
    { serviceId: 'billing', adminBaseUrl: 'http://billing.internal' },
  ])

  assert(registry.has('billing'))
  assertFalse(registry.has('unknown'))
})

Deno.test('ServiceRegistry.list returns every registered entry', () => {
  const registry = new ServiceRegistry([
    { serviceId: 'billing', adminBaseUrl: 'http://billing.internal' },
    {
      serviceId: 'notifications',
      adminBaseUrl: 'http://notifications.internal',
    },
  ])

  assertEquals(registry.list().map((entry) => entry.serviceId), [
    'billing',
    'notifications',
  ])
})

Deno.test('ServiceRegistry merges entries from ZANIX_ADMIN_SERVICES', () => {
  Deno.env.set(
    SERVICE_REGISTRY_ENV,
    JSON.stringify([{
      serviceId: 'from-env',
      adminBaseUrl: 'http://env.internal',
    }]),
  )

  try {
    const registry = new ServiceRegistry([
      { serviceId: 'billing', adminBaseUrl: 'http://billing.internal' },
    ])

    assert(registry.has('billing'))
    assert(registry.has('from-env'))
  } finally {
    Deno.env.delete(SERVICE_REGISTRY_ENV)
  }
})

Deno.test('ServiceRegistry: an env entry overrides a same-serviceId constructor entry', () => {
  Deno.env.set(
    SERVICE_REGISTRY_ENV,
    JSON.stringify([{
      serviceId: 'billing',
      adminBaseUrl: 'http://overridden.internal',
    }]),
  )

  try {
    const registry = new ServiceRegistry([
      { serviceId: 'billing', adminBaseUrl: 'http://original.internal' },
    ])

    assertEquals(
      registry.get('billing').adminBaseUrl,
      'http://overridden.internal',
    )
  } finally {
    Deno.env.delete(SERVICE_REGISTRY_ENV)
  }
})

Deno.test('ServiceRegistry throws InternalError when ZANIX_ADMIN_SERVICES is invalid JSON', () => {
  Deno.env.set(SERVICE_REGISTRY_ENV, 'not-json')

  try {
    assertThrows(
      () => new ServiceRegistry(),
      InternalError,
      'not a valid JSON array',
    )
  } finally {
    Deno.env.delete(SERVICE_REGISTRY_ENV)
  }
})

Deno.test('ServiceRegistry throws InternalError when ZANIX_ADMIN_SERVICES is not an array', () => {
  Deno.env.set(SERVICE_REGISTRY_ENV, JSON.stringify({ serviceId: 'billing' }))

  try {
    assertThrows(
      () => new ServiceRegistry(),
      InternalError,
      'not a valid JSON array',
    )
  } finally {
    Deno.env.delete(SERVICE_REGISTRY_ENV)
  }
})
