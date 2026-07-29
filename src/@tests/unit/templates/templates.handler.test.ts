// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import type { HandlerContext } from '@zanix/server'
import { createTemplatesController } from 'modules/templates/templates.handler.ts'

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
    fakeThis({ list: (...args: unknown[]) => (calls.push(args), 'list-result') }),
  )
  assertEquals(result, 'list-result')
  assertEquals(calls, [[]])
})

Deno.test('TemplatesController.get forwards channel/name, spreads the result', async () => {
  const calls: unknown[][] = []
  const ctx = { payload: { params: { channel: 'email', name: 'welcome' } } } as HandlerContext<
    never
  >
  const result: unknown = await handler.get.call(
    fakeThis({
      get: (...args: unknown[]) => (calls.push(args), Promise.resolve({ name: 'welcome' })),
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
      create: (...args: unknown[]) => (calls.push(args), Promise.resolve({ name: 'invoice' })),
    }),
    ctx,
  )
  assertEquals(result, { name: 'invoice' })
  assertEquals(calls, [[{ channel: 'email', name: 'invoice', hbs: '<p>hi</p>' }, 'admin-1']])
})

Deno.test("TemplatesController.create falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { body: { channel: 'email', name: 'invoice', hbs: '<p>hi</p>' } },
  } as HandlerContext<never>
  await handler.create.call(
    fakeThis({ create: (...args: unknown[]) => (calls.push(args), Promise.resolve({})) }),
    ctx,
  )
  assertEquals(calls[0][1], 'unknown')
})

Deno.test('TemplatesController.update forwards fields to update()', async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { params: { channel: 'email', name: 'welcome' }, body: { hbs: '<p>new</p>' } },
    session: { id: 'admin-2' },
  } as HandlerContext<never>
  const result: unknown = await handler.update.call(
    fakeThis({
      update: (...args: unknown[]) => (calls.push(args), Promise.resolve({ version: 2 })),
    }),
    ctx,
  )
  assertEquals(result, { version: 2 })
  assertEquals(calls, [['email', 'welcome', { hbs: '<p>new</p>' }, 'admin-2']])
})

Deno.test("TemplatesController.update falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = {
    payload: { params: { channel: 'email', name: 'welcome' }, body: { hbs: '<p>new</p>' } },
  } as HandlerContext<never>
  await handler.update.call(
    fakeThis({ update: (...args: unknown[]) => (calls.push(args), Promise.resolve({})) }),
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
    fakeThis({ remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()) }),
    ctx,
  )
  assertEquals(result, { deactivated: 'welcome' })
  assertEquals(calls, [['email', 'welcome', 'admin-3']])
})

Deno.test("TemplatesController.remove falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = { payload: { params: { channel: 'email', name: 'welcome' } } } as HandlerContext<
    never
  >
  await handler.remove.call(
    fakeThis({ remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()) }),
    ctx,
  )
  assertEquals(calls[0][2], 'unknown')
})

Deno.test('TemplatesController.sync forwards entries + session id, returns summary', async () => {
  const calls: unknown[][] = []
  const entries = [{ channel: 'email', name: 'generic', hbs: '<p>hi</p>', hash: 'h1' }]
  const ctx = {
    payload: { body: { entries } },
    session: { id: 'service-account-1' },
  } as HandlerContext<never>
  const result: unknown = await handler.sync.call(
    fakeThis({
      syncCodeTemplates: (...args: unknown[]) => (
        calls.push(args), Promise.resolve({ seeded: 1, resynced: 0 })
      ),
    }),
    ctx,
  )
  assertEquals(result, { seeded: 1, resynced: 0 })
  assertEquals(calls, [[entries, 'service-account-1']])
})

Deno.test("TemplatesController.sync falls back to 'unknown' with no session", async () => {
  const calls: unknown[][] = []
  const ctx = { payload: { body: { entries: [] } } } as HandlerContext<never>
  await handler.sync.call(
    fakeThis({
      syncCodeTemplates: (...args: unknown[]) => (
        calls.push(args), Promise.resolve({ seeded: 0, resynced: 0 })
      ),
    }),
    ctx,
  )
  assertEquals(calls[0][1], 'unknown')
})
