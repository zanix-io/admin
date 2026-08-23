// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { assertSpyCalls, spy } from '@std/testing/mock'
import { TriggersHubClient } from 'modules/triggers/triggers-hub.client.ts'

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

const TRIGGER_DEFAULTS = { active: true, triggers: {}, isDefault: false }

Deno.test('TriggersHubClient.list GETs /triggers/list on the hub base URL', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse([{ model: 'User', serviceId: 'billing', ...TRIGGER_DEFAULTS }])
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.list()

  assertEquals(result, [{ model: 'User', serviceId: 'billing', ...TRIGGER_DEFAULTS }])
  assertSpyCalls(mockFetch, 1)
  const [url, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/triggers/list')
  assertEquals(opts.method, 'GET')
})

Deno.test('TriggersHubClient.get GETs /triggers/:serviceId/:model on the hub', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({ model: 'User', ...TRIGGER_DEFAULTS })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.get('billing', 'User')

  assertEquals(result, { model: 'User', ...TRIGGER_DEFAULTS })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/triggers/billing/User')
})

Deno.test('TriggersHubClient.create POSTs /triggers/:serviceId with the input body', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), { model: 'User', active: true, triggers: { pre: {} } })
    return jsonResponse(
      { model: 'User', active: true, triggers: { pre: {} }, isDefault: false },
      201,
    )
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.create('billing', {
    model: 'User',
    active: true,
    triggers: { pre: {} },
  })

  assertEquals(result, { model: 'User', active: true, triggers: { pre: {} }, isDefault: false })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/triggers/billing')
})

Deno.test('TriggersHubClient.update PUTs /triggers/:serviceId/:model changes', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'PUT')
    assertEquals(JSON.parse(opts.body), { active: false })
    return jsonResponse({ model: 'User', ...TRIGGER_DEFAULTS, active: false })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.update('billing', 'User', { active: false })

  assertEquals(result, { model: 'User', ...TRIGGER_DEFAULTS, active: false })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/triggers/billing/User')
})

Deno.test('TriggersHubClient.remove DELETEs /triggers/:serviceId/:model', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ deleted: 'User' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  await client.remove('billing', 'User')

  assertSpyCalls(mockFetch, 1)
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/triggers/billing/User')
})

Deno.test('TriggersHubClient.get encodes serviceId/model containing a path separator', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({ model: 'x', ...TRIGGER_DEFAULTS })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  await client.get('a/b', '../admin/other')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(
    url,
    'http://admin-hub.internal:9000/triggers/a%2Fb/..%2Fadmin%2Fother',
  )
})

Deno.test('TriggersHubClient accepts a bare contextId string (RestClient shape)', () => {
  const client = new TriggersHubClient('hub-context')

  assertEquals(client instanceof TriggersHubClient, true)
})
