import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { checkServiceRegistryReachability, realHttpStatus } from 'modules/registry/reachability.ts'
import { ServiceRegistry } from 'modules/registry/registry.ts'

console.error = () => {}
stub(console, 'warn')

globalThis.fetch = () => {
  throw new Error('fetch not mocked')
}

const httpResponse = (status: number, statusText: string) =>
  Promise.resolve(new Response(statusText, { status, statusText }))

Deno.test('checkServiceRegistryReachability: a 4xx rejection is ok', async () => {
  globalThis.fetch = (() => httpResponse(400, 'Bad Request')) as unknown as typeof fetch

  const registry = new ServiceRegistry([{
    serviceId: 'billing',
    adminBaseUrl: 'http://billing.internal',
  }])
  const results = await checkServiceRegistryReachability({ registry })

  assertEquals(results, [{
    serviceId: 'billing',
    adminBaseUrl: 'http://billing.internal',
    status: 'ok',
    httpStatus: 400,
  }])
})

Deno.test('checkServiceRegistryReachability: classifies a 404 as misconfigured', async () => {
  globalThis.fetch = (() => httpResponse(404, 'Not Found')) as unknown as typeof fetch

  const registry = new ServiceRegistry([{
    serviceId: 'billing',
    adminBaseUrl: 'http://billing.internal',
  }])
  const results = await checkServiceRegistryReachability({ registry })

  assertEquals(results, [{
    serviceId: 'billing',
    adminBaseUrl: 'http://billing.internal',
    status: 'misconfigured',
    httpStatus: 404,
  }])
})

Deno.test('checkServiceRegistryReachability: a network error is unreachable', async () => {
  globalThis.fetch = (() =>
    Promise.reject(
      new TypeError('network error'),
    )) as unknown as typeof fetch

  const registry = new ServiceRegistry([{
    serviceId: 'billing',
    adminBaseUrl: 'http://billing.internal',
  }])
  const results = await checkServiceRegistryReachability({ registry })

  assertEquals(results, [{
    serviceId: 'billing',
    adminBaseUrl: 'http://billing.internal',
    status: 'unreachable',
    httpStatus: undefined,
  }])
})

Deno.test('checkServiceRegistryReachability: classifies a 5xx as unexpected', async () => {
  globalThis.fetch = (() => httpResponse(500, 'Internal Server Error')) as unknown as typeof fetch

  const registry = new ServiceRegistry([{
    serviceId: 'billing',
    adminBaseUrl: 'http://billing.internal',
  }])
  const results = await checkServiceRegistryReachability({ registry })

  assertEquals(results, [{
    serviceId: 'billing',
    adminBaseUrl: 'http://billing.internal',
    status: 'unexpected',
    httpStatus: 500,
  }])
})

Deno.test({
  name:
    'checkServiceRegistryReachability: a 2xx (the probe assertion somehow accepted) is unexpected',
  fn: async () => {
    globalThis.fetch = (() => httpResponse(200, 'OK')) as unknown as typeof fetch

    const registry = new ServiceRegistry([{
      serviceId: 'billing',
      adminBaseUrl: 'http://billing.internal',
    }])
    const results = await checkServiceRegistryReachability({ registry })

    assertEquals(results, [{
      serviceId: 'billing',
      adminBaseUrl: 'http://billing.internal',
      status: 'unexpected',
    }])
  },
})

Deno.test('realHttpStatus: undefined for anything that is not a RestClientError', () => {
  // Every `checkServiceRegistryReachability` test above only ever feeds this a real
  // `RestClientError` (thrown by `RestClient` itself, since `httpResponse`'s Response always
  // resolves) — the plain-`Error`/non-`RestClientError` branch (the exact scenario this helper's
  // own doc calls out as an equally-`undefined` case, for `templates-sync.ts`'s reuse) is only
  // reachable by calling the exported helper directly.
  assertEquals(realHttpStatus(new Error('boom')), undefined)
  assertEquals(realHttpStatus('not an error at all'), undefined)
})

Deno.test('checkServiceRegistryReachability: never throws when every entry fails', async () => {
  const registry = new ServiceRegistry([
    { serviceId: 'billing', adminBaseUrl: 'http://billing.internal' },
    { serviceId: 'inventory', adminBaseUrl: 'http://inventory.internal' },
  ])
  let call = 0
  globalThis.fetch = (() => {
    call++
    return call === 1
      ? Promise.reject(new TypeError('network error'))
      : httpResponse(404, 'Not Found')
  }) as unknown as typeof fetch

  const results = await checkServiceRegistryReachability({ registry })

  assertEquals(results.length, 2)
  assert(results.every((r) => r.status !== 'ok'))
})
