import { assert, assertEquals } from '@std/assert'
import { classValidation } from '@zanix/validator'
import { SyncTemplatesRTO } from 'modules/templates/rtos/templates.rto.ts'

// `SyncTemplatesRTO` is the one DTO genuinely specific to this package's own cross-service `sync`
// extension. The CRUD RTOs live in `@zanix/notifications` — see its own
// `src/@tests/unit/templates/templates.rto.test.ts`.

Deno.test('SyncTemplatesRTO validates a plain "serviceId" string', async () => {
  const rto = await classValidation(SyncTemplatesRTO, { serviceId: 'billing' })
  assertEquals(rto.serviceId, 'billing')
})

Deno.test('SyncTemplatesRTO rejects when serviceId is missing entirely', async () => {
  let threw = false
  try {
    await classValidation(SyncTemplatesRTO, {})
  } catch {
    threw = true
  }
  assert(threw)
})
