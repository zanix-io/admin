// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import type { HandlerContext } from '@zanix/server'
import { ProgramModule } from '@zanix/server'
import { createTemplatesController } from 'modules/templates/templates.handler.ts'
import { ServiceRegistry, setServiceRegistry } from 'modules/registry/registry.ts'

const TemplatesController = createTemplatesController()

function fakeThis(interactor: Record<string, any>) {
  const instance = new TemplatesController({ id: 'test-ctx' } as never)
  Object.defineProperty(instance, 'interactor', { value: interactor })
  return instance
}

const handler = TemplatesController.prototype

Deno.test('TemplatesController.list forwards to interactor.list()', () => {
  const calls: unknown[][] = []
  const result: unknown = handler.list.call(
    fakeThis({
      list: (...args: unknown[]) => (calls.push(args), 'list-result'),
    }),
  )
  assertEquals(result, 'list-result')
  assertEquals(calls, [[]])
})

Deno.test('TemplatesController.get forwards channel/name, spreads the result', async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { params: { channel: 'email', name: 'welcome' } },
  } as HandlerContext<
    never
  >
  const result: unknown = await handler.get.call(
    fakeThis({
      get: (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ name: 'welcome' })),
    }),
    ctx,
  )
  assertEquals(result, { name: 'welcome' })
  assertEquals(calls, [['email', 'welcome']])
})

Deno.test('TemplatesController.create forwards body + session id to create()', async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { body: { channel: 'email', name: 'invoice', hbs: '<p>hi</p>' } },
    session: { id: 'admin-1' },
  } as HandlerContext<never>
  const result: unknown = await handler.create.call(
    fakeThis({
      create: (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ name: 'invoice' })),
    }),
    ctx,
  )
  assertEquals(result, { name: 'invoice' })
  assertEquals(calls, [[
    { channel: 'email', name: 'invoice', hbs: '<p>hi</p>' },
    'admin-1',
  ]])
})

Deno.test("TemplatesController.create falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { body: { channel: 'email', name: 'invoice', hbs: '<p>hi</p>' } },
  } as HandlerContext<never>
  await handler.create.call(
    fakeThis({
      create: (...args: unknown[]) => (calls.push(args), Promise.resolve({})),
    }),
    ctx,
  )
  assertEquals(calls[0][1], 'unknown')
})

Deno.test('TemplatesController.update forwards fields to update()', async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: {
      params: { channel: 'email', name: 'welcome' },
      body: { hbs: '<p>new</p>' },
    },
    session: { id: 'admin-2' },
  } as HandlerContext<never>
  const result: unknown = await handler.update.call(
    fakeThis({
      update: (
        ...args: unknown[]
      ) => (calls.push(args), Promise.resolve({ version: 2 })),
    }),
    ctx,
  )
  assertEquals(result, { version: 2 })
  assertEquals(calls, [['email', 'welcome', { hbs: '<p>new</p>' }, 'admin-2']])
})

Deno.test("TemplatesController.update falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: {
      params: { channel: 'email', name: 'welcome' },
      body: { hbs: '<p>new</p>' },
    },
  } as HandlerContext<never>
  await handler.update.call(
    fakeThis({
      update: (...args: unknown[]) => (calls.push(args), Promise.resolve({})),
    }),
    ctx,
  )
  assertEquals(calls[0][3], 'unknown')
})

Deno.test('TemplatesController.remove forwards fields, reports deactivated', async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { params: { channel: 'email', name: 'welcome' } },
    session: { id: 'admin-3' },
  } as HandlerContext<never>
  const result = await handler.remove.call(
    fakeThis({
      remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()),
    }),
    ctx,
  )
  assertEquals(result, { deactivated: 'welcome' })
  assertEquals(calls, [['email', 'welcome', 'admin-3']])
})

Deno.test("TemplatesController.remove falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { params: { channel: 'email', name: 'welcome' } },
  } as HandlerContext<
    never
  >
  await handler.remove.call(
    fakeThis({
      remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()),
    }),
    ctx,
  )
  assertEquals(calls[0][2], 'unknown')
})

// `sync()` no longer delegates to `this.interactor` (see `syncTemplatesFromRegisteredService`'s
// own tests, `templates-sync.test.ts`) — these two just confirm the route forwards
// `body.serviceId`/`session.id` into that standalone function correctly, using the same
// registry/fetch/providers stubbing seam its own dedicated test suite already exercises fully.
function withSyncEnv(updatedByCalls: unknown[][], fn: () => Promise<unknown>) {
  setServiceRegistry(
    new ServiceRegistry([{
      serviceId: 'billing',
      adminBaseUrl: 'http://billing.internal',
    }]),
  )
  const fetchStub = stub(
    globalThis,
    'fetch',
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            resourceType: 'code-templates',
            generatedAt: '',
            items: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ) as never,
  )
  const providersStub = stub(
    Object.getPrototypeOf(ProgramModule),
    'getProviders',
    (() => ({
      get: (_cls: unknown) => ({
        syncCodeTemplates: (entries: unknown, updatedBy: unknown) => (
          updatedByCalls.push([entries, updatedBy]), Promise.resolve({ seeded: 1, resynced: 0 })
        ),
      }),
    })) as any,
  )

  return fn().finally(() => {
    fetchStub.restore()
    providersStub.restore()
  })
}

Deno.test({
  name: 'TemplatesController.sync forwards serviceId + session id, returns summary',
  fn: async () => {
    const calls: unknown[][] = []
    const ctx = {
      payload: { body: { serviceId: 'billing' } },
      session: { id: 'service-account-1' },
    } as HandlerContext<never>

    const result = await withSyncEnv(
      calls,
      () => handler.sync.call(fakeThis({}), ctx),
    )

    assertEquals(result, { seeded: 1, resynced: 0 })
    assertEquals(calls[0][1], 'service-account-1')
  },
})

Deno.test("TemplatesController.sync falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = { payload: { body: { serviceId: 'billing' } } } as HandlerContext<
    never
  >

  await withSyncEnv(calls, () => handler.sync.call(fakeThis({}), ctx))

  assertEquals(calls[0][1], 'unknown')
})
