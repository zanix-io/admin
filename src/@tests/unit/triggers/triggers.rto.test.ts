import { assertEquals } from '@std/assert'
import { classValidation } from '@zanix/validator'
import {
  CreateTriggerRTO,
  TriggerServiceModelParamsRTO,
  TriggerServiceParamsRTO,
  UpdateTriggerRTO,
} from 'modules/triggers/rtos/triggers.rto.ts'

Deno.test('TriggerServiceParamsRTO validates a plain "serviceId" string', async () => {
  const rto = await classValidation(TriggerServiceParamsRTO, { serviceId: 'billing' })
  assertEquals(rto.serviceId, 'billing')
})

Deno.test('TriggerServiceModelParamsRTO validates "serviceId" and "model"', async () => {
  const rto = await classValidation(TriggerServiceModelParamsRTO, {
    serviceId: 'billing',
    model: 'zanix-triggers',
  })
  assertEquals(rto.serviceId, 'billing')
  assertEquals(rto.model, 'zanix-triggers')
})

Deno.test('CreateTriggerRTO validates model/active/triggers, passes triggers as-is', async () => {
  const rto = await classValidation(CreateTriggerRTO, {
    model: 'zanix-triggers',
    active: false,
    triggers: { pre: { created: [] } },
  })
  assertEquals(rto.model, 'zanix-triggers')
  assertEquals(rto.active, false)
  assertEquals(rto.triggers, { pre: { created: [] } })
})

Deno.test('CreateTriggerRTO defaults active to true when omitted', async () => {
  const rto = await classValidation(CreateTriggerRTO, {
    model: 'zanix-triggers',
    triggers: {},
  })
  assertEquals(rto.active, true)
})

Deno.test('UpdateTriggerRTO validates active/triggers when both are provided', async () => {
  const rto = await classValidation(UpdateTriggerRTO, {
    active: false,
    triggers: { post: { deleted: [] } },
  })
  assertEquals(rto.active, false)
  assertEquals(rto.triggers, { post: { deleted: [] } })
})

Deno.test('UpdateTriggerRTO leaves active/triggers undefined when both are omitted', async () => {
  const rto = await classValidation(UpdateTriggerRTO, {})
  assertEquals(rto.active, undefined)
  assertEquals(rto.triggers, undefined)
})
