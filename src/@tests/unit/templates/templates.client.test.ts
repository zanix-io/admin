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

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  const result = await client.list()

  assertEquals(result, [{ channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS }])
  const [url, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/list')
  assertEquals(opts.method, 'GET')
})

Deno.test('TemplatesAdminClient.get GETs /admin/templates/:channel/:name', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({ channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  const result = await client.get('email', 'welcome')

  assertEquals(result, { channel: 'email', name: 'welcome', ...TEMPLATE_DEFAULTS })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/email/welcome')
})

Deno.test('TemplatesAdminClient.create POSTs the input as the body, no updatedBy', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), { channel: 'email', name: 'welcome', hbs: '<p>hi</p>' })
    return jsonResponse({ channel: 'email', name: 'welcome' }, 201)
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
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

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
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

Deno.test('TemplatesAdminClient.remove DELETEs /admin/templates/:channel/:name', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ deactivated: 'welcome' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.remove('email', 'welcome')

  assertSpyCalls(mockFetch, 1)
})

Deno.test('TemplatesAdminClient.sync POSTs entries as {entries}, returns summary', async () => {
  const entries = [{ channel: 'email', name: 'generic', hbs: '<p>hi</p>', hash: 'h1' }]
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), { entries })
    return jsonResponse({ seeded: 1, resynced: 0 })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TemplatesAdminClient({ baseUrl: 'http://svc.internal:1234' })
  const result = await client.sync(entries as never)

  assertEquals(result, { seeded: 1, resynced: 0 })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/templates/sync')
})
