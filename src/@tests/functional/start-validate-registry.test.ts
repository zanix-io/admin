import { assert } from '@std/assert'
import { stub } from '@std/testing/mock'
import ZanixAdmin, { ServiceRegistry, setServiceRegistry } from '../../../mod.ts'

stub(console, 'info')
stub(console, 'warn')

globalThis.fetch =
  (() => Promise.reject(new TypeError('connection refused'))) as unknown as typeof fetch

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    'ZanixAdmin.start({validateRegistry: true}): an unreachable registered peer never blocks or fails boot',
  fn: async () => {
    Deno.env.set('ADMIN_SERVER_ID', 'validate-registry-test')
    setServiceRegistry(
      new ServiceRegistry([{
        serviceId: 'unreachable-peer',
        adminBaseUrl: 'http://nowhere.invalid',
      }]),
    )

    const servers = await ZanixAdmin.start({ validateRegistry: true })
    assert(servers.length > 0, 'the admin server should still have started normally')

    // Give the fire-and-forget probe a moment to run (and fail internally) before tearing down —
    // proves it doesn't hang or throw unhandled, not that we depend on its result.
    await new Promise((resolve) => setTimeout(resolve, 50))

    Deno.env.delete('ADMIN_SERVER_ID')
    await ZanixAdmin.stop()
  },
})
