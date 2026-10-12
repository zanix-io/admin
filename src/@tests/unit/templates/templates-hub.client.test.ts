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

Deno.test('TemplatesHubClient.listMessages GETs /templates/messages, with the langs escaped when given', async () => {
  const mockFetch = spy((_url: string, _opts: any) => jsonResponse({ es: { hi: 'hola' } }))
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://svc.internal:1234' })
  assertEquals(await client.listMessages(['es', 'en']), { es: { hi: 'hola' } })
  await client.listMessages()

  const [url, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/templates/messages?langs=es%2Cen')
  assertEquals(opts.method, 'GET')
  assertEquals(
    (mockFetch.calls[1].args as [string, any])[0],
    'http://svc.internal:1234/templates/messages',
  )
})

Deno.test('TemplatesHubClient.listMessageEntries GETs /templates/message-entries and unwraps entries', async () => {
  const entry = { lang: 'es', key: 'hi', text: 'hola', source: 'code', edited: false, version: 1 }
  const mockFetch = spy((_url: string, _opts: any) => jsonResponse({ entries: [entry] }))
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://svc.internal:1234' })
  assertEquals(await client.listMessageEntries({ langs: ['es'], search: 'a b' }), [entry])

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/templates/message-entries?langs=es&q=a+b')
})

Deno.test('TemplatesHubClient.setMessage PUTs the text to /templates/messages/:lang/:key, key escaped', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'PUT')
    assertEquals(JSON.parse(opts.body), { text: 'hola' })
    return jsonResponse({ lang: 'es', key: 'a.b', text: 'hola' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://svc.internal:1234' })
  await client.setMessage('es', 'a/b', 'hola')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/templates/messages/es/a%2Fb')
})

Deno.test('TemplatesHubClient.removeMessage DELETEs /templates/messages/:lang/:key', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ removed: 'es/hi' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://svc.internal:1234' })
  assertEquals(await client.removeMessage('es', 'hi'), { removed: 'es/hi' })

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/templates/messages/es/hi')
})

Deno.test('TemplatesHubClient.resetMessage POSTs /templates/messages/:lang/:key/reset', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    return jsonResponse({ lang: 'es', key: 'hi', text: 'hola' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://svc.internal:1234' })
  await client.resetMessage('es', 'hi')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/templates/messages/es/hi/reset')
})

Deno.test('TemplatesHubClient.previewTemplate POSTs data/lang to /templates/:channel/:name/preview', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), { data: { name: 'Ana' }, lang: 'es' })
    return jsonResponse({ body: 'Hola Ana', subject: 'Hola' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://svc.internal:1234' })
  const result = await client.previewTemplate('email', 'a/b', { data: { name: 'Ana' }, lang: 'es' })

  assertEquals(result, { body: 'Hola Ana', subject: 'Hola' })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/templates/email/a%2Fb/preview')
})

Deno.test('TemplatesHubClient.previewTemplate sends the draft texts in the body', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(JSON.parse(opts.body), { lang: 'es', texts: { 'welcome.title': 'Borrador' } })
    return jsonResponse({ body: 'Borrador' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesHubClient({ baseUrl: 'http://svc.internal:1234' })
  const result = await client.previewTemplate('email', 'welcome', {
    lang: 'es',
    texts: { 'welcome.title': 'Borrador' },
  })

  assertEquals(result, { body: 'Borrador' })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/templates/email/welcome/preview')
})
