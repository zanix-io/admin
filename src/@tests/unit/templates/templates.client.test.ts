// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { assertSpyCalls, spy } from '@std/testing/mock'
import { TemplatesAdminClient } from 'modules/templates/templates.client.ts'

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

Deno.test('TemplatesAdminClient.list GETs /admin/templates/list', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse([{ channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS }])
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  const result = await client.list()

  assertEquals(result, [{
    channel: 'email',
    name: 'welcome',
    ...TEMPLATE_DEFAULTS,
  }])
  const [url, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/list')
  assertEquals(opts.method, 'GET')
})

Deno.test('TemplatesAdminClient.get GETs /admin/templates/:channel/:name', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({ channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  const result = await client.get('email', 'welcome')

  assertEquals(result, {
    channel: 'email',
    name: 'welcome',
    ...TEMPLATE_DEFAULTS,
  })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/email/welcome')
})

Deno.test('TemplatesAdminClient.create POSTs the input as the body, no updatedBy', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), {
      channel: 'email',
      name: 'welcome',
      hbs: '<p>hi</p>',
    })
    return jsonResponse({ channel: 'email', name: 'welcome' }, 201)
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  await client.create({ channel: 'email', name: 'welcome', hbs: '<p>hi</p>' })

  assertSpyCalls(mockFetch, 1)
})

Deno.test('TemplatesAdminClient.update PUTs the given changes', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'PUT')
    assertEquals(JSON.parse(opts.body), { hbs: '<p>new</p>' })
    return jsonResponse({
      channel: 'email',
      name: 'welcome',
      ...TEMPLATE_DEFAULTS,
      hbs: '<p>new</p>',
    })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  const result = await client.update('email', 'welcome', { hbs: '<p>new</p>' })

  assertEquals(result, {
    channel: 'email',
    name: 'welcome',
    ...TEMPLATE_DEFAULTS,
    hbs: '<p>new</p>',
  })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/email/welcome')
})

Deno.test('TemplatesAdminClient.get encodes a name containing a path separator', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({ channel: 'email', name: 'a/b', ...TEMPLATE_DEFAULTS })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.get('email', '../other')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/email/..%2Fother')
})

Deno.test('TemplatesAdminClient.update encodes a name containing a path separator', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'PUT')
    return jsonResponse({ channel: 'email', name: 'x', ...TEMPLATE_DEFAULTS })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.update('email', 'a/b', { hbs: '<p>new</p>' })

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/email/a%2Fb')
})

Deno.test('TemplatesAdminClient.remove encodes a name containing a path separator', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ deactivated: 'x' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.remove('email', 'a/b')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/email/a%2Fb')
})

Deno.test('TemplatesAdminClient accepts a bare contextId string (RestClient shape)', () => {
  const client = new TemplatesAdminClient('svc-context')

  assertEquals(client instanceof TemplatesAdminClient, true)
})

Deno.test('TemplatesAdminClient.remove DELETEs /admin/templates/:channel/:name', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ deactivated: 'welcome' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  await client.remove('email', 'welcome')

  assertSpyCalls(mockFetch, 1)
})

Deno.test('TemplatesAdminClient.sync POSTs {serviceId}, returns summary', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), { serviceId: 'billing' })
    return jsonResponse({ seeded: 1, resynced: 0 })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  const result = await client.sync('billing')

  assertEquals(result, { seeded: 1, resynced: 0 })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/sync')
})

Deno.test('TemplatesAdminClient.listMessages GETs /admin/templates/messages, with the langs escaped when given', async () => {
  const mockFetch = spy((_url: string, _opts: any) => jsonResponse({ es: { hi: 'hola' } }))
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  assertEquals(await client.listMessages(['es', 'en']), { es: { hi: 'hola' } })
  await client.listMessages()

  const [url, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/messages?langs=es%2Cen')
  assertEquals(opts.method, 'GET')
  assertEquals(
    (mockFetch.calls[1].args as [string, any])[0],
    'http://svc.internal:1234/admin/templates/messages',
  )
})

Deno.test('TemplatesAdminClient.listMessageEntries GETs /admin/templates/message-entries and unwraps entries', async () => {
  const entry = { lang: 'es', key: 'hi', text: 'hola', source: 'code', edited: false, version: 1 }
  const mockFetch = spy((_url: string, _opts: any) => jsonResponse({ entries: [entry] }))
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  assertEquals(await client.listMessageEntries({ langs: ['es'], search: 'a b' }), [entry])

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/message-entries?langs=es&q=a+b')
})

Deno.test('TemplatesAdminClient.setMessage PUTs the text to /admin/templates/messages/:lang/:key, key escaped', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'PUT')
    assertEquals(JSON.parse(opts.body), { text: 'hola' })
    return jsonResponse({ lang: 'es', key: 'a.b', text: 'hola' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.setMessage('es', 'a/b', 'hola')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/messages/es/a%2Fb')
})

Deno.test('TemplatesAdminClient.removeMessage DELETEs /admin/templates/messages/:lang/:key', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ removed: 'es/hi' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  assertEquals(await client.removeMessage('es', 'hi'), { removed: 'es/hi' })

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/messages/es/hi')
})

Deno.test('TemplatesAdminClient.resetMessage POSTs /admin/templates/messages/:lang/:key/reset', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    return jsonResponse({ lang: 'es', key: 'hi', text: 'hola' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.resetMessage('es', 'hi')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/messages/es/hi/reset')
})

Deno.test('TemplatesAdminClient.previewTemplate POSTs data/lang to /admin/templates/:channel/:name/preview', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), { data: { name: 'Ana' }, lang: 'es' })
    return jsonResponse({ body: 'Hola Ana', subject: 'Hola' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  const result = await client.previewTemplate('email', 'a/b', { data: { name: 'Ana' }, lang: 'es' })

  assertEquals(result, { body: 'Hola Ana', subject: 'Hola' })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/email/a%2Fb/preview')
})

Deno.test('TemplatesAdminClient.previewTemplate sends the draft texts in the body', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(JSON.parse(opts.body), { lang: 'es', texts: { 'welcome.title': 'Borrador' } })
    return jsonResponse({ body: 'Borrador' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  const result = await client.previewTemplate('email', 'welcome', {
    lang: 'es',
    texts: { 'welcome.title': 'Borrador' },
  })

  assertEquals(result, { body: 'Borrador' })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/email/welcome/preview')
})
