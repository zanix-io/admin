import { assert } from '@std/assert'
import { stub } from '@std/testing/mock'
import { generateRSAKeys } from '@zanix/helpers'
import ZanixAdminHub, {
  getTriggersAggregator,
  ServiceRegistry,
  setServiceRegistry,
} from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

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
      new ServiceRegistry([{ serviceId: 'billing', adminBaseUrl: 'http://billing.internal' }]),
    )

    const exchangeCalls: string[] = []
    globalThis.fetch = ((url: string) => {
      exchangeCalls.push(url)
      return Promise.resolve(
        new Response(
          JSON.stringify({ accessToken: 'billing-token', expiresIn: 1800, serviceId: 'billing' }),
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
    } finally {
      Deno.env.delete('ADMIN_HUB_SERVER_ID')
      await ZanixAdminHub.stop()
    }
  },
})
