// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { assertSpyCalls, spy } from '@std/testing/mock'
import { RegistryHubClient } from 'modules/registry/registry-hub.client.ts'

globalThis.fetch = () => {
  throw new Error('fetch not mocked')
}

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )

Deno.test('RegistryHubClient.list GETs /registry/list on the hub base URL', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse([{ serviceId: 'billing', adminBaseUrl: 'http://billing.internal:30248' }])
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new RegistryHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.list()

  assertEquals(result, [{ serviceId: 'billing', adminBaseUrl: 'http://billing.internal:30248' }])
  assertSpyCalls(mockFetch, 1)
  const [url, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/registry/list')
  assertEquals(opts.method, 'GET')
})

Deno.test('RegistryHubClient accepts a bare contextId string (RestClient shape)', () => {
  const client = new RegistryHubClient('hub-context')

  assertEquals(client instanceof RegistryHubClient, true)
})
