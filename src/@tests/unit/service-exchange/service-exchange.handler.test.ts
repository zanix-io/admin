import { assert, assertEquals, assertRejects } from '@std/assert'
import type { HandlerContext } from '@zanix/server'
import { createServiceAssertion } from '@zanix/auth'
import { generateRSAKeys } from '@zanix/helpers'
import { createServiceExchangeController } from 'modules/service-exchange/service-exchange.handler.ts'

const SERVICE_ID = 'test-service'

// `createServiceExchangeController`'s route prefix (`admin/service-token`) is fixed, not
// configurable — calling the factory more than once in the same process collides on that path
// (the same "one registration per process" constraint established elsewhere in this test suite),
// so it's built exactly once here and reused across both tests below.
const ServiceExchangeController = createServiceExchangeController()

function fakeCtx(assertion: string): HandlerContext<never> {
  return { payload: { body: { assertion } } } as HandlerContext<never>
}

Deno.test('ServiceExchangeController: forwards the assertion, returns a credential', async () => {
  const { privateKey: authPrivateKey, publicKey: authPublicKey } = await generateRSAKeys()
  Deno.env.set('JWK_PRI', btoa(authPrivateKey))
  Deno.env.set('JWK_PUB', btoa(authPublicKey))

  const { privateKey, publicKey } = await generateRSAKeys()
  Deno.env.set(`JWK_PUB_${SERVICE_ID}`, btoa(publicKey))

  try {
    const assertion = await createServiceAssertion({
      serviceId: SERVICE_ID,
      privateKey: btoa(privateKey),
    })
    const instance = new ServiceExchangeController({ id: 'test-ctx' } as never)

    const result = await instance.exchange(fakeCtx(assertion))

    assert(result.accessToken)
    assertEquals(result.serviceId, SERVICE_ID)
  } finally {
    Deno.env.delete('JWK_PRI')
    Deno.env.delete('JWK_PUB')
    Deno.env.delete(`JWK_PUB_${SERVICE_ID}`)
  }
})

Deno.test('ServiceExchangeController: rejects an unregistered service assertion', async () => {
  const { privateKey } = await generateRSAKeys()
  const assertion = await createServiceAssertion({
    serviceId: 'unregistered',
    privateKey: btoa(privateKey),
  })
  const instance = new ServiceExchangeController({ id: 'test-ctx' } as never)

  await assertRejects(() => instance.exchange(fakeCtx(assertion)))
})
