import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import {
  ADMIN_PROTOCOL_HEADER,
  bootstrapServers,
  ProgramModule,
  webServerManager,
} from '@zanix/server'
import { createServiceAssertion } from '@zanix/auth'
import { generateRSAKeys } from '@zanix/helpers'
import { ADMIN_PROTOCOL_VERSION } from '../../../mod.ts'
import { createServiceExchangeController } from 'modules/service-exchange/service-exchange.handler.ts'

// The real, full-HTTP-dispatch home for `/admin/service-token`'s deep exchange logic — moved here
// from `@zanix/core`'s own functional tests, since this controller (and `exchangeServiceCredential`
// itself, via `@zanix/auth`) is fully owned and tested by this package now. Booted directly via
// `bootstrapServers`, not `ZanixAdminHub.start()`, since that entrypoint doesn't wire this controller
// — it's a `@zanix/core`-side concern to register it (see `core`'s `defineAdminMetadata`).

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name: 'service-exchange: rejects garbage, mints a token for a valid assertion',
  fn: async () => {
    await ProgramModule.defineApplication('admin', () => {
      createServiceExchangeController()
    })
    const [serverId] = await bootstrapServers({
      rest: { application: 'admin', id: 'service-exchange-test' },
    })
    assert(serverId, 'the admin REST server should have been started')

    const info = webServerManager.info(serverId)
    assert(info.addr, 'the started server should be listening')
    const exchangeUrl =
      `http://${info.addr.hostname}:${info.addr.port}/${serverId}/admin/service-token`

    // A garbage assertion is rejected — no session/role gate to bypass first (there's nothing to
    // authenticate as yet), so this hits `exchangeServiceCredential`'s own verification directly.
    const garbage = await fetch(exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assertion: 'not-a-real-assertion' }),
    })
    assertEquals(garbage.status, 400)
    await garbage.body?.cancel()

    // A valid, self-signed assertion for a registered service mints a real access token.
    const { privateKey, publicKey } = await generateRSAKeys()
    Deno.env.set('JWK_PUB_test-service', btoa(publicKey))
    Deno.env.set('JWK_PRI', btoa((await generateRSAKeys()).privateKey))

    const assertion = await createServiceAssertion({
      serviceId: 'test-service',
      privateKey: btoa(privateKey),
    })
    const exchanged = await fetch(exchangeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assertion }),
    })
    assertEquals(exchanged.status, 200)
    assertEquals(exchanged.headers.get(ADMIN_PROTOCOL_HEADER), String(ADMIN_PROTOCOL_VERSION))
    const credential = await exchanged.json()
    assert(credential.accessToken)
    assertEquals(credential.serviceId, 'test-service')

    Deno.env.delete('JWK_PUB_test-service')
    Deno.env.delete('JWK_PRI')

    await webServerManager.stop([serverId])
  },
})
