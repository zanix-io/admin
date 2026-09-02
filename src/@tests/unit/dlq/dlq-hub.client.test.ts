// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { assertSpyCalls, spy } from '@std/testing/mock'
import { ADMIN_PROTOCOL_HEADER } from '@zanix/server'
import { DlqHubClient } from 'modules/dlq/dlq-hub.client.ts'

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
// the real hub's own `/dlq` response would.
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

Deno.test('DlqHubClient.list GETs /dlq/list on the hub base URL', async () => {
  const mockFetch = spy((_url: string, _opts: any) =>
    jsonResponse([{ _id: 'e1', serviceId: 'billing', ...DLQ_DEFAULTS }])
  )
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.list()

  assertEquals(result, [{ _id: 'e1', serviceId: 'billing', ...DLQ_DEFAULTS }] as never)
  assertSpyCalls(mockFetch, 1)
  const [url, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/dlq/list')
  assertEquals(opts.method, 'GET')
})

Deno.test('DlqHubClient.get GETs /dlq/:serviceId/:id on the hub', async () => {
  const mockFetch = spy((_url: string, _opts: any) => jsonResponse({ _id: 'e1', ...DLQ_DEFAULTS }))
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.get('billing', 'e1')

  assertEquals(result, { _id: 'e1', ...DLQ_DEFAULTS } as never)
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/dlq/billing/e1')
})

Deno.test('DlqHubClient.push POSTs /dlq/:serviceId with the input body', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), {
      processType: 'payment.process',
      origin: 'billing',
      payload: { orderId: 'o-1' },
      error: { name: 'Error', message: 'boom' },
    })
    return jsonResponse({ _id: 'e2', ...DLQ_DEFAULTS }, 201)
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.push('billing', {
    processType: 'payment.process',
    origin: 'billing',
    payload: { orderId: 'o-1' },
    error: { name: 'Error', message: 'boom' },
  })

  assertEquals(result, { _id: 'e2', ...DLQ_DEFAULTS } as never)
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/dlq/billing')
})

Deno.test('DlqHubClient.requeue POSTs /dlq/:serviceId/:id/requeue with options', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), { resetAttempts: true })
    return jsonResponse({ _id: 'e1', ...DLQ_DEFAULTS, attempts: 0 })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.requeue('billing', 'e1', { resetAttempts: true })

  assertEquals(result, { _id: 'e1', ...DLQ_DEFAULTS, attempts: 0 } as never)
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/dlq/billing/e1/requeue')
})

Deno.test('DlqHubClient.requeue POSTs an empty body when options are omitted', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(JSON.parse(opts.body), {})
    return jsonResponse({ _id: 'e1', ...DLQ_DEFAULTS })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  await client.requeue('billing', 'e1')

  assertSpyCalls(mockFetch, 1)
})

Deno.test('DlqHubClient.discard POSTs /dlq/:serviceId/:id/discard with options', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'POST')
    assertEquals(JSON.parse(opts.body), { reason: 'unrecoverable' })
    return jsonResponse({ _id: 'e1', ...DLQ_DEFAULTS, status: 'discarded' as const })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  const result = await client.discard('billing', 'e1', { reason: 'unrecoverable' })

  assertEquals(result, { _id: 'e1', ...DLQ_DEFAULTS, status: 'discarded' } as never)
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/dlq/billing/e1/discard')
})

Deno.test('DlqHubClient.remove DELETEs /dlq/:serviceId/:id', async () => {
  const mockFetch = spy((_url: string, opts: any) => {
    assertEquals(opts.method, 'DELETE')
    return jsonResponse({ deleted: 'e1' })
  })
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  await client.remove('billing', 'e1')

  assertSpyCalls(mockFetch, 1)
  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(url, 'http://admin-hub.internal:9000/dlq/billing/e1')
})

Deno.test('DlqHubClient.get encodes serviceId/id containing a path separator', async () => {
  const mockFetch = spy((_url: string, _opts: any) => jsonResponse({ _id: 'x', ...DLQ_DEFAULTS }))
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  await client.get('a/b', '../admin/other')

  const [url] = mockFetch.calls[0].args as [string, any]
  assertEquals(
    url,
    'http://admin-hub.internal:9000/dlq/a%2Fb/..%2Fadmin%2Fother',
  )
})

Deno.test('DlqHubClient accepts a bare contextId string (RestClient shape)', () => {
  const client = new DlqHubClient('hub-context')

  assertEquals(client instanceof DlqHubClient, true)
})

Deno.test('DlqHubClient stamps every request with the admin protocol header', async () => {
  const mockFetch = spy((_url: string, _opts: any) => jsonResponse([]))
  globalThis.fetch = mockFetch as unknown as typeof fetch

  const client = new DlqHubClient({ baseUrl: 'http://admin-hub.internal:9000' })
  await client.list()

  const [, opts] = mockFetch.calls[0].args as [string, any]
  assertEquals(typeof opts.headers[ADMIN_PROTOCOL_HEADER], 'string')
})
