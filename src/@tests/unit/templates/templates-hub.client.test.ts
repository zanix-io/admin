// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { assertSpyCalls, spy } from '@std/testing/mock'
import { TemplatesHubClient } from 'modules/templates/templates-hub.client.ts'

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

const TEMPLATE_DEFAULTS = {
  hbs: '<p>hi</p>',
  source: 'database' as const,
  active: true,
  version: 1,
  hash: 'h1',
}

Deno.test('TemplatesHubClient.list GETs /templates/list on the hub base URL', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse([{ channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS }])
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.list()

  assertEquals(result, [{ channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS }])
  assertSpyCalls(mockFetch, 1)
  const [url, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/templates/list')
  assertEquals(opts.method, 'GET')
})

Deno.test('TemplatesHubClient.get GETs /templates/:channel/:name on the hub', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({ channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.get('email', 'welcome')

  assertEquals(result, { channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/templates/email/welcome')
})

Deno.test('TemplatesHubClient.create POSTs to /templates with the input as the body', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), { channel: 'email', name: 'welcome', hbs: '<p>hi</p>' })
    return jsonResponse({ channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS }, 201)
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.create({ channel: 'email', name: 'welcome', hbs: '<p>hi</p>' })

  assertEquals(result, { channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/templates')
})

Deno.test('TemplatesHubClient.update PUTs /templates/:channel/:name with the changes', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'PUT')
    assertEquals(JSON.parse(opts.body), { active: false })
    return jsonResponse({ channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS, active: false })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.update('email', 'welcome', { active: false })

  assertEquals(result, {
    channel: 'email',
    name: 'welcome',
    ...TEMPLATE_DEFAULTS,
    active: false,
  })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/templates/email/welcome')
})

Deno.test('TemplatesHubClient.remove DELETEs /templates/:channel/:name', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ deactivated: 'welcome' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  await client.remove('email', 'welcome')

  assertSpyCalls(mockFetch, 1)
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/templates/email/welcome')
})

Deno.test('TemplatesHubClient.get encodes a name containing a path separator', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({ channel: 'email', name: 'a/b', ...TEMPLATE_DEFAULTS })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  await client.get('email', '../admin/other')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/templates/email/..%2Fadmin%2Fother')
})

Deno.test('TemplatesHubClient.sync POSTs {serviceId} to /templates/sync, returns summary', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), { serviceId: 'billing' })
    return jsonResponse({ seeded: 1, resynced: 0 })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.sync('billing')

  assertEquals(result, { seeded: 1, resynced: 0 })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/templates/sync')
})

Deno.test('TemplatesHubClient accepts a bare contextId string (RestClient shape)', () => {
  const client = new TemplatesHubClient('hub-context')

  assertEquals(client instanceof TemplatesHubClient, true)
})

Deno.test('TemplatesHubClient has a sync() — the hub composes /templates/sync alongside CRUD', () => {
  const client = new TemplatesHubClient({ baseUrl: 'http://admin-hub.internal:9000' })

  assertEquals('sync' in client, true)
})
