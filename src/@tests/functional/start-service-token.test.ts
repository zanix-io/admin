import { assert, assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import { webServerManager } from '@zanix/server'
import { createServiceAssertion } from '@zanix/auth'
import { generateRSAKeys } from '@zanix/helpers'
import ZanixAdminHub, { ADMIN_PROTOCOL_HEADER, ADMIN_PROTOCOL_VERSION } from '../../../mod.ts'

// Only one `ZanixAdminHub.start()` test per file — see `start.test.ts`'s own note.
//
// This is the regression test for the real, confirmed gap `ZanixAdminHub.start({ serviceToken:
// true })` closes: a hub operator previously had no official way to make `console`'s
// `admin-hub-auth.ts` single-base-URL assumption (`/admin/service-token` reachable alongside
// `/triggers`/`/templates`/`/registry` under ONE `ADMIN_HUB_BASE_URL`) actually true, short of
// hand-composing `createServiceExchangeController()` themselves. Proving all four surfaces answer
// on the exact same base URL/port — via a real bootstrapped `ZanixAdminHub.start()`, real HTTP, not
// a unit-level assertion on internal wiring — is the point: it's what stops this gap from being
// silently reintroduced (e.g. by moving `/admin/service-token` back under a second Application)
// six months from now.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'ZanixAdminHub.start({ serviceToken: true }) registers /admin/service-token under the SAME ' +
    "base URL/port as /triggers, /templates, /dlq and /registry, all bound to 'admin-hub'",
  fn: async () => {
    Deno.env.set('ADMIN_HUB_SERVER_ID', 'start-service-token-test')

    const servers = await ZanixAdminHub.start({ serviceToken: true })
    assert(servers.length > 0, 'an admin REST server should have been started')

    const info = webServerManager.info(servers[0])
    assert(info.addr, 'the started server should be listening')
    const baseUrl = `http://${info.addr.hostname}:${info.addr.port}/${servers[0]}`

    try {
      // The other three (+ registry) still answer, unaffected by the new option — same base URL.
      const triggers = await fetch(`${baseUrl}/triggers/list`)
      assertEquals(triggers.status, 401)
      await triggers.body?.cancel()

      const templates = await fetch(`${baseUrl}/templates/list`)
      assertEquals(templates.status, 401)
      await templates.body?.cancel()

      const registry = await fetch(`${baseUrl}/registry/list`)
      assertEquals(registry.status, 401)
      await registry.body?.cancel()

      // `/admin/service-token` itself — no session gate (there's nothing to authenticate as yet,
      // see `createServiceExchangeController`'s own doc), so a garbage assertion hits
      // `exchangeServiceCredential`'s own verification directly.
      const exchangeUrl = `${baseUrl}/admin/service-token`

      const garbage = await fetch(exchangeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assertion: 'not-a-real-assertion' }),
      })
      assertEquals(garbage.status, 400)
      await garbage.body?.cancel()

      // A valid, self-signed assertion for a registered service mints a real access token — same
      // base URL/port as every other surface above, proving this is genuinely ONE composed hub, not
      // a second Application/proxy in disguise.
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
      assertEquals(
        exchanged.headers.get(ADMIN_PROTOCOL_HEADER),
        String(ADMIN_PROTOCOL_VERSION),
      )
      const credential = await exchanged.json()
      assert(credential.accessToken)
      assertEquals(credential.serviceId, 'test-service')

      Deno.env.delete('JWK_PUB_test-service')
      Deno.env.delete('JWK_PRI')
    } finally {
      Deno.env.delete('ADMIN_HUB_SERVER_ID')
      await ZanixAdminHub.stop()
    }
  },
})
