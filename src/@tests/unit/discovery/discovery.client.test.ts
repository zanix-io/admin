// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { assertSpyCalls, spy } from '@std/testing/mock'
import { DiscoveryAdminClient } from 'modules/discovery/discovery.client.ts'

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

Deno.test('DiscoveryAdminClient accepts a bare contextId string (RestClient shape)', () => {
  const client = new DiscoveryAdminClient('svc-context')

  assertEquals(client instanceof DiscoveryAdminClient, true)
})

Deno.test('DiscoveryAdminClient.snapshot GETs the endpoint, unwraps items', async () => {
  const items = [{
    model: 'User',
    active: true,
    triggers: {},
    isDefault: false,
  }]
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({
      resourceType: 'triggers',
      generatedAt: '2026-01-01T00:00:00.000Z',
      items,
    })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DiscoveryAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  const result = await client.snapshot('triggers')

  assertEquals(result, items)
  assertSpyCalls(mockFetch, 1)
  const [url, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/.well-known/zanix/triggers')
  assertEquals(opts.method, 'GET')
  assertEquals(opts.headers['X-Znx-Discovery-Protocol'], '1')
})

Deno.test(
  'DiscoveryAdminClient.snapshot encodes a resourceType containing a path separator',
  async () => {
    const mockFetch = spy((_url: string, _opts: any) =>
      jsonResponse({ resourceType: 'x', generatedAt: '2026-01-01T00:00:00.000Z', items: [] })
    )
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const client = new DiscoveryAdminClient({ baseUrl: 'http://svc.internal:1234' })
    await client.snapshot('../admin/other')

    const [url] = mockFetch.calls[0].args as [string, any]
    assertEquals(url, 'http://svc.internal:1234/.well-known/zanix/..%2Fadmin%2Fother')
  },
)
