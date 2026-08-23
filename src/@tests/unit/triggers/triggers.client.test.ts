// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { assertSpyCalls, spy } from '@std/testing/mock'
import { TriggersAdminClient } from 'modules/triggers/triggers.client.ts'

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

Deno.test('TriggersAdminClient.list GETs /admin/triggers/list', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse([{ model: 'User', ...TRIGGER_DEFAULTS }])
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  const result = await client.list()

  assertEquals(result, [{ model: 'User', ...TRIGGER_DEFAULTS }])
  assertSpyCalls(mockFetch, 1)
  const [url, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/triggers/list')
  assertEquals(opts.method, 'GET')
})

Deno.test('TriggersAdminClient.get GETs /admin/triggers/:model', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({ model: 'User', ...TRIGGER_DEFAULTS })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  const result = await client.get('User')

  assertEquals(result, { model: 'User', ...TRIGGER_DEFAULTS })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/triggers/User')
})

Deno.test('TriggersAdminClient.create POSTs model/active/triggers as the body', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), {
      model: 'User',
      active: true,
      triggers: { pre: {} },
    })
    return jsonResponse(
      { model: 'User', active: true, triggers: { pre: {} }, isDefault: false },
      201,
    )
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  const result = await client.create({
    model: 'User',
    active: true,
    triggers: { pre: {} },
  })

  assertEquals(result, {
    model: 'User',
    active: true,
    triggers: { pre: {} },
    isDefault: false,
  })
  assertSpyCalls(mockFetch, 1)
})

Deno.test('TriggersAdminClient.update PUTs the given changes', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'PUT')
    assertEquals(JSON.parse(opts.body), { active: false })
    return jsonResponse({ model: 'User', ...TRIGGER_DEFAULTS, active: false })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  const result = await client.update('User', { active: false })

  assertEquals(result, { model: 'User', ...TRIGGER_DEFAULTS, active: false })
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/triggers/User')
})

Deno.test('TriggersAdminClient.get encodes a model containing a path separator', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({ model: 'a/b', ...TRIGGER_DEFAULTS })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.get('../admin/other')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/triggers/..%2Fadmin%2Fother')
})

Deno.test('TriggersAdminClient.update encodes a model containing a path separator', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'PUT')
    return jsonResponse({ model: 'x', ...TRIGGER_DEFAULTS })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.update('a/../b', { active: false })

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/triggers/a%2F..%2Fb')
})

Deno.test('TriggersAdminClient.remove encodes a model containing a path separator', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ deleted: 'x' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.remove('a/b')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/triggers/a%2Fb')
})

Deno.test('TriggersAdminClient accepts a bare contextId string (RestClient shape)', () => {
  const client = new TriggersAdminClient('svc-context')

  assertEquals(client instanceof TriggersAdminClient, true)
})

Deno.test('TriggersAdminClient.remove DELETEs /admin/triggers/:model', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ deleted: 'User' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new TriggersAdminClient({
    baseUrl: 'http://svc.internal:1234',
  })
  await client.remove('User')

  assertSpyCalls(mockFetch, 1)
})
