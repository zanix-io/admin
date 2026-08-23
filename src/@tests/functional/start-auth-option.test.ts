import { assert } from '@std/assert'
import { stub } from '@std/testing/mock'
import { generateRSAKeys } from '@zanix/helpers'
import ZanixAdminHub, {
  getDlqAggregator,
  getTriggersAggregator,
  ServiceRegistry,
  setServiceRegistry,
  syncTemplatesFromRegisteredService,
} from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')
stub(console, 'error')

// Only one `ZanixAdminHub.start()` test per file — see `start.test.ts`'s own note.

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'ZanixAdminHub.start({auth}) installs an authenticated TriggersAggregator that signs+exchanges a real credential per registered service',
  fn: async () => {
    Deno.env.set('ADMIN_HUB_SERVER_ID', 'auth-option-test')

    const { privateKey } = await generateRSAKeys()
    setServiceRegistry(
      new ServiceRegistry([{
        serviceId: 'billing',
        adminBaseUrl: 'http://billing.internal',
      }]),
    )

    const exchangeCalls: string[] = []
    globalThis.fetch = ((url: string) => {
      exchangeCalls.push(url)
      return Promise.resolve(
        new Response(
          JSON.stringify({
            accessToken: 'billing-token',
            expiresIn: 1800,
            serviceId: 'billing',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
    }) as unknown as typeof fetch

    const servers = await ZanixAdminHub.start({
      auth: { serviceId: 'zanix-admin-hub', privateKey: btoa(privateKey) },
    })
    await new Promise((resolve) => setTimeout(resolve, 1000)) // wait for mongo/redis core connect

    try {
      assert(servers.length > 0, 'the hub server should have started normally')

      // Exercise the installed aggregator's own CRUD client factory (not the Discovery one) by
      // calling `get` directly — proves `auth` actually wired a real, exchanging factory, not
      // just accepted the option.
      await getTriggersAggregator().get('billing', 'Invoice').catch(() => {
        // The target never really answers `/admin/triggers/:model` in this test (only the
        // exchange endpoint is stubbed) — irrelevant; we only care that the exchange itself ran.
      })

      assert(
        exchangeCalls.includes('http://billing.internal/admin/service-token'),
        `expected a service-token exchange call, got: ${JSON.stringify(exchangeCalls)}`,
      )

      // Same reasoning, one seam over each: `defineAdminHubApp`'s `setup()` wires an authenticated
      // Discovery client factory for Triggers/DLQ, a CRUD client factory for DLQ, and a Discovery
      // client factory for Templates too — none of those are exercised by the CRUD-only `get()`
      // call above (`list()` is Discovery-only, `get()` is CRUD-only, and Templates has no CRUD
      // seam here at all). None of these targets really answer either — only the exchange itself
      // (and that the factory was actually invoked, not just constructed) is being proven.
      await getTriggersAggregator().list().catch(() => {})
      await getDlqAggregator().get('billing', 'entry-1').catch(() => {})
      await getDlqAggregator().list().catch(() => {})
      await syncTemplatesFromRegisteredService('billing').catch(() => {})

      // The exchange itself is cached after the first call above (one `/admin/service-token` hit
      // total is expected, not one per factory) — what proves each of the four new factories
      // above was actually INVOKED (not just constructed) is that each made its own real call to
      // its target's own distinct URL, using the exchanged credential's headers.
      for (
        const url of [
          'http://billing.internal/.well-known/zanix/triggers',
          'http://billing.internal/admin/dlq/entry-1',
          'http://billing.internal/.well-known/zanix/dlq',
          'http://billing.internal/.well-known/zanix/templates',
        ]
      ) {
        assert(
          exchangeCalls.includes(url),
          `expected a call to ${url}, got: ${JSON.stringify(exchangeCalls)}`,
        )
      }
    } finally {
      Deno.env.delete('ADMIN_HUB_SERVER_ID')
      await ZanixAdminHub.stop()
    }
  },
})
