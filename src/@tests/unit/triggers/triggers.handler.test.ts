// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import type { HandlerContext } from '@zanix/server'
import { createTriggersController } from 'modules/triggers/triggers.handler.ts'
import type { TriggersAggregator } from 'modules/triggers/triggers.aggregator.ts'
import { setTriggersAggregator } from 'modules/triggers/triggers.aggregator.ts'

function fakeAggregator(overrides: Record<string, any>) {
  const fake = overrides as unknown as TriggersAggregator
  setTriggersAggregator(fake)
  return fake
}

const TriggersController = createTriggersController()
const controller = new TriggersController({ id: 'test-ctx' } as never)

const TRIGGER_DEFAULTS = { active: true, triggers: {}, isDefault: false }

Deno.test('TriggersController.list forwards to the installed aggregator', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    list: (...args: unknown[]) => (
      calls.push(args),
        Promise.resolve([{ serviceId: 'billing', model: 'Invoice', ...TRIGGER_DEFAULTS }])
    ),
  })
  const result = await controller.list()
  assertEquals(result, [{ serviceId: 'billing', model: 'Invoice', ...TRIGGER_DEFAULTS }])
  assertEquals(calls, [[]])
})

Deno.test('TriggersController.get forwards serviceId/model', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    get: (...args: unknown[]) => (
      calls.push(args), Promise.resolve({ model: 'Invoice', ...TRIGGER_DEFAULTS })
    ),
  })
  const ctx = { payload: { params: { serviceId: 'billing', model: 'Invoice' } } } as HandlerContext<
    never
  >
  const result = await controller.get(ctx)
  assertEquals(result, { model: 'Invoice', ...TRIGGER_DEFAULTS })
  assertEquals(calls, [['billing', 'Invoice']])
})

Deno.test('TriggersController.create forwards serviceId + body fields', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    create: (...args: unknown[]) => (
      calls.push(args), Promise.resolve({ model: 'Invoice', ...TRIGGER_DEFAULTS })
    ),
  })
  const ctx = {
    payload: {
      params: { serviceId: 'billing' },
      body: { model: 'Invoice', active: true, triggers: { onCreate: [] } },
    },
  } as HandlerContext<never>
  const result = await controller.create(ctx)
  assertEquals(result, { model: 'Invoice', ...TRIGGER_DEFAULTS })
  assertEquals(calls, [['billing', 'Invoice', true, { onCreate: [] }]])
})

Deno.test('TriggersController.update forwards serviceId/model + changes', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    update: (...args: unknown[]) => (
      calls.push(args), Promise.resolve({ model: 'Invoice', ...TRIGGER_DEFAULTS })
    ),
  })
  const ctx = {
    payload: {
      params: { serviceId: 'billing', model: 'Invoice' },
      body: { active: false, triggers: undefined },
    },
  } as HandlerContext<never>
  const result = await controller.update(ctx)
  assertEquals(result, { model: 'Invoice', ...TRIGGER_DEFAULTS })
  assertEquals(calls, [['billing', 'Invoice', { active: false, triggers: undefined }]])
})

Deno.test('TriggersController.remove forwards serviceId/model, reports deleted', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()),
  })
  const ctx = { payload: { params: { serviceId: 'billing', model: 'Invoice' } } } as HandlerContext<
    never
  >
  const result = await controller.remove(ctx)
  assertEquals(result, { deleted: 'Invoice' })
  assertEquals(calls, [['billing', 'Invoice']])
})
