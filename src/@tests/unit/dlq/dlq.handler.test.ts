// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import type { HandlerContext } from '@zanix/server'
import { createDlqController } from 'modules/dlq/dlq.handler.ts'
import type { DlqAggregator } from 'modules/dlq/dlq.aggregator.ts'
import { setDlqAggregator } from 'modules/dlq/dlq.aggregator.ts'

function fakeAggregator(overrides: Record<string, any>) {
  const fake = overrides as unknown as DlqAggregator
  setDlqAggregator(fake)
  return fake
}

const DlqController = createDlqController()
const controller = new DlqController({ id: 'test-ctx' } as never)

const DLQ_DEFAULTS = {
  processType: 'payment.process',
  origin: 'billing',
  payload: { orderId: 'o-1' },
  error: { name: 'Error', message: 'boom' },
  status: 'pending',
}

Deno.test('DlqController.list forwards to the installed aggregator', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    list: (...args: unknown[]) => (
      calls.push(args), Promise.resolve([{ serviceId: 'billing', _id: 'e1', ...DLQ_DEFAULTS }])
    ),
  })
  const result = await controller.list()
  assertEquals(result, [{ serviceId: 'billing', _id: 'e1', ...DLQ_DEFAULTS }] as never)
  assertEquals(calls, [[]])
})

Deno.test('DlqController.get forwards serviceId/id', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    get: (...args: unknown[]) => (
      calls.push(args), Promise.resolve({ _id: 'e1', ...DLQ_DEFAULTS })
    ),
  })
  const ctx = {
    payload: { params: { serviceId: 'billing', id: 'e1' } },
  } as HandlerContext<never>
  const result = await controller.get(ctx)
  assertEquals(result, { _id: 'e1', ...DLQ_DEFAULTS } as never)
  assertEquals(calls, [['billing', 'e1']])
})

Deno.test('DlqController.push forwards serviceId + body fields', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    push: (...args: unknown[]) => (
      calls.push(args), Promise.resolve({ _id: 'e1', ...DLQ_DEFAULTS })
    ),
  })
  const ctx = {
    payload: {
      params: { serviceId: 'billing' },
      body: {
        processType: 'payment.process',
        origin: 'billing',
        payload: { orderId: 'o-1' },
        error: { name: 'Error', message: 'boom' },
      },
    },
  } as HandlerContext<never>
  const result = await controller.push(ctx)
  assertEquals(result, { _id: 'e1', ...DLQ_DEFAULTS } as never)
  assertEquals(calls, [['billing', {
    processType: 'payment.process',
    origin: 'billing',
    processId: undefined,
    payload: { orderId: 'o-1' },
    error: { name: 'Error', message: 'boom' },
    maxAttempts: undefined,
    metadata: undefined,
  }]])
})

Deno.test('DlqController.requeue forwards serviceId/id + resetAttempts', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    requeue: (...args: unknown[]) => (
      calls.push(args), Promise.resolve({ _id: 'e1', ...DLQ_DEFAULTS })
    ),
  })
  const ctx = {
    payload: {
      params: { serviceId: 'billing', id: 'e1' },
      body: { resetAttempts: true },
    },
  } as HandlerContext<never>
  const result = await controller.requeue(ctx)
  assertEquals(result, { _id: 'e1', ...DLQ_DEFAULTS } as never)
  assertEquals(calls, [['billing', 'e1', { resetAttempts: true }]])
})

Deno.test('DlqController.discard forwards serviceId/id + reason', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    discard: (...args: unknown[]) => (
      calls.push(args), Promise.resolve({ _id: 'e1', ...DLQ_DEFAULTS, status: 'discarded' })
    ),
  })
  const ctx = {
    payload: {
      params: { serviceId: 'billing', id: 'e1' },
      body: { reason: 'stale' },
    },
  } as HandlerContext<never>
  const result = await controller.discard(ctx)
  assertEquals(result, { _id: 'e1', ...DLQ_DEFAULTS, status: 'discarded' } as never)
  assertEquals(calls, [['billing', 'e1', { reason: 'stale' }]])
})

Deno.test('DlqController.remove forwards serviceId/id, reports deleted', async () => {
  const calls: unknown[][] = []
  fakeAggregator({
    remove: (...args: unknown[]) => (calls.push(args), Promise.resolve()),
  })
  const ctx = {
    payload: { params: { serviceId: 'billing', id: 'e1' } },
  } as HandlerContext<never>
  const result = await controller.remove(ctx)
  assertEquals(result, { deleted: 'e1' })
  assertEquals(calls, [['billing', 'e1']])
})
