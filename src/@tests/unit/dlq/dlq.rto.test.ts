import { assertEquals } from '@std/assert'
import { classValidation } from '@zanix/validator'
import {
  DiscardDlqEntryRTO,
  DlqServiceEntryParamsRTO,
  DlqServiceParamsRTO,
  PushDlqEntryRTO,
  RequeueDlqEntryRTO,
} from 'modules/dlq/rtos/dlq.rto.ts'

Deno.test('DlqServiceParamsRTO validates a plain "serviceId" string', async () => {
  const rto = await classValidation(DlqServiceParamsRTO, { serviceId: 'billing' })
  assertEquals(rto.serviceId, 'billing')
})

Deno.test('DlqServiceEntryParamsRTO validates "serviceId" and "id"', async () => {
  const rto = await classValidation(DlqServiceEntryParamsRTO, {
    serviceId: 'billing',
    id: '665f1a2b3c4d5e6f7a8b9c0d',
  })
  assertEquals(rto.serviceId, 'billing')
  assertEquals(rto.id, '665f1a2b3c4d5e6f7a8b9c0d')
})

Deno.test({
  name: 'PushDlqEntryRTO validates processType/origin/payload/error, passes payload/error as-is',
  fn: async () => {
    const rto = await classValidation(PushDlqEntryRTO, {
      processType: 'payment.process',
      origin: 'billing',
      payload: { orderId: 'o-1' },
      error: { name: 'Error', message: 'boom' },
    })
    assertEquals(rto.processType, 'payment.process')
    assertEquals(rto.origin, 'billing')
    assertEquals(rto.payload, { orderId: 'o-1' })
    assertEquals(rto.error, { name: 'Error', message: 'boom' })
  },
})

Deno.test('RequeueDlqEntryRTO leaves resetAttempts undefined when omitted', async () => {
  const rto = await classValidation(RequeueDlqEntryRTO, {})
  assertEquals(rto.resetAttempts, undefined)
})

Deno.test('RequeueDlqEntryRTO validates resetAttempts when given', async () => {
  const rto = await classValidation(RequeueDlqEntryRTO, { resetAttempts: true })
  assertEquals(rto.resetAttempts, true)
})

Deno.test('DiscardDlqEntryRTO validates reason when given', async () => {
  const rto = await classValidation(DiscardDlqEntryRTO, { reason: 'stale' })
  assertEquals(rto.reason, 'stale')
})

Deno.test('DiscardDlqEntryRTO leaves reason undefined when omitted', async () => {
  const rto = await classValidation(DiscardDlqEntryRTO, {})
  assertEquals(rto.reason, undefined)
})
