import { assertEquals } from '@std/assert'
import { stub } from '@std/testing/mock'
import ZanixAdmin from '../../../mod.ts'

// See `start.test.ts`'s own note: only one `ZanixAdmin.start()` test per file.

stub(console, 'info')
stub(console, 'warn')

Deno.test({
  sanitizeOps: false,
  sanitizeResources: false,
  name:
    "ZanixAdmin.start() honors ADMIN_SERVER_ID for a stable id, the same way @zanix/core's start() does",
  fn: async () => {
    Deno.env.set('ADMIN_SERVER_ID', 'custom-hub')

    try {
      const servers = await ZanixAdmin.start()
      assertEquals(servers[0], 'custom-hub-rest')
      await ZanixAdmin.stop()
    } finally {
      Deno.env.delete('ADMIN_SERVER_ID')
    }
  },
})
