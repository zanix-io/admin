// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { assertSpyCalls, spy } from '@std/testing/mock'
import { DlqAdminClient } from 'modules/dlq/dlq.client.ts'

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

// `createdAt`/`updatedAt` as ISO strings — this suite always goes through a real (stubbed) `fetch`,
// and `JSON.stringify`/`JSON.parse` always serialize a `Date` to a string over the wire, same as
// the real target service's own `/admin/dlq` response would.
const DLQ_DEFAULTS = {
  processType: 'payment.process',
  origin: 'billing',
  payload: { orderId: 'o-1' },
  error: { name: 'Error', message: 'boom' },
  errorHistory: [] as never[],
  attempts: 1,
  status: 'pending' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

Deno.test('DlqAdminClient.list GETs /admin/dlq with no query when omitted', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({
      docs: [{ _id: 'e1', ...DLQ_DEFAULTS }],
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
    })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
  const result = await client.list()

  assertEquals(result.docs, [{ _id: 'e1', ...DLQ_DEFAULTS }] as never)
  assertSpyCalls(mockFetch, 1)
  const [url, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/dlq')
  assertEquals(opts.method, 'GET')
})

Deno.test('DlqAdminClient.list serializes only the given filters as query params', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse({
      docs: [],
      page: 1,
      limit: 5,
      total: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPrevPage: false,
    })
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.list({ status: 'pending', limit: 5 })

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/dlq?status=pending&limit=5')
})

Deno.test('DlqAdminClient.get GETs /admin/dlq/:id', async () => {
  const mockFetch = spy((_url: string, _opts: any) => jsonResponse({ _id: 'e1', ...DLQ_DEFAULTS }))
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
  const result = await client.get('e1')

  assertEquals(result, { _id: 'e1', ...DLQ_DEFAULTS } as never)
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/dlq/e1')
})

Deno.test('DlqAdminClient.push POSTs the given input as the body', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), {
      processType: 'payment.process',
      origin: 'billing',
      payload: { orderId: 'o-1' },
      error: { name: 'Error', message: 'boom' },
    })
    return jsonResponse({ _id: 'e1', ...DLQ_DEFAULTS }, 201)
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
  const result = await client.push({
    processType: 'payment.process',
    origin: 'billing',
    payload: { orderId: 'o-1' },
    error: { name: 'Error', message: 'boom' },
  })

  assertEquals(result, { _id: 'e1', ...DLQ_DEFAULTS } as never)
  assertSpyCalls(mockFetch, 1)
})

Deno.test({
  name: 'DlqAdminClient.requeue POSTs /admin/dlq/:id/requeue with the given options',
  fn: async () => {
    const mockFetch = spy((_url: string, opts: any) => {
      assertEquals(opts.method, 'POST')
      assertEquals(JSON.parse(opts.body), { resetAttempts: true })
      return jsonResponse({ _id: 'e1', ...DLQ_DEFAULTS, status: 'pending' })
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
    const result = await client.requeue('e1', { resetAttempts: true })

    assertEquals(result, { _id: 'e1', ...DLQ_DEFAULTS, status: 'pending' } as never)
    const [url] = mockFetch.calls[0].args as [string, any]
    assertEquals(url, 'http://svc.internal:1234/admin/dlq/e1/requeue')
  },
})

Deno.test('DlqAdminClient.requeue defaults the body to {} when no options are given', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(JSON.parse(opts.body), {})
    return jsonResponse({ _id: 'e1', ...DLQ_DEFAULTS })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.requeue('e1')

  assertSpyCalls(mockFetch, 1)
})

Deno.test({
  name: 'DlqAdminClient.discard POSTs /admin/dlq/:id/discard with the given options',
  fn: async () => {
    const mockFetch = spy((_url: string, opts: any) => {
      assertEquals(opts.method, 'POST')
      assertEquals(JSON.parse(opts.body), { reason: 'stale' })
      return jsonResponse({ _id: 'e1', ...DLQ_DEFAULTS, status: 'discarded' })
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch

    const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
    const result = await client.discard('e1', { reason: 'stale' })

    assertEquals(result, { _id: 'e1', ...DLQ_DEFAULTS, status: 'discarded' } as never)
    const [url] = mockFetch.calls[0].args as [string, any]
    assertEquals(url, 'http://svc.internal:1234/admin/dlq/e1/discard')
  },
})

Deno.test('DlqAdminClient.discard defaults the body to {} when no options are given', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(JSON.parse(opts.body), {})
    return jsonResponse({ _id: 'e1', ...DLQ_DEFAULTS, status: 'discarded' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.discard('e1')

  assertSpyCalls(mockFetch, 1)
})

Deno.test('DlqAdminClient.get encodes an id containing a path separator', async () => {
  const mockFetch = spy((_url: string, _opts: any) => jsonResponse({ _id: 'a/b', ...DLQ_DEFAULTS }))
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.get('../admin/other')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/dlq/..%2Fadmin%2Fother')
})

Deno.test('DlqAdminClient.requeue encodes an id containing a path separator', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    return jsonResponse({ _id: 'x', ...DLQ_DEFAULTS })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.requeue('a/../b')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/dlq/a%2F..%2Fb/requeue')
})

Deno.test('DlqAdminClient.remove encodes an id containing a path separator', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ deleted: 'x' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.remove('a/b')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://svc.internal:1234/admin/dlq/a%2Fb')
})

Deno.test('DlqAdminClient accepts a bare contextId string (RestClient shape)', () => {
  const client = new DlqAdminClient('svc-context')

  assertEquals(client instanceof DlqAdminClient, true)
})

Deno.test('DlqAdminClient.remove DELETEs /admin/dlq/:id', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ deleted: 'e1' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqAdminClient({ baseUrl: 'http://svc.internal:1234' })
  await client.remove('e1')

  assertSpyCalls(mockFetch, 1)
})
